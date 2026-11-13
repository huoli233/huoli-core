// 群资料、群文件、群公告与一次拿全的快照：只报真读到的，读不到就明说这一轮不可用

import type { AskReply, WsChannel } from './ws.ts'
import {
  groupIdOf,
  readHistory,
  readMembers,
  readMessage,
  safeText,
  type MembersOutcome,
  type MessageOutcome,
} from './read.ts'

export { safeText } from './read.ts'

/** 群上下文的参数，装配时由配置摊出来 */
export interface GroupInfoTuning {
  /** 群资料留多久，毫秒 */
  groupTtlMs: number
  /** 成员名片留多久，毫秒 */
  cardTtlMs: number
  /** 成员集合留多久，毫秒 */
  membersTtlMs: number
  /** 引用解析留多久，毫秒 */
  refTtlMs: number
  /** 失败只留多久，毫秒 */
  failureTtlMs: number
  /** 缓存最多几条，超了按最近最少用清 */
  cacheMax: number
  /** 一段自由文字最多几个字 */
  textMaxChars: number
  /** 一次最多列几个文件 */
  filesMax: number
  /** 一次最多翻几个文件夹 */
  maxFolders: number
  /** 成员集合最多缓存几个 */
  membersMax: number
  /** 一次最多列几条公告 */
  noticeMax: number
  /** 快照一次读几条最近消息 */
  maxHistory: number
  /** 快照里还没接的话最多几条 */
  maxUnread: number
  /** 快照里最近消息最多几条 */
  maxRecent: number
  /** 快照里成员最多几条 */
  maxMembers: number
  /** 快照里活跃者最多几条 */
  maxActive: number
  /** 活跃者往回数几条非自己消息 */
  activeWindow: number
  /** 活跃者取前几名 */
  activeTop: number
  /** 快照整段最多几个字 */
  maxChars: number
  /** 取当前时刻，测试可换 */
  now?: () => number
}

/** 群上下文的默认值表，每一项都能被配置覆盖 */
export const GROUP_INFO_DEFAULTS: GroupInfoTuning = {
  groupTtlMs: 600_000,
  cardTtlMs: 300_000,
  membersTtlMs: 60_000,
  refTtlMs: 600_000,
  failureTtlMs: 5_000,
  cacheMax: 512,
  textMaxChars: 120,
  filesMax: 30,
  maxFolders: 4,
  membersMax: 200,
  noticeMax: 10,
  maxHistory: 30,
  maxUnread: 10,
  maxRecent: 10,
  maxMembers: 20,
  maxActive: 5,
  activeWindow: 30,
  activeTop: 5,
  maxChars: 4_000,
}

/** 读失败时给的东西，明确这一轮拿不到 */
export type GroupFailure = {
  ok: false
  code: string
  reason: string
  hint: string
  unavailable: true
  action?: string
}

/** 群名与人数 */
export type GroupInfoLine = {
  groupId: string
  name: string
  memberCount: number
  maxMemberCount: number
}

/** 一个人在群里的资料 */
export type GroupMemberLine = {
  userId: string
  name: string
  role: string
  joinedAt: number
  lastSentAt: number
}

/** 群资料或单人资料的结果 */
export type GroupInfoOutcome =
  | { ok: true; kind: 'group'; group: GroupInfoLine }
  | { ok: true; kind: 'member'; member: GroupMemberLine }
  | GroupFailure

/** 群里的一个文件，只给元数据 */
export type GroupFileLine = {
  fileId: string
  name: string
  size: number
  uploaderId: string
  at: number
}

/** 群文件清单的结果 */
export type GroupFilesOutcome =
  | { ok: true; items: GroupFileLine[]; truncated: boolean; partial: boolean; failures: GroupFailure[] }
  | GroupFailure

/** 一条群公告 */
export type GroupNoticeLine = {
  noticeId: string
  senderId: string
  at: number
  text: string
  truncated: boolean
}

/** 群公告的结果 */
export type GroupNoticeOutcome =
  | { ok: true; items: GroupNoticeLine[]; truncated: boolean }
  | GroupFailure

/** 指回单条工具的回查办法 */
export type SnapshotRef = {
  tool: string
  by: string
}

