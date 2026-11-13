import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { Agent } from '@huoli/huoli-agent'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applyAttention, qqAttentionOf } from '@huoli/huoli-qq-attention'
import { apply as applyChannel } from '@huoli/huoli-qq-channel'
import { apply as applySubject, qqSubjectOf } from '@huoli/huoli-qq-subject'
import {
  apply as applyVitals,
  createVitalsStore,
  emptyState,
  qqVitalsOf,
  resolveTuning,
  type QqVitalsSeam,
  WORDS_PRESET,
} from '@huoli/huoli-qq-vitals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply as applyBundle } from '../src/index.ts'

const tuning = resolveTuning()

type SocketHandler = (event: { data?: string }) => void

// 只留住那一头的事件，测试自己决定什么时候连上、什么时候把话送进来
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
  }

  close(): void {
    this.readyState = 3
  }

  open(): void {
    this.readyState = 1
    this.emit('open')
  }

  deliver(raw: Record<string, unknown>): void {
    this.emit('message', JSON.stringify(raw))
  }

  private emit(type: string, data?: string): void {
    for (const handler of this.handlers.get(type) ?? []) handler(data === undefined ? {} : { data })
  }
}

interface Mounted {
  ctx: Context
  socket: FakeSocket
  seam: QqVitalsSeam
  file: string
}

const tempDirs: string[] = []
const contexts: Context[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-incoming-'))
  tempDirs.push(dir)
  return dir
}

// 身体先跑了一分钟，消息上的时间才追得上它
function seed(file: string): void {
  createVitalsStore({ file, tuning }).write({ ...emptyState(tuning, Date.now() - 60_000), thirst: 0.6 })
}

async function mount(options: {
  sleeping?: boolean
  groupMergeMs?: number
  privateMergeMs?: number
  creatorQq?: string
  ownerUnrestricted?: boolean
} = {}): Promise<Mounted> {
  const dir = tempDir()
  const file = path.join(dir, 'vitals.json')
  if (options.sleeping === true) {
    createVitalsStore({ file, tuning }).write({
      ...emptyState(tuning, Date.now() - 60_000),
      thirst: 0.6,
      sleep_state: 'sleeping',
      sleep_kind: 'nap',
      nap_at: Date.now(),
      adenosine: 0.9,
      asleep: true,
      wake_after: Date.now() + 60 * 60_000,
    })
  } else seed(file)
  const ctx = new Context()
  contexts.push(ctx)
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})
  applyAttention(ctx, { file: path.join(dir, 'attention.json'), selfNames: ['小岸'] })
  applySubject(ctx, { file: path.join(dir, 'subject.json') })
  applyVitals(ctx, { file, tuning: { words: WORDS_PRESET, startDelayMs: 60 * 60_000 } })
  applyChannel(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999', sentLedgerFile: path.join(dir, 'sent.json') })
  applyBundle(ctx, {
    maxSteps: 5,
    dailySweepAt: '04:00',
    decisionsFile: path.join(dir, 'decisions.jsonl'),
    wakeLogFile: path.join(dir, 'wake.jsonl'),
    ...options.groupMergeMs === undefined ? {} : { groupMergeMs: options.groupMergeMs },
    ...options.privateMergeMs === undefined ? {} : { privateMergeMs: options.privateMergeMs },
    ...options.creatorQq === undefined ? {} : { creatorQq: options.creatorQq },
    ...options.ownerUnrestricted === undefined ? {} : { ownerUnrestricted: options.ownerUnrestricted },
  })
  const socket = FakeSocket.opened.at(-1)
  const seam = qqVitalsOf(ctx)
  if (socket === undefined || seam === undefined) throw new Error('没装起来')
  socket.open()
  return { ctx, socket, seam, file }
}

const second = (): number => Math.floor(Date.now() / 1000)

function groupMessage(text: string, id: number, time: number): Record<string, unknown> {
  return {
    post_type: 'message',
    message_type: 'group',
    group_id: 123,
    user_id: 555,
    sender: { card: '阿澈' },
    message: [{ type: 'text', data: { text } }],
    message_id: id,
    time,
  }
}

