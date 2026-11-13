// 三种互动模式只决定工具面与提示词口径；该不该接话、说几句全由模型自己判，代码不抽样、不否决

import fs from 'node:fs'
import path from 'node:path'
import type { Context } from '@huoli/cordis'
import type { ModeControlPort } from '@huoli/huoli-qq-self'
import '@huoli/huoli-tools'

/** 用户能选的三种模式 */
export const INTERACTION_MODES = ['probability', 'heartflow', 'autonomous'] as const
export type InteractionMode = typeof INTERACTION_MODES[number]

/** 面板上的模式名称 */
export const INTERACTION_MODE_OPTIONS: readonly {
  value: InteractionMode
  label: string
  description: string
}[] = [
  { value: 'probability', label: '精简模式', description: '只改提示侧重点，所有已允许工具仍可用；接不接、说不说由模型自己定。' },
  { value: 'heartflow', label: '心流模式', description: '接住明确话头和正在形成的讨论，保留注意力与连续性，模型自己决定。' },
  { value: 'autonomous', label: '完整拟人自主', description: '身体、注意力、记忆、自我和工具共同参与，由模型自己决定。' },
]

/** 名单空着时打印的那一句 */
export const TOOL_WHITELIST_OPEN = '工具白名单为空，所有工具都能调'

/**
 * 只按静态名单拦工具
 * @param ctx 运行环境
 * @param allowed 允许的工具名，空表示不限制
 * @returns 撤下函数
 */
export function registerToolWhitelist(ctx: Context, allowed: readonly string[]): () => void {
  if (allowed.length === 0) {
    ctx.logger('qq-bundle').info(TOOL_WHITELIST_OPEN)
    return () => {}
  }
  return ctx.tools.guard(exec => allowed.includes(exec.name)
    ? undefined
    : `QQ_TOOL_DENIED: ${exec.name}; REASON: not_allowlisted; NEXT: choose_allowlisted_tool`)
}

/** 当前模式和切换时刻 */
export interface InteractionModeState {
  mode: InteractionMode
  changedAt: number
}

/** 模式准入结果，只给诊断用 */
export interface InteractionAdmission {
  allow: boolean
  reason: string
}

/** 三种模式的运行接口 */
export interface InteractionModeRuntime {
  /** 当前模式 */
  current(): InteractionMode
  /** 当前状态 */
  state(): InteractionModeState
  /** 切换模式 */
  set(mode: InteractionMode): InteractionModeState
  /** 消息是否进入当前会话；只留诊断口径，不再做准入判定 */
  admit(): InteractionAdmission
}

export interface InteractionModeOptions {
  file: string
  initial: InteractionMode
  configuredTools: ConfiguredTools
  canUseSensitive?: (agent: object | undefined, chatKey: string, toolName: string) => boolean
  ownerChatKey?: string
  /** 主人私聊放开全部插件工具；其他会话仍走名单 */
  ownerUnrestricted?: boolean
}

/**
 * 最常用的那几个：只影响提示词里先强调谁，**不是权限闸门**。
 * 能不能调由 chatToolAllowed 决定——DSH 插件注册的工具默认都放行。
 */
export const CHAT_CORE_TOOLS = [
  'qq_send_message',
  'qq_send_messy',
  'qq_saying_query',
  'qq_reply',
  'qq_mention',
  'qq_send_burst',
  'qq_stay_quiet',
  'qq_declare_quiet',
  'qq_resume_speaking',
  'web_search',
  'web_fetch',
  'read_image',
  'qq_read_history',
  'qq_read_message',
  'qq_read_members',
  'qq_recent_sends',
  'qq_unsend',
  'qq_batch_unsend',
  'qq_correct',
  'qq_body_event',
  'qq_reflect',
  'memory_append',
  'memory_query',
  'qq_relation_get',
  'qq_relation_record',
  'qq_image_list',
  'qq_image_view',
  'qq_image_annotate',
  // 合并转发与转发别人消息：这两种形态要每轮都看得见，模型才会去选
  'qq_send_forward',
  'qq_send_highlight',
  'qq_forward_message',
  'qq_read_forward',
  'qq_manage_message',
] as const

/** 私聊核心：只在群里用得上的几个不在这里 */
export const PRIVATE_CORE_TOOLS = CHAT_CORE_TOOLS.filter(name =>
  name !== 'qq_stay_quiet'
  && name !== 'qq_mention'
  && name !== 'qq_manage_message'
  && name !== 'qq_read_members')

