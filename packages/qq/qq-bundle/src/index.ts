// 把各个零件装到一起：规则、每天该做的事、收消息往哪放、每轮留下什么痕迹
import path from 'node:path'
import fs from 'node:fs'
import { FiberState, type Context } from '@huoli/cordis'
import '@huoli/huoli-system-prompt'
import '@huoli/huoli-agent'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { setSandboxMode } from '@huoli/huoli-sandbox-policy'
import { qqAttentionOf } from '@huoli/huoli-qq-attention'
import { stopNowOf } from './speak-gate.ts'
import { qqBalanceOf } from '@huoli/huoli-qq-balance'
import { qqContinuityOf } from '@huoli/huoli-qq-continuity'
import { qqMaterialOf } from '@huoli/huoli-qq-material'
import { localDay, qqMemoryOf } from '@huoli/huoli-qq-memory'
import { qqLongingOf } from '@huoli/huoli-qq-longing'
import { hasWords, qqChannelOf, defaultFarewellSlotFile, sendStateLine } from '@huoli/huoli-qq-channel'
import { registerBiliGate } from './bili-gate.ts'
import { qqPacingOf } from '@huoli/huoli-qq-pacing'
import { qqProactiveOf } from '@huoli/huoli-qq-proactive'
import { qqSubjectOf } from '@huoli/huoli-qq-subject'
import { momentPort, qqSelfOf } from '@huoli/huoli-qq-self'
import { qqVitalsOf } from '@huoli/huoli-qq-vitals'
import { BUNDLE_DEFAULTS } from './defaults.ts'
import { budgetLine, budgetOf, budgetStatusLine, clockOf, defaultRulesPath, qqPanelPortOf, readRules, recordNameCallFromMessage, registerAttentionPrompt, registerBriefingPrompt, registerMaterialPrompts, registerRelationPrompt, registerSelfAwarenessPrompt, restCapOf, speechQuotaLine, stateDriveLine } from './facts.ts'
import { registerVideoInterestPrompt } from './video-interest.ts'
import { bodyEventText, bodyPortOf, registerBodyTools, replyMindImpactOf } from './body-tools.ts'
import { registerStickerPrompts } from './sticker-facts.ts'
import { noteLongingContact, registerLongingBridge } from './longing-bridge.ts'
import { createDecisionLog, createTimeline } from './decisions.ts'
import { createLiveness } from './liveness.ts'
import { defaultMaintenanceLogFile, mirrorPortOf, runMaintenance } from './maintenance.ts'
import { registerMemoryEvents, registerMemoryInjection } from './memory-events.ts'
import { applyChatToolBoundary, attachSelfModeControl, chatVisibleTools, installInteractionModes, SENSITIVE_GROUP_TOOLS, sensitiveGroupToolAllowed } from './tool-whitelist.ts'
import { createDeliveredHistory, createMessageMerger, createWorkQueue, defaultSystemDirectivesPath, personaRulesText, personaVoiceText, readOptionalRules, systemDirective } from './runtime.ts'
import { createChatAgents, createChatWakeHandler } from './chat-agents.ts'
import { registerModelFallback } from './model-fallback.ts'
import { createRoundRuntime } from './rounds.ts'
import { createRoundFinishHandler } from './round-finish.ts'
import { createEmergencyStop } from './emergency-stop.ts'
import { createSelfQuiet } from './self-quiet.ts'
import { LIMITS_DEFAULTS, createLimitsControl } from './limits-control.ts'
import { registerIdentityPrompts } from './identity-prompt.ts'
import { installSelfQuietRuntime, shouldSkipForSelfQuiet } from './self-quiet-runtime.ts'
import { registerComplaintPrompt } from './complaint.ts'
import { createOwnSpeechLog, renderOwnSpeech, unansweredOf } from './own-speech.ts'
import { memoryEmotionOf, resolveEmotionSettings } from './emotion-tier.ts'
import { registerReflectionPass } from './reflection-pass.ts'
import { cancelSelfWait, registerSelfScheduleAgentResolver, scheduleSelfWait, selfScheduleOf } from './self-schedule.ts'
import { agePolicyLine, clockLine, longTaskLine, pluginAdminLine, privateReplyLine, replyMindLine } from './lines.ts'
import { registerRecallHandler } from './recall.ts'
import type { LinkFetchPort } from './weblinks.ts'
import { createBackgroundToolRuntime } from './background-tools.ts'
import { createIncomingRuntime, historyObserveOnly } from './incoming-runtime.ts'
import { createMediaArchive } from './incoming-media.ts'
import { createAsrPort, type AsrPort } from './asr.ts'
import { analyzeVideo } from './video-vision.ts'
import { biliShareLine, claimBiliShare } from './bili-share.ts'
import { installImageSupport, mediaWeightOf, type ImageCapabilityLlmPort } from './image-runtime.ts'
import { createMediaBudget } from './media-budget.ts'
import { registerHighlightTool } from './highlight-tool.ts'
import { registerSelfLessonTool } from './self-lesson.ts'
import { registerRuntimeEnvironmentPrompt, runtimeEnvironmentFacts } from './self-awareness.ts'
import { createSelfHealthRuntime, registerSelfHealthPrompt, registerSelfHealthTool, type SelfHealthIssue, type SelfHealthRuntime, type SelfHealthSnapshot } from './self-health.ts'
import { registerImageGenTool } from './image-gen.ts'
import { createProactiveDelivery, createProactiveSendScope } from './proactive-delivery.ts'
import { AUTONOMOUS_NUDGE_LINE, noteAutonomousSend, pendingSection, registerProactiveTools, type PendingLine, type PendingSectionLimits } from './proactive-tools.ts'
import { installProactiveRuntime } from './self-behavior.ts'
import type { Config, QqBundleSeam } from './types.ts'
export type { Config, BundleDelivery, QqBundleSeam } from './types.ts'
export type { DecisionBlock, DecisionLog, DecisionRecord, TimelineRecord } from './decisions.ts'
export { createDecisionLog } from './decisions.ts'
export { BUNDLE_DEFAULTS } from './defaults.ts'
export {
  createSelfHealthRuntime,
  evaluateSelfHealth,
  registerSelfHealthPrompt,
  registerSelfHealthTool,
  renderSelfHealth,
  renderSelfHealthAlert,
} from './self-health.ts'
export type {
  SelfHealthFacts,
  SelfHealthIssue,
  SelfHealthProbe,
  SelfHealthRuntime,
  SelfHealthRuntimeOptions,
  SelfHealthRuntimeEntryFact,
  SelfHealthServiceFact,
  SelfHealthSnapshot,
  SelfHealthStatus,
  SelfHealthThresholds,
} from './self-health.ts'
export { FAREWELL_NEUTRAL, farewellMetadata, farewellText, farewellWritten } from './farewell.ts'
export type { FarewellAuthor } from './farewell.ts'
export {
  appendMaintenanceLine,
  defaultMaintenanceLogFile,
  ledgerPart,
  maintenanceLine,
  mirrorPortOf,
  runMaintenance,
} from './maintenance.ts'
export type { MaintenanceFacts, MaintenanceInput } from './maintenance.ts'
export {
  INTERACTION_MODE_OPTIONS,
  INTERACTION_MODES,
  registerToolWhitelist,
  TOOL_WHITELIST_OPEN,
} from './tool-whitelist.ts'
export type { InteractionMode, InteractionModeState } from './tool-whitelist.ts'
/** 插件的行名 */
export const name = 'qq-bundle'
/** 要用的内核接口 */
export const inject = ['systemPrompt', 'tools', 'agents', 'agentDefaultModel']
const seams = new WeakMap<Context, QqBundleSeam>()
/**
 * 取轮次记录，未装配时为 undefined
 * @param ctx - 运行环境
 * @returns 排查用的接口
 */
