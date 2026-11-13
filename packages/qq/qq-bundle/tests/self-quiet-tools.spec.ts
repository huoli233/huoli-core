import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { describe, expect, it, vi } from 'vitest'
import { registerSelfQuietTools } from '../src/self-quiet-tools.ts'
import type { SelfQuiet } from '../src/self-quiet.ts'

function mount() {
  const ctx = new Context()
  const tools = new Map<string, ToolDefinition>()
  ctx.accessor('tools', {
    get: () => ({
      register: (tool: ToolDefinition) => {
        tools.set(tool.name, tool)
        return () => { tools.delete(tool.name) }
      },
    }),
  })
  const quietFn = vi.fn(() => ({ active: true, until: 2_000 }))
  const quiet = {
    quiet: quietFn,
    resume: vi.fn(),
    state: vi.fn(() => ({ active: true, until: 2_000 })),
  } as unknown as SelfQuiet
  const announce = vi.fn(async () => ({ ok: true }))
  const dispose = registerSelfQuietTools(ctx, {
    quiet,
    minMinutes: 5,
    maxMinutes: 120,
    canDeclare: chatKey => chatKey.startsWith('group:'),
    announce,
  })
  return { tools, quiet, quietFn, announce, dispose }
}

function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

describe('安静工具', () => {
  it('私聊不能用安静逃避回复', async () => {
    const { tools, announce } = mount()
    const quiet = tools.get('qq_declare_quiet')
    if (quiet === undefined) throw new Error('安静工具没挂上')

    await expect(quiet.execute({ minutes: 10, announcement: '我先缓缓' }, execOf('private:1')))
      .rejects.toThrow(/quiet\.private_needs_reply/u)
    expect(announce).not.toHaveBeenCalled()
  })

  it('群聊也必须由模型写出告知，不再使用固定句子', async () => {
    const { tools, announce } = mount()
    const quiet = tools.get('qq_declare_quiet')
    if (quiet === undefined) throw new Error('安静工具没挂上')

    await expect(quiet.execute({ minutes: 10 }, execOf('group:1')))
      .rejects.toThrow(/quiet\.announcement_required/u)
    expect(announce).not.toHaveBeenCalled()
  })

  it('群聊有明确告知时才落安静状态', async () => {
    const { tools, quietFn, announce } = mount()
    const declare = tools.get('qq_declare_quiet')
    if (declare === undefined) throw new Error('安静工具没挂上')

    await expect(declare.execute({ minutes: 10, announcement: '我先安静一会儿' }, execOf('group:1')))
      .resolves.toMatchObject({ ok: true, quiet: true, announcement: '我先安静一会儿' })
    expect(announce).toHaveBeenCalledWith('group:1', '我先安静一会儿')
    expect(quietFn).toHaveBeenCalledWith(10, '', 'group:1')
  })
})
