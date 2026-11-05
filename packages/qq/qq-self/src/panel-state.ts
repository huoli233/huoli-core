// 只读出口的内容：只从目录、两档账与身体的展示读数算，用户原文、记忆正文与钥匙记录一律不读

import { weeklyReview } from './review.ts'
import type { SelfStore } from './store.ts'
import type { LedgerSummary, PanelState, PanelVitals, SelfSettings } from './types.ts'

/** 算一份只读出口内容要用的东西 */
export interface PanelStateInput {
  /** 目录读写口 */
  store: SelfStore
  /** 参数表 */
  settings: SelfSettings
  /** 算汇总的时刻 */
  now: number
  /** 面板正文，还没生成时为空串 */
  panel: string
  /** 面板首行记的生成时间，还没生成时为空串 */
  generatedAt: string
  /** 两档账，由记录表自己算好递进来，两档从不相加 */
  ledger: LedgerSummary
  /** 画条要用的那几个数，没接上身体时不给 */
  vitals?: PanelVitals
}

// 健康那一行：只把数得出来的事实摆成一句，永远只有一行
function healthLineOf(wrote: number, skipped: number, missing: number, errors: number, ledger: LedgerSummary): string {
  const head = `健康：近七天写了 ${wrote} 天、跳过 ${skipped} 天、缺 ${missing} 天`
  return `${head}，错处 ${errors} 条，账本 drive ${ledger.drive} 条 / agency ${ledger.agency} 条`
}

/**
 * 算一份只读出口的内容
 * @param input - 目录、参数、时刻、面板那两份已知值与身体的展示读数
 * @returns 面板、身体读数、身份主张、两档账、近七天三行与健康一行
 */
export function panelStateOf(input: PanelStateInput): PanelState {
  const review = weeklyReview({ store: input.store, settings: input.settings, now: input.now, ledger: input.ledger })
  const wrote = review.days.filter(row => !row.skipped).length
  const identity = review.identity
  return {
    panel: { body: input.panel, generatedAt: input.generatedAt },
    ...input.vitals === undefined ? {} : { vitals: input.vitals },
    ...identity === undefined ? {} : { identity: { claim: identity.claim, why: identity.why, at: identity.at } },
    ledger: review.ledger,
    days: review.days.map(row => ({ at: row.at, lines: row.lines, skipped: row.skipped })),
    health: healthLineOf(wrote, review.days.length - wrote, review.missingDays, review.errors.length, review.ledger),
  }
}
