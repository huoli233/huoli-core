import { describe, expect, it } from 'vitest'
import { createGroupHistoryPoller, createPrivatePoller, groupHistoryMessage, privateHistoryMessage } from '../src/private-poll.ts'
import type { AskReply } from '../src/ws.ts'

const PEER = '10000001'
const SELF = '3763907983'

function historyReply(messages: Record<string, unknown>[]): AskReply {
  return { ok: true, data: { messages } }
}

function message(id: number, text: string, at: number, sender = Number(PEER)): Record<string, unknown> {
  return {
    message_id: id,
    sender_id: sender,
    sender_name: sender === Number(PEER) ? '活力小哈' : '大肥鱼',
    time: at,
    message: [{ type: 'text', data: { text } }],
  }
}

describe('好友私聊历史兜底', () => {
  it('第一次只建基线，之后只交出新的好友消息', async () => {
    const old = message(1, '旧消息', 100)
    const fresh = message(2, '新消息', 101)
    const replies = [historyReply([old]), historyReply([old, fresh])]
    let calls = 0
    const emitted: string[] = []
    const poller = createPrivatePoller({
      peers: [PEER],
      intervalMs: 1_000,
      status: () => ({ connected: true }),
      ask: async () => replies[Math.min(calls++, replies.length - 1)]!,
      sentIds: () => new Set(),
      selfId: SELF,
      emit: item => emitted.push(item.text),
    })

    await poller.pollOnce()
    await poller.pollOnce()

    expect(emitted).toEqual(['新消息'])
  })

  it('同一条历史重复返回也只交一次，自己的消息不叫醒', async () => {
    const own = message(1, '机器人自己说的', 100, Number(SELF))
    const friend = message(2, '你好', 101)
    const rows = [own, friend]
    let calls = 0
    const emitted: string[] = []
    const poller = createPrivatePoller({
      peers: [PEER],
      intervalMs: 1_000,
      status: () => ({ connected: true }),
      ask: async () => historyReply(calls++ === 0 ? [] : rows),
      sentIds: () => new Set(),
      selfId: SELF,
      emit: item => emitted.push(item.text),
    })

    await poller.pollOnce()
    await poller.pollOnce()
    await poller.pollOnce()

    expect(emitted).toEqual(['你好'])
  })

  it('一次性恢复点会补交时刻之后的旧消息', async () => {
    const older = message(1, '太早的', 100)
    const replay = message(2, '漏掉的', 200)
    const emitted: string[] = []
    const poller = createPrivatePoller({
      peers: [PEER],
      intervalMs: 1_000,
      replaySince: 150_000,
      status: () => ({ connected: true }),
      ask: async () => historyReply([older, replay]),
      sentIds: () => new Set(),
      selfId: SELF,
      emit: item => emitted.push(item.text),
    })

    await poller.pollOnce()

    expect(emitted).toEqual(['漏掉的'])
  })

  it('历史条目翻成私聊入站并保留发送者', () => {
    const incoming = privateHistoryMessage(message(9, '在吗', 123), PEER, SELF)

    expect(incoming).toMatchObject({
      chatKey: `private:${PEER}`,
      senderId: PEER,
      senderName: '活力小哈',
      text: '在吗',
      at: 123000,
      atMe: true,
      selfSent: false,
    })
  })
})

describe('群历史补收', () => {
  const GROUP = '123'

  it('群历史条目保留发送者、时间和历史来源', () => {
    const incoming = groupHistoryMessage(message(9, '在吗', 123), GROUP, SELF)

    expect(incoming).toMatchObject({
      chatKey: `group:${GROUP}`,
      senderId: PEER,
      senderName: '活力小哈',
      text: '在吗',
      at: 123000,
      atMe: false,
      selfSent: false,
      history: 'group',
    })
  })

  it('第一次只补近期消息，旧消息和自己的消息都不交出来', async () => {
    const old = message(1, '太早的', 700, 555)
    const recent = message(2, '刚说过', 950, 555)
    const own = message(3, '自己说的', 960, Number(SELF))
    const emitted: string[] = []
    const poller = createGroupHistoryPoller({
      groups: [GROUP],
      intervalMs: 1_000,
      maxAgeMs: 120_000,
      now: () => 1_000_000,
      status: () => ({ connected: true }),
      ask: async () => historyReply([old, recent, own]),
      sentIds: () => new Set(),
      selfId: SELF,
      replayInitial: true,
      emit: item => emitted.push(item.text),
    })

    await poller.pollOnce()

    expect(emitted).toEqual(['刚说过'])
  })

  it('默认第一次只建立水位基线，不回放会污染新会话的旧群消息', async () => {
    const emitted: string[] = []
    const events: string[] = []
    const poller = createGroupHistoryPoller({
      groups: [GROUP],
      intervalMs: 1_000,
      maxAgeMs: 600_000,
      now: () => 1_000_000,
      status: () => ({ connected: true }),
      ask: async () => historyReply([message(1, '旧消息', 960, 555)]),
      sentIds: () => new Set(),
      selfId: SELF,
      emit: item => emitted.push(item.text),
      report: event => events.push(event.kind),
    })

    await poller.pollOnce()

    expect(emitted).toEqual([])
    expect(events).toEqual(['baseline'])
  })

  it('后续按消息编号和时间水位只补新消息', async () => {
    const first = message(1, '第一句', 900, 555)
    const second = message(2, '第二句', 960, 555)
    const replies = [historyReply([first]), historyReply([first, second]), historyReply([first, second])]
    let calls = 0
    const emitted: string[] = []
    const poller = createGroupHistoryPoller({
      groups: [GROUP],
      intervalMs: 1_000,
      maxAgeMs: 600_000,
      now: () => 1_000_000,
      status: () => ({ connected: true }),
      ask: async () => replies[Math.min(calls++, replies.length - 1)]!,
      sentIds: () => new Set(),
      selfId: SELF,
      replayInitial: true,
      emit: item => emitted.push(item.text),
    })

    await poller.pollOnce()
    await poller.pollOnce()
    await poller.pollOnce()

    expect(emitted).toEqual(['第一句', '第二句'])
  })
})
