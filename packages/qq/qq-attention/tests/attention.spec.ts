import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, qqAttentionOf, type QqAttentionSeam } from '../src/index.ts'
import { renderAttentionFacts } from '../src/facts.ts'

// 工具体只读会话编号与取消信号，其余字段由内核在真实调用时给
function execOf(chatKey: string, signal: AbortSignal = new AbortController().signal): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal })
}

interface Mounted {
  ctx: Context
  seam: QqAttentionSeam
  tool: (name: string) => ToolDefinition
}

const tempDirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-attention-'))
  tempDirs.push(dir)
  return path.join(dir, 'attention.json')
}

function mount(file: string, selfNames?: readonly string[]): Mounted {
  const ctx = new Context()
  const registered = new Map<string, ToolDefinition>()
  ctx.accessor('tools', {
    get: () => ({
      register: (definition: ToolDefinition) => {
        registered.set(definition.name, definition)
        return () => {}
      },
    }),
  })
  apply(ctx, { file, ...selfNames === undefined ? {} : { selfNames } })
  const seam = qqAttentionOf(ctx)
  if (seam === undefined) throw new Error('注意力没有装配')
  const tool = (name: string): ToolDefinition => {
    const found = registered.get(name)
    if (found === undefined) throw new Error(`没有注册工具 ${name}`)
    return found
  }
  return { ctx, seam, tool }
}

// 铺一串消息，水位相关用例都从这里开始
function fill(seam: QqAttentionSeam, chatKey: string, count = 30): void {
  for (let at = 0; at < count; at += 1) seam.inbox.push(chatKey, { senderId: 'u1', text: `第 ${at + 1} 条` })
}

async function call<T>(tool: ToolDefinition, args: Record<string, unknown>, exec: ToolRunContext): Promise<T> {
  return await tool.execute(args, exec) as T
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('看清消息', () => {
  it('撤回事实留在收件箱，但不冒充一条新的真人发言', () => {
    const { seam } = mount(tempFile())
    seam.inbox.push('group:1', { senderId: 'u1', text: '原本那句' })
    const before = seam.signals('group:1').ambient.humanCount

    seam.inbox.push('group:1', { senderId: 'u1', text: '[撤回] 收回刚才那句', isRecall: true })
    const after = seam.signals('group:1')

    expect(seam.inbox.recent('group:1', 2)).toHaveLength(2)
    expect(after.ambient.humanCount).toBe(before)
    expect(after.fun.signals).not.toContain('是中长消息')
  })

  it('话痨度随反馈收紧并落盘，下一次装配还能读到', () => {
    const file = tempFile()
    const first = mount(file)

    expect(first.seam.noteTalkativeness('group:1', 0.15, 0.5)).toBeLessThan(0.5)
    expect(mount(file).seam.talkativeness('group:1')).toBeLessThan(0.5)
  })

  it('话痨度会随时间向基准回落，不会一次调低后永久沉默', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 10, 10, 3, 0, 0))
      const { seam } = mount(tempFile())
      seam.noteTalkativeness('group:1', 0.15, 1)

      vi.advanceTimersByTime(30 * 60_000)
      const half = seam.talkativeness('group:1')
      vi.advanceTimersByTime(30 * 60_000)
      const later = seam.talkativeness('group:1')

      expect(half).toBeCloseTo(0.325, 2)
      expect(later).toBeGreaterThan(half)
      expect(later).toBeLessThan(0.5)
    } finally {
      vi.useRealTimers()
    }
  })

  it('成功发言时刻会落盘并在重启后保留', () => {
    const file = tempFile()
    const first = mount(file)
    first.seam.noteSelfSpoke('group:1', 1234)

    expect(mount(file).seam.store.of('group:1').lastSelfSpokeAt).toBe(1234)
  })

  it('自己连说会累计，真人开口后清零且重启保留', () => {
    const file = tempFile()
    const first = mount(file)
    const initialTalk = first.seam.talkativeness('group:1')
    first.seam.noteSelfSpoke('group:1', 1000, 2)
    expect(first.seam.store.of('group:1').selfTalkStreak).toBe(2)
    expect(first.seam.store.of('group:1').talkativeness).toBeLessThan(initialTalk)

    first.seam.noteHumanSpoke('group:1', 2000)
    expect(first.seam.store.of('group:1').selfTalkStreak).toBe(0)
    expect(first.seam.store.of('group:1').talkativeness).toBeGreaterThan(0.2)

    first.seam.noteSelfSpoke('group:1', 3000)
    expect(mount(file).seam.store.of('group:1').selfTalkStreak).toBe(1)
  })

  it('本来就没有连续自说时，人声清零不重写状态', () => {
    const file = tempFile()
    const { seam } = mount(file)
    expect(fs.existsSync(file)).toBe(false)

    seam.noteHumanSpoke('group:1', 1000)

    expect(fs.existsSync(file)).toBe(false)
  })

  it('读消息返回的水位是这次读到的最后一条', async () => {
    const { seam, tool } = mount(tempFile())
    fill(seam, 'group:1')

    const result = await call<{ readThroughSeq: number; latestSeq: number; messages: unknown[] }>(
      tool('read_messages'), { limit: 5 }, execOf('group:1'),
    )

    expect(result.readThroughSeq).toBe(5)
    expect(result.latestSeq).toBe(30)
    expect(result.messages).toHaveLength(5)
  })

  it('等待期间到达的消息会被等回来', async () => {
    const { seam, tool } = mount(tempFile())
    const waiting = tool('wait_for_messages').execute({ timeoutMs: 300, quietMs: 0 }, execOf('group:1'))
    setTimeout(() => seam.inbox.push('group:1', { senderId: 'u2', text: '晚到的消息' }), 20)

    const waited = await waiting as { newMessages: Array<{ text: string }> }

    expect(waited.newMessages).toHaveLength(1)
    expect(waited.newMessages[0]?.text).toBe('晚到的消息')
  })

  it('等到超时与等到取消是两件不同的事', async () => {
    const { tool } = mount(tempFile())
    const timed = await call<{ timedOut: boolean; cancelled: boolean }>(
      tool('wait_for_messages'), { timeoutMs: 50, quietMs: 0 }, execOf('group:1'),
    )

    expect(timed.timedOut).toBe(true)
    expect(timed.cancelled).toBe(false)
  })

  it('中途取消时报取消而不是超时', async () => {
    const { tool } = mount(tempFile())
    const controller = new AbortController()
    const pending = tool('wait_for_messages').execute({ timeoutMs: 5000, quietMs: 0 }, execOf('group:1', controller.signal))
    controller.abort()

    const cancelled = await pending as { timedOut: boolean; cancelled: boolean }

    expect(cancelled.cancelled).toBe(true)
    expect(cancelled.timedOut).toBe(false)
  })
})

