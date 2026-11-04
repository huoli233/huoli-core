// 接 QQ 的装配入口：连上、把消息放进收件箱、把要发的送出去

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { qqPacingOf, REPLY_DEFAULTS, speechGaps, splitByBudget } from '@huoli/huoli-qq-pacing'
import { createWsChannel, type WsChannel } from './ws.ts'
import { toIncoming, toPoke, type ChannelStatus, type IncomingMessage, type IncomingPoke, type OutboundEvent } from './events.ts'
import { createOutboundCheck, OUTBOUND_DEFAULTS, type OutboundTuning } from './outbound.ts'
import { createPostGate, POST_DEFAULTS, type PostFacts, type PostResult, type PostTuning } from './post.ts'
import { createPostStore } from './post-store.ts'
import { registerChannelTools } from './tools.ts'

export type { ChannelStatus, IncomingMessage, IncomingPoke, Outgoing, OutboundEvent, SentResult } from './events.ts'
export { chatKeyOf, hasWords, mentionsSelf, repliesToSelf, textOf, toIncoming, toPoke } from './events.ts'
export type { OutboundCheck, OutboundInput, OutboundTuning, OutboundVerdict } from './outbound.ts'
export { createOutboundCheck, OUTBOUND_DEFAULTS } from './outbound.ts'
export type { PostDelivery, PostFacts, PostGate, PostGateOptions, PostResult, PostTuning } from './post.ts'
export { createPostGate, POST_DEFAULTS } from './post.ts'
export type { PostFingerprint, PostState, PostStore, PostStoreOptions } from './post-store.ts'
export { createPostStore, emptyPostState, POST_STATE_VERSION } from './post-store.ts'
export type { WsChannel, WsHandlers, WsOptions } from './ws.ts'
export { createWsChannel } from './ws.ts'

/** 别处要往收件箱塞消息、要发东西，都从这儿拿 */
export interface QqChannelSeam {
  channel: WsChannel
  status(): ChannelStatus
  /** 收一条消息，返回注销函数 */
  onIncoming(handler: (message: IncomingMessage) => void): () => void
  /** 收一次戳一戳，返回注销函数 */
  onPoke(handler: (poke: IncomingPoke) => void): () => void
  /** 看发送这一路发生了什么，返回注销函数 */
  onOutbound(handler: (event: OutboundEvent) => void): () => void
  /** 发一条动态，先过级别与动态自己的闸门，再走出站体检 */
  publishPost(text: string, facts: PostFacts): Promise<PostResult>
  /** 接上停手开关，为真时一条动态都不发 */
  usePause(check: (() => boolean) | undefined): void
  /** 接上这一轮的条数上限，不接就只发一条 */
  useReplyCap(provide: (() => number) | undefined): void
}

/** 这一行接受的配置 */
export interface Config {
  /** QQ 那头连过来的地址 */
  url: string
  /** 机器人自己的 QQ 号 */
  selfId: string
  /** 连接口令，没设就不带 */
  accessToken?: string
  /** 断了之后隔多久重连 */
  reconnectMs?: number
  /** 允许发声的群编号，空表示不限制 */
  allowGroups?: readonly string[]
  /** 允许发声的人编号，空表示不限制 */
  allowPeople?: readonly string[]
  /** 一条最多几个字 */
  maxChars?: number
  /** 一分钟最多几条 */
  perMinute?: number
  /** 条数往回看的窗口 */
  windowMs?: number
  /** 静默时段从几点开始 */
  quietStart?: string
  /** 静默时段到几点结束 */
  quietEnd?: string
  /** 敏感词，命中就拦 */
  banned?: readonly string[]
  /** 白名单、长度、敏感词这三类拒绝给出的下次时间 */
  retryMs?: number
  /** 两条动态之间至少隔多久 */
  postCoolDownMs?: number
  /** 同一段正文隔多久才许再发 */
  postRepeatWindowMs?: number
  /** 一天最多发几条动态 */
  postDailyMax?: number
  /** 指纹表最多留几条 */
  postFingerprintMax?: number
  /** 预授权的话题类别，命中才算例行 */
  routineTopics?: readonly string[]
  /** 动态状态文件放哪，不填就落在数据根目录下的 data */
  postsFile?: string
}

const seams = new WeakMap<Context, QqChannelSeam>()

/**
 * 取通道，未装配时为 undefined
 * @param ctx - 运行环境
 * @returns 处理结果
 */
export function qqChannelOf(ctx: Context): QqChannelSeam | undefined {
  return seams.get(ctx)
}

/** 插件的行名 */
export const name = 'qq-channel'

/** 要用的内核接口 */
export const inject = ['tools']

// 把配置摊成体检参数，没给的按默认值表走
function resolveOutbound(config: Config): OutboundTuning {
  return {
    allowGroups: config.allowGroups ?? OUTBOUND_DEFAULTS.allowGroups,
    allowPeople: config.allowPeople ?? OUTBOUND_DEFAULTS.allowPeople,
    maxChars: Math.max(1, config.maxChars ?? OUTBOUND_DEFAULTS.maxChars),
    perMinute: Math.max(1, config.perMinute ?? OUTBOUND_DEFAULTS.perMinute),
    windowMs: Math.max(1, config.windowMs ?? OUTBOUND_DEFAULTS.windowMs),
    quietStart: config.quietStart ?? OUTBOUND_DEFAULTS.quietStart,
    quietEnd: config.quietEnd ?? OUTBOUND_DEFAULTS.quietEnd,
    banned: config.banned ?? OUTBOUND_DEFAULTS.banned,
    retryMs: Math.max(0, config.retryMs ?? OUTBOUND_DEFAULTS.retryMs),
  }
}

