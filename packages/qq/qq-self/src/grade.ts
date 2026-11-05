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

// 三类动作在拒绝话里的叫法，只给人读，不参与判断
const KIND_LABELS: Readonly<Record<ActionKind, string>> = {
  post: '公开动态',
  comment: '公开评论',
  private: '私信',
}

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

// 阶段不够时别的事实一律不看：只回码、当前与所需阶段，以及怎么推进
function stageBlocked(kind: ActionKind, stage: string, minStage: string): GradeDecision {
  return {
    ok: false,
    code: `${kind}.stage_blocked`,
    reason: `现在处在 ${stage}，当前阶段只读，${KIND_LABELS[kind]}要等阶段推到 ${minStage}`,
    hint: `等阶段推到 ${minStage} 再说：这一步由人按顺序推进，跳级与后退都不算`,
  }
}

/**
 * 判一条动态按它报上来的级别能不能发
 * @param facts - 阶段、级别与两把钥匙
 * @returns 放行结论，没放行时带码与一句原因
 */
export function judgePostLevel(facts: PostLevelFacts): GradeDecision {
  const stage = facts.stage ?? DEFAULTS.stage
  const minStage = facts.minStage ?? DEFAULTS.publicMinStage
  if (!stageAllows(stage, minStage, facts.stages ?? DEFAULTS.stages)) return stageBlocked('post', stage, minStage)
  if (!POST_LEVELS.includes(facts.level)) {
    return { ok: false, code: 'post.level', reason: '这一条还不到能公开的级别', hint: '按 routine 或 public 报上来再来一次' }
  }
  if (facts.level === 'routine') {
    const topic = facts.topic ?? ''
    if (topic === '') {
      return { ok: false, code: 'post.topic_required', reason: '例行动态要说清是哪一类话题', hint: '从预授权清单里挑一个话题名带上' }
    }
    if (!(facts.topics ?? []).includes(topic)) {
      return { ok: false, code: 'post.not_routine', reason: '这个话题不在预授权清单里', hint: '换一个清单内的话题，或改成 public 走两把钥匙' }
    }
    return { ok: true }
  }
  const decision = requireKeys(PUBLIC_ACTION, facts.userOk, facts.selfOk, facts.actions)
  if (decision.allowed) return { ok: true }
  const reason = decision.reason === 'unknown_action' ? '公开这句话不在身份级清单里' : '公开这条要两把钥匙同时点头'
  return { ok: false, code: 'post.needs_keys', reason, hint: '让用户与她各点一次头，缺哪把补哪把' }
}

/**
 * 判一条公开评论能不能发
 * @param facts - 阶段、话题、预授权清单与两把钥匙
 * @returns 放行结论，没放行时带码与一句原因
 */
export function judgeComment(facts: CommentFacts): GradeDecision {
  const stage = facts.stage ?? DEFAULTS.stage
  const minStage = facts.minStage ?? DEFAULTS.publicMinStage
  if (!stageAllows(stage, minStage, facts.stages ?? DEFAULTS.stages)) return stageBlocked('comment', stage, minStage)
  const decision = requireKeys(COMMENT_ACTION, facts.userOk, facts.selfOk, facts.actions)
  if (!decision.allowed) {
    const reason = decision.reason === 'unknown_action' ? '公开评论不在身份级清单里' : '公开评论要两把钥匙同时点头'
    return { ok: false, code: 'comment.needs_keys', reason, hint: '让用户与她各点一次头，缺哪把补哪把' }
  }
  const topic = facts.topic ?? ''
  if (topic === '') {
    return { ok: false, code: 'comment.topic_required', reason: '评论要说清挂在哪一类话题上', hint: '带上预授权清单里的话题名' }
  }
  if (!facts.topics.includes(topic)) {
    return { ok: false, code: 'comment.topic_not_allowed', reason: '这个话题不在预授权清单里', hint: '换一个清单内的话题，或先把这一类加进预授权' }
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
  if (!stageAllows(stage, minStage, facts.stages ?? DEFAULTS.stages)) return stageBlocked('private', stage, minStage)
  const peer = facts.peer ?? ''
  if (peer === '') {
    return { ok: false, code: 'private.peer_required', reason: '私信要说清写给谁', hint: '把对象编号带上再来一次' }
  }
  if (!facts.allowPeers.includes(peer)) {
    return { ok: false, code: 'private.peer_not_allowed', reason: '这个对象不在允许私信的名单里', hint: '换名单里的对象，或请人把对方加进允许名单' }
  }
  const decision = requireKeys(PRIVATE_ACTION, facts.userOk, facts.selfOk, facts.actions)
  if (!decision.allowed) {
    const reason = decision.reason === 'unknown_action' ? '私信不在身份级清单里' : '发私信要两把钥匙同时点头'
    return { ok: false, code: 'private.needs_keys', reason, hint: '让用户与她各点一次头，缺哪把补哪把' }
  }
  return { ok: true }
}
