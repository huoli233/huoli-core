// 写入路径：先轻校验进队列，排空时再算近似重复，够像就并进旧条

import fs from 'node:fs'
import path from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { cosineSimilarity, encodeVector } from './recall.ts'
import { DEFAULTS, type Tuning } from './defaults.ts'
import { layerOr } from './guard.ts'
import type { MemoryStore } from './store.ts'
import { MEMORY_SOURCES, newId, type MemoryItem, type MemorySource, type RememberOptions } from './types.ts'

/** 队列文件的结构版本只随结构变化递增；第二版多了丢弃计数，旧文件读回来按 0 起 */
export const QUEUE_SCHEMA_VERSION = 2

/** 重要度不到门槛的失败码，装配层按它数被丢掉的条数 */
export const LOW_IMPORTANCE = 'memory.low_importance'

/** 一条新写入过没过重要度门槛 */
export interface WriteGate {
  /** 过了才会真写进去 */
  written: boolean
  /** 没过时的失败码，过了是空串 */
  code: string
  /** 没过时给人看的一句原因，过了是空串 */
  reason: string
  /** 没过时的下一步，过了是空串 */
  hint: string
}

/**
 * 新写一条前判重要度够不够，够不上就丢并说清为什么
 * @param importance - 算出来的重要度
 * @param min - 门槛，默认取默认值表里的 writeMinImportance
 * @returns 过没过；没过时一并给出失败码、原因与下一步
 */
export function importanceGate(importance: number, min: number = DEFAULTS.writeMinImportance): WriteGate {
  if (importance >= min) return { written: true, code: '', reason: '', hint: '' }
  return {
    written: false,
    code: LOW_IMPORTANCE,
    reason: `重要度 ${importance} 不到门槛 ${min}，这句不值得记下`,
    hint: '写一件更重要的事，或调低 writeMinImportance',
  }
}

/** 排队等着写进记忆的一条 */
export interface QueuedFact {
  /** 正文 */
  text: string
  /** 排空时记到哪个会话 */
  chatKey: string
  /** 入队时刻，排空写库时当写入时刻 */
  enqueuedAt: number
  /** 入队时给的其它几项，排空时原样带过去 */
  options: RememberOptions
}

/** 入队的结果 */
export interface EnqueueOutcome extends WriteGate {
  /** 队列里现在压着几条 */
  pending: number
  /** 累计丢掉了最旧的几条 */
  dropped: number
}

/** 排空的结果 */
export interface FlushOutcome {
  /** 这次写进记忆几条 */
  written: number
  /** 还留在队列里的条数 */
  kept: number
  /** 写不进去的原因，一条没失败就是空串 */
  error: string
}

/** 一次反思的结果 */
export interface ReflectOutcome extends WriteGate {
  /** 合成的那一条编号，没合成就空串 */
  id: string
  /** 被合成的原件编号，没合成就空数组 */
  mergedFrom: string[]
}

/** 一轮过去之后的结果 */
export interface TurnOutcome {
  /** 累计走到了第几轮 */
  turns: number
  /** 这一轮到点排空了，写进去几条 */
  written: number
  /** 这一轮到点反思了，合成的编号，没到点或没合成就空串 */
  reflected: string
}

/** 待写队列 */
export interface WriteQueue {
  pending(): number
  dropped(): number
  droppedLow(): number
  turns(): number
  enqueue(text: string, chatKey: string, options?: RememberOptions): EnqueueOutcome
  flush(now: number): FlushOutcome
  reflect(now: number): ReflectOutcome
  advanceTurn(now: number): TurnOutcome
}

/** 造一个队列要的东西 */
export interface WriteQueueOptions {
  /** 队列文件 */
  file: string
  /** 上限、轮数门槛与反思窗口 */
  tuning: Tuning
  /** 记忆仓，反思要从这里挑原件 */
  store: MemoryStore
  /** 算一条待写会在写入时落到多少重要度，重要度门槛按它判 */
  importanceOf: (chatKey: string, options: RememberOptions) => number
  /** 排空时把一条真正写进记忆，抛错就留在队列里等下次 */
  write: (fact: QueuedFact) => void
}

/** 一条够像的旧条 */
export interface NearDuplicate {
  id: string
  similarity: number
}

