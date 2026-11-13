// 身体自诊：把 DSH 服务、插件、工具、模型和最近故障折成一份可追踪的健康快照

import fs from 'node:fs'
import path from 'node:path'
import type { Context } from '@huoli/cordis'
import { defineTool } from '@huoli/huoli-tools'
import type { RuntimePluginFact } from './self-awareness.ts'

/** 健康快照的四档状态 */
export type SelfHealthStatus = 'healthy' | 'watch' | 'degraded' | 'critical'

/** 一项检查在健康分数里占多少、现在得多少 */
export interface SelfHealthProbe {
  /** 稳定编号 */
  id: string
  /** 给人看的名字 */
  label: string
  /** 这一项从 0 到 100 */
  score: number
  /** 这一项在总分里的权重 */
  weight: number
  /** 这一项自己的状态 */
  status: SelfHealthStatus
  /** 一句可核查的现状 */
  summary: string
}

/** 一条需要处理的身体问题 */
export interface SelfHealthIssue {
  /** 同一问题反复出现时保持同一个编号 */
  fingerprint: string
  /** 属于核心、模型、插件、工具、存储还是行为 */
  area: 'core' | 'model' | 'plugin' | 'tool' | 'storage' | 'behavior'
  /** 稳定结果码 */
  code: string
  /** 事故级别 */
  severity: 'watch' | 'degraded' | 'critical'
  /** 给模型和主人看的短说明 */
  summary: string
  /** 可以直接按运行故障处理，还是应先报告逻辑问题 */
  action: 'auto-repair' | 'owner-report'
  /** 第一次在这份窗口里看到的时刻 */
  at: number
}

/** 一次自诊的事实快照 */
export interface SelfHealthSnapshot {
  /** 快照格式版本 */
  version: 1
  /** 检查时刻 */
  at: number
  /** 合成分数 */
  score: number
  /** 合成分数所在的档位 */
  status: SelfHealthStatus
  /** 分项检查 */
  probes: readonly SelfHealthProbe[]
  /** 需要处理的问题 */
  issues: readonly SelfHealthIssue[]
  /** 启用的外部插件数 */
  enabledPlugins: number
  /** 外部插件总数 */
  totalPlugins: number
  /** 当前已运行、未主动停用的 Loader 项 */
  activeRuntimeEntries: number
  /** 当前应运行但未运行的 Loader 项 */
  inactiveRuntimeEntries: readonly string[]
  /** 当前已注册的工具数 */
  registeredTools: number
  /** 主人私聊当前真正能用的工具数 */
  ownerTools: number
  /** 检查窗口内失败事实数 */
  recentFailures: number
}

/** 自诊要检查的一项服务 */
export interface SelfHealthServiceFact {
  /** 服务名 */
  name: string
  /** 当前是否已就绪 */
  ready: boolean
}

/** Loader 里一条运行项的真实状态 */
export interface SelfHealthRuntimeEntryFact {
  /** Loader 内的稳定 id */
  id: string
  /** 是 group/include 这类承载节点，不是可运行插件 */
  carrier: boolean
  /** 当前是否已经启动 */
  active: boolean
  /** 启动是否失败 */
  failed: boolean
  /** 配置里是否主动禁用 */
  disabled: boolean
}

/** 合成健康快照要读的现场事实 */
export interface SelfHealthFacts {
  /** 检查时刻 */
  now: number
  /** DSH 与 QQ 的组合服务 */
  services: readonly SelfHealthServiceFact[]
  /** 已登记的外部插件 */
  plugins: readonly RuntimePluginFact[]
  /** 当前 Loader 运行项 */
  runtimeEntries: readonly SelfHealthRuntimeEntryFact[]
  /** 进程里注册的工具名 */
  registeredTools: readonly string[]
  /** 主人私聊这一轮真正可见的工具名 */
  ownerTools: readonly string[]
  /** 统一诊断时间线 */
  timelineFile: string
  /** 数据目录 */
  dataRoot: string
  /** 最近故障回看多久 */
  windowMs: number
  /** 从哪一刻开始算本次进程的真实故障；更早的记录属于上一次运行 */
  baselineAt?: number
}

/** 合成状态要用的门槛 */
export interface SelfHealthThresholds {
  /** 不低于它算健康 */
  healthyAt: number
  /** 不低于它算留意 */
  watchAt: number
  /** 不低于它算退化 */
  degradedAt: number
}

