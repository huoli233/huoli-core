// 备份与回滚：三份文件整份抄进 backups/<时间戳>/，按份数滚动，恢复前后各对一次账

import fs from 'node:fs'
import path from 'node:path'
import { DEFAULTS } from '../src/defaults.ts'
import { describeLedger, LEDGER_SCHEMA_VERSION, runLedger, type LedgerReport } from '../src/ledger.ts'
import { MEMORY_SCHEMA_VERSION, defaultMemoryFile } from '../src/store.ts'
import type { MemoryItem } from '../src/types.ts'
import { QUEUE_SCHEMA_VERSION } from '../src/write.ts'
import { assertSupportedVersion, isRecord, ledgerBeside, queueBeside, readMemory } from './read.ts'

/** 备份里收三类文件，目录名固定，原路径记在清单里 */
export type ArchiveKind = 'memory' | 'ledger' | 'queue'

/** 备份清单的版本戳，只有清单结构变化才动它 */
export const MANIFEST_VERSION = 1

/** 清单文件的名字 */
const MANIFEST_NAME = 'manifest.json'

/** 一类文件在备份目录里叫什么 */
const FIXED_NAME: Readonly<Record<ArchiveKind, string>> = {
  memory: 'memory.json',
  ledger: 'ledger.json',
  queue: 'queue.json',
}

/** 三类各按什么版本字段判新旧 */
const VERSION_KEY: Readonly<Record<ArchiveKind, string>> = {
  memory: 'version',
  ledger: 'schemaVersion',
  queue: 'version',
}

/** 三类各自认到哪个版本 */
const SUPPORTED_VERSION: Readonly<Record<ArchiveKind, number>> = {
  memory: MEMORY_SCHEMA_VERSION,
  ledger: LEDGER_SCHEMA_VERSION,
  queue: QUEUE_SCHEMA_VERSION,
}

/** 三类文件在话里怎么称呼 */
const LABEL: Readonly<Record<ArchiveKind, string>> = {
  memory: '记忆文件',
  ledger: '账本',
  queue: '待写队列',
}

/** 备份目录名只认这种时间戳，别的目录不碰 */
const STAMP_NAME = /^\d{8}-\d{6}$/

/** 收哪三类，按这个顺序抄 */
const KINDS: readonly ArchiveKind[] = ['memory', 'ledger', 'queue']

/** 造一次备份要的东西 */
export interface BackupOptions {
  /** 记忆文件，不填取主目录下的 data/qq-memory.json */
  file?: string
  /** 账本文件，不填取记忆文件同目录 */
  ledgerFile?: string
  /** 待写队列，不填取记忆文件同目录 */
  queueFile?: string
  /** 备份根目录，不填取记忆文件同目录下的 backups */
  backupsRoot?: string
  /** 留几份，不填取默认值表里的 backupKeep */
  keep?: number
}

/** 备份清单里的一条：哪一类、原来在哪、在备份里叫什么 */
export interface BackupEntry {
  kind: ArchiveKind
  source: string
  name: string
}

/** 备份清单 */
export interface BackupManifest {
  version: typeof MANIFEST_VERSION
  /** 这次备份的时刻 */
  at: number
  entries: readonly BackupEntry[]
}

/** 一次备份的结果 */
export interface BackupResult {
  /** 这次备份落在哪个目录 */
  dir: string
  /** 备份时刻 */
  at: number
  /** 备份里落下的文件名 */
  copied: readonly string[]
  /** 源头没有、这一份没得备份的路径 */
  missing: readonly string[]
  /** 这一轮滚掉的老备份目录名 */
  removed: readonly string[]
  /** 滚完之后还在的备份目录名，从旧到新 */
  kept: readonly string[]
}

/** 恢复时能改的三个目标位置 */
export interface RestoreOptions {
  /** 恢复到哪个记忆文件，不填按清单里的原路径 */
  file?: string
  /** 恢复到哪个账本，不填按清单里的原路径 */
  ledgerFile?: string
  /** 恢复到哪个队列，不填按清单里的原路径 */
  queueFile?: string
}

/** 一次恢复的结果 */
export interface RestoreResult {
  /** 从哪个备份目录恢复 */
  dir: string
  /** 这次覆盖回去的文件名 */
  restored: readonly string[]
  /** 恢复之前当场对的一次账 */
  before: LedgerReport
  /** 恢复之后再对的一次账，这一份通过才算恢复干净 */
  after: LedgerReport
}

