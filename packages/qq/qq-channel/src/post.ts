// 动态的发布入口：先判级别与钥匙，再过动态自己的去重、冷却与额度，最后仍走出站体检

import { createHash } from 'node:crypto'
import { startOfNextDay } from '@huoli/huoli-qq-proactive'
import { judgePostLevel } from '@huoli/huoli-qq-self'
import type { OutboundCheck } from './outbound.ts'
import { POST_STATE_VERSION, emptyPostState, type PostState, type PostStore } from './post-store.ts'

// 冷却与去重同一个窗：这段时间里同一段正文只许发一次
const POST_WINDOW_MS = 30 * 60_000

/** 发布动态的默认值表 */
export const POST_DEFAULTS = {
  /** 两条动态之间至少隔多久 */
  coolDownMs: POST_WINDOW_MS,
  /** 同一段正文隔多久才许再发 */
  repeatWindowMs: POST_WINDOW_MS,
  /** 一天最多发几条动态 */
  dailyMax: 3,
  /** 指纹表最多留几条 */
  fingerprintMax: 64,
  /** 预授权的话题类别，命中才算例行 */
  routineTopics: ['日常', '吃喝'] as readonly string[],
}

/** 发布要用的参数 */
export type PostTuning = typeof POST_DEFAULTS

/** 发一条动态要看的事实 */
export interface PostFacts {
  /** 发去哪个会话 */
  chatKey: string
  /** 她自己说的级别：none、routine、public */
  level: string
  /** 话题类别，例行那一级要用 */
  topic?: string
  /** 用户那把钥匙 */
  userOk?: boolean
  /** 她自己那把钥匙 */
  selfOk?: boolean
}

/** 通道回来的投递结果 */
export interface PostDelivery {
  /** 送出去了没有 */
  ok: boolean
  /** 送出去之后的编号 */
  messageId?: string
  /** 没送出去的码 */
  code?: string
  /** 没送出去的原因 */
  reason?: string
}

/** 一次发布的结果，拒绝时只有码、原因与下次时刻 */
export interface PostResult {
  /** 发出去了没有 */
  ok: boolean
  /** 拒绝的码，形如 post.duplicate */
  code?: string
  /** 一句可读原因 */
  reason?: string
  /** 下一步提示 */
  hint?: string
  /** 下次可以再试的时刻 */
  retryAt?: number
  /** 真发出去的时刻 */
  at?: number
  /** 通道回来那一路的结果 */
  delivery?: PostDelivery
}

/** 发布入口 */
export interface PostGate {
  /**
   * 发一条动态
   * @param text - 正文，不写就不发
   * @param facts - 级别、话题与两把钥匙
   * @returns 发出去的时刻与投递结果，没发就带码
   */
  publish(text: string, facts: PostFacts): Promise<PostResult>
}

/** 建发布入口要用到的东西 */
export interface PostGateOptions {
  /** 发布的参数 */
  tuning: PostTuning
  /** 状态在哪 */
  store: PostStore
  /** 出站体检，发送前仍要过一遍 */
  outbound: OutboundCheck
  /** 真把一条送出去 */
  send: (text: string, chatKey: string) => Promise<PostDelivery>
  /** 停手开关，为真时一条都不发 */
  paused?: () => boolean
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

// 拒绝只回码、原因与下次时刻，不改写正文
function refuse(code: string, reason: string, hint: string, retryAt: number): PostResult {
  return { ok: false, code, reason, hint, retryAt }
}

// 发出去之后记账：指纹、上一次时刻、当天条数一起更新
function recordAfter(state: PostState, next: { sha: string; at: number; dayStart: number; sentToday: number }, keep: number): PostState {
  const fingerprints = [...state.fingerprints, { sha: next.sha, at: next.at }].slice(-Math.max(1, keep))
  return { version: POST_STATE_VERSION, dayStart: next.dayStart, dayCount: next.sentToday + 1, lastPostedAt: next.at, fingerprints }
}

/**
 * 建一个发布入口
 * @param options - 参数、状态、体检与发送
 * @returns 发布入口
 */
export function createPostGate(options: PostGateOptions): PostGate {
  const { tuning, store, outbound, send } = options
  const now = options.now ?? (() => Date.now())
  const paused = options.paused ?? (() => false)

  return {
    async publish(text, facts) {
      const at = now()
      const body = text.trim()
      if (body === '') return refuse('post.empty', '没有要发的正文', '想发就写点东西', at)
      const graded = judgePostLevel({ level: facts.level, userOk: facts.userOk === true, selfOk: facts.selfOk === true })
      if (!graded.ok) return refuse(graded.code ?? 'post.level', graded.reason ?? '这一条不能发', '换个级别，或者先拿到该有的许可', at)
      if (facts.level === 'routine' && !tuning.routineTopics.includes(facts.topic ?? '')) {
        return refuse('post.not_routine', '这个话题不在预授权清单里', '先问一句，或者换个话题再发', at)
      }
      if (paused()) return refuse('post.paused', '现在停着手', '等人把停手开关拿掉再说', at)

      const inspection = outbound.check({ chatKey: facts.chatKey, text: body })
      if (!inspection.ok) {
        return refuse(inspection.code ?? 'outbound.blocked', inspection.reason ?? '现在不能发', inspection.hint ?? '过一会儿再发', inspection.retryAt ?? at + tuning.coolDownMs)
      }

      const dayStart = startOfDay(at)
      const state = store.read() ?? emptyPostState(dayStart)
      const sha = fingerprintOf(body)
      const seen = state.fingerprints.find(entry => entry.sha === sha)
      if (seen !== undefined && at - seen.at < tuning.repeatWindowMs) {
        return refuse('post.duplicate', '这段话刚发过', '过一阵再说，或者换一种说法', seen.at + tuning.repeatWindowMs)
      }
      if (state.lastPostedAt > 0 && at - state.lastPostedAt < tuning.coolDownMs) {
        return refuse('post.cooling', '上一条动态还不久', '等冷却过去再发', state.lastPostedAt + tuning.coolDownMs)
      }
      const sentToday = state.dayStart === dayStart ? state.dayCount : 0
      if (sentToday >= tuning.dailyMax) {
        return refuse('post.day_full', '今天动态发够了', '明天再发', startOfNextDay(at))
      }

      const delivery = await send(body, facts.chatKey)
      if (!delivery.ok) {
        return { ok: false, code: delivery.code ?? 'post.send_failed', reason: delivery.reason ?? '没发出去', hint: '等下一条冷却过去再试', retryAt: at + tuning.coolDownMs, delivery }
      }
      store.write(recordAfter(state, { sha, at, dayStart, sentToday }, tuning.fingerprintMax))
      outbound.record(at)
      return { ok: true, at, delivery }
    },
  }
}