/** 自诊运行时的配置 */
export interface SelfHealthRuntimeOptions {
  /** 多久检查一次 */
  intervalMs: number
  /** 同一问题隔多久再提醒一次 */
  alertCooldownMs: number
  /** 启动后多久才做第一次完整检查，避开 Loader 仍在装载的时段 */
  startupDelayMs: number
  /** 状态门槛 */
  thresholds: SelfHealthThresholds
  /** 最新快照放哪 */
  stateFile: string
  /** 每日健康日记目录 */
  journalDir: string
  /** 现场事实从哪取 */
  facts(): Omit<SelfHealthFacts, 'now'>
  /** 发现问题时往哪报 */
  notify?: (snapshot: SelfHealthSnapshot, issues: readonly SelfHealthIssue[]) => void
}

/** 自诊运行时对外露出的几件事 */
export interface SelfHealthRuntime {
  /** 启动后的第一次完整检查是否已经完成 */
  ready(): boolean
  /** 当前快照 */
  current(): SelfHealthSnapshot
  /** 马上重新检查 */
  check(): SelfHealthSnapshot
  /** 读最近的健康日记 */
  history(limit?: number): string
  /** 记一次人工确认的修复结果 */
  note(summary: string, at?: number): void
  /** 接上问题通知口 */
  useNotifier(notify: ((snapshot: SelfHealthSnapshot, issues: readonly SelfHealthIssue[]) => void) | undefined): void
  /** 开始定时检查 */
  start(): void
  /** 停止定时检查 */
  close(): void
}

const PROBE_WEIGHTS = {
  core: 25,
  model: 15,
  plugins: 15,
  tools: 15,
  faults: 20,
  storage: 10,
} as const

const REQUIRED_TOOL_GROUPS: readonly (readonly string[])[] = [
  ['qq_send_message', 'qq_reply'],
  ['qq_body_event'],
  ['self_lesson', 'self_diary'],
]

const REPAIR_TOOL_GROUPS: readonly (readonly string[])[] = [
  ['qq_body_doctor'],
  ['read'],
  ['edit', 'write', 'apply_patch'],
  ['bash', 'pwsh'],
  ['plugin_manager'],
]

const FAILURE_KINDS = new Set([
  'agent_create_failed',
  'agent_dispose_failed',
  'agent_prepare_failed',
  'queue_failed',
  'private_model_error_fallback',
  'private_model_error_fallback_failed',
  'turn_end',
  'turn_finished',
])