export function qqBundleOf(ctx: Context): QqBundleSeam | undefined {
  return seams.get(ctx.root) ?? seams.get(ctx)
}
/**
 * 把零件装到一起
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const directives = readOptionalRules(config.systemDirectivesFile ?? defaultSystemDirectivesPath())
  const self = qqSelfOf(ctx)
  const personaVoice = self === undefined ? personaVoiceText(config.personaVoiceFile) : ''
  const rulesFile = config.rulesFile ?? defaultRulesPath()
  const postLevel = config.postLevel ?? BUNDLE_DEFAULTS.postLevel
  // 情绪档位只解析一次：记忆抬升与注意力事实读的是同一份门槛
  const emotionSettings = resolveEmotionSettings(config.emotion)
  const adultLongingEnabled = config.adultIntimacyEnabled === true
  const humanActiveWindowMs = Math.max(0, config.humanActiveWindowMs ?? BUNDLE_DEFAULTS.humanActiveWindowMs),
    deliveredHistory = createDeliveredHistory(config.deliveredHistoryMax ?? BUNDLE_DEFAULTS.deliveredHistoryMax)
  const ownerQq = (config.creatorQq ?? '').trim()
  const healthBaselineAt = Date.now()
  const ownerChatKey = ownerQq === '' ? '' : `private:${ownerQq}`
  const ownerUnrestricted = config.ownerUnrestricted ?? BUNDLE_DEFAULTS.ownerUnrestricted
  const isOwnerPrivate = (chatKey: string | undefined): boolean =>
    ownerUnrestricted && ownerChatKey !== '' && chatKey === ownerChatKey
  const activeSenders = new WeakMap<object, readonly string[]>()
  const canUseSensitive = (agent: object | undefined, chatKey: string, toolName: string): boolean => {
    if (toolName.trim().toLowerCase().replace(/-/gu, '_').startsWith('qq_self_')) {
      return agent !== undefined && ownerChatKey !== '' && chatKey === ownerChatKey
    }
    return agent !== undefined
      && sensitiveGroupToolAllowed(toolName, chatKey, activeSenders.get(agent) ?? [], config.groupSensitivePermissions ?? {}, ownerQq)
  }
  const bindSenders = (agent: object, _chatKey: string, senderIds: readonly string[]): (() => void) => {
    const normalized = [...new Set(senderIds.map(id => id.trim()).filter(Boolean))]
    activeSenders.set(agent, normalized)
    return () => {
      if (activeSenders.get(agent) === normalized) activeSenders.delete(agent)
    }
  }
  const configuredTools = config.allowedTools ?? BUNDLE_DEFAULTS.allowedTools
  const ownerSelfRepairTools = config.ownerSelfRepairTools ?? BUNDLE_DEFAULTS.ownerSelfRepairTools
  // 三套工具面：群聊只露聊天与只读，好友私聊多给语音/卡片，主人私聊才给生图、写操作和长任务
  const configuredToolsFor = (chatKey: string): readonly string[] => {
    if (!chatKey.startsWith('private:')) {
      return config.groupAllowedTools !== undefined && config.groupAllowedTools.length > 0
        ? config.groupAllowedTools
        : configuredTools
    }
    if (ownerChatKey !== '' && chatKey === ownerChatKey) {
      const base = config.ownerAllowedTools !== undefined && config.ownerAllowedTools.length > 0
        ? config.ownerAllowedTools
        : config.privateAllowedTools !== undefined && config.privateAllowedTools.length > 0
          ? config.privateAllowedTools
          : configuredTools
      return [...new Set([...base, ...ownerSelfRepairTools])]
    }
    return config.privateAllowedTools !== undefined && config.privateAllowedTools.length > 0
      ? config.privateAllowedTools
      : configuredTools
  }
  ctx.systemPrompt.section({ name: 'qq:system-directives', order: 490, text: directives })
  ctx.systemPrompt.section({
    name: 'qq:plugin-admin',
    order: 491,
    text: context => pluginAdminLine(ownerChatKey !== '' && String(context.agent?.id ?? '') === ownerChatKey),
  })
  ctx.systemPrompt.section({ name: 'qq:intimacy-policy', order: 495, text: agePolicyLine(config.adultIntimacyEnabled ?? BUNDLE_DEFAULTS.adultIntimacyEnabled) })
  ctx.systemPrompt.section({ name: 'qq:persona-voice', order: 497, text: personaVoice })
  ctx.systemPrompt.section({ name: 'qq:rules', order: 500, text: () => readRules(rulesFile) })
  ctx.systemPrompt.section({ name: 'qq:persona-rules', order: 501, text: () => personaRulesText(config.personaRulesEnabled, config.personaRulesFile) })
  // 身体先说话，条数紧跟着：这一轮最多几句排在身体之后、规矩之前
  const vitals = qqVitalsOf(ctx), balance = qqBalanceOf(ctx), pacingSeam = qqPacingOf(ctx)
  const sleepingReplyCap = Math.max(1, config.sleepingReplyCap ?? BUNDLE_DEFAULTS.sleepingReplyCap)
  const restingReplyCap = Math.max(1, config.restingReplyCap ?? BUNDLE_DEFAULTS.restingReplyCap)
  const longing = qqLongingOf(ctx)
  ctx.systemPrompt.context({
    name: 'qq:state-drive',
    order: 1,
    text: () => (config.stateDriveFacts ?? BUNDLE_DEFAULTS.stateDriveFacts) ? stateDriveLine(vitals) : '',
  })
  ctx.systemPrompt.context({ name: 'qq:clock', order: 2, text: () => clockLine() })
  if (config.balanceLevel !== undefined) vitals?.setBalance(config.balanceLevel)
  const livenessFile = config.livenessFile,
    liveness = createLiveness(livenessFile === undefined ? {} : { file: livenessFile })
  vitals?.setExistence(liveness.facts(Date.now()))
  ctx.systemPrompt.section({ name: 'qq:reply-budget', order: 350, text: () => budgetLine(vitals, sleepingReplyCap, restingReplyCap) })
  ctx.systemPrompt.section({ name: 'qq:body-events', order: 355, text: context => systemDirective('QQ_BODY_EVENTS', bodyEventText(memory, vitals, subject, String(context.agent?.id ?? ''))) })
  if (adultLongingEnabled) ctx.effect(() => registerLongingBridge(ctx, longing))
  ctx.systemPrompt.section({ name: 'qq:budget-status', order: 356, text: () => budgetStatusLine(balance?.status()) })
  ctx.systemPrompt.section({
    name: 'qq:speech-quota',
    order: 357,
    text: () => pacingSeam === undefined ? '' : speechQuotaLine(pacingSeam),
  })
  // 三种模式都给一段提示口径，是否进入模型与工具权限由各自的硬边界决定
  const modes = installInteractionModes(ctx, {
    file: config.modeFile ?? path.join(resolveHuoliHome(config.home), BUNDLE_DEFAULTS.modeFile),
    initial: config.interactionMode ?? BUNDLE_DEFAULTS.interactionMode,
    configuredTools: configuredToolsFor,
    canUseSensitive,
    ownerChatKey,
    ownerUnrestricted,
  })

  const decisionsFile = config.decisionsFile ?? path.join(resolveHuoliHome(config.home), 'data', 'qq-decisions.jsonl')
  const decisions = createDecisionLog({ file: decisionsFile })
  const timelineFile = config.timelineFile ?? config.wakeLogFile ?? path.join(resolveHuoliHome(config.home), BUNDLE_DEFAULTS.timelineFile)
  const timeline = createTimeline({ file: timelineFile, warn: ctx.logger('qq-bundle'), maxLines: config.timelineMaxLines ?? BUNDLE_DEFAULTS.timelineMaxLines, retentionMs: config.timelineRetentionMs ?? BUNDLE_DEFAULTS.timelineRetentionMs })
  const noteWake = timeline.record
  const ownSpeechFile = config.ownSpeechFile ?? path.join(resolveHuoliHome(config.home), BUNDLE_DEFAULTS.ownSpeechFile)
  const ownSpeech = createOwnSpeechLog(ownSpeechFile, (message) => { ctx.logger('qq-bundle').warn(message) })
  ctx.effect(() => registerReflectionPass(ctx, (kind, chatKey) => { noteWake(kind, chatKey) }))
  const memory = qqMemoryOf(ctx)
  const attention = qqAttentionOf(ctx)
  const subject = qqSubjectOf(ctx)
  if (vitals !== undefined) ctx.effect(() => registerBodyTools(ctx, bodyPortOf(vitals, subject, attention, longing)))
  const channel = qqChannelOf(ctx)
  const mediaBudget = createMediaBudget({
    file: config.mediaBudgetFile ?? path.join(resolveHuoliHome(config.home), BUNDLE_DEFAULTS.mediaBudgetFile),
    config,
    vitals,
  })
  registerBiliGate(ctx, {
    channel,
    attention,
    creatorQq: config.creatorQq ?? BUNDLE_DEFAULTS.creatorQq,
    selfId: channel?.selfId ?? '',
    enabled: config.biliGateEnabled ?? BUNDLE_DEFAULTS.biliGateEnabled,
    maxChars: config.biliGateMaxChars ?? BUNDLE_DEFAULTS.biliGateMaxChars,
    maxMessages: config.biliGateMaxMessages ?? BUNDLE_DEFAULTS.biliGateMaxMessages,
    capacity: () => {
      const current = mediaBudget.capacity(Date.now(), false)
      return {
        energy: current.energy,
        sleepState: current.sleepState,
        videoHourRemaining: current.videoHourRemaining,
        videoDayRemaining: current.videoDayRemaining,
        videoMinEnergy: config.videoRecognitionMinEnergy ?? BUNDLE_DEFAULTS.videoRecognitionMinEnergy,
      }
    },
    warn: (message) => { ctx.logger('qq-bundle').warn(message) },
  })
  ctx.systemPrompt.section({
    name: 'qq:send-state',
    order: 509,
    text: (context) => {
      const chatKey = String(context.agent?.id ?? '')
      const state = channel?.mute(chatKey)
      if (state !== undefined && state.muted) {
        return `[SYSTEM_LOAD] QQ_SEND_STATE\nSTATE: muted\n${state.until > 0 ? `UNTIL: ${new Date(state.until).toISOString()}\n` : ''}RULE: do_not_attempt_send; wait_for_lift; use_qq_stay_quiet_if_needed`
      }
      // 上一条没发出去就说清楚，发成了这一段就什么都不给
      return sendStateLine(channel?.lastSend(chatKey))
    },
  })
  ctx.systemPrompt.section({
    name: 'qq:long-task',
    order: 511,
    text: (context) => {
      const chatKey = String(context.agent?.id ?? '')
      const listed = (config.ownerAllowedTools ?? []).includes('create_goal')
      return config.longTaskMode !== false && ownerChatKey !== '' && chatKey === ownerChatKey && listed
        ? longTaskLine()
        : ''
    },
  })
  const proactive = qqProactiveOf(ctx), continuity = qqContinuityOf(ctx)
  const attachments = ctx.get('attachments'), web = ctx.get('web') as LinkFetchPort | undefined
  const llm = ctx.get('llm') as ImageCapabilityLlmPort | undefined
  const imageSupport = installImageSupport(ctx, config, llm, () => modes.current() !== 'probability', noteWake, channel?.selfId ?? '', mediaBudget)
  ctx.systemPrompt.section({ name: 'qq:media-capacity', order: 358, text: () => mediaBudget.prompt() })
  ctx.effect(() => () => {
    mediaBudget.flush()
  })
  // 项目图片目录：收到的图片和文件按内容分类落盘，表情包顺手入库，按档位定期清理
  const mediaArchive = createMediaArchive(config, llm)
  const mediaSweepTimer = mediaArchive.sweepIntervalMs <= 0
    ? undefined
    : setInterval(() => { mediaArchive.sweep(Date.now()) }, mediaArchive.sweepIntervalMs)
  mediaSweepTimer?.unref()
  const imageDeepAfterReply = config.imageDeepAfterReply ?? BUNDLE_DEFAULTS.imageDeepAfterReply,
    emergencyFile = config.emergencyStopFile ?? path.join(resolveHuoliHome(config.home), BUNDLE_DEFAULTS.emergencyStopFile)
  const emergency = createEmergencyStop(emergencyFile)
  const quietFile = config.selfQuietFile ?? path.join(resolveHuoliHome(config.home), BUNDLE_DEFAULTS.selfQuietFile)
  const quiet = createSelfQuiet({
    file: quietFile,
    minMinutes: config.selfQuietMinMinutes ?? BUNDLE_DEFAULTS.selfQuietMinMinutes,
    maxMinutes: config.selfQuietMaxMinutes ?? BUNDLE_DEFAULTS.selfQuietMaxMinutes,
    note: (event, detail) => { noteWake(event, '', detail) },
  })
  const deniedTools = config.deniedTools ?? BUNDLE_DEFAULTS.deniedTools
  // 能力事实只列这一轮真能调到的工具：与 chatToolAllowed 用同一份计算，绝不撒谎
  const visibleTools = (chatKey?: string, agent?: object): readonly string[] => {
    const definitions = typeof ctx.tools.definitions === 'function' ? ctx.tools.definitions() : []
    const known = new Set(definitions.map(definition => definition.name))
    if (known.size === 0) return []
    // 没给会话就退回群聊口径：默认敏感能力关闭
    const target = chatKey === undefined || chatKey === '' ? 'group:1' : chatKey
    const configured = configuredToolsFor(target)
    return chatVisibleTools(known, target, configured, deniedTools, true, ownerChatKey, ownerUnrestricted).filter((name) => {
      if (name.startsWith('qq_self_')) return canUseSensitive(agent, target, name)
      return !target.startsWith('group:') || !SENSITIVE_GROUP_TOOLS.has(name) || canUseSensitive(agent, target, name)
    })
  }
  const runtimeEnvironment = runtimeEnvironmentFacts()
  type LoaderFactSource = {
    entries(): Iterable<{
      id: string
      options: { disabled?: boolean }
      fiber?: { state: number }
      subtree?: unknown
    }>
  }
  const runtimeEntries = (): readonly {
    id: string
    carrier: boolean
    active: boolean
    failed: boolean
    disabled: boolean
  }[] => {
    try {
      const loader = (ctx as Context & { loader: LoaderFactSource }).loader
      return [...loader.entries()].map(entry => ({
        id: entry.id,
        carrier: entry.subtree !== undefined,
        active: entry.fiber?.state === FiberState.ACTIVE,
        failed: entry.fiber?.state === FiberState.FAILED,
        disabled: entry.options.disabled === true,
      }))
    } catch {
      return []
    }
  }
  const selfHealthEnabled = config.selfHealthEnabled ?? BUNDLE_DEFAULTS.selfHealthEnabled
  let healthRuntime: SelfHealthRuntime | undefined
  if (selfHealthEnabled) {
    healthRuntime = createSelfHealthRuntime({
      intervalMs: Math.max(30_000, config.selfHealthIntervalMs ?? BUNDLE_DEFAULTS.selfHealthIntervalMs),
      alertCooldownMs: Math.max(60_000, config.selfHealthAlertCooldownMs ?? BUNDLE_DEFAULTS.selfHealthAlertCooldownMs),
      startupDelayMs: Math.max(0, config.selfHealthStartupDelayMs ?? BUNDLE_DEFAULTS.selfHealthStartupDelayMs),
      thresholds: {
        healthyAt: Math.max(1, Math.min(100, config.selfHealthHealthyAt ?? BUNDLE_DEFAULTS.selfHealthHealthyAt)),
        watchAt: Math.max(1, Math.min(100, config.selfHealthWatchAt ?? BUNDLE_DEFAULTS.selfHealthWatchAt)),
        degradedAt: Math.max(0, Math.min(100, config.selfHealthDegradedAt ?? BUNDLE_DEFAULTS.selfHealthDegradedAt)),
      },
      stateFile: config.selfHealthStateFile ?? path.join(resolveHuoliHome(config.home), BUNDLE_DEFAULTS.selfHealthStateFile),
      journalDir: config.selfHealthJournalDir ?? path.join(resolveHuoliHome(config.home), BUNDLE_DEFAULTS.selfHealthJournalDir),
      facts: () => ({
        services: [
          { name: 'system-prompt', ready: ctx.get('systemPrompt') !== undefined },
          { name: 'tools', ready: ctx.get('tools') !== undefined },
          { name: 'loader', ready: runtimeEntries().length > 0 },
          { name: 'agents', ready: ctx.get('agents') !== undefined },
          { name: 'agent-default-model', ready: ctx.get('agentDefaultModel') !== undefined },
          { name: 'llm', ready: ctx.get('llm') !== undefined },
          { name: 'attachments', ready: ctx.get('attachments') !== undefined },
          { name: 'web', ready: ctx.get('web') !== undefined },
          { name: 'qq-channel', ready: qqChannelOf(ctx) !== undefined },
          { name: 'qq-memory', ready: qqMemoryOf(ctx) !== undefined },
          { name: 'qq-self', ready: qqSelfOf(ctx) !== undefined },
          { name: 'qq-vitals', ready: qqVitalsOf(ctx) !== undefined },
        ],
        plugins: runtimeEnvironment.plugins,
        runtimeEntries: runtimeEntries(),
        registeredTools: typeof ctx.tools.definitions === 'function'
          ? ctx.tools.definitions().map(item => item.name)
          : [],
        ownerTools: ownerChatKey === '' ? [] : visibleTools(ownerChatKey, { id: ownerChatKey }),
        timelineFile,
        dataRoot: runtimeEnvironment.dataRoot,
        windowMs: Math.max(60_000, config.selfHealthWindowMs ?? BUNDLE_DEFAULTS.selfHealthWindowMs),
        baselineAt: healthBaselineAt,
      }),
    })
    const runtime = healthRuntime
    ctx.effect(() => registerSelfHealthTool(ctx, runtime))
    registerSelfHealthPrompt(ctx, {
      activeChatKey: context => context.agent?.id ?? '',
      ownerChatKey,
      snapshot: () => runtime.current(),
      ready: () => runtime.ready(),
    })
    runtime.start()
    ctx.effect(() => () => { runtime.close() })
  }
  registerIdentityPrompts(ctx, {
    config,
    channel,
    subject,
    quiet,
    selfName: config.selfName ?? BUNDLE_DEFAULTS.selfName,
    creatorTitle: config.creatorTitle ?? BUNDLE_DEFAULTS.creatorTitle,
    visibleTools,
    activeChatKey: context => context.agent?.id ?? '',
  })
  registerRuntimeEnvironmentPrompt(ctx, {
    activeChatKey: context => context.agent?.id ?? '',
    ownerChatKey,
    visibleTools,
    environment: runtimeEnvironment,
  })
  installSelfQuietRuntime({
    ctx,
    quiet,
    channel,
    minMinutes: config.selfQuietMinMinutes ?? BUNDLE_DEFAULTS.selfQuietMinMinutes,
    maxMinutes: config.selfQuietMaxMinutes ?? BUNDLE_DEFAULTS.selfQuietMaxMinutes,
    ownerChatKey,
    ownerUnrestricted,
    note: noteWake,
  })
  const backgroundToolWake: {
    current: ((chatKey: string, text: string, reason: string, traceIds: readonly string[]) => boolean) | undefined
  } = { current: undefined }
  const backgroundTools = createBackgroundToolRuntime({
    ctx,
    channel,
    config: {
      tools: config.backgroundTools ?? BUNDLE_DEFAULTS.backgroundTools,
      timeoutMs: Math.max(1000, config.backgroundToolTimeoutMs ?? BUNDLE_DEFAULTS.backgroundToolTimeoutMs),
      workingAckText: config.backgroundWorkingAckText ?? BUNDLE_DEFAULTS.backgroundWorkingAckText,
      failureText: config.backgroundFailureText ?? BUNDLE_DEFAULTS.backgroundFailureText,
      maxPerChat: Math.max(1, config.backgroundMaxPerChat ?? BUNDLE_DEFAULTS.backgroundMaxPerChat),
    },
    isStopped: chatKey => emergency.state().active || (!isOwnerPrivate(chatKey) && quiet.remainingMs() > 0),
    note: noteWake,
    setWake: (fn) => { backgroundToolWake.current = fn },
    wake: (chatKey: string, text: string, reason: string, traceIds: readonly string[]) =>
      wake(chatKey, text, reason, [], traceIds, ''),
  })
  const backgroundToolScope = {
    attach(agent: Parameters<typeof applyChatToolBoundary>[1], chatKey: string) {
      const known = new Set(config.backgroundTools ?? BUNDLE_DEFAULTS.backgroundTools)
      if (known.size === 0) return () => {}
      return agent.on('tools/execute', async (exec, next) => {
        if (!known.has(exec.name) || exec.agent === undefined || exec.parent !== undefined) return next()
        const tool = agent.tools.executable(exec.name, exec.agent, exec.toolSet)
        if (tool === undefined) return next()
        const handled = backgroundTools.handle(exec, tool, rounds.traceIdsOf(chatKey))
        if (!handled.accepted) return next()
        return {
          isError: false,
          value: handled.value,
          content: handled.result,
          concludesTurn: true,
        } as never
      })
    },
  }
  ctx.effect(() => () => backgroundTools.close())
  const finishRound = createRoundFinishHandler({
    continuity,
    deepAfterTurn: (chatKey, traceIds) => imageSupport.runtime.deepAfterTurn(chatKey, traceIds),
    isStopped: chatKey => emergency.state().active || (!isOwnerPrivate(chatKey) && quiet.remainingMs() > 0),
    wake: (chatKey, text, reason, media, traceIds, recordedText) =>
      wake(chatKey, text, reason, media, traceIds, recordedText),
    warn: (message, error) => { ctx.logger('qq-bundle').warn(message, String(error)) },
  })
  const proactiveDeliveries = new Map<string, number>()
  // 同一轮同一追踪号只回灌一次发过的原话，避免多步工具循环里重复记
  const settledOwnSpeech = new Set<string>()
  // 改口事实要落回说话的那个会话，这里记最近活跃会话，不新造状态源
  // 群聊里只有同一个人接着说才打断旧轮；别人插话先让旧回复说完，避免每条消息都把上一轮砍掉
  const lastIncomingSender = new Map<string, string>()
  self?.useEmergencyControl(emergency)
  self?.useQqPanel(qqPanelPortOf(
    subject,
    timeline,
    () => asr?.status(),
    () => {
      const snapshot = healthRuntime?.ready() === true ? healthRuntime.current() : undefined
      return snapshot === undefined
        ? undefined
        : {
          score: snapshot.score,
          status: snapshot.status,
          checkedAt: snapshot.at,
          issues: snapshot.issues.map(issue => issue.code),
        }
    },
  ))
  const limitsControl = createLimitsControl({
    file: config.limitsFile ?? path.join(resolveHuoliHome(config.home), BUNDLE_DEFAULTS.limitsFile),
    quiet,
    defaults: {
      ...LIMITS_DEFAULTS,
      proactivePerHour: Math.max(0, Math.floor(config.proactivePerHour ?? LIMITS_DEFAULTS.proactivePerHour)),
      sleepFrom: config.sleepFrom ?? LIMITS_DEFAULTS.sleepFrom,
      sleepUntil: config.sleepUntil ?? LIMITS_DEFAULTS.sleepUntil,
    },
    maxProactivePerHour: Math.max(1, Math.floor(config.proactivePerHourMax ?? 30)),
    onChange: (state) => { ctx.logger('qq-bundle').info('行为约束改成 %s', JSON.stringify(state)) },
    warn: (message) => { ctx.logger('qq-bundle').warn(message) },
  })
  self?.useLimitsControl(limitsControl)
  const proactiveScope = createProactiveSendScope()
  const deliverProactive = createProactiveDelivery({
    proactive,
    channel,
    limits: limitsControl,
    scope: proactiveScope,
    deliveries: proactiveDeliveries,
    history: deliveredHistory,
    postLevel,
    emergencyReason: () => {
      const state = emergency.state()
      return state.active ? state.reason : undefined
    },
    quietRemainingMs: () => quiet.remainingMs(),
    sleeping: () => vitals?.read().asleep === true,
    resting: () => restCapOf(vitals) === 1,
    usageBlocked: () => balance?.status().blocked === true,
    noteTalked: (chatKey) => {
      try {
        vitals?.reactEvents([{ kind: 'talked' }], Date.now(), chatKey)
      } catch (error) {
        ctx.logger('qq-bundle').warn('主动开口后的身体记录没写进去：%s', String(error))
      }
    },
  })
  const detachModeControl = attachSelfModeControl(self, modes)
  const rounds = createRoundRuntime({
    ctx,
    decisions,
    memory,
    channel,
    maxSteps: config.maxSteps ?? BUNDLE_DEFAULTS.maxSteps,
    emotionalOf: () => memoryEmotionOf({ body: vitals?.read(), settings: emotionSettings }).emotional,
    maxRepeatedToolErrors: config.maxRepeatedToolErrors ?? BUNDLE_DEFAULTS.maxRepeatedToolErrors,
    mode: () => modes.current(),
    timeline: noteWake,
    blocked: (chatKey) => {
      const state = emergency.state()
      if (state.active) return state.reason || '全局急停中'
      if (isOwnerPrivate(chatKey)) return undefined
      if (quiet.remainingMs() > 0) return '自己正在安静，等明确唤醒或到期再说'
      const budget = balance?.status()
      return budget?.blocked === true ? '今天的用量已经到上限' : undefined
    },
    requireReply: (chatKey) => {
      if (chatKey.startsWith('private:')) return true
      const latest = attention?.inbox.recent(chatKey, 1)[0]
      return latest?.atMe === true || latest?.replyToBot === true
    },
    onFinished: (event) => {
      const alreadyCounted = proactiveDeliveries.get(event.chatKey) ?? 0
      noteAutonomousSend(event, proactive, alreadyCounted, (error) => { ctx.logger('qq-bundle').warn('主动开口记录没写进去：%s', String(error)) })
      proactiveDeliveries.delete(event.chatKey)
      finishRound(event)
    },
    onMind: replyMindImpactOf(subject?.relations, vitals, attention, config, longing),
    onReflect: (text, chatKey) => {
      continuity?.store.addReflection(chatKey, 'neutral', text)
    },
    onPlan: (plan, chatKey, at) => {
      const selfSchedule = selfScheduleOf(ctx)
      if (selfSchedule !== undefined && plan.cancel !== '') {
        void cancelSelfWait(selfSchedule, chatKey, noteWake).catch((error: unknown) => {
          noteWake('self_wait_failed', chatKey, { action: 'cancel', error: String(error) })
        })
      }
      if (selfSchedule !== undefined && plan.waitMs > 0) {
        void scheduleSelfWait(selfSchedule, chatKey, plan.waitMs, noteWake).catch((error: unknown) => {
          noteWake('self_wait_failed', chatKey, { action: 'schedule', error: String(error) })
        })
      }
      const parts = [
        plan.waitMs > 0 ? `先等一小会儿：${plan.waitMs} 毫秒` : '',
        plan.interrupt === '' ? '' : `打断理由：${plan.interrupt}`,
        plan.cancel === '' ? '' : `收回打算：${plan.cancel}`,
        plan.settle === '' ? '' : `心里整理：${plan.settle}`,
      ].filter(part => part !== '')
      if (parts.length > 0) continuity?.store.addReflection(chatKey, 'neutral', parts.join('；'))
      noteWake('reply_plan', chatKey, { at, ...plan })
    },
    // 每轮结算都调（含长时间停在 running 的轮），不等 completed 才把发过的原话回灌给自己
    onSettled: (event, willFinish) => {
      const key = `${event.chatKey}:${event.traceIds.at(-1) ?? ''}`
      if (event.sent > 0 && event.said.trim() !== '' && !settledOwnSpeech.has(key)) {
        settledOwnSpeech.add(key)
        for (const line of event.said.split('\n').map(part => part.trim()).filter(part => part !== '')) {
          ownSpeech.note({ chatKey: event.chatKey, text: line, kind: 'said', traceId: event.traceIds.at(-1) })
        }
      }
      if (!willFinish) imageSupport.runtime.discard(event.traceIds)
    },
    retryPrivate: (event) => {
      wake(event.chatKey, event.text, 'private-retry', [], [event.traceId], event.original)
    },
    retryGroup: (event) => {
      wake(event.chatKey, event.text, 'group-retry', [], [event.traceId], event.original)
    },
    privateFallbackText: config.privateFallbackText ?? BUNDLE_DEFAULTS.privateFallbackText,
    privateWorkingAck: config.privateWorkingAck ?? BUNDLE_DEFAULTS.privateWorkingAck,
    privateErrorFallbackText: config.privateErrorFallbackText ?? BUNDLE_DEFAULTS.privateErrorFallbackText,
  })
  if (channel !== undefined) {
    ctx.effect(() => {
      channel.useProactiveSendQuota((chatKey) => {
        if (isOwnerPrivate(chatKey)) return undefined
        if (!proactiveScope.has(chatKey) && !rounds.isAutonomousNudge(chatKey)) return undefined
        return limitsControl.reserveProactiveSend(chatKey, Date.now())
      })
      return () => { channel.useProactiveSendQuota(undefined) }
    })
  }
  ctx.systemPrompt.section({
    name: 'qq:private-reply-now',
    order: 510,
    text: context => String(context.agent?.id ?? '').startsWith('private:') ? systemDirective('QQ_PRIVATE_REPLY', privateReplyLine()) : '',
  })
  ctx.systemPrompt.section({
    name: 'qq:reply-mind',
    order: 506,
    text: () => systemDirective('QQ_REPLY_MIND', replyMindLine()),
  })
  const seam: QqBundleSeam = {
    decisions(sinceAt, limit) {
      return decisions.read(sinceAt, limit)
    },
    timeline(traceId, limit) {
      return timeline.read(traceId, limit)
    },
    async deliver(chatKey, id, body) {
      return deliverProactive(chatKey, id, body)
    },
    emergencyStopState() {
      return emergency.state()
    },
    emergencyStop(reason) {
      const state = emergency.stop(reason)
      syncEmergency()
      return state
    },
    resume() {
      emergency.resume()
      syncEmergency()
      return emergency.state()
    },
    interactionMode: () => modes.state(),
    setInteractionMode: mode => modes.set(mode),
    selfHealth: () => healthRuntime?.ready() === true ? healthRuntime.current() : undefined,
    checkSelfHealth: () => healthRuntime?.check(),
  }
  seams.set(ctx.root, seam)
  const wakeQueue = createWorkQueue({
    slots: config.foregroundSlots ?? BUNDLE_DEFAULTS.foregroundSlots,
    perKeyMax: config.queuedPerChat ?? BUNDLE_DEFAULTS.queuedPerChat,
    onEvent(event) {
      if (event.kind === 'started') noteWake('queue_started', event.key, { running: event.running, waiting: event.waiting, traceId: event.traceId, ...(event.waitMs === undefined ? {} : { waitMs: event.waitMs }) })
      else if (event.kind === 'queued') noteWake('queue_waiting', event.key, { running: event.running, waiting: event.waiting, traceId: event.traceId })
      else if (event.kind === 'full') noteWake('queue_full', event.key, { running: event.running, waiting: event.waiting, traceId: event.traceId })
      else if (event.kind === 'failed') noteWake('queue_failed', event.key, { running: event.running, waiting: event.waiting, traceId: event.traceId })
      else noteWake('queue_finished', event.key, { running: event.running, waiting: event.waiting, traceId: event.traceId })
    },
  })
  // 收消息：先记进身体，再放进注意力收件箱，顺便把当前会话记成活跃的那个
  // 精简模式也照常给全部事实段，只是工具面小一些；不再靠关掉事实来「降话痨」
  const featureChatKey = (context: { agent?: { id?: string } }): string => context.agent?.id ?? ''
  const attentionSleeping = (chatKey: string, at: number): boolean => {
    if (isOwnerPrivate(chatKey)) return false
    const state = attention?.store.of(chatKey)
    return state?.wakeMode === 'timed' && state.wakeUntil !== null && at < state.wakeUntil
  }
  registerAttentionPrompt(ctx, { attention, activeChatKey: featureChatKey, vitals, emotion: emotionSettings })
  registerRelationPrompt(ctx, {
    vitals, subject, attention, activeChatKey: featureChatKey,
    ownerQq,
    toneHints: () => {
      const file = config.toneFactsFile ?? BUNDLE_DEFAULTS.toneFactsFile
      return file === '' ? '' : readRules(file)
    },
  })
  registerStickerPrompts(ctx, { config, activeChatKey: featureChatKey, vitals, attention })
  registerBriefingPrompt(ctx, { config, activeChatKey: featureChatKey })
  registerSelfAwarenessPrompt(ctx, { config, activeChatKey: featureChatKey, recent: chatKey => attention?.inbox.recent(chatKey, 30) ?? [], selfId: () => channel?.selfId ?? '', selfLayer: self })
  const chatAgents = createChatAgents(ctx, {
    noteWake,
    prepareAgent: (agent, chatKey) => {
      if (ownerUnrestricted && ownerChatKey !== '' && chatKey === ownerChatKey) {
        setSandboxMode(agent.session, 'danger-full-access')
        noteWake('owner_sandbox_mode', chatKey, { mode: 'danger-full-access' })
      }
      applyChatToolBoundary(
        ctx,
        agent.ctx,
        chatKey,
        configuredToolsFor,
        deniedTools,
        name => canUseSensitive(agent, chatKey, name),
        ownerChatKey,
        ownerUnrestricted,
      )
      backgroundToolScope.attach(agent.ctx, chatKey)
    },
  })
  ctx.effect(() => registerSelfScheduleAgentResolver(ctx, chatAgents, noteWake))
  const wake = createChatWakeHandler({
    agents: chatAgents,
    queue: wakeQueue,
    rounds,
    images: imageSupport.runtime,
    llm,
    hasViewer: imageSupport.viewer !== undefined || imageSupport.complexViewer !== undefined,
    deepAfterReply: imageDeepAfterReply,
    maxImages: Math.max(1, config.visionBatchMaxImages ?? BUNDLE_DEFAULTS.visionBatchMaxImages),
    maxImageBytes: config.visionBatchMaxBytes ?? BUNDLE_DEFAULTS.visionBatchMaxBytes,
    preferConfiguredVision: config.visionAlwaysUseConfiguredModel ?? BUNDLE_DEFAULTS.visionAlwaysUseConfiguredModel,
    visionProvider: config.visionProvider ?? BUNDLE_DEFAULTS.visionProvider,
    visionModel: config.visionModel ?? BUNDLE_DEFAULTS.visionModel,
    visionHighModel: config.visionHighModel ?? BUNDLE_DEFAULTS.visionHighModel,
    ...imageSupport.viewer === undefined ? {} : {
      describe: (image: import('@huoli/huoli-attachment').ImageAttachmentRef, focus: string) => imageSupport.viewer?.(image, { focus }) ?? Promise.resolve(''),
    },
    ...imageSupport.complexViewer === undefined ? {} : {
      describeComplex: (image: import('@huoli/huoli-attachment').ImageAttachmentRef, focus: string) => imageSupport.complexViewer?.(image, { focus }) ?? Promise.resolve(''),
    },
    ...imageSupport.sequenceViewer === undefined ? {} : {
      describeSequence: (images: readonly import('@huoli/huoli-attachment').ImageAttachmentRef[], focus: string) => imageSupport.sequenceViewer?.(images, { focus }) ?? Promise.resolve(''),
    },
    ...imageSupport.sequenceFallbackViewer === undefined ? {} : {
      describeSequenceFallback: (images: readonly import('@huoli/huoli-attachment').ImageAttachmentRef[], focus: string) => imageSupport.sequenceFallbackViewer?.(images, { focus }) ?? Promise.resolve(''),
    },
    isStopped: (chatKey) => {
      const state = emergency.state()
      if (state.active) return state.reason || '全局急停中'
      if (isOwnerPrivate(chatKey)) return undefined
      const left = quiet.remainingMs()
      return left > 0 ? `自己正在安静，还剩 ${Math.max(1, Math.round(left / 60_000))} 分钟` : undefined
    },
    blockedBudget: (chatKey) => {
      if (isOwnerPrivate(chatKey)) return undefined
      const state = balance?.status()
      return state?.blocked === true ? { ratio: state.ratio, metric: state.metric } : undefined
    },
    noteWake,
    bindSenders,
  })
  if (healthRuntime !== undefined && ownerChatKey !== '') {
    const reportHealth = (snapshot: SelfHealthSnapshot, issues: readonly SelfHealthIssue[]): void => {
      if (emergency.state().active || quiet.remainingMs() > 0 || rounds.awake(ownerChatKey)) return
      // 体检只更新可观察事实；它不替模型决定“现在必须对主人说话”。
      noteWake('self_health_observed', ownerChatKey, {
        score: snapshot.score,
        status: snapshot.status,
        issues: issues.map(issue => issue.code),
      })
    }
    healthRuntime.useNotifier(reportHealth)
  }
  const privateMergeMs = Math.max(0, config.privateMergeMs ?? BUNDLE_DEFAULTS.privateMergeMs)
  const groupMergeMs = Math.max(0, config.groupMergeMs ?? BUNDLE_DEFAULTS.groupMergeMs)
  const mergeImmediateChars = Math.max(1, config.mergeImmediateChars ?? BUNDLE_DEFAULTS.mergeImmediateChars)
  const merger = createMessageMerger({
    delayMs: chatKey => chatKey.startsWith('private:') ? privateMergeMs : groupMergeMs,
    maxDelayMs: Math.max(0, config.privateMergeMaxMs ?? BUNDLE_DEFAULTS.privateMergeMaxMs),
    maxChars: Math.max(1, config.mergeMaxChars ?? BUNDLE_DEFAULTS.mergeMaxChars),
    onFlush(message) {
      noteWake('merge_flushed', message.key, { count: message.messages.length, traceIds: message.traceIds })
      const accepted = wake(message.key, message.text, 'incoming', message.attachments, message.traceIds, undefined, { kind: 'user' }, message.senderIds)
      incoming.releaseLinkResults(message.traceIds, accepted)
      if (!accepted) imageSupport.runtime.discard(message.traceIds)
    },
  })
  const asr: AsrPort | undefined = createAsrPort(config, ctx.get('speechToText'), fetch, (message) => {
    ctx.logger('qq-bundle').warn('%s', message)
  })
  if (asr !== undefined) ctx.effect(() => () => { asr.close() })
  const videoEnabled = config.videoVisionEnabled ?? BUNDLE_DEFAULTS.videoVisionEnabled
  const incoming = createIncomingRuntime({
    seenMax: Math.max(1, config.seenMax ?? BUNDLE_DEFAULTS.seenMax),
    attachments,
    web,
    archive: mediaArchive.port,
    linkFetch: config.linkFetch ?? BUNDLE_DEFAULTS.linkFetch,
    mediaMaxBytes: Math.max(1, config.mediaMaxBytes ?? BUNDLE_DEFAULTS.mediaMaxBytes),
    mediaTimeoutMs: Math.max(1, config.mediaTimeoutMs ?? BUNDLE_DEFAULTS.mediaTimeoutMs),
    mediaMaxItems: Math.max(0, config.mediaMaxItems ?? BUNDLE_DEFAULTS.mediaMaxItems),
    ...asr === undefined ? {} : { asr: (data, mediaType) => asr.transcribe(data, mediaType) },
    ...videoEnabled ? {
      analyzeVideo: (data: Uint8Array, mediaType: string, message) => analyzeVideo(data, mediaType, {
        ffmpegPath: config.asrFfmpegPath?.trim() || BUNDLE_DEFAULTS.asrFfmpegPath,
        timeoutMs: config.videoVisionTimeoutMs ?? BUNDLE_DEFAULTS.videoVisionTimeoutMs,
        maxSeconds: message.chatKey.startsWith('group:')
          ? config.groupVideoVisionMaxSeconds ?? BUNDLE_DEFAULTS.groupVideoVisionMaxSeconds
          : config.videoVisionMaxSeconds ?? BUNDLE_DEFAULTS.videoVisionMaxSeconds,
        frameIntervalSeconds: config.videoVisionFrameIntervalSeconds ?? BUNDLE_DEFAULTS.videoVisionFrameIntervalSeconds,
        maxFrames: message.chatKey.startsWith('group:')
          ? config.groupVideoVisionMaxFrames ?? BUNDLE_DEFAULTS.groupVideoVisionMaxFrames
          : config.videoVisionMaxFrames ?? BUNDLE_DEFAULTS.videoVisionMaxFrames,
        maxFrameDimension: config.videoVisionMaxFrameDimension ?? BUNDLE_DEFAULTS.videoVisionMaxFrameDimension,
        maxFrameBytes: config.videoVisionMaxFrameBytes ?? BUNDLE_DEFAULTS.videoVisionMaxFrameBytes,
      }, asr === undefined ? undefined : data => asr.transcribePreparedWav(data)),
      videoAccess: (message) => {
        const group = message.chatKey.startsWith('group:')
        const weight = mediaWeightOf(message, 'photo')
        const quickFrom = Math.max(0, config.imageQuickWeightFrom ?? BUNDLE_DEFAULTS.imageQuickWeightFrom)
        if (weight < quickFrom) {
          noteWake('media_budget_blocked', message.chatKey, {
            traceId: message.traceId, kind: 'video', code: 'media.low_interest', weight, quickFrom,
          })
          return { ok: false, code: 'media.low_interest', reason: '这个视频没有明确观看需求' }
        }
        const decision = mediaBudget.consume({ kind: 'video', at: Date.now(), group, key: message.traceId })
        noteWake('media_budget_check', message.chatKey, {
          traceId: message.traceId,
          kind: 'video',
          ok: decision.ok,
          ...decision.code === undefined ? {} : { code: decision.code },
          energy: decision.energy,
          hourUsed: decision.hourUsed,
          hourMax: decision.hourMax,
          dayUsed: decision.dayUsed,
          dayMax: decision.dayMax,
        })
        return {
          ok: decision.ok,
          ...decision.code === undefined ? {} : { code: decision.code },
          ...decision.reason === undefined ? {} : { reason: decision.reason },
        }
      },
    } : {},
    linkFetchMaxLinks: Math.max(0, config.linkFetchMaxLinks ?? BUNDLE_DEFAULTS.linkFetchMaxLinks),
    linkFetchMaxChars: Math.max(0, config.linkFetchMaxChars ?? BUNDLE_DEFAULTS.linkFetchMaxChars),
    linkFetchTimeoutMs: Math.max(1, config.linkFetchTimeoutMs ?? BUNDLE_DEFAULTS.linkFetchTimeoutMs),
    onLinkResult: (message, text) => { wake(message.chatKey, text, 'link-fetch', [], [message.traceId], '', { kind: 'user' }, [message.senderId]) },
    onImages: (images, message) => imageSupport.runtime.process(images, message),
    stopped: () => emergency.state().active,
    merger,
    report: noteWake,
    timeline,
    warn: (message) => { ctx.logger('qq-bundle').warn('%s', message) },
  })
  let emergencyWasActive = false
  const syncEmergency = (): void => {
    const state = emergency.state()
    if (state.active === emergencyWasActive) return
    emergencyWasActive = state.active
    if (state.active) {
      merger.clear()
      imageSupport.runtime.clear()
      wakeQueue.clearWaiting()
      chatAgents.cancelAll(state.reason || '全局急停')
      backgroundTools.cancelAll(state.reason || '全局急停')
      noteWake('emergency_stop', '', { reason: state.reason })
    } else {
      noteWake('emergency_resume', '')
    }
  }
  syncEmergency()
  const emergencyTimer = setInterval(syncEmergency, Math.max(
    BUNDLE_DEFAULTS.emergencyCheckMs,
    config.emergencyCheckMs ?? BUNDLE_DEFAULTS.emergencyCheckMs,
  ))
  emergencyTimer.unref()
  channel?.useEmergencyStop(() => {
    const state = emergency.state()
    return state.active ? state.reason || '全局急停中' : undefined
  })

  // 卸载时把开过的会话都收掉，不留一条在跑
  ctx.effect(() => () => {
    clearInterval(emergencyTimer)
    if (mediaSweepTimer !== undefined) clearInterval(mediaSweepTimer)
    channel?.useEmergencyStop(undefined)
    merger.close()
    incoming.close()
    imageSupport.runtime.clear()
    wakeQueue.close()
    chatAgents.close()
  })
  if (channel !== undefined) {
    const offIncoming = channel.onIncoming((message) => {
      // 自己发出去的那条会作为 message_sent 推回来，认出来就不再当别人说话叫醒自己
      if (!incoming.begin(message)) return
      attention?.noteHumanSpoke(message.chatKey, message.at)
      const previousSender = lastIncomingSender.get(message.chatKey)
      lastIncomingSender.set(message.chatKey, message.senderId)
      const sameSender = previousSender !== undefined && previousSender === message.senderId
      const interruptsRound = message.chatKey.startsWith('private:')
        || message.atMe
        || message.replyToBot
        || message.isPoke
        || (rounds.awake(message.chatKey) && sameSender)
      if (message.history === undefined && interruptsRound && rounds.interrupt(message.chatKey, '有直接消息进来，旧回复先停')) {
        chatAgents.cancel(message.chatKey, 'new_message_interrupt')
        backgroundTools.cancel(message.chatKey, 'new_message_interrupt')
      }
      const selfSchedule = selfScheduleOf(ctx)
      if (selfSchedule !== undefined && message.history === undefined) {
        void cancelSelfWait(selfSchedule, message.chatKey, noteWake).catch((error: unknown) => {
          noteWake('self_wait_failed', message.chatKey, { action: 'incoming_cancel', error: String(error) })
        })
      }
      subject?.relations.observe({ personId: message.senderId, name: message.senderName, chatKey: message.chatKey, at: message.at })
      // 全局急停、自己声明的安静期和真正睡着先挡；是否命中这条会话的唤醒条件由注意力策略决定。
      if (emergency.state().active) {
        noteWake('emergency_stop_incoming', message.chatKey)
        return
      }
      if (!isOwnerPrivate(message.chatKey) && shouldSkipForSelfQuiet(quiet, message, noteWake)) return
      attention?.inbox.push(message.chatKey, {
        messageId: message.messageId,
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        at: message.at,
        atMe: message.atMe,
        replyToBot: message.replyToBot,
      })
      if (message.history === 'group') noteWake('group_history_observed', message.chatKey)
      if (historyObserveOnly(message, config.groupHistoryWake ?? BUNDLE_DEFAULTS.groupHistoryWake)) return
      if (!isOwnerPrivate(message.chatKey) && config.hardRest !== false && vitals?.read().sleep_state === 'sleeping') {
        const privateWake = message.chatKey.startsWith('private:')
          && (config.privateWakeWhileSleeping ?? BUNDLE_DEFAULTS.privateWakeWhileSleeping)
        if (!privateWake) {
          noteWake('rest_skipped', message.chatKey, { reason: 'sleeping' })
          return
        }
        noteWake('rest_private_wake', message.chatKey, { wakeAfter: vitals.read().wake_after })
      }
      if (adultLongingEnabled) noteLongingContact(longing, message.chatKey, message.text)
      subject?.store.setActive(message.chatKey)
      if (hasWords(message.text) && message.history !== 'group') {
        vitals?.setExistence(liveness.facts(message.at))
        vitals?.react(message.text, message.at)
      }
      const signals = attention?.signals(message.chatKey)
      recordNameCallFromMessage(subject, signals, message)
      const wakeDecision = isOwnerPrivate(message.chatKey)
        ? undefined
        : attention?.shouldWake(message.chatKey, message, signals, message.at, {
          ambientAll: modes.current() === 'autonomous',
        })
      if (wakeDecision?.allow === false) {
        noteWake('wake_skipped', message.chatKey, { reason: wakeDecision.reason })
        return
      }
      if (signals?.novelty.newTopic === true) subject?.noteNovelty(message.at)
      if (hasWords(message.text)) {
        const immediate = message.atMe
          || message.replyToBot
          || message.text.length >= mergeImmediateChars
          || (message.chatKey.startsWith('private:') && /[。！？!?]$/u.test(message.text))
        incoming.prepare(message, immediate)
      }
    })
    const offPoke = channel.onPoke((poke) => {
      merger.flush(poke.chatKey)
      attention?.inbox.push(poke.chatKey, {
        senderId: poke.userId,
        senderName: poke.userId,
        text: '戳了戳我',
        at: poke.at,
        isPoke: true,
      })
      if (!isOwnerPrivate(poke.chatKey) && config.hardRest !== false && vitals?.read().sleep_state === 'sleeping') {
        const privateWake = poke.chatKey.startsWith('private:')
          && (config.privateWakeWhileSleeping ?? BUNDLE_DEFAULTS.privateWakeWhileSleeping)
        if (!privateWake) {
          noteWake('rest_skipped', poke.chatKey, { reason: 'sleeping' })
          return
        }
      }
      const wakeDecision = isOwnerPrivate(poke.chatKey)
        ? undefined
        : attention?.shouldWake(poke.chatKey, {
          chatKey: poke.chatKey,
          senderId: poke.userId,
          text: '戳了戳我',
          at: poke.at,
          isPoke: true,
        }, undefined, poke.at, { ambientAll: modes.current() === 'autonomous' })
      if (wakeDecision?.allow === false) {
        noteWake('wake_skipped', poke.chatKey, { reason: wakeDecision.reason })
        return
      }
      subject?.store.setActive(poke.chatKey)
      wake(poke.chatKey, '有人戳了戳我', 'poke', [], [`${poke.chatKey}#poke-${poke.at}`], undefined, { kind: 'user' }, [poke.userId])
    })
    const offRecall = registerRecallHandler({
      channel,
      attention,
      subject,
      mode: () => modes.current(),
      sleeping: chatKey => !isOwnerPrivate(chatKey) && config.hardRest !== false && vitals?.read().sleep_state === 'sleeping',
      flush: (chatKey) => { merger.flush(chatKey) },
      noteWake,
      wake,
    })
    // 发送那一路只记事实：调没调、发了几条、被哪条安全边界拦下
    const offOutbound = channel.onOutbound((event) => {
      rounds.outbound(event)
      if (event.kind === 'sent' && event.count > 0) attention?.noteSelfSpoke(event.chatKey, event.at, event.count)
    })
    ctx.effect(() => () => {
      offIncoming()
      offPoke()
      offRecall()
      offOutbound()
    })
  }
  registerModelFallback(ctx, {
    primaryProvider: config.primaryProvider ?? BUNDLE_DEFAULTS.primaryProvider,
    primaryModel: config.primaryModel ?? BUNDLE_DEFAULTS.primaryModel,
    fallbackProvider: config.fallbackProvider ?? BUNDLE_DEFAULTS.fallbackProvider,
    fallbackModel: config.fallbackModel ?? BUNDLE_DEFAULTS.fallbackModel,
    retryBackMs: config.fallbackRetryMs ?? BUNDLE_DEFAULTS.fallbackRetryMs,
    note: (event, detail) => { noteWake(event, '', detail) },
  })
  registerMemoryEvents(ctx, {
    config,
    defaults: BUNDLE_DEFAULTS,
    memory,
    subject,
    vitals,
    channel,
    selfLayer: qqSelfOf(ctx),
    postLevel,
    farewellFile: config.farewellFile ?? defaultFarewellSlotFile(config.home),
  })
  // 主动开口：每轮收尾与每次入站后（按节流）问一次要不要开口，它关着就一次都不问
  const material = qqMaterialOf(ctx)
  // 现场素材与上次的话头也只当事实说给模型，接不接由它定
  const activeChatKey = featureChatKey
  registerMaterialPrompts(ctx, {
    activeChatKey: context => activeChatKey(context),
    material,
    continuity,
    subject,
    recent: chatKey => attention?.inbox.recent(chatKey, 30) ?? [],
  })
  registerVideoInterestPrompt(ctx, { config, activeChatKey, recent: chatKey => attention?.inbox.recent(chatKey, 30) ?? [], selfId: () => channel?.selfId ?? '', material, timelineFile })
  // 发牢骚那一段只摆事实：有没有过线的驱力、有哪些具体事由，判断权归模型
  registerComplaintPrompt(ctx, { activeChatKey, vitals, attention, subject, selfId: channel?.selfId, config: config.complaint })
  // 自己说过的话只在本地记数与去重，整句原话绝不回灌提示词，免得模型照着复读；认错与放下仍由模型自己定
  ctx.systemPrompt.section({
    name: 'qq:own-speech',
    order: 346,
    text: (context) => {
      const chatKey = String(context.agent?.id ?? '')
      if (chatKey === '') return ''
      const now = Date.now()
      const facts = ownSpeech.read(chatKey, now)
      const ignored = unansweredOf(attention?.inbox.recent(chatKey, 30) ?? [], channel?.selfId ?? '', now)
      return renderOwnSpeech({
        ...facts,
        unanswered: ignored.length === 0 ? facts.unanswered : ignored.map(item => ({ text: '', at: item.at, since: now - item.at })).slice(-3),
      }, now)
    },
  })
  // 很久没跟这个人说话：只摆事实，发不发牢骚由模型决定
  ctx.systemPrompt.section({
    name: 'qq:idle',
    order: 347,
    text: (context) => {
      const chatKey = activeChatKey(context)
      if (!chatKey.startsWith('private:')) return ''
      const last = attention?.inbox.recent(chatKey, 1)[0]
      if (last === undefined) return ''
      const minutes = Math.floor((Date.now() - last.at) / 60_000)
      if (minutes < 120) return ''
      // 只给间隔，不回灌上一句原话：整句回灌会让模型照着复读
      return [
        '[DATA] QQ_IDLE',
        `LAST_CONTACT_MINUTES_AGO: ${minutes}`,
        'RULE: 这只是一个时间间隔事实；说不说、说什么全由你按现场自己定，不要照抄旧话。',
      ].join('\n')
    },
  })
  // B站自己逛完留下的推荐：只在主人私聊里给一次，也能主动叫醒一次，发不发由她决定
  const biliShare = (() => {
    let share: ReturnType<typeof claimBiliShare> | undefined
    let claimed = false
    return (): typeof share => {
      if (!claimed) {
        claimed = true
        share = claimBiliShare(config.biliShareFile ?? '')
      }
      return share
    }
  })()
  ctx.systemPrompt.section({
    name: 'qq:bili-share',
    order: 348,
    text: (context) => {
      const chatKey = activeChatKey(context)
      if (ownerChatKey === '' || chatKey !== ownerChatKey) return ''
      const pending = biliShare()
      return pending === undefined ? '' : biliShareLine(pending)
    },
  })
  let lastBiliShareWakeAt = 0
  const biliShareWakeMs = Math.max(60_000, config.biliShareWakeMs ?? BUNDLE_DEFAULTS.biliShareWakeMs)
  const biliShareWatcher = setInterval(() => {
    if (ownerChatKey === '' || emergency.state().active || quiet.remainingMs() > 0) return
    const at = Date.now()
    const pending = biliShare()
    if (pending === undefined || at - lastBiliShareWakeAt < biliShareWakeMs) return
    const body = vitals?.read()
    if (
      (!isOwnerPrivate(ownerChatKey) && body?.asleep === true)
      || attentionSleeping(ownerChatKey, at)
      || rounds.awake(ownerChatKey)
    ) return
    lastBiliShareWakeAt = at
    wake(ownerChatKey, `${AUTONOMOUS_NUDGE_LINE}\n${biliShareLine(pending)}`, 'bili-share')
  }, 60_000)
  biliShareWatcher.unref()
  ctx.effect(() => () => { clearInterval(biliShareWatcher) })
  // 晚上十点后还没写今天的日记：只提醒一次，写不写由她
  ctx.systemPrompt.section({
    name: 'qq:diary-due',
    order: 349,
    text: (context) => {
      const chatKey = activeChatKey(context)
      if (ownerChatKey === '' || chatKey !== ownerChatKey) return ''
      const now = new Date()
      if (now.getHours() < 22) return ''
      const day = localDay(now.getTime())
      const file = path.join(resolveHuoliHome(config.home), 'data', 'qq-self', 'diary', `${day.slice(0, 7)}.md`)
      try {
        if (fs.readFileSync(file, 'utf8').includes(day)) return ''
      } catch { /* 这个月还没写过 */ }
      return [
        '[DATA] DIARY_DUE',
        `DATE: ${day}`,
        'RULE: 今天还没写日记；想写就用 self_diary 记一段只给自己看的，不想写就跳过。不要为了打卡硬写。',
      ].join('\n')
    },
  })
  // 攒着的由头要真的进提示词，模型才看得见；投递也做成工具，别让它只停在接缝上
  const proactivePorts = {
    activeChatKey: (context: { agent?: { id?: string } }) => activeChatKey(context),
    pending: (chatKey: string): readonly PendingLine[] => proactive === undefined || !limitsControl.state().proactiveAllowed
      ? []
      : proactive.pending.live(chatKey).map(item => ({
        id: item.id,
        why: item.why,
        text: item.text,
        source: item.facts.source,
        kind: item.facts.kind,
        ...item.facts.postWant === undefined ? {} : { postWant: item.facts.postWant },
        ...item.facts.confidence === undefined ? {} : { confidence: item.facts.confidence },
        ...item.facts.value === undefined ? {} : { value: item.facts.value },
        ...item.facts.risk === undefined ? {} : { risk: item.facts.risk },
      })),
    deliver: async (chatKey: string, id: string, body?: string) => {
      const result = await seam.deliver(chatKey, id, body)
      return {
        ok: result.ok,
        ...result.code === undefined ? {} : { code: result.code },
        ...result.reason === undefined ? {} : { reason: result.reason },
        ...result.hint === undefined ? {} : { hint: result.hint },
      }
    },
    requestBody: (chatKey: string, line: PendingLine) => wake(
      chatKey,
      [
        '[QQ_PROACTIVE_BODY]',
        `候选编号：${line.id}`,
        `由头：${line.why}`,
        `来源：${line.source}；种类：${line.kind}`,
        '这一条还没有正文。按由头写出一句想发给对方的话，再用 qq_deliver_proactive 传同一编号与 body 重新投；不想发就什么都不做。',
      ].join('\n'),
      'proactive-body-request',
      [],
      [`${chatKey}#proactive-${line.id}`],
      '',
    ),
  }
  const pendingLimits: PendingSectionLimits = {
    maxLines: config.pendingMaxLines ?? BUNDLE_DEFAULTS.pendingMaxLines,
    maxChars: config.pendingMaxChars ?? BUNDLE_DEFAULTS.pendingMaxChars,
    dedupeByWhy: config.pendingDedupeByWhy ?? BUNDLE_DEFAULTS.pendingDedupeByWhy,
  }
  ctx.systemPrompt.section({
    name: 'qq:proactive-pending',
    order: 360,
    text: (context) => {
      const chatKey = proactivePorts.activeChatKey(context)
      const pending = pendingSection(proactivePorts, chatKey, pendingLimits)
      if (pending === '' || chatKey === '') return pending
      const at = Date.now()
      return `${pending}\nPROACTIVE_HOUR_USAGE: ${limitsControl.proactiveSentThisHour(chatKey, at)}/${limitsControl.state().proactivePerHour}`
    },
  })
  ctx.effect(() => registerProactiveTools(ctx, proactivePorts))
  // 高亮片段：B站插件截好图，这里只按编号读那一份并进合并转发
  ctx.effect(() => registerHighlightTool(ctx, {
    channel,
    selfName: config.selfName ?? channel?.selfInfo().nickname ?? '小鲸鱼',
  }))
  // 自学记录：独立 SQLite，按「对象.方面」覆盖旧结论
  ctx.effect(() => registerSelfLessonTool(ctx,
    config.selfLessonFile ?? path.join(resolveHuoliHome(config.home), 'data', 'self-lessons.db')))
  // 生图：只在主人私聊，凭证在进程内读，不交给模型
  ctx.effect(() => registerImageGenTool(ctx, { channel, config, ownerQq: config.creatorQq ?? '' }))
  const proactiveRuntime = installProactiveRuntime({
    ctx,
    config,
    ownerChatKey,
    activeChatKey: context => activeChatKey(context),
    decisions,
    noteWake,
    emergency,
    quiet,
    balance,
    proactive,
    vitals,
    subject,
    attention,
    material,
    continuity,
    memory,
    limits: limitsControl,
    deliveredHistory,
    rounds,
    channel,
    incomingPending: chatKey => incoming.busy(chatKey),
    humanActiveWindowMs,
    attentionSleeping,
    wake,
  })
  const considerProactive = (chatKey: string, at: number, busy: boolean, throttled: boolean): void => {
    proactiveRuntime.consider(chatKey, at, busy, throttled)
  }
  const nudgeMs = proactiveRuntime.nudgeMs

  // 每天一次：先核对镜像前的记录，再掉重要度、定清晰度、清正文、补记录，接着镜像、记进记录表、再核一次
  // 镜像只往记忆库写，证据回查要用的现役编号也从记忆仓取，接上以后每日整理才会带上它
  if (self !== undefined) self.useMemory(memory === undefined ? undefined : mirrorPortOf(memory))
  // 面板的此刻只问身体：身体那几行压成一句再交过去
  if (self !== undefined && vitals !== undefined) self.useVitals(momentPort(vitals))
  const maintenanceLogFile = config.maintenanceLogFile ?? defaultMaintenanceLogFile(config.home)
  const sweepAt = clockOf(config.dailySweepAt, BUNDLE_DEFAULTS.dailySweepAt, ctx)
  // 每分钟看一眼：越过设定时刻后补做当天整理，避免进程启动或调度延迟错过整分钟
  let lastSweepDay = ''
  let lastNudgeAt = 0
  const idle = setInterval(() => {
    if (emergency.state().active) return
    const now = new Date()
    const at = Date.now()
    const active = subject?.store.read().lastActive ?? ''
    // 没人说话的那几个钟头里也得有人问她一句：开不开口由主动那一路的间隔与额度定
    if (at - lastNudgeAt >= nudgeMs && active !== '') {
      lastNudgeAt = at
      considerProactive(active, at, false, false)
    }
    const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
    if (day === lastSweepDay || now.getHours() * 60 + now.getMinutes() < sweepAt.hour * 60 + sweepAt.minute) return
    lastSweepDay = day
    try {
      runMaintenance({ at: Date.now(), memory, self, relations: subject?.relations, logFile: maintenanceLogFile })
    } catch (error) {
      // 每天这一步失手就记一行，别让定时器把整个进程带走
      ctx.logger('qq-bundle').warn('每天整理没做完：%s', String(error))
    }
    // 每天这一次也是例行时刻：想发动态的劲攒够了就在这里交给她
    if (active !== '') considerProactive(active, Date.now(), false, false)
  }, 60_000)
  idle.unref()
  ctx.effect(() => () => {
    clearInterval(idle)
  })

  // 停手时动态一条都不发：发布入口只认这一句
  channel?.usePause(() => self?.isPaused() ?? false)
  // 阶段只由自我层说：私信那一档按它判能不能发，没接上就按那一层默认值表里最保守的一档
  if (self !== undefined) channel?.useStage(() => self.stage())
  // 刚改过口就记一笔：既给自我层复盘，也作为「自己说过的话」的事实摆回来，由模型自己认、自己改
  channel?.useCorrectionNote((wrong, better, at, chatKey) => {
    if (self !== undefined) self.recordError(wrong, better, at)
    if (chatKey !== '') ownSpeech.note({ at, chatKey, text: `把「${wrong}」改成「${better}」`, kind: 'corrected' })
  })
  channel?.useReplyCap(() => budgetOf(vitals, sleepingReplyCap, restingReplyCap))
  channel?.useReplyContext(chatKey => rounds.awake(chatKey))
  channel?.useStop(stopNowOf(budgetOf(vitals, sleepingReplyCap, restingReplyCap)))

  // 记忆单独作为当前会话快照提供，不改写用户原话
  if (config.memoryInject ?? BUNDLE_DEFAULTS.memoryInject) registerMemoryInjection(ctx, memory, {
    maxChars: Math.max(0, config.memoryInjectMaxChars ?? BUNDLE_DEFAULTS.memoryInjectMaxChars),
    maxItems: Math.max(1, config.memoryInjectMaxItems ?? BUNDLE_DEFAULTS.memoryInjectMaxItems),
    repeatTurns: Math.max(1, config.memoryInjectRepeatTurns ?? BUNDLE_DEFAULTS.memoryInjectRepeatTurns),
    enabled: () => modes.current() !== 'probability',
  })

  // 卸载时把手上这一轮也落下去，别丢
  ctx.effect(() => () => {
    rounds.close()
    channel?.useReplyContext(undefined)
    self?.useEmergencyControl(undefined)
    self?.useQqPanel(undefined)
    self?.useLimitsControl(undefined)
    self?.useMemory(undefined)
    self?.useVitals(undefined)
    detachModeControl()
    seams.delete(ctx.root)
  })
}
