// 自知：只从既有落盘记录取数，摆事实，判断交给模型

import fs from 'node:fs'
import path from 'node:path'
import type { Context } from '@huoli/cordis'
import type { QqMessage } from '@huoli/huoli-qq-attention'
import { ASSET_CATEGORY_DIRS, isAssetCategory } from './asset-store.ts'

/** 一条发言记录：条数、会话与来路都取自既有文件 */
export interface SelfTalkRecord {
  /** 什么时候 */
  at: number
  /** 哪个会话 */
  chatKey: string
  /** 这一笔发出去几条 */
  sent: number
  /** 是不是自己起头 */
  proactive: boolean
}

/** 一条图片或文件素材，只留能说出口的字段 */
export interface SelfMediaItem {
  id: string
  category: string
  caption: string
  topic: string
  tags: readonly string[]
  at: number
  senderName: string
  chatKey: string
}

/** 一条表情包素材 */
export interface SelfStickerItem {
  id: string
  tag: string
  usage: string
}

/** 群友的一句原话 */
export interface SelfSample {
  senderId: string
  senderName: string
  text: string
  at: number
  /** 这里用称呼代替账号，账号只用于本地认人 */
  label?: string
}

/** 拼整段事实要用的东西 */
export interface SelfAwarenessInput {
  now: number
  windowsMs: readonly number[]
  maxSamples: number
  maxChars: number
  records: readonly SelfTalkRecord[]
  selfName: string
  selfId: string
  selfDescription: string
  selfImages: readonly string[]
  personaName: string
  personaSummary: string
  chatKey: string
  samples: readonly SelfSample[]
  /** 主人账号只用于把显示称呼换掉，不进入提示词 */
  ownerQq?: string
  media: readonly SelfMediaItem[]
  stickers: readonly SelfStickerItem[]
}

/** 一个已登记的外部插件；目录只在主人私聊里展示 */
export interface RuntimePluginFact {
  id: string
  dir: string
  version: string
  enabled: boolean
}

/** 这具机器人当前运行所在的目录与插件范围 */
export interface RuntimeEnvironmentFacts {
  coreRoot: string
  workspaceRoot: string
  pluginRoot: string
  pluginRegistry: string
  profileRoot: string
  dshHome: string
  dataRoot: string
  sessionRoot: string
  plugins: readonly RuntimePluginFact[]
}

/** 读插件登记表；坏文件当空表，不让环境事实把启动拖垮 */
function pluginInventory(file: string, workspaceRoot: string): RuntimePluginFact[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    const rows = (parsed as Record<string, unknown>).plugins
    if (!Array.isArray(rows)) return []
    return rows.flatMap((raw) => {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return []
      const row = raw as Record<string, unknown>
      const id = textOf(row.id).trim()
      const dir = textOf(row.dir).trim()
      if (id === '' || dir === '') return []
      return [{
        id: clean(id),
        dir: path.resolve(workspaceRoot, dir),
        version: clean(row.version),
        enabled: row.enabled !== false,
      }]
    }).slice(0, 24)
  } catch {
    return []
  }
}

/**
 * 从部署环境取本体目录，不扫整个磁盘
 * @param env - 进程环境变量
 * @param cwd - 当前核心目录
 * @returns 目录事实与登记过的外部插件
 */
export function runtimeEnvironmentFacts(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): RuntimeEnvironmentFacts {
  const coreRoot = path.resolve(env.QQ_SELF_CORE_ROOT ?? cwd)
  const workspaceRoot = path.resolve(env.QQ_SELF_WORKSPACE_ROOT ?? path.resolve(coreRoot, '..'))
  const pluginRoot = path.resolve(env.QQ_SELF_PLUGIN_ROOT ?? path.join(workspaceRoot, 'plugins'))
  const pluginRegistry = path.resolve(env.HUOLI_LOADER_REGISTRY ?? path.join(pluginRoot, 'plugins.json'))
  const dshHome = path.resolve(env.DSH_HOME ?? path.join(workspaceRoot, 'runtime', 'dsh-home'))
  return {
    coreRoot,
    workspaceRoot,
    pluginRoot,
    pluginRegistry,
    profileRoot: env.QQ_SELF_PROFILE_ROOT === undefined ? '' : path.resolve(env.QQ_SELF_PROFILE_ROOT),
    dshHome,
    dataRoot: path.resolve(env.QQ_SELF_DATA_ROOT ?? path.join(coreRoot, 'data')),
    sessionRoot: path.join(dshHome, 'sessions'),
    plugins: pluginInventory(pluginRegistry, workspaceRoot),
  }
}

