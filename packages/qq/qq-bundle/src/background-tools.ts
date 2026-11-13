// 长工具改到后台执行：先结束本轮，再按会话顺序把结果送回

import type { Context } from '@huoli/cordis'
import type { ContentBlock } from '@huoli/huoli-llm'
import type { ToolDefinition, ToolDispatchExecution, ToolRunContext } from '@huoli/huoli-tools'
import type { QqChannelSeam } from '@huoli/huoli-qq-channel'
import { renderExternalMaterial } from './external-material.ts'

export interface BackgroundToolConfig {
  tools: readonly string[]
  timeoutMs: number
  workingAckText: string
  failureText: string
  maxPerChat: number
}

export interface BackgroundToolWake {
  (chatKey: string, text: string, reason: string, traceIds: readonly string[]): boolean
}

export interface BackgroundToolOptions {
  ctx: Context
  channel: QqChannelSeam | undefined
  config: BackgroundToolConfig
  isStopped: (chatKey: string) => boolean
  note: (kind: string, chatKey: string, detail?: Record<string, unknown>) => void
  setWake: (wake: BackgroundToolWake) => void
  wake: BackgroundToolWake
}

export interface BackgroundToolRuntime {
  handle(exec: ToolDispatchExecution, tool: ToolDefinition, traceIds: readonly string[]): {
    accepted: boolean
    result: ContentBlock[]
    value: Record<string, unknown>
    concludesTurn: true
  }
  cancel(chatKey: string, reason: string): void
  cancelAll(reason: string): void
  close(): void
}

interface PendingResult {
  seq: number
  text: string
  traceIds: readonly string[]
}

interface Task {
  chatKey: string
  callId: string
  toolName: string
  seq: number
  generation: number
  traceIds: readonly string[]
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  done: boolean
  settled: boolean
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item === null || typeof item !== 'object') return ''
      const block = item as { type?: unknown; text?: unknown }
      return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
    }).filter(Boolean).join('\n')
  }
  if (value === null || typeof value !== 'object') return ''
  const row = value as { text?: unknown }
  return typeof row.text === 'string' ? row.text : ''
}