/** 快照里的一条，正文按字数截断 */
export type SnapshotItem = {
  id: string
  name: string
  at: number
  text: string
  truncated: boolean
  key: string
}

/** 快照里的一段，没读到的那一段也带码 */
export type SnapshotSection =
  | { ok: true; items: SnapshotItem[]; truncated: boolean; refs: SnapshotRef[] }
  | { ok: false; code: string; reason: string; hint: string; items: SnapshotItem[]; truncated: boolean; refs: SnapshotRef[] }

/** 一次拿全的快照 */
export type GroupSnapshotOutcome =
  | {
    ok: true
    available: boolean
    truncated: boolean
    unread: SnapshotSection
    recent: SnapshotSection
    members: SnapshotSection
    active: SnapshotSection
    refs: SnapshotRef[]
  }
  | GroupFailure

/** 装配层给工具的那几个入口 */
export interface GroupInfoPort {
  info(chatKey: string, userId?: string): Promise<GroupInfoOutcome>
  files(chatKey: string, limit: number): Promise<GroupFilesOutcome>
  notice(chatKey: string, limit: number): Promise<GroupNoticeOutcome>
  snapshot(chatKey: string): Promise<GroupSnapshotOutcome>
  members(chatKey: string, limit: number): Promise<MembersOutcome>
  message(messageId: string): Promise<MessageOutcome>
}

/** 缓存里的一格 */
interface CacheEntry {
  value: unknown
  expiresAt: number
}

