import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/index.ts'

type SocketHandler = (event: { data?: string }) => void

// 每次发出去都立刻回一个 echo，好让发送这条路当场结算
class FakeSocket {
  static readonly opened: FakeSocket[] = []
  readyState = 0
  readonly sent: string[] = []
  private readonly handlers = new Map<string, SocketHandler[]>()

  constructor() {
    FakeSocket.opened.push(this)
  }

  addEventListener(type: string, handler: SocketHandler): void {
    const list = this.handlers.get(type)
    if (list === undefined) this.handlers.set(type, [handler])
    else list.push(handler)
  }

  send(payload: string): void {
    this.sent.push(payload)
    const echo = (JSON.parse(payload) as { echo?: string }).echo
    if (echo === undefined) return
    this.emit('message', JSON.stringify({ echo, retcode: 0, data: { message_id: this.sent.length } }))
  }

  close(): void {
    this.readyState = 3
  }

  open(): void {
    this.readyState = 1
    this.emit('open')
  }

  private emit(type: string, data?: string): void {
    for (const handler of this.handlers.get(type) ?? []) handler(data === undefined ? {} : { data })
  }
}

// 静默时段两头写成一样等于关掉，免得用例跑在深夜时被它拦下
const OPEN_HOURS = { quietStart: '00:00', quietEnd: '00:00' }

// 本地中午，离日界够远
const NOON = new Date(2026, 2, 5, 12, 0, 0, 0).getTime()

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-publish-'))
  tempDirs.push(dir)
  return dir
}

// 工具体只读会话编号与取消信号，其余执行字段由内核在真实调用时注入
function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

interface Mounted {
  tool: (name: string) => ToolDefinition
  names: string[]
}

function mount(patch: Partial<Config> = {}): Mounted {
  const ctx = new Context()
  const tools = new Map<string, ToolDefinition>()
  ctx.accessor('tools', {
    get: () => ({
      register: (definition: ToolDefinition) => {
        tools.set(definition.name, definition)
        return () => {}
      },
    }),
  })
  apply(ctx, {
    url: 'ws://127.0.0.1:6700',
    selfId: '999',
    ...OPEN_HOURS,
    postsFile: path.join(tempDir(), 'posts.json'),
    ...patch,
  })
  FakeSocket.opened.at(-1)?.open()
  const tool = (name: string): ToolDefinition => {
    const found = tools.get(name)
    if (found === undefined) throw new Error(`没有注册工具 ${name}`)
    return found
  }
  return { tool, names: [...tools.keys()] }
}

beforeEach(() => {
  FakeSocket.opened.length = 0
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.useFakeTimers()
  vi.setSystemTime(NOON)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('发布工具出现在工具清单里', () => {
  it('注册好了，能按名字取到', () => {
    const { names } = mount()

    expect(names).toContain('qq_publish_post')
  })

  it('两个参数都在，级别只认两级', () => {
    const { tool } = mount()
    const schema = JSON.stringify(tool('qq_publish_post').parameters)

    expect(schema).toContain('"text"')
    expect(schema).toContain('"kind"')
    expect(schema).toContain('routine')
    expect(schema).toContain('public')
  })

  it('说明不超过两百字，也不交代调用之后要汇报什么', () => {
    const { tool } = mount()
    const description = tool('qq_publish_post').description

    expect(description.length).toBeLessThanOrEqual(200)
    expect(description).toContain('routine')
    expect(description).toContain('public')
    expect(description).not.toContain('调用成功后请汇报')
    expect(description).not.toContain('请汇报')
  })
})

describe('两条级别走发布入口', () => {
  it('routine 走通，回发出时刻与消息编号', async () => {
    const { tool } = mount()

    const result = await tool('qq_publish_post').execute({ text: '今天吃了面', kind: 'routine' }, execOf('group:123')) as { ok: boolean; at: number; messageId: string }

    expect(result.ok).toBe(true)
    expect(result.at).toBe(NOON)
    expect(result.messageId).toBe('1')
    expect(FakeSocket.opened.at(-1)?.sent.some(frame => frame.includes('今天吃了面'))).toBe(true)
  })

  it('public 缺钥匙就拒，错里带码与下一步', async () => {
    const { tool } = mount()

    const failed = tool('qq_publish_post').execute({ text: '新话题想公开讲', kind: 'public' }, execOf('group:123'))

    await expect(failed).rejects.toThrow(/post\.needs_keys: .+｜下一步: .+/u)
  })

  it('级别不在两级里就被参数校验挡下', async () => {
    const { tool } = mount()

    await expect(tool('qq_publish_post').execute({ text: '随便说说', kind: 'none' }, execOf('group:123')))
      .rejects.toThrow(/kind/u)
  })
})

describe('闸门都交给发布入口', () => {
  it('空正文被拒，码是 post.empty', async () => {
    const { tool } = mount()

    await expect(tool('qq_publish_post').execute({ text: '   ', kind: 'routine' }, execOf('group:123')))
      .rejects.toThrow(/post\.empty: .+｜下一步: .+/u)
  })

  it('冷却里再发同一段被拒，工具自己不放行', async () => {
    const { tool } = mount()
    await tool('qq_publish_post').execute({ text: '今天吃了面', kind: 'routine' }, execOf('group:123'))
    vi.setSystemTime(NOON + 60_000)

    await expect(tool('qq_publish_post').execute({ text: '今天吃了面', kind: 'routine' }, execOf('group:123')))
      .rejects.toThrow(/post\.duplicate/u)
  })

  it('超出长度上限时按出站体检的码拒', async () => {
    const { tool } = mount({ maxChars: 3 })

    await expect(tool('qq_publish_post').execute({ text: '一二三四', kind: 'routine' }, execOf('group:123')))
      .rejects.toThrow(/outbound\.too_long/u)
  })
})
