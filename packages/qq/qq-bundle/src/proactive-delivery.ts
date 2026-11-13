// 主动候选的发送链：先确认还能说，再占用候选，最后交给真实发送口预留额度

import type { QqChannelSeam } from '@huoli/huoli-qq-channel'
import type { QqProactiveSeam } from '@huoli/huoli-qq-proactive'
import type { LimitsControl } from './limits-control.ts'
import { countProactiveDelivery, refusalOf } from './proactive-tools.ts'
import type { DeliveredHistory } from './runtime.ts'
import type { BundleDelivery } from './types.ts'

/** 候选发送期间共享的主动作用域，并发投递按会话累加 */
export interface ProactiveSendScope {
  /** 这个会话当前是否在主动发送作用域里 */
  has(chatKey: string): boolean
  /** 在主动标记下运行一次发送 */
  with<T>(chatKey: string, send: () => Promise<T>): Promise<T>
}

/**
 * 建一份只在候选发送期间有效的主动标记
 * @returns 查询与包裹发送的能力
 */
export function createProactiveSendScope(): ProactiveSendScope {
  const active = new Map<string, number>()
  return {
    has: chatKey => active.has(chatKey),
    async with(chatKey, send) {
      active.set(chatKey, (active.get(chatKey) ?? 0) + 1)
      try {
        return await send()
      } finally {
        const left = (active.get(chatKey) ?? 1) - 1
        if (left <= 0) active.delete(chatKey)
        else active.set(chatKey, left)
      }
    },
  }
}

/** 投递器要看的运行状态 */
export interface ProactiveDeliveryOptions {
  /** 候选来源 */
  proactive: QqProactiveSeam | undefined
  /** 实际发送入口 */
  channel: QqChannelSeam | undefined
  /** 面板约束与小时额度 */
  limits: LimitsControl
  /** 候选发送期间的主动标记 */
  scope: ProactiveSendScope
  /** 本轮已结算的候选数 */
  deliveries: Map<string, number>
  /** 近期主动正文 */
  history: DeliveredHistory
  /** 想发动态时用的级别 */
  postLevel: string
  /** 当前急停原因 */
  emergencyReason(): string | undefined
  /** 显式安静还剩多久 */
  quietRemainingMs(): number
  /** 身体是否睡着 */
  sleeping(): boolean
  /** 身体是否需要休息 */
  resting(): boolean
  /** 当天用量是否到上限 */
  usageBlocked(): boolean
  /** 真发出后写回身体 */
  noteTalked(chatKey: string): void
  /** 测试替换当前时刻 */
  now?: () => number
}

const UNKNOWN_HINT = '回执没回来，先不要原样重发；确认是否已经发出后再决定'

/**
 * 建一个把候选接到真实发送口的投递器
 * @param options - 发送位置、约束与成功后的记录位置
 * @returns 按候选编号投递
 */