describe('划走与收尾', () => {
  it('不给水位就划不走', async () => {
    const { tool } = mount(tempFile())

    await expect(tool('mark_read').execute({}, execOf('group:1'))).rejects.toThrow(/attention\.seq_required/)
  })

  it('水位超过最新消息时划不走', async () => {
    const { seam, tool } = mount(tempFile())
    fill(seam, 'group:1', 5)

    await expect(tool('mark_read').execute({ throughSeq: 999 }, execOf('group:1'))).rejects.toThrow(/attention\.seq_ahead/)
  })

  it('合法水位会推进，往回退则被拒绝', async () => {
    const { seam, tool } = mount(tempFile())
    fill(seam, 'group:1')

    const marked = await call<{ readThroughSeq: number }>(tool('mark_read'), { throughSeq: 5 }, execOf('group:1'))

    expect(marked.readThroughSeq).toBe(5)
    await expect(tool('mark_read').execute({ throughSeq: 3 }, execOf('group:1'))).rejects.toThrow(/attention\.seq_backwards/)
  })

  it('没有内容的收尾会被拒绝', async () => {
    const { tool } = mount(tempFile())

    await expect(tool('close_conversation').execute({}, execOf('group:1'))).rejects.toThrow(/attention\.empty_close/)
  })

  it('收尾会留下结束点与下次的接法', async () => {
    const { tool } = mount(tempFile())
    const closed = await call<{ closeSummary: string; nextOpening: string }>(
      tool('close_conversation'), { summary: '聊到周末开黑', nextOpening: '问是哪个游戏' }, execOf('group:1'),
    )

    expect(closed.closeSummary).toBe('聊到周末开黑')
    expect(closed.nextOpening).toBe('问是哪个游戏')
  })

  it('唤醒参数互相冲突时被拒绝且状态不变', async () => {
    const { seam, tool } = mount(tempFile())
    const before = seam.store.of('group:1')

    await expect(tool('set_wake_config').execute({ infinite: true, sleepMs: 1000 }, execOf('group:1')))
      .rejects.toThrow(/attention\.conflicting_wake/)

    const after = seam.store.of('group:1')
    expect(after.wakeMode).toBe(before.wakeMode)
    expect(after.wakeUntil).toBe(before.wakeUntil)
  })

  it('重新装配后水位与收尾摘要还在', async () => {
    const file = tempFile()
    const first = mount(file)
    fill(first.seam, 'group:1', 10)
    await first.tool('mark_read').execute({ throughSeq: 4 }, execOf('group:1'))
    await first.tool('close_conversation').execute({ summary: '聊到周末开黑' }, execOf('group:1'))
    const before = first.seam.store.of('group:1')

    const after = mount(file).seam.store.of('group:1')

    expect(after.readThroughSeq).toBe(before.readThroughSeq)
    expect(after.closeSummary).toBe(before.closeSummary)
  })
})

