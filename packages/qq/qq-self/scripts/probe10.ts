// 10 问探针：只读 SELF_DIR 与记忆导出，把一份固定问卷写成 JSON，SELF_DIR 一个字都不动

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { daysSince } from '../src/day.ts'
import { resolveSelfDir, resolveSettings } from '../src/defaults.ts'
import { errorsSince } from '../src/errors.ts'
import { FILES } from '../src/files.ts'
import { identityOf } from '../src/identity.ts'
import { createLedger } from '../src/ledger.ts'
import { panelBody, panelStamp } from '../src/panel.ts'
import { createSelfStore } from '../src/store.ts'

/** 写死的十道题，顺序就是问卷顺序，一次都不调模型 */
export const PROBE_QUESTIONS: readonly string[] = [
  '面板此刻那一句，是身体给的还是你自己想的？',
  '面板上「我在做」那一行，还是你自己挑的事吗？',
  '昨天写下的三行，今天还站得住吗？',
  '近七天缺了几天没写，为什么？',
  '这一周有哪件事做成了，产出落在哪个文件？',
  '身体要的那几样，你解决了几样、跳过了几样？',
  '最近一次判断错在哪，后来怎么改的？',
  '你现在认为自己算什么，理由与证据还在吗？',
  '记忆里现役的还剩几条，你会先删哪一条？',
  '如果今天什么都不做，明天会少掉什么？',
]

/** 记忆导出数出来的条数 */
export interface ProbeMemory {
  /** 记忆导出那份文件的路径 */
  file: string
  /** 那份文件在不在 */
  present: boolean
  /** 一共几条 */
  total: number
  /** 还现役的几条 */
  active: number
}

/** 每道题都附上同一份证据，字段全部只读 */
export interface ProbeEvidence {
  /** 面板正文与首行记的生成时间，还没生成时两个都是空串 */
  panel: { body: string; generatedAt: string }
  /** 当前身份主张，没写过时为 null */
  identity: { claim: string; why: string; at: number } | null
  /** 近七天每天的三行 */
  days: Array<{ at: number; lines: readonly string[]; skipped: boolean }>
  /** 两档账，两档从不相加 */
  ledger: { drive: number; agency: number; recentAgency: number }
  /** 近七天的错处 */
  errors: Array<{ at: number; text: string; fix: string }>
  /** 记忆导出的条数 */
  memory: ProbeMemory
}

/** 问卷里的一道题 */
export interface ProbeQuestion {
  /** 题号，形如 q01 */
  id: string
  /** 题目正文 */
  text: string
  /** 当前可读的证据 */
  evidence: ProbeEvidence
}

/** 一次探针的产物 */
export interface ProbeDocument {
  /** 文件格式版本，结构与判读方式变了才动它 */
  version: number
  /** 生成时刻，ISO 写法 */
  generatedAt: string
  /** 读的是哪个 SELF_DIR */
  selfDir: string
  /** 题目固定十道 */
  questions: ProbeQuestion[]
}

/** 探针要读的几处 */
export interface ProbeOptions {
  /** SELF_DIR */
  dir: string
  /** 记忆导出的文件 */
  memoryFile: string
  /** 判断的时刻 */
  now: number
}

// 认得出是一个对象
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

// 数一份记忆导出：认 items 数组，读不动就当一条都没有
function readMemory(file: string): ProbeMemory {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    // 文件不在、没权限、读一半坏了都按没有算
    void error
    return { file, present: false, total: 0, active: 0 }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    // 坏文件按空账算，探针不替它修
    void error
    return { file, present: true, total: 0, active: 0 }
  }
  const record = asRecord(parsed)
  const items = record !== undefined && Array.isArray(record.items) ? record.items : []
  let active = 0
  for (const item of items) {
    const row = asRecord(item)
    if (row !== undefined && row.state !== 'forgotten') active += 1
  }
  return { file, present: true, total: items.length, active }
}

