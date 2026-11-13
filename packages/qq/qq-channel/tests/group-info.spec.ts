import { describe, expect, it, vi, afterEach } from 'vitest'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import type { AskReply, WsChannel } from '../src/ws.ts'
import {
  activePeople,
  createGroupInfo,
  GROUP_INFO_DEFAULTS,
  safeText,
  type GroupInfoTuning,
} from '../src/group-info.ts'
import { apply } from '../src/index.ts'

// 只回固定数据的假连接，按 action 记账
type ReplyMap = Record<string, AskReply>
function fakeChannel(replies: ReplyMap, calls?: string[]): WsChannel {
  return {
    ask: async (action: string) => {
      calls?.push(action)
      return replies[action] ?? { ok: false, code: 'channel.unsupported', reason: '没实现', hint: '这一轮不可用' }
    },
  } as unknown as WsChannel
}

const ok = (data: Record<string, unknown>): AskReply => ({ ok: true, data })
const fail = (code = 'channel.1404'): AskReply => ({ ok: false, code, reason: '网关没这个接口', hint: '别原样重来' })

function tuning(patch: Partial<GroupInfoTuning> = {}, now: () => number = () => 1_000): GroupInfoTuning {
  return { ...GROUP_INFO_DEFAULTS, now, ...patch }
}

const GROUP = 'group:750677335'

// 一个会按 action 回数据的假连接，用来验工具真的接进主链
class GroupSocket {
  static readonly opened: GroupSocket[] = []
  readyState = 0
  private readonly handlers = new Map<string, ((event: { data?: string }) => void)[]>()

  constructor() {
    GroupSocket.opened.push(this)
  }

  addEventListener(type: string, handler: (event: { data?: string }) => void): void {
    const list = this.handlers.get(type)
    if (list === undefined) this.handlers.set(type, [handler])
    else list.push(handler)
  }

  send(payload: string): void {
    const sent = JSON.parse(payload) as { echo?: string; action?: string }
    const echo = sent.echo ?? ''
    const data = sent.action === 'get_group_info'
      ? { group_id: 750677335, group_name: '小鱼塘', member_count: 3 }
      : sent.action === 'get_group_root_files'
        ? { files: [{ file_id: 'f1', file_name: '名单.txt', size: 12, uploader_id: 678, upload_time: 1_700_000_000 }], folders: [] }
        : sent.action === '_get_group_notice'
          ? { notices: [{ notice_id: 'n1', message: '明天休息', publish_time: 1_700_000_000 }] }
          : sent.action === 'get_group_msg_history'
            ? { messages: [{ message_id: 1, user_id: 678, sender: { nickname: '甲' }, time: 1_700_000_000, message: '一句' }] }
            : sent.action === 'get_group_member_list'
              ? { members: [{ user_id: 678, card: '甲', role: 'member' }] }
              : {}
    this.emit('message', JSON.stringify({ echo, retcode: 0, data }))
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

function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

describe('四个工具真的挂进主链', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    GroupSocket.opened.length = 0
  })

