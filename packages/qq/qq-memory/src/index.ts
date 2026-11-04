// 记忆装配入口：两个工具 + 往上挪 + 每天变淡 + 每天的账与健康一行

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { initialImportance, type ImportanceInput } from '@huoli/huoli-qq-policy'
import { createMemoryStore, type MemoryStore } from './store.ts'
import { decayAll, promoteAll, sweepOnce } from './sweep.ts'
import { recall, type RecallHit } from './recall.ts'
import { registerMemoryTools } from './tools.ts'
import { resolveTuning, type Tuning } from './defaults.ts'
import { defaultLedgerFile, runLedger, type LedgerAction, type LedgerRunResult } from './ledger.ts'
import { appendHealthLine, defaultHealthLogFile, healthLine, localDay } from './health.ts'
import { clampImportance, metadataOr, sourceOr } from './guard.ts'
import {
  createWriteQueue,
  defaultQueueFile,
  LOW_IMPORTANCE,
  writeFact,
  type EnqueueOutcome,
  type FlushOutcome,
  type ReflectOutcome,
  type TurnOutcome,
  type WriteOutcome,
} from './write.ts'
import {
  CLARITY_LABEL,
  LAYER_LABEL,
  newId,
  type MemoryItem,
  type MemoryLayer,
  type RememberOptions,
  type RememberSelfEntry,
  type RememberSelfResult,
} from './types.ts'

export type {
  MemoryItem,
  MemoryLayer,
  MemorySource,
  MirrorSelfKind,
  RememberOptions,
  RememberSelfEntry,
  RememberSelfResult,
} from './types.ts'
export { CLARITY_LABEL, LAYER_LABEL, LAYER_ORDER, MEMORY_SOURCES } from './types.ts'
export type { MemoryStore, MemoryStoreOptions, MemoryStoreState } from './store.ts'
export type { RecallHit, RecallInput, RecallReasons } from './recall.ts'
export { cosineSimilarity, encodeVector, keyGrams, recall, renderRecall } from './recall.ts'
export { buildInjectBlock, injectIntoUserText, shouldInject } from './inject.ts'
export { decayAll, promoteAll, sweepOnce, touch } from './sweep.ts'
export { DEFAULTS, resolveTuning } from './defaults.ts'
export type { AlertThresholds, Tuning } from './defaults.ts'
export {
  defaultLedgerFile,
  describeLedger,
  emptyBook,
  fingerprint,
  initBook,
  runLedger,
  syncBook,
  verifyBook,
} from './ledger.ts'
export { LEDGER_SCHEMA_VERSION } from './ledger.ts'
export type {
  Fingerprint,
  LedgerAction,
  LedgerBook,
  LedgerChange,
  LedgerEntry,
  LedgerEntryState,
  LedgerReadStatus,
  LedgerReport,
  LedgerRunOptions,
  LedgerRunResult,
} from './ledger.ts'
export { appendHealthLine, defaultHealthLogFile, healthAlerts, healthCounts, healthLine, ledgerLevel, localDay } from './health.ts'
export type { HealthAlert, HealthCounts, HealthInput, LedgerLevel } from './health.ts'
export { createWriteQueue, defaultQueueFile, importanceGate, LOW_IMPORTANCE, nearDuplicateOf, writeFact } from './write.ts'
export type {
  EnqueueOutcome,
  FlushOutcome,
  NearDuplicate,
  QueuedFact,
  ReflectOutcome,
  TurnOutcome,
  WriteGate,
  WriteOutcome,
  WriteQueue,
  WriteQueueOptions,
} from './write.ts'

/** 每天跑完一遍之后的交代 */
export interface MaintainResult {
  /** 这次是不是真的做了：同一天再调就是 false，什么都不碰 */
  didWork: boolean
  /** 整理日，本地日期；这次没做时就是前面那次记下的那一天 */
  lastMaintainedDay: string
  /** 这次之前记下的整理日，从没整理过是空串 */
  previousMaintainedDay: string
  /** 这次掉了分的条数 */
  decayed: number
  /** 这次降了一档的条数 */
  stepped: number
  /** 这次淡到底的条数 */
  forgotten: number
  /** 这次新入账的条数 */
  added: number
  /** 当天那行健康记录；这次没真的做时是空串 */
  line: string
}

