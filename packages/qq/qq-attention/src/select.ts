/**
 * Attention signals: plain facts about a chat. This module never answers
 * "should the bot speak" — it produces evidence and candidate actions for the
 * model to weigh.
 *
 * @module @huoli/huoli-qq-attention
 */

/** One message as the signal collector sees it. */
export interface SignalMessage {
  /** Sequence inside the chat. */
  readonly seq: number
  /** Platform sender id. */
  readonly senderId: string
  /** Display name when known. */
  readonly senderName?: string
  /** Message text. */
  readonly text: string
  /** Arrival time in milliseconds. */
  readonly at: number
  /** True when the bot itself sent it. */
  readonly self?: boolean
  /** True when the message mentions the bot. */
  readonly atMe?: boolean
  /** True when the message is a poke at the bot. */
  readonly isPoke?: boolean
  /** True when the message replies to a bot message. */
  readonly replyToBot?: boolean
}

/** One candidate action, offered as advice rather than a decision. */
export interface Candidate {
  /** Kind of participation this candidate describes. */
  readonly kind: 'reply' | 'join' | 'observe' | 'wait' | 'close'
  /** Why this candidate exists, in one clause. */
  readonly why: string
  /** Relative weight derived from the facts, not from a pass/fail threshold. */
  readonly weight: number
}

/** Facts about a chat, with no verdict attached. */
export interface AttentionSignals {
  /** Whether the bot was addressed, and how. */
  readonly directed: { readonly at: boolean; readonly poke: boolean; readonly isPrivate: boolean; readonly replyToBot: boolean }
  /** Ambient activity in the recent window. */
  readonly ambient: { readonly humanCount: number; readonly lastHumanAgeMs: number | null; readonly speakingRate: number }
  /** Whether the bot's name appeared in a calling position. */
  readonly addressee: { readonly named: boolean; readonly confidence: number; readonly evidence: readonly string[] }
  /** Whether the chat is repeating itself. */
  readonly novelty: { readonly newTopic: boolean; readonly repeated: boolean }
  /** Playfulness evidence, without a verdict. */
  readonly fun: { readonly score: number; readonly evidence: readonly string[] }
  /** Fatigue evidence supplied by the state layer, without a verdict. */
  readonly fatigue: { readonly level: number; readonly reason: string }
  /** Candidate actions the model may take. */
  readonly candidates: readonly Candidate[]
}

/** Input for one signal collection. */
export interface CollectInput {
  /** Chat being observed. */
  readonly chatKey: string
  /** Recent messages, oldest first. */
  readonly messages: readonly SignalMessage[]
  /** Bot display names and learned aliases. */
  readonly selfNames?: readonly string[]
  /** Current time in milliseconds. */
  readonly now?: number
  /** Fatigue level from the state layer, zero to one. */
  readonly fatigueLevel?: number
  /** Reason attached to the fatigue level. */
  readonly fatigueReason?: string
  /** Window used to count human activity. */
  readonly activeWindowMs?: number
}

/** Default activity window. */
const DEFAULT_ACTIVE_WINDOW_MS = 10 * 60_000

/** Strip zero-width characters and fold width so name matching is stable. */
function normalize(text: string): string {
  return text.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '').normalize('NFKC').toLowerCase()
}

/** Whether a visible human wrote this message. */
function isHuman(message: SignalMessage): boolean {
  return message.self !== true
}

/**
 * Collect attention facts for one chat.
 * @param input - chat, recent messages, names, and state supplied by the caller.
 * @returns facts and candidate actions; never a speak/silent verdict.
 */
export function collectSignals(input: CollectInput): AttentionSignals {
  const now = input.now ?? Date.now()
  const windowMs = Math.max(60_000, input.activeWindowMs ?? DEFAULT_ACTIVE_WINDOW_MS)
  const messages = input.messages
  const latest = messages[messages.length - 1]
  const humans = messages.filter(isHuman)
  const recentHumans = humans.filter(message => now - message.at <= windowMs)
  const lastHumanAt = humans.reduce((acc, message) => Math.max(acc, message.at), 0)
  const lastHumanAgeMs = lastHumanAt > 0 ? Math.max(0, now - lastHumanAt) : null

  const directed = {
    at: latest?.atMe === true,
    poke: latest?.isPoke === true,
    isPrivate: input.chatKey.startsWith('private:'),
    replyToBot: latest?.replyToBot === true,
  }

  const names = (input.selfNames ?? []).map(normalize).filter(name => name.length >= 2)
  const body = latest !== undefined ? normalize(latest.text) : ''
  const evidence: string[] = []
  let named = false
  for (const name of names) {
    if (!body.includes(name)) continue
    named = true
    evidence.push(`名字出现在文本里：${name}`)
    break
  }

  const normalizedTexts = humans.map(message => normalize(message.text).replace(/\s+/g, ''))
  const repeated = normalizedTexts.length >= 3
    && new Set(normalizedTexts.slice(-3)).size === 1
  const firstOfGroup = normalizedTexts.length >= 2
    && normalizedTexts[normalizedTexts.length - 1] !== normalizedTexts[normalizedTexts.length - 2]
  const newTopic = humans.length === 0 || firstOfGroup

  const funEvidence: string[] = []
  let funScore = 0
  if (latest !== undefined) {
    const text = latest.text
    if (/[?？]/.test(text)) { funScore += 0.35; funEvidence.push('带问号') }
    if (/[!！…～]/.test(text)) { funScore += 0.25; funEvidence.push('带情绪标点') }
    if (text.length >= 60) { funScore += 0.3; funEvidence.push('是长消息') }
    else if (text.length >= 16) { funScore += 0.15; funEvidence.push('是中长消息') }
  }

  const speakingRate = recentHumans.length === 0 ? 0 : recentHumans.length / (windowMs / 60_000)

  const candidates: Candidate[] = []
  if (directed.at || directed.poke || directed.replyToBot || directed.isPrivate) {
    candidates.push({ kind: 'reply', why: '对方直接叫了机器人', weight: 1 })
  }
  if (!directed.at && named) {
    candidates.push({ kind: 'reply', why: '名字出现在文本里，可能在叫它', weight: 0.55 })
  }
  if (recentHumans.length >= 2 && !directed.at) {
    candidates.push({ kind: 'join', why: `近 ${Math.round(windowMs / 60_000)} 分钟有 ${recentHumans.length} 条真人发言`, weight: 0.45 })
  }
  if (repeated) {
    candidates.push({ kind: 'observe', why: '最近三条内容重复，像在刷屏', weight: 0.2 })
  }
  if (lastHumanAgeMs !== null && lastHumanAgeMs >= 30 * 60_000) {
    candidates.push({ kind: 'join', why: `群里已经 ${Math.round(lastHumanAgeMs / 60_000)} 分钟没人说话`, weight: 0.3 })
  }
  if (directed.at || directed.poke) {
    candidates.push({ kind: 'close', why: '已经回应过，这段可以收尾', weight: 0.15 })
  }

  return {
    directed,
    ambient: { humanCount: recentHumans.length, lastHumanAgeMs, speakingRate },
    addressee: { named, confidence: named ? 0.5 : 0, evidence },
    novelty: { newTopic, repeated },
    fun: { score: Math.min(1, funScore), evidence: funEvidence },
    fatigue: { level: Math.min(1, Math.max(0, input.fatigueLevel ?? 0)), reason: input.fatigueReason ?? '' },
    candidates,
  }
}
