// SELF_DIR 的读写：事件流只追加，单值内容先写临时文件再改名，面板与叙事重写前留旧版

import fs from 'node:fs'
import path from 'node:path'
import { renderConstitution } from './constitution.ts'
import { FILES } from './files.ts'
import { panelBody, panelFile } from './panel.ts'
import type {
  RollbackCheck,
  RollbackOutcome,
  SelfSettings,
  VersionEntry,
  VersionKind,
} from './types.ts'

/**
 * 造一个 id
 * @param at - 发生的时刻
 * @returns 时刻的 36 进制加 6 位随机
 */
export function newId(at: number): string {
  const tail = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  return `${at.toString(36)}${tail}`
}

// 读一个文件，读不动就当不存在
function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  } catch (error) {
    // 不在、没权限、读一半坏了都算没有
    void error
    return undefined
  }
}

// 按原始字节读，留版本与核对都靠它，剥了 BOM 就比不出逐字相同
function readRaw(file: string): Buffer | undefined {
  try {
    return fs.readFileSync(file)
  } catch (error) {
    // 不在、没权限、读一半坏了都算没有
    void error
    return undefined
  }
}

// 原子写：先写同目录的临时文件，再改名顶上
function writeAtomic(file: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600 })
    fs.renameSync(temporary, file)
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true })
    } catch (cleanup) {
      // 临时文件删不掉也留着，正本没被动过
      void cleanup
    }
    throw error
  }
}

// 一行一条 JSON，不是对象的行直接跳过
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

// 能回滚的两种文件：版本名前缀与正本都从这张表取
const VERSION_FILES: Readonly<Record<VersionKind, string>> = {
  panel: FILES.panel,
  narrative: FILES.narrative,
}

// 版本名只认这一种写法，末尾的序号是同一分钟里存的第二份、第三份；名字是回滚入口的输入，写法固定不随配置改
const VERSION_NAME = /^(panel|narrative)-(\d{8})-(\d{4})(?:-(\d+))?\.md$/

// 一份版本文件的印象，外加同一分钟里排先后用的序号
interface VersionRow extends VersionEntry {
  seq: number
}