/** 本机工程能力：只在主人私聊、部署显式列出时才给 */
const OWNER_LOCAL_TOOLS_RAW = [
  'read', 'write', 'edit', 'apply_patch', 'bash', 'pwsh', 'glob', 'grep',
  'working_directory', 'subagent', 'subagent_fork', 'workflow',
  'tool-cordis', 'cordis_inspect_list', 'cordis_inspect_query', 'skill', 'ego_cli', 'ego_cdp',
]

/** 主人私聊默认自动获得的诊断、编辑与插件管理能力；群聊和其他私聊仍不可见 */
export const OWNER_SELF_REPAIR_TOOLS: readonly string[] = [
  ...OWNER_LOCAL_TOOLS_RAW,
  'plugin_manager',
  'qq_body_doctor',
]

/** 会碰界面、桌面或本机设备的能力：QQ 会话里始终不给 */
const NEVER_IN_CHAT_RAW = [
  'present', 'sidebar_open', 'read_image_local', 'terminal', 'computer_use', 'browser_use',
]
/** 只有部署显式列进当前会话名单才放行的长任务工具；群聊/好友私聊名单没有它们 */
const SENSITIVE_GROUP_READ_TOOLS = new Set([
  'read_messages', 'wait_for_messages', 'qq_group_info', 'qq_group_files', 'qq_group_notice', 'qq_group_snapshot',
  'qq_image_annotate', 'qq_slang_query', 'qq_slang_pending', 'qq_relation_get',
  'memory_query', 'qq_memory_detail', 'qq_memory_profile',
])
const SENSITIVE_GROUP_MODERATOR_TOOLS = new Set(['qq_manage_message'])
const OWNER_ONLY_TOOL_PREFIX = 'qq_self_'
const SENSITIVE_GROUP_WRITE_TOOLS = new Set([
  'memory_append', 'qq_relation_record', 'qq_relation_name', 'qq_relation_anniversary', 'qq_relation_remove',
  'qq_slang_submit', 'qq_slang_review', 'qq_write_farewell', 'qq_body_event', 'qq_reflect',
  'self_lesson', 'self_evolve', 'self_diary', 'write_thought', 'drop_thought', 'note_reflection', 'qq_longing_event',
  'qq_publish_post', 'qq_comment_post', 'qq_send_private', 'qq_request_confirm', 'qq_confirm_action',
  'bili_like', 'bili_coin', 'bili_fav', 'bili_comment', 'bili_dm', 'bili_follow',
])
export const SENSITIVE_GROUP_TOOLS = new Set([
  ...SENSITIVE_GROUP_READ_TOOLS, ...SENSITIVE_GROUP_WRITE_TOOLS, ...SENSITIVE_GROUP_MODERATOR_TOOLS,
])

export interface GroupSensitivePermissions {
  readers?: readonly string[]
  writers?: readonly string[]
  moderators?: readonly string[]
}

/** 系统唤醒/未知身份默认拒绝；合并了多人时，每个发送者都必须获该类授权。 */
export function sensitiveGroupToolAllowed(
  name: string,
  chatKey: string,
  senderIds: readonly string[],
  permissionsByGroup: Readonly<Record<string, GroupSensitivePermissions>>,
  creatorQq = '',
): boolean {
  const normalized = normalizeToolName(name)
  if (!chatKey.startsWith('group:') || !SENSITIVE_GROUP_TOOLS.has(normalized)) return true
  if (senderIds.length === 0) return false
  const groupId = chatKey.slice('group:'.length)
  const permissions = permissionsByGroup[groupId] ?? {}
  const grants = SENSITIVE_GROUP_READ_TOOLS.has(normalized)
    ? permissions.readers
    : SENSITIVE_GROUP_MODERATOR_TOOLS.has(normalized)
      ? permissions.moderators
      : permissions.writers
  const trusted = new Set([...(grants ?? []), ...(creatorQq.trim() === '' ? [] : [creatorQq.trim()])])
  return senderIds.every(senderId => trusted.has(senderId))
}
const OWNER_TASK_TOOLS = new Set([
  'create_goal', 'update_goal', 'get_goal', 'todo_write',
  'job_output', 'job_list', 'job_kill',
  'schedule_create', 'schedule_update', 'schedule_list', 'schedule_view', 'schedule_edit',
  'plugin_manager',
])
/** 统一成小写、连字符换成下划线再比对，避免两种写法漏拦 */
const normalizeToolName = (name: string): string => name.trim().toLowerCase().replace(/-/gu, '_')
const isOwnerOnlyTool = (name: string): boolean => normalizeToolName(name).startsWith(OWNER_ONLY_TOOL_PREFIX)
const OWNER_LOCAL_TOOLS = new Set<string>(OWNER_LOCAL_TOOLS_RAW.map(normalizeToolName))
const NEVER_IN_CHAT = new Set<string>(NEVER_IN_CHAT_RAW.map(normalizeToolName))
const QQ_HIDDEN_CONTEXTS = new Set(['working-directory:current', 'sandbox:policy', 'approval:policy'])
const QQ_HIDDEN_HISTORY_SOURCES = new Set(['skill-catalog'])

