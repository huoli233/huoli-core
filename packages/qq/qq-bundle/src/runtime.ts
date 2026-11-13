// 会话排队：同一个聊天按顺序走，不同聊天按空位并行

import type { ContentBlock } from '@huoli/huoli-llm'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReplyMind } from '@huoli/huoli-qq-channel'
import type { DecisionBlock, DecisionRecord } from './decisions.ts'
import type { ClosePlan } from './round-finish.ts'

/** 当前单轮回复判断规则的提示位置 */
export function defaultPersonaRulesPath(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    return path.join(here, '..', 'prompts', 'persona-rules.md')
  } catch {
    return path.join(process.cwd(), 'prompts', 'persona-rules.md')
  }
}

/** 系统级操作指令的默认位置 */
export function defaultSystemDirectivesPath(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    return path.join(here, '..', 'prompts', 'system-directives.md')
  } catch {
    return path.join(process.cwd(), 'prompts', 'system-directives.md')
  }
}

/** 当前人格口吻配置的默认位置 */
export function defaultPersonaVoicePath(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    return path.join(here, '..', '..', '..', '..', 'data', 'qq-self', 'persona.md')
  } catch {
    return path.join(process.cwd(), 'data', 'qq-self', 'persona.md')
  }
}

/** 读当前单轮回复判断规则，读不到就返回空段 */
export function readOptionalRules(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

/** 给指令型提示加统一系统标记，事实型提示不套这一层 */
export function systemDirective(label: string, text: string): string {
  const body = text.trim()
  if (body === '') return ''
  return body.startsWith('[SYSTEM_LOAD]') ? body : `[SYSTEM_LOAD] ${label}\n${body}`
}

/** 读人格口吻配置；没有文件时不加段落 */
export function personaVoiceText(file: string | undefined): string {
  return systemDirective('QQ_PERSONA_VOICE', readOptionalRules(file ?? defaultPersonaVoicePath()))
}

/** 读拟人判断提示；文件改了下一轮提示也跟着变 */
export function personaRulesText(enabled: boolean | undefined, file: string | undefined): string {
  const on = enabled ?? true
  const source = file ?? defaultPersonaRulesPath()
  return on ? readOptionalRules(source) : ''
}

/** 一轮运行中留下的事实 */
export interface RoundFacts {
  at: number
  chatKey: string
  awake: boolean
  reason: string | null
  attempted: boolean
  sent: number
  blocked: DecisionBlock | null
  steps: number
  wrapped: boolean
  lastTool: string
  said: string
  draft: string
  outcome: NonNullable<DecisionRecord['outcome']>
  failureCode: string | null
  provider: string | null
  model: string | null
  requestAt: number | null
  traceIds: string[]
  closeNote: ClosePlan | null
  mind: ReplyMind | null
  held: boolean
  /** 这一轮已经说完/决定安静，下一步直接收尾，不再多请求一次模型 */
  stopped: boolean
  /** 私聊已经开始干活时，先发过一句可见的接手回复 */
  workingAckSent: boolean
  /** 这轮正在发送接手回复，发送事件不能把它当成普通回复 */
  workingAckInFlight: boolean
  /** 这轮已经有模型自己的发送动作，收尾时不再补正文 */
  finalSent: boolean
}

/** 叫醒这一轮的理由 */
export interface WakeFact {
  reason: string
  traceIds: string[]
}

/** 取助手这一步的正文 */
export function assistantTextOf(data: unknown): string {
  if (data === null || typeof data !== 'object') return ''
  const message = (data as Record<string, unknown>).message
  if (message === null || typeof message !== 'object') return ''
  const content = (message as Record<string, unknown>).content
  if (!Array.isArray(content)) return ''
  return content.flatMap((part) => {
    if (part === null || typeof part !== 'object') return []
    const row = part as Record<string, unknown>
    return row.type === 'text' && typeof row.text === 'string' ? [row.text] : []
  }).join('').trim()
}

/** 取失败工具的最短指纹 */
export function failedToolOf(data: unknown): { callId: string; error: string } | undefined {
  if (data === null || typeof data !== 'object') return undefined
  const message = (data as Record<string, unknown>).message
  if (message === null || typeof message !== 'object') return undefined
  const row = message as Record<string, unknown>
  if (row.isError !== true) return undefined
  const callId = typeof row.toolCallId === 'string' ? row.toolCallId : ''
  const content = Array.isArray(row.content)
    ? row.content.flatMap((part) => {
      if (part === null || typeof part !== 'object') return []
      const block = part as Record<string, unknown>
      return block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
    }).join(' ')
    : ''
  return { callId, error: content.trim().replace(/\b\d+(?:\.\d+)?\b/gu, '#').slice(0, 200) }
}

/** 开一轮空事实 */
export function blankRound(at: number, chatKey: string, wake: WakeFact | null): RoundFacts {
  const reason = wake?.reason ?? null
  return {
    at,
    chatKey,
    awake: reason !== null,
    reason,
    attempted: false,
    sent: 0,
    blocked: null,
    steps: 0,
    wrapped: false,
    lastTool: '',
    said: '',
    draft: '',
    outcome: 'running',
    failureCode: null,
    provider: null,
    model: null,
    requestAt: null,
    traceIds: wake?.traceIds ?? [],
    closeNote: null,
    mind: null,
    held: false,
    stopped: false,
    workingAckSent: false,
    workingAckInFlight: false,
    finalSent: false,
  }
}

/** 排队时留下的事件，只给诊断用 */
export interface QueueEvent {
  /** 发生了哪一步 */
  kind: 'started' | 'queued' | 'full' | 'finished' | 'failed'
  /** 排的是哪个聊天或后台任务 */
  key: string
  /** 对应哪条入站消息 */
  traceId?: string
  /** 现在还有几项在跑 */
  running: number
  /** 现在还有几项在等 */
  waiting: number
  /** 真正排过队的任务等待时长；立即启动时不提供 */
  waitMs?: number
}

/** 一项要按顺序执行的活 */
export interface QueueJob {
  /** 归属的聊天或任务名 */
  key: string
  /** 对应哪条入站消息 */
  traceId?: string
  /** 真正要做的活 */
  run: () => Promise<void>
}

/** 会话队列要用的参数 */
export interface WorkQueueOptions {
  /** 同时能跑几项 */
  slots: number
  /** 同一个聊天最多等几项 */
  perKeyMax: number
  /** 每一步出结果时报一次 */
  onEvent?: (event: QueueEvent) => void
}

/** 有上限的会话队列 */
export interface WorkQueue {
  /** 放进一项；满了会明确返回 full */
  enqueue(job: QueueJob): 'started' | 'queued' | 'full' | 'closed'
  /** 现在在跑几项 */
  running(): number
  /** 现在在等几项 */
  waiting(): number
  /** 停止再接新活；手上已经在跑的会自然结束 */
  close(): void
  /** 丢掉还没开始的活，正在跑的继续收尾 */
  clearWaiting(): void
}

/** 还没合成的一句 */
export interface BufferedMessage {
  /** 谁说的 */
  senderName: string
  /** 可信平台事件中的发送者 QQ 号；系统唤醒没有发送者 */
  senderId?: string
  /** 说了什么 */
  text: string
  /** 什么时候收到 */
  at: number
  /** 平台给这条的编号，引用回复要用 */
  messageId?: string
  /** 对应哪条入站消息 */
  traceId?: string
  /** 随这句话一起交给模型的图片或文件 */
  attachments?: readonly ContentBlock[]
  /** 入站消息原本含图片；图片被过滤后仍用于合并判断 */
  containsImage?: boolean
}

/** 一段时间内合在一起的几句 */
export interface MergedMessage {
  /** 哪个聊天 */
  key: string
  /** 按收到顺序排好的几句 */
  messages: readonly BufferedMessage[]
  /** 合成后交给模型看的正文 */
  text: string
  /** 按收到顺序合在一起的附件 */
  attachments: readonly ContentBlock[]
  /** 这几句对应的入站追踪编号 */
  traceIds: string[]
  /** 本次合并中真实入站发送者；不包含系统唤醒 */
  senderIds: string[]
}

/** 短消息合并的参数 */
export interface MessageMergerOptions {
  /** 每个聊天等多久 */
  delayMs: (key: string) => number
  /** 从第一句算起最长等多久 */
  maxDelayMs: number
  /** 合起来最多多少字 */
  maxChars: number
  /** 合好之后交给谁 */
  onFlush: (message: MergedMessage) => void
}

/** 按聊天合并短消息 */
export interface MessageMerger {
  /** 放一句进来；immediate 为真就当场交出去 */
  push(key: string, message: BufferedMessage, immediate?: boolean): void
  /** 马上把某个聊天攒着的交出去 */
  flush(key: string): void
  /** 卸下全部等待 */
  close(): void
  /** 丢掉还没交出去的等待，不触发回调 */
  clear(): void
}

/** 最近发过的正文，只留在内存里给主动候选去重 */
export interface DeliveredHistory {
  remember(chatKey: string, text: string): void
  history(chatKey: string): string[]
}

/** 要不要给模型一次自己开口的机会；这里只留物理条件，不判现场 */
export interface AutonomousNudgeInput {
  /** 哪个聊天 */
  chatKey: string
  /** 这个聊天是不是正在跑一轮 */
  busy: boolean
  /** 身体是不是睡着 */
  asleep: boolean
  /** 模型自己声明的定时休息还没结束 */
  attentionSleeping?: boolean
  /** 身体是不是已经到了该收口休息的程度；只作事实，不当否决 */
  resting?: boolean
  /** 有没有攒住的由头；只作事实，不当否决 */
  hasCandidate: boolean
  /** 主动开口关卡是不是只差一个由头；只作事实 */
  waitingForReason: boolean
  /** 身体给出的当前念头，只作为事实 */
  internalMotive?: string
  /** 刚才大概在做什么，只作为事实 */
  activity?: string
  /** 可承接的具体话头，只作为事实 */
  focus?: string
  /** 最近是不是有人在说；只作为事实摆给模型，不在这里否决 */
  humanActive?: boolean
  /** 真人上一次开口后，自己已经连着说了几条；只作为事实 */
  selfTalkStreak?: number
}

/**
 * 有没有必要叫醒模型：忙、睡、休息中没有时机；没有具体候选也没有必要凭空巡场。
 * @param input - 现场
 * @returns 要不要叫醒模型
 */
export function shouldAutonomousNudge(input: AutonomousNudgeInput): boolean {
  if (!input.chatKey.startsWith('group:') && !input.chatKey.startsWith('private:')) return false
  if (input.busy || input.asleep || input.attentionSleeping === true) return false
  return input.hasCandidate
}

/**
 * 建已发正文历史
 * @param max - 每个聊天保留几条
 * @returns 写入与读取接口
 */
export function createDeliveredHistory(max: number): DeliveredHistory {
  const kept = new Map<string, string[]>()
  return {
    remember(chatKey, text) {
      const fingerprint = text.trim()
      if (fingerprint === '') return
      kept.set(chatKey, [...kept.get(chatKey) ?? [], fingerprint].slice(-Math.max(1, max)))
    },
    history: chatKey => kept.get(chatKey) ?? [],
  }
}

/**
 * 建一个会话队列
 * @param options 同时执行数与每个聊天的等待上限
 * @returns 排队接口
 */
export function createWorkQueue(options: WorkQueueOptions): WorkQueue {
  const slots = Math.max(1, Math.floor(options.slots))
  const perKeyMax = Math.max(1, Math.floor(options.perKeyMax))
  const pending = new Map<string, { job: QueueJob; queuedAt: number }[]>()
  const runningKeys = new Set<string>()
  let active = 0
  let closed = false

  const waiting = (): number => {
    let total = 0
    for (const jobs of pending.values()) total += jobs.length
    return total
  }
  const report = (kind: QueueEvent['kind'], job: QueueJob, waitMs?: number): void => {
    options.onEvent?.({
      kind,
      key: job.key,
      running: active,
      waiting: waiting(),
      ...waitMs === undefined ? {} : { waitMs },
      ...job.traceId === undefined ? {} : { traceId: job.traceId },
    })
  }

  const pump = (): void => {
    if (closed) return
    while (active < slots) {
      let started = false
      for (const [key, jobs] of pending) {
        if (runningKeys.has(key)) continue
        const item = jobs.shift()
        if (item === undefined) {
          pending.delete(key)
          continue
        }
        if (jobs.length === 0) pending.delete(key)
        start(item.job, Date.now() - item.queuedAt)
        started = true
        break
      }
      if (!started) return
    }
  }

  const start = (job: QueueJob, waitMs?: number): void => {
    active += 1
    runningKeys.add(job.key)
    report('started', job, waitMs)
    void Promise.resolve()
      .then(job.run)
      .then(
        () => { report('finished', job) },
        () => { report('failed', job) },
      )
      .finally(() => {
        active -= 1
        runningKeys.delete(job.key)
        pump()
      })
  }

  return {
    enqueue(job) {
      if (closed) return 'closed'
      if (!runningKeys.has(job.key) && active < slots) {
        start(job)
        return 'started'
      }
      const jobs = pending.get(job.key) ?? []
      if (jobs.length >= perKeyMax) {
        report('full', job)
        return 'full'
      }
      jobs.push({ job, queuedAt: Date.now() })
      pending.set(job.key, jobs)
      report('queued', job)
      return 'queued'
    },
    running() {
      return active
    },
    waiting,
    close() {
      closed = true
      pending.clear()
    },
    clearWaiting() {
      pending.clear()
    },
  }
}

/**
 * 建一个短消息合并器
 * @param options 等待窗口、总时长与字数上限
 * @returns 合并接口
 */
export function createMessageMerger(options: MessageMergerOptions): MessageMerger {
  const maxDelayMs = Math.max(0, Math.floor(options.maxDelayMs))
  const maxChars = Math.max(1, Math.floor(options.maxChars))
  const hasImages = (message: BufferedMessage): boolean => message.containsImage === true
    || message.attachments?.some(item => item.type === 'image') === true
  const pending = new Map<string, {
    firstAt: number
    messages: BufferedMessage[]
    timer: ReturnType<typeof setTimeout> | undefined
  }>()

  const flush = (key: string): void => {
    const kept = pending.get(key)
    if (kept === undefined) return
    if (kept.timer !== undefined) clearTimeout(kept.timer)
    pending.delete(key)
    // 群里带上消息编号，模型想引用回复时就不用再翻历史
    const text = kept.messages.map((message) => {
      const tag = message.messageId === undefined || message.messageId === '' ? '' : `[#${message.messageId}]`
      return `${message.senderName}：${tag}${message.text}`
    }).join('\n').slice(0, maxChars)
    options.onFlush({
      key,
      messages: kept.messages,
      text,
      attachments: kept.messages.flatMap(message => message.attachments ?? []),
      traceIds: kept.messages.flatMap(message => message.traceId === undefined ? [] : [message.traceId]),
      senderIds: [...new Set(kept.messages.flatMap(message => message.senderId === undefined || message.senderId.trim() === '' ? [] : [message.senderId]))],
    })
  }

  const arm = (key: string, firstAt: number): void => {
    const kept = pending.get(key)
    if (kept === undefined) return
    if (kept.timer !== undefined) clearTimeout(kept.timer)
    const delay = Math.max(0, Math.floor(options.delayMs(key)))
    const wait = Math.min(delay, Math.max(0, maxDelayMs - (Date.now() - firstAt)))
    kept.timer = setTimeout(() => { flush(key) }, wait)
    kept.timer.unref()
  }

  return {
    push(key, message, immediate = false) {
      const now = Date.now()
      const kept = pending.get(key)
      if (kept !== undefined) {
        const total = kept.messages.reduce((sum, item) => sum + item.text.length, 0) + message.text.length
        const hasImageBatch = hasImages(message) || kept.messages.some(hasImages)
        if ((immediate && !hasImageBatch) || total > maxChars) flush(key)
      }
      const current = pending.get(key)
      if (current === undefined) {
        const created: { firstAt: number; messages: BufferedMessage[]; timer: ReturnType<typeof setTimeout> | undefined } =
          { firstAt: now, messages: [message], timer: undefined }
        pending.set(key, created)
      } else {
        current.messages.push(message)
      }
      const hasImageBatch = hasImages(message) || pending.get(key)?.messages.some(hasImages) === true
      if ((immediate && !hasImageBatch) || options.delayMs(key) <= 0) flush(key)
      else arm(key, pending.get(key)?.firstAt ?? now)
    },
    flush,
    close() {
      for (const kept of pending.values()) {
        if (kept.timer !== undefined) clearTimeout(kept.timer)
      }
      pending.clear()
    },
    clear() {
      for (const kept of pending.values()) {
        if (kept.timer !== undefined) clearTimeout(kept.timer)
      }
      pending.clear()
    },
  }
}