function clamp(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

function statusOf(score: number, thresholds: SelfHealthThresholds): SelfHealthStatus {
  if (score >= thresholds.healthyAt) return 'healthy'
  if (score >= thresholds.watchAt) return 'watch'
  if (score >= thresholds.degradedAt) return 'degraded'
  return 'critical'
}

function numberField(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function readTimelineTail(file: string, maxBytes = 524_288): Record<string, unknown>[] {
  let handle: number | undefined
  try {
    handle = fs.openSync(file, 'r')
    const size = fs.fstatSync(handle).size
    const from = Math.max(0, size - maxBytes)
    const buffer = Buffer.alloc(size - from)
    fs.readSync(handle, buffer, 0, buffer.length, from)
    let text = buffer.toString('utf8')
    if (from > 0) {
      const firstNewline = text.indexOf('\n')
      text = firstNewline < 0 ? '' : text.slice(firstNewline + 1)
    }
    return text.split('\n').flatMap((line) => {
      if (line.trim() === '') return []
      try {
        const parsed = recordOf(JSON.parse(line))
        return parsed === undefined ? [] : [parsed]
      } catch {
        return []
      }
    })
  } catch {
    return []
  } finally {
    if (handle !== undefined) fs.closeSync(handle)
  }
}

function hasToolGroup(tools: ReadonlySet<string>, group: readonly string[]): boolean {
  return group.some(name => tools.has(name))
}

function pluginProblems(plugins: readonly RuntimePluginFact[]): {
  missing: RuntimePluginFact[]
  disabled: RuntimePluginFact[]
} {
  const missing: RuntimePluginFact[] = []
  const disabled: RuntimePluginFact[] = []
  for (const plugin of plugins) {
    if (!plugin.enabled) {
      disabled.push(plugin)
      continue
    }
    try {
      if (!fs.statSync(plugin.dir).isDirectory()) missing.push(plugin)
    } catch {
      missing.push(plugin)
    }
  }
  return { missing, disabled }
}

function failureRows(rows: readonly Record<string, unknown>[], since: number): Record<string, unknown>[] {
  return rows.filter((row) => {
    const at = numberField(row, 'at')
    if (at === undefined || at < since) return false
    const kind = stringField(row, 'kind')
    if (kind === 'tool_result') {
      const code = stringField(row, 'code')
      return code !== ''
        && row.failed === true
        && !EXPECTED_TOOL_FAILURE.some(prefix => code.startsWith(prefix))
    }
    if (kind === 'image_route_finished') {
      return row.route === 'unavailable' || row.outcome === 'failed'
        || (numberField(row, 'imageCount') ?? 0) > 0 && (numberField(row, 'routedImageCount') ?? 0) === 0
    }
    if (kind === 'model_call_finished') return stringField(row, 'outcome') !== 'committed'
    if (!FAILURE_KINDS.has(kind)) return false
    return row.outcome === 'error' || kind.endsWith('_failed')
  })
}

const EXPECTED_TOOL_FAILURE = ['media.', 'quiet.', 'outbound.', 'pacing.'] as const

/**
 * 从真实服务、插件、工具和诊断时间线合成一份健康快照
 * @param facts - 当前运行现场与检查窗口
 * @param thresholds - 分数分档门槛
 * @returns 分项、总分、状态与待处理问题
 */
export function evaluateSelfHealth(
  facts: SelfHealthFacts,
  thresholds: SelfHealthThresholds,
): SelfHealthSnapshot {
  const services = facts.services
  const readyServices = services.filter(item => item.ready).length
  const coreScore = services.length === 0 ? 0 : readyServices / services.length * 100
  const missingServices = services.filter(item => !item.ready).map(item => item.name)
  const pluginState = pluginProblems(facts.plugins)
  const requiredRuntimeEntries = facts.runtimeEntries.filter(entry =>
    !entry.carrier
    && !entry.disabled
    && !(process.platform === 'win32' && entry.id.includes('bash'))
    && !(process.platform !== 'win32' && entry.id.includes('pwsh')))
  const activeRuntimeEntries = requiredRuntimeEntries.filter(entry => entry.active && !entry.failed)
  const inactiveRuntimeEntries = requiredRuntimeEntries.filter(entry => !entry.active || entry.failed)
  const externalPluginScore = facts.plugins.length === 0
    ? 100
    : Math.max(0, 100 - pluginState.missing.length * 50 - pluginState.disabled.length * 10)
  const runtimeEntryScore = requiredRuntimeEntries.length === 0
    ? 100
    : activeRuntimeEntries.length / requiredRuntimeEntries.length * 100
  const pluginScore = externalPluginScore * 0.5 + runtimeEntryScore * 0.5
  const registered = new Set(facts.registeredTools)
  const ownerTools = new Set(facts.ownerTools)
  const presentGroups = REQUIRED_TOOL_GROUPS.filter(group => hasToolGroup(registered, group))
  const repairGroups = REPAIR_TOOL_GROUPS.filter(group => hasToolGroup(ownerTools, group))
  const requiredScore = REQUIRED_TOOL_GROUPS.length === 0
    ? 100
    : presentGroups.length / REQUIRED_TOOL_GROUPS.length * 100
  const repairScore = REPAIR_TOOL_GROUPS.length === 0
    ? 100
    : repairGroups.length / REPAIR_TOOL_GROUPS.length * 100
  const toolScore = requiredScore * 0.4 + repairScore * 0.6

  const since = Math.max(facts.now - Math.max(1, facts.windowMs), facts.baselineAt ?? 0)
  const rows = readTimelineTail(facts.timelineFile)
    .filter(row => (numberField(row, 'at') ?? 0) >= since)
  const failures = failureRows(rows, since)
  const failedTools = new Map<string, number>()
  let modelFailures = 0
  let imageFailures = 0
  for (const row of failures) {
    const kind = stringField(row, 'kind')
    if (kind === 'tool_result') {
      const tool = stringField(row, 'tool') || 'unknown'
      failedTools.set(tool, (failedTools.get(tool) ?? 0) + 1)
    } else if (kind === 'image_route_finished') {
      imageFailures += 1
    } else if (kind === 'model_fallback' || kind === 'model_call_finished' || kind === 'private_model_error_fallback') {
      modelFailures += 1
    }
  }
  const repeatedTools = [...failedTools.entries()].filter(([, count]) => count >= 2)
  const modelScore = Math.max(0, 100 - modelFailures * 15 - imageFailures * 10)
  const faultPenalty = failures.length * 7 + repeatedTools.reduce((sum, [, count]) => sum + (count - 1) * 10, 0)
  const faultScore = Math.max(0, 100 - faultPenalty)

  let storageScore = 0
  try {
    fs.accessSync(facts.dataRoot, fs.constants.R_OK | fs.constants.W_OK)
    storageScore = 100
  } catch {
    storageScore = 0
  }

  const probes: SelfHealthProbe[] = [
    {
      id: 'core',
      label: 'DSH 核心',
      score: clamp(coreScore),
      weight: PROBE_WEIGHTS.core,
      status: statusOf(coreScore, thresholds),
      summary: missingServices.length === 0
        ? `${services.length} 个核心服务已接上`
        : `未就绪：${missingServices.join('、')}`,
    },
    {
      id: 'model',
      label: '模型与识图',
      score: clamp(modelScore),
      weight: PROBE_WEIGHTS.model,
      status: statusOf(modelScore, thresholds),
      summary: `窗口内回退 ${modelFailures} 次、识图失败 ${imageFailures} 次`,
    },
    {
      id: 'plugins',
      label: '插件',
      score: clamp(pluginScore),
      weight: PROBE_WEIGHTS.plugins,
      status: statusOf(pluginScore, thresholds),
      summary: `外部启用 ${facts.plugins.filter(item => item.enabled).length}/${facts.plugins.length}，缺失 ${pluginState.missing.length}；Loader 运行 ${activeRuntimeEntries.length}/${requiredRuntimeEntries.length}`,
    },
    {
      id: 'tools',
      label: '功能与修复工具',
      score: clamp(toolScore),
      weight: PROBE_WEIGHTS.tools,
      status: statusOf(toolScore, thresholds),
      summary: `注册 ${registered.size} 个，主人会话可用 ${ownerTools.size} 个；修复面 ${repairGroups.length}/${REPAIR_TOOL_GROUPS.length}`,
    },
    {
      id: 'faults',
      label: '近期故障',
      score: clamp(faultScore),
      weight: PROBE_WEIGHTS.faults,
      status: statusOf(faultScore, thresholds),
      summary: `回看窗口内失败 ${failures.length} 次，重复失败工具 ${repeatedTools.length} 个`,
    },
    {
      id: 'storage',
      label: '数据目录',
      score: clamp(storageScore),
      weight: PROBE_WEIGHTS.storage,
      status: statusOf(storageScore, thresholds),
      summary: storageScore === 100 ? '可读写' : '不可读写',
    },
  ]
  const weight = probes.reduce((sum, probe) => sum + probe.weight, 0)
  const score = clamp(probes.reduce((sum, probe) => sum + probe.score * probe.weight, 0) / weight)
  const scoredStatus = statusOf(score, thresholds)
  const issues: SelfHealthIssue[] = []
  if (missingServices.length > 0) {
    issues.push({
      fingerprint: `core:${missingServices.join(',')}`,
      area: 'core',
      code: 'core.service_missing',
      severity: 'critical',
      summary: `核心服务没有就绪：${missingServices.join('、')}`,
      action: 'auto-repair',
      at: facts.now,
    })
  }
  for (const plugin of pluginState.missing) {
    issues.push({
      fingerprint: `plugin:missing:${plugin.id}`,
      area: 'plugin',
      code: 'plugin.directory_missing',
      severity: 'critical',
      summary: `插件 ${plugin.id} 已登记，但安装目录不存在`,
      action: 'auto-repair',
      at: facts.now,
    })
  }
  for (const entry of inactiveRuntimeEntries) {
    issues.push({
      fingerprint: `plugin:runtime:${entry.id}`,
      area: 'plugin',
      code: entry.failed ? 'plugin.runtime_failed' : 'plugin.runtime_inactive',
      severity: 'degraded',
      summary: `插件 ${entry.id} 已配置但没有正常运行`,
      action: 'auto-repair',
      at: facts.now,
    })
  }
  for (const group of REQUIRED_TOOL_GROUPS) {
    if (!hasToolGroup(registered, group)) {
      issues.push({
        fingerprint: `tool:missing:${group.join('|')}`,
        area: 'tool',
        code: 'tool.required_missing',
        severity: 'degraded',
        summary: `必需功能没有注册：${group.join(' / ')}`,
        action: 'auto-repair',
        at: facts.now,
      })
    }
  }
  for (const group of REPAIR_TOOL_GROUPS) {
    if (!hasToolGroup(ownerTools, group)) {
      issues.push({
        fingerprint: `tool:repair_missing:${group.join('|')}`,
        area: 'tool',
        code: 'tool.repair_surface_missing',
        severity: 'watch',
        summary: `主人会话缺少一项修复能力：${group.join(' / ')}`,
        action: 'owner-report',
        at: facts.now,
      })
    }
  }
  if (storageScore < 100) {
    issues.push({
      fingerprint: 'storage:unwritable',
      area: 'storage',
      code: 'storage.unwritable',
      severity: 'critical',
      summary: '数据目录不可读写，记忆、会话或健康日记可能写不进去',
      action: 'auto-repair',
      at: facts.now,
    })
  }
  if (modelFailures > 0 || imageFailures > 0) {
    issues.push({
      fingerprint: `model:failures:${modelFailures}:${imageFailures}`,
      area: 'model',
      code: 'model.recent_failure',
      severity: modelFailures > 0 ? 'degraded' : 'watch',
      summary: `最近有 ${modelFailures} 次模型故障、${imageFailures} 次识图未路由`,
      action: 'auto-repair',
      at: facts.now,
    })
  }
  for (const [tool, count] of failedTools) {
    issues.push({
      fingerprint: `behavior:tool_failure:${tool}`,
      area: 'behavior',
      code: count >= 2 ? 'behavior.repeated_tool_failure' : 'behavior.tool_failure',
      severity: count >= 3 ? 'degraded' : 'watch',
      summary: `${tool} 在检查窗口内失败 ${count} 次，需要查清是实现故障还是逻辑判断错误`,
      action: count >= 2 ? 'owner-report' : 'auto-repair',
      at: facts.now,
    })
  }
  const status = issues.some(issue => issue.severity === 'critical')
    ? 'critical'
    : issues.some(issue => issue.severity === 'degraded') && scoredStatus === 'healthy'
      ? 'degraded'
      : issues.some(issue => issue.severity === 'watch') && scoredStatus === 'healthy'
        ? 'watch'
        : scoredStatus

  return {
    version: 1,
    at: facts.now,
    score,
    status,
    probes,
    issues,
    enabledPlugins: facts.plugins.filter(item => item.enabled).length,
    totalPlugins: facts.plugins.length,
    activeRuntimeEntries: activeRuntimeEntries.length,
    inactiveRuntimeEntries: inactiveRuntimeEntries.map(entry => entry.id),
    registeredTools: registered.size,
    ownerTools: ownerTools.size,
    recentFailures: failures.length,
  }
}

/**
 * 把健康快照写成模型可读的事实；群聊只拿汇总，主人私聊拿完整分项
 * @param snapshot - 当前快照
 * @param owner - 当前是不是主人私聊
 * @returns 事实段
 */
export function renderSelfHealth(snapshot: SelfHealthSnapshot, owner: boolean): string {
  const lines = [
    '[DATA] SELF_BODY_HEALTH',
    'UNITY: DSH 核心、模型、压缩、插件、工具与 QQ 收发是同一个运行中的身体；QQ 只是入口，不是另一只机器人。',
    `STATUS: ${snapshot.score}% ${snapshot.status}`,
    `PLUGINS: ${snapshot.enabledPlugins}/${snapshot.totalPlugins} enabled`,
    `RUNTIME_ENTRIES: ${snapshot.activeRuntimeEntries} active`,
    `TOOLS: ${snapshot.registeredTools} registered; ${snapshot.ownerTools} in owner private`,
    `RECENT_FAILURES: ${snapshot.recentFailures}`,
  ]
  if (owner) {
    lines.push(
      `PROBES: ${snapshot.probes.map(probe => `${probe.id}=${probe.score}`).join(', ')}`,
      `INACTIVE_RUNTIME_ENTRIES: ${snapshot.inactiveRuntimeEntries.length === 0 ? 'none' : snapshot.inactiveRuntimeEntries.join(', ')}`,
      ...snapshot.issues.length === 0
        ? ['ISSUES: none']
        : ['ISSUES:', ...snapshot.issues.map(issue => `- ${issue.severity} ${issue.code}: ${issue.summary} [${issue.action}]`)],
      'SELF_KNOWLEDGE: 可以按 qq_body_doctor 的真实结果说明自己的服务、插件、工具、模型和最近故障；没检查到的部分不要假装知道。',
      'AUTONOMY: 可回滚的运行故障自己查、自己修、自己复测；涉及行为逻辑、人格、权限、数据格式或不可逆结果时，先把原因、影响和修法报告给主人，等主人决定。',
    )
  } else {
    lines.push(
      ...snapshot.issues.length === 0 ? [] : [`BODY_ISSUES: ${snapshot.issues.length} 项正在处理`],
      'DISCLOSURE: 对外只说明自己现在能不能正常工作和是否需要休息，不念工具名、路径、插件清单或内部错误码。',
      'AUTONOMY: 身体问题会先在同一个 DSH 会话里自诊；群聊不能直接改代码或装插件。',
    )
  }
  return lines.join('\n')
}

/**
 * 拼一条发给主人私聊的自诊叫醒
 * @param snapshot - 当前快照
 * @param issues - 这一次新发现的问题
 * @returns 交给同一 DSH 会话的维护指令
 */
export function renderSelfHealthAlert(
  snapshot: SelfHealthSnapshot,
  issues: readonly SelfHealthIssue[],
): string {
  return [
    '[SELF_HEALTH_ALERT]',
    `健康 ${snapshot.score}%：${snapshot.status}`,
    ...issues.map(issue => `- ${issue.code}: ${issue.summary} [${issue.action}]`),
    '先按 qq_body_doctor 的结果核对现场。运行故障、模型回退、插件失联、缓存或可回滚状态可以自己修；行为逻辑、人格、权限、数据格式或不可逆改动必须先报告主人并等决定。',
    '修完要重跑 qq_body_doctor，再用 qq_body_doctor action=note 写一行真实修复记录；没有修成也要留下当前证据。',
    '这是内部分诊，不是让主人重复配置。能在本机完成的就直接做。',
  ].join('\n')
}

/**
 * 每一轮挂上真实健康事实
 * @param ctx - 运行环境
 * @param deps - 当前会话、主人会话与最新快照
 */
export function registerSelfHealthPrompt(
  ctx: Context,
  deps: {
    activeChatKey(context: { agent?: { id?: string } }): string
    ownerChatKey: string
    snapshot(): SelfHealthSnapshot
    ready(): boolean
  },
): void {
  ctx.systemPrompt.section({
    name: 'qq:self-body-health',
    order: 14,
    text: (context) => {
      const chatKey = deps.activeChatKey(context)
      if (!deps.ready()) {
        return '[DATA] SELF_BODY_HEALTH\nSTATUS: starting\nRULE: DSH 与插件仍在装载，暂不下健康结论；等第一次完整检查后再回答身体状态。'
      }
      return renderSelfHealth(deps.snapshot(), deps.ownerChatKey !== '' && chatKey === deps.ownerChatKey)
    },
  })
}

function snapshotFromDisk(file: string): SelfHealthSnapshot | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const row = parsed as Record<string, unknown>
    const at = numberField(row, 'at')
    const score = numberField(row, 'score')
    if (at === undefined || score === undefined) return undefined
    const status = stringField(row, 'status')
    if (status !== 'healthy' && status !== 'watch' && status !== 'degraded' && status !== 'critical') return undefined
    if (!Array.isArray(row.probes) || !Array.isArray(row.issues)) return undefined
    const probes = row.probes.flatMap((raw): SelfHealthProbe[] => {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return []
      const probe = raw as Record<string, unknown>
      const probeScore = numberField(probe, 'score')
      const weight = numberField(probe, 'weight')
      const probeStatus = stringField(probe, 'status')
      const id = stringField(probe, 'id')
      const label = stringField(probe, 'label')
      const summary = stringField(probe, 'summary')
      if (probeScore === undefined || weight === undefined || id === '' || label === ''
        || (probeStatus !== 'healthy' && probeStatus !== 'watch' && probeStatus !== 'degraded' && probeStatus !== 'critical')) {
        return []
      }
      return [{ id, label, score: probeScore, weight, status: probeStatus, summary }]
    })
    const issues = row.issues.flatMap((raw): SelfHealthIssue[] => {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return []
      const issue = raw as Record<string, unknown>
      const area = stringField(issue, 'area')
      const code = stringField(issue, 'code')
      const severity = stringField(issue, 'severity')
      const action = stringField(issue, 'action')
      const fingerprint = stringField(issue, 'fingerprint')
      const summary = stringField(issue, 'summary')
      const issueAt = numberField(issue, 'at')
      if (code === '' || fingerprint === '' || issueAt === undefined
        || !['core', 'model', 'plugin', 'tool', 'storage', 'behavior'].includes(area)
        || !['watch', 'degraded', 'critical'].includes(severity)
        || (action !== 'auto-repair' && action !== 'owner-report')) return []
      return [{
        fingerprint,
        area: area as SelfHealthIssue['area'],
        code,
        severity: severity as SelfHealthIssue['severity'],
        summary,
        action,
        at: issueAt,
      }]
    })
    return {
      version: 1,
      at,
      score,
      status,
      probes,
      issues,
      enabledPlugins: numberField(row, 'enabledPlugins') ?? 0,
      totalPlugins: numberField(row, 'totalPlugins') ?? 0,
      activeRuntimeEntries: numberField(row, 'activeRuntimeEntries') ?? 0,
      inactiveRuntimeEntries: Array.isArray(row.inactiveRuntimeEntries)
        ? row.inactiveRuntimeEntries.filter((value): value is string => typeof value === 'string')
        : [],
      registeredTools: numberField(row, 'registeredTools') ?? 0,
      ownerTools: numberField(row, 'ownerTools') ?? 0,
      recentFailures: numberField(row, 'recentFailures') ?? 0,
    }
  } catch {
    return undefined
  }
}

