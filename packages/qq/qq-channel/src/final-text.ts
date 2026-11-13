// 最终正文只留要说给对方的话，内心旁白和状态说明不出去

/** 发送前一起交给工具的本轮想法，只给自己看 */
export interface ReplyEvidence {
  messageId: string
  text: string
}

/** 发送前一起交给工具的本轮想法，只给自己看 */
export interface ReplyAffect {
  target: 'robot' | 'other' | 'uncertain' | ''
  emotions: string[]
  valence: number | null
  relationalValence: number | null
  arousal: number
  intensity: number
  confidence: number
  playfulness: number
  hostility: number
  correction: number
  irony: boolean
  ironyUncertainty: number
  quotation: boolean
  quotationUncertainty: number
  relationalConfidence: number
  evidence: ReplyEvidence[]
  explanation: string
}

/** 发送前一起交给工具的本轮想法，只给自己看 */
export interface ReplyMind {
  move: string
  reason: string
  focus: string
  tone: string
  target: 'robot' | 'other' | 'uncertain' | ''
  reading: string
  impulse: string
  counter: string
  choice: string
  inner: string
  next: string
  goal: string
  topic: string
  confidence: number
  review: string
  reflect: string
  waitMs: number
  interrupt: string
  cancel: string
  settle: string
  affect?: ReplyAffect
}

/** 发送工具里那段想法的参数说明 */
export const REPLY_MIND_PARAMETER = {
  type: 'object',
  description: '这一轮开口前的简短想法。只用于记录和理解，不会当成正文发出去。',
  additionalProperties: false,
  properties: {
    move: {
      type: 'string',
      enum: [
        'reply', 'short_ack', 'join_chorus', 'continue_own_topic', 'cold_open',
        'observe_share', 'comfort', 'defend', 'repair', 'task', 'interject',
        'wait', 'watch', 'silent', 'rest',
      ],
      description: '这一轮为什么开口：回应、短应声、接群聊、续自己的话、冷场起头、吐槽、安慰、护短、修补、做事、插话、等待、只看或安静。',
    },
    reason: { type: 'string', description: '为什么现在开口。' },
    focus: { type: 'string', description: '最想接住对方的哪一点。' },
    tone: { type: 'string', description: '想用的情绪和关系姿态。' },
    target: {
      type: 'string',
      enum: ['robot', 'other', 'uncertain'],
      description: '这句话是冲你本人、冲别人，还是上下文分不清。',
    },
    reading: { type: 'string', description: '这句主要在表达什么，是否在反讽、转述或开玩笑。' },
    impulse: { type: 'string', description: '第一反应是什么，可以冲动或懒，只给自己看。' },
    counter: { type: 'string', description: '另一边顾虑：会不会误读、玩笑当真、太黏、说错事实或伤到关系。' },
    choice: { type: 'string', description: '最后怎么取舍，以及一句话理由。' },
    inner: { type: 'string', description: '此刻心里真正想的一句，只给自己看。' },
    next: { type: 'string', description: '说完以后，下次还想记得什么。' },
    goal: { type: 'string', description: '这一轮开口想达到什么，没有就留空。' },
    topic: { type: 'string', description: '这一轮围绕什么具体话题，没有就留空。' },
    confidence: { type: 'number', description: '对这次开口判断有多确定，范围零到一。' },
    review: { type: 'string', description: '发送前自检：像不像自己、有没有答到真问题、有没有顺着错误前提跑。' },
    reflect: { type: 'string', description: '说完以后私下想留的一句复盘，没有就留空。' },
    waitMs: { type: 'number', description: '只在决定先等等时写短等待毫秒数；其他动作给 0。到时只会重新判断现场，不会自动替你发消息。' },
    interrupt: { type: 'string', description: '只在确实要接住未完成的高优先级话头时，写清为什么打断；普通接话不填。' },
    cancel: { type: 'string', description: '收回之前打算继续等或继续追的事时写一句；没有就留空。' },
    settle: { type: 'string', description: '只在没有对外说话、私下把情绪理顺时写一句；没有就留空。' },
    affect: {
      type: 'object',
      description: '只从对方原话和上下文读情绪，不写给自己的回复；判不准就不填。',
      additionalProperties: false,
      properties: {
        target: {
          type: 'string',
          enum: ['robot', 'other', 'uncertain'],
          description: '这句话是冲你本人、冲别人，还是分不清。',
        },
        emotions: {
          type: 'array',
          description: '这句话里的情绪，用自己的话写，最多五个。',
          items: { type: 'string' },
        },
        valence: { type: 'number', description: '整体感觉，负数是难受，正数是舒服，范围负一到一。' },
        relationalValence: {
          type: 'number',
          description: '只在这句话冲你时说：他这次对你是冷、是凶，还是亲、是好，范围负一到一。',
        },
        arousal: { type: 'number', description: '情绪被激起的程度，范围零到一。' },
        intensity: { type: 'number', description: '情绪本身有多重，范围零到一。' },
        confidence: { type: 'number', description: '这次判断有多确定，范围零到一。' },
        playfulness: { type: 'number', description: '玩笑和逗弄的成分有多重，范围零到一。' },
        hostility: { type: 'number', description: '确有依据且冲你来的敌意有多重；引用、玩笑或说给别人时不填高值，范围零到一。' },
        correction: { type: 'number', description: '对方在纠正你的程度有多重，范围零到一。' },
        relationalConfidence: { type: 'number', description: '对关系态度的判断有多确定，范围零到一。' },
        irony: { type: 'boolean', description: '这句话是不是在反着说。' },
        ironyUncertainty: { type: 'number', description: '对反讽判断有多不确定，范围零到一。' },
        quotation: { type: 'boolean', description: '这句话是不是在转述别人的话。' },
        quotationUncertainty: { type: 'number', description: '对转述判断有多不确定，范围零到一。' },
        evidence: {
          type: 'array',
          description: '只有高把握且 target 为 robot 时填写：从当前说话人最近消息中逐字摘短句，最多五条；无法核对原话就留空，不要改写或编造。',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              messageId: { type: 'string', description: '原消息编号可见时填写，不可见就留空，不要编造。' },
              text: { type: 'string', description: '当前说话人原话里连续的一段，不改写、不拼接。' },
            },
          },
        },
        explanation: { type: 'string', description: '一句话写清为什么这样判读，只给自己看。' },
      },
    },
  },
} as const