/**
 * 把本体范围写成事实；绝对路径只进入主人私聊
 * @param environment - 运行目录与插件登记
 * @param options - 是否主人私聊以及这一轮真正可见的工具
 * @returns 给模型看的环境事实
 */
export function renderRuntimeEnvironment(
  environment: RuntimeEnvironmentFacts,
  options: { owner: boolean; tools: readonly string[] },
): string {
  const toolSet = new Set(options.tools)
  const hasRead = toolSet.has('read') || toolSet.has('glob') || toolSet.has('grep')
  const hasWrite = toolSet.has('write') || toolSet.has('edit') || toolSet.has('apply_patch')
  const hasTerminal = toolSet.has('bash') || toolSet.has('pwsh')
  const hasPluginChange = toolSet.has('plugin_manager')
  const hasInspector = toolSet.has('cordis_inspect_list') || toolSet.has('cordis_inspect_query') || toolSet.has('tool-cordis')
  const hasDoctor = toolSet.has('qq_body_doctor')
  const lines = [
    '[DATA] QQ_RUNTIME_ENVIRONMENT',
    'SELF: 这个 QQ Agent 运行在同一个 DSH 本体里；会话、模型、上下文压缩、插件、工具、记忆与 QQ 收发不是两套身体。',
  ]
  if (options.owner) {
    const pluginRows = environment.plugins.length === 0
      ? ['外部插件：没有登记启用项']
      : [
        '外部插件：',
        ...environment.plugins.map(item =>
          `- ${item.id}${item.version === '' ? '' : ` ${item.version}`}${item.enabled ? '' : '（停用）'} → ${item.dir}`),
      ]
    lines.push(
      `CORE_ROOT: ${environment.coreRoot}`,
      `WORKSPACE_ROOT: ${environment.workspaceRoot}`,
      `DSH_HOME: ${environment.dshHome}`,
      `PROFILE_ROOT: ${environment.profileRoot === '' ? '未配置' : environment.profileRoot}`,
      `PLUGIN_ROOT: ${environment.pluginRoot}`,
      `PLUGIN_REGISTRY: ${environment.pluginRegistry}`,
      `DATA_ROOT: ${environment.dataRoot}`,
      `SESSION_ROOT: ${environment.sessionRoot}`,
      ...pluginRows,
    )
  } else {
    lines.push(
      'ABSOLUTE_PATHS: hidden_outside_owner_private',
      `EXTERNAL_PLUGINS: ${environment.plugins.filter(item => item.enabled).length} registered`,
    )
  }
  const tools = [...new Set(options.tools)].sort()
  lines.push(
    `VISIBLE_TOOL_COUNT: ${tools.length}`,
    `VISIBLE_TOOLS: ${tools.length === 0 ? 'none' : tools.join(', ')}`,
    `FILE_ACCESS_IN_QQ: ${options.owner && hasRead ? 'owner_private_read_available' : 'false'}`,
    `CODE_EDIT_IN_QQ: ${options.owner && hasWrite ? 'owner_private_edit_available' : 'false'}`,
    `TERMINAL_IN_QQ: ${options.owner && hasTerminal ? 'owner_private_terminal_available' : 'false'}`,
    `RUNTIME_INSPECTION: ${options.owner && hasInspector ? 'owner_private_available' : 'not_available_in_this_session'}`,
    `SELF_DIAGNOSIS: ${hasDoctor ? 'qq_body_doctor_available' : 'not_available_in_this_session'}`,
    options.owner
      ? 'SELF_CHANGE: write/edit/bash/plugin_manager are the same DSH body changing itself. Diagnose from real evidence; repair reversible runtime faults automatically, but report behavior-logic, persona, permission, schema, or irreversible changes before editing.'
      : 'SELF_CHANGE: this session can change memory and self records only through listed tools; code and plugin files are controlled from owner private.',
    `PLUGIN_CHANGE: ${options.owner && hasPluginChange ? 'owner_private_plugin_manager_available' : 'false'}; other chats can only discuss, not install or change plugins`,
    'DISCLOSURE: do not recite local paths or tool inventory in ordinary chat; answer owner private questions from these facts and keep group/friend replies at capability and boundary level',
  )
  return lines.join('\n')
}

