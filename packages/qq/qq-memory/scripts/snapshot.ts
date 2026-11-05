// 性格不变快照：同一句话在放进开与关两种状态下各算一份哈希，人能拿两份文件对比

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULTS, resolveTuning, type Tuning } from '../src/defaults.ts'
import { buildInjectBlock, injectIntoUserText } from '../src/inject.ts'
import { recall } from '../src/recall.ts'
import { createMemoryStore, defaultMemoryFile } from '../src/store.ts'

/** 快照文件的名字，一开一关各一份 */
const ON_NAME = 'inject-on.txt'
const OFF_NAME = 'inject-off.txt'

/** 造一次快照要的东西 */
export interface PersonaSnapshotOptions {
  /** 记忆文件，不填取主目录下的 data/qq-memory.json */
  file?: string
  /** 快照落在哪，不填取记忆文件同目录下的 snapshots */
  snapshotsDir?: string
  /** 拿来找记忆的那句，不填取默认值表里的 snapshotQuery */
  query?: string
  /** 拿来试放进的那句闲聊，固定问题集在调用方，不填取默认值表里的 snapshotSample */
  sample?: string
  /** 只在同一个会话里找，不填按全部会话找 */
  chatKey?: string
  /** 现在的时间，不填取此刻 */
  now?: number
  /** 想改哪些默认参数 */
  tuning?: Partial<Tuning>
}

/** 一份快照文件的摘要 */
export interface SnapshotDigest {
  /** 写到了哪个文件 */
  file: string
  /** 文件内容的 sha256，照着文件重算得回同一个值 */
  sha256: string
  /** 内容几个字 */
  chars: number
}

/** 一次快照的结果 */
export interface PersonaSnapshotResult {
  /** 放进开的那一份 */
  on: SnapshotDigest
  /** 放进关的那一份 */
  off: SnapshotDigest
  /** 两份哈希不一样就说明记忆放进确实改了这段文本 */
  changed: boolean
  /** 这次找到几条可放进的记忆 */
  hits: number
}

// 一段文本的哈希，快照文件与返回值算的是同一个东西
function digestOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

// 把一个状态写成一份小文件，内容与哈希同源
function writeSnapshot(dir: string, name: string, text: string): SnapshotDigest {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  fs.writeFileSync(file, text, { mode: 0o600 })
  return { file, sha256: digestOf(text), chars: text.length }
}

/**
 * 产出性格不变快照：放进开与关两种状态下各写一份放进文本，并给出两份哈希
 * @param options - 记忆文件、快照位置与两句取样文本
 * @returns 两份摘要与它们是否不一样
 */
export function personaSnapshot(options: PersonaSnapshotOptions = {}): PersonaSnapshotResult {
  const tuning = resolveTuning(options.tuning)
  const file = options.file ?? defaultMemoryFile()
  const dir = options.snapshotsDir ?? path.join(path.dirname(file), 'snapshots')
  const query = options.query ?? DEFAULTS.snapshotQuery
  const sample = options.sample ?? DEFAULTS.snapshotSample
  const now = options.now ?? Date.now()
  const store = createMemoryStore({ file })
  const hits = options.chatKey === undefined
    ? recall(store, { query, now, tuning })
    : recall(store, { query, scope: options.chatKey, now, tuning })
  const block = buildInjectBlock(hits, tuning.injectMaxChars, tuning.injectMaxItems)
  // 开关两种状态只差这一段背景：关着就是那句原文，开着就是原文接上背景
  const on = writeSnapshot(dir, ON_NAME, injectIntoUserText(sample, block))
  const off = writeSnapshot(dir, OFF_NAME, sample)
  return { on, off, changed: on.sha256 !== off.sha256, hits: hits.length }
}
