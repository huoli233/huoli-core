// 三类公共动作共用的入口：先判阶段与分级，再过确认、去重、冷却与额度，最后仍走出站体检

import { createHash } from 'node:crypto'
import { DEFAULTS, judgeComment, judgePostLevel, judgePrivate, type ActionKind, type GradeDecision } from '@huoli/huoli-qq-self'
import { ACTION_STATE_VERSION, emptyActionState, type ActionKindState, type ActionState, type ActionStore, type PendingAction } from './action-store.ts'
import type { ActionDelivery, ActionFacts, ActionGate, ActionResult, ActionTunings } from './actions.ts'
import type { OutboundCheck } from './outbound.ts'

/** 建入口要用到的东西 */
export interface ActionGateOptions {
  /** 三类动作各一套参数 */
  tunings: ActionTunings
  /** 待确认项多久失效 */
  confirmTtlMs: number
  /** 预授权话题清单，评论要落在里面 */
  topics: readonly string[]
  /** 允许私信的对象 */
  allowPeers: readonly string[]
  /** 公开动态与公开评论最早从哪个阶段开始 */
  publicMinStage: string
  /** 私信最早从哪个阶段开始 */
  privateMinStage: string
  /** 状态在哪 */
  store: ActionStore
  /** 出站体检，发送前仍要过一遍 */
  outbound: OutboundCheck
  /** 真把一段正文送出去 */
  send: (text: string, chatKey: string) => Promise<ActionDelivery>
  /** 停手开关，为真时一条都不发 */
  paused?: () => boolean
  /** 自我层现在的阶段，没接上就按自我层默认值表里最保守的一档 */
  stage?: () => string | undefined
  /** 现在几点，用例里换成固定时钟 */
  now?: () => number
}