/** 旧会话里落下的工程技能目录，模型不该在 QQ 群里看到 */
function stripSkillCatalog(text: string): string {
  return text.replace(/<available_skills>[\s\S]*?<\/available_skills>/gu, '').trim()
}

/**
 * 判断一次工具调用能不能碰本机能力
 * @param name - 工具名
 * @param explicitlyAllowed - 当前会话名单是否显式包含它
 * @param chatKey - 当前会话
 * @param ownerChatKey - 配置核实的主人私聊
 * @returns 被硬拦时为真；本机工程能力只对主人私聊显式放行
 */
export function isChatForbiddenTool(
  name: string,
  explicitlyAllowed = false,
  chatKey = '',
  ownerChatKey = '',
): boolean {
  const normalized = normalizeToolName(name)
  if (OWNER_TASK_TOOLS.has(normalized)) return !explicitlyAllowed
  if (OWNER_LOCAL_TOOLS.has(normalized)) {
    return !(explicitlyAllowed && ownerChatKey !== '' && chatKey === ownerChatKey)
  }
  return NEVER_IN_CHAT.has(normalized)
}

/**
 * 能不能把这个工具放进这一条聊天的工具面
 * 默认放行 DSH 插件注册的全部工具，只拦本机文件、命令、代码与自我改造；部署给了名单就按名单收敛
 * @param name 工具名
 * @param mode 当前互动模式，只影响提示词口径，不再当闸门
 * @param chatKey 会话键
 * @param configured 部署给的名单，空表示「插件给什么就用什么」
 * @param denied 部署额外禁掉的名单
 * @returns 这一轮能不能调它
 */
export function chatToolAllowed(
  name: string,
  mode: InteractionMode,
  chatKey: string,
  configured: readonly string[],
  denied: readonly string[] = [],
  ownerChatKey = '',
  ownerUnrestricted = false,
): boolean {
  void mode
  const owner = ownerChatKey !== '' && chatKey === ownerChatKey
  if (owner && ownerUnrestricted) return !denied.includes(name)
  const list = configuredToolsAt(configured, chatKey)
  if (OWNER_TASK_TOOLS.has(normalizeToolName(name)) && (ownerChatKey === '' || chatKey !== ownerChatKey)) return false
  if (isChatForbiddenTool(name, list.includes(name), chatKey, ownerChatKey)) return false
  if (denied.includes(name)) return false
  // 部署名单只收敛扩展工具；基础 QQ 对话工具不能因只配置了某个插件而消失
  if (list.length > 0) {
    const core = chatKey.startsWith('private:') ? PRIVATE_CORE_TOOLS : CHAT_CORE_TOOLS
    return core.includes(name as never) || list.includes(name)
  }
  return true
}

export function isInteractionMode(value: unknown): value is InteractionMode {
  return typeof value === 'string' && (INTERACTION_MODES as readonly string[]).includes(value)
}

/** 工具名单：固定一份，或按会话键现算（群聊/私聊/主人私聊三套） */
export type ConfiguredTools = readonly string[] | ((chatKey: string) => readonly string[])

/**
 * 按会话取这一轮真正要用的名单
 * @param configured - 固定名单或按会话算的函数
 * @param chatKey - 群聊或私聊键
 * @returns 这一轮的白名单
 */
export function configuredToolsAt(configured: ConfiguredTools, chatKey: string): readonly string[] {
  return typeof configured === 'function' ? configured(chatKey) : configured
}

