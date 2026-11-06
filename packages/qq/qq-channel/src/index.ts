// 接 QQ 的装配入口：连上、把消息放进收件箱、把要发的送出去

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { qqPacingOf, REPLY_DEFAULTS, speechGaps, splitByBudget } from '@huoli/huoli-qq-pacing'
import { DEFAULTS, type ActionKind } from '@huoli/huoli-qq-self'
import { createWsChannel, type WsChannel } from './ws.ts'
import { toIncoming, toPoke, type ChannelStatus, type IncomingMessage, type IncomingPoke, type OutboundEvent } from './events.ts'
import { createOutboundCheck, OUTBOUND_DEFAULTS, type OutboundTuning } from './outbound.ts'
import { ACTION_DEFAULTS, CONFIRM_DEFAULTS, POLICY_DEFAULTS, type ActionFacts, type ActionResult, type ActionTuning, type ActionTunings } from './actions.ts'
import { createActionGate } from './action-gate.ts'
import { createActionStore } from './action-store.ts'
import { createFarewellSlotStore, defaultFarewellSlotFile } from './farewell-slot.ts'
import { registerChannelTools } from './tools.ts'
import { readHistory, readMembers, readMessage } from './read.ts'
import { defaultStickerFile, listStickers, stickerOf } from './stickers.ts'
import { defaultVoiceFile, listVoices, voiceOf } from './voices.ts'
import { addSlang, defaultSlangFile, findSlangs } from './slang.ts'
import { addSaying, defaultSayingFile, findSayings } from './sayings.ts'

export type { ChannelStatus, IncomingMessage, IncomingPoke, Outgoing, OutboundEvent, SentResult } from './events.ts'
export { chatKeyOf, hasWords, mentionsSelf, repliesToSelf, textOf, toIncoming, toPoke } from './events.ts'
export { canModerate, GROUP_ROLES, parseGroupRole, roleOfMember } from './group-role.ts'
export type { GroupRole, RoleRead } from './group-role.ts'
export type { OutboundCheck, OutboundInput, OutboundTuning, OutboundVerdict } from './outbound.ts'
export { createOutboundCheck, OUTBOUND_DEFAULTS } from './outbound.ts'
export type { ActionDelivery, ActionFacts, ActionGate, ActionKind, ActionResult, ActionTuning, ActionTunings } from './actions.ts'
export { ACTION_DEFAULTS, CONFIRM_DEFAULTS, CONFIRM_KINDS, POLICY_DEFAULTS } from './actions.ts'
export type { ActionGateOptions } from './action-gate.ts'
export { createActionGate } from './action-gate.ts'
export type { ActionFingerprint, ActionKindState, ActionState, ActionStore, ActionStoreOptions, PendingAction } from './action-store.ts'
export { ACTION_STATE_VERSION, createActionStore, emptyActionState } from './action-store.ts'
export type { FarewellSlot, FarewellSlotOptions, FarewellSlotStore, FarewellStage } from './farewell-slot.ts'
export { createFarewellSlotStore, defaultFarewellSlotFile, FAREWELL_SLOT_VERSION, farewellTextAt, readFarewellSlot } from './farewell-slot.ts'
export type { WsChannel, WsHandlers, WsOptions } from './ws.ts'
export { createWsChannel, WS_DEFAULTS } from './ws.ts'
export type { ForwardNode } from './forward.ts'

/** 合并转发的默认值：默认关，打开只影响真的分成两段以上的回复 */
export const FORWARD_DEFAULTS = {
  /** 多段回复要不要合成一条合并转发 */
  replyForward: false,
  /** 合并转发卡片上显示的名字 */
  replyForwardName: '她',
} as const

