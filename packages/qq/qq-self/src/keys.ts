// 两把钥匙：用户那把与她自己那把都要在，动作名还要逐字对上清单

import { DEFAULTS } from './defaults.ts'
import { FILES } from './files.ts'
import type { SelfStore } from './store.ts'
import type { KeysDecision } from './types.ts'

/** 抬阶段要的那一条留痕在 keys.jsonl 里的动作名 */
export const STAGE_ACTION = 'stage.advance'

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