/** 每轮挂上本体目录与权限范围 */
export function registerRuntimeEnvironmentPrompt(
  ctx: Context,
  deps: {
    activeChatKey(context: { agent?: { id?: string } }): string
    ownerChatKey: string
    visibleTools(chatKey: string, agent?: object): readonly string[]
    environment?: RuntimeEnvironmentFacts
  },
): void {
  const environment = deps.environment ?? runtimeEnvironmentFacts()
  ctx.systemPrompt.section({
    name: 'qq:runtime-environment',
    order: 13,
    text: (context) => {
      const chatKey = deps.activeChatKey(context)
      return renderRuntimeEnvironment(environment, {
        owner: deps.ownerChatKey !== '' && chatKey === deps.ownerChatKey,
        tools: deps.visibleTools(chatKey, context.agent),
      })
    },
  })
}

// 入站触发的追踪编号长这样，没有它就算自己起头
const INBOUND_TRACE = /#(?:msg|poke|recall)-/u
const PROACTIVE_REASONS = new Set(['autonomous-nudge', 'proactive-body-request'])

/** 读不到或写坏的文件都当没有 */
function readLines(file: string): string[] {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').split('\n')
  } catch {
    return []
  }
}

/** 一行解成对象，坏行丢掉 */
function rowOf(line: string): Record<string, unknown> | null {
  if (line.trim() === '') return null
  try {
    const parsed: unknown = JSON.parse(line)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function tracesOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : []
}

// 本机路径不进模型可见文本，顺手把换行和控制字符收成一行；公开网址原样留着
function clean(value: unknown): string {
  if (typeof value !== 'string') return ''
  const urls: string[] = []
  const guarded = value.replace(/https?:\/\/[^\s]+/giu, (url) => {
    urls.push(url)
    return `\u0001${urls.length - 1}\u0001`
  })
  return guarded
    .replace(/[A-Za-z]:[\\/][^\s]+/gu, '（本机路径略）')
    .replace(/file:\/\/\S+/giu, '（本机路径略）')
    .replace(/\\\\[^\s]+/gu, '（本机路径略）')
    .replace(/(?:^|\s)(?:\/[\w.-]+){2,}\/?/gu, '（本机路径略）')
    .replace(/\u0001(\d+)\u0001/gu, (_match, index: string) => urls[Number(index)] ?? '')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function tagsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map(clean).filter(item => item !== '').slice(0, 4)
}

/** 理由码来自既有轮次记录，只用来区分有没有入站触发 */
function isProactiveReason(reason: string): boolean {
  return reason.startsWith('proactive') || PROACTIVE_REASONS.has(reason)
}

/** 时间线里的这一条是不是入站触发的 */
function isInboundTrace(traceId: string): boolean {
  return traceId !== '' && INBOUND_TRACE.test(traceId)
}

/**
 * 读发言记录：轮次记录给条数与来路，时间线补上没进轮次的那几次，同一追踪编号只算一次
 * @param decisionsFile - 一行一条的轮次记录
 * @param timelineFile - 一行一条的诊断时间线
 * @returns 按文件顺序摆好的发言记录，读不到时是空表
 */
export function readSelfTalkRecords(decisionsFile: string, timelineFile: string): SelfTalkRecord[] {
  const records: SelfTalkRecord[] = []
  const seen = new Set<string>()
  for (const line of readLines(decisionsFile)) {
    const row = rowOf(line)
    if (row === null) continue
    if (row.kind !== undefined && row.kind !== 'round') continue
    const at = numberOr(row.at, Number.NaN)
    const chatKey = textOf(row.chatKey)
    const sent = numberOr(row.sent, 0)
    if (!Number.isFinite(at) || chatKey === '' || sent <= 0) continue
    for (const trace of tracesOf(row.traceIds)) seen.add(trace)
    records.push({ at, chatKey, sent: Math.max(1, Math.floor(sent)), proactive: isProactiveReason(textOf(row.reason)) })
  }
  for (const line of readLines(timelineFile)) {
    const row = rowOf(line)
    if (row === null || row.kind !== 'outbound_sent') continue
    const at = numberOr(row.at, Number.NaN)
    const chatKey = textOf(row.chatKey)
    if (!Number.isFinite(at) || chatKey === '') continue
    const trace = textOf(row.traceId)
    if (trace !== '' && seen.has(trace)) continue
    if (trace !== '') seen.add(trace)
    records.push({
      at,
      chatKey,
      sent: Math.max(1, Math.floor(numberOr(row.count, 1))),
      proactive: !isInboundTrace(trace),
    })
  }
  return records
}

/**
 * 读图片与文件索引，只取能说出口的字段，不读磁盘目录
 * @param file - 既有的素材索引文件
 * @returns 索引里的素材，读不到或格式不对时是空表
 */
export function readMediaItems(file: string): SelfMediaItem[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    const rows = (parsed as Record<string, unknown>).items
    if (!Array.isArray(rows)) return []
    const items: SelfMediaItem[] = []
    for (const raw of rows) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
      const row = raw as Record<string, unknown>
      const id = textOf(row.id)
      if (id === '') continue
      const category = isAssetCategory(textOf(row.category)) ? ASSET_CATEGORY_DIRS[row.category as keyof typeof ASSET_CATEGORY_DIRS] : '其它'
      const at = numberOr(row.lastSeenAt, numberOr(row.createdAt, 0))
      items.push({
        id: clean(id),
        category,
        caption: clean(row.caption),
        topic: clean(row.topic),
        tags: tagsOf(row.tags),
        at,
        senderName: clean(row.senderName),
        chatKey: textOf(row.chatKey),
      })
    }
    return items
  } catch {
    return []
  }
}