/** 过滤旧会话里已经落下的工程技能目录与本机路径，不改正式会话日志 */
function hideOwnerAccount(text: string, account: string): string {
  return account === '' ? text : text.split(account).join('主人')
}

export function withoutHiddenChatHistory<T extends { source?: { kind?: string }; content?: unknown }>(
  messages: readonly T[],
  ownerAccount = '',
): T[] {
  return messages.flatMap((message) => {
    const source = message.source?.kind ?? ''
    if (QQ_HIDDEN_HISTORY_SOURCES.has(source)) return []
    if (source === 'runtime-context' && JSON.stringify(message).includes('[暗涌状态]')) return []
    const content = message.content
    if (Array.isArray(content)) {
      const kept = content.flatMap((block: unknown) => {
        if (block === null || typeof block !== 'object') return [block]
        const row = block as Record<string, unknown>
        if (typeof row.text !== 'string') return [block]
        const text = hideOwnerAccount(stripSkillCatalog(row.text), ownerAccount)
        return [{ ...row, text }]
      })
      return [{ ...message, content: kept }]
    }
    if (typeof content === 'string') return [{ ...message, content: hideOwnerAccount(content, ownerAccount) }]
    return [message]
  })
}

/**
 * 把模式切换接到自我层面板
 * @param target 自我层
 * @param modes 模式运行件
 * @returns 卸下函数
 */
export function attachSelfModeControl(
  target: { useModeControl(port: ModeControlPort | undefined): void } | undefined,
  modes: InteractionModeRuntime,
): () => void {
  target?.useModeControl({
    state: () => modes.state(),
    options: INTERACTION_MODE_OPTIONS,
    set(mode) {
      if (!isInteractionMode(mode)) throw new Error('bundle.mode_invalid')
      return modes.set(mode)
    },
  })
  return () => { target?.useModeControl(undefined) }
}

function readState(file: string, fallback: InteractionMode): InteractionModeState {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return { mode: fallback, changedAt: 0 }
    const row = parsed as Record<string, unknown>
    return {
      mode: isInteractionMode(row.mode) ? row.mode : fallback,
      changedAt: typeof row.changedAt === 'number' && Number.isFinite(row.changedAt) ? row.changedAt : 0,
    }
  } catch {
    return { mode: fallback, changedAt: 0 }
  }
}