/** 发送工具里那段想法的紧凑 schema；字段说明由固定的 QQ_REPLY_MIND 段落承担 */
export const COMPACT_REPLY_MIND_PARAMETER = {
  type: 'object',
  additionalProperties: true,
  description: '这一轮开口前的简短想法，只给自己看。常用键：move、reason、focus、tone、target、reading、impulse、counter、choice、inner、next、goal、topic、confidence、review、reflect、waitMs、interrupt、cancel、settle、affect。affect 常用 target、emotions、valence、relationalValence、arousal、intensity、confidence、playfulness、hostility、correction、irony、quotation、evidence、explanation；evidence 只在有把握时逐字摘当前说话人的近期原话。',
} as const

const WRAPPED_LINE = /^(?:（[^（）\n]{1,120}）|\([^()\n]{1,120}\)|\[[^\[\]\n]{1,120}\]|【[^【】\n]{1,120}】)$/u
const LEADING_WRAPPED = /^(?:（[^（）\n]{1,120}）|\([^()\n]{1,120}\)|\[[^\[\]\n]{1,120}\]|【[^【】\n]{1,120}】)\s*/u
const INTERNAL_LINE = /^(?:内心|心里想|心理|计划|行动计划|回复思路|意图|发送状态|工具调用|系统状态)\s*[:：]/u
const BODY_PREFIX = /^(?:正文|要说的话|回复)\s*[:：]\s*/u
const BARE_REPLY = /^(?:(?:哦|喔|嗯|呃|额|诶|欸|啊|哈|呵|切|啧|哼){1,4}|在)[\p{P}\p{S}\s]*$/u
const PUNCTUATION_ONLY = /^[\p{P}\p{S}\s]+$/u
const SIMPLE_PUNCTUATION_ONLY = /^[?？!！。…~～\s]+$/u
/** 半截拼音或没打完的拉丁字母输入也是一条真回复 */
const LATIN_TYPING = /^[A-Za-z][A-Za-z\s'-]{1,39}$/u

/**
 * 发送前把主人账号替换成称呼，账号仍只留在权限判断与本地账本里。
 * @param text 清理后的正文
 * @param hiddenAccount 不可外发的账号
 * @returns 可以发送的正文
 */
export function hideAccountInText(text: string, hiddenAccount: string): string {
  const account = hiddenAccount.trim()
  return account === '' ? text : text.replace(new RegExp(account.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'), '主人')
}

function clipped(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function bounded(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : undefined
}

function evidenceOf(raw: unknown): ReplyEvidence[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as Record<string, unknown>
    const text = clipped(row.text, 160)
    if (text === '') return []
    return [{ messageId: clipped(row.messageId, 80), text }]
  }).slice(0, 5)
}

function affectOf(raw: unknown): ReplyAffect | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const row = raw as Record<string, unknown>
  const target = row.target === 'robot' || row.target === 'other' || row.target === 'uncertain'
    ? row.target
    : ''
  const emotions = Array.isArray(row.emotions)
    ? row.emotions.flatMap(item => typeof item === 'string' && item.trim() !== '' ? [item.trim().slice(0, 24)] : []).slice(0, 5)
    : []
  const valence = bounded(row.valence, -1, 1)
  const relationalValence = bounded(row.relationalValence, -1, 1)
  const arousal = bounded(row.arousal, 0, 1)
  const intensity = bounded(row.intensity, 0, 1)
  const confidence = bounded(row.confidence, 0, 1)
  const playfulness = bounded(row.playfulness, 0, 1)
  const hostility = bounded(row.hostility, 0, 1)
  const correction = bounded(row.correction, 0, 1)
  const relationalConfidence = bounded(row.relationalConfidence, 0, 1)
  const irony = row.irony === true
  const ironyUncertainty = bounded(row.ironyUncertainty, 0, 1)
  const quotation = row.quotation === true
  const quotationUncertainty = bounded(row.quotationUncertainty, 0, 1)
  const evidence = evidenceOf(row.evidence)
  const explanation = clipped(row.explanation, 240)
  if (
    target === ''
    && emotions.length === 0
    && valence === undefined
    && relationalValence === undefined
    && arousal === undefined
    && intensity === undefined
    && confidence === undefined
    && playfulness === undefined
    && hostility === undefined
    && correction === undefined
    && relationalConfidence === undefined
    && !irony
    && ironyUncertainty === undefined
    && !quotation
    && quotationUncertainty === undefined
    && evidence.length === 0
    && explanation === ''
  ) return undefined
  return {
    target,
    emotions,
    valence: valence ?? null,
    relationalValence: relationalValence ?? null,
    arousal: arousal ?? 0,
    intensity: intensity ?? 0,
    confidence: confidence ?? 0,
    playfulness: playfulness ?? 0,
    hostility: hostility ?? 0,
    correction: correction ?? 0,
    irony,
    ironyUncertainty: ironyUncertainty ?? 0,
    quotation,
    quotationUncertainty: quotationUncertainty ?? 0,
    relationalConfidence: relationalConfidence ?? 0,
    evidence,
    explanation,
  }
}

function confidenceOf(raw: unknown): number {
  return bounded(raw, 0, 1) ?? 0.5
}

function actionWrapper(body: string): boolean {
  return /\p{Script=Han}/u.test(body) && !/[^\p{Script=Han}\p{White_Space}\p{Punctuation}]/u.test(body)
}

function wrappedBody(text: string): string | undefined {
  const open = text[0]
  const close = text.at(-1)
  const matched = (open === '（' && close === '）')
    || (open === '(' && close === ')')
    || (open === '[' && close === ']')
    || (open === '【' && close === '】')
  return matched ? text.slice(1, -1) : undefined
}

function actionLine(text: string): boolean {
  if (!WRAPPED_LINE.test(text)) return false
  const body = wrappedBody(text)
  return body !== undefined && actionWrapper(body)
}

function stripLeadingActionWrappers(value: string): string {
  let text = value
  for (;;) {
    const match = LEADING_WRAPPED.exec(text)
    if (match === null) return text
    const body = wrappedBody(match[0].trimEnd())
    if (body === undefined || !actionWrapper(body)) return text
    text = text.slice(match[0].length).trimStart()
  }
}

/**
 * 聊天正文保留模型写出的标点，只收掉连续重复的符号。
 * @param value - 已经清掉旁白的正文行
 * @returns 原样标点的一行
 */
function naturalizeChatLine(value: string): string {
  const text = value.trim()
  if (text === '' || /https?:\/\//u.test(text) || text.includes('`')) return text
  // 纯标点行原样留着，发不发由发送门禁判断
  if (SIMPLE_PUNCTUATION_ONLY.test(text) || PUNCTUATION_ONLY.test(text)) return text
  return text
    .replace(/([!?！？])\1{2,}/gu, '$1$1')
    .replace(/([…~～])\1{3,}/gu, '$1$1')
    .trim()
}

/**
 * 从工具参数里读本轮想法
 * @param raw 工具收到的 mind 参数
 * @returns 至少有一项内容时返回想法，否则返回空
 */
export function replyMindOf(raw: unknown): ReplyMind | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const row = raw as Record<string, unknown>
  const move = typeof row.move === 'string' && [
    'reply', 'short_ack', 'join_chorus', 'continue_own_topic', 'cold_open',
    'observe_share', 'comfort', 'defend', 'repair', 'task', 'interject',
    'wait', 'watch', 'silent', 'rest',
  ].includes(row.move)
    ? row.move
    : ''
  const target = row.target === 'robot' || row.target === 'other' || row.target === 'uncertain'
    ? row.target
    : ''
  const affect = affectOf(row.affect)
  const mind: ReplyMind = {
    move,
    reason: clipped(row.reason, 160),
    focus: clipped(row.focus, 160),
    tone: clipped(row.tone, 80),
    target,
    reading: clipped(row.reading, 160),
    impulse: clipped(row.impulse, 160),
    counter: clipped(row.counter, 160),
    choice: clipped(row.choice, 160),
    inner: clipped(row.inner, 200),
    next: clipped(row.next, 200),
    goal: clipped(row.goal, 120),
    topic: clipped(row.topic, 120),
    confidence: confidenceOf(row.confidence),
    review: clipped(row.review, 240),
    reflect: clipped(row.reflect, 200),
    waitMs: Math.min(120_000, Math.max(0, Math.floor(bounded(row.waitMs, 0, 120_000) ?? 0))),
    interrupt: clipped(row.interrupt, 160),
    cancel: clipped(row.cancel, 160),
    settle: clipped(row.settle, 200),
    ...affect === undefined ? {} : { affect },
  }
  return Object.entries(mind).some(([key, value]) => key !== 'affect' && key !== 'confidence' && key !== 'waitMs' && typeof value === 'string' && value !== '')
    || affect !== undefined
    ? mind
    : undefined
}

/**
 * 去掉只该留在心里的行，留下真正要发的正文
 * @param raw 模型写出的正文
 * @returns 清理后的正文；只剩旁白时为空串
 */
export function finalTextOf(raw: string): string {
  const lines = raw.replace(/\r\n?/gu, '\n').split('\n')
  const kept: string[] = []
  for (const line of lines) {
    let text = line.trim()
    if (text === '' || actionLine(text) || INTERNAL_LINE.test(text)) continue
    text = stripLeadingActionWrappers(text.replace(BODY_PREFIX, '')).trim()
    if (text === '' || actionLine(text)) continue
    text = naturalizeChatLine(text)
    if (text !== '') kept.push(text)
  }
  // 标点行也是模型的选择，不在这里丢掉；极端情况交给发送门禁判断
  return kept.join('\n')
}

/**
 * 判断清理后的正文是不是只有空应声
 * @param raw 模型写出的正文
 * @returns 只有语气字、应声或纯标点时返回真
 */
export function isBareReply(raw: string): boolean {
  const text = finalTextOf(raw)
  if (text === '') return false
  if (LATIN_TYPING.test(text.trim())) return false
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  return lines.length > 0 && lines.every(line =>
    BARE_REPLY.test(line) || (PUNCTUATION_ONLY.test(line) && !/^[?？!！]$/u.test(line)))
}
