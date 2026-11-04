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
import { mirroredBy, mirroredSelfIds } from './mirror.ts'
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
export { mirroredBy, mirroredSelfIds, selfIdOf } from './mirror.ts'
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
  return seams.get(ctx)
}

/** 插件的行名 */
export const name = 'qq-memory'

/** 要用的内核接口 */
export const inject = ['tools']

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
  const store = createMemoryStore({ file })
  const scopeOf = (chatKey: string): string => chatKey
  const run = (action: LedgerAction): LedgerRunResult => runLedger(action, { file: ledgerFile, items: store.all() })

  const seam: QqMemorySeam = {
    store,
    remember(text, chatKey, options = {}) {
      const at = options.at ?? Date.now()
      const layer = options.layer ?? 'episodic'
      const emotional = options.emotional ?? 0
      const metadata = metadataOr(options.metadata)
      const item: MemoryItem = {
        id: newId(at),
        text,
        layer,
        scope: scopeOf(chatKey),
        importance: options.importance ?? initialImportance({
          scene: sceneOf(layer, chatKey),
          directed: options.directed ?? false,
          emotional,
        }),
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
      store.add(item)
      return item
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
  seams.set(ctx, seam)

  registerMemoryTools(ctx, { store, scopeOf, sceneOf, tuning })

  // 卸载时落一次盘
  ctx.effect(() => () => {
    store.flush()
    seams.delete(ctx)
  })
}