function writeSnapshot(file: string, snapshot: SelfHealthSnapshot): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

function localDay(snapshot: SelfHealthSnapshot): string {
  return new Date(snapshot.at).toLocaleDateString('sv-SE')
}

function appendJournal(directory: string, snapshot: SelfHealthSnapshot, note?: string): void {
  fs.mkdirSync(directory, { recursive: true })
  const day = localDay(snapshot)
  const file = path.join(directory, `${day.slice(0, 7)}.md`)
  const time = new Date(snapshot.at).toTimeString().slice(0, 5)
  const detail = snapshot.issues.length === 0
    ? '没有待处理问题'
    : snapshot.issues.map(issue => issue.code).join('、')
  const line = note === undefined
    ? `- ${time} 健康 ${snapshot.score}% ${snapshot.status}：${detail}`
    : `- ${time} 修复记录：${note}`
  let prefix = ''
  if (!fs.existsSync(file)) prefix = `# ${day.slice(0, 7)} 身体健康\n\n`
  fs.appendFileSync(file, `${prefix}${line}\n`, { mode: 0o600 })
}

function readJournal(directory: string, limit: number): string {
  try {
    const files = fs.readdirSync(directory)
      .filter(name => /^\d{4}-\d{2}\.md$/u.test(name))
      .sort()
      .slice(-2)
    const text = files.map(name => fs.readFileSync(path.join(directory, name), 'utf8').trim()).join('\n\n')
    return text.slice(-Math.max(200, limit))
  } catch {
    return '还没有健康日记。'
  }
}