// 正文的指纹：原文不落盘，只留摘要，摘要算法固定不随配置改
function fingerprintOf(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

// 这一天从哪个零点算起
function startOfDay(at: number): number {
  const date = new Date(at)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function startOfNextDay(at: number): number {
  const date = new Date(at)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
}

// 拒绝只回码、原因与下次时刻，不改写正文
function refuse(code: string, reason: string, hint: string, retryAt: number): ActionResult {
  return { ok: false, code, reason, hint, retryAt }
}

// 日界换过就把当天条数清零，上次时刻与指纹表照旧
function today(slot: ActionKindState, dayStart: number): ActionKindState {
  if (slot.dayStart === dayStart) return slot
  return { dayStart, dayCount: 0, lastAt: slot.lastAt, fingerprints: slot.fingerprints }
}

// 过期的待确认项一读完就划掉，后面所有判断都不再看得见它们
function prune(state: ActionState, at: number): ActionState {
  const kept = state.pending.filter(entry => entry.expiresAt > at)
  if (kept.length === state.pending.length) return state
  return { ...state, pending: kept }
}

// 换掉一格动作的状态，另外两格原样带着
function withKind(
  kinds: Readonly<Record<ActionKind, ActionKindState>>,
  kind: ActionKind,
  slot: ActionKindState,
): Record<ActionKind, ActionKindState> {
  return { ...kinds, [kind]: slot }
}

/**
 * 建一个三类动作共用的入口
 * @param options - 参数、状态、体检与发送
 * @returns 动作入口
 */
export function createActionGate(options: ActionGateOptions): ActionGate {
  const { tunings, confirmTtlMs, topics, allowPeers, publicMinStage, privateMinStage, store, outbound, send } = options
  const now = options.now ?? (() => Date.now())
  const paused = options.paused ?? (() => false)
  // 阶段取不到就按默认值表里那一档，也就是最保守的 P0
  const stageNow = (): string => options.stage?.() ?? DEFAULTS.stage

  // 判级只问自我层的纯函数，这里不自己算该不该发
  const gradeOf = (kind: ActionKind, facts: ActionFacts): GradeDecision => {
    switch (kind) {
      case 'post':
        return judgePostLevel({
          level: facts.level ?? '',
          ...facts.topic === undefined ? {} : { topic: facts.topic },
          topics,
          userOk: facts.userOk === true,
          selfOk: facts.selfOk === true,
          stage: stageNow(),
          minStage: publicMinStage,
        })
      case 'comment':
        return judgeComment({
          ...facts.topic === undefined ? {} : { topic: facts.topic },
          topics,
          userOk: facts.userOk === true,
          selfOk: facts.selfOk === true,
          stage: stageNow(),
          minStage: publicMinStage,
        })
      case 'private':
        return judgePrivate({
          ...facts.peer === undefined ? {} : { peer: facts.peer },
          allowPeers,
          userOk: facts.userOk === true,
          selfOk: facts.selfOk === true,
          stage: stageNow(),
          minStage: privateMinStage,
        })
    }
  }

  return {
    async publish(kind, text, facts) {
      const at = now()
      const body = text.trim()
      if (body === '') return refuse(`${kind}.empty`, '没有要发的正文', '想发就写点东西', at)
      const tuning = tunings[kind]
      const graded = gradeOf(kind, facts)
      if (!graded.ok) {
        const hint = graded.hint ?? '换个写法，或者先把该有的许可拿到'
        return refuse(graded.code ?? `${kind}.level`, graded.reason ?? '这一条不能发', hint, at)
      }
      if (paused()) return refuse(`${kind}.paused`, '现在停着手', '等人把停手开关拿掉再说', at)

      const inspection = outbound.check({ chatKey: facts.chatKey, text: body })
      if (!inspection.ok) {
        return refuse(inspection.code ?? 'outbound.blocked', inspection.reason ?? '现在不能发', inspection.hint ?? '过一会儿再发', inspection.retryAt ?? at + tuning.coolDownMs)
      }

      const dayStart = startOfDay(at)
      const state = prune(store.read() ?? emptyActionState(dayStart), at)
      const sha = fingerprintOf(body)
      // 要确认的那两种动作，只认同一段正文下已经点过头的票
      const ticket = tuning.confirmRequired
        ? state.pending.find(entry => entry.action === kind && entry.sha === sha && entry.confirmedAt !== undefined)
        : undefined
      if (tuning.confirmRequired && ticket === undefined) {
        return refuse(`${kind}.needs_confirm`, '这一段还没过一次确认', '先要一次确认，点头之后再发', at)
      }
      const slot = today(state.kinds[kind], dayStart)
      const seen = slot.fingerprints.find(entry => entry.sha === sha)
      if (seen !== undefined && at - seen.at < tuning.repeatWindowMs) {
        return refuse(`${kind}.duplicate`, '这段正文刚做过', '过一阵再说，或者换一种说法', seen.at + tuning.repeatWindowMs)
      }
      if (slot.lastAt > 0 && at - slot.lastAt < tuning.coolDownMs) {
        return refuse(`${kind}.cooling`, '上一次同类动作还不久', '等冷却过去再发', slot.lastAt + tuning.coolDownMs)
      }
      if (slot.dayCount >= tuning.dailyMax) {
        return refuse(`${kind}.day_full`, '今天这一类做够了', '明天再来', startOfNextDay(at))
      }

      const delivery = await send(body, facts.chatKey)
      if (!delivery.ok) {
        return { ok: false, code: delivery.code ?? `${kind}.send_failed`, reason: delivery.reason ?? '没发出去', hint: '等下一条冷却过去再试', retryAt: at + tuning.coolDownMs, delivery }
      }
      const fingerprints = [...slot.fingerprints, { sha, at }].slice(-Math.max(1, tuning.fingerprintMax))
      const next: ActionKindState = { dayStart, dayCount: slot.dayCount + 1, lastAt: at, fingerprints }
      const pending = ticket === undefined ? state.pending : state.pending.filter(entry => entry.confirmId !== ticket.confirmId)
      store.write({ version: ACTION_STATE_VERSION, kinds: withKind(state.kinds, kind, next), pending })
      outbound.record(facts.chatKey, at)
      return { ok: true, at, delivery }
    },

    requestConfirm(kind, text, at) {
      const body = text.trim()
      if (body === '') return refuse(`${kind}.empty`, '没有要发的正文', '想发就写点东西', at)
      const dayStart = startOfDay(at)
      const state = prune(store.read() ?? emptyActionState(dayStart), at)
      const sha = fingerprintOf(body)
      const same = state.pending.find(entry => entry.action === kind && entry.sha === sha)
      if (same !== undefined) {
        return refuse(`${kind}.confirm_duplicate`, '这段正文已经在等确认', '等它过期，或者先用确认通道处理掉那一条', same.expiresAt)
      }
      const expiresAt = at + confirmTtlMs
      const entry: PendingAction = { confirmId: `${kind}:${at}:${sha.slice(0, 12)}`, action: kind, sha, text: body, at, expiresAt }
      store.write({ ...state, pending: [...state.pending, entry] })
      return { ok: true, confirmId: entry.confirmId, at, expiresAt }
    },

    confirm(confirmId, at) {
      const dayStart = startOfDay(at)
      const state = store.read() ?? emptyActionState(dayStart)
      const entry = state.pending.find(item => item.confirmId === confirmId)
      if (entry === undefined) return refuse('confirm.unknown', '没有这一条待确认', '重新要一次确认', at)
      if (entry.expiresAt <= at) {
        // 过期即失效：这一条当场从盘上划掉，再点头也不算
        store.write(prune(state, at))
        return refuse(`${entry.action}.confirm_expired`, '这条确认过期了', '重新要一次确认', at)
      }
      const pending = state.pending.map(item => item.confirmId === confirmId ? { ...item, confirmedAt: at } : item)
      store.write({ ...state, pending })
      return { ok: true, confirmId, at }
    },

    reject(confirmId) {
      const at = now()
      const state = store.read() ?? emptyActionState(startOfDay(at))
      const kept = state.pending.filter(item => item.confirmId !== confirmId)
      if (kept.length === state.pending.length) return refuse('confirm.unknown', '没有这一条待确认', '看一眼手上那个编号', at)
      store.write({ ...state, pending: kept })
      return { ok: true, confirmId, at }
    },
  }
}
