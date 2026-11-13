// 站内转达：只把最要紧的一句送回主人私聊，群聊不放行
import { describe, expect, it, vi } from 'vitest'
import { registerBiliGate } from '../src/bili-gate.ts'
import { BUNDLE_DEFAULTS } from '../src/defaults.ts'

const OWNER = '10000001'
const SELF = '999'

type Row = {
  seq: number
  chatKey: string
  messageId?: string
  senderId: string
  senderName?: string
  text: string
  at: number
  atMe?: boolean
  replyToBot?: boolean
  isRecall?: boolean
}

function mount(overrides: {
  enabled?: boolean
  creatorQq?: string
  maxChars?: number
  maxMessages?: number
  ok?: boolean
  rows?: Row[]
  recentThrows?: boolean
} = {}) {
  const send = vi.fn(async (_text: string, _chatKey: string) => ({ ok: overrides.ok ?? true }))
  const provide = vi.fn()
  const ctx = { provide } as unknown as Parameters<typeof registerBiliGate>[0]
  const channel = { send, selfId: SELF } as unknown as Parameters<typeof registerBiliGate>[1]['channel']
  const attention = {
    inbox: { recent: vi.fn(overrides.recentThrows === true ? () => { throw new Error('读不动') } : () => overrides.rows ?? []) },
  } as unknown as Parameters<typeof registerBiliGate>[1]['attention']
  const warn = vi.fn()
  registerBiliGate(ctx, {
    channel,
    attention,
    creatorQq: overrides.creatorQq ?? OWNER,
    selfId: SELF,
    enabled: overrides.enabled ?? true,
    maxChars: overrides.maxChars ?? BUNDLE_DEFAULTS.biliGateMaxChars,
    maxMessages: overrides.maxMessages ?? BUNDLE_DEFAULTS.biliGateMaxMessages,
    warn,
  })
  return { send, provide, warn, recent: attention?.inbox?.recent as ReturnType<typeof vi.fn> }
}

function gateOf(provide: ReturnType<typeof vi.fn>) {
  expect(provide).toHaveBeenCalledTimes(1)
  const call = provide.mock.calls[0]
  if (call === undefined) throw new Error('服务未注册')
  return call[1]
}

function row(over: Partial<Row> = {}): Row {
  return { seq: 1, chatKey: 'group:1', senderId: '20002', senderName: '群友', text: '在聊什么', at: 1_000, ...over }
}

describe('站内门卫', () => {
  it('默认挂上服务，握手报得出协议与动作', async () => {
    const { provide } = mount()
    const gate = gateOf(provide)
    expect(provide.mock.calls[0]?.[0]).toBe('biliEyesGate')
    const hello = await gate.hello({})
    expect(hello).toMatchObject({ protocol: 2 })
    expect(hello.actions).toContain('notify')
  })

  it('推荐只送一句到主人私聊，不带长材料', async () => {
    const { send, provide } = mount()
    const gate = gateOf(provide)
    const result = await gate.notify({
      kind: 'recommend',
      text: '【B站推荐】很长很长的一段材料\n第二行\n第三行',
      items: [{ bvid: 'BV1', title: 'BLG赢T1进决赛', why: '这场值得补', url: 'https://b23.tv/x' }],
    })
    expect(result).toEqual({ ok: true })
    expect(send).toHaveBeenCalledTimes(1)
    const call = send.mock.calls[0]
    if (call === undefined) throw new Error('没有发送给主人')
    const [text, chatKey] = call
    expect(chatKey).toBe(`private:${OWNER}`)
    expect(String(text)).toContain('BLG赢T1进决赛')
    expect(String(text).length).toBeLessThanOrEqual(BUNDLE_DEFAULTS.biliGateMaxChars)
  })

  it('没有条目时取头一行，字数仍守上限', async () => {
    const { send, provide } = mount({ maxChars: 40 })
    const gate = gateOf(provide)
    await gate.notify({ kind: 'inbox', text: '【B站收件箱】有人回你了\n后面还有一大段材料', items: [] })
    expect(String(send.mock.calls[0]?.[0]).length).toBeLessThanOrEqual(40)
  })

  it('空正文不打扰主人', async () => {
    const { send, provide } = mount()
    const gate = gateOf(provide)
    expect(await gate.notify({ text: '   ', items: [] })).toEqual({ ok: false })
    expect(send).not.toHaveBeenCalled()
  })

  it('群聊一律不算主人本人', async () => {
    const { provide } = mount()
    const gate = gateOf(provide)
    expect((await gate.context({ sessionId: 'group:123' })).trusted).toBe(false)
    expect((await gate.context({ sessionId: `private:${OWNER}` })).trusted).toBe(true)
  })

  it('发送失败如实报失败，不抛到插件那边', async () => {
    const { provide } = mount({ ok: false })
    const gate = gateOf(provide)
    expect(await gate.notify({ text: '你好', items: [] })).toEqual({ ok: false })
  })

  it('关掉开关或没主人号就不挂服务', () => {
    expect(mount({ enabled: false }).provide).not.toHaveBeenCalled()
    expect(mount({ creatorQq: '' }).provide).not.toHaveBeenCalled()
  })

  it('主人消息只认主人本人且按时间过滤', async () => {
    const rows = [
      row({ seq: 1, senderId: OWNER, text: '可以', at: 900 }),
      row({ seq: 2, senderId: OWNER, text: '就这个吧', at: 2_000 }),
      row({ seq: 3, senderId: '20002', text: '我也觉得', at: 3_000 }),
    ]
    const { provide, recent } = mount({ rows })
    const gate = gateOf(provide)
    const result = await gate.ownerMessages({ since: 1_500, sessionId: `private:${OWNER}` })
    expect(recent).toHaveBeenCalledWith(`private:${OWNER}`, BUNDLE_DEFAULTS.biliGateMaxMessages)
    expect(result.messages).toEqual([{ at: 2_000, text: '就这个吧' }])
  })

  it('最近消息只报带链接或被点名的，自己发的和撤回的不算', async () => {
    const rows = [
      row({ seq: 1, text: '看看这个 https://b23.tv/abcd', at: 2_000 }),
      row({ seq: 2, text: '普通闲聊', at: 2_100 }),
      row({ seq: 3, senderId: SELF, text: '我发的 https://b23.tv/self', at: 2_200 }),
      row({ seq: 4, text: '@她 这个 BV1GJ411x7h7', atMe: true, at: 2_300 }),
      row({ seq: 5, text: '撤回的不算', isRecall: true, at: 2_400 }),
    ]
    const { provide } = mount({ rows })
    const gate = gateOf(provide)
    const result = await gate.recentMessages({ sessionId: 'group:1', since: 1_500 })
    expect(result.chat).toEqual({ type: 'group', id: '1' })
    expect(result.messages).toHaveLength(2)
    const first = result.messages[0] as Record<string, unknown>
    expect(first.links).toContain('https://b23.tv/abcd')
    expect((first.sender as Record<string, unknown>).isOwner).toBe(false)
    const second = result.messages[1] as Record<string, unknown>
    expect(second.atSelf).toBe(true)
  })

  it('收件箱读不动时如实给空表、记一行日志，不抛错也不编消息', async () => {
    const { provide, warn } = mount({ recentThrows: true })
    const gate = gateOf(provide)
    expect((await gate.recentMessages({ sessionId: 'group:1', since: 0 })).messages).toEqual([])
    expect(warn).toHaveBeenCalled()
  })
})