interface ArchivePaths {
  memory: string
  ledger: string
  queue: string
  root: string
  keep: number
}

// 本地时间的 20261104-175600，同秒重跑会落在同一个目录
function stampOf(now: number): string {
  const at = new Date(now)
  const pad = (value: number): string => value.toString().padStart(2, '0')
  return `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
    + `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
}

// 一个目录下像备份的目录名，从旧到新
function backupDirs(root: string): string[] {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && STAMP_NAME.test(entry.name))
    .map(entry => entry.name)
    .sort()
}

// 三份文件的位置与备份根目录，靠边的两个一律按记忆文件所在目录推
function resolvePaths(options: BackupOptions): ArchivePaths {
  const memory = options.file ?? defaultMemoryFile()
  const ledger = options.ledgerFile ?? ledgerBeside(memory)
  const queue = options.queueFile ?? queueBeside(memory)
  const root = options.backupsRoot ?? path.join(path.dirname(memory), 'backups')
  const keep = Math.max(1, Math.floor(options.keep ?? DEFAULTS.backupKeep))
  return { memory, ledger, queue, root, keep }
}

// 三类里的一类去哪个路径
function sourceOf(paths: ArchivePaths, kind: ArchiveKind): string {
  if (kind === 'memory') return paths.memory
  if (kind === 'ledger') return paths.ledger
  return paths.queue
}

// 超额的按最旧先删，只删认得出的备份目录
function roll(root: string, keep: number): { kept: string[]; removed: string[] } {
  const names = backupDirs(root)
  const cut = Math.max(0, names.length - keep)
  const removed = names.slice(0, cut)
  for (const name of removed) fs.rmSync(path.join(root, name), { recursive: true, force: true })
  return { kept: names.slice(cut), removed }
}

/**
 * 把记忆、账本、队列整份抄进一个带时间戳的备份目录，再按份数滚一次
 * @param now - 备份时刻，目录名按它取
 * @param options - 三份文件的位置与留几份
 * @returns 备份目录、抄了哪些、缺了哪些、滚掉了哪些
 */