/** 别处要往收件箱塞消息、要发东西，都从这儿拿 */
export interface QqChannelSeam {
  channel: WsChannel
  status(): ChannelStatus
  /** 收一条消息，返回撤掉的函数 */
  onIncoming(handler: (message: IncomingMessage) => void): () => void
  /** 收一次戳一戳，返回撤掉的函数 */
  onPoke(handler: (poke: IncomingPoke) => void): () => void
  /** 看发送这一路发生了什么，返回撤掉的函数 */
  onOutbound(handler: (event: OutboundEvent) => void): () => void
  /** 发一次公共动作，先过级别与这一类动作自己的关卡，再走出站体检 */
  publish(kind: ActionKind, text: string, facts: ActionFacts): Promise<ActionResult>
  /** 往某个会话发一段普通消息，只过出站体检、频控与切分，不碰公共动作的级别 */
  send(text: string, chatKey: string): Promise<ActionResult>
  /** 把一段正文放进待确认队列，返回编号 */
  requestConfirm(kind: ActionKind, text: string, at: number): ActionResult
  /** 点头放行一条待确认的正文 */
  confirm(confirmId: string, at: number): ActionResult
  /** 丢掉一条待确认的正文 */
  reject(confirmId: string): ActionResult
  /** 接上停手开关，为真时一条动态都不发 */
  usePause(check: (() => boolean) | undefined): void
  /** 接上这一轮的条数上限，不接就只发一条 */
  useReplyCap(provide: (() => number) | undefined): void
  /** 接上「发到第几条就该停」：给了就按它提前收口 */
  useStop(provide: ((sentCount: number) => boolean) | undefined): void
  /** 接上自我层现在的阶段，三类公共动作都按它判能不能发 */
  useStage(provide: (() => string) | undefined): void
  /** 接上「刚改过口」这一笔往哪记，没接就不记 */
  useCorrectionNote(provide: ((wrong: string, better: string, at: number) => void) | undefined): void
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
  /** 一段等 QQ 那头回话的超时 */
  callTimeoutMs?: number
  /** 多段回复要不要合成一条合并转发 */
  replyForward?: boolean
  /** 合并转发卡片上显示的名字 */
  replyForwardName?: string
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
  /** 上一条与这一条之间至少隔多久，毫秒，默认 0 不拦 */
  sendGapMs?: number
  /** 静默时段从几点开始 */
  quietStart?: string
  /** 静默时段到几点结束 */
  quietEnd?: string
  /** 敏感词，命中就拦 */
  banned?: readonly string[]
  /** 允许的名单、长度、敏感词这三类拒绝给出的下次时间 */
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
  /** 评论两条之间至少隔多久 */
  commentCoolDownMs?: number
  /** 同一段评论隔多久才许再发 */
  commentRepeatWindowMs?: number
  /** 一天最多发几条评论 */
  commentDailyMax?: number
  /** 评论指纹表最多留几条 */
  commentFingerprintMax?: number
  /** 私信两条之间至少隔多久 */
  privateCoolDownMs?: number
  /** 同一段私信隔多久才许再发 */
  privateRepeatWindowMs?: number
  /** 一天最多发几条私信 */
  privateDailyMax?: number
  /** 私信指纹表最多留几条 */
  privateFingerprintMax?: number
  /** 允许私信的对象，空表示谁都不行 */
  privateAllowPeers?: readonly string[]
  /** 待确认项多久没人点头就失效 */
  confirmTtlMs?: number
  /** 公开动态与公开评论最早从哪个阶段开始，不给就用自我层默认值表 */
  publicMinStage?: string
  /** 私信最早从哪个阶段开始，不给就用自我层默认值表 */
  privateMinStage?: string
  /** 三类动作的状态文件放哪，不填就落在数据根目录下的 data */
  actionsFile?: string
  /** 遗书正文的暂存槽放哪，不填就落在数据根目录下的 data */
  farewellFile?: string
  /** 表情包库放哪，不填就落在数据根目录下的 data */
  stickerFile?: string
  /** 语音库放哪，不填就落在数据根目录下的 data */
  voiceFile?: string
  /** 学来的词放哪，不填就落在数据根目录下的 data */
  slangFile?: string
  /** 学来的说法放哪，不填就落在数据根目录下的 data */
  sayingFile?: string
  /** 准不准戳人，默认不准；开了也只是多一个动作，不改变判级 */
  pokeEnabled?: boolean
}

const seams = new WeakMap<Context, QqChannelSeam>()

/** 等一会儿，但别让定时器拖着进程不退 */
function pauseMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref()
  })
}

/**
 * 取通道，未装配时为 undefined
 * @param ctx - 运行环境
 * @returns 处理结果
 */
export function qqChannelOf(ctx: Context): QqChannelSeam | undefined {
  return seams.get(ctx.root) ?? seams.get(ctx)
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
    sendGapMs: Math.max(0, config.sendGapMs ?? OUTBOUND_DEFAULTS.sendGapMs),
    quietStart: config.quietStart ?? OUTBOUND_DEFAULTS.quietStart,
    quietEnd: config.quietEnd ?? OUTBOUND_DEFAULTS.quietEnd,
    banned: config.banned ?? OUTBOUND_DEFAULTS.banned,
    retryMs: Math.max(0, config.retryMs ?? OUTBOUND_DEFAULTS.retryMs),
  }
}