  it('四个只读工具都能从装配实例调到真接口', async () => {
    vi.stubGlobal('WebSocket', GroupSocket)
    const ctx = new Context()
    const tools = new Map<string, ToolDefinition>()
    ctx.accessor('tools', { get: () => ({ register: (definition: ToolDefinition) => { tools.set(definition.name, definition); return () => {} } }) })
    ctx.logger.exporter({ levels: { default: 3 }, export: () => {} })
    apply(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999' })
    GroupSocket.opened.at(-1)?.open()

    expect([...tools.keys()]).toEqual(expect.arrayContaining([
      'qq_group_info', 'qq_group_files', 'qq_group_notice', 'qq_group_snapshot',
    ]))
    const info = await tools.get('qq_group_info')?.execute({}, execOf(GROUP)) as { group: { name: string } }
    const files = await tools.get('qq_group_files')?.execute({}, execOf(GROUP)) as { count: number }
    const notice = await tools.get('qq_group_notice')?.execute({}, execOf(GROUP)) as { count: number }
    const snapshot = await tools.get('qq_group_snapshot')?.execute({}, execOf(GROUP)) as { available: boolean; refs: unknown[] }
    expect(info.group.name).toBe('小鱼塘')
    expect(files.count).toBe(1)
    expect(notice.count).toBe(1)
    expect(snapshot.available).toBe(true)
    expect(snapshot.refs.length).toBeGreaterThan(0)
    await ctx.fiber.dispose()
  })

  it('接口不支持时工具如实抛结构化失败码，不说成成功', async () => {
    vi.stubGlobal('WebSocket', GroupSocket)
    const ctx = new Context()
    const tools = new Map<string, ToolDefinition>()
    ctx.accessor('tools', { get: () => ({ register: (definition: ToolDefinition) => { tools.set(definition.name, definition); return () => {} } }) })
    ctx.logger.exporter({ levels: { default: 3 }, export: () => {} })
    apply(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999' })
    GroupSocket.opened.at(-1)?.open()
    const port = tools.get('qq_group_info')
    if (port === undefined) throw new Error('没挂上群资料工具')
    await expect(port.execute({}, execOf('private:1'))).rejects.toThrow('channel.read_private')
    await ctx.fiber.dispose()
  })
})

describe('群资料', () => {
  it('读群名与人数，缓存命中不再打接口', async () => {
    const calls: string[] = []
    const channel = fakeChannel({ get_group_info: ok({ group_id: 750677335, group_name: '小鱼塘', member_count: 12, max_member_count: 200 }) }, calls)
    const port = createGroupInfo(channel, tuning(), '999')

    const first = await port.info(GROUP)
    const second = await port.info(GROUP)

    expect(first.ok).toBe(true)
    if (!first.ok || first.kind !== 'group') return
    expect(first.group).toEqual({ groupId: '750677335', name: '小鱼塘', memberCount: 12, maxMemberCount: 200 })
    expect(second).toEqual(first)
    expect(calls.filter(call => call === 'get_group_info')).toHaveLength(1)
  })

  it('缓存过期会重取', async () => {
    let clock = 1_000
    const calls: string[] = []
    const channel = fakeChannel({
      get_group_info: ok({ group_name: '先这个名', member_count: 1 }),
    }, calls)
    const port = createGroupInfo(channel, tuning({ groupTtlMs: 100 }, () => clock), '999')

    await port.info(GROUP)
    clock = 1_200
    const again = await port.info(GROUP)

    expect(again.ok).toBe(true)
    expect(calls.filter(call => call === 'get_group_info')).toHaveLength(2)
  })

  it('单人资料走成员接口，也在实例内缓存', async () => {
    const calls: string[] = []
    const channel = fakeChannel({
      get_group_member_info: ok({ user_id: 678, card: '小鲸鱼', role: 'admin', join_time: 1_600_000_000, last_sent_time: 1_700_000_000 }),
    }, calls)
    const port = createGroupInfo(channel, tuning(), '999')

    const first = await port.info(GROUP, '678')
    const second = await port.info(GROUP, '678')

    expect(first.ok).toBe(true)
    if (!first.ok || first.kind !== 'member') return
    expect(first.member.name).toBe('小鲸鱼')
    expect(first.member.role).toBe('admin')
    expect(second).toEqual(first)
    expect(calls.filter(call => call === 'get_group_member_info')).toHaveLength(1)
  })

  it('网关不支持时如实报码，说清这一轮不可用', async () => {
    const port = createGroupInfo(fakeChannel({ get_group_info: fail() }), tuning(), '999')

    const outcome = await port.info(GROUP)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('channel.unsupported')
    expect(outcome.reason).toContain('这一轮不可用')
    expect(outcome.unavailable).toBe(true)
  })

  it('失败只缓存五秒，之后会重取', async () => {
    let clock = 1_000
    const calls: string[] = []
    const channel = fakeChannel({ get_group_info: fail() }, calls)
    const port = createGroupInfo(channel, tuning({ failureTtlMs: 100 }, () => clock), '999')

    await port.info(GROUP)
    await port.info(GROUP)
    clock = 1_200
    await port.info(GROUP)

    expect(calls.filter(call => call === 'get_group_info')).toHaveLength(2)
  })

  it('私聊不给群资料，编号不对也拒', async () => {
    const port = createGroupInfo(fakeChannel({}), tuning(), '999')
    const privateOne = await port.info('private:1')
    const badOne = await port.info(GROUP, '不是编号')
    expect(privateOne.ok).toBe(false)
    expect(badOne.ok).toBe(false)
  })
})

describe('群文件', () => {
  it('只给文件元数据，不带本机路径与下载地址', async () => {
    const channel = fakeChannel({
      get_group_root_files: ok({
        files: [{
          file_id: 'f-1',
          file_name: '周报.txt',
          size: 2048,
          uploader_id: 678,
          upload_time: 1_700_000_000,
          url: 'file:///C:/Users/someone/周报.txt',
        }],
        folders: [],
      }),
    })
    const port = createGroupInfo(channel, tuning(), '999')

    const outcome = await port.files(GROUP, 30)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.items).toHaveLength(1)
    expect(outcome.items[0]).toEqual({ fileId: 'f-1', name: '周报.txt', size: 2048, uploaderId: '678', at: 1_700_000_000_000 })
    expect(JSON.stringify(outcome)).not.toMatch(/[A-Za-z]:[\\/]/)
    expect(JSON.stringify(outcome)).not.toContain('file://')
  })

  it('文件名里混进本机路径会被抹掉', async () => {
    const channel = fakeChannel({
      get_group_root_files: ok({ files: [{ file_id: 'f-2', file_name: 'D:\\secret\\名单.xlsx', size: 1 }], folders: [] }),
    })
    const port = createGroupInfo(channel, tuning(), '999')

    const outcome = await port.files(GROUP, 30)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.items[0]?.name).toContain('[已略去]')
    expect(outcome.items[0]?.name).not.toContain('D:\\')
  })