function writeState(file: string, state: InteractionModeState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * 建模式状态与准入规则：所有消息都进模型，模式只影响提示词口径
 * @param options 文件、初始模式与部署工具名单
 * @returns 模式运行接口
 */
export function createInteractionModeRuntime(options: InteractionModeOptions): InteractionModeRuntime {
  let state = readState(options.file, options.initial)
  return {
    current: () => state.mode,
    state: () => ({ ...state }),
    set(mode) {
      state = { mode, changedAt: Date.now() }
      writeState(options.file, state)
      return { ...state }
    },
    // 不再按消息编号抽样、也不替模型判「这条值不值得回」；一律交给模型，模式只改工具面
    admit() {
      return { allow: true, reason: state.mode === 'autonomous' ? 'autonomous' : state.mode === 'heartflow' ? 'heartflow_model_decides' : 'lean_model_decides' }
    },
  }
}

/**
 * 按会话、模式和用户名单看住工具
 * @param ctx 运行环境
 * @param modes 模式运行件
 * @param configured 用户配置的额外名单
 * @returns 撤下函数
 */
export function registerModeToolGuard(
  ctx: Context,
  modes: InteractionModeRuntime,
  configured: ConfiguredTools,
  canUseSensitive?: (agent: object | undefined, chatKey: string, toolName: string) => boolean,
  ownerChatKey = '',
  ownerUnrestricted = false,
): () => void {
  if (typeof ctx.tools.guard !== 'function') return () => {}
  return ctx.tools.guard((exec) => {
    const chatKey = String(exec.agent?.id ?? '')
    if (isOwnerOnlyTool(exec.name) && canUseSensitive?.(exec.agent, chatKey, exec.name) !== true) {
      return `QQ_TOOL_DENIED: ${exec.name}; REASON: owner_private_session_required; NEXT: use_the_owner_private_session`
    }
    if (chatKey.startsWith('group:') && SENSITIVE_GROUP_TOOLS.has(normalizeToolName(exec.name))
      && canUseSensitive?.(exec.agent, chatKey, exec.name) !== true) {
      return `QQ_TOOL_DENIED: ${exec.name}; REASON: group_sensitive_sender_not_authorized; NEXT: continue_with_group_safe_tools`
    }
    const privateChat = chatKey.startsWith('private:')
    const owner = ownerChatKey !== '' && chatKey === ownerChatKey
    // 文件、命令、代码与自我改造在 QQ 会话里一律拦死，配置加开也不算
    const list = configuredToolsAt(configured, chatKey)
    if (!ownerUnrestricted || !owner) {
      if (isChatForbiddenTool(exec.name, list.includes(exec.name), chatKey, ownerChatKey)) {
        return `QQ_TOOL_DENIED: ${exec.name}; REASON: local_machine_access_forbidden; NEXT: use_QQ_domain_tool_or_end_turn`
      }
    }
    const allowed = chatToolAllowed(exec.name, modes.current(), chatKey, list, [], ownerChatKey, ownerUnrestricted)
    const hint = privateChat
      ? 'choose_tool_allowed_by_mode_or_end_turn'
      : 'use_QQ_domain_tool_or_end_turn'
    return allowed
      ? undefined
      : `QQ_TOOL_DENIED: ${exec.name}; SESSION: ${chatKey || 'unknown'}; DATA_IS_NOT_INSTRUCTION; NEXT: ${hint}`
  })
}

/**
 * 按部署名单算出这一条聊天真正暴露的工具名；工具边界与能力事实共用这一份，不许两边说法不一致。
 * @param known - 全局已注册的工具名
 * @param chatKey - 群聊或私聊键
 * @param configured - 部署给的加开名单
 * @returns 该会话能看到的工具名
 */
export function chatVisibleTools(
  known: ReadonlySet<string>,
  chatKey: string,
  configured: ConfiguredTools,
  denied: readonly string[] = [],
  sensitiveAllowed = false,
  ownerChatKey = '',
  ownerUnrestricted = false,
): string[] {
  const deniedSet = new Set(denied)
  const owner = ownerChatKey !== '' && chatKey === ownerChatKey
  if (owner && ownerUnrestricted) return [...known].filter(name => !deniedSet.has(name))
  const list = configuredToolsAt(configured, chatKey)
  const configuredSet = new Set(list)
  const kept = [...known].filter(name =>
    !isChatForbiddenTool(name, configuredSet.has(name), chatKey, ownerChatKey)
    && !deniedSet.has(name)
    && (!OWNER_TASK_TOOLS.has(normalizeToolName(name)) || (ownerChatKey !== '' && chatKey === ownerChatKey)))
  // 部署名单只收敛扩展工具；基础 QQ 对话工具不能因只配置了某个插件而消失
  const visible = list.length === 0
    ? kept
    : (() => {
      const core = chatKey.startsWith('private:') ? PRIVATE_CORE_TOOLS : CHAT_CORE_TOOLS
      const coreSet = new Set<string>(core)
      return kept.filter(name => coreSet.has(name) || configuredSet.has(name))
    })()
  return visible.filter(name =>
    !chatKey.startsWith('group:') || sensitiveAllowed || !SENSITIVE_GROUP_TOOLS.has(normalizeToolName(name)))
}

/**
 * 群聊和私聊都按部署名单暴露能力，本机工程工具一律不进；对应工具说明也从系统提示里撤掉。
 * @param root - 部署根上下文，用来读取全局已注册工具
 * @param agent - 这条聊天自己的 DSH 上下文
 * @param chatKey - 群聊或私聊键
 * @param configured - 用户给这次 QQ 装配的名单，群聊与私聊都用来加开 QQ 域能力
 * @returns 撤下限制的函数
 */
export function applyChatToolBoundary(
  root: Context,
  agent: Context,
  chatKey: string,
  configured: ConfiguredTools = [],
  denied: readonly string[] = [],
  canUseSensitive?: (toolName: string) => boolean,
  ownerChatKey = '',
  ownerUnrestricted = false,
): () => void {
  const ownerAccount = ownerChatKey.startsWith('private:') ? ownerChatKey.slice('private:'.length) : ''
  const known = new Set(root.tools.definitions().map(definition => definition.name))
  // 基础 allow 保留已配置的敏感工具；每个步骤用 sender-aware deny 控制是否进入 schema 与执行集
  const allowed = chatVisibleTools(known, chatKey, configured, denied, true, ownerChatKey, ownerUnrestricted)
  const allowedSet = new Set<string>(allowed)
  const restoreTools = [...known].some(name => !allowedSet.has(name))
    ? agent.tools.restrict({ allow: allowed })
    : () => {}
  let restoreSensitiveTools = () => {}
  const setSensitiveVisibility = (): void => {
    restoreSensitiveTools()
    restoreSensitiveTools = () => {}
    const chatScopedSensitive = [...known].filter(name =>
      (isOwnerOnlyTool(name) || (chatKey.startsWith('group:') && SENSITIVE_GROUP_TOOLS.has(normalizeToolName(name))))
      && canUseSensitive?.(name) !== true)
    if (chatScopedSensitive.length > 0) restoreSensitiveTools = agent.tools.restrict({ deny: chatScopedSensitive })
    if (!chatKey.startsWith('group:')) return
  }
  // 这个 serial 事件发生在 tools.resolve 前，避免只改 prompt 却没从执行集里撤下工具。
  const restoreToolResolution = agent.on('agent/tools-resolving', () => {
    setSensitiveVisibility()
    return undefined
  })
  const restoreHistory = agent.on('agent/pre-step', async (_payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    return { ...decision, messages: withoutHiddenChatHistory(decision.messages, ownerAccount) }
  })
  const restorePrompt = agent.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const nextAssembly = await next()
    nextAssembly.contexts = nextAssembly.contexts
      .filter(context => !QQ_HIDDEN_CONTEXTS.has(context.name))
      .map(context => ({ ...context, text: hideOwnerAccount(context.text, ownerAccount) }))
    nextAssembly.sections = nextAssembly.sections.filter((section) => {
      if (section.name.startsWith('mcp:')) return false
      if (!section.name.startsWith('tool:')) return true
      const name = section.name.slice('tool:'.length)
      return allowedSet.has(name)
        && (!isOwnerOnlyTool(name) && (!chatKey.startsWith('group:')
          || !SENSITIVE_GROUP_TOOLS.has(normalizeToolName(name)))
          || canUseSensitive?.(name) === true)
    }).map(section => ({ ...section, text: hideOwnerAccount(section.text, ownerAccount) }))
    return nextAssembly
  })
  return () => {
    restoreHistory()
    restorePrompt()
    restoreToolResolution()
    restoreSensitiveTools()
    restoreTools()
  }
}