/**
 * 读表情包库，只取编号与用法，不取文件位置
 * @param file - 既有的表情包库文件
 * @returns 库里的表情包，读不到或格式不对时是空表
 */
export function readStickerItems(file: string): SelfStickerItem[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(parsed)) return []
    const items: SelfStickerItem[] = []
    for (const raw of parsed) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
      const row = raw as Record<string, unknown>
      const id = textOf(row.id)
      if (id === '') continue
      items.push({ id: clean(id), tag: clean(row.tag), usage: clean(row.usage) })
    }
    return items
  } catch {
    return []
  }
}

/**
 * 把最近入站消息摆成原话样本，自己发的、撤回的与空正文都不算
 * @param messages - 既有收件箱里的最近消息
 * @param selfId - 机器人自己的号
 * @returns 原话样本，按消息顺序
 */
export function samplesOf(messages: readonly QqMessage[], selfId: string): SelfSample[] {
  return messages.flatMap((message) => {
    const text = clean(message.text)
    if (text === '' || message.isRecall === true || (selfId !== '' && message.senderId === selfId)) return []
    return [{
      senderId: clean(message.senderId),
      senderName: clean(message.senderName),
      text,
      at: message.at,
    }]
  })
}

/** 一档窗口在文案里怎么称呼 */
function windowLabel(ms: number): string {
  if (ms % 3_600_000 === 0) return `近 ${ms / 3_600_000} 小时`
  if (ms % 60_000 === 0) return `近 ${ms / 60_000} 分钟`
  return `近 ${Math.round(ms / 1_000)} 秒`
}

/**
 * 三档发言事实，只给条数、会话数与主动被动，不评判说得多不多
 * @param records - 既有记录解出来的发言
 * @param windowsMs - 三档窗口，毫秒
 * @param now - 从哪一刻往前算
 * @returns 一段事实，没有可用窗口时是空串
 */
