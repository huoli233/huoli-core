// 两把钥匙：用户那把与她自己那把都要在，动作名还要逐字对上清单

import { DEFAULTS } from './defaults.ts'
import { FILES } from './files.ts'
import type { SelfStore } from './store.ts'
import type { KeysDecision } from './types.ts'

/** 抬阶段要的那一条留痕在 keys.jsonl 里的动作名 */
export const STAGE_ACTION = 'stage.advance'

/** 同一个身份级动作两次之间至少隔这么久，默认三十分钟 */
export const IDENTITY_COOLDOWN_MS = 30 * 60_000

/**
 * 同一个身份级动作还在冷却里吗
 * @param store - 目录读写口
 * @param action - 要做的那个动作，与账里逐字相同才算同一次
 * @param at - 这一次的时刻
 * @param windowMs - 冷却窗口
 * @returns 仍在冷却时给还剩多少毫秒，不在冷却给零
 */
export function identityCooldownLeft(
  store: SelfStore,
  action: string,
  at: number,
  windowMs: number = IDENTITY_COOLDOWN_MS,
): number {
  const rows = store.records(FILES.keys)
  // 从最后一条往前找同一个动作：中间夹着的别的动作不重置这一格的冷却
  for (let idx = rows.length - 1; idx >= 0; idx -= 1) {
    const row = rows[idx]
    if (row === undefined || row.action !== action) continue
    const taken = row.at
    if (typeof taken !== 'number' || !Number.isFinite(taken)) return 0
    const since = at - taken
    return since >= windowMs ? 0 : windowMs - since
  }
  return 0
}

/**
 * 判一次身份级动作能不能做
 * @param action - 要做的那个动作，与清单逐字相同才算数
 * @param userOk - 用户那把钥匙
 * @param selfOk - 她自己那把钥匙
 * @param actions - 身份级动作清单
 * @returns 放行结果，没放行时带原因
 */
export function requireKeys(
  action: string,
  userOk: boolean,
  selfOk: boolean,
  actions: readonly string[] = DEFAULTS.identityActions,
): KeysDecision {
  if (!actions.includes(action)) return { allowed: false, reason: 'unknown_action' }
  if (!userOk) return { allowed: false, reason: 'user_key' }
  if (!selfOk) return { allowed: false, reason: 'self_key' }
  return { allowed: true }
}

/**
 * 最近一条抬级放行是不是两把钥匙都点头
 * @param store - 目录读写口
 * @returns 最后一条 action 为 stage.advance 的记录两格都为真才算有；一条都没有为假
 */
export function stageAdvanceApproved(store: SelfStore): boolean {
  const rows = store.records(FILES.keys)
  // 只认最近一条：后来被一把钥匙否掉的那次就该盖住先前放行的那次
  for (let idx = rows.length - 1; idx >= 0; idx -= 1) {
    const row = rows[idx]
    if (row === undefined || row.action !== STAGE_ACTION) continue
    return row.user_ok === true && row.self_ok === true
  }
  return false
}