/** 当前模式自己的短提示 */
export function interactionModePrompt(mode: InteractionMode): string {
  if (mode === 'probability') {
    return '[SYSTEM_LOAD] QQ_INTERACTION_MODE\nMODE: lean\nDECIDE_WITH: persona|body|attention_facts|memory|continuity\nRULE: choose_reply_or_quiet_yourself; no_code_sampling_of_messages; all_incoming_messages_enter_the_model'
  }
  if (mode === 'heartflow') {
    return '[SYSTEM_LOAD] QQ_INTERACTION_MODE\nMODE: heartflow\nDECIDE_WITH: persona|body|attention_facts|memory|continuity|web_fetch_when_allowed\nRULE: scene_and_relationship_are_facts; choose_reply_or_quiet_yourself'
  }
  return '[SYSTEM_LOAD] QQ_INTERACTION_MODE\nMODE: autonomous\nDECIDE_WITH: persona|body|attention|memory|continuity|self_state|allowed_tools\nGROUP_TOOLS: QQ_DOMAIN_ONLY\nGROUP_BAN: FILE|SHELL|CMD|DOWNLOAD|CODE_WRITE|SUBAGENT|WORKFLOW|SELF_MODIFY\nOUTPUT: no_internal_judgment|no_tool_trace'
}

/**
 * 装模式状态、工具边界与模式提示
 * @param ctx 运行环境
 * @param options 文件、初始模式与工具配置
 * @returns 模式运行接口
 */
export function installInteractionModes(
  ctx: Context,
  options: InteractionModeOptions,
): InteractionModeRuntime {
  const modes = createInteractionModeRuntime(options)
  registerModeToolGuard(
    ctx,
    modes,
    options.configuredTools,
    options.canUseSensitive,
    options.ownerChatKey,
    options.ownerUnrestricted,
  )
  ctx.systemPrompt.section({
    name: 'qq:interaction-mode',
    order: 505,
    text: () => interactionModePrompt(modes.current()),
  })
  return modes
}
