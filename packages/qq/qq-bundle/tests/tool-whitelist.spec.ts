import { Context } from '@huoli/cordis'
import type { ToolExecution, ToolGuard } from '@huoli/huoli-tools'
import { describe, expect, it } from 'vitest'
import { registerToolWhitelist, TOOL_WHITELIST_OPEN } from '../src/tool-whitelist.ts'

interface Mounted {
  ctx: Context
  guards: ToolGuard[]
  logs: string[]
}

function mount(): Mounted {
  const ctx = new Context()
  const guards: ToolGuard[] = []
  ctx.accessor('tools', {
    get: () => ({
      guard: (guard: ToolGuard) => {
        guards.push(guard)
        return () => {}
      },
    }),
  })
  const logs: string[] = []
  ctx.logger.exporter({ levels: { default: 3 }, export: ({ args }) => { logs.push(String(args[0])) } })
  return { ctx, guards, logs }
}

// 守卫只看工具名，其余执行字段由内核在真实调用时注入
function execOf(name: string): ToolExecution {
  return Object.assign({} as ToolExecution, { name })
}

describe('工具白名单', () => {
  it('名单里的工具放行', () => {
    const { ctx, guards } = mount()
    registerToolWhitelist(ctx, ['qq_send_message'])

    expect(guards).toHaveLength(1)
    expect(guards[0]?.(execOf('qq_send_message'))).toBeUndefined()
  })

  it('名单外的工具被拒，理由里带码与下一步', () => {
    const { ctx, guards } = mount()
    registerToolWhitelist(ctx, ['qq_send_message'])

    const reason = guards[0]?.(execOf('read_messages'))

    expect(reason).toContain('qq.tool_not_allowed')
    expect(reason).toContain('下一步')
  })

  it('名单空着就不注册守卫，谁都能调', () => {
    const { ctx, guards } = mount()
    registerToolWhitelist(ctx, [])

    expect(guards).toHaveLength(0)
  })

  it('名单空着时打印一次提示', () => {
    const { ctx, logs } = mount()
    registerToolWhitelist(ctx, [])

    expect(logs.filter(line => line === TOOL_WHITELIST_OPEN)).toHaveLength(1)
  })
})
