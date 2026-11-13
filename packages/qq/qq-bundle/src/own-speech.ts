// 自己说过的话：把发过的原话、撤回改口、没接住与被驳回都只当事实摆回来，认不认、改不改、放不放下全由模型自己定

import fs from 'node:fs'
import path from 'node:path'
import type { QqMessage } from '@huoli/huoli-qq-attention'

/** 一条自己说过的话，或者是跟这句话有关的一件事实 */
export interface OwnLine {
  /** 什么时候 */
  at: number
  /** 哪个会话 */
  chatKey: string
  /** 原话，撤回或空正文时为空串 */
  text: string
  /** 这一笔是什么 */
  kind: 'said' | 'recalled' | 'corrected' | 'blocked' | 'ignored'
  /** 追踪编号，跟时间线对得上 */
  traceId?: string
}

/** 一段摆给模型看的自己说过的话 */
export interface OwnSpeechFacts {
  /** 最近自己说过的话，按时间正序 */
  recent: readonly OwnLine[]
  /** 重复出现的原话，只列确实说过两遍以上的 */
  repeated: readonly { text: string; times: number; lastAt: number }[]
  /** 自己说过之后没人接的原话 */
  unanswered: readonly { text: string; at: number; since: number }[]
  /** 撤回或改口过的原话 */
  revisions: readonly { text: string; at: number; kind: 'recalled' | 'corrected' }[]
  /** 发出去被挡下的原话 */
  blocked: readonly { text: string; at: number }[]
}

/** 事实段的收口，别把提示词撑大 */
export const OWN_SPEECH_LIMITS = {
  /** 最近留几条原话 */
  recentMax: 8,
  /** 整段最多多少字 */
  maxChars: 900,
  /** 重复句最多列几条 */
  repeatedMax: 3,
  /** 没人接的最多列几条 */
  unansweredMax: 3,
  /** 改口最多列几条 */
  revisionsMax: 2,
  /** 被挡下最多列几条 */
  blockedMax: 2,
  /** 多久之内算「最近」，默认一天 */
  windowMs: 24 * 3_600_000,
} as const

/** 空事实，读不到或没有时返回它 */
export const EMPTY_OWN_SPEECH: OwnSpeechFacts = { recent: [], repeated: [], unanswered: [], revisions: [], blocked: [] }

/** 把一行 jsonl 认成一条记录，认不出就跳过 */
function rowOf(line: string): OwnLine | undefined {
  if (line.trim() === '') return undefined
  try {
    const raw: unknown = JSON.parse(line)
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
    const row = raw as Record<string, unknown>
    const at = typeof row.at === 'number' && Number.isFinite(row.at) ? row.at : Number.NaN
    const chatKey = typeof row.chatKey === 'string' ? row.chatKey : ''
    const kind = row.kind
    if (!Number.isFinite(at) || chatKey === '' || !['said', 'recalled', 'corrected', 'blocked', 'ignored'].includes(String(kind))) return undefined
    const text = typeof row.text === 'string' ? row.text.replace(/\s+/gu, ' ').trim() : ''
    const traceId = typeof row.traceId === 'string' && row.traceId !== '' ? row.traceId : undefined
    return { at, chatKey, text, kind: kind as OwnLine['kind'], ...traceId === undefined ? {} : { traceId } }
  } catch {
    return undefined
  }
}

/** 只留能上提示词的正文：本机路径、编号、网址、内务字样都不进事实 */
export function cleanOwnText(text: string): string {
  return text
    .replace(/[A-Za-z]:[\\/][^\s]*/gu, '')
    .replace(/file:\/\/\/?\S*/giu, '')
    .replace(/\\\\\S*/gu, '')
    .replace(/https?:\/\/\S+/giu, '')
    .replace(/\[#-?\d+\]/gu, '')
    .replace(/\b(?:AGENTS\.md|skill-catalog|RELAY_\w+|token|provider|model|traceId|chatKey)\b/giu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 120)
}

/**
 * 建一份自己说过的话的日志，只追加，读不到就当没有
 * @param file - 一行一条的 json 文件
 * @param warn - 写不进去时往哪报
 * @returns 记一笔与读最近的接口
 */
export function createOwnSpeechLog(file: string, warn: (message: string) => void): {
  note(line: { chatKey: string; text: string; kind: OwnLine['kind']; traceId?: string | undefined; at?: number | undefined }): void
  read(chatKey: string, now: number, limits?: typeof OWN_SPEECH_LIMITS): OwnSpeechFacts
} {
  const maxLines = 400
  let rows: OwnLine[] = []
  try {
    rows = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').split('\n').flatMap((line) => {
      const row = rowOf(line)
      return row === undefined ? [] : [row]
    }).slice(-maxLines)
  } catch {
    rows = []
  }
  return {
    note(line) {
      const at = line.at ?? Date.now()
      const entry: OwnLine = {
        at,
        chatKey: line.chatKey,
        text: cleanOwnText(line.text),
        kind: line.kind,
        ...line.traceId === undefined ? {} : { traceId: line.traceId },
      }
      rows = [...rows, entry].slice(-maxLines)
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
      } catch (error) {
        warn(`自己说过的话没写进去：${String(error)}`)
      }
    },
    read(chatKey, now, limits = OWN_SPEECH_LIMITS) {
      const picked = rows.filter(row => row.chatKey === chatKey && row.at > now - limits.windowMs && row.at <= now)
      if (picked.length === 0) return EMPTY_OWN_SPEECH
      const said = picked.filter(row => row.kind === 'said' && row.text !== '')
      // 重复只按原话算，同一轮里连发几条算多次
      const counts = new Map<string, { times: number; lastAt: number }>()
      for (const line of said) {
        const hit = counts.get(line.text)
        counts.set(line.text, { times: (hit?.times ?? 0) + 1, lastAt: Math.max(hit?.lastAt ?? 0, line.at) })
      }
      const repeated = [...counts.entries()]
        .filter(([, value]) => value.times >= 2)
        .sort((a, b) => b[1].lastAt - a[1].lastAt)
        .slice(0, limits.repeatedMax)
        .map(([text, value]) => ({ text, ...value }))
      // 自己说完之后，到窗口末尾都没有别人接：拿收件箱里的入站消息时间做判据
      const ignored = picked.filter(row => row.kind === 'ignored')
      const unanswered = ignored
        .concat(said.filter(line => !picked.some(row => row.kind === 'ignored' && row.traceId !== undefined && row.traceId === line.traceId)))
        .map(line => ({ text: line.text, at: line.at, since: now - line.at }))
        .filter(item => item.text !== '')
        .slice(-limits.unansweredMax)
      const revisions = picked
        .filter(row => (row.kind === 'recalled' || row.kind === 'corrected') && row.text !== '')
        .map(row => ({ text: row.text, at: row.at, kind: row.kind as 'recalled' | 'corrected' }))
        .slice(-limits.revisionsMax)
      const blocked = picked
        .filter(row => row.kind === 'blocked' && row.text !== '')
        .map(row => ({ text: row.text, at: row.at }))
        .slice(-limits.blockedMax)
      return {
        recent: said.slice(-limits.recentMax),
        repeated,
        unanswered,
        revisions,
        blocked,
      }
    },
  }
}