/** 一台装配实例一份缓存，超容量按最近最少用清 */
function createCache(capacity: number, now: () => number): {
  get: (key: string) => unknown
  set: (key: string, value: unknown, ttlMs: number) => void
} {
  const entries = new Map<string, CacheEntry>()
  const limit = Math.max(1, Math.floor(capacity))
  return {
    get(key) {
      const hit = entries.get(key)
      if (hit === undefined) return undefined
      if (hit.expiresAt <= now()) {
        entries.delete(key)
        return undefined
      }
      entries.delete(key)
      entries.set(key, hit)
      return hit.value
    },
    set(key, value, ttlMs) {
      if (entries.has(key)) entries.delete(key)
      entries.set(key, { value, expiresAt: now() + Math.max(0, ttlMs) })
      while (entries.size > limit) {
        const oldest = entries.keys().next()
        if (oldest.done === true) break
        entries.delete(oldest.value)
      }
    },
  }
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asId(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function asCount(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function asAt(value: unknown): number {
  const seconds = asCount(value)
  return seconds > 0 ? seconds * 1000 : 0
}

function textField(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string') return value
    const nested = recordOf(value)
    if (nested === undefined) continue
    for (const inner of ['text', 'content', 'name']) {
      if (typeof nested[inner] === 'string') return nested[inner]
    }
  }
  return ''
}

function bounded(value: number, fallback: number, max: number): number {
  const n = Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.max(1, Math.min(Math.max(1, Math.floor(max)), n))
}

// 网关没实现这个 action 时如实报，不编一份空清单
function unsupported(action: string, subject: string, reply: Extract<AskReply, { ok: false }>): GroupFailure {
  return {
    ok: false,
    code: 'channel.unsupported',
    reason: `${subject}这一轮不可用`,
    hint: `这一轮不可用，别把没读到的说成有（${action} 返回 ${reply.code}）`,
    unavailable: true,
    action,
  }
}

function privateFailure(subject: string): GroupFailure {
  return {
    ok: false,
    code: 'channel.read_private',
    reason: `${subject}只认群`,
    hint: '换一个群会话再问',
    unavailable: true,
  }
}

function badIdFailure(): GroupFailure {
  return {
    ok: false,
    code: 'channel.read_bad_id',
    reason: '这个编号不对',
    hint: '从成员列表里拿编号，别自己编一个',
    unavailable: true,
  }
}

function fileLineOf(raw: unknown, maxChars: number): GroupFileLine {
  const row = recordOf(raw) ?? {}
  const uploader = recordOf(row.uploader)
  return {
    fileId: asId(row.file_id ?? row.id),
    name: safeText(row.file_name ?? row.name ?? row.filename, maxChars).text,
    size: asCount(row.size ?? row.file_size),
    uploaderId: asId(row.uploader_id ?? row.uploader ?? uploader?.user_id ?? row.uin),
    at: asAt(row.upload_time ?? row.uploadTime ?? row.time),
  }
}

function noticeLineOf(raw: unknown, maxChars: number): GroupNoticeLine {
  const row = recordOf(raw) ?? {}
  const text = safeText(textField(row, ['message', 'content', 'text']), maxChars)
  return {
    noticeId: asId(row.notice_id ?? row.id),
    senderId: asId(row.sender_id ?? row.sender ?? row.user_id),
    at: asAt(row.publish_time ?? row.publishTime ?? row.time),
    text: text.text,
    truncated: text.truncated,
  }
}

/** 按编号数最近这些非自己消息里谁说得多，不做内容判断 */
export function activePeople(
  lines: readonly { senderId: string; senderName: string; at: number }[],
  selfId: string,
  window: number,
  top: number,
): { userId: string; name: string; count: number; at: number }[] {
  const counted = new Map<string, { userId: string; name: string; count: number; at: number; last: number }>()
  const sample = lines.filter(line => line.senderId !== selfId && line.senderId !== '').slice(-Math.max(1, Math.floor(window)))
  sample.forEach((line, index) => {
    const hit = counted.get(line.senderId)
    if (hit === undefined) {
      counted.set(line.senderId, { userId: line.senderId, name: line.senderName, count: 1, at: line.at, last: index })
      return
    }
    hit.count += 1
    hit.last = index
    hit.at = line.at
  })
  return [...counted.values()]
    .sort((a, b) => b.count - a.count || b.last - a.last || a.userId.localeCompare(b.userId))
    .slice(0, Math.max(1, Math.floor(top)))
    .map(({ userId, name, count, at }) => ({ userId, name, count, at }))
}

/** 建一份群上下文读取器，缓存只属于这一台装配实例 */
export function createGroupInfo(channel: WsChannel, tuning: GroupInfoTuning, selfId: string): GroupInfoPort {
  const now = tuning.now ?? (() => Date.now())
  const cache = createCache(tuning.cacheMax, now)
  const cached = async <T extends { ok: boolean }>(
    kind: string,
    key: string,
    ttlMs: number,
    load: () => Promise<T>,
  ): Promise<T> => {
    const cacheKey = `${kind}:${key}`
    const hit = cache.get(cacheKey) as T | undefined
    if (hit !== undefined) return hit
    const value = await load()
    cache.set(cacheKey, value, value.ok ? ttlMs : tuning.failureTtlMs)
    return value
  }
  const textCap = Math.max(0, Math.floor(tuning.textMaxChars))

  const members = async (chatKey: string, limit: number): Promise<MembersOutcome> => {
    const groupId = groupIdOf(chatKey)
    if (groupId === undefined) return { ok: false, code: 'channel.read_private', reason: '私聊不列成员', hint: '只列群里的成员' }
    const cap = bounded(limit, tuning.membersMax, tuning.membersMax)
    const full = await cached<MembersOutcome>(
      'members',
      String(groupId),
      tuning.membersTtlMs,
      () => readMembers(channel, chatKey, tuning.membersMax, tuning.membersMax),
    )
    if (!full.ok) return full
    return { ok: true, members: full.members.slice(0, cap).map(member => ({
      ...member,
      name: safeText(member.name, textCap).text,
    })) }
  }

  const message = (messageId: string): Promise<MessageOutcome> =>
    cached<MessageOutcome>('ref', messageId, tuning.refTtlMs, () => readMessage(channel, messageId))

  const info = (chatKey: string, userId?: string): Promise<GroupInfoOutcome> => {
    const groupId = groupIdOf(chatKey)
    if (groupId === undefined) return Promise.resolve(privateFailure('群资料'))
    if (userId !== undefined && userId !== '') {
      const id = Number(userId)
      if (!Number.isSafeInteger(id) || id <= 0) return Promise.resolve(badIdFailure())
      return cached<GroupInfoOutcome>('card', `${groupId}:${id}`, tuning.cardTtlMs, async () => {
        const reply = await channel.ask('get_group_member_info', { group_id: groupId, user_id: id, no_cache: false })
        if (!reply.ok) return unsupported('get_group_member_info', '这个人的资料', reply)
        const row = recordOf(reply.data) ?? {}
        const name = safeText(row.card ?? row.nickname ?? textField(row, ['member']), textCap).text
        return {
          ok: true,
          kind: 'member',
          member: {
            userId: asId(row.user_id ?? id),
            name,
            role: safeText(row.role, textCap).text,
            joinedAt: asAt(row.join_time),
            lastSentAt: asAt(row.last_sent_time),
          },
        }
      })
    }
    return cached<GroupInfoOutcome>('group', String(groupId), tuning.groupTtlMs, async () => {
      const reply = await channel.ask('get_group_info', { group_id: groupId, no_cache: false })
      if (!reply.ok) return unsupported('get_group_info', '群资料', reply)
      const row = recordOf(reply.data) ?? {}
      return {
        ok: true,
        kind: 'group',
        group: {
          groupId: asId(row.group_id ?? groupId),
          name: safeText(row.group_name ?? row.groupName ?? row.name, textCap).text,
          memberCount: asCount(row.member_count ?? row.memberCount),
          maxMemberCount: asCount(row.max_member_count ?? row.maxMemberCount),
        },
      }
    })
  }

  const files = async (chatKey: string, limit: number): Promise<GroupFilesOutcome> => {
    const groupId = groupIdOf(chatKey)
    if (groupId === undefined) return privateFailure('群文件清单')
    const cap = bounded(limit, tuning.filesMax, tuning.filesMax)
    const reply = await channel.ask('get_group_root_files', { group_id: groupId })
    if (!reply.ok) return unsupported('get_group_root_files', '群文件清单', reply)
    const root = recordOf(reply.data) ?? {}
    const all: GroupFileLine[] = arrayOf(root.files).map(raw => fileLineOf(raw, textCap))
    const failures: GroupFailure[] = []
    const folders = arrayOf(root.folders)
    let partial = folders.length > tuning.maxFolders
    for (const raw of folders.slice(0, Math.max(0, Math.floor(tuning.maxFolders)))) {
      const folderId = asId(recordOf(raw)?.folder_id ?? recordOf(raw)?.id)
      if (folderId === '') continue
      const sub = await channel.ask('get_group_files_by_folder', { group_id: groupId, folder_id: folderId })
      if (!sub.ok) {
        failures.push(unsupported('get_group_files_by_folder', '这个文件夹里的文件', sub))
        partial = true
        continue
      }
      for (const item of arrayOf(recordOf(sub.data)?.files)) all.push(fileLineOf(item, textCap))
    }
    const shown = all.slice(0, cap)
    return { ok: true, items: shown, truncated: all.length > shown.length, partial, failures }
  }

  const notice = async (chatKey: string, limit: number): Promise<GroupNoticeOutcome> => {
    const groupId = groupIdOf(chatKey)
    if (groupId === undefined) return privateFailure('群公告')
    const cap = bounded(limit, tuning.noticeMax, tuning.noticeMax)
    const reply = await channel.ask('_get_group_notice', { group_id: groupId })
    if (!reply.ok) return unsupported('_get_group_notice', '群公告', reply)
    const raw = reply.data
    const list = arrayOf(raw.notices ?? raw.data ?? raw.list)
    const items = list.slice(0, cap).map(item => noticeLineOf(item, textCap))
    return { ok: true, items, truncated: list.length > cap }
  }

  const snapshot = async (chatKey: string): Promise<GroupSnapshotOutcome> => {
    const groupId = groupIdOf(chatKey)
    if (groupId === undefined) return privateFailure('群快照')
    const history = await readHistory(channel, chatKey, tuning.maxHistory, Math.max(1, Math.floor(tuning.maxHistory)))
    const memberOutcome = await members(chatKey, tuning.membersMax)
    const lines = history.ok ? history.items : []
    const budget = { left: Math.max(1, Math.floor(tuning.maxChars)) }
    const messageRefs: SnapshotRef[] = [{ tool: 'qq_read_history', by: 'count' }, { tool: 'qq_read_message', by: 'message_id' }]
    const peopleRefs: SnapshotRef[] = [{ tool: 'qq_read_members', by: 'limit' }, { tool: 'qq_group_info', by: 'user_id' }]
    const activeRefs: SnapshotRef[] = [{ tool: 'qq_read_history', by: 'count' }, { tool: 'qq_group_info', by: 'user_id' }]
    const refs: SnapshotRef[] = [...messageRefs, ...peopleRefs, { tool: 'qq_group_files', by: 'limit' }, { tool: 'qq_group_notice', by: 'limit' }]

    const fit = (full: readonly SnapshotItem[], max: number, sectionRefs: SnapshotRef[]): SnapshotSection => {
      const cap = Math.max(0, Math.floor(max))
      const items: SnapshotItem[] = []
      let truncated = full.length > cap
      for (const item of cap === 0 ? [] : full.slice(-cap)) {
        if (budget.left <= 0) {
          truncated = true
          break
        }
        if (budget.left < item.text.length) {
          items.push({ ...item, text: item.text.slice(0, budget.left), truncated: true })
          budget.left = 0
          truncated = true
          break
        }
        budget.left -= item.text.length
        truncated = truncated || item.truncated
        items.push(item)
      }
      return { ok: true, items, truncated, refs: sectionRefs }
    }
    const lineItem = (line: { messageId: string; senderId: string; senderName: string; at: number; text: string }): SnapshotItem => {
      const text = safeText(line.text, Math.max(0, Math.floor(tuning.textMaxChars)))
      const name = safeText(line.senderName, textCap).text
      return { id: line.messageId, name, at: line.at, text: text.text, truncated: text.truncated, key: 'message_id' }
    }
    const memberItem = (member: { userId: string; name: string; role: string }): SnapshotItem => {
      const text = safeText(member.role, textCap)
      const name = safeText(member.name, textCap).text
      return { id: member.userId, name, at: 0, text: text.text, truncated: text.truncated, key: 'user_id' }
    }
    const unavailable = (subject: string, sectionRefs: SnapshotRef[]): SnapshotSection => ({
      ok: false,
      code: 'channel.unsupported',
      reason: `${subject}这一轮不可用`,
      hint: '这一轮不可用，别把没读到的说成有',
      items: [],
      truncated: false,
      refs: sectionRefs,
    })

    const lastSelf = lines.findLastIndex(line => line.senderId === selfId)
    const unreadLines = lines.slice(lastSelf + 1)
    const people = activePeople(lines, selfId, tuning.activeWindow, tuning.activeTop)
    const unreadMax = Math.max(0, Math.floor(tuning.maxUnread))
    const recentMax = Math.max(0, Math.floor(tuning.maxRecent))
    const membersMax = Math.max(0, Math.floor(tuning.maxMembers))
    const activeMax = Math.max(0, Math.floor(tuning.maxActive))
    const unread = history.ok
      ? fit(unreadLines.map(lineItem), unreadMax, messageRefs)
      : unavailable('群记录', messageRefs)
    const recent = history.ok
      ? fit(lines.map(lineItem), recentMax, messageRefs)
      : unavailable('群记录', messageRefs)
    const memberSection = memberOutcome.ok
      ? fit(memberOutcome.members.map(memberItem), membersMax, peopleRefs)
      : unavailable('群成员', peopleRefs)
    const active = history.ok
      ? fit(people.map((person) => {
        const name = safeText(person.name, textCap).text
        return { id: person.userId, name, at: person.at, text: `最近说了 ${person.count} 条`, truncated: false, key: 'user_id' }
      }), activeMax, activeRefs)
      : unavailable('群记录', activeRefs)

    const available = [unread, recent, memberSection, active].some(section => section.ok)
    if (!available) {
      return {
        ok: false,
        code: 'channel.unsupported',
        reason: '群快照这一轮不可用',
        hint: '这一轮不可用，别把没读到的说成有',
        unavailable: true,
        action: 'get_group_msg_history',
      }
    }
    return {
      ok: true,
      available,
      truncated: [unread, recent, memberSection, active].some(section => section.truncated),
      unread,
      recent,
      members: memberSection,
      active,
      refs,
    }
  }

  return { info, files, notice, snapshot, members, message }
}