// 版本名里的时间戳，本地时间到分钟，形如 20261104-1830
function versionStamp(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

// 版本名里的年月日与时分读回毫秒，按本地时间算
function versionAt(stamp: string, minute: string): number {
  const at = new Date(
    Number(stamp.slice(0, 4)),
    Number(stamp.slice(4, 6)) - 1,
    Number(stamp.slice(6, 8)),
    Number(minute.slice(0, 2)),
    Number(minute.slice(2, 4)),
  )
  return at.getTime()
}

// 文件正本对应哪种版本，宪法这类不参与回滚
function versionKindOf(name: string): VersionKind | undefined {
  if (name === VERSION_FILES.panel) return 'panel'
  if (name === VERSION_FILES.narrative) return 'narrative'
  return undefined
}

// 一个种类在 versions/ 下的全部版本，最近的在前；认不出的名字不算
function scanVersions(dir: string, kind: VersionKind): VersionRow[] {
  const root = path.join(dir, FILES.versions)
  let names: string[]
  try {
    names = fs.readdirSync(root)
  } catch (error) {
    // 还没存过版本，这个目录就不在
    void error
    return []
  }
  const rows: VersionRow[] = []
  for (const name of names) {
    const matched = VERSION_NAME.exec(name)
    if (matched === null || matched[1] !== kind) continue
    let bytes = 0
    try {
      bytes = fs.statSync(path.join(root, name)).size
    } catch (error) {
      // 刚被滚掉的版本不再算一份
      void error
      continue
    }
    const seq = matched[4] === undefined ? 0 : Number(matched[4])
    rows.push({ name, kind, at: versionAt(matched[2] ?? '', matched[3] ?? ''), bytes, seq })
  }
  // 时刻一样的按序号分先后，序号大的更新
  return rows.sort((left, right) => right.at - left.at || right.seq - left.seq)
}

// 同一分钟里再存一份就往后加序号，绝不覆盖已有的那一份
function freeVersionName(dir: string, kind: VersionKind, at: number): string {
  const base = `${kind}-${versionStamp(at)}`
  for (let seq = 0; ; seq += 1) {
    const name = seq === 0 ? `${base}.md` : `${base}-${seq}.md`
    if (!fs.existsSync(path.join(dir, FILES.versions, name))) return name
  }
}

// 把正本按原始字节抄进 versions/，再按份数滚一次；正本还没写出来时没有旧版可留
function archiveVersion(dir: string, settings: SelfSettings, kind: VersionKind, at: number): string | undefined {
  const raw = readRaw(path.join(dir, VERSION_FILES[kind]))
  if (raw === undefined) return undefined
  const name = freeVersionName(dir, kind, at)
  writeAtomic(path.join(dir, FILES.versions, name), raw)
  const keep = Math.max(0, Math.floor(settings.versionsKeep))
  for (const row of scanVersions(dir, kind).slice(keep)) {
    fs.rmSync(path.join(dir, FILES.versions, row.name), { force: true })
  }
  return name
}

// 首处不同的行号，从 1 起；行数不同时多出来的那一行也算不同
function firstDiffLine(left: string, right: string): number {
  const before = left.split('\n')
  const after = right.split('\n')
  const shared = Math.min(before.length, after.length)
  for (let at = 0; at < shared; at += 1) {
    if (before[at] !== after[at]) return at + 1
  }
  return shared + 1
}

/** 存盘要用的东西 */
export interface SelfStoreOptions {
  /** 自我层独占的那个目录 */
  dir: string
  /** 参数表 */
  settings: SelfSettings
}

/** 这一层目录的读写口 */
export interface SelfStore {
  /** 目录绝对路径 */
  readonly dir: string
  /** 目录里某个文件的路径 */
  pathOf(name: string): string
  /** 把目录建出来 */
  ensure(): void
  /** 目录在不在 */
  exists(): boolean
  /** 停手开关在不在 */
  paused(): boolean
  /** 某个事件流的非空行 */
  lines(name: string): string[]
  /** 某个事件流的对象行，坏行跳过 */
  records(name: string): Record<string, unknown>[]
  /** 往事件流尾部追加一行 */
  append(name: string, row: object): void
  /** 读一份单值文件 */
  readText(name: string): string | undefined
  /** 覆盖一份单值文件 */
  writeText(name: string, text: string): void
  /** 面板正文，没有时为空 */
  panel(): string | undefined
  /** 面板还在复用窗口内 */
  fresh(now: number): boolean
  /** 写一份新面板 */
  writePanel(body: string, at: number): void
  /** 宪法缺了就补一份，已有就不动 */
  seedConstitution(): void
  /** 一个种类的旧版本，最近的在前 */
  listVersions(kind: VersionKind): VersionEntry[]
  /** 回滚到某一份旧版本，回滚前先把现场也存一份 */
  rollback(kind: VersionKind, name: string): RollbackOutcome
  /** 回滚之后逐字核对当前文件与那一份版本 */
  verifyAfterRollback(kind: VersionKind, name: string): RollbackCheck
}

/**
 * 建一个目录读写口
 * @param options - 目录与参数
 * @returns 读写口
 */
export function createSelfStore(options: SelfStoreOptions): SelfStore {
  const { dir, settings } = options
  const pathOf = (name: string): string => path.join(dir, name)

  return {
    dir,
    pathOf,
    ensure() {
      fs.mkdirSync(dir, { recursive: true })
    },
    exists() {
      return fs.existsSync(dir)
    },
    paused() {
      return fs.existsSync(pathOf(FILES.pause))
    },
    lines(name) {
      const text = readText(pathOf(name))
      if (text === undefined) return []
      return text.split('\n').filter(line => line.trim().length > 0)
    },
    records(name) {
      const rows: Record<string, unknown>[] = []
      for (const line of this.lines(name)) {
        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch (error) {
          // 半截的行跳过，别让它拖垮整份账
          void error
          continue
        }
        const record = asRecord(parsed)
        if (record !== undefined) rows.push(record)
      }
      return rows
    },
    append(name, row) {
      fs.mkdirSync(dir, { recursive: true })
      fs.appendFileSync(pathOf(name), `${JSON.stringify(row)}\n`)
    },
    readText(name) {
      return readText(pathOf(name))
    },
    writeText(name, text) {
      const kind = versionKindOf(name)
      if (kind !== undefined) archiveVersion(dir, settings, kind, Date.now())
      writeAtomic(pathOf(name), text)
    },
    panel() {
      const text = readText(pathOf(FILES.panel))
      return text === undefined ? undefined : panelBody(text)
    },
    fresh(now) {
      try {
        const stat = fs.statSync(pathOf(FILES.panel))
        return stat.size > 0 && now - stat.mtimeMs < settings.panelMaxAgeMs
      } catch (error) {
        // 没这份面板就是要重做一份
        void error
        return false
      }
    },
    writePanel(body, at) {
      archiveVersion(dir, settings, 'panel', at)
      writeAtomic(pathOf(FILES.panel), panelFile(body, at))
    },
    seedConstitution() {
      if (fs.existsSync(pathOf(FILES.constitution))) return
      writeAtomic(pathOf(FILES.constitution), renderConstitution())
    },
    listVersions(kind) {
      return scanVersions(dir, kind).map(row => ({ name: row.name, kind: row.kind, at: row.at, bytes: row.bytes }))
    },
    rollback(kind, name) {
      const matched = VERSION_NAME.exec(name)
      if (path.basename(name) !== name || matched === null || matched[1] !== kind) {
        return {
          ok: false,
          code: 'versions.name_invalid',
          reason: `${name} 不是 ${kind} 的版本名，这个种类的名字形如 ${kind}-20261104-1830.md`,
          hint: '照 listVersions 给的名字逐字写',
        }
      }
      const raw = readRaw(path.join(dir, FILES.versions, name))
      if (raw === undefined) {
        return {
          ok: false,
          code: 'versions.missing',
          reason: `versions/ 里没有 ${name}`,
          hint: '先跑 listVersions 看看还剩哪几份',
        }
      }
      if (raw.toString('utf8').trim() === '') {
        return {
          ok: false,
          code: 'versions.empty',
          reason: `${name} 是空的，拿它回滚等于把正文清掉`,
          hint: '换一份有正文的版本',
        }
      }
      const saved = archiveVersion(dir, settings, kind, Date.now())
      writeAtomic(pathOf(VERSION_FILES[kind]), raw)
      return saved === undefined ? { ok: true, restoredFrom: name } : { ok: true, restoredFrom: name, savedCurrent: saved }
    },
    verifyAfterRollback(kind, name) {
      const matched = VERSION_NAME.exec(name)
      if (path.basename(name) !== name || matched === null || matched[1] !== kind) {
        return { same: false, line: 0, code: 'versions.name_invalid' }
      }
      const current = readRaw(pathOf(VERSION_FILES[kind]))
      const kept = readRaw(path.join(dir, FILES.versions, name))
      if (current === undefined || kept === undefined) return { same: false, line: 0, code: 'versions.missing' }
      const left = current.toString('utf8')
      const right = kept.toString('utf8')
      if (left === right) return { same: true, line: 0 }
      return { same: false, line: firstDiffLine(left, right) }
    },
  }
}