/** 分钟前，给模型看时间用，不写具体钟点 */
function agoOf(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  if (minutes === 0) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  return `${Math.round(minutes / 60)} 小时前`
}

/**
 * 把「自己说过的话」写成一段事实：只给次数、时间与「别再照抄」的提醒，绝不再把整句原话摆回去。
 * 整句回灌会让模型照着复读（线上实测同一句被反复发了三遍），所以原话只留在本地日志里，不进提示词。
 * @param facts - 读出来的事实
 * @param now - 现在
 * @param limits - 收口
 * @returns 提示词那一段，没有可摆的事实就是空串
 */
export function renderOwnSpeech(facts: OwnSpeechFacts, now: number, limits: typeof OWN_SPEECH_LIMITS = OWN_SPEECH_LIMITS): string {
  const lines: string[] = ['[DATA] QQ_OWN_SPEECH', '来源：这个会话里你实际发过的话、撤回改口、没接住与被挡下的本地记录；下面只有次数与事实，没有原话']
  if (facts.recent.length > 0) {
    lines.push(`最近你发过 ${facts.recent.length} 条，最近一条在 ${agoOf(facts.recent[facts.recent.length - 1]?.at ?? now, now)}`)
  }
  if (facts.repeated.length > 0) {
    lines.push(`其中有 ${facts.repeated.length} 句你说过不止一次（最多 ${Math.max(...facts.repeated.map(item => item.times))} 次）`)
  }
  if (facts.unanswered.length > 0) lines.push(`有 ${facts.unanswered.length} 句说完没有人接`)
  if (facts.revisions.length > 0) lines.push(`撤回或改口过 ${facts.revisions.length} 次`)
  if (facts.blocked.length > 0) lines.push(`有 ${facts.blocked.length} 句想发但没发出去`)
  if (lines.length === 2) return ''
  lines.push('RULE: these_are_counts_only; your_past_wording_is_never_shown_here_so_do_not_copy_or_repeat_it; you_decide_whether_you_were_wrong_whether_to_fix_it_and_whether_to_let_it_go; no_one_tells_you_to_apologize_repeat_or_drop_it; do_not_read_this_section_aloud')
  const text = lines.join('\n')
  return text.length > limits.maxChars ? `${text.slice(0, limits.maxChars)}\n…（后面的省略）` : text
}

/**
 * 从收件箱里认「自己说完之后没人接」，只摆事实，不判该不该补一句
 * @param recent - 这个会话最近的消息，含自己发的
 * @param selfId - 自己的号
 * @param now - 现在
 * @returns 没人接的那几句，按时间正序
 */
export function unansweredOf(recent: readonly QqMessage[], selfId: string, now: number): readonly { text: string; at: number }[] {
  const out: { text: string; at: number }[] = []
  const ordered = [...recent].sort((a, b) => a.at - b.at)
  for (let i = 0; i < ordered.length; i += 1) {
    const line = ordered[i]
    if (line === undefined) continue
    if (line.text.trim() === '' || line.isRecall === true) continue
    if (selfId === '' || line.senderId !== selfId) continue
    const later = ordered.slice(i + 1).some(next => next.senderId !== '' && next.senderId !== selfId && !next.isRecall)
    if (later) continue
    out.push({ text: cleanOwnText(line.text), at: line.at })
  }
  return out.filter(item => item.text !== '' && item.at > now - OWN_SPEECH_LIMITS.windowMs).slice(-OWN_SPEECH_LIMITS.repeatedMax)
}
