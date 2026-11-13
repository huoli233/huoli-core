// 接 QQ 的装配入口：连上、把消息放进收件箱、把要发的送出去

import fs from 'node:fs'
import path from 'node:path'
import type { Context } from '@huoli/cordis'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { qqPacingOf, REPLY_DEFAULTS, SEMANTIC_DEFAULTS, resolveSemanticSplit, resolveVoiceLimits, speechGaps, splitByBudget, type SemanticSplit } from '@huoli/huoli-qq-pacing'
import { DEFAULTS, type ActionKind } from '@huoli/huoli-qq-self'
import { createWsChannel, type ProactiveSendQuotaProvider, type WsChannel } from './ws.ts'
import {
  asText, hasWords, isPokeNotice,
  toIncoming,
  toGroupMute,
  toPoke,
  toRecall,
  type ChannelStatus,
  type GroupMuteNotice,
  type IncomingMessage,
  type IncomingPoke,
  type IncomingRecall,
  type MessageSegment,
  type OutboundEvent,
  type SentResult,
} from './events.ts'
import { createOutboundCheck, OUTBOUND_DEFAULTS, type OutboundTuning, type OutboundVerdict } from './outbound.ts'
import { ACTION_DEFAULTS, CONFIRM_DEFAULTS, POLICY_DEFAULTS, type ActionFacts, type ActionResult, type ActionTuning, type ActionTunings } from './actions.ts'
import { createActionGate } from './action-gate.ts'
import {
  createActionStore,
  createSendStateStore,
  defaultSendStateFile,
  SEND_STATE_DEFAULTS,
  type SendRecord,
} from './action-store.ts'
import { createSendChain } from './send-chain.ts'
import { createFarewellSlotStore, defaultFarewellSlotFile } from './farewell-slot.ts'
import type { SelfInfo } from './self-info.ts'
import { finalTextOf, hideAccountInText, isBareReply } from './final-text.ts'
import { isPunctuationSpam, reduceChatPunctuation } from './chat-style.ts'
import { forwardTextOf } from './forward.ts'
import { registerChannelTools } from './tools.ts'
import { readForward, readHistory, readMessage } from './read.ts'
import { createGroupInfo, GROUP_INFO_DEFAULTS, type GroupInfoTuning } from './group-info.ts'
import { biliCardPreview, hasRenderableBiliArk } from './bili-card.ts'
import {
  defaultStickerFile,
  defaultStickerUsageFile,
  matchStickers,
  recordStickerUse,
  stickerOf,
} from './stickers.ts'
import { defaultVoiceFile, listVoices, readVoices, sendVoice, voiceOf } from './voices.ts'
import {
  addSlang,
  defaultSlangFile,
  extractSlangCandidates,
  findSlangs,
  pendingSlangs,
  reviewSlang,
  SLANG_DEFAULTS,
  suggestSlangs,
} from './slang.ts'
import { addSaying, defaultSayingFile, findSayings } from './sayings.ts'
import { CATCHUP_DEFAULTS, createCatchup } from './catchup.ts'
import {
  createGroupHistoryPoller,
  createPrivatePoller,
  GROUP_HISTORY_DEFAULTS,
  PRIVATE_POLL_DEFAULTS,
} from './private-poll.ts'

export type { ChannelStatus, GroupMuteNotice, IncomingMessage, IncomingPoke, IncomingRecall, Outgoing, OutboundEvent, SentResult } from './events.ts'
export { asText, attachmentsOf, chatKeyOf, hasWords, isPokeNotice, mentionsSelf, repliesToSelf, textOf, toGroupMute, toIncoming, toPoke, toRecall, traceIdOf } from './events.ts'
export type { IncomingAttachment } from './events.ts'
export { canModerate, GROUP_ROLES, parseGroupRole, roleOfMember } from './group-role.ts'
export type { GroupRole, RoleRead } from './group-role.ts'
export type { OutboundCheck, OutboundInput, OutboundTuning, OutboundVerdict } from './outbound.ts'
export { createOutboundCheck, OUTBOUND_DEFAULTS } from './outbound.ts'
export type { FloodGuard, FloodTuning, FloodTrigger, FloodVerdict } from './flood-guard.ts'
export { createFloodGuard, FLOOD_HINT } from './flood-guard.ts'
export type { ReplyAffect, ReplyMind } from './final-text.ts'
export {
  COMPACT_REPLY_MIND_PARAMETER,
  finalTextOf,
  isBareReply,
  replyMindOf,
  REPLY_MIND_PARAMETER,
} from './final-text.ts'
export type { ActionDelivery, ActionFacts, ActionGate, ActionKind, ActionResult, ActionTuning, ActionTunings } from './actions.ts'
export { ACTION_DEFAULTS, CONFIRM_DEFAULTS, CONFIRM_KINDS, POLICY_DEFAULTS } from './actions.ts'
export type { ActionGateOptions } from './action-gate.ts'
export { createActionGate } from './action-gate.ts'
export type { ActionFingerprint, ActionKindState, ActionState, ActionStore, ActionStoreOptions, PendingAction } from './action-store.ts'
export type { SendFailure, SendOutcome, SendRecord, SendState, SendStateStore, SendStateStoreOptions } from './action-store.ts'
export { ACTION_STATE_VERSION, createActionStore, emptyActionState } from './action-store.ts'
export { createSendStateStore, defaultSendStateFile, SEND_STATE_DEFAULTS, SEND_STATE_VERSION, sendStateLine } from './action-store.ts'
export type { SendChain } from './send-chain.ts'
export { createSendChain } from './send-chain.ts'
export type { FarewellSlot, FarewellSlotOptions, FarewellSlotStore, FarewellStage } from './farewell-slot.ts'
export { createFarewellSlotStore, defaultFarewellSlotFile, FAREWELL_SLOT_VERSION, farewellTextAt, readFarewellSlot } from './farewell-slot.ts'
export type { ProactiveSendQuota, ProactiveSendQuotaProvider, WsChannel, WsHandlers, WsOptions } from './ws.ts'
export { createWsChannel, WS_DEFAULTS } from './ws.ts'
export type { ForwardNode } from './forward.ts'
export type {
  GroupHistoryEvent,
  GroupHistoryOptions,
  GroupHistoryPoller,
  PrivatePoller,
  PrivatePollEvent,
  PrivatePollOptions,
} from './private-poll.ts'
export {
  createGroupHistoryPoller,
  createPrivatePoller,
  groupHistoryMessage,
  GROUP_HISTORY_DEFAULTS,
  privateHistoryMessage,
  PRIVATE_POLL_DEFAULTS,
} from './private-poll.ts'
export type { Catchup, CatchupEvent, CatchupOptions } from './catchup.ts'
export { CATCHUP_DEFAULTS, createCatchup } from './catchup.ts'
export type { SelfInfo, SelfInfoReading, SelfInfoStore, SelfInfoOptions } from './self-info.ts'
export { SELF_INFO_DEFAULTS, selfInfoFact } from './self-info.ts'
import type { FloodTrigger } from './flood-guard.ts'

/** 合并转发的默认值：默认关，打开只影响真的分成两段以上的回复 */
export const FORWARD_DEFAULTS = {
  /** 多段回复要不要合成一条合并转发 */
  replyForward: false,
  /** 模型能否自己选择把几段话合成合并转发 */
  toolEnabled: true,
  /** 合并转发卡片上显示的名字 */
  replyForwardName: '她',
} as const