/** 一个应用里的记忆仓 */
export interface QqMemorySeam {
  store: MemoryStore
  remember(text: string, chatKey: string, options?: RememberOptions): MemoryItem
  /** 写一条：与同 scope 的旧条够像就并进旧条，返回里 merged 说明走了哪条路 */
  write(text: string, chatKey: string, options?: RememberOptions): WriteOutcome
  /** 只做轻校验就进队列，不写库；排空时才真正写进去 */
  enqueue(text: string, chatKey: string, options?: RememberOptions): EnqueueOutcome
  /** 把队列里的写进记忆，写不进去的留在队列里 */
  flushQueue(now: number): FlushOutcome
  /** 把最近几条同类内容合成一条长期印象 */
  reflect(now: number): ReflectOutcome
  /** 一轮过去：到点就排空与反思 */
  tick(now: number): TurnOutcome
  /** 已入队还没写进去的条数 */
  pending(): number
  /** 累计丢掉的最旧条数 */
  dropped(): number
  /** 累计因重要度不到门槛而丢掉的条数，入队、直接写入与反思三条路径合在一起 */
  droppedLow(): number
  /** 自我层镜像一条：只加来源与重要度下限，别处照 remember */
  rememberSelf(entry: RememberSelfEntry, at: number): RememberSelfResult
  /** 已经镜过的来源键，按镜像顺序 */
  mirroredSelfIds(): readonly string[]
  find(query: string, chatKey: string, limit?: number): RecallHit[]
  promote(): number
  sweep(): { stepped: number; forgotten: number }
  maintain(now: number): MaintainResult
  ledger(action: LedgerAction): LedgerRunResult
  outline(chatKey: string): string
}

/** 这一行接受的配置 */
export interface Config {
  /** 记忆存哪，不填就用主目录下的 data */
  file?: string
  /** 账本存哪，不填就用主目录下的 data */
  ledgerFile?: string
  /** 健康日志存哪，不填就用主目录下的 data */
  healthLogFile?: string
  /** 待写队列存哪，不填就用主目录下的 data */
  queueFile?: string
  /** 覆盖主目录，不填按 HUOLI_HOME 定 */
  home?: string
  /** 想改哪些默认参数 */
  tuning?: Partial<Tuning>
}

const seams = new WeakMap<Context, QqMemorySeam>()

/**
 * 取记忆仓，未装配时为 undefined
 * @param ctx - 运行环境
 * @returns 处理结果
 */
export function qqMemoryOf(ctx: Context): QqMemorySeam | undefined {
  return seams.get(ctx.root) ?? seams.get(ctx)
}

/** 插件的行名 */
export const name = 'qq-memory'

/** 要用的内核接口 */
export const inject = ['tools']

/**
 * 一条记忆的镜像来源键
 * @param item - 一条记忆
 * @returns 不是镜像条目时是空串
 */
export function selfIdOf(item: MemoryItem): string {
  const value = item.metadata?.self_id
  return typeof value === 'string' ? value : ''
}

/**
 * 已经镜像过的来源键，按写入顺序排
 * @param store - 存放的地方
 * @returns 来源键，镜像条目以外的都不算
 */
export function mirroredSelfIds(store: MemoryStore): string[] {
  const ids: string[] = []
  for (const item of store.all()) {
    if (item.source !== 'self') continue
    const selfId = selfIdOf(item)
    if (selfId !== '') ids.push(selfId)
  }
  return ids
}

/**
 * 某个来源键已经写成的那一条
 * @param store - 存放的地方
 * @param selfId - 来源键
 * @returns 没镜过时为 undefined
 */
export function mirroredBy(store: MemoryStore, selfId: string): MemoryItem | undefined {
  return store.all().find(item => item.source === 'self' && selfIdOf(item) === selfId)
}

