// 素材：把现场情况摊开给模型看，让它自己决定要不要接话

/** 看一眼得出的现场 */
export interface Situation {
  who: string
  topic: string
  heat: number
  lastTurnGapMs: number
}

/** 在跟谁说话 */
export interface Addressee {
  userId: string
  name: string
  confidence: number
  evidence: string[]
}

/** 心里惦记着的事 */
export interface Thought {
  id: string
  text: string
  at: number
  expiresAt: number
}

/** 当前话题 */
export interface Topic {
  active: string
  pendingQuestion: string
}

/** 想说话的由头 */
export interface Motive {
  need: 'bored' | 'curious' | 'lonely' | 'wanna_share'
  weight: number
}

/** 一整份素材 */
export interface Material {
  situation: Situation
  addressee: Addressee
  thoughts: Thought[]
  topic: Topic
  motives: Motive[]
}

/** 收集素材时看的东西 */
export interface CollectInput {
  chatKey: string
  messages: Array<{
    seq: number
    senderId: string
    senderName?: string
    text: string
    at: number
    self?: boolean
    atMe?: boolean
  }>
  selfNames?: string[]
  boredom?: number
  curiosity?: number
  socialHunger?: number
  now?: number
}

/** 念头多久算过期 */
export const THOUGHT_TTL_MS = 2 * 60 * 60_000

// 一眼看多少条
const LOOKBACK = 30

// 去掉零宽字符并折叠全角
function normalize(text: string): string {
  return text.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '').normalize('NFKC').toLowerCase()
}

// 从一串消息里挑出最近的话题句
function pickTopic(messages: CollectInput['messages']): string {
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const item = messages[at]
    if (item === undefined || item.self === true) continue
    const text = String(item.text ?? '').trim()
    if (text.length >= 4) return text.slice(0, 60)
  }
  return ''
}

// 最近有没有人在等回答，中文问句不一定带问号
function pickQuestion(messages: CollectInput['messages']): string {
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const item = messages[at]
    if (item === undefined || item.self === true) continue
    const text = String(item.text ?? '').trim()
    if (/[?？]/.test(text) || /(吗|呢|吧|么|嘛)$/.test(text.replace(/[。！!…~～\s]+$/, ''))) return text.slice(0, 60)
  }
  return ''
}

// 谁最后被叫到
function pickAddressee(messages: CollectInput['messages'], selfNames: string[]): Addressee {
  const names = selfNames.map(normalize).filter((name) => name.length >= 2)
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const item = messages[at]
    if (item === undefined || item.self === true) continue
    const body = normalize(String(item.text ?? ''))
    const named = names.some((name) => body.includes(name))
    if (item.atMe === true || named) {
      return {
        userId: String(item.senderId),
        name: String(item.senderName ?? item.senderId),
        confidence: item.atMe === true ? 1 : 0.6,
        evidence: item.atMe === true ? ['直接点了机器人'] : ['文本里出现名字'],
      }
    }
  }
  const last = [...messages].reverse().find((item) => item.self !== true)
  if (last === undefined) return { userId: '', name: '', confidence: 0, evidence: [] }
  return {
    userId: String(last.senderId),
    name: String(last.senderName ?? last.senderId),
    confidence: 0.2,
    evidence: ['最后说话的人'],
  }
}

/**
 * 整理一份素材
 * @param input - 传进来的东西
 * @returns 处理结果
 */
export function collectMaterial(input: CollectInput): Material {
  const now = input.now ?? Date.now()
  const messages = input.messages.slice(-LOOKBACK)
  const humans = messages.filter((item) => item.self !== true)
  const recent = humans.filter((item) => now - item.at <= 10 * 60_000)
  const lastHuman = humans[humans.length - 1]
  const lastSelf = [...messages].reverse().find((item) => item.self === true)

  const minutes = Math.max(1, 10)
  const heat = Math.min(1, recent.length / minutes / 2)

  const situation: Situation = {
    who: lastHuman !== undefined ? String(lastHuman.senderName ?? lastHuman.senderId) : '',
    topic: pickTopic(messages),
    heat,
    lastTurnGapMs: lastSelf !== undefined ? Math.max(0, now - lastSelf.at) : Number.POSITIVE_INFINITY,
  }

  const motives: Motive[] = []
  const bored = Number(input.boredom ?? 0)
  const curious = Number(input.curiosity ?? 0)
  const lonely = Number(input.socialHunger ?? 0)
  if (bored > 0.5) motives.push({ need: 'bored', weight: bored })
  if (curious > 0.5) motives.push({ need: 'curious', weight: curious })
  if (lonely > 0.5) motives.push({ need: 'lonely', weight: lonely })
  if (situation.topic !== '') motives.push({ need: 'wanna_share', weight: 0.4 })

  return {
    situation,
    addressee: pickAddressee(messages, input.selfNames ?? []),
    thoughts: [],
    topic: { active: situation.topic, pendingQuestion: pickQuestion(messages) },
    motives,
  }
}

/**
 * 把素材写成几行字，给模型看
 * @param material - 素材
 * @returns 拼好的话
 */
export function renderMaterial(material: Material): string {
  const lines: string[] = []
  if (material.situation.topic !== '') lines.push(`群里在聊：${material.situation.topic}`)
  if (material.situation.who !== '') lines.push(`最后说话的是：${material.situation.who}`)
  if (material.addressee.userId !== '' && material.addressee.confidence >= 0.5) {
    lines.push(`可能在叫 ${material.addressee.name}`)
  }
  if (material.topic.pendingQuestion !== '') lines.push(`有人问：${material.topic.pendingQuestion}`)
  if (material.thoughts.length > 0) {
    lines.push(`心里惦记着：${material.thoughts.map((item) => item.text).join('；')}`)
  }
  return lines.length === 0 ? '群里没什么可接的话。' : lines.join('\n')
}