/** 写入一条的结果，过不了门槛时 merged 为 false、id 为空串 */
export interface WriteOutcome extends WriteGate {
  /** 是并进旧条还是新写一条 */
  merged: boolean
  /** 落库的那条编号，合并时是旧条的；丢掉时是空串 */
  id: string
  /** 落库的那条，丢掉时没有条目 */
  item: MemoryItem | undefined
}

// 队列文件的样子
interface QueueFile {
  version: number
  dropped: number
  droppedLow: number
  turns: number
  lastFlushedAt: number
  lastReflectedAt: number
  entries: QueuedFact[]
}

// 一条都没排空过、也没反思过，两个丢弃计数都从零起
const EMPTY_QUEUE: QueueFile = {
  version: QUEUE_SCHEMA_VERSION,
  dropped: 0,
  droppedLow: 0,
  turns: 0,
  lastFlushedAt: 0,
  lastReflectedAt: 0,
  entries: [],
}

// 认得出是一个对象
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

// 轻校验不过就拒收，理由与下一步一起给出
function refuse(code: string, error: string, hint: string): never {
  throw new Error(`${code}: ${error}｜下一步: ${hint}`)
}

// 读回来的选项只认认得出的那几项，别的丢掉让写入层按默认办
function optionsOf(raw: Record<string, unknown>): RememberOptions {
  const options: RememberOptions = {}
  const layer = layerOr(raw.layer)
  if (layer !== undefined) options.layer = layer
  if (typeof raw.importance === 'number' && Number.isFinite(raw.importance)) options.importance = raw.importance
  if (typeof raw.emotional === 'number' && Number.isFinite(raw.emotional)) options.emotional = raw.emotional
  if (typeof raw.directed === 'boolean') options.directed = raw.directed
  if (typeof raw.source === 'string' && (MEMORY_SOURCES as readonly string[]).includes(raw.source)) options.source = raw.source as MemorySource
  if (typeof raw.at === 'number' && Number.isFinite(raw.at)) options.at = raw.at
  if (isRecord(raw.metadata)) options.metadata = raw.metadata
  return options
}

// 读回来的一条待写，正文与会话键缺一就不认
function factOf(raw: Record<string, unknown>): QueuedFact | undefined {
  const text = typeof raw.text === 'string' ? raw.text : ''
  const chatKey = typeof raw.chatKey === 'string' ? raw.chatKey : ''
  if (text === '' || chatKey === '') return undefined
  const at = numberOr(raw.enqueuedAt, 0)
  const options = isRecord(raw.options) ? optionsOf(raw.options) : {}
  return { text, chatKey, enqueuedAt: at, options }
}

// 读队列文件，读不出来就当还没排过队
function loadQueue(file: string): QueueFile {
  try {
    if (!fs.existsSync(file)) return { ...EMPTY_QUEUE, entries: [] }
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (text.trim() === '') return { ...EMPTY_QUEUE, entries: [] }
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed)) return { ...EMPTY_QUEUE, entries: [] }
    const raws = Array.isArray(parsed.entries) ? parsed.entries : []
    const entries: QueuedFact[] = []
    for (const raw of raws) {
      if (!isRecord(raw)) continue
      const fact = factOf(raw)
      if (fact !== undefined) entries.push(fact)
    }
    return {
      version: numberOr(parsed.version, QUEUE_SCHEMA_VERSION),
      dropped: Math.max(0, Math.round(numberOr(parsed.dropped, 0))),
      droppedLow: Math.max(0, Math.round(numberOr(parsed.droppedLow, 0))),
      turns: Math.max(0, Math.round(numberOr(parsed.turns, 0))),
      lastFlushedAt: numberOr(parsed.lastFlushedAt, 0),
      lastReflectedAt: numberOr(parsed.lastReflectedAt, 0),
      entries,
    }
  } catch {
    // 队列只是还没写进记忆的过渡文件，读坏了按空队列重来，记忆文件本身没动过
    return { ...EMPTY_QUEUE, entries: [] }
  }
}