export function backup(now: number, options: BackupOptions = {}): BackupResult {
  const paths = resolvePaths(options)
  if (!fs.existsSync(paths.memory)) {
    throw new Error(`memory.backup_source_missing: 记忆文件不在 ${paths.memory}｜下一步: 确认 file 指向的文件存在`)
  }
  const dir = path.join(paths.root, stampOf(now))
  fs.mkdirSync(dir, { recursive: true })
  const entries: BackupEntry[] = []
  const missing: string[] = []
  for (const kind of KINDS) {
    const source = sourceOf(paths, kind)
    if (!fs.existsSync(source)) {
      missing.push(source)
      continue
    }
    const name = FIXED_NAME[kind]
    fs.copyFileSync(source, path.join(dir, name))
    entries.push({ kind, source, name })
  }
  const manifest: BackupManifest = { version: MANIFEST_VERSION, at: now, entries }
  fs.writeFileSync(path.join(dir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  const rolled = roll(paths.root, paths.keep)
  return { dir, at: now, copied: entries.map(entry => entry.name), missing, removed: rolled.removed, kept: rolled.kept }
}

// 认得出是三类文件里的哪一类
function kindOf(value: unknown): ArchiveKind | undefined {
  if (value === 'memory' || value === 'ledger' || value === 'queue') return value
  return undefined
}

// 清单里的一条要三项都在，名字还只能是文件名本身
function entryOf(raw: Record<string, unknown>): BackupEntry | undefined {
  const kind = kindOf(raw.kind)
  if (kind === undefined) return undefined
  const source = raw.source
  const name = raw.name
  if (typeof source !== 'string' || source === '') return undefined
  if (typeof name !== 'string' || name === '' || path.basename(name) !== name) return undefined
  return { kind, source, name }
}

/**
 * 读一个备份目录里的清单，读不出来就停下来，绝不动任何文件
 * @param dir - 备份目录
 * @returns 清单
 */
export function readManifest(dir: string): BackupManifest {
  const file = path.join(dir, MANIFEST_NAME)
  try {
    if (!fs.existsSync(file)) throw new Error('清单不在')
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    if (!isRecord(parsed) || !Array.isArray(parsed.entries)) throw new Error('清单结构不对')
    const entries: BackupEntry[] = []
    for (const raw of parsed.entries) {
      if (!isRecord(raw)) continue
      const entry = entryOf(raw)
      if (entry !== undefined) entries.push(entry)
    }
    const at = typeof parsed.at === 'number' && Number.isFinite(parsed.at) ? parsed.at : 0
    return { version: MANIFEST_VERSION, at, entries }
  } catch (failure) {
    const reason = failure instanceof Error ? failure.message : String(failure)
    throw new Error(`memory.backup_manifest_unreadable: ${file} 读不出备份清单（${reason}）｜下一步: 换一个备份目录，本次没有写任何文件`)
  }
}

// 备份里的这一类文件，清单没记就是没有
function backupFileOf(dir: string, manifest: BackupManifest, kind: ArchiveKind): string | undefined {
  const entry = manifest.entries.find(one => one.kind === kind)
  return entry === undefined ? undefined : path.join(dir, entry.name)
}

// 恢复要落到哪个路径，调用方给的优先
function targetOf(manifest: BackupManifest, kind: ArchiveKind, given: string | undefined): string | undefined {
  if (given !== undefined) return given
  return manifest.entries.find(one => one.kind === kind)?.source
}

// 备份里与目标那两份文件都不许比本包新，判在动手之前
function assertArchiveVersions(dir: string, manifest: BackupManifest, targets: Map<ArchiveKind, string>): void {
  for (const kind of KINDS) {
    const from = backupFileOf(dir, manifest, kind)
    if (from !== undefined) {
      assertSupportedVersion(from, VERSION_KEY[kind], SUPPORTED_VERSION[kind], `备份里的${LABEL[kind]}`)
    }
    const target = targets.get(kind)
    if (target !== undefined) {
      assertSupportedVersion(target, VERSION_KEY[kind], SUPPORTED_VERSION[kind], `现在的${LABEL[kind]}`)
    }
  }
}

// 当场对一次账，条目从目标记忆文件只读读一遍
function verifyAt(memoryFile: string, ledgerFile: string): LedgerReport {
  const items: readonly MemoryItem[] = readMemory(memoryFile).items
  return runLedger('verify', { file: ledgerFile, items }).report
}

/**
 * 从一个备份目录恢复三份文件，恢复前后各对一次账
 * @param dir - 备份目录
 * @param options - 三个目标位置，不给就回到清单里记的原路径
 * @returns 这次覆盖了哪些文件，以及前后的对账结果
 */
export function restore(dir: string, options: RestoreOptions = {}): RestoreResult {
  const manifest = readManifest(dir)
  const targets = new Map<ArchiveKind, string>()
  for (const kind of KINDS) {
    const given = kind === 'memory' ? options.file : kind === 'ledger' ? options.ledgerFile : options.queueFile
    const target = targetOf(manifest, kind, given)
    if (target !== undefined) targets.set(kind, target)
  }
  assertArchiveVersions(dir, manifest, targets)
  const memoryFile = targets.get('memory')
  if (memoryFile === undefined) {
    throw new Error(`memory.backup_memory_absent: ${dir} 里没有记忆文件｜下一步: 给一个带记忆文件的备份，本次没有写任何文件`)
  }
  const ledgerFile = targets.get('ledger') ?? ledgerBeside(memoryFile)
  const before = verifyAt(memoryFile, ledgerFile)
  // 记忆先回、队列其次、账本最后：对账读的是前两份，账本落地时它才代表恢复后的样子
  const order: readonly ArchiveKind[] = ['memory', 'queue', 'ledger']
  const restored: string[] = []
  for (const kind of order) {
    const from = backupFileOf(dir, manifest, kind)
    const target = targets.get(kind)
    if (from === undefined || target === undefined) continue
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(from, target)
    restored.push(FIXED_NAME[kind])
  }
  const after = verifyAt(memoryFile, ledgerFile)
  return { dir, restored, before, after }
}

/**
 * 恢复之后写给人看的一句话，两边对不对得上都点出来
 * @param result - 一次恢复的结果
 * @returns 拼好的话
 */
export function describeRestore(result: RestoreResult): string {
  const head = `已从 ${result.dir} 恢复 ${result.restored.join('、')}`
  const before = `恢复前：${describeLedger(result.before)}`
  const after = result.after.ok ? `恢复后：${describeLedger(result.after)}` : `恢复后仍对不上：${describeLedger(result.after)}`
  return [head, before, after].join('\n')
}
