import { Context } from '@huoli/cordis'
import type { ToolDefinition } from '@huoli/huoli-tools'
import { describe, expect, it } from 'vitest'
import { apply } from '../index.js'

describe('agent-soul 宿主半', () => {
  it('按 Cordis 工具协议注册八个工具', async () => {
    const tools = new Map<string, ToolDefinition>()
    const ctx = new Context()
    ctx.accessor('tools', {
      get: () => ({
        register: (definition: ToolDefinition) => {
          tools.set(definition.name, definition)
          return () => {}
        },
      }),
    })

    apply(ctx)

    expect([...tools.keys()].sort()).toEqual([
      'agent_soul_check',
      'agent_soul_doctor',
      'agent_soul_install',
      'agent_soul_layers',
      'agent_soul_manifest',
      'agent_soul_plan',
      'agent_soul_scaffold',
      'agent_soul_verify',
    ])
    await ctx.fiber.dispose()
  })

  it('知识文件从实际包目录读取', async () => {
    const tools = new Map<string, ToolDefinition>()
    const ctx = new Context()
    ctx.accessor('tools', {
      get: () => ({
        register: (definition: ToolDefinition) => {
          tools.set(definition.name, definition)
          return () => {}
        },
      }),
    })
    apply(ctx)

    const layers = await tools.get('agent_soul_layers')?.execute({ layer: 'all' }, {} as never)

    expect(layers).toMatchObject({ ok: true })
    expect(String((layers as { text?: string }).text)).toContain('ECHO')
    await ctx.fiber.dispose()
  })
})