export function renderSelfTalk(records: readonly SelfTalkRecord[], windowsMs: readonly number[], now: number): string {
  const windows = windowsMs.filter(value => Number.isFinite(value) && value > 0).slice(0, 3)
  if (windows.length === 0) return ''
  const lines = ['[DATA] QQ_SELF_TALK', '来源：轮次记录和时间线里的发送事件，同一条按追踪编号只算一次']
  for (const windowMs of windows) {
    const picked = records.filter(record => record.at > now - windowMs && record.at <= now)
    const sent = picked.reduce((sum, record) => sum + record.sent, 0)
    const chats = new Set(picked.map(record => record.chatKey)).size
    const proactive = picked.filter(record => record.proactive).reduce((sum, record) => sum + record.sent, 0)
    lines.push(`${windowLabel(windowMs)}：我发了 ${sent} 条，涉及 ${chats} 个会话，其中主动开口 ${proactive} 条、被动回复 ${sent - proactive} 条`)
  }
  return lines.join('\n')
}

function agoOf(at: number, now: number): string {
  if (at <= 0 || at > now) return ''
  const minutes = Math.round((now - at) / 60_000)
  return minutes <= 0 ? '（刚刚）' : `（${minutes} 分钟前）`
}

/** 会话键写成日常说法 */
function chatLabel(chatKey: string, ownerQq = ''): string {
  if (chatKey.startsWith('group:')) return `群聊 ${clean(chatKey.slice('group:'.length))}`
  if (chatKey.startsWith('private:')) {
    const id = chatKey.slice('private:'.length)
    return id !== '' && id === ownerQq ? '私聊 主人（已隐藏）' : `私聊 ${clean(id)}`
  }
  return `会话 ${clean(chatKey)}`
}

/** 只列能公开访问的图，本机路径一律不进事实 */
function publicImages(images: readonly string[], maxSamples: number): string[] {
  return images
    .filter(image => /^https?:\/\//iu.test(image.trim()))
    .map(image => clean(image))
    .filter(image => image !== '')
    .slice(0, maxSamples)
}

/** 自己是谁、头像、形象与当前会话 */
function renderProfile(input: SelfAwarenessInput): string {
  const lines = ['[DATA] QQ_SELF_PROFILE']
  const name = clean(input.selfName)
  void input.selfId
  lines.push(`我自己：${name === '' ? '名字没配' : `名字「${name}」`}`)
  lines.push('QQ 号只用于本地识别，不写进提示词也不对任何人复述。')
  const description = clean(input.selfDescription)
  if (description !== '') lines.push(`形象描述：${description}`)
  const personaName = clean(input.personaName)
  const personaSummary = clean(input.personaSummary)
  if (personaName !== '' || personaSummary !== '') {
    lines.push(`角色补充：${personaName === '' ? '' : `档案「${personaName}」`}${personaSummary === '' ? '' : `，一句话：${personaSummary}`}`)
  }
  const images = publicImages(input.selfImages, Math.max(0, input.maxSamples))
  if (images.length > 0) lines.push(`形象参考图：${images.join('；')}`)
  lines.push(`当前会话：${chatLabel(input.chatKey, input.ownerQq)}`)
  lines.push('说明：上面是既有资料，不是刚收到的消息')
  return lines.join('\n')
}

/** 原话按人摆次数与样本，不替模型判断谁爱聊什么 */
function renderSamples(samples: readonly SelfSample[], now: number, maxSamples: number, ownerQq = ''): string[] {
  if (samples.length === 0 || maxSamples <= 0) return []
  const groups = new Map<string, { name: string; label?: string; count: number; lines: string[] }>()
  for (const sample of samples) {
    const key = sample.senderId === '' ? '(未署名)' : sample.senderId
    const group = groups.get(key) ?? { name: sample.senderName, count: 0, lines: [] }
    if (sample.label !== undefined) group.label = sample.label
    if (sample.senderId !== '' && sample.senderId === ownerQq) group.label = '主人'
    group.count += 1
    group.lines.push(`  原话：「${sample.text}」${agoOf(sample.at, now)}`)
    groups.set(key, group)
  }
  const lines = ['【群友最近的原话】（按人摆次数和原话，聊什么由你自己看）']
  let used = 0
  for (const [senderId, group] of groups) {
    if (used >= maxSamples) break
    const label = group.label ?? (group.name === '' ? `QQ ${senderId}` : `QQ ${senderId}（${group.name}）`)
    lines.push(`- ${label}这一阵说了 ${group.count} 条`)
    for (const line of group.lines) {
      if (used >= maxSamples) break
      lines.push(line)
      used += 1
    }
  }
  return lines
}

/** 只数一模一样的原话出现几次，不按词判兴趣 */
function renderRepeated(samples: readonly SelfSample[], maxSamples: number): string[] {
  if (maxSamples <= 0) return []
  const counts = new Map<string, number>()
  for (const sample of samples) {
    if (sample.text === '') continue
    counts.set(sample.text, (counts.get(sample.text) ?? 0) + 1)
  }
  const repeated = [...counts.entries()].filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1]).slice(0, maxSamples)
  if (repeated.length === 0) return []
  return ['【反复出现的原话】', ...repeated.map(([text, count]) => `- 「${text}」出现 ${count} 次`)]
}