  it('翻文件夹，超上限标 truncated 与 partial', async () => {
    const channel = fakeChannel({
      get_group_root_files: ok({
        files: [],
        folders: [{ folder_id: 'd1' }, { folder_id: 'd2' }, { folder_id: 'd3' }],
      }),
      get_group_files_by_folder: ok({ files: [{ file_id: 'x', file_name: '里面.txt', size: 5 }] }),
    })
    const port = createGroupInfo(channel, tuning({ maxFolders: 1, filesMax: 1 }), '999')

    const outcome = await port.files(GROUP, 30)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.partial).toBe(true)
    expect(outcome.items[0]?.fileId).toBe('x')
  })

  it('条数超过上限标 truncated', async () => {
    const files = Array.from({ length: 5 }, (_unused, at) => ({ file_id: `f${at}`, file_name: `第${at}个`, size: at }))
    const port = createGroupInfo(fakeChannel({ get_group_root_files: ok({ files, folders: [] }) }), tuning({ filesMax: 2 }), '999')

    const outcome = await port.files(GROUP, 30)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.items).toHaveLength(2)
    expect(outcome.truncated).toBe(true)
  })

  it('网关不支持时如实报码，不给空清单', async () => {
    const port = createGroupInfo(fakeChannel({ get_group_root_files: fail() }), tuning(), '999')

    const outcome = await port.files(GROUP, 30)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('channel.unsupported')
    expect(outcome.reason).toContain('这一轮不可用')
    expect('items' in outcome).toBe(false)
  })
})

describe('群公告', () => {
  it('读公告并按字数截断标 truncated', async () => {
    const channel = fakeChannel({
      _get_group_notice: ok({ notices: [{ notice_id: 'n1', sender_id: 9, publish_time: 1_700_000_000, message: '很长'.repeat(100) }] }),
    })
    const port = createGroupInfo(channel, tuning({ textMaxChars: 20 }), '999')

    const outcome = await port.notice(GROUP, 10)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.items).toHaveLength(1)
    expect(outcome.items[0]?.truncated).toBe(true)
    expect(outcome.items[0]?.text.length).toBe(20)
  })

  it('条数超过上限标 truncated', async () => {
    const notices = Array.from({ length: 4 }, (_unused, at) => ({ notice_id: `n${at}`, message: `第${at}条` }))
    const port = createGroupInfo(fakeChannel({ _get_group_notice: ok({ notices }) }), tuning({ noticeMax: 2 }), '999')

    const outcome = await port.notice(GROUP, 10)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.items).toHaveLength(2)
    expect(outcome.truncated).toBe(true)
  })

  it('网关不支持时如实报码，不编公告', async () => {
    const port = createGroupInfo(fakeChannel({ _get_group_notice: fail() }), tuning(), '999')

    const outcome = await port.notice(GROUP, 10)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('channel.unsupported')
    expect(outcome.reason).toContain('这一轮不可用')
  })
})

const MESSAGES = [
  { message_id: 101, user_id: 678, sender: { user_id: 678, nickname: '甲' }, time: 1_700_000_001, message: '第一句' },
  { message_id: 102, user_id: 678, sender: { user_id: 678, nickname: '甲' }, time: 1_700_000_002, message: '第二句' },
  { message_id: 103, user_id: 789, sender: { user_id: 789, nickname: '乙' }, time: 1_700_000_003, message: '第三句' },
  { message_id: 104, user_id: 999, sender: { user_id: 999, nickname: '自己' }, time: 1_700_000_004, message: '我接一句' },
  { message_id: 105, user_id: 789, sender: { user_id: 789, nickname: '乙' }, time: 1_700_000_005, message: '第四句' },
]