/** 别处要往收件箱塞消息、要发东西，都从这儿拿 */
export interface QqChannelSeam {
  channel: WsChannel
  /** 机器人自己的 QQ 号 */
  selfId: string
  /** 当前网关昵称、QQ 号、是否读到与读到的时刻，没读到时用配置兜底 */
  selfInfo(): SelfInfo
  /** 当前身份事实，组合包不用改也能挂到系统提示里 */
  selfInfoFact(): string
  status(): ChannelStatus
  /** 收一条消息，返回撤掉的函数 */
  onIncoming(handler: (message: IncomingMessage) => void): () => void
  /** 收一次戳一戳，返回撤掉的函数 */
  onPoke(handler: (poke: IncomingPoke) => void): () => void
  /** 收一次群聊或私聊撤回，返回撤掉的函数 */
  onRecall(handler: (recall: IncomingRecall) => void): () => void
  /** 看发送这一路发生了什么，返回撤掉的函数 */
  onOutbound(handler: (event: OutboundEvent) => void): () => void
  /** 看机器人自己被禁言或解除，返回撤掉的函数 */
  onMute(handler: (notice: GroupMuteNotice) => void): () => void
  /** 当前会话是否还被禁言 */
  mute(chatKey: string): { muted: boolean; until: number } | undefined
  /** 这个会话最近一次发送的结果；没发过、或最近那一次是别的会话时为 undefined */
  lastSend(chatKey: string): SendRecord | undefined
  /** 发一次公共动作，先过级别与这一类动作自己的关卡，再走出站体检 */
  publish(kind: ActionKind, text: string, facts: ActionFacts): Promise<ActionResult>
  /** 往某个会话发一段普通消息；reply 为真时按入站回复处理静默时段 */
  send(text: string, chatKey: string, reply?: boolean): Promise<ActionResult>
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
  /** 接上当前会话的入站回复上下文；没在处理入站轮时回复仍受静默限制。 */
  useReplyContext(provide: ((chatKey: string) => boolean) | undefined): void
  /** 接上「发到第几条就该停」：给了就按它提前收口 */
  useStop(provide: ((sentCount: number) => boolean) | undefined): void
  /** 接上全局急停；返回原因时所有外发动作都拒绝 */
  useEmergencyStop(provide: (() => string | undefined) | undefined): void
  /** 接上主动发送额度；每次实际消息发送前预留，成功后才记数 */
  useProactiveSendQuota(provide: ProactiveSendQuotaProvider | undefined): void
  /** 接上自我层现在的阶段，三类公共动作都按它判能不能发 */
  useStage(provide: (() => string) | undefined): void
  /** 接上「刚改过口」这一笔往哪记，没接就不记 */
  useCorrectionNote(provide: ((wrong: string, better: string, at: number, chatKey: string) => void) | undefined): void
}

/** 这一行接受的配置 */
export interface Config {
  /** QQ 那头连过来的地址 */
  url: string
  /** 机器人自己的 QQ 号 */
  selfId: string
  /** 连接口令，没设就不带 */
  accessToken?: string
  /** 网关没读到身份时用的名字，默认用组合包里那个名字 */
  selfName?: string
  /** 连上后要不要问网关当前身份；默认关，开了会另起一条短连接 */
  selfInfoEnabled?: boolean
  /** 问网关身份等回话多久，默认 5000 毫秒 */
  selfInfoTimeoutMs?: number
  /** 重连后要不要再问一次身份；默认开 */
  selfInfoRefreshOnReconnect?: boolean
  /** 断了之后隔多久重连 */
  reconnectMs?: number
  /** 一段等 QQ 那头回话的超时 */
  callTimeoutMs?: number
  /** 数据根目录，不填按 HUOLI_HOME 定 */
  home?: string
  /** 一条聊天消息最多多少字；默认比出站硬上限更短，方便自然分段 */
  replyPartMaxChars?: number
  /** 不超单条字数时优先塞成一条，不再按句号主动拆段 */
  replySingleMessage?: boolean
  /** 长话按分句拆成几个气泡，短话仍一条；默认开 */
  replySemanticSplit?: boolean
  /** 兼容旧配置；实际只收敛连续重复的标点，不删除正常标点 */
  replyStripWrittenPunctuation?: boolean
  /** 正文短于这个字数就不拆 */
  replySemanticMinChars?: number
  /** 至少几个分句才拆 */
  replySemanticMinPieces?: number
  /** 拆出来短于这个字数的碎片并回邻居 */
  replySemanticMinPartChars?: number
  /** 机器人被禁言的状态放哪，不填用主目录 data */
  muteFile?: string
  /** 多段回复要不要合成一条合并转发 */
  replyForward?: boolean
  /** 模型能否自己调用合并转发工具 */
  forwardToolEnabled?: boolean
  /** 合并转发卡片上显示的名字 */
  replyForwardName?: string
  /** 允许发声的群编号，空表示不限制 */
  allowGroups?: readonly string[]
  /** 群里发 B站小程序卡的总开关；默认关 */
  groupCardEnabled?: boolean
  /** 群卡片是否开放给所有群；默认关 */
  groupCardAllGroups?: boolean
  /** 群卡片允许名单；未开放全部群时，只允许名单里的群 */
  groupCardGroups?: readonly string[]
  /** 允许发声的人编号，空表示不限制 */
  allowPeople?: readonly string[]
  /** 好友私聊事件不可达时，每隔多久从历史接口补一次；0 表示关闭 */
  privatePollMs?: number
  /** 好友私聊轮询的诊断记录放哪，不填就落在数据根目录下的 data */
  privatePollStatusFile?: string
  /** 自己发过的消息编号放哪，不填就落在数据根目录下的 data */
  sentLedgerFile?: string
  /** 跨重启最多保留多少条自发消息编号，默认 200 */
  sendHistoryMax?: number
  /** 每个会话最多返回多少条近期自发消息，默认 20 */
  recentSendMax?: number
  /** 自发消息编号最多保留多久，毫秒，默认 7 天 */
  sentLedgerKeepMs?: number
  /** 首次轮询时从这个 ISO 时刻之后补交漏掉的好友消息 */
  privatePollReplaySince?: string
  /** 上线后每隔多久补一次指定群的近期历史；0 表示关闭 */
  groupHistoryPollMs?: number
  /** 要补历史的群编号，不填就沿用允许发声的群名单 */
  groupHistoryGroups?: readonly string[]
  /** 一次最多补几条群历史 */
  groupHistoryCount?: number
  /** 只补最近多久以内的群历史 */
  groupHistoryMaxAgeMs?: number
  /** 群历史补收的诊断记录放哪 */
  groupHistoryStatusFile?: string
  /** 首次群历史轮询是否回放近期旧消息；默认只建立基线 */
  groupHistoryReplay?: boolean
  /** 连上之后要不要补读断线期间错过的消息；默认开 */
  catchupEnabled?: boolean
  /** 断线补读一次最多补几条 */
  catchupMaxMessages?: number
  /** 断线补读只补多久以内的消息 */
  catchupWindowMs?: number
  /** 断线补读失败后最多再试几次 */
  catchupMaxRetries?: number
  /** 一次最多读几条合并转发内容 */
  forwardMaxNodes?: number
  /** 合并转发最多往里读几层 */
  forwardMaxDepth?: number
  /** 一次最多请求几次转发内容 */
  forwardMaxFetches?: number
  /** 合并转发读出来最多多少字 */
  forwardMaxChars?: number
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
  /** 同一个人连着触发到几条就算在刷，回他这条先挡一下 */
  floodBurstCount?: number
  /** 连发往回看多久 */
  floodBurstWindowMs?: number
  /** 同一个发送者已经回过几条 */
  floodReplyPerSender?: number
  /** 回条数往回看多久 */
  floodReplyWindowMs?: number
  /** 关掉就不管连发，别的关卡照旧 */
  floodGuardEnabled?: boolean
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
  /** 发送结果的状态文件放哪，不填就落在数据根目录下的 data */
  sendStateFile?: string
  /** 发不出去时留几条失败码，够看出是不是一直卡在同一处 */
  sendFailureKeep?: number
  /** 遗书正文的暂存槽放哪，不填就落在数据根目录下的 data */
  farewellFile?: string
  /** 表情包库放哪，不填就落在数据根目录下的 data */
  stickerFile?: string
  /** 表情包使用反馈放哪 */
  stickerUsageFile?: string
  /** 语音库放哪，不填就落在数据根目录下的 data */
  voiceFile?: string
  /** 学来的词放哪，不填就落在数据根目录下的 data */
  slangFile?: string
  /** 是否从普通群消息里自动提取黑话候选 */
  slangAutoLearn?: boolean
  /** 攒够多少条群消息提取一次 */
  slangWindowSize?: number
  /** 一个词至少出现在几条消息里 */
  slangMinMessages?: number
  /** 一个词至少出现几次 */
  slangMinOccurrences?: number
  /** 候选词最少几个字 */
  slangMinWordChars?: number
  /** 候选词最多几个字 */
  slangMaxWordChars?: number
  /** 一次最多提几个候选 */
  slangMaxCandidates?: number
  /** 词表最多留几条 */
  slangMaxItems?: number
  /** 学来的说法放哪，不填就落在数据根目录下的 data */
  sayingFile?: string
  /** 准不准戳人，默认不准；开了也只是多一个动作，不改变判级 */
  pokeEnabled?: boolean
  /** 群资料留多久，毫秒，默认十分钟 */
  groupInfoTtlMs?: number
  /** 成员名片留多久，毫秒，默认五分钟 */
  groupCardTtlMs?: number
  /** 成员集合留多久，毫秒，默认六十秒 */
  groupMembersTtlMs?: number
  /** 引用解析留多久，毫秒，默认十分钟 */
  groupRefTtlMs?: number
  /** 读取失败只留多久，毫秒，默认五秒 */
  groupFailureTtlMs?: number
  /** 群上下文缓存最多几条，超了按最近最少用清 */
  groupCacheMax?: number
  /** 群资料、文件名、公告正文一段最多几个字 */
  groupTextMaxChars?: number
  /** 一次最多列几个群文件 */
  groupFilesMax?: number
  /** 一次最多翻几个群文件夹 */
  groupMaxFolders?: number
  /** 成员集合最多缓存几个 */
  groupMembersMax?: number
  /** 一次最多列几条群公告 */
  groupNoticeMax?: number
  /** 快照一次读几条最近消息 */
  snapshotMaxHistory?: number
  /** 快照里还没接的话最多几条 */
  snapshotMaxUnread?: number
  /** 快照里最近消息最多几条 */
  snapshotMaxRecent?: number
  /** 快照里成员最多几条 */
  snapshotMaxMembers?: number
  /** 快照里活跃者最多几条 */
  snapshotMaxActive?: number
  /** 活跃者往回数几条非自己消息 */
  snapshotActiveWindow?: number
  /** 活跃者取前几名 */
  snapshotActiveTop?: number
  /** 快照整段最多几个字 */
  snapshotMaxChars?: number
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
    floodBurstCount: Math.max(1, config.floodBurstCount ?? OUTBOUND_DEFAULTS.floodBurstCount),
    floodBurstWindowMs: Math.max(0, config.floodBurstWindowMs ?? OUTBOUND_DEFAULTS.floodBurstWindowMs),
    floodReplyPerSender: Math.max(1, config.floodReplyPerSender ?? OUTBOUND_DEFAULTS.floodReplyPerSender),
    floodReplyWindowMs: Math.max(0, config.floodReplyWindowMs ?? OUTBOUND_DEFAULTS.floodReplyWindowMs),
    floodGuardEnabled: config.floodGuardEnabled ?? OUTBOUND_DEFAULTS.floodGuardEnabled,
  }
}