/**
 * 建自诊运行时：定时检查、保存最新快照、按状态变化写健康日记并提醒新问题
 * @param options - 检查频率、门槛、文件位置和事实来源
 * @returns 可供提示词、工具和面板读取的运行时
 */
export function createSelfHealthRuntime(options: SelfHealthRuntimeOptions): SelfHealthRuntime {
  const previous = snapshotFromDisk(options.stateFile)
  let latest = previous ?? evaluateSelfHealth({ now: Date.now(), ...options.facts() }, options.thresholds)
  let warm = false
  let timer: NodeJS.Timeout | undefined
  let startupTimer: NodeJS.Timeout | undefined
  let notifier = options.notify
  const lastAlertAt = new Map<string, number>()

  const persist = (before: SelfHealthSnapshot | undefined): void => {
    writeSnapshot(options.stateFile, latest)
    const changedDay = before === undefined || localDay(before) !== localDay(latest)
    if (before === undefined || before.status !== latest.status || changedDay) {
      appendJournal(options.journalDir, latest)
    }
  }

  const check = (): SelfHealthSnapshot => {
    const before = latest
    latest = evaluateSelfHealth({ now: Date.now(), ...options.facts() }, options.thresholds)
    warm = true
    try {
      persist(before)
    } catch (error) {
      latest = {
        ...latest,
        issues: [
          ...latest.issues,
          {
            fingerprint: 'storage:health_write_failed',
            area: 'storage',
            code: 'storage.health_write_failed',
            severity: 'critical',
            summary: `健康快照写不进去：${error instanceof Error ? error.message : String(error)}`,
            action: 'owner-report',
            at: latest.at,
          },
        ],
      }
    }
    const prior = new Set(before.issues.map(issue => issue.fingerprint))
    const at = Date.now()
    const fresh = latest.issues.filter(issue =>
      !prior.has(issue.fingerprint)
      && at - (lastAlertAt.get(issue.fingerprint) ?? 0) >= options.alertCooldownMs)
    const needsReport = fresh.some(issue => issue.action === 'owner-report' || issue.severity !== 'watch')
    if (fresh.length > 0 && (needsReport || latest.status !== 'healthy') && notifier !== undefined) {
      for (const issue of fresh) lastAlertAt.set(issue.fingerprint, at)
      notifier(latest, fresh)
    }
    return latest
  }

  return {
    ready: () => warm,
    current: () => latest,
    check,
    history(limit = 6_000) {
      return readJournal(options.journalDir, limit)
    },
    note(summary, at = Date.now()) {
      const text = summary.replace(/\s+/gu, ' ').trim().slice(0, 500)
      if (text === '') return
      appendJournal(options.journalDir, { ...latest, at }, text)
    },
    useNotifier(notify) {
      notifier = notify
    },
    start() {
      if (timer !== undefined) return
      startupTimer = setTimeout(check, Math.max(0, options.startupDelayMs))
      startupTimer.unref()
      timer = setInterval(check, Math.max(30_000, options.intervalMs))
      timer.unref()
    },
    close() {
      if (startupTimer !== undefined) clearTimeout(startupTimer)
      if (timer !== undefined) clearInterval(timer)
      startupTimer = undefined
      timer = undefined
    },
  }
}