// 把配置摊成动态参数，没给的按默认值表走
function resolvePost(config: Config): PostTuning {
  return {
    coolDownMs: Math.max(0, config.postCoolDownMs ?? POST_DEFAULTS.coolDownMs),
    repeatWindowMs: Math.max(0, config.postRepeatWindowMs ?? POST_DEFAULTS.repeatWindowMs),
    dailyMax: Math.max(0, config.postDailyMax ?? POST_DEFAULTS.dailyMax),
    fingerprintMax: Math.max(1, config.postFingerprintMax ?? POST_DEFAULTS.fingerprintMax),
    routineTopics: config.routineTopics ?? POST_DEFAULTS.routineTopics,
  }
}

/**
 * 装配通道与发送工具
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config): void {
  const incoming: Array<(message: IncomingMessage) => void> = []
  const pokes: Array<(poke: IncomingPoke) => void> = []
  const outboundEvents: Array<(event: OutboundEvent) => void> = []

  // 注销就是把这一条从表里拿掉，卸载之后再来消息不会再找到它
  const listen = <T>(list: Array<(value: T) => void>, handler: (value: T) => void): (() => void) => {
    list.push(handler)
    return () => {
      const at = list.indexOf(handler)
      if (at >= 0) list.splice(at, 1)
    }
  }

  const channel = createWsChannel(
    {
      url: config.url,
      selfId: config.selfId,
      ...config.accessToken !== undefined ? { accessToken: config.accessToken } : {},
      ...config.reconnectMs !== undefined ? { reconnectMs: config.reconnectMs } : {},
    },
    {
      onMessage(raw) {
        const now = Date.now()
        const message = toIncoming(raw, config.selfId, now)
        if (message !== null && message.text !== '') {
          for (const handler of incoming) handler(message)
          return
        }
        const poke = toPoke(raw, now)
        if (poke !== null) for (const handler of pokes) handler(poke)
      },
      onStatus() {
        // 状态变化给控制台看，这里不额外做事
      },
      log(message) {
        void message
      },
    },
  )

  const tuning = resolveOutbound(config)
  const outbound = createOutboundCheck(tuning)

  // 动态自己的状态与闸门，账不与发言额度共用
  let pauseCheck: () => boolean = () => false
  // 条数上限由组合包每轮给一次，没接上就按分档表的下限发一条
  let replyCap: (() => number) | undefined
  const capNow = (): number => {
    const cap = replyCap?.()
    return cap === undefined ? REPLY_DEFAULTS.minCap : Math.max(REPLY_DEFAULTS.minCap, Math.floor(cap))
  }
  const postFile = config.postsFile ?? path.join(resolveHuoliHome(), 'data', 'qq-posts.json')
  const posts = createPostGate({
    tuning: resolvePost(config),
    store: createPostStore({ file: postFile }),
    outbound,
    send: (text, chatKey) => channel.send(text, chatKey),
    paused: () => pauseCheck(),
  })

  const seam: QqChannelSeam = {
    channel,
    status() {
      return channel.status()
    },
    onIncoming(handler) {
      return listen(incoming, handler)
    },
    onPoke(handler) {
      return listen(pokes, handler)
    },
    onOutbound(handler) {
      return listen(outboundEvents, handler)
    },
    async publishPost(text, facts) {
      const openedAt = Date.now()
      for (const handler of outboundEvents) handler({ kind: 'attempt', at: openedAt, chatKey: facts.chatKey, count: 0 })
      const result = await posts.publish(text, facts)
      for (const handler of outboundEvents) {
        if (result.ok) handler({ kind: 'sent', at: result.at ?? openedAt, chatKey: facts.chatKey, count: 1 })
        else handler({ kind: 'blocked', at: Date.now(), chatKey: facts.chatKey, count: 0, ...result.code === undefined ? {} : { code: result.code }, ...result.retryAt === undefined ? {} : { retryAt: result.retryAt } })
      }
      return result
    },
    usePause(check) {
      pauseCheck = check ?? (() => false)
    },
    useReplyCap(provide) {
      replyCap = provide
    },
  }
  seams.set(ctx, seam)

  // 名单空着等于不管，但要说一次，免得以为已经在管了
  if (tuning.allowGroups.length === 0) ctx.logger('qq-channel').info('群白名单为空，所有群都能发')
  if (tuning.allowPeople.length === 0) ctx.logger('qq-channel').info('人白名单为空，所有人都能发')

  // 拆句直接用说话规矩里的纯函数，不依赖它有没有先装好
  const pacing = qqPacingOf(ctx)

  registerChannelTools(ctx, {
    status: () => channel.status(),
    send: (text, chatKey) => channel.send(text, chatKey),
    react: (messageId, emoji) => channel.react(messageId, emoji),
    // 单条的字数口径与出站体检的长度闸取同一个数，切出来的每条都过得了那道闸
    split: (text, maxParts) => {
      const parts = splitByBudget(text, { maxParts, maxCharsPerPart: tuning.maxChars })
      return { parts, gapsMs: speechGaps(parts) }
    },
    cap: () => capNow(),
    spend: (text) => {
      pacing?.spend(text)
    },
    allow: (text) => {
      const verdict = pacing?.allow(text)
      return verdict !== undefined ? verdict : { ok: true }
    },
    inspect: (chatKey, text) => outbound.check({ chatKey, text }),
    account: (at) => {
      outbound.record(at)
    },
    report: (event) => {
      for (const handler of outboundEvents) handler(event)
    },
    publish: (text, facts) => seam.publishPost(text, facts),
  })

  channel.start()

  // 卸载时断开
  ctx.effect(() => () => {
    channel.stop()
    seams.delete(ctx)
  })
}