export function createBackgroundToolRuntime(options: BackgroundToolOptions): BackgroundToolRuntime {
  const { ctx, channel, config, isStopped, note } = options
  const allowed = new Set(config.tools)
  const tasks = new Map<string, Task>()
  const generations = new Map<string, number>()
  const nextSeq = new Map<string, number>()
  const buffered = new Map<string, PendingResult[]>()
  const nextToDeliver = new Map<string, number>()
  const active = { value: true }
  const wake = options.wake
  options.setWake(wake)

  const canDeliver = (task: Task): boolean =>
    active.value
    && !isStopped(task.chatKey)
    && generations.get(task.chatKey) === task.generation

  const flush = (chatKey: string): void => {
    const rows = buffered.get(chatKey)
    if (rows === undefined) return
    const ordered = [...rows].sort((a, b) => a.seq - b.seq)
    let cursor = nextToDeliver.get(chatKey) ?? 0
    let sent = 0
    for (const row of ordered) {
      if (row.seq !== cursor) break
      const text = renderExternalMaterial({
        source: '后台工具',
        title: '刚才那件事的结果',
        status: row.text.startsWith('[失败]') ? 'failed' : 'ok',
        ...row.text.startsWith('[失败]') ? { reason: row.text.slice(3).trim() } : {},
        text: row.text,
      })
      const accepted = wake(chatKey, text, 'tool-background', row.traceIds)
      note(accepted ? 'background_result_queued' : 'background_result_dropped', chatKey, {
        tool: row.text.slice(0, 40),
        seq: row.seq,
      })
      cursor += 1
      sent += 1
    }
    nextToDeliver.set(chatKey, cursor)
    const left = ordered.slice(sent)
    if (left.length === 0) buffered.delete(chatKey)
    else buffered.set(chatKey, left)
  }

  const finish = (task: Task, text: string, outcome: 'ok' | 'failed' | 'timeout' | 'cancelled'): void => {
    if (task.done) return
    task.done = true
    clearTimeout(task.timer)
    tasks.delete(task.callId)
    note('background_tool_finished', task.chatKey, { tool: task.toolName, callId: task.callId, outcome })
    if (!canDeliver(task)) return
    if (outcome === 'cancelled') {
      nextToDeliver.set(task.chatKey, (nextToDeliver.get(task.chatKey) ?? task.seq) + 1)
      flush(task.chatKey)
      return
    }
    const body = outcome === 'ok' ? text : `[失败] ${config.failureText}`
    const rows = buffered.get(task.chatKey) ?? []
    rows.push({ seq: task.seq, text: body, traceIds: task.traceIds })
    buffered.set(task.chatKey, rows)
    flush(task.chatKey)
  }

  const start = (task: Task, tool: ToolDefinition, exec: ToolDispatchExecution): void => {
    const detached = Object.create(exec) as ToolDispatchExecution & ToolRunContext
    Object.defineProperty(detached, 'signal', { value: task.controller.signal, configurable: true })
    detached.concludeTurn = () => undefined
    detached.deferContext = () => undefined
    void Promise.resolve()
      .then(async () => {
        const value = await tool.execute(exec.arguments, detached)
        return { text: textOf(value), outcome: 'ok' as const }
      })
      .then(({ text, outcome }) => { finish(task, text, outcome) })
      .catch((error: unknown) => {
        if (task.controller.signal.aborted) {
          finish(task, '', 'cancelled')
          return
        }
        finish(task, String(error), 'failed')
      })
  }

  const cancelTask = (task: Task, reason: string): void => {
    if (task.done) return
    const generation = task.generation
    const activeAtStart = active.value
    task.done = true
    clearTimeout(task.timer)
    tasks.delete(task.callId)
    task.controller.abort(new Error(reason))
    note('background_tool_cancelled', task.chatKey, { tool: task.toolName, callId: task.callId, reason })
    if (activeAtStart && generation === (generations.get(task.chatKey) ?? 0)) {
      nextToDeliver.set(task.chatKey, (nextToDeliver.get(task.chatKey) ?? task.seq) + 1)
      flush(task.chatKey)
    }
  }

  const cancel = (chatKey: string, reason: string): void => {
    generations.set(chatKey, (generations.get(chatKey) ?? 0) + 1)
    buffered.delete(chatKey)
    for (const task of [...tasks.values()]) {
      if (task.chatKey === chatKey) cancelTask(task, reason)
    }
  }

  return {
    handle(exec, tool, traceIds = []) {
      const chatKey = String(exec.agent?.id ?? '')
      const callId = String(exec.callId ?? '')
      if (!allowed.has(exec.name) || chatKey === '' || callId === '' || tasks.has(callId)) {
        return { accepted: false, result: [], value: {}, concludesTurn: true }
      }
      if (!active.value || isStopped(chatKey)) return { accepted: false, result: [], value: {}, concludesTurn: true }
      const running = [...tasks.values()].filter(task => task.chatKey === chatKey).length
      if (running >= config.maxPerChat) {
        note('background_tool_full', chatKey, { tool: exec.name, callId })
        return { accepted: false, result: [], value: {}, concludesTurn: true }
      }
      const controller = new AbortController()
      const seq = nextSeq.get(chatKey) ?? 0
      nextSeq.set(chatKey, seq + 1)
      const task: Task = {
        chatKey,
        callId,
        toolName: exec.name,
        seq,
        generation: generations.get(chatKey) ?? 0,
        traceIds: [...traceIds],
        controller,
        timer: setTimeout(() => {
          controller.abort(new Error('background tool timeout'))
          finish(task, '', 'timeout')
        }, config.timeoutMs),
        done: false,
      }
      tasks.set(callId, task)
      note('background_tool_started', chatKey, { tool: exec.name, callId, seq })
      const ack = config.workingAckText.trim()
      if (ack !== '' && channel !== undefined) {
        void channel.send(ack, chatKey, true).then((sent) => {
          note(sent.ok ? 'background_ack_sent' : 'background_ack_blocked', chatKey, { tool: exec.name, callId })
        }, (error: unknown) => {
          note('background_ack_failed', chatKey, { tool: exec.name, error: String(error) })
        })
      }
      const value = { background: true, tool: exec.name, callId, chatKey }
      start(task, tool, exec)
      return {
        accepted: true,
        result: [{ type: 'text', text: ack === '' ? '已交到后台处理' : ack }],
        value,
        concludesTurn: true,
      }
    },
    cancel,
    cancelAll(reason) {
      for (const chatKey of new Set([...tasks.values()].map(task => task.chatKey))) cancel(chatKey, reason)
    },
    close() {
      active.value = false
      for (const task of [...tasks.values()]) cancelTask(task, 'qq-bundle closed')
      tasks.clear()
      buffered.clear()
      nextToDeliver.clear()
      ctx.logger('qq-bundle').info('后台长任务已全部停止')
    },
  }
}
