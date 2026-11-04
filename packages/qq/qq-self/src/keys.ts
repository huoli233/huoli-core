// 两把钥匙：用户那把与她自己那把都要在，动作名还要逐字对上清单

import { DEFAULTS } from './defaults.ts'
import type { KeysDecision } from './types.ts'

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
