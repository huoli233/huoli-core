// 分级判定：一条动态按它报上来的级别要什么，只认两张级别与两把钥匙

import { requireKeys } from './keys.ts'
import type { GradeDecision, PostLevelFacts } from './types.ts'

/** 社交动态接受的两个级别，别的级别一律不放行 */
export const POST_LEVELS: readonly string[] = ['routine', 'public']

// 公开动态在身份级清单里的名字，与清单里那一项逐字相同
const PUBLIC_ACTION = 'public.say'

/**
 * 判一条动态按它报上来的级别能不能发
 * @param facts - 级别与两把钥匙
 * @returns 放行结论，没放行时带码与一句原因
 */
export function judgePostLevel(facts: PostLevelFacts): GradeDecision {
  if (!POST_LEVELS.includes(facts.level)) {
    return { ok: false, code: 'post.level', reason: '这一条还不到能公开的级别' }
  }
  if (facts.level === 'routine') return { ok: true }
  const decision = requireKeys(PUBLIC_ACTION, facts.userOk, facts.selfOk, facts.actions)
  if (decision.allowed) return { ok: true }
  const reason = decision.reason === 'unknown_action' ? '公开这句话不在身份级清单里' : '公开这条要两把钥匙同时点头'
  return { ok: false, code: 'post.needs_keys', reason }
}