// 一类动作允许从配置里覆盖的那几项
type ActionOverrides = Partial<Pick<ActionTuning, 'coolDownMs' | 'repeatWindowMs' | 'dailyMax' | 'fingerprintMax'>>

// 一类动作的参数按默认值表摊开，配置给了就覆盖，没给就用表里的
function tuneAction(base: ActionTuning, over: ActionOverrides): ActionTuning {
  return {
    ...base,
    coolDownMs: Math.max(0, over.coolDownMs ?? base.coolDownMs),
    repeatWindowMs: Math.max(0, over.repeatWindowMs ?? base.repeatWindowMs),
    dailyMax: Math.max(0, over.dailyMax ?? base.dailyMax),
    fingerprintMax: Math.max(1, over.fingerprintMax ?? base.fingerprintMax),
  }
}

// 阶段下限只在自我层的默认值表里定，这里只做逐项覆盖
function resolveStageFloors(config: Config): { publicMinStage: string; privateMinStage: string } {
  return {
    publicMinStage: config.publicMinStage ?? DEFAULTS.publicMinStage,
    privateMinStage: config.privateMinStage ?? DEFAULTS.privateMinStage,
  }
}

// 三类动作各摊一套参数，三类之间的数互不影响
function resolveActions(config: Config): ActionTunings {
  return {
    post: tuneAction(ACTION_DEFAULTS.post, {
      ...config.postCoolDownMs === undefined ? {} : { coolDownMs: config.postCoolDownMs },
      ...config.postRepeatWindowMs === undefined ? {} : { repeatWindowMs: config.postRepeatWindowMs },
      ...config.postDailyMax === undefined ? {} : { dailyMax: config.postDailyMax },
      ...config.postFingerprintMax === undefined ? {} : { fingerprintMax: config.postFingerprintMax },
    }),
    comment: tuneAction(ACTION_DEFAULTS.comment, {
      ...config.commentCoolDownMs === undefined ? {} : { coolDownMs: config.commentCoolDownMs },
      ...config.commentRepeatWindowMs === undefined ? {} : { repeatWindowMs: config.commentRepeatWindowMs },
      ...config.commentDailyMax === undefined ? {} : { dailyMax: config.commentDailyMax },
      ...config.commentFingerprintMax === undefined ? {} : { fingerprintMax: config.commentFingerprintMax },
    }),
    private: tuneAction(ACTION_DEFAULTS.private, {
      ...config.privateCoolDownMs === undefined ? {} : { coolDownMs: config.privateCoolDownMs },
      ...config.privateRepeatWindowMs === undefined ? {} : { repeatWindowMs: config.privateRepeatWindowMs },
      ...config.privateDailyMax === undefined ? {} : { dailyMax: config.privateDailyMax },
      ...config.privateFingerprintMax === undefined ? {} : { fingerprintMax: config.privateFingerprintMax },
    }),
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

  // 撤掉就是把这一条从表里拿掉，卸载之后再来消息不会再找到它
  const listen = <T>(list: Array<(value: T) => void>, handler: (value: T) => void): (() => void) => {
    list.push(handler)
    return () => {
      const at = list.indexOf(handler)
      if (at >= 0) list.splice(at, 1)
    }
  }

  // 通道本身不落盘，日志是排查断线唯一的出口
  const logger = ctx.logger('qq-channel')
  let lastError = ''

  const channel = createWsChannel(
    {
      url: config.url,
      selfId: config.selfId,
      ...config.accessToken !== undefined ? { accessToken: config.accessToken } : {},
      ...config.reconnectMs !== undefined ? { reconnectMs: config.reconnectMs } : {},
      ...config.callTimeoutMs !== undefined ? { callTimeoutMs: config.callTimeoutMs } : {},
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
      onStatus(status) {
        // 同一条错重复刷屏没有信息量，只在错误文本变了时记一次
        if (status.lastError === lastError) return
        lastError = status.lastError
        if (lastError !== '') logger.warn(`通道出错：${lastError}`)
      },
      log(message) {
        logger.info(message)
      },
    },
  )

  const tuning = resolveOutbound(config)
  const outbound = createOutboundCheck(tuning)
  // 多段回复要不要合成一条合并转发：默认关，打开只在真的分成两段以上时才用
  const replyForward = config.replyForward ?? FORWARD_DEFAULTS.replyForward
  const forwardName = config.replyForwardName ?? FORWARD_DEFAULTS.replyForwardName

  // 三类动作共用一份状态与一个入口，账不与发言额度共用
  let pauseCheck: () => boolean = () => false
  // 条数上限由组合包每轮给一次，没接上就按分档表的下限发一条
  let replyCap: (() => number) | undefined
  // 发到第几条就该停：由组装那一层按额度、张力与「人家要她别说」判
  let stopCheck: ((sentCount: number) => boolean) | undefined
  // 自我层现在的阶段由组合包接进来，没接上就按那一层默认值表里最保守的一档判
  let stageCheck: (() => string) | undefined
  let correctionNote: ((wrong: string, better: string, at: number) => void) | undefined
  const capNow = (): number => {
    const cap = replyCap?.()
    return cap === undefined ? REPLY_DEFAULTS.minCap : Math.max(REPLY_DEFAULTS.minCap, Math.floor(cap))
  }
  const actionsFile = config.actionsFile ?? path.join(resolveHuoliHome(), 'data', 'qq-actions.json')
  const actions = createActionGate({
    tunings: resolveActions(config),
    confirmTtlMs: Math.max(0, config.confirmTtlMs ?? CONFIRM_DEFAULTS.ttlMs),
    topics: config.routineTopics ?? POLICY_DEFAULTS.routineTopics,
    allowPeers: config.privateAllowPeers ?? POLICY_DEFAULTS.allowPeers,
    ...resolveStageFloors(config),
    store: createActionStore({ file: actionsFile }),
    outbound,
    send: (text, chatKey) => channel.send(text, chatKey),
    paused: () => pauseCheck(),
    stage: () => stageCheck?.(),
  })

  // 遗书正文的暂存槽与三类动作的状态各一份文件，互不影响
  const farewell = createFarewellSlotStore({ file: config.farewellFile ?? defaultFarewellSlotFile() })
  // 表情包库、语音库与学到的词各一份文件，没存过就当都是空的
  const stickerFile = config.stickerFile ?? defaultStickerFile()
  const voiceFile = config.voiceFile ?? defaultVoiceFile()
  const slangFile = config.slangFile ?? defaultSlangFile()
  const sayingFile = config.sayingFile ?? defaultSayingFile()

  // 拆句直接用说话规矩里的纯函数，不依赖它有没有先装好
  const pacing = qqPacingOf(ctx)

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
    async publish(kind, text, facts) {
      const openedAt = Date.now()
      for (const handler of outboundEvents) handler({ kind: 'attempt', at: openedAt, chatKey: facts.chatKey, count: 0 })
      const result = await actions.publish(kind, text, facts)
      for (const handler of outboundEvents) {
        if (result.ok) handler({ kind: 'sent', at: result.at ?? openedAt, chatKey: facts.chatKey, count: 1 })
        else handler({ kind: 'blocked', at: Date.now(), chatKey: facts.chatKey, count: 0, ...result.code === undefined ? {} : { code: result.code }, ...result.retryAt === undefined ? {} : { retryAt: result.retryAt } })
      }
      return result
    },
    // 普通消息只过出站体检、频控与切分，不碰公共动作那套级别与钥匙
    async send(text, chatKey) {
      const body = text.trim()
      const at = Date.now()
      if (body === '') return { ok: false, code: 'channel.empty', reason: '没话可说', hint: '要发就写点东西', at }
      if (!channel.status().connected) return { ok: false, code: 'channel.offline', reason: '现在没连上 QQ', hint: '等连上再发', at }
      const inspection = outbound.check({ chatKey, text: body })
      if (!inspection.ok) {
        for (const handler of outboundEvents) handler({ kind: 'blocked', at, chatKey, count: 0, ...inspection.code === undefined ? {} : { code: inspection.code } })
        return {
          ok: false,
          at,
          ...inspection.code === undefined ? {} : { code: inspection.code },
          ...inspection.reason === undefined ? {} : { reason: inspection.reason },
          ...inspection.hint === undefined ? {} : { hint: inspection.hint },
          ...inspection.retryAt === undefined ? {} : { retryAt: inspection.retryAt },
        }
      }
      const verdict = pacing?.allow(body)
      if (verdict !== undefined && !verdict.ok) {
        for (const handler of outboundEvents) handler({ kind: 'blocked', at, chatKey, count: 0, ...verdict.code === undefined ? {} : { code: verdict.code } })
        return {
          ok: false,
          at,
          ...verdict.code === undefined ? {} : { code: verdict.code },
          ...verdict.reason === undefined ? {} : { reason: verdict.reason },
        }
      }
      const parts = splitByBudget(body, { maxParts: capNow(), maxCharsPerPart: tuning.maxChars })
      // 分成两段以上又开着合并转发：一条发出去，别让对面收一串碎片
      if (replyForward && parts.length > 1) {
        const forwarded = await channel.sendForward(parts.map(part => ({ name: forwardName, content: part })), chatKey)
        if (!forwarded.ok) {
          for (const handler of outboundEvents) handler({ kind: 'blocked', at: Date.now(), chatKey, count: 0, ...forwarded.code === undefined ? {} : { code: forwarded.code } })
          return {
            ok: false,
            at: Date.now(),
            ...forwarded.code === undefined ? {} : { code: forwarded.code },
            reason: forwarded.reason ?? '合并转发没发出去',
            hint: '等一下再发，或者把这一段说短些',
          }
        }
        for (const part of parts) pacing?.spend(part)
        outbound.record(Date.now())
        for (const handler of outboundEvents) handler({ kind: 'sent', at: Date.now(), chatKey, count: parts.length })
        return { ok: true, at: Date.now(), messageId: forwarded.messageId ?? '' }
      }
      const ids: string[] = []
      for (const [index, part] of parts.entries()) {
        const sent = await channel.send(part, chatKey)
        if (!sent.ok) {
          if (ids.length > 0) for (const handler of outboundEvents) handler({ kind: 'sent', at: Date.now(), chatKey, count: ids.length })
          for (const handler of outboundEvents) handler({ kind: 'blocked', at: Date.now(), chatKey, count: 0, ...sent.code === undefined ? {} : { code: sent.code } })
          return {
            ok: false,
            at: Date.now(),
            ...sent.code === undefined ? {} : { code: sent.code },
            reason: `已发 ${ids.length} 条，卡在第 ${index + 1} 条：${sent.reason ?? '发送失败'}`,
            hint: '换一句短点的，或者等一下再发',
          }
        }
        pacing?.spend(part)
        outbound.record(Date.now())
        ids.push(sent.messageId ?? '')
      }
      for (const handler of outboundEvents) handler({ kind: 'sent', at: Date.now(), chatKey, count: parts.length })
      return { ok: true, at: Date.now(), messageId: ids[0] ?? '' }
    },
    requestConfirm(kind, text, at) {
      return actions.requestConfirm(kind, text, at)
    },    confirm(confirmId, at) {
      return actions.confirm(confirmId, at)
    },
    reject(confirmId) {
      return actions.reject(confirmId)
    },
    usePause(check) {
      pauseCheck = check ?? (() => false)
    },
    useReplyCap(provide) {
      replyCap = provide
    },
    useStop(provide) {
      stopCheck = provide
    },
    useStage(provide) {
      stageCheck = provide
    },
    useCorrectionNote(provide) {
      correctionNote = provide
    },
  }
  seams.set(ctx.root, seam)

  // 名单空着等于不管，但要说一次，免得以为已经在管了
  if (tuning.allowGroups.length === 0) ctx.logger('qq-channel').info('群白名单为空，所有群都能发')
  if (tuning.allowPeople.length === 0) ctx.logger('qq-channel').info('人白名单为空，所有人都能发')

  registerChannelTools(ctx, {
    status: () => channel.status(),
    send: (text, chatKey) => channel.send(text, chatKey),
    sendForward: (nodes, chatKey) => channel.sendForward(nodes, chatKey),
    forward: { enabled: replyForward, name: forwardName },
    react: (messageId, emoji) => channel.react(messageId, emoji),
    // 单条的字数标准与出站体检的长度闸取同一个数，切出来的每条都过得了那道闸
    split: (text, maxParts) => {
      const parts = splitByBudget(text, {
        maxParts,
        maxCharsPerPart: tuning.maxChars,
        // 切到第几条该停由上面那层判，这里只照做
        ...stopCheck === undefined ? {} : { stop: (index: number) => stopCheck?.(index) === true },
      })
      return { parts, gapsMs: speechGaps(parts) }
    },
    cap: () => capNow(),
    stop: sent => stopCheck?.(sent) === true,
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
    publish: (kind, text, facts) => seam.publish(kind, text, facts),
    requestConfirm: (kind, text, at) => seam.requestConfirm(kind, text, at),
    confirm: (confirmId, at) => seam.confirm(confirmId, at),
    stageFarewell: (text, at) => farewell.stage(text, at),
    read: {
      history: (chatKey, count) => readHistory(channel, chatKey, count),
      members: (chatKey, limit) => readMembers(channel, chatKey, limit),
      message: messageId => readMessage(channel, messageId),
    },
    stickers: {
      list: (tag, limit) => Promise.resolve(listStickers(stickerFile, tag, limit)),
      pick: id => Promise.resolve(stickerOf(stickerFile, id)),
      send: (file, chatKey) => channel.send([{ type: 'image', data: { file } }], chatKey),
    },
    voices: {
      list: (tag, limit) => Promise.resolve(listVoices(voiceFile, tag, limit)),
      pick: id => Promise.resolve(voiceOf(voiceFile, id)),
      send: (file, chatKey) => channel.send([{ type: 'record', data: { file } }], chatKey),
    },
    reply: (messageId, text, chatKey) => channel.send(
      messageId === '' ? [{ type: 'text', data: { text } }] : [{ type: 'reply', data: { id: messageId } }, { type: 'text', data: { text } }],
      chatKey,
    ),
    burst: async (lines, gapsMs, chatKey) => {
      let sent = 0
      for (let at = 0; at < lines.length; at += 1) {
        const line = lines[at]
        if (line === undefined) continue
        const gap = gapsMs[at] ?? 0
        if (gap > 0) await pauseMs(gap)
        const result = await channel.send(line, chatKey)
        if (!result.ok) {
          return {
            ok: false,
            sent,
            ...result.code === undefined ? {} : { code: result.code },
            ...result.reason === undefined ? {} : { reason: result.reason },
          }
        }
        sent += 1
        outbound.record(Date.now())
      }
      return { ok: true, sent }
    },
    messy: async (steps, gapMs, chatKey) => {
      let sent = 0
      // 这一串里自己刚发的最后一条，撤回只认它，不碰更早的消息
      let lastId = ''
      for (const step of steps) {
        if (gapMs > 0 && sent > 0) await pauseMs(gapMs)
        // 「换」自带撤上一句的意思；上一句已经撤过就直接发这句，别再撤一遍
        if (step.action !== 'send' && lastId !== '') {
          const undone = await channel.unsend(lastId)
          if (!undone.ok) {
            return {
              ok: false,
              sent,
              ...undone.code === undefined ? {} : { code: undone.code },
              ...undone.reason === undefined ? {} : { reason: undone.reason },
            }
          }
          lastId = ''
          if (step.action === 'withdraw') continue
        }
        // 单独一个「撤」前面却没发过，就是没得撤
        if (step.action === 'withdraw' && lastId === '') {
          return { ok: false, sent, code: 'messy.nothing_to_withdraw', reason: '前面没有自己刚发的那一条可撤' }
        }
        const result = await channel.send(step.text, chatKey)
        if (!result.ok) {
          return {
            ok: false,
            sent,
            ...result.code === undefined ? {} : { code: result.code },
            ...result.reason === undefined ? {} : { reason: result.reason },
          }
        }
        sent += 1
        lastId = result.messageId ?? ''
        outbound.record(Date.now())
      }
      return { ok: true, sent }
    },
    slang: {
      find: (query, limit) => Promise.resolve(findSlangs(slangFile, query, limit)),
      add: (word, meaning, from, at) => Promise.resolve(addSlang(slangFile, word, meaning, from, at)),
    },
    sayings: {
      find: (query, limit) => Promise.resolve(findSayings(sayingFile, query, limit)),
      add: (text, when, from, at) => Promise.resolve(addSaying(sayingFile, text, when, from, at)),
    },
    unsend: messageId => channel.unsend(messageId),
    recent: () => channel.recentSends(),
    noteCorrection: (wrong, better, at) => { correctionNote?.(wrong, better, at) },
    ...config.pokeEnabled === true ? { poke: async (chatKey: string, userId: string) => {
      const group = chatKey.startsWith('group:') ? Number(chatKey.slice('group:'.length)) : 0
      if (group <= 0) return { ok: false, code: 'poke.not_group', reason: '私聊不戳人', hint: '只在群里戳' }
      const reply = await channel.ask('send_poke', { user_id: Number(userId), group_id: group })
      return reply.ok ? { ok: true } : { ok: false, code: reply.code, reason: reply.reason }
    } } : {},
  })

  channel.start()

  // 卸载时断开
  ctx.effect(() => () => {
    channel.stop()
    seams.delete(ctx.root)
  })
}