// 整份写回，先写临时文件再改名
function saveQueue(file: string, state: QueueFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * 待写队列默认落在主目录的 data 下
 * @param home - 覆盖主目录，不给按环境变量定
 * @returns 队列文件的位置
 */
export function defaultQueueFile(home?: string): string {
  return path.join(resolveHuoliHome(home), 'data', 'qq-memory-queue.json')
}

/**
 * 在同一 scope 里找与这句话够像的旧条，退役的不参与
 * @param store - 存放的地方
 * @param text - 想写进去的那句话
 * @param scope - 只在同一个会话里比
 * @param ratio - 相似度到这条线以上才算近似重复
 * @returns 最像的那条，够不上就是 undefined
 */
export function nearDuplicateOf(
  store: MemoryStore,
  text: string,
  scope: string,
  ratio: number = DEFAULTS.nearDuplicateRatio,
): NearDuplicate | undefined {
  const body = encodeVector(text)
  let best: NearDuplicate | undefined
  for (const item of store.all()) {
    if (item.state === 'forgotten') continue
    if (item.scope !== scope) continue
    const similarity = cosineSimilarity(body, encodeVector(item.text))
    if (similarity === null || similarity < ratio) continue
    if (best === undefined || similarity > best.similarity) best = { id: item.id, similarity }
  }
  return best
}

/**
 * 写一条记忆：与同 scope 的旧条够像就并进去，否则新增一条
 * @param store - 存放的地方
 * @param draft - 已经拼好的那一条
 * @param tuning - 相似度门槛与重要度门槛
 * @returns 处理结果
 */
export function writeFact(store: MemoryStore, draft: MemoryItem, tuning: Tuning = DEFAULTS): WriteOutcome {
  const found = nearDuplicateOf(store, draft.text, draft.scope, tuning.nearDuplicateRatio)
  const old = found === undefined ? undefined : store.byId(found.id)
  if (old !== undefined) {
    // 并进旧条不看门槛：门槛只管新写入，已经记下的事不该因为这次算得低就被丢掉
    const mergedCount = Math.max(0, Math.round(numberOr(old.metadata?.['mergedCount'], 0))) + 1
    // 合并只动被提起时刻、重要度与一条合并记录：正文与召回次数保持旧条的样子，记录表指纹才不会漂移
    store.update(old.id, {
      lastSeenAt: draft.lastSeenAt,
      importance: Math.max(old.importance, draft.importance),
      metadata: { ...old.metadata, mergedCount },
    })
    return { written: true, code: '', reason: '', hint: '', merged: true, id: old.id, item: store.byId(old.id) ?? old }
  }
  const gate = importanceGate(draft.importance, tuning.writeMinImportance)
  // 门槛不放行就一条都不落盘，把理由交被叫到时做的事用方，丢掉的那条由装配层计数
  if (!gate.written) return { ...gate, merged: false, id: '', item: undefined }
  store.add(draft)
  return { ...gate, merged: false, id: draft.id, item: draft }
}

// 把攒下的几条合成一条：正文按时间顺序接起来，重要度取最高的那条
function reflectionOf(window: readonly MemoryItem[], now: number, tuning: Tuning): MemoryItem {
  const mergedFrom = window.map(item => item.id)
  const text = window.map(item => item.text).join('；').slice(0, tuning.maxTextChars)
  return {
    id: newId(now),
    text,
    layer: 'semantic',
    scope: window[0]?.scope ?? '',
    importance: Math.max(...window.map(item => item.importance)),
    emotional: 0,
    clarity: 'vivid',
    recallCount: 0,
    recoverDay: 0,
    recoverTimes: 0,
    at: now,
    lastSeenAt: now,
    state: 'active',
    // 反思是从聊天里攒下的那几条提炼的，来源与批量路径同档
    source: 'chat',
    metadata: { mergedFrom, reflectedAt: new Date(now).toISOString() },
  }
}

/**
 * 建一个待写队列，队列文件与记忆文件分开，读坏不影响已记下的事
 * @param options - 队列文件、上限与写库的动作
 * @returns 处理结果
 */
export function createWriteQueue(options: WriteQueueOptions): WriteQueue {
  const tuning = options.tuning
  const loaded = loadQueue(options.file)
  const entries: QueuedFact[] = loaded.entries
  let dropped = loaded.dropped
  let droppedLow = loaded.droppedLow
  let turns = loaded.turns
  let lastFlushedAt = loaded.lastFlushedAt
  let lastReflectedAt = loaded.lastReflectedAt

  const persist = (): void => {
    saveQueue(options.file, { version: QUEUE_SCHEMA_VERSION, dropped, droppedLow, turns, lastFlushedAt, lastReflectedAt, entries })
  }

  // 攒下的条目里挑一组同 scope 的，够条数才值得合成
  const pickWindow = (): MemoryItem[] | undefined => {
    const fresh = options.store.all().filter(item => item.state !== 'forgotten'
      && item.at > lastReflectedAt
      && (item.layer === 'ephemeral' || item.layer === 'episodic'))
    const byScope = new Map<string, MemoryItem[]>()
    for (const item of fresh) {
      const bucket = byScope.get(item.scope) ?? []
      bucket.push(item)
      byScope.set(item.scope, bucket)
    }
    for (const bucket of byScope.values()) {
      if (bucket.length < tuning.reflectMinItems) continue
      const window = bucket.slice(-tuning.reflectWindow)
      if (window.length < tuning.reflectMinItems) continue
      return window
    }
    return undefined
  }

  const flush = (now: number): FlushOutcome => {
    let written = 0
    let error = ''
    while (entries.length > 0) {
      const head = entries[0]
      if (head === undefined) break
      try {
        options.write(head)
      } catch (failure) {
        // 这一条写不进去就整条留在队列里等下次，不丢也不改写成成功，积压由健康行的 pending 显出来
        error = failure instanceof Error ? failure.message : String(failure)
        break
      }
      entries.shift()
      written += 1
    }
    lastFlushedAt = now
    persist()
    return { written, kept: entries.length, error }
  }

  const reflect = (now: number): ReflectOutcome => {
    const window = pickWindow()
    // 没到点或不够条数时什么都不合成，也没被门槛丢掉，四项空着不算一次丢弃
    if (window === undefined) return { written: false, code: '', reason: '', hint: '', id: '', mergedFrom: [] }
    const draft = reflectionOf(window, now, tuning)
    // 合成条目重要度取原件最大值，通常过得去，这里仍判一次；不过门槛就原样留着原件
    const gate = importanceGate(draft.importance, tuning.writeMinImportance)
    if (!gate.written) {
      droppedLow += 1
      persist()
      return { ...gate, id: '', mergedFrom: [] }
    }
    options.store.add(draft)
    lastReflectedAt = now
    persist()
    return { ...gate, id: draft.id, mergedFrom: window.map(item => item.id) }
  }

  return {
    pending() {
      return entries.length
    },
    dropped() {
      return dropped
    },
    droppedLow() {
      return droppedLow
    },
    turns() {
      return turns
    },
    enqueue(text, chatKey, given = {}) {
      const body = text.trim()
      if (body === '') refuse('memory.empty', '空的一句入不了队', '写一件能独立读懂的事')
      if (body.length < tuning.minTextChars) refuse('memory.too_short', `短过 ${tuning.minTextChars} 字当噪声`, '写清一件事再入队')
      if (body.length > tuning.maxTextChars) refuse('memory.too_long', `一条最多 ${tuning.maxTextChars} 字`, '长事拆成几条再入队')
      // 重要度不够的新写入不占队列的位置：丢了几条记在 droppedLow 里，入队返回值与队列文件都看得见
      const gate = importanceGate(options.importanceOf(chatKey, given), tuning.writeMinImportance)
      if (!gate.written) {
        droppedLow += 1
        persist()
        return { ...gate, pending: entries.length, dropped }
      }
      entries.push({ text: body, chatKey, enqueuedAt: given.at ?? Date.now(), options: given })
      // 队列压满时先丢最旧的，丢了几条记在 dropped 里，健康一行与入队返回值都看得见
      while (entries.length > tuning.queueMax) {
        entries.shift()
        dropped += 1
      }
      persist()
      return { ...gate, pending: entries.length, dropped }
    },
    flush,
    reflect,
    advanceTurn(now) {
      turns += 1
      const due = (every: number): boolean => every > 0 && turns % every === 0
      // 队列空着就是刚排过：每日整理里已经排空，这一轮不再走一遍排空
      const written = due(tuning.flushEveryTurns) && entries.length > 0 ? flush(now).written : 0
      const reflected = due(tuning.reflectEveryTurns) ? reflect(now).id : ''
      persist()
      return { turns, written, reflected }
    },
  }
}