/** 群里收着的图片和文件，只给编号，不给路径 */
function renderMedia(input: SelfAwarenessInput): string[] {
  if (input.maxSamples <= 0) return []
  const scoped = input.media
    .filter(item => item.chatKey === '' || item.chatKey === input.chatKey)
    .slice()
    .sort((left, right) => right.at - left.at)
    .slice(0, input.maxSamples)
  if (scoped.length === 0) return []
  const lines = ['【群里收着的图片和文件】（只给编号，不给路径）']
  for (const item of scoped) {
    const parts = [`编号 ${item.id}`, item.category]
    if (item.topic !== '') parts.push(`主题：${item.topic}`)
    if (item.caption !== '') parts.push(`说明：${item.caption}`)
    if (item.tags.length > 0) parts.push(`标签：${item.tags.join('、')}`)
    if (item.senderName !== '') parts.push(`${item.senderName}发的`)
    const ago = agoOf(item.at, input.now)
    if (ago !== '') parts.push(ago)
    lines.push(`- ${parts.join('｜')}`)
  }
  return lines
}

/** 群里收着的表情包，只给编号与用法 */
function renderStickers(input: SelfAwarenessInput): string[] {
  if (input.maxSamples <= 0) return []
  const picked = input.stickers.slice(0, input.maxSamples)
  if (picked.length === 0) return []
  return [
    '【群里收着的表情包】',
    ...picked.map((item) => {
      const parts = [`编号 ${item.id}`]
      if (item.tag !== '') parts.push(`一句场景：${item.tag}`)
      if (item.usage !== '') parts.push(`用的时候：${item.usage}`)
      return `- ${parts.join('｜')}`
    }),
  ]
}

/** 群友习惯与群素材摆成一段，只给原话与频次 */
function renderGroupContext(input: SelfAwarenessInput): string {
  const lines = [
    ...renderSamples(input.samples, input.now, input.maxSamples, input.ownerQq),
    ...renderRepeated(input.samples, input.maxSamples),
    ...renderMedia(input),
    ...renderStickers(input),
  ]
  if (lines.length === 0) return ''
  return ['[DATA] QQ_GROUP_CONTEXT', ...lines, '说明：上面只摆原话和次数，不替你判断谁爱聊什么'].join('\n')
}

/**
 * 把发言统计、自身资料与群上下文合成一段，整段按字符上限收口
 * @param input - 既有记录、配置与当前会话
 * @returns 给模型看的一段事实；没有发言记录时统计那一段不出现
 */
export function renderSelfAwareness(input: SelfAwarenessInput): string {
  const maxChars = Math.max(0, Math.floor(input.maxChars))
  if (maxChars === 0) return ''
  const talk = input.records.length === 0 ? '' : renderSelfTalk(input.records, input.windowsMs, input.now)
  const sections = [talk, renderProfile(input), renderGroupContext(input)].filter(part => part !== '')
  const joined = sections.join('\n\n')
  const chars = Array.from(joined)
  return chars.length <= maxChars ? joined : chars.slice(0, maxChars).join('')
}