// 私下聊的记在私下，群里说的记在群里
function sceneOf(layer: MemoryLayer, chatKey: string): ImportanceInput['scene'] {
  if (layer === 'private' || chatKey.startsWith('private:')) return 'private'
  return 'group'
}

/**
 * 装配记忆仓与两个工具
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const tuning = resolveTuning(config.tuning)
  const file = config.file ?? path.join(resolveHuoliHome(config.home), 'data', 'qq-memory.json')
  const ledgerFile = config.ledgerFile ?? defaultLedgerFile(config.home)
  const healthLogFile = config.healthLogFile ?? defaultHealthLogFile(config.home)
  const queueFile = config.queueFile ?? defaultQueueFile(config.home)
  const store = createMemoryStore({ file })
  const scopeOf = (chatKey: string): string => chatKey
  const run = (action: LedgerAction): LedgerRunResult => runLedger(action, { file: ledgerFile, items: store.all() })
  // 直接写入被门槛丢掉的条数；队列与反思那两条路的数落在队列文件里，droppedLow() 把两边合起来给
  let droppedLow = 0

  // 一条待写写到库里会是多少重要度：入队门槛与拼条目共用这一处，两处不会算出两个数
  const importanceOf = (chatKey: string, options: RememberOptions): number => {
    if (options.importance !== undefined) return options.importance
    const layer = options.layer ?? 'episodic'
    return initialImportance({
      scene: sceneOf(layer, chatKey),
      directed: options.directed ?? false,
      emotional: options.emotional ?? 0,
    })
  }

  // 拼一条待写的记忆，显式路径与排空路径共用这一处，字段不会两处对不上
  const itemOf = (text: string, chatKey: string, options: RememberOptions, at: number): MemoryItem => {
    const layer = options.layer ?? 'episodic'
    const emotional = options.emotional ?? 0
    const metadata = metadataOr(options.metadata)
    return {
      id: newId(at),
      text,
      layer,
      scope: scopeOf(chatKey),
      importance: importanceOf(chatKey, options),
      emotional,
      clarity: 'vivid',
      recallCount: 0,
      recoverDay: 0,
      recoverTimes: 0,
      at,
      lastSeenAt: at,
      state: 'active',
      source: sourceOr(options.source, 'chat'),
      ...metadata === undefined ? {} : { metadata },
    }
  }

  const queue = createWriteQueue({
    file: queueFile,
    tuning,
    store,
    importanceOf,
    // 排空写的都是聊天里攒下的事实，来源没点名就按聊天记，其余几项照入队时给的
    write(fact) {
      writeFact(store, itemOf(fact.text, fact.chatKey, fact.options, fact.enqueuedAt), tuning)
    },
  })

  const seam: QqMemorySeam = {
    store,
    remember(text, chatKey, options = {}) {
      const item = itemOf(text, chatKey, options, options.at ?? Date.now())
      store.add(item)
      return item
    },
    write(text, chatKey, options = {}) {
      const outcome = writeFact(store, itemOf(text, chatKey, options, options.at ?? Date.now()), tuning)
      if (outcome.code === LOW_IMPORTANCE) droppedLow += 1
      return outcome
    },
    enqueue(text, chatKey, options) {
      return queue.enqueue(text, chatKey, options)
    },
    flushQueue(now) {
      return queue.flush(now)
    },
    reflect(now) {
      return queue.reflect(now)
    },
    tick(now) {
      return queue.advanceTurn(now)
    },
    pending() {
      return queue.pending()
    },
    dropped() {
      return queue.dropped()
    },
    droppedLow() {
      return queue.droppedLow() + droppedLow
    },
    rememberSelf(entry, at) {
      const selfId = entry.selfId.trim()
      const evidence = entry.evidence.map(item => item.trim()).filter(item => item !== '')
      if (selfId === '' || evidence.length === 0) {
        throw new Error('memory.mirror_incomplete: 镜像要带来源键与证据｜下一步: 补齐这两项再写')
      }
      // 同一个来源键只写一条，重复调用拿回原来那条
      const kept = mirroredBy(store, selfId)
      if (kept !== undefined) return { id: kept.id, created: false, item: kept }
      const item: MemoryItem = {
        id: newId(at),
        text: entry.text,
        layer: 'semantic',
        scope: scopeOf(entry.chatKey),
        importance: Math.max(tuning.selfImportanceFloor, clampImportance(entry.importance, tuning.selfImportanceFloor)),
        emotional: 0,
        clarity: 'vivid',
        recallCount: 0,
        recoverDay: 0,
        recoverTimes: 0,
        at,
        lastSeenAt: at,
        state: 'active',
        source: 'self',
        metadata: {
          self_id: selfId,
          self_kind: entry.selfKind,
          evidence,
          mirrored_at: new Date(at).toISOString(),
        },
      }
      store.add(item)
      return { id: item.id, created: true, item }
    },
    mirroredSelfIds() {
      return mirroredSelfIds(store)
    },
    find(query, chatKey, limit) {
      return recall(store, {
        query,
        scope: scopeOf(chatKey),
        tuning,
        ...limit !== undefined ? { limit } : {},
      })
    },
    promote() {
      return promoteAll(store, Date.now())
    },
    sweep() {
      return sweepOnce(store, Date.now())
    },
    maintain(now) {
      const day = localDay(now)
      const previous = store.state().lastMaintainedDay
      // 一天只整理一次：同一天再调就什么都不碰，不衰减、不清理、不补账，也不出第二行
      if (previous === day) {
        return {
          didWork: false,
          lastMaintainedDay: previous,
          previousMaintainedDay: previous,
          decayed: 0,
          stepped: 0,
          forgotten: 0,
          added: 0,
          line: '',
        }
      }
      // 排空在衰减之前：这一轮攒下的事先落库，健康一行的 pending 才是排空之后的真实积压
      queue.flush(now)
      // 先掉重要度，再按新的重要度算清晰度，最后才清正文
      const decayed = decayAll(store, tuning)
      const swept = sweepOnce(store, now)
      // 补账在退役之后，账本才记得住这次退的是哪条
      const synced = run('sync')
      const line = healthLine({
        items: store.all(),
        now,
        injectMaxChars: tuning.injectMaxChars,
        protectLine: tuning.protectLine,
        ledger: synced.report,
        pending: queue.pending(),
        thresholds: tuning,
      })
      // 整理日先记账再写日志：写日志失手时这一天不会因为重跑而多衰减一次
      store.setState({ lastMaintainedDay: day })
      if (tuning.healthLog) appendHealthLine(healthLogFile, line)
      return {
        didWork: true,
        lastMaintainedDay: day,
        previousMaintainedDay: previous,
        decayed,
        stepped: swept.stepped,
        forgotten: swept.forgotten,
        added: synced.added.length,
        line,
      }
    },
    ledger(action) {
      return run(action)
    },
    outline(chatKey) {
      const items = store.all().filter(item => item.state !== 'forgotten' && item.scope === scopeOf(chatKey))
      if (items.length === 0) return '还没有记下什么。'
      const lines = items
        .slice(-8)
        .map(item => `- ${new Date(item.at).toISOString().slice(0, 10)} [${CLARITY_LABEL[item.clarity]}] ${item.text}`)
      const byLayer = new Map<string, number>()
      for (const item of items) byLayer.set(LAYER_LABEL[item.layer], (byLayer.get(LAYER_LABEL[item.layer]) ?? 0) + 1)
      const summary = [...byLayer.entries()].map(([label, count]) => `${label} ${count} 条`).join('，')
      return `记下了 ${items.length} 条（${summary}）\n${lines.join('\n')}`
    },
  }
  seams.set(ctx.root, seam)

  registerMemoryTools(ctx, { store, scopeOf, sceneOf, tuning })

  // 卸载时排空队列再落一次盘，攒着的那几条不会跟着进程一起没
  ctx.effect(() => () => {
    queue.flush(Date.now())
    store.flush()
    seams.delete(ctx.root)
  })
}
