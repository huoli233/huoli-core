// 分级判定：三类公共动作各自要什么，只认清单、钥匙与阶段

import { DEFAULTS } from './defaults.ts'
import { requireKeys } from './keys.ts'
import type { ActionKind, CommentFacts, GradeDecision, PostLevelFacts, PrivateFacts } from './types.ts'

/** 三类公共动作，别的写法一律不放行 */
export const ACTION_KINDS: readonly ActionKind[] = ['post', 'comment', 'private']

/** 社交动态接受的两个级别，别的级别一律不放行 */
export const POST_LEVELS: readonly string[] = ['routine', 'public']

// 公开动态在身份级清单里的名字，与清单里那一项逐字相同
const PUBLIC_ACTION = 'public.say'
// 公开评论在身份级清单里的名字，与清单里那一项逐字相同
const COMMENT_ACTION = 'public.comment'
// 私信在身份级清单里的名字，与清单里那一项逐字相同
const PRIVATE_ACTION = 'public.direct'

/**
 * 判一个阶段够不够做那一档动作
 * @param stage - 现在处在哪个阶段
 * @param minStage - 最早从哪个阶段开始
 * @param stages - 阶段的先后顺序
 * @returns 够为真，认不出的阶段按不到算
 */
export function stageAllows(stage: string, minStage: string, stages: readonly string[] = DEFAULTS.stages): boolean {
  const here = stages.indexOf(stage)
  const floor = stages.indexOf(minStage)
  if (here < 0 || floor < 0) return false
  return here >= floor
}

/**
 * 判一条动态按它报上来的级别能不能发
 * @param facts - 级别与两把钥匙
 * @returns 放行结论，没放行时带码与一句原因
 */
export function judgePostLevel(facts: PostLevelFacts): GradeDecision {
  if (!POST_LEVELS.includes(facts.level)) {
    return { ok: false, code: 'post.level', reason: '这一条还不到能公开的级别' }
  }
  if (facts.level === 'routine') {
    const topic = facts.topic ?? ''
    if (topic === '') return { ok: false, code: 'post.topic_required', reason: '例行动态要说清是哪一类话题' }
    if (!(facts.topics ?? []).includes(topic)) {
      return { ok: false, code: 'post.not_routine', reason: '这个话题不在预授权清单里' }
    }
    return { ok: true }
  }
  const decision = requireKeys(PUBLIC_ACTION, facts.userOk, facts.selfOk, facts.actions)
  if (decision.allowed) return { ok: true }
  const reason = decision.reason === 'unknown_action' ? '公开这句话不在身份级清单里' : '公开这条要两把钥匙同时点头'
  return { ok: false, code: 'post.needs_keys', reason }
}

/**
 * 判一条公开评论能不能发
 * @param facts - 话题、预授权清单与两把钥匙
 * @returns 放行结论，没放行时带码与一句原因
 */
export function judgeComment(facts: CommentFacts): GradeDecision {
  const decision = requireKeys(COMMENT_ACTION, facts.userOk, facts.selfOk, facts.actions)
  if (!decision.allowed) {
    const reason = decision.reason === 'unknown_action' ? '公开评论不在身份级清单里' : '公开评论要两把钥匙同时点头'
    return { ok: false, code: 'comment.needs_keys', reason }
  }
  const topic = facts.topic ?? ''
  if (topic === '') return { ok: false, code: 'comment.topic_required', reason: '评论要说清挂在哪一类话题上' }
  if (!facts.topics.includes(topic)) {
    return { ok: false, code: 'comment.topic_not_allowed', reason: '这个话题不在预授权清单里' }
  }
  return { ok: true }
}

/**
 * 判一条私信能不能发
 * @param facts - 对象、允许名单、阶段与两把钥匙
 * @returns 放行结论，没放行时带码与一句原因
 */
export function judgePrivate(facts: PrivateFacts): GradeDecision {
  const stage = facts.stage ?? DEFAULTS.stage
  const minStage = facts.minStage ?? DEFAULTS.privateMinStage
  // 阶段不够时连钥匙都不看：这一档在最前面的几个阶段一律禁止
  if (!stageAllows(stage, minStage, facts.stages ?? DEFAULTS.stages)) {
    return { ok: false, code: 'private.stage_blocked', reason: `现在这个阶段（${stage}）还不许发私信` }
  }
  const peer = facts.peer ?? ''
  if (peer === '') return { ok: false, code: 'private.peer_required', reason: '私信要说清写给谁' }
  if (!facts.allowPeers.includes(peer)) {
    return { ok: false, code: 'private.peer_not_allowed', reason: '这个对象不在允许私信的名单里' }
  }
  const decision = requireKeys(PRIVATE_ACTION, facts.userOk, facts.selfOk, facts.actions)
  if (!decision.allowed) {
    const reason = decision.reason === 'unknown_action' ? '私信不在身份级清单里' : '发私信要两把钥匙同时点头'
    return { ok: false, code: 'private.needs_keys', reason }
  }
  return { ok: true }
}