function snapshotChannel(replies: ReplyMap = {}): WsChannel {
  return fakeChannel({
    get_group_msg_history: ok({ messages: MESSAGES }),
    get_group_member_list: ok({ members: [
      { user_id: 678, card: '甲', role: 'member' },
      { user_id: 789, card: '乙', role: 'admin' },
    ] }),
    ...replies,
  })
}

describe('一次拿全的快照', () => {
  it('四段一次聚合，各带 truncated 与 refs', async () => {
    const calls: string[] = []
    const port = createGroupInfo(snapshotChannel(), tuning(), '999')

    const outcome = await port.snapshot(GROUP)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.available).toBe(true)
    expect(outcome.unread.items.length).toBeGreaterThan(0)
    expect(outcome.recent.items.length).toBeGreaterThan(0)
    expect(outcome.members.items.length).toBe(2)
    expect(outcome.active.items.length).toBeGreaterThan(0)
    for (const section of [outcome.unread, outcome.recent, outcome.members, outcome.active]) {
      expect(typeof section.truncated).toBe('boolean')
      expect(section.refs.length).toBeGreaterThan(0)
    }
    expect(outcome.refs.map(ref => ref.tool)).toContain('qq_group_files')
    expect(outcome.refs.map(ref => ref.tool)).toContain('qq_group_notice')
    expect(calls).toEqual([])
  })

  it('每条正文按字数截断并标 truncated', async () => {
    const long = [
      { message_id: 1, user_id: 678, sender: { user_id: 678, nickname: '甲' }, time: 1_700_000_000, message: '很长'.repeat(100) },
    ]
    const port = createGroupInfo(fakeChannel({
      get_group_msg_history: ok({ messages: long }),
      get_group_member_list: ok({ members: [] }),
    }), tuning({ textMaxChars: 8 }), '999')

    const outcome = await port.snapshot(GROUP)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.recent.items[0]?.text.length).toBe(8)
    expect(outcome.recent.items[0]?.truncated).toBe(true)
    expect(outcome.recent.truncated).toBe(true)
  })

  it('段条数超过上限标 truncated', async () => {
    const port = createGroupInfo(snapshotChannel(), tuning({ maxRecent: 1, maxMembers: 1, maxActive: 1, maxUnread: 1 }), '999')

    const outcome = await port.snapshot(GROUP)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.recent.items).toHaveLength(1)
    expect(outcome.recent.truncated).toBe(true)
    expect(outcome.members.items).toHaveLength(1)
    expect(outcome.members.truncated).toBe(true)
    expect(outcome.truncated).toBe(true)
  })

  it('整段字数上限会把后面的段标成截断', async () => {
    const port = createGroupInfo(snapshotChannel(), tuning({ maxChars: 12 }), '999')

    const outcome = await port.snapshot(GROUP)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.truncated).toBe(true)
    const chars = [outcome.unread, outcome.recent, outcome.members, outcome.active]
      .flatMap(section => section.items.map(item => item.text.length))
      .reduce((sum, n) => sum + n, 0)
    expect(chars).toBeLessThanOrEqual(12)
    const anyTruncated = [outcome.unread, outcome.recent, outcome.members, outcome.active]
      .some(section => section.items.some(item => item.truncated) || section.truncated)
    expect(anyTruncated).toBe(true)
  })

  it('活跃者按最近非自己消息计数排序，不做内容判断', async () => {
    const port = createGroupInfo(snapshotChannel(), tuning(), '999')

    const outcome = await port.snapshot(GROUP)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.active.items[0]?.id).toBe('789')
    expect(outcome.active.items[0]?.text).toContain('2 条')
    expect(outcome.active.items[1]?.text).toContain('2 条')
    expect(outcome.active.items.some(item => item.id === '999')).toBe(false)
  })

  it('活跃者纯函数按计数、再按最近发言排', () => {
    const lines = [
      { senderId: '1', senderName: '甲', at: 1 },
      { senderId: '2', senderName: '乙', at: 2 },
      { senderId: '2', senderName: '乙', at: 3 },
      { senderId: '1', senderName: '甲', at: 4 },
      { senderId: '3', senderName: '丙', at: 5 },
    ]
    expect(activePeople(lines, '0', 30, 2).map(row => row.userId)).toEqual(['1', '2'])
    expect(activePeople(lines, '1', 30, 3).map(row => row.userId)).toEqual(['2', '3'])
  })

  it('接口全不可用时如实报码，不说成群里没这些东西', async () => {
    const port = createGroupInfo(fakeChannel({
      get_group_msg_history: fail(),
      get_group_member_list: fail(),
    }), tuning(), '999')

    const outcome = await port.snapshot(GROUP)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('channel.unsupported')
    expect(outcome.reason).toContain('这一轮不可用')
    expect(outcome.unavailable).toBe(true)
  })

  it('部分接口不可用时只把那一段标失败，其余照给', async () => {
    const port = createGroupInfo(fakeChannel({
      get_group_msg_history: ok({ messages: MESSAGES }),
      get_group_member_list: fail(),
    }), tuning(), '999')

    const outcome = await port.snapshot(GROUP)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.recent.ok).toBe(true)
    expect(outcome.members.ok).toBe(false)
    if (outcome.members.ok) throw new Error('成员接口应返回失败')
    expect(outcome.members.code).toBe('channel.unsupported')
    expect(outcome.available).toBe(true)
  })

  it('快照结果里没有本机绝对路径', async () => {
    const channel = fakeChannel({
      get_group_msg_history: ok({ messages: [
        { message_id: 1, user_id: 678, sender: { user_id: 678, nickname: '甲' }, time: 1_700_000_000, message: '看 C:\\Users\\someone\\a.txt' },
      ] }),
      get_group_member_list: ok({ members: [{ user_id: 678, card: 'C:\\Users\\n', role: 'member' }] }),
    })
    const port = createGroupInfo(channel, tuning(), '999')

    const outcome = await port.snapshot(GROUP)

    const json = JSON.stringify(outcome)
    expect(json).not.toMatch(/[A-Za-z]:[\\/]/)
    expect(json).toContain('[已略去]')
  })

  it('成员集合缓存命中不再打接口', async () => {
    const calls: string[] = []
    const port = createGroupInfo(snapshotChannel(), tuning(), '999')
    const channelWithCalls = fakeChannel({
      get_group_msg_history: ok({ messages: MESSAGES }),
      get_group_member_list: ok({ members: [] }),
    }, calls)
    const port2 = createGroupInfo(channelWithCalls, tuning(), '999')

    await port.snapshot(GROUP)
    await port2.members(GROUP, 20)
    await port2.members(GROUP, 20)

    expect(calls.filter(call => call === 'get_group_member_list')).toHaveLength(1)
  })

  it('引用解析缓存命中不再打接口', async () => {
    const calls: string[] = []
    const port = createGroupInfo(fakeChannel({ get_msg: ok({ message_id: 101, user_id: 678, sender: { nickname: '甲' }, message: '第一句' }) }, calls), tuning(), '999')

    await port.message('101')
    await port.message('101')

    expect(calls.filter(call => call === 'get_msg')).toHaveLength(1)
  })

  it('缓存容量超了按最近最少用清，不会无限长', async () => {
    let clock = 1_000
    const calls: string[] = []
    const channel = fakeChannel({ get_group_info: ok({ group_name: '小鱼塘', member_count: 1 }) }, calls)
    const port = createGroupInfo(channel, tuning({ cacheMax: 2, groupTtlMs: 100_000 }, () => clock), '999')

    await port.info('group:1')
    await port.info('group:2')
    await port.info('group:3')
    clock = 2_000
    await port.info('group:1')

    expect(calls.filter(call => call === 'get_group_info')).toHaveLength(4)
  })
})

describe('任何结果都不带本机绝对路径', () => {
  it('safeText 抹掉盘符路径、绝对开头与 file 地址', () => {
    const dirty = 'C:\\Users\\a\\x.txt 和 /home/a/x.txt 与 file:///C:/a.txt'
    const clean = safeText(dirty, 500).text
    expect(clean).not.toMatch(/[A-Za-z]:[\\/]/)
    expect(clean).not.toContain('/home/')
    expect(clean).not.toContain('file://')
    expect(clean).toContain('[已略去]')
  })

  it('safeText 超长标 truncated', () => {
    expect(safeText('很长'.repeat(100), 8)).toEqual({ text: '很长很长很长很长', truncated: true })
  })
})