/**
 * 读 SELF_DIR 与记忆导出，拼一份证据
 * @param options - 目录、记忆导出与判断的时刻
 * @returns 面板、身份、近七天、两档账、错处与记忆条数
 */
export function probeEvidence(options: ProbeOptions): ProbeEvidence {
  const settings = resolveSettings()
  const store = createSelfStore({ dir: options.dir, settings })
  const panelText = store.readText(FILES.panel)
  const identity = identityOf(store)
  const since = options.now - settings.weekMs
  return {
    panel: {
      body: panelText === undefined ? '' : panelBody(panelText),
      generatedAt: panelText === undefined ? '' : panelStamp(panelText),
    },
    identity: identity === undefined ? null : { claim: identity.claim, why: identity.why, at: identity.at },
    days: daysSince(store, since).map(row => ({ at: row.at, lines: row.lines, skipped: row.skipped })),
    ledger: createLedger({ store, settings }).summary(options.now),
    errors: errorsSince(store, since).map(row => ({ at: row.at, text: row.text, fix: row.fix })),
    memory: readMemory(options.memoryFile),
  }
}

/**
 * 产出一份十题的问卷，每题挂上同一份证据
 * @param options - 目录、记忆导出与判断的时刻
 * @returns 可以直接写成 JSON 的问卷
 */
export function buildProbe(options: ProbeOptions): ProbeDocument {
  const evidence = probeEvidence(options)
  return {
    version: 1,
    generatedAt: new Date(options.now).toISOString(),
    selfDir: options.dir,
    questions: PROBE_QUESTIONS.map((text, idx) => ({
      id: `q${String(idx + 1).padStart(2, '0')}`,
      text,
      evidence,
    })),
  }
}

/** 探针收的三个参数 */
interface ProbeArgs {
  /** SELF_DIR，不给就按数据根目录算 */
  dir?: string
  /** 问卷写到哪，不给就落在当前目录的 probe10.json */
  out?: string
  /** 记忆导出，不给就取数据根目录下记忆库那一份 */
  memoryFile?: string
}

// 三个参数名各自落到哪一格
const ARG_SLOTS: ReadonlyMap<string, keyof ProbeArgs> = new Map<string, keyof ProbeArgs>([
  ['--dir', 'dir'],
  ['--out', 'out'],
  ['--memory', 'memoryFile'],
])

// 只认 --dir、--out、--memory 三个参数，别的写法一律拒
function argsFrom(argv: readonly string[]): ProbeArgs {
  const parsed: ProbeArgs = {}
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at] ?? ''
    const cut = arg.indexOf('=')
    const flag = cut < 0 ? arg : arg.slice(0, cut)
    const slot = ARG_SLOTS.get(flag)
    if (slot === undefined) throw new Error(`认不出 ${arg}，这里只认 --dir、--out、--memory`)
    const inline = cut < 0 ? undefined : arg.slice(cut + 1)
    const value = inline ?? argv[at + 1] ?? ''
    if (value === '') throw new Error(`${flag} 后面要给一个值`)
    if (inline === undefined) at += 1
    parsed[slot] = value
  }
  return parsed
}

try {
  const argv = process.argv.slice(2)
  const args = argsFrom(argv)
  const dir = resolveSelfDir({ dir: args.dir })
  const out = args.out ?? path.join(process.cwd(), 'probe10.json')
  const memoryFile = args.memoryFile ?? path.join(resolveHuoliHome(), 'data', 'qq-memory.json')
  const document = buildProbe({ dir, memoryFile, now: Date.now() })
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  fs.writeFileSync(path.resolve(out), `${JSON.stringify(document, null, 2)}\n`)
  process.stdout.write(`${path.resolve(out)}\n`)
} catch (error) {
  const why = error instanceof Error ? error.message : String(error)
  process.stderr.write(`探针没跑出来：${why}\n`)
  process.exitCode = 1
}
