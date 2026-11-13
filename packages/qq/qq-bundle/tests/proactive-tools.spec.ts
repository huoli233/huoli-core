import { describe, expect, it, vi } from 'vitest'
import { pendingSection, registerProactiveTools, PENDING_SECTION_DEFAULTS, type ProactivePorts } from '../src/proactive-tools.ts'

const LINE = {
  id: 'group:1:1-self',
  why: '心里惦记着楼下新开的店',
  text: '',
  source: 'thought',
  kind: 'share',
  confidence: 0.8,
  value: 0.6,
  risk: 0.1,
}

function ports(overrides: Partial<ProactivePorts> = {}): ProactivePorts {
  return {
    activeChatKey: () => 'group:1',
    pending: () => [LINE],
    deliver: async () => ({ ok: true }),
    requestBody: () => true,
    ...overrides,
  }
}

function toolOf(portsValue: ProactivePorts) {
  let registered: { execute(args: Record<string, unknown>, exec: Record<string, unknown>): Promise<Record<string, unknown>> } | undefined
  const ctx = {
    get: () => ({
      register: (value: typeof registered) => {
        registered = value
        return () => {}
      },
    }),
    logger: () => ({ warn: vi.fn() }),
  }
  registerProactiveTools(ctx as never, portsValue)
  if (registered === undefined) throw new Error('投递工具没注册')
  return registered
}

describe('主动候选摆给模型', () => {
  it('把候选原始事实一起摆出来', () => {
    const text = pendingSection(ports(), 'group:1')

    expect(text).toContain('body_not_written')
    expect(text).toContain('kind=share')
    expect(text).toContain('source=thought')
    expect(text).toContain('confidence=0.8')
    expect(text).toContain('value=0.6')
    expect(text).toContain('risk=0.1')
  })

  it('攒下来的重复候选被去重并只留最近几条，不让提示词膨胀', () => {
    const many = Array.from({ length: 40 }, (_unused, index) => ({ ...LINE, id: `group:1:${index}-self` }))
    const text = pendingSection(ports({ pending: () => many }), 'group:1', { maxLines: 3, maxChars: 600, dedupeByWhy: true })

    expect(text.split('\n- ').length - 1).toBe(1)
    expect(text.length).toBeLessThanOrEqual(600)
    expect(text).toContain('candidates_are_options_only')
  })

  it('不去重时按条数收口，整段仍守字数上限', () => {
    const many = Array.from({ length: 20 }, (_unused, index) => ({ ...LINE, why: `第 ${index} 件惦记的事`, id: `group:1:${index}-self` }))
    const text = pendingSection(ports({ pending: () => many }), 'group:1', { maxLines: 3, maxChars: 600, dedupeByWhy: false })

    expect(text.split('\n- ').length - 1).toBeLessThanOrEqual(3)
    expect(text.length).toBeLessThanOrEqual(600)
  })

  it('默认收口也很短，候选再多也进不了提示词', () => {
    const many = Array.from({ length: 200 }, (_unused, index) => ({ ...LINE, why: `第 ${index} 件惦记的事`, id: `group:1:${index}-self` }))
    const text = pendingSection(ports({ pending: () => many }), 'group:1')

    expect(text.length).toBeLessThanOrEqual(PENDING_SECTION_DEFAULTS.maxChars)
  })

  it('候选没正文时叫醒同一会话写正文，不静默丢弃', async () => {
    const requestBody = vi.fn(() => true)
    const deliver = vi.fn(async () => ({ ok: false, code: 'bundle.no_body', reason: '这一条还没有正文' }))
    const tool = toolOf(ports({ deliver, requestBody }))

    const result = await tool.execute({ id: LINE.id }, { agent: { id: 'group:1' } })

    expect(result.ok).toBe(true)
    expect(result.pendingBody).toContain('写出正文再投')
    expect(requestBody).toHaveBeenCalledWith('group:1', LINE)
  })

  it('其它失败原样返回，不唤醒补正文', async () => {
    const requestBody = vi.fn(() => true)
    const tool = toolOf(ports({
      deliver: async () => ({ ok: false, code: 'send.offline', reason: '连接断开' }),
      requestBody,
    }))

    const result = await tool.execute({ id: LINE.id }, { agent: { id: 'group:1' } })

    expect(result).toMatchObject({ ok: false, code: 'send.offline' })
    expect(requestBody).not.toHaveBeenCalled()
  })
})