describe('采集到的事实', () => {
  it('只说现场发生了什么，不给该不该说话的结论', () => {
    const { seam } = mount(tempFile(), ['小岸'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '@小岸 你在吗？' })

    const signals = seam.signals('group:1')

    expect(Object.hasOwn(signals, 'shouldSpeak')).toBe(false)
    expect(Object.hasOwn(signals, 'speak')).toBe(false)
  })

  it('给出候选动作但不替模型做决定', () => {
    const { seam } = mount(tempFile(), ['小岸'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '@小岸 你在吗？' })

    const signals = seam.signals('group:1')

    expect(Array.isArray(signals.candidates)).toBe(true)
    expect(signals.candidates.length).toBeGreaterThan(0)
  })

  it('配置的昵称只形成可能被叫到的信号', () => {
    const { seam } = mount(tempFile(), ['大肥鱼', '小金鱼'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '大肥鱼你看这个' })

    const signals = seam.signals('group:1')

    expect(signals.addressee).toMatchObject({ named: true, recentCount: 1, confidence: 0.5 })
    expect(signals.candidates).toContainEqual({ kind: 'reply', why: '文本里出现名字，可能在叫它' })
    expect(Object.hasOwn(signals, 'shouldSpeak')).toBe(false)
  })

  it('近期反复叫名字会累计成一条现场事实', () => {
    const { seam } = mount(tempFile(), ['肥鱼', '大肥鱼'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '臭肥鱼' })
    seam.inbox.push('group:1', { senderId: 'u3', text: '大肥鱼' })

    expect(seam.signals('group:1').addressee).toMatchObject({ matchedName: '大肥鱼', recentCount: 2 })
  })

  it('候选只有种类与理由，没有权重', () => {
    const { seam } = mount(tempFile(), ['小岸'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '@小岸 你在吗？' })

    const signals = seam.signals('group:1')

    for (const candidate of signals.candidates) {
      expect(Object.keys(candidate).sort()).toEqual(['kind', 'why'])
      expect(Object.hasOwn(candidate, 'weight')).toBe(false)
      expect(Object.hasOwn(candidate, 'score')).toBe(false)
    }
  })

  it('候选里没有数，排不了序也比不了阈值', () => {
    const { seam } = mount(tempFile(), ['小岸'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '@小岸 你在吗？' })

    const signals = seam.signals('group:1')

    for (const candidate of signals.candidates) {
      for (const value of Object.values(candidate)) expect(typeof value).toBe('string')
    }
  })

  it('有趣只报勾到了什么，不给分', () => {
    const { seam } = mount(tempFile(), ['小岸'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '这谁啊？！' })

    const signals = seam.signals('group:1')

    expect(Object.hasOwn(signals.fun, 'score')).toBe(false)
    expect(Object.keys(signals.fun).sort()).toEqual(['evidence', 'signals'])
    expect(typeof signals.fun.evidence).toBe('string')
    expect(signals.fun.evidence.length).toBeGreaterThan(0)
    expect(signals.fun.signals).toContain('带问号')
    expect(signals.fun.signals).toContain('带情绪标点')
  })

  it('没有特别之处时也只说一句事实', () => {
    const { seam } = mount(tempFile(), ['小岸'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '嗯' })

    const signals = seam.signals('group:1')

    expect(signals.fun.signals).toEqual([])
    expect(signals.fun.evidence.length).toBeGreaterThan(0)
  })

  it('唤醒条件里没有概率', async () => {
    const { seam, tool } = mount(tempFile())
    const wake = tool('set_wake_config')

    expect(JSON.stringify(wake.parameters)).not.toContain('probability')

    const set = await call<{ triggers: Record<string, unknown> }>(
      wake, { triggers: { atMention: true } }, execOf('group:1'),
    )

    expect(Object.hasOwn(set.triggers, 'probability')).toBe(false)
    expect(Object.hasOwn(seam.store.of('group:1').triggers, 'probability')).toBe(false)
  })

  it('定时休息回执带本地醒点和收口前提示', async () => {
    const { tool } = mount(tempFile())
    const set = await call<{ wakeAt: string; notice: string }>(
      tool('set_wake_config'), { sleepMs: 60_000 }, execOf('private:1'),
    )

    expect(set.wakeAt).not.toBe('')
    expect(set.notice).toContain('收口前先发一句')
    expect(set.notice).toContain(set.wakeAt)
  })
})