beforeEach(() => {
  FakeSocket.opened.length = 0
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('群里的消息进到身体', () => {
  it('群聊连续短句合并成一次现场，句末标点不逐条唤醒', async () => {
    const { socket, file } = await mount({ groupMergeMs: 20 })
    socket.deliver(groupMessage('刚才那局真难', 771, second()))
    socket.deliver(groupMessage('我差一点就过了。', 772, second()))

    await new Promise(resolve => setTimeout(resolve, 35))

    const records = fs.readFileSync(path.join(path.dirname(file), 'wake.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line) as { kind: string; count?: number })
    const merged = records.filter(record => record.kind === 'merge_flushed')
    expect(merged).toHaveLength(1)
    expect(merged[0]?.count).toBe(2)
  })

  it('被点名仍立即进入模型主链', async () => {
    const { socket, file } = await mount({ groupMergeMs: 1_000 })
    socket.deliver({
      ...groupMessage('@999 看这个', 773, second()),
      message: [{ type: 'at', data: { qq: '999' } }, { type: 'text', data: { text: ' 看这个' } }],
    })

    const records = fs.readFileSync(path.join(path.dirname(file), 'wake.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line) as { kind: string; count?: number })
    const merged = records.filter(record => record.kind === 'merge_flushed')
    expect(merged).toHaveLength(1)
    expect(merged[0]?.count).toBe(1)
  })

  it('真正睡着时，@ 也不会进入模型或改动身体', async () => {
    const { socket, seam } = await mount({ sleeping: true })
    const before = seam.read()

    socket.deliver({
      ...groupMessage('@999 醒醒', 779, second()),
      message: [{ type: 'at', data: { qq: '999' } }, { type: 'text', data: { text: ' 醒醒' } }],
    })
    const after = seam.read()

    expect(after.last_msg).toBe(before.last_msg)
    expect(after.last_user_text).toBe(before.last_user_text)
  })

  it('真正睡着时好友私聊仍能叫醒并留下醒点', async () => {
    const { socket, seam, file } = await mount({ sleeping: true })
    const before = seam.read()

    socket.deliver({
      post_type: 'message',
      message_type: 'private',
      user_id: 555,
      sender: { card: '阿澈' },
      message: [{ type: 'text', data: { text: '你睡了吗？' } }],
      message_id: 780,
      time: second(),
    })
    await new Promise(resolve => setTimeout(resolve, 5))

    const after = seam.read()
    const records = fs.readFileSync(path.join(path.dirname(file), 'wake.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line) as { kind: string; wakeAfter?: number })

    expect(after.woken_at).toBeGreaterThan(before.woken_at)
    expect(after.last_user_text).toBe('你睡了吗？')
    expect(records.some(record => record.kind === 'rest_private_wake' && record.wakeAfter === before.wake_after)).toBe(true)
  })

  it('模型自己定时休息时，@ 仍然能叫醒她', async () => {
    const { ctx, socket, file } = await mount()
    const attention = qqAttentionOf(ctx)
    if (attention === undefined) throw new Error('注意力没有装上')
    attention.store.append({
      type: 'wake',
      chatKey: 'group:123',
      wakeMode: 'timed',
      wakeUntil: Date.now() + 60_000,
      triggers: { atMention: true, anyMessage: true },
      at: Date.now(),
    })

    socket.deliver({
      ...groupMessage('@999 醒醒', 780, second()),
      message: [{ type: 'at', data: { qq: '999' } }, { type: 'text', data: { text: ' 醒醒' } }],
    })
    await new Promise(resolve => setTimeout(resolve, 5))

    const records = fs.readFileSync(path.join(path.dirname(file), 'wake.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line) as { kind: string; reason?: string })
    expect(records.some(record => record.kind === 'followup_request')).toBe(true)
    expect(records.some(record => record.kind === 'wake_skipped' && record.reason === 'timed_rest')).toBe(false)
  })

  it('模型自己定时休息时，好友私聊默认仍能进入判断', async () => {
    const { ctx, socket, seam } = await mount()
    const attention = qqAttentionOf(ctx)
    if (attention === undefined) throw new Error('注意力没有装上')
    attention.store.append({
      type: 'wake',
      chatKey: 'private:555',
      wakeMode: 'timed',
      wakeUntil: Date.now() + 60_000,
      triggers: { anyMessage: true },
      at: Date.now(),
    })
    const before = seam.read()

    socket.deliver({
      post_type: 'message',
      message_type: 'private',
      user_id: 555,
      sender: { card: '阿澈' },
      message: [{ type: 'text', data: { text: '还醒着吗？' } }],
      message_id: 781,
      time: second(),
    })
    await new Promise(resolve => setTimeout(resolve, 5))

    expect(seam.read().last_user_text).toBe('还醒着吗？')
    expect(seam.read().last_msg).toBeGreaterThan(before.last_msg)
  })

  it('主人私聊不受定时休息和空触发条件影响', async () => {
    const { ctx, socket, file } = await mount({ creatorQq: '777', ownerUnrestricted: true, privateMergeMs: 0 })
    const attention = qqAttentionOf(ctx)
    if (attention === undefined) throw new Error('注意力没有装上')
    attention.store.append({
      type: 'wake',
      chatKey: 'private:777',
      wakeMode: 'timed',
      wakeUntil: Date.now() + 60_000,
      triggers: {},
      at: Date.now(),
    })

    socket.deliver({
      post_type: 'message',
      message_type: 'private',
      user_id: 777,
      sender: { card: '主人昵称' },
      message: [{ type: 'text', data: { text: '在吗' } }],
      message_id: 882,
    })
    await new Promise(resolve => setTimeout(resolve, 5))

    const records = fs.readFileSync(path.join(path.dirname(file), 'wake.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line) as { kind: string; reason?: string })
    expect(records.some(record => record.kind === 'followup_request')).toBe(true)
    expect(records.some(record => record.kind === 'wake_skipped')).toBe(false)
  })

  it('一条消息让口渴掉下去，喝水时间跟着更新', async () => {
    const { socket, seam } = await mount()
    const before = seam.read()
    const time = second()

    socket.deliver(groupMessage('喝水了', 777, time))
    const after = seam.read()

    expect(after.last_msg).toBeGreaterThan(before.last_msg)
    expect(after.last_user_text).toBe('喝水了')
    expect(after.last_drink).toBe(time * 1000)
    expect(before.thirst - after.thirst).toBeGreaterThan(0.5)
    expect(after.thirst).toBeLessThan(0.1)
  })

  it('同一条消息送两次只算一次', async () => {
    const { socket, seam } = await mount()
    const time = second()
    const raw = groupMessage('喝水了', 777, time)

    socket.deliver(raw)
    const once = seam.read()
    socket.deliver(raw)
    const twice = seam.read()

    expect(once.last_drink_at).toBe(time * 1000)
    expect(twice.last_drink_at).toBe(time * 1000)
    expect(twice.thirst).toBeCloseTo(once.thirst, 10)
  })

  it('当前发言人的关系按用户编号进入提示词', async () => {
    const { ctx, socket } = await mount()

    socket.deliver(groupMessage('第一次一起聊天', 778, second()))
    const subject = qqSubjectOf(ctx)
    if (subject === undefined) throw new Error('状态没有装上')

    expect(subject.relations.get('555')?.displayName).toBe('阿澈')
    const assembly = await ctx.systemPrompt.assemble({ agent: { id: 'group:123' } as Agent })
    const relation = assembly.sections.find(section => section.name === 'qq:relation')
    expect(relation?.text).toContain('用户编号 555')
    expect(relation?.text).toContain('阿澈')
  })
})

describe('私聊的消息也进到身体', () => {
  it('被抱一下，亲近涨一点', async () => {
    const { socket, seam } = await mount()
    const before = seam.read()
    const time = second()

    socket.deliver({
      post_type: 'message',
      message_type: 'private',
      user_id: 555,
      sender: { nickname: '阿澈' },
      message: [{ type: 'text', data: { text: '抱抱你' } }],
      message_id: 888,
      time,
    })
    const after = seam.read()

    expect(after.last_msg).toBe(time * 1000)
    expect(after.last_user_text).toBe('抱抱你')
    expect(after.oxytocin).toBeGreaterThan(before.oxytocin)
  })
})

describe('不是一句话的事件不动身体', () => {
  it('戳一戳不动', async () => {
    const { socket, seam } = await mount()
    const before = seam.read()

    socket.deliver({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', target_id: 999, user_id: 555, group_id: 123 })
    const after = seam.read()

    expect(after.last_msg).toBe(before.last_msg)
    expect(after.last_user_text).toBe(before.last_user_text)
    // 身体读数会随时间自然漂移，这里只确认没有因事件产生可见变化
    expect(after.thirst).toBeCloseTo(before.thirst, 5)
  })

  it('模型定时休息时，戳一戳仍然能叫醒她', async () => {
    const { ctx, socket, file } = await mount()
    const attention = qqAttentionOf(ctx)
    if (attention === undefined) throw new Error('注意力没有装上')
    attention.store.append({
      type: 'wake',
      chatKey: 'group:123',
      wakeMode: 'timed',
      wakeUntil: Date.now() + 60_000,
      triggers: { poke: true },
      at: Date.now(),
    })

    socket.deliver({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', target_id: 999, user_id: 555, group_id: 123 })
    await new Promise(resolve => setTimeout(resolve, 0))

    const records = fs.readFileSync(path.join(path.dirname(file), 'wake.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line) as { kind: string; reason?: string })
    expect(records.some(record => record.kind === 'followup_request')).toBe(true)
    expect(records.some(record => record.kind === 'wake_skipped' && record.reason === 'timed_rest')).toBe(false)
  })

  it('只有表情的消息不动', async () => {
    const { socket, seam } = await mount()
    const before = seam.read()

    socket.deliver({ ...groupMessage('', 900, second()), message: [{ type: 'face', data: {} }] })
    const after = seam.read()

    expect(after.last_msg).toBe(before.last_msg)
    expect(after.last_user_text).toBe(before.last_user_text)
    expect(after.thirst).toBeCloseTo(before.thirst, 5)
  })

  it('撤回会带着刚看到的原话进入同一条会话判断', async () => {
    const { socket, file } = await mount({ groupMergeMs: 1_000 })
    socket.deliver(groupMessage('刚才那句说错了', 980, second()))
    socket.deliver({
      post_type: 'notice', notice_type: 'group_recall', group_id: 123,
      user_id: 555, operator_id: 555, message_id: 980,
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    const records = fs.readFileSync(path.join(path.dirname(file), 'wake.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line) as { kind: string; hasOriginal?: boolean })
    expect(records.find(record => record.kind === 'recall_received')?.hasOriginal).toBe(true)
    expect(records.some(record => record.kind === 'followup_request')).toBe(true)
  })

  it('真正睡着时撤回只留现场，不把模型叫起来', async () => {
    const { socket, file } = await mount({ sleeping: true })
    socket.deliver({
      post_type: 'notice', notice_type: 'group_recall', group_id: 123,
      user_id: 555, operator_id: 555, message_id: 981,
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    const records = fs.readFileSync(path.join(path.dirname(file), 'wake.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line) as { kind: string; reason?: string })
    expect(records.some(record => record.kind === 'recall_received')).toBe(true)
    expect(records.some(record => record.kind === 'followup_request')).toBe(false)
    expect(records.some(record => record.kind === 'rest_skipped' && record.reason === 'sleeping')).toBe(true)
  })

  it('机器人自己执行的撤回不唤醒自己', async () => {
    const { socket, file } = await mount()
    socket.deliver({
      post_type: 'notice', notice_type: 'group_recall', group_id: 123,
      user_id: 999, operator_id: 999, message_id: 982,
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    const wakeFile = path.join(path.dirname(file), 'wake.jsonl')
    const records = fs.existsSync(wakeFile)
      ? fs.readFileSync(wakeFile, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { kind: string })
      : []
    expect(records.some(record => record.kind === 'recall_received')).toBe(false)
    expect(records.some(record => record.kind === 'followup_request')).toBe(false)
  })
})

describe('卸载之后', () => {
  it('再来消息也不动身体', async () => {
    const { ctx, socket, seam } = await mount()
    const before = seam.read()
    contexts.splice(contexts.indexOf(ctx), 1)
    await ctx.fiber.dispose()

    socket.deliver(groupMessage('喝水了', 991, second()))

    expect(seam.read().last_msg).toBe(before.last_msg)
    expect(seam.read().last_drink).toBe(before.last_drink)
  })
})
