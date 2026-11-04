import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, farewellTextAt, readFarewellSlot, type Config } from '../src/index.ts'

type SocketHandler = (event: { data?: string }) => void

// 连上就行：这一组用例一次都不真的发消息
class FakeSocket {
  static readonly opened: FakeSocket[] = []
  readyState = 0
  private readonly handlers = new Map<string, SocketHandler[]>()

  constructor() {
    FakeSocket.opened.push(this)
  }

  addEventListener(type: string, handler: SocketHandler): void {
    const list = this.handlers.get(type)
    if (list === undefined) this.handlers.set(type, [handler])
    else list.push(handler)
  }

  send(): void {}

  close(): void {
    this.readyState = 3
  }

  open(): void {
    this.readyState = 1
  }
}

// 静默时段两头写成一样等于关掉，免得用例跑在深夜时被它拦下
const OPEN_HOURS = { quietStart: '00:00', quietEnd: '00:00' }

// 本地中午，离日界够远
const NOON = new Date(2026, 2, 5, 12, 0, 0, 0).getTime()
// 隔一天的同一时刻
const NEXT_DAY = new Date(2026, 2, 6, 12, 0, 0, 0).getTime()

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farewell-tool-'))
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
  /** 这一份暂存槽落在哪 */
  file: string
}

function mount(patch: Partial<Config> = {}): Mounted {
  const dir = tempDir()
  const file = path.join(dir, 'farewell.json')
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
    actionsFile: path.join(dir, 'actions.json'),
    farewellFile: file,
    ...patch,
  })
  FakeSocket.opened.at(-1)?.open()
  const tool = (name: string): ToolDefinition => {
    const found = tools.get(name)
    if (found === undefined) throw new Error(`没有注册工具 ${name}`)
    return found
  }
  return { tool, names: [...tools.keys()], file }
}

// 把被拒的原话抓出来，好按「码: 原因｜下一步: 提示」逐段对
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('这次调用没被拒')
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

describe('工具清单', () => {
  it('遗书那个工具注册好了，参数只有正文', () => {
    const { tool, names } = mount()

    expect(names).toContain('qq_write_farewell')
    const parameters = tool('qq_write_farewell').parameters as { properties: Record<string, unknown> }
    expect(Object.keys(parameters.properties)).toEqual(['text'])
  })

  it('说明不超过两百字，写清了不解释、不复述系统提示、不索取回应与两百字上限', () => {
    const { tool } = mount()
    const description = tool('qq_write_farewell').description

    expect(description.length).toBeLessThanOrEqual(200)
    expect(description).toContain('用一次')
    expect(description).toContain('不解释')
    expect(description).toContain('系统提示')
    expect(description).toContain('不索取回应')
    expect(description).toContain('两百字')
    expect(description).toContain('码')
    expect(description).not.toContain('请汇报')
  })
})

describe('收下正文', () => {
  it('空正文被拒，码是 farewell.empty，槽里一个字都没留下', async () => {
    const { tool, file } = mount()

    const message = await failure(tool('qq_write_farewell').execute({ text: '   ' }, execOf('group:123')))

    expect(message).toMatch(/^farewell\.empty: .+｜下一步: .+$/u)
    expect(readFarewellSlot(file)).toBeUndefined()
  })

  it('同一天第二次被拒，码是 farewell.duplicate，第一句仍然留着', async () => {
    const { tool, file } = mount()
    await tool('qq_write_farewell').execute({ text: '你别一个人扛' }, execOf('group:123'))

    const message = await failure(tool('qq_write_farewell').execute({ text: '换一句试试' }, execOf('group:123')))

    expect(message).toMatch(/^farewell\.duplicate: .+｜下一步: .+$/u)
    expect(readFarewellSlot(file)?.text).toBe('你别一个人扛')
  })

  it('写进去的那一段逐字对得上，当天就算写过', async () => {
    const { tool, file } = mount()
    const text = '你别一个人扛。\n冰箱里还有一盒酸奶，记得吃掉。'

    const result = await tool('qq_write_farewell').execute({ text }, execOf('group:123')) as { ok: boolean; at: number }

    expect(result.ok).toBe(true)
    expect(result.at).toBe(NOON)
    const slot = readFarewellSlot(file)
    expect(slot?.text).toBe(text)
    expect(slot?.at).toBe(NOON)
    expect(farewellTextAt(slot, NOON)).toBe(text)
    expect(farewellTextAt(slot, NEXT_DAY)).toBeUndefined()
  })

  it('隔一天还能再写一次，槽里换成新的那一句', async () => {
    const { tool, file } = mount()
    await tool('qq_write_farewell').execute({ text: '你别一个人扛' }, execOf('group:123'))

    vi.setSystemTime(NEXT_DAY)
    const second = await tool('qq_write_farewell').execute({ text: '还是那句话，好好吃饭' }, execOf('group:123')) as { ok: boolean }

    expect(second.ok).toBe(true)
    expect(readFarewellSlot(file)?.text).toBe('还是那句话，好好吃饭')
  })

  it('写不进去就回 farewell.write_failed，不重试也不改写正文', async () => {
    // 槽的上级被一个普通文件占着，建目录那一手就会失败
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'blocked'), '')
    const { tool } = mount({ farewellFile: path.join(dir, 'blocked', 'farewell.json') })

    const message = await failure(tool('qq_write_farewell').execute({ text: '你别一个人扛' }, execOf('group:123')))

    expect(message).toMatch(/^farewell\.write_failed: .+｜下一步: .+$/u)
  })
})