/**
 * 挂上主人私聊的身体自诊工具
 * @param ctx - 运行环境
 * @param runtime - 自诊运行时
 * @returns 撤下函数
 */
export function registerSelfHealthTool(ctx: Context, runtime: SelfHealthRuntime): () => void {
  return ctx.tools.register(defineTool({
    name: 'qq_body_doctor',
    description: '检查自己这具 DSH 身体的真实状态：核心服务、插件、工具、模型故障、数据目录与健康百分比。action=check 立即体检；history 读健康日记；note 在修完后记一行可核查的结果。',
    parameters: {
      action: { type: 'string', enum: ['check', 'history', 'note'], description: 'check 体检（默认）/ history 看日记 / note 记修复结果' },
      summary: { type: 'string', description: 'note 时：修了什么、怎么验证的、现在还有什么风险' },
      limit: { type: 'number', description: 'history 最多读多少字，默认 6000' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const action = args.action === 'history' || args.action === 'note' ? args.action : 'check'
      if (action === 'note') {
        const summary = typeof args.summary === 'string' ? args.summary : ''
        if (summary.trim() === '') throw new Error('body_doctor.empty_note: 没写修复结果｜下一步: 写清修了什么和怎么验证的')
        runtime.note(summary)
        return Promise.resolve({ ok: true, action, text: '修复记录已写进健康日记。' })
      }
      if (action === 'history') {
        const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : 6_000
        return Promise.resolve({ ok: true, action, text: runtime.history(limit) })
      }
      return Promise.resolve({ ok: true, action, text: JSON.stringify(runtime.check()) })
    },
  }))
}