export function createProactiveDelivery(
  options: ProactiveDeliveryOptions,
): (chatKey: string, id: string, body?: string) => Promise<BundleDelivery> {
  const now = options.now ?? (() => Date.now())

  const preflight = (chatKey: string): BundleDelivery | undefined => {
    const stopped = options.emergencyReason()
    if (stopped !== undefined) {
      return { ok: false, code: 'bundle.emergency_stop', reason: stopped || '全局急停中', hint: '先解除急停再投' }
    }
    const state = options.limits.state()
    if (!state.proactiveAllowed) {
      return { ok: false, code: 'bundle.proactive_off', reason: '自主开口已关闭', hint: '在面板重新开启后再投递' }
    }
    if (options.quietRemainingMs() > 0) {
      return { ok: false, code: 'bundle.quiet', reason: '她正在安静', hint: '等安静结束或明确唤醒后再投递' }
    }
    if (options.sleeping()) {
      return { ok: false, code: 'bundle.asleep', reason: '她睡着了', hint: '等她醒来再投递' }
    }
    if (options.resting()) {
      return { ok: false, code: 'bundle.resting', reason: '身体已经该休息了', hint: '等她缓过来再投递' }
    }
    if (options.usageBlocked()) {
      return { ok: false, code: 'bundle.usage_blocked', reason: '今天的用量已经到上限', hint: '等用量恢复后再投递' }
    }
    if (!options.limits.canReserveProactiveSend(chatKey, now())) {
      return { ok: false, code: 'bundle.proactive_hour_limit', reason: '这一小时的主动开口次数已用完', hint: '等一条已计入的主动开口满一小时后再投递' }
    }
    return undefined
  }

  return async (chatKey, id, body) => {
    const blocked = preflight(chatKey)
    if (blocked !== undefined) return blocked
    const proactive = options.proactive
    if (proactive === undefined) {
      return { ok: false, code: 'bundle.proactive_off', reason: '主动开口没装上', hint: '先把那一行挂起来再投' }
    }
    const claimed = proactive.claim(chatKey, id)
    if (!claimed.ok || claimed.item === undefined) return claimed
    const text = (body ?? claimed.item.text).trim()
    const settle = (sent: boolean) => proactive.settle(chatKey, id, sent)
    if (text === '') {
      settle(false)
      return { ok: false, code: 'bundle.no_body', reason: '这一条还没有正文', hint: '先把想发的那段写出来再投' }
    }
    const channel = options.channel
    if (channel === undefined) {
      settle(false)
      return { ok: false, code: 'bundle.no_channel', reason: '没有能发出去的通道', hint: '装上通道那一行再来' }
    }

    let attempted = false
    try {
      if (claimed.item.facts.postWant === undefined) {
        attempted = true
        const sent = await options.scope.with(chatKey, () => channel.send(text, chatKey))
        if (!sent.ok) {
          if (sent.outcome !== 'unknown') {
            settle(false)
            return refusalOf(sent, '等连上再说，或者换一句短点的')
          }
          settle(true)
          options.history.remember(chatKey, text)
          return {
            ok: false,
            ...sent.code === undefined ? {} : { code: sent.code },
            ...sent.reason === undefined ? {} : { reason: sent.reason },
            hint: UNKNOWN_HINT,
          }
        }
        options.noteTalked(chatKey)
        const delivered = settle(true)
        if (!delivered.ok) return delivered
        countProactiveDelivery(options.deliveries, chatKey)
        options.history.remember(chatKey, text)
        return delivered
      }

      attempted = true
      const published = await options.scope.with(chatKey, () => channel.publish('post', text, { chatKey, level: options.postLevel }))
      if (published.ok) {
        options.noteTalked(chatKey)
        const delivered = settle(true)
        if (!delivered.ok) return delivered
        countProactiveDelivery(options.deliveries, chatKey)
        options.history.remember(chatKey, text)
        return { ...delivered, published }
      }
      if (published.delivery?.outcome === 'unknown') {
        settle(true)
        options.history.remember(chatKey, text)
        return {
          ok: false,
          ...published.code === undefined ? {} : { code: published.code },
          ...published.reason === undefined ? {} : { reason: published.reason },
          hint: UNKNOWN_HINT,
        }
      }

      const sent = await options.scope.with(chatKey, () => channel.send(text, chatKey))
      if (!sent.ok) {
        if (sent.outcome !== 'unknown') {
          settle(false)
          return { ...refusalOf(sent, '等连上再说'), published }
        }
        settle(true)
        options.history.remember(chatKey, text)
        return {
          ok: false,
          ...sent.code === undefined ? {} : { code: sent.code },
          ...sent.reason === undefined ? {} : { reason: sent.reason },
          hint: UNKNOWN_HINT,
          published,
        }
      }
      options.noteTalked(chatKey)
      const delivered = settle(true)
      if (!delivered.ok) return delivered
      countProactiveDelivery(options.deliveries, chatKey)
      options.history.remember(chatKey, text)
      return { ...delivered, published }
    } catch {
      try {
        settle(attempted)
      } catch {
        // 发送后的记录失败不能把已发出的候选放回待发
      }
      return {
        ok: false,
        code: 'bundle.send_failed',
        reason: attempted ? '主动发送过程中出错，结果没有写完整' : '主动发送前出错，消息没有交给连接',
        hint: attempted
          ? '先查连接状态；结果无法确认时不要原样重发'
          : '等连接恢复后再试这一条',
      }
    }
  }
}