describe('推消息时带来的指向事实', () => {
  it('atMe 为真时 directed.at 跟着变，且事实段说这几条在叫你', () => {
    const { seam } = mount(tempFile(), ['小岸'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '@小岸 你在吗', atMe: true })

    const signals = seam.signals('group:1')

    expect(signals.directed.at).toBe(true)
    expect(renderAttentionFacts({ signals })).toContain('这几条在叫你')
  })

  it('没带 atMe 时不硬说被叫，这是负例', () => {
    const { seam } = mount(tempFile(), ['小岸'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '随便聊一句' })

    const signals = seam.signals('group:1')

    expect(signals.directed.at).toBe(false)
    expect(renderAttentionFacts({ signals })).not.toContain('这几条在叫你')
  })

  it('isPoke 与 replyToBot 也能从推消息一路读到事实', () => {
    const { seam } = mount(tempFile())
    seam.inbox.push('group:1', { senderId: 'u3', text: '接着刚才那句说', isPoke: true, replyToBot: true })

    const signals = seam.signals('group:1')

    expect(signals.directed.poke).toBe(true)
    expect(signals.directed.replyToBot).toBe(true)
    expect(renderAttentionFacts({ signals })).toContain('有人在戳你')
    expect(renderAttentionFacts({ signals })).toContain('有人在回你刚说过的话')
  })
})

describe('提示词里的注意力事实', () => {
  it('把唤醒偏好写成一句事实，不写该不该醒', () => {
    const { seam } = mount(tempFile())
    const signals = seam.signals('group:1')

    const text = renderAttentionFacts({ signals, wake: { wakeMode: 'infinite', triggers: { atMention: true } } })

    expect(text).toContain('你设了持续监听，但不是每条消息都叫醒')
    expect(text).toContain('你设了只在这几种情况醒：被直接点到')
    expect(text).not.toMatch(/该不该|要不要|建议醒|应该醒/)
  })

  it('定时唤醒与允许的名单也只报读数', () => {
    const { seam } = mount(tempFile())
    const signals = seam.signals('group:1')
    const wakeUntil = Date.now() + 60_000

    const text = renderAttentionFacts({ signals, wake: { wakeMode: 'timed', wakeUntil, triggers: { speakerIds: ['u9'] } }, now: Date.now() })

    expect(text).toContain('你设了睡到')
    expect(text).toContain('那个时刻还没到')
    expect(text).toContain('指定的人发言')
  })

  it('偏好为空时不多说一句，这是负例', () => {
    const { seam } = mount(tempFile())
    const signals = seam.signals('group:1')
    const plain = renderAttentionFacts({ signals })

    expect(renderAttentionFacts({ signals, wake: {} })).toBe(plain)
    expect(renderAttentionFacts({ signals, wake: { triggers: {} } })).toBe(plain)
    expect(plain).not.toContain('你设了')
  })

  it('所有消息都醒时不再重复写成只在这几种情况醒', () => {
    const { seam } = mount(tempFile())
    const text = renderAttentionFacts({
      signals: seam.signals('group:1'),
      wake: {
        wakeMode: 'infinite',
        triggers: { anyMessage: true, atMention: true, poke: true },
      },
    })

    expect(text).toContain('所有新消息都会叫醒你')
    expect(text).not.toContain('只在这几种情况醒：任意一条消息')
    expect(text).toContain('另外：被直接点到、被戳一下')
  })

  it('多人接话时同时给出消息条数和参与人数', () => {
    const { seam } = mount(tempFile())
    const now = Date.now()
    seam.inbox.push('group:1', { senderId: 'u1', text: '我觉得可以', at: now - 2_000 })
    seam.inbox.push('group:1', { senderId: 'u2', text: '不一定', at: now - 1_000 })
    seam.inbox.push('group:1', { senderId: 'u1', text: '那你说', at: now })

    const signals = seam.signals('group:1')
    const text = renderAttentionFacts({ signals, now })

    expect(signals.ambient).toMatchObject({ humanCount: 3, speakerCount: 2 })
    expect(text).toContain('3 条真人发言，来自 2 个人')
    expect(signals.candidates.find(item => item.kind === 'join')?.why).toContain('来自 2 个人')
  })

  it('多人快速接话时把密度作为现场事实', () => {
    const { seam } = mount(tempFile())
    const now = Date.now()
    for (let index = 0; index < 60; index += 1) {
      seam.inbox.push('group:1', {
        senderId: `u${index % 3}`,
        text: `第 ${index} 条`,
        at: now - index * 1_000,
      })
    }

    const text = renderAttentionFacts({ signals: seam.signals('group:1'), now })

    expect(text).toContain('好几个人在并行接话')
    expect(text).toContain('群里消息刷得很快')
  })

  it('把当前话痨倾向和上次成功发言时间作为事实提供', () => {
    const { seam } = mount(tempFile())
    seam.noteSelfSpoke('group:1', 40_000)
    const text = renderAttentionFacts({
      signals: seam.signals('group:1'),
      talkativeness: 0.8,
      ...(seam.store.of('group:1').lastSelfSpokeAt === undefined
        ? {}
        : { lastSelfSpokeAt: seam.store.of('group:1').lastSelfSpokeAt }),
      selfTalkStreak: 2,
      now: 100_000,
    })

    expect(text).toContain('你最近说话偏活跃')
    expect(text).toContain('你上次在这里成功发言是刚刚')
    expect(text).toContain('你刚在群里连发了 2 个气泡')
  })

  it('私聊连发时只要求收短当前回复，群聊则先停一轮', () => {
    const group = renderAttentionFacts({
      signals: {
        ...mount(tempFile()).seam.signals('group:1'),
      },
      selfTalkStreak: 3,
    })
    const priv = renderAttentionFacts({
      signals: {
        ...mount(tempFile()).seam.signals('private:1'),
      },
      selfTalkStreak: 3,
    })

    expect(group).toContain('先停一轮')
    expect(priv).toContain('下一条只回当前这句话')
  })

  it('状态可直接当偏好传入，工具设过的条件能渲染出来', async () => {
    const { seam, tool } = mount(tempFile())
    await tool('set_wake_config').execute({ triggers: { poke: true } }, execOf('group:1'))

    const text = renderAttentionFacts({ signals: seam.signals('group:1'), wake: seam.store.of('group:1') })

    expect(text).toContain('被戳一下')
  })
})

