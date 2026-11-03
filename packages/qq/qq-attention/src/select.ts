// 注意力事实：只回答"现场发生了什么"，不回答"该不该说"

// 参与信号的消息
export interface SignalMessage {
  seq: number
  senderId: string
  senderName?: string
  text: string
  at: number
  self?: boolean
  atMe?: boolean
  isPoke?: boolean
  replyToBot?: boolean
}

// 一条候选动作，只是建议
export interface Candidate {
  kind: 'reply' | 'join' | 'observe' | 'wait' | 'close'
  why: string
  weight: number
}

// 一个会话的事实集合
export interface AttentionSignals {
  directed: { at: boolean; poke: boolean; isPrivate: boolean; replyToBot: boolean }
  ambient: { humanCount: number; lastHumanAgeMs: number | null; speakingRate: number }
  addressee: { named: boolean; confidence: number; evidence: readonly string[] }
  novelty: { newTopic: boolean; repeated: boolean }
  fun: { score: number; evidence: readonly string[] }
  fatigue: { level: number; reason: string }
  candidates: readonly Candidate[]
}

// 采集一次的入参
export interface CollectInput {
  chatKey: string
  messages: readonly SignalMessage[]
  selfNames?: readonly string[]
  now?: number
  fatigueLevel?: number
  fatigueReason?: string
  activeWindowMs?: number
}

// 默认活跃窗口
const DEFAULT_ACTIVE_WINDOW_MS = 10 * 60_000

// 去掉零宽字符并折叠全角，名字才比得准
function normalize(text: string): string {
  return text.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '').normalize('NFKC').toLowerCase()
}

// 是不是真人发的
function isHuman(message: SignalMessage): boolean {
  return message.self !== true
}

// 采集一个会话的注意力事实
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
    evidence.push(`文本里出现名字：${name}`)
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
    candidates.push({ kind: 'reply', why: '文本里出现名字，可能在叫它', weight: 0.55 })
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