// 群上下文的阈值全从配置摊，没给的按默认值表走
function resolveGroupInfo(config: Config): GroupInfoTuning {
  return {
    groupTtlMs: Math.max(0, config.groupInfoTtlMs ?? GROUP_INFO_DEFAULTS.groupTtlMs),
    cardTtlMs: Math.max(0, config.groupCardTtlMs ?? GROUP_INFO_DEFAULTS.cardTtlMs),
    membersTtlMs: Math.max(0, config.groupMembersTtlMs ?? GROUP_INFO_DEFAULTS.membersTtlMs),
    refTtlMs: Math.max(0, config.groupRefTtlMs ?? GROUP_INFO_DEFAULTS.refTtlMs),
    failureTtlMs: Math.max(0, config.groupFailureTtlMs ?? GROUP_INFO_DEFAULTS.failureTtlMs),
    cacheMax: Math.max(1, config.groupCacheMax ?? GROUP_INFO_DEFAULTS.cacheMax),
    textMaxChars: Math.max(1, config.groupTextMaxChars ?? GROUP_INFO_DEFAULTS.textMaxChars),
    filesMax: Math.max(1, config.groupFilesMax ?? GROUP_INFO_DEFAULTS.filesMax),
    maxFolders: Math.max(0, config.groupMaxFolders ?? GROUP_INFO_DEFAULTS.maxFolders),
    membersMax: Math.max(1, config.groupMembersMax ?? GROUP_INFO_DEFAULTS.membersMax),
    noticeMax: Math.max(1, config.groupNoticeMax ?? GROUP_INFO_DEFAULTS.noticeMax),
    maxHistory: Math.max(1, config.snapshotMaxHistory ?? GROUP_INFO_DEFAULTS.maxHistory),
    maxUnread: Math.max(0, config.snapshotMaxUnread ?? GROUP_INFO_DEFAULTS.maxUnread),
    maxRecent: Math.max(0, config.snapshotMaxRecent ?? GROUP_INFO_DEFAULTS.maxRecent),
    maxMembers: Math.max(0, config.snapshotMaxMembers ?? GROUP_INFO_DEFAULTS.maxMembers),
    maxActive: Math.max(0, config.snapshotMaxActive ?? GROUP_INFO_DEFAULTS.maxActive),
    activeWindow: Math.max(1, config.snapshotActiveWindow ?? GROUP_INFO_DEFAULTS.activeWindow),
    activeTop: Math.max(1, config.snapshotActiveTop ?? GROUP_INFO_DEFAULTS.activeTop),
    maxChars: Math.max(1, config.snapshotMaxChars ?? GROUP_INFO_DEFAULTS.maxChars),
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
  const recalls: Array<(recall: IncomingRecall) => void> = []
  const outboundEvents: Array<(event: OutboundEvent) => void> = []
  const muteEvents: Array<(notice: GroupMuteNotice) => void> = []
  const mutes = new Map<string, GroupMuteNotice>()
  // 每条入站先记进补读器的已见，断线补读时才分得清哪些是真错过的
  const catchupSeen: { note?: (message: IncomingMessage) => void } = {}
  // 同一句入站也要喂给刷屏保护，只数连发，不带正文
  const floodFeed: { note?: (message: IncomingMessage) => void } = {}
  const dispatchIncoming = (message: IncomingMessage): void => {
    if (message.text === '') return
    catchupSeen.note?.(message)
    floodFeed.note?.(message)
    for (const handler of incoming) handler(message)
  }

  // 撤掉就是把这一条从表里拿掉，卸载之后再来消息不会再找到它
  const listen = <T>(list: Array<(value: T) => void>, handler: (value: T) => void): (() => void) => {
    list.push(handler)
    return () => {
      const at = list.indexOf(handler)
      if (at >= 0) list.splice(at, 1)
    }
  }

  // 连接状态不落盘，自发消息编号单独记一份，用来跨重连认出旧消息的引用
  const logger = ctx.logger('qq-channel')
  const home = resolveHuoliHome(config.home)
  // 出站排一条队：这一实例的发送、撤回、连发都按调用顺序走，几串气泡不会交织
  const serial = createSendChain()
  // 发一次记一条最近结果，重启之后仍然知道上一条说完没有
  const sendStateFile = config.sendStateFile
    ?? (process.env.NODE_ENV === 'test' ? undefined : defaultSendStateFile(home))
  const sendStates = createSendStateStore({
    ...sendStateFile === undefined ? {} : { file: sendStateFile },
    failureKeep: config.sendFailureKeep ?? SEND_STATE_DEFAULTS.failureKeep,
  })
  let lastError = ''
  let wasConnected = false
  const sentLedgerFile = config.sentLedgerFile
    ?? (process.env.NODE_ENV === 'test' ? undefined : path.join(home, 'data', 'qq-sent.json'))
  const slangFile = config.slangFile ?? defaultSlangFile(home)
  const slangWindowSize = Math.max(3, config.slangWindowSize ?? 30)
  const slangWindows = new Map<string, string[]>()
  const learnSlang = (message: IncomingMessage): void => {
    if (config.slangAutoLearn === false || message.selfSent || message.history !== undefined) return
    if (!message.chatKey.startsWith('group:') || !hasWords(message.text)) return
    const kept = [...slangWindows.get(message.chatKey) ?? [], message.text.slice(0, 200)]
    if (kept.length < slangWindowSize) {
      slangWindows.set(message.chatKey, kept)
      return
    }
    slangWindows.set(message.chatKey, [])
    const candidates = extractSlangCandidates(kept, {
      minWordChars: config.slangMinWordChars ?? SLANG_DEFAULTS.minWordChars,
      maxWordChars: config.slangMaxWordChars ?? SLANG_DEFAULTS.maxWordChars,
      minMessages: config.slangMinMessages ?? SLANG_DEFAULTS.minMessages,
      minOccurrences: config.slangMinOccurrences ?? SLANG_DEFAULTS.minOccurrences,
      maxCandidates: config.slangMaxCandidates ?? SLANG_DEFAULTS.maxCandidates,
    })
    const created = suggestSlangs(
      slangFile,
      candidates,
      message.chatKey,
      Date.now(),
      config.slangMaxItems ?? SLANG_DEFAULTS.maxItems,
    )
    if (created > 0) logger.info(`群聊黑话候选新增 ${created} 个，等待审核`)
  }
  const afterConnect: { run?: () => void } = {}
  const muteFile = config.muteFile ?? (process.env.NODE_ENV === 'test'
    ? undefined
    : path.join(home, 'data', 'qq-mutes.json'))
  const readMutes = (): GroupMuteNotice[] => {
    if (muteFile === undefined) return []
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(muteFile, 'utf8'))
      if (!Array.isArray(parsed)) return []
      return parsed.flatMap((row) => {
        if (row === null || typeof row !== 'object') return []
        const item = row as Record<string, unknown>
        const chatKey = typeof item.chatKey === 'string' ? item.chatKey : ''
        const until = typeof item.until === 'number' && Number.isFinite(item.until) ? item.until : 0
        const at = typeof item.at === 'number' && Number.isFinite(item.at) ? item.at : 0
        return chatKey !== '' && item.muted === true
          ? [{ chatKey, muted: true, at, until, operatorId: typeof item.operatorId === 'string' ? item.operatorId : '' }]
          : []
      })
    } catch {
      return []
    }
  }
  const writeMutes = (): void => {
    if (muteFile === undefined) return
    try {
      fs.mkdirSync(path.dirname(muteFile), { recursive: true })
      const temporary = `${muteFile}.${process.pid}.tmp`
      fs.writeFileSync(temporary, `${JSON.stringify([...mutes.values()])}\n`, { mode: 0o600 })
      fs.renameSync(temporary, muteFile)
    } catch {
      // 禁言状态写不下时只影响重启恢复，当前进程仍按内存状态拦发送
    }
  }
  for (const notice of readMutes()) {
    if (notice.until === 0 || notice.until > Date.now()) mutes.set(notice.chatKey, notice)
  }

  const channel = createWsChannel(
    {
      url: config.url,
      selfId: config.selfId,
      ...config.selfName === undefined ? {} : { fallbackName: config.selfName },
      ...config.selfInfoEnabled === undefined ? {} : { selfInfoEnabled: config.selfInfoEnabled },
      ...config.selfInfoTimeoutMs === undefined ? {} : { selfInfoTimeoutMs: config.selfInfoTimeoutMs },
      ...config.selfInfoRefreshOnReconnect === undefined ? {} : { selfInfoRefreshOnReconnect: config.selfInfoRefreshOnReconnect },
      ...config.accessToken !== undefined ? { accessToken: config.accessToken } : {},
      ...config.reconnectMs !== undefined ? { reconnectMs: config.reconnectMs } : {},
      ...config.callTimeoutMs !== undefined ? { callTimeoutMs: config.callTimeoutMs } : {},
      ...sentLedgerFile === undefined ? {} : { sentLedgerFile },
      ...config.sendHistoryMax !== undefined ? { sendHistoryMax: config.sendHistoryMax } : {},
      ...config.recentSendMax !== undefined ? { recentSendMax: config.recentSendMax } : {},
      ...config.sentLedgerKeepMs !== undefined ? { sentLedgerKeepMs: config.sentLedgerKeepMs } : {},
    },
    {
      onMessage(raw) {
        const now = Date.now()
        const mute = toGroupMute(raw, config.selfId, now)
        if (mute !== null) {
          if (mute.muted) mutes.set(mute.chatKey, mute)
          else mutes.delete(mute.chatKey)
          writeMutes()
          for (const handler of muteEvents) handler(mute)
          logger.info(mute.muted
            ? `群 ${mute.chatKey} 的禁言状态已生效`
            : `群 ${mute.chatKey} 的禁言状态已解除`)
          return
        }
        const recall = toRecall(raw, config.selfId, now)
        if (recall !== null) {
          for (const handler of recalls) handler(recall)
          return
        }
        const message = toIncoming(raw, config.selfId, now, channel.sentIds())
        if (message !== null) {
          learnSlang(message)
          dispatchIncoming(message)
          return
        }
        const poke = toPoke(raw, now, config.selfId)
        if (isPokeNotice(raw)) {
          const outcome = poke === null ? '被丢弃' : '被识别'
          logger.info(`戳一戳${outcome}：notice_type=${asText(raw.notice_type)}，sub_type=${asText(raw.sub_type)}，target_id=${asText(raw.target_id)}，user_id=${asText(raw.user_id)}，self_id=${config.selfId}`)
          if (poke !== null) for (const handler of pokes) handler(poke)
        }
      },
      onStatus(status) {
        // 只在真的从断开变成连上时补一次，状态反复刷新不重复补
        if (status.connected && !wasConnected) afterConnect.run?.()
        wasConnected = status.connected
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
  // 记一条发送结果：写不进去只影响下一次提示，不挡住这次发送
  const noteSend = (
    result: { ok: boolean; code?: string; reason?: string },
    chatKey: string,
    at = Date.now(),
  ): void => {
    try {
      sendStates.record({
        ok: result.ok,
        at,
        chatKey,
        ...result.code === undefined ? {} : { code: result.code },
        ...result.reason === undefined ? {} : { reason: result.reason },
      })
    } catch (error) {
      logger.warn(`发送结果没记下来：${String(error)}`)
    }
  }
  const preferSingleMessage = config.replySingleMessage === true
  const semanticEnabled = config.replySemanticSplit !== false
  const semanticTuning: SemanticSplit = resolveSemanticSplit({
    ...SEMANTIC_DEFAULTS,
    minChars: config.replySemanticMinChars ?? SEMANTIC_DEFAULTS.minChars,
    minPieces: config.replySemanticMinPieces ?? SEMANTIC_DEFAULTS.minPieces,
    minPartChars: config.replySemanticMinPartChars ?? SEMANTIC_DEFAULTS.minPartChars,
  })
  const partMaxChars = Math.max(
    20,
    Math.min(tuning.maxChars, config.replyPartMaxChars ?? (preferSingleMessage ? tuning.maxChars : 90)),
  )
  const styleText = (text: string, chatKey: string): string => reduceChatPunctuation(text, {
    keepBiliLinks: chatKey.startsWith('private:'),
    stripWrittenPunctuation: config.replyStripWrittenPunctuation === true,
  })
  const hiddenOwner = (process.env.QQ_CREATOR_ID ?? '').trim()
  const ownerChatKey = hiddenOwner === '' ? '' : `private:${hiddenOwner}`
  let replyContextCheck: ((chatKey: string) => boolean) | undefined
  const pacingAllow = (text: string, chatKey: string): { ok: boolean; code?: string; reason?: string; hint?: string; retryAt?: number } =>
    chatKey === ownerChatKey || replyContextCheck?.(chatKey) === true
      ? { ok: true }
      : pacing?.allow(text) ?? { ok: true }
  const outgoingText = (text: string, chatKey: string): string =>
    styleText(hideAccountInText(finalTextOf(text), hiddenOwner), chatKey)
  // 切段必须在收口之前：标点与中文间空格都是分句切点，收口会把它们全清掉
  const splitBody = (text: string, stop?: (index: number) => boolean): string[] => splitByBudget(text, {
    maxParts: capNow(),
    maxCharsPerPart: partMaxChars,
    preferSingle: preferSingleMessage,
    ...semanticEnabled ? { semantic: true, semanticSplit: semanticTuning } : {},
    ...stop === undefined ? {} : { stop },
  })
  // 按小时与按天的配额只有说话规矩一处判，体检去问它，不另存一份阈值与读数
  const outbound = createOutboundCheck(tuning, undefined, undefined, { allow: pacingAllow })
  const muteVerdictOf = (chatKey: string, at = Date.now()): OutboundVerdict | undefined => {
    const mute = mutes.get(chatKey)
    if (mute === undefined || !mute.muted) return undefined
    if (mute.until > 0 && mute.until <= at) {
      mutes.delete(chatKey)
      writeMutes()
      return undefined
    }
    return {
      ok: false,
      code: 'outbound.muted',
      reason: '这个群暂时禁言',
      hint: mute.until > 0 ? '等解除禁言再发' : '等群管理解除禁言',
      ...mute.until > 0 ? { retryAt: mute.until } : {},
    }
  }
  const guardedOutbound = {
    check(input: { chatKey: string; text: string }): OutboundVerdict {
      return muteVerdictOf(input.chatKey) ?? outbound.check(input)
    },
    checkReply(input: { chatKey: string; text: string }): OutboundVerdict {
      return muteVerdictOf(input.chatKey) ?? outbound.checkReply(input)
    },
    record: (chatKey: string, at: number) => { outbound.record(chatKey, at) },
    sawIncoming: (trigger: FloodTrigger) => { outbound.sawIncoming(trigger) },
  }
  floodFeed.note = (message) => {
    guardedOutbound.sawIncoming({
      chatKey: message.chatKey,
      senderId: message.senderId,
      at: message.at,
      selfSent: message.selfSent,
    })
  }
  const privatePollMs = Math.max(0, config.privatePollMs ?? 0)
  const privatePollStatusFile = config.privatePollStatusFile
    ?? path.join(home, 'data', 'qq-private-poll.jsonl')
  const privatePollReplaySince = config.privatePollReplaySince === undefined
    ? undefined
    : Date.parse(config.privatePollReplaySince)
  const privatePoller = privatePollMs === 0
    ? undefined
    : createPrivatePoller({
      peers: tuning.allowPeople,
      intervalMs: Math.max(PRIVATE_POLL_DEFAULTS.minIntervalMs, privatePollMs),
      status: () => channel.status(),
      ask: (action, params) => channel.ask(action, params),
      sentIds: () => channel.sentIds(),
      emit: dispatchIncoming,
      selfId: config.selfId,
      ...privatePollReplaySince === undefined || !Number.isFinite(privatePollReplaySince)
        ? {}
        : { replaySince: privatePollReplaySince },
      log: (message) => { logger.warn(message) },
      report: (event) => {
        try {
          fs.mkdirSync(path.dirname(privatePollStatusFile), { recursive: true })
          fs.appendFileSync(privatePollStatusFile, `${JSON.stringify(event)}\n`, { mode: 0o600 })
        } catch (error) {
          logger.warn(`好友私聊轮询诊断没写成：${String(error)}`)
        }
      },
    })
  const groupHistoryPollMs = Math.max(0, config.groupHistoryPollMs ?? 0)
  const groupHistoryStatusFile = config.groupHistoryStatusFile
    ?? path.join(home, 'data', 'qq-group-history.jsonl')
  const groupHistoryPoller = groupHistoryPollMs === 0
    ? undefined
    : createGroupHistoryPoller({
      groups: config.groupHistoryGroups ?? tuning.allowGroups,
      intervalMs: Math.max(GROUP_HISTORY_DEFAULTS.minIntervalMs, groupHistoryPollMs),
      status: () => channel.status(),
      ask: (action, params) => channel.ask(action, params),
      sentIds: () => channel.sentIds(),
      emit: dispatchIncoming,
      selfId: config.selfId,
      replayInitial: config.groupHistoryReplay === true,
      ...config.groupHistoryCount === undefined ? {} : { count: config.groupHistoryCount },
      ...config.groupHistoryMaxAgeMs === undefined ? {} : { maxAgeMs: config.groupHistoryMaxAgeMs },
      log: (message) => { logger.warn(message) },
      report: (event) => {
        try {
          fs.mkdirSync(path.dirname(groupHistoryStatusFile), { recursive: true })
          fs.appendFileSync(groupHistoryStatusFile, `${JSON.stringify(event)}\n`, { mode: 0o600 })
        } catch (error) {
          logger.warn(`群历史补收诊断没写成：${String(error)}`)
        }
      },
    })
  // 断线补读：连上之后把水位之后错过的消息送回同一条入站链路，不新开一条提示词通道
  const catchup = createCatchup({
    chats: () => [
      ...tuning.allowGroups.map(group => `group:${group}`),
      ...tuning.allowPeople.map(person => `private:${person}`),
    ],
    ask: (action, params) => channel.ask(action, params),
    sentIds: () => channel.sentIds(),
    emit: dispatchIncoming,
    selfId: config.selfId,
    enabled: config.catchupEnabled ?? CATCHUP_DEFAULTS.enabled,
    ...config.catchupMaxMessages === undefined ? {} : { maxMessages: config.catchupMaxMessages },
    ...config.catchupWindowMs === undefined ? {} : { windowMs: config.catchupWindowMs },
    ...config.catchupMaxRetries === undefined ? {} : { maxRetries: config.catchupMaxRetries },
    log: (message) => { logger.info(message) },
  })
  catchupSeen.note = (message) => { catchup.seen(message) }
  afterConnect.run = () => {
    void catchup.run()
    void privatePoller?.pollOnce().catch((error: unknown) => {
      logger.warn(`好友私聊补收启动失败：${String(error)}`)
    })
    void groupHistoryPoller?.pollOnce().catch((error: unknown) => {
      logger.warn(`群历史补收启动失败：${String(error)}`)
    })
  }
  // 多段回复要不要合成一条合并转发：默认关，打开只在真的分成两段以上时才用
  const replyForward = config.replyForward ?? FORWARD_DEFAULTS.replyForward
  const forwardToolEnabled = config.forwardToolEnabled ?? FORWARD_DEFAULTS.toolEnabled
  const forwardName = config.replyForwardName ?? FORWARD_DEFAULTS.replyForwardName

  // 三类动作共用一份状态与一个入口，账不与发言额度共用
  let pauseCheck: () => boolean = () => false
  // 条数上限由组合包每轮给一次，没接上就按分档表的下限发一条
  let replyCap: (() => number) | undefined
  // 发到第几条就该停：由组装那一层按额度、张力与「人家要她别说」判
  let stopCheck: ((sentCount: number) => boolean) | undefined
  // 自我层现在的阶段由组合包接进来，没接上就按那一层默认值表里最保守的一档判
  let stageCheck: (() => string) | undefined
  let correctionNote: ((wrong: string, better: string, at: number, chatKey: string) => void) | undefined
  const capNow = (): number => {
    const cap = replyCap?.()
    return cap === undefined ? REPLY_DEFAULTS.minCap : Math.max(REPLY_DEFAULTS.minCap, Math.floor(cap))
  }
  const actionsFile = config.actionsFile ?? path.join(home, 'data', 'qq-actions.json')
  const actions = createActionGate({
    tunings: resolveActions(config),
    confirmTtlMs: Math.max(0, config.confirmTtlMs ?? CONFIRM_DEFAULTS.ttlMs),
    topics: config.routineTopics ?? POLICY_DEFAULTS.routineTopics,
    allowPeers: config.privateAllowPeers ?? POLICY_DEFAULTS.allowPeers,
    ...resolveStageFloors(config),
    store: createActionStore({ file: actionsFile }),
    outbound: guardedOutbound,
    send: (text, chatKey) => channel.send(text, chatKey),
    paused: () => pauseCheck(),
    stage: () => stageCheck?.(),
  })

  // 遗书正文的暂存槽与三类动作的状态各一份文件，互不影响
  const farewell = createFarewellSlotStore({ file: config.farewellFile ?? defaultFarewellSlotFile(home) })
  // 表情包库、语音库与学到的词各一份文件，没存过就当都是空的
  const stickerFile = config.stickerFile ?? defaultStickerFile(home)
  const stickerUsageFile = config.stickerUsageFile ?? defaultStickerUsageFile(home)
  const voiceFile = config.voiceFile ?? defaultVoiceFile(home)
  const sayingFile = config.sayingFile ?? defaultSayingFile(home)

  // 拆句直接用说话规矩里的纯函数，不依赖它有没有先装好
  const pacing = qqPacingOf(ctx)

  const seamRaw: QqChannelSeam = {
    channel,
    selfId: config.selfId,
    selfInfo() {
      return channel.selfInfo()
    },
    selfInfoFact() {
      return channel.selfInfo().fact
    },
    status() {
      return channel.status()
    },
    onIncoming(handler) {
      return listen(incoming, handler)
    },
    onPoke(handler) {
      return listen(pokes, handler)
    },
    onRecall(handler) {
      return listen(recalls, handler)
    },
    onOutbound(handler) {
      return listen(outboundEvents, handler)
    },
    onMute(handler) {
      return listen(muteEvents, handler)
    },
    mute(chatKey) {
      const verdict = muteVerdictOf(chatKey)
      if (verdict === undefined) return undefined
      return { muted: true, until: verdict.retryAt ?? 0 }
    },
    lastSend(chatKey) {
      const last = sendStates.read()?.last
      if (last === undefined || last.chatKey !== chatKey) return undefined
      return last
    },
    async publish(kind, text, facts) {
      const openedAt = Date.now()
      for (const handler of outboundEvents) handler({ kind: 'attempt', at: openedAt, chatKey: facts.chatKey, count: 0 })
      const result = await actions.publish(kind, text, facts)
      for (const handler of outboundEvents) {
        if (result.ok) {
          const firstSentAt = result.at ?? openedAt
          handler({ kind: 'sent', at: firstSentAt, firstSentAt, chatKey: facts.chatKey, count: 1 })
        }
        else handler({ kind: 'blocked', at: Date.now(), chatKey: facts.chatKey, count: 0, ...result.code === undefined ? {} : { code: result.code }, ...result.retryAt === undefined ? {} : { retryAt: result.retryAt } })
      }
      return result
    },
    // 普通消息只过出站体检、频控与切分，不碰公共动作那套级别与钥匙
    async send(text, chatKey, reply = false) {
      // 先切段再收口：标点、中文间空格、换行都是切点，收口后它们就都没了
      const body = splitBody(hideAccountInText(finalTextOf(text), hiddenOwner))
        .map(part => styleText(part, chatKey))
        .filter(part => part !== '')
        .join('\n')
      const at = Date.now()
      if (body === '') {
        // 被这一轮的条数上限或叫停拦下，不是没正文
        if (stopCheck?.(0) === true) return { ok: true, at, messageId: '' }
        return {
          ok: false,
          code: 'channel.inner_only',
          reason: '这一段只有内心旁白，没有要发给对方的话',
          hint: '正文只写准备发出去的话',
          at,
        }
      }
      // 单个标点是模型明确选择的语气，连着三个以上才算刷屏
      if (isPunctuationSpam(body)) {
        return {
          ok: false,
          code: 'channel.inner_only',
          reason: '一串标点不算一句话',
          hint: '想表达就写一句具体的话',
          at,
        }
      }
      if (chatKey.startsWith('private:') && isBareReply(body)) {
        return {
          ok: false,
          code: 'channel.empty_reply',
          reason: '好友私聊只回单字不算接住对方',
          hint: '换成一句具体反应',
          at,
        }
      }
      if (!channel.status().connected) return { ok: false, code: 'channel.offline', reason: '现在没连上 QQ', hint: '等连上再发', at }
      const input = { chatKey, text: body }
      const inspection = reply ? guardedOutbound.checkReply(input) : guardedOutbound.check(input)
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
      const verdict = pacingAllow(body, chatKey)
      if (!verdict.ok) {
        for (const handler of outboundEvents) handler({ kind: 'blocked', at, chatKey, count: 0, ...verdict.code === undefined ? {} : { code: verdict.code } })
        return {
          ok: false,
          at,
          ...verdict.code === undefined ? {} : { code: verdict.code },
          ...verdict.reason === undefined ? {} : { reason: verdict.reason },
        }
      }
      // 已经切好的每段就是一个气泡，收口在 body 里做完了
      const parts = body.split('\n').filter(part => part !== '')
      // 卡片里每段再单独收一次：markdown 链接与裸网址不进卡片
      const forwardNodes = replyForward
        ? parts.map(part => ({ name: forwardName, content: forwardTextOf(styleText(part, chatKey)) })).filter(node => node.content !== '')
        : []
      // 分成两段以上又开着合并转发：一条发出去，别让对面收一串碎片
      if (forwardNodes.length > 1) {
        const forwardTexts = forwardNodes.map(node => node.content)
        for (const part of forwardTexts) {
          const partInspection = reply
            ? guardedOutbound.checkReply({ chatKey, text: part })
            : guardedOutbound.check({ chatKey, text: part })
          if (!partInspection.ok) {
            for (const handler of outboundEvents) handler({ kind: 'blocked', at: Date.now(), chatKey, count: 0, ...partInspection.code === undefined ? {} : { code: partInspection.code } })
            return {
              ok: false,
              at: Date.now(),
              ...partInspection.code === undefined ? {} : { code: partInspection.code },
              ...partInspection.reason === undefined ? {} : { reason: partInspection.reason },
              ...partInspection.hint === undefined ? {} : { hint: partInspection.hint },
            }
          }
        }
        const batchQuota = pacing?.store.checkBatch(forwardTexts)
        if (batchQuota !== undefined && !batchQuota.ok) {
          for (const handler of outboundEvents) handler({ kind: 'blocked', at: Date.now(), chatKey, count: 0, ...batchQuota.code === undefined ? {} : { code: batchQuota.code } })
          return {
            ok: false,
            at: Date.now(),
            ...batchQuota.code === undefined ? {} : { code: batchQuota.code },
            ...batchQuota.reason === undefined ? {} : { reason: batchQuota.reason },
            ...batchQuota.hint === undefined ? {} : { hint: batchQuota.hint },
          }
        }
        const forwarded = await channel.sendForward(forwardNodes, chatKey)
        if (!forwarded.ok) {
          for (const handler of outboundEvents) handler({ kind: 'blocked', at: Date.now(), chatKey, count: 0, ...forwarded.code === undefined ? {} : { code: forwarded.code } })
          return {
            ok: false,
            at: Date.now(),
            ...forwarded.code === undefined ? {} : { code: forwarded.code },
            reason: forwarded.reason ?? '合并转发没发出去',
            hint: '等一下再发，或者把这一段说短些',
            ...forwarded.outcome === undefined ? {} : { outcome: forwarded.outcome },
          }
        }
        for (const part of forwardTexts) pacing?.spend(part)
        const sentAt = Date.now()
        outbound.record(chatKey, sentAt)
        for (const handler of outboundEvents) handler({ kind: 'sent', at: sentAt, firstSentAt: sentAt, chatKey, count: parts.length })
        return { ok: true, at: sentAt, messageId: forwarded.messageId ?? '' }
      }
      const ids: string[] = []
      let firstSentAt: number | undefined
      const gaps = speechGaps(parts)
      for (const [index, part] of parts.entries()) {
        if (index > 0 && stopCheck?.(ids.length) === true) break
        const gap = gaps[index - 1] ?? 0
        if (gap > 0) await pauseMs(gap)
        const partInspection = reply ? guardedOutbound.checkReply({ chatKey, text: part }) : guardedOutbound.check({ chatKey, text: part })
        if (!partInspection.ok) {
          if (ids.length > 0) for (const handler of outboundEvents) handler({ kind: 'sent', at: Date.now(), ...firstSentAt === undefined ? {} : { firstSentAt }, chatKey, count: ids.length })
          for (const handler of outboundEvents) handler({ kind: 'blocked', at: Date.now(), chatKey, count: 0, ...partInspection.code === undefined ? {} : { code: partInspection.code } })
          return {
            ok: false,
            at: Date.now(),
            ...partInspection.code === undefined ? {} : { code: partInspection.code },
            ...partInspection.reason === undefined ? {} : { reason: `已发 ${ids.length} 条，卡在第 ${index + 1} 条：${partInspection.reason}` },
            ...partInspection.hint === undefined ? {} : { hint: partInspection.hint },
          }
        }
        const sent = await channel.send(part, chatKey)
        if (!sent.ok) {
          if (ids.length > 0) for (const handler of outboundEvents) handler({ kind: 'sent', at: Date.now(), ...firstSentAt === undefined ? {} : { firstSentAt }, chatKey, count: ids.length })
          for (const handler of outboundEvents) handler({ kind: 'blocked', at: Date.now(), chatKey, count: 0, ...sent.code === undefined ? {} : { code: sent.code } })
          return {
            ok: false,
            at: Date.now(),
            ...sent.code === undefined ? {} : { code: sent.code },
            reason: `已发 ${ids.length} 条，卡在第 ${index + 1} 条：${sent.reason ?? '发送失败'}`,
            hint: '换一句短点的，或者等一下再发',
            ...sent.outcome === undefined ? {} : { outcome: sent.outcome },
          }
        }
        firstSentAt ??= Date.now()
        pacing?.spend(part)
        outbound.record(chatKey, Date.now())
        ids.push(sent.messageId ?? '')
      }
      const sentAt = Date.now()
      for (const handler of outboundEvents) handler({ kind: 'sent', at: sentAt, ...firstSentAt === undefined ? {} : { firstSentAt }, chatKey, count: ids.length })
      return { ok: true, at: sentAt, messageId: ids[0] ?? '' }
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
    useReplyContext(provide) {
      replyContextCheck = provide
    },
    useStop(provide) {
      stopCheck = provide
    },
    useEmergencyStop(provide) {
      channel.useSendGuard(provide)
    },
    useProactiveSendQuota(provide) {
      channel.useProactiveSendQuota(provide)
    },
    useStage(provide) {
      stageCheck = provide
    },
    useCorrectionNote(provide) {
      correctionNote = provide
    },
  }

  // 对外的两个总入口都排队：一段多气泡的回复要么整段发完，要么整段排着，中间不插别的动作
  const seam: QqChannelSeam = {
    ...seamRaw,
    publish: (kind, text, facts) => serial.run(async () => {
      const result = await seamRaw.publish(kind, text, facts)
      noteSend(result, facts.chatKey, result.at)
      return result
    }),
    send: (text, chatKey, reply) => serial.run(async () => {
      const result = await seamRaw.send(text, chatKey, reply)
      noteSend(result, chatKey, result.at)
      return result
    }),
  }
  seams.set(ctx.root, seam)

  // 上层按旧写法读服务接口即可看到当前身份；没装提示词这一段就只留读取口
  const prompt = ctx.get('systemPrompt')
  prompt?.section({
    name: 'qq:self-info',
    order: 12,
    text: () => seam.selfInfoFact(),
    interpolate: false,
  })

  // 名单空着等于不管，但要说一次，免得以为已经在管了
  if (tuning.allowGroups.length === 0) ctx.logger('qq-channel').info('群白名单为空，所有群都能发')
  if (tuning.allowPeople.length === 0) ctx.logger('qq-channel').info('人白名单为空，所有人都能发')

  // 表情包、语音、引用、点名都从这里发：整条排队，发出什么结果就记什么结果
  const trackedSend = (
    message: string | readonly MessageSegment[],
    chatKey: string,
    checkReplyText = false,
  ): Promise<SentResult> => serial.run(async () => {
    const body = typeof message === 'string'
      ? outgoingText(message, chatKey)
      : message
    if (body === '') {
      const refused: SentResult = { ok: false, code: 'channel.inner_only', reason: '这一条只有标点或旁白', hint: '换成一句正文' }
      noteSend(refused, chatKey)
      return refused
    }
    const replyText = checkReplyText
      ? typeof body === 'string'
        ? body
        : body.flatMap(segment => segment.type === 'text' && typeof segment.data?.text === 'string' ? [segment.data.text] : []).join('')
      : ''
    const openedAt = Date.now()
    for (const handler of outboundEvents) handler({ kind: 'attempt', at: openedAt, chatKey, count: 1 })
    if (replyText !== '') {
      const inspection = guardedOutbound.checkReply({ chatKey, text: replyText })
      if (!inspection.ok) {
        const refused: SentResult = {
          ok: false,
          ...inspection.code === undefined ? {} : { code: inspection.code },
          ...inspection.reason === undefined ? {} : { reason: inspection.reason },
        }
        for (const handler of outboundEvents) {
          handler({ kind: 'blocked', at: Date.now(), chatKey, count: 0, ...inspection.code === undefined ? {} : { code: inspection.code } })
        }
        noteSend(refused, chatKey)
        return refused
      }
    }
    const sent = await channel.send(body, chatKey)
    if (sent.ok) {
      const firstSentAt = Date.now()
      if (replyText !== '') pacing?.spend(replyText)
      outbound.record(chatKey, firstSentAt)
      for (const handler of outboundEvents) handler({ kind: 'sent', at: firstSentAt, firstSentAt, chatKey, count: 1 })
    } else {
      for (const handler of outboundEvents) {
        handler({ kind: 'blocked', at: Date.now(), chatKey, count: 0, ...sent.code === undefined ? {} : { code: sent.code } })
      }
    }
    noteSend(sent, chatKey)
    return sent
  })

  // 群上下文一份实例：缓存跟着这次装配生灭，不放到模块里
  const groupInfo = createGroupInfo(channel, resolveGroupInfo(config), config.selfId)
  registerChannelTools(ctx, {
    status: () => channel.status(),
    selfId: config.selfId,
    ...config.groupCardEnabled === true
      ? { cardGroup: {
        enabled: true,
        allGroups: config.groupCardAllGroups === true,
        groups: config.groupCardGroups ?? [],
      } }
      : {},
    // 一次工具调用可以整段排到队尾：先排队，再在里面一条条发
    serial: task => serial.run(task),
    // 模型写几行就发几个气泡，这里不合并换行；每一条的结果都记下来
    send: (text, chatKey) => serial.run(async () => {
      const body = outgoingText(text, chatKey)
      const inspection = guardedOutbound.checkReply({ chatKey, text: body })
      if (!inspection.ok) {
        const refused: SentResult = {
          ok: false,
          ...inspection.code === undefined ? {} : { code: inspection.code },
          ...inspection.reason === undefined ? {} : { reason: inspection.reason },
        }
        noteSend(refused, chatKey)
        return refused
      }
      const result = await channel.send(body, chatKey)
      noteSend(result, chatKey)
      return result
    }),
    // 卡片等结构化消息段：原样交给通道，文字收口不碰它
    sendSegments: (segments, chatKey) => serial.run(async () => {
      const result = await channel.send(segments, chatKey)
      noteSend(result, chatKey)
      return result
    }),
    // 让网关生成带 token 的小程序卡；自己拼的 JSON 没有签名，QQ 会提示发送者版本过低
    getMiniAppArk: async (input) => {
      const preview = input.preview.trim() === ''
        ? await biliCardPreview(input.url, {
          timeoutMs: Math.min(config.callTimeoutMs ?? 15_000, 15_000),
        }).catch((error: unknown) => {
          logger.warn(`B站卡片封面没取到：${String(error)}`)
          return ''
        })
        : input.preview
      const reply = await channel.ask('get_mini_app_ark', {
        type: 'bili',
        title: input.title,
        desc: input.desc,
        pic_url: preview,
        jump_url: input.url,
      })
      if (!reply.ok) return reply
      // SnowLuma 回 { data: card }，别的实现可能直接回卡片本身
      const nested = reply.data.data
      if (nested !== undefined && (nested === null || typeof nested !== 'object' || Array.isArray(nested))) {
        return { ok: false, code: 'card.bad_ark', reason: '网关回的卡片不是对象', hint: '换成 qq_send_message 发文字链接' }
      }
      const card = nested === undefined ? reply.data : nested as Record<string, unknown>
      if (Object.keys(card).length === 0) {
        return { ok: false, code: 'card.empty_ark', reason: '网关没生成卡片', hint: '换成 qq_send_message 发文字链接' }
      }
      if (!hasRenderableBiliArk(card)) {
        return { ok: false, code: 'card.incomplete_ark', reason: '网关生成的卡片没有可显示的封面', hint: '换成 qq_send_message 发文字链接' }
      }
      return { ok: true, card }
    },
    inspectReply: (chatKey, text) => {
      const input = { chatKey, text }
      return replyContextCheck?.(chatKey) === true ? guardedOutbound.checkReply(input) : guardedOutbound.check(input)
    },
    sendForward: (nodes, chatKey) => serial.run(async () => {
      const texts = nodes.flatMap(node => typeof node.content === 'string'
        ? [forwardTextOf(node.content)].filter(text => text !== '')
        : node.content.flatMap(segment => segment.type === 'text' && typeof segment.data?.text === 'string' ? [segment.data.text] : []))
      const quotaTexts = texts.length === 0 && nodes.some(node => node.messageId !== undefined) ? ['转发一条群消息'] : texts
      for (const text of quotaTexts) {
        const inspection = guardedOutbound.checkReply({ chatKey, text })
        if (!inspection.ok) {
          return {
            ok: false,
            ...inspection.code === undefined ? {} : { code: inspection.code },
            ...inspection.reason === undefined ? {} : { reason: inspection.reason },
          }
        }
      }
      const quota = pacing?.store.checkBatch(quotaTexts)
      if (quota !== undefined && !quota.ok) {
        return {
          ok: false,
          ...quota.code === undefined ? {} : { code: quota.code },
          ...quota.reason === undefined ? {} : { reason: quota.reason },
        }
      }
      const result = await channel.sendForward(nodes, chatKey)
      if (result.ok) {
        for (const text of quotaTexts) pacing?.spend(text)
        outbound.record(chatKey, Date.now())
      }
      noteSend(result, chatKey)
      return result
    }),
    forward: { enabled: replyForward, toolEnabled: forwardToolEnabled, name: forwardName },
    react: (messageId, emoji) => serial.run(() => channel.react(messageId, emoji)),
    // 单条的字数标准与出站体检的长度闸取同一个数，切出来的每条都过得了那道闸
    split: (text, maxParts, chatKey = '') => {
      // 先按原文切段，再逐段收口：切点只在原文里，收口会把它们全清掉
      const parts = splitByBudget(text, {
        maxParts,
        maxCharsPerPart: partMaxChars,
        preferSingle: preferSingleMessage,
        ...semanticEnabled && !preferSingleMessage ? { semantic: true, semanticSplit: semanticTuning } : {},
        // 切到第几条该停由上面那层判，这里只照做
        ...stopCheck === undefined ? {} : { stop: (index: number) => stopCheck?.(index) === true },
      }).map(part => styleText(part, chatKey)).filter(part => part !== '')
      return { parts, gapsMs: speechGaps(parts) }
    },
    cap: () => capNow(),
    stop: sent => stopCheck?.(sent) === true,
    spend: (text) => {
      pacing?.spend(text)
    },
    allow: (text, chatKey) => {
      return pacingAllow(text, chatKey)
    },
    inspect: (chatKey, text) => guardedOutbound.check({ chatKey, text }),
    account: (chatKey, at) => {
      outbound.record(chatKey, at)
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
      members: (chatKey, limit) => groupInfo.members(chatKey, limit),
      message: messageId => groupInfo.message(messageId),
      forward: forwardId => readForward(channel, forwardId, {
        ...config.forwardMaxNodes === undefined ? {} : { maxNodes: config.forwardMaxNodes },
        ...config.forwardMaxDepth === undefined ? {} : { maxDepth: config.forwardMaxDepth },
        ...config.forwardMaxFetches === undefined ? {} : { maxFetches: config.forwardMaxFetches },
        ...config.forwardMaxChars === undefined ? {} : { maxChars: config.forwardMaxChars },
      }),
    },
    group: groupInfo,
    stickers: {
      list: (request, limit) => Promise.resolve(matchStickers(stickerFile, stickerUsageFile, request, limit)),
      pick: id => Promise.resolve(stickerOf(stickerFile, id)),
      send: (file, chatKey) => trackedSend([{ type: 'image', data: { file } }], chatKey),
      feedback: (id, ok, at) => { recordStickerUse(stickerUsageFile, id, ok, at) },
    },
    voices: {
      list: limit => Promise.resolve(listVoices(voiceFile, limit)),
      pick: id => Promise.resolve(voiceOf(voiceFile, id)),
      // 语音自己一本账：先量时长与字节，再查语音额度，发完回读确认；正文额度一概不动
      send: async (file, chatKey) => {
        const known = readVoices(voiceFile).find(row => row.file === file)
        const outcome = await sendVoice(
          { file, ...known?.durationMs === undefined ? {} : { durationMs: known.durationMs } },
          {
            limits: pacing?.voiceLimits() ?? resolveVoiceLimits(),
            send: target => trackedSend([{ type: 'record', data: { file: target } }], chatKey),
            fetch: async (messageId) => {
              const message = await readMessage(channel, messageId)
              return message.ok
                ? { ok: true, hasRecord: message.message.text.includes('[record]') }
                : { ok: false, code: message.code, reason: message.reason, hint: message.hint }
            },
            ...pacing === undefined ? {} : { quota: { check: () => pacing.voiceAllow(), spend: () => { pacing.voiceSpend() } } },
          },
        )
        if (!outcome.ok) {
          for (const handler of outboundEvents) handler({ kind: 'blocked', at: Date.now(), chatKey, count: 0, code: outcome.code })
          return { ok: false, code: outcome.code, reason: outcome.reason }
        }
        // 只回报确认与时长，文件与播放地址不往外带
        return {
          ok: true,
          confirmed: outcome.confirmed,
          seconds: outcome.seconds,
          ...outcome.messageId === undefined ? {} : { messageId: outcome.messageId },
          ...outcome.note === undefined ? {} : { note: outcome.note },
        }
      },
    },
    reply: (messageId, text, chatKey, mentionUserId) => trackedSend(
      [
        ...messageId === '' ? [] : [{ type: 'reply', data: { id: messageId } }],
        ...mentionUserId === undefined ? [] : [{ type: 'at', data: { qq: mentionUserId } }],
        { type: 'text', data: { text } },
      ],
      chatKey,
      true,
    ),
    mention: (userId, text, chatKey) => trackedSend(
      [{ type: 'at', data: { qq: userId } }, { type: 'text', data: { text } }],
      chatKey,
      true,
    ),
    // 连发的这几句是一个整体：整串排完才轮到别的动作
    burst: (lines, gapsMs, chatKey) => serial.run(async () => {
      let sent = 0
      for (let at = 0; at < lines.length; at += 1) {
        const line = lines[at]
        if (line === undefined) continue
        const gap = gapsMs[at] ?? 0
        if (gap > 0) await pauseMs(gap)
        const result = await trackedSend(line, chatKey, true)
        if (!result.ok) {
          return {
            ok: false,
            sent,
            ...result.code === undefined ? {} : { code: result.code },
            ...result.reason === undefined ? {} : { reason: result.reason },
          }
        }
        sent += 1
      }
      return { ok: true, sent }
    }),
    // 说错、撤回、再发改好的这一整串也排在一起，撤回一定排在它要撤的那条之后
    messy: (steps, gapMs, chatKey) => serial.run(async () => {
      let sent = 0
      // 这一串里自己刚发的最后一条，撤回只认它，不碰更早的消息
      let lastId = ''
      for (const step of steps) {
        if (gapMs > 0 && sent > 0) await pauseMs(gapMs)
        // 「换」自带撤上一句的意思；上一句已经撤过就直接发这句，别再撤一遍
        if (step.action !== 'send' && lastId !== '') {
          const undone = await channel.unsend(lastId, chatKey)
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
        const result = await trackedSend(step.text, chatKey, true)
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
      }
      return { ok: true, sent }
    }),
    slang: {
      find: limit => Promise.resolve(findSlangs(slangFile, limit)),
      pending: limit => Promise.resolve(pendingSlangs(slangFile, limit)),
      add: (word, meaning, from, at) => Promise.resolve(addSlang(slangFile, word, meaning, from, at)),
      review: (word, decision, meaning, reason, at) =>
        Promise.resolve(reviewSlang(slangFile, word, decision, meaning, reason, at)),
    },
    sayings: {
      find: limit => Promise.resolve(findSayings(sayingFile, limit)),
      add: (text, when, from, at) => Promise.resolve(addSaying(sayingFile, text, when, from, at)),
    },
    unsend: (messageId, chatKey) => serial.run(() => channel.unsend(messageId, chatKey)),
    manageDelete: (messageId, chatKey) => serial.run(() => channel.moderateDelete(messageId, chatKey)),
    recent: chatKey => channel.recentSends(chatKey),
    noteCorrection: (wrong, better, at, chatKey) => { correctionNote?.(wrong, better, at, chatKey) },
    ...config.pokeEnabled === true ? { poke: (chatKey: string, userId: string) => serial.run(async () => {
      const group = chatKey.startsWith('group:') ? Number(chatKey.slice('group:'.length)) : 0
      if (group <= 0) return { ok: false, code: 'poke.not_group', reason: '私聊不戳人', hint: '只在群里戳' }
      const reply = await channel.ask('send_poke', { user_id: Number(userId), group_id: group })
      return reply.ok ? { ok: true } : { ok: false, code: reply.code, reason: reply.reason }
    }) } : {},
  })

  channel.start()
  privatePoller?.start()
  groupHistoryPoller?.start()

  // 卸载时断开
  ctx.effect(() => () => {
    privatePoller?.stop()
    groupHistoryPoller?.stop()
    channel.stop()
    seams.delete(ctx.root)
  })
}