describe('情绪档位只当事实', () => {
  it('传了情绪就在事实里补一行，档位与说法都带上', () => {
    const { seam } = mount(tempFile(), ['小岸'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '@小岸 你在吗？' })

    const text = renderAttentionFacts({
      signals: seam.signals('group:1'),
      emotion: { tier: 'high', label: '有点上火' },
    })

    expect(text).toContain('你现在的情绪：有点上火（偏重）')
  })

  it('档位是峰值时程度词更重，轻微时更轻', () => {
    const { seam } = mount(tempFile())
    const signals = seam.signals('group:1')

    expect(renderAttentionFacts({ signals, emotion: { tier: 'peak', label: '在生气' } }))
      .toContain('你现在的情绪：在生气（很重）')
    expect(renderAttentionFacts({ signals, emotion: { tier: 'mild', label: '有点闷' } }))
      .toContain('你现在的情绪：有点闷（刚起头）')
  })

  it('没给情绪就不写这一行，这是负例', () => {
    const { seam } = mount(tempFile(), ['小岸'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '@小岸 你在吗？' })

    const text = renderAttentionFacts({ signals: seam.signals('group:1') })

    expect(text).toContain('文本里出现名字：小岸')
    expect(text).not.toContain('你现在的情绪')
  })

  it('说法为空时也不写这一行', () => {
    const { seam } = mount(tempFile())

    const text = renderAttentionFacts({
      signals: seam.signals('group:1'),
      emotion: { tier: 'calm', label: '' },
    })

    expect(text).not.toContain('你现在的情绪')
  })

  it('加了情绪只多那一行，候选与现场事实一个字都没动', () => {
    const { seam } = mount(tempFile(), ['小岸'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '@小岸 你在吗？' })
    seam.inbox.push('group:1', { senderId: 'u1', text: '我觉得可以' })
    const signals = seam.signals('group:1')

    const plain = renderAttentionFacts({ signals })
    const withEmotion = renderAttentionFacts({ signals, emotion: { tier: 'peak', label: '在生气' } })

    expect(withEmotion.split('\n').filter(line => !line.startsWith('你现在的情绪')))
      .toEqual(plain.split('\n'))
    expect(signals.candidates.length).toBeGreaterThan(0)
    for (const candidate of signals.candidates) {
      expect(Object.keys(candidate).sort()).toEqual(['kind', 'why'])
    }
  })
})
