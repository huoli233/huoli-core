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

/** 采集这一层的默认值：看多少条、话题句多长、热度怎么算、几条动机门槛 */
export const COLLECT_DEFAULTS = {
  /** 一眼看多少条 */
  lookback: 30,
  /** 一句够格当话题的最少字数 */
  topicMinChars: 4,
  /** 话题句最多截多少字 */
  topicMaxChars: 60,
  /** 名字至少几个字才算认得出 */
  nameMinChars: 2,
  /** 被直接点到时的把握 */
  atMeConfidence: 1,
  /** 从话里推出在跟谁说的把握 */
  inferredConfidence: 0.6,
  /** 只靠最近一条推的把握 */
  weakConfidence: 0.2,
  /** 算热度时回头看多少毫秒 */
  heatWindowMs: 10 * 60_000,
  /** 算热度时按多少分钟摊 */
  heatMinutes: 10,
  /** 热度里每分钟几条就算满，这个除数 */
  heatPerMinute: 2,
  /** 无聊、好奇、社交饿过这条线才进动机表 */
  motiveFrom: 0.5,
  /** 想分享这条动机的权重 */
  wannaShareWeight: 0.4,
}

// 一眼看多少条
const LOOKBACK = COLLECT_DEFAULTS.lookback

// 去掉零宽字符并把全角并成半角
function normalize(text: string): string {
  return text.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '').normalize('NFKC').toLowerCase()
}

// 从一串消息里挑出最近的话题句
function pickTopic(messages: CollectInput['messages']): string {
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const item = messages[at]
    if (item === undefined || item.self === true) continue
    const text = item.text.trim()
    if (text.length >= COLLECT_DEFAULTS.topicMinChars) return text.slice(0, COLLECT_DEFAULTS.topicMaxChars)
  }
  return ''
}

// 最近有没有人在等回答，中文问句不一定带问号
function pickQuestion(messages: CollectInput['messages']): string {
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const item = messages[at]
    if (item === undefined || item.self === true) continue
    const text = item.text.trim()
    if (/[?？]/.test(text) || /(吗|呢|吧|么|嘛)$/.test(text.replace(/[。！!…~～\s]+$/, ''))) return text.slice(0, COLLECT_DEFAULTS.topicMaxChars)
  }
  return ''
}

// 谁最后被叫到
function pickAddressee(messages: CollectInput['messages'], selfNames: string[]): Addressee {
  const names = selfNames.map(normalize).filter(name => name.length >= COLLECT_DEFAULTS.nameMinChars)
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const item = messages[at]
    if (item === undefined || item.self === true) continue
    const body = normalize(item.text)
    const named = names.some(name => body.includes(name))
    if (item.atMe === true || named) {
      return {
        userId: item.senderId,
        name: item.senderName ?? item.senderId,
        confidence: item.atMe === true ? COLLECT_DEFAULTS.atMeConfidence : COLLECT_DEFAULTS.inferredConfidence,
        evidence: item.atMe === true ? ['直接点了机器人'] : ['文本里出现名字'],
      }
    }
  }
  const last = [...messages].reverse().find(item => item.self !== true)
  if (last === undefined) return { userId: '', name: '', confidence: 0, evidence: [] }
  return {
    userId: last.senderId,
    name: last.senderName ?? last.senderId,
    confidence: COLLECT_DEFAULTS.weakConfidence,
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
  const humans = messages.filter(item => item.self !== true)
  const recent = humans.filter(item => now - item.at <= COLLECT_DEFAULTS.heatWindowMs)
  const lastHuman = humans[humans.length - 1]
  const lastSelf = [...messages].reverse().find(item => item.self === true)

  const minutes = Math.max(1, COLLECT_DEFAULTS.heatMinutes)
  const heat = Math.min(1, recent.length / minutes / COLLECT_DEFAULTS.heatPerMinute)

  const situation: Situation = {
    who: lastHuman !== undefined ? lastHuman.senderName ?? lastHuman.senderId : '',
    topic: pickTopic(messages),
    heat,
    lastTurnGapMs: lastSelf !== undefined ? Math.max(0, now - lastSelf.at) : Number.POSITIVE_INFINITY,
  }

  const motives: Motive[] = []
  const bored = input.boredom ?? 0
  const curious = input.curiosity ?? 0
  const lonely = input.socialHunger ?? 0
  if (bored > COLLECT_DEFAULTS.motiveFrom) motives.push({ need: 'bored', weight: bored })
  if (curious > COLLECT_DEFAULTS.motiveFrom) motives.push({ need: 'curious', weight: curious })
  if (lonely > COLLECT_DEFAULTS.motiveFrom) motives.push({ need: 'lonely', weight: lonely })
  if (situation.topic !== '') motives.push({ need: 'wanna_share', weight: COLLECT_DEFAULTS.wannaShareWeight })

  return {
    situation,
    addressee: pickAddressee(messages, input.selfNames ?? []),
    thoughts: [],
    topic: { active: situation.topic, pendingQuestion: pickQuestion(messages) },
    motives,
  }
}

/** 一整份素材事实的入参，装配层可只按这份调用 */
export type MaterialFactsInput = Omit<CollectInput, 'now'> & { now: number; thoughts?: readonly Thought[] }

/**
 * 整理一份素材事实，装配层不需要先建运行件
 * @param input - 现场消息、时刻与惦记的事
 * @returns 只含事实的一份素材
 */
export function collectMaterialFacts(input: MaterialFactsInput): Material {
  const material = collectMaterial({ ...input, now: input.now })
  return { ...material, thoughts: [...(input.thoughts ?? [])] }
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
    lines.push(`心里惦记着：${material.thoughts.map(item => item.text).join('；')}`)
  }
  return lines.length === 0 ? '群里没什么可接的话。' : lines.join('\n')
}

/**
 * 把现场素材写成一段中文事实，装配层可直接拼进提示词
 * @param input - 现场消息、时刻与惦记的事
 * @returns 一段中文事实
 */
export function renderMaterialFacts(input: MaterialFactsInput): string {
  return renderMaterial(collectMaterialFacts(input))
}
