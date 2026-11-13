// 说话的规矩：一条拆几条、隔多久、今天还能说几句

import { isProtected, protectedRanges, resolveSemanticSplit, splitSemantically, type SemanticSplit } from './semantic.ts'

/** 一轮里的话拆成的样子 */
export interface PlannedSpeech {
  parts: string[]
  gapsMs: number[]
}

/** 额度用掉多少 */
export interface QuotaUse {
  day: string
  hourKey: string
  dayCount: number
  hourCount: number
}

/** 能不能发 */
export interface PacingVerdict {
  ok: boolean
  code?: string
  reason?: string
  hint?: string
  /** 下次可以再试的时刻，按小时与按天两档才有 */
  retryAt?: number
}

/** 频率配额分哪两本账 */
export type QuotaKind = 'text' | 'voice'

/** 一次配额读数：这一小时、今天各用了多少 */
export interface QuotaReading {
  /** 这一小时已经用掉的条数或段数 */
  hourCount: number
  /** 今天已经用掉的条数或段数 */
  dayCount: number
}

/** 这一档的上限 */
export interface QuotaCeiling {
  /** 一小时最多几条或几段 */
  perHour: number
  /** 一天最多几条或几段 */
  perDay: number
}

/** 切一条话要守的两个上限 */
export interface SplitBudget {
  /** 这一轮最多几条 */
  maxParts: number
  /** 每条最多几个字 */
  maxCharsPerPart: number
  /** 不超单条上限时优先塞成一条，不再按句号拆 */
  preferSingle?: boolean
  /** 短话不动、长话按分句拆成几个气泡；不给就只按上限切 */
  semantic?: boolean
  /** 语义分段的门槛与条数上限，给了才启用 */
  semanticSplit?: SemanticSplit
  /** 切到第几条该停：给了就按它收口，不给就只按上限切 */
  stop?: (plannedIndex: number) => boolean
}

/** 条与条之间的间隔怎么算 */
export interface GapTuning {
  /** 打底的最短间隔 */
  minGapMs: number
  /** 再长也不超过这个数 */
  maxGapMs: number
  /** 每多一个字的加时 */
  gapPerCharMs: number
  /** 按字数加时的封顶 */
  gapCapMs: number
  /** 排到后面几条时的额外加时 */
  gapStepMs: number
  /** 抖动幅度，按比例上下浮动，0 到 1 */
  gapJitter: number
  /** 偶尔来一次明显停顿的概率，0 到 1 */
  longGapProbability: number
  /** 那次明显停顿的最短时长 */
  longGapMinMs: number
  /** 那次明显停顿的最长时长 */
  longGapMaxMs: number
}

/** 随机源，每次给一个 0 到 1 之间的小数 */
export type RandomSource = () => number

/** 算间隔时可换的两样东西 */
export interface SpeechGapOptions {
  /** 覆盖默认的间隔参数 */
  tuning?: Partial<GapTuning>
  /** 换掉随机源，测试传定种子的那个 */
  random?: RandomSource
}

/** 默认规矩 */
export const PACING_DEFAULTS = {
  maxParts: 8,
  maxCharsPerPart: 500,
  minGapMs: 800,
  maxGapMs: 6000,
  gapPerCharMs: 12,
  gapCapMs: 2000,
  gapStepMs: 120,
  gapJitter: 0.35,
  longGapProbability: 0.1,
  longGapMinMs: 1800,
  longGapMaxMs: 2800,
  perHour: 60,
  perDay: 600,
  voicePerHour: 4,
  voicePerDay: 20,
  voiceMaxSeconds: 60,
  voiceMaxBytes: 1_048_576,
  voiceBytesPerSecond: 1500,
  repeatWindowMs: 10 * 60_000,
  recentKeep: 40,
}

/** 记录仓能按配置改的额度 */
export interface QuotaLimits {
  perHour: number
  perDay: number
  /** 语音单独一本账，一小时最多几段 */
  voicePerHour: number
  /** 语音一天最多几段 */
  voicePerDay: number
  repeatWindowMs: number
  recentKeep: number
}

/** 发一段语音之前要过的几道上限 */
export interface VoiceLimits {
  /** 一段最多几秒 */
  maxSeconds: number
  /** 一段最多多少字节 */
  maxBytes: number
  /** 认不出音频格式时按多少字节一秒估时长 */
  bytesPerSecond: number
}

/**
 * 从配置解析出额度，缺项一律取默认值表
 * @param overrides - 配置里给的额度
 * @returns 这一行实际用的额度
 */
export function resolveQuotaLimits(overrides: Partial<QuotaLimits> = {}): QuotaLimits {
  return {
    perHour: Math.max(1, Math.floor(overrides.perHour ?? PACING_DEFAULTS.perHour)),
    perDay: Math.max(1, Math.floor(overrides.perDay ?? PACING_DEFAULTS.perDay)),
    voicePerHour: Math.max(1, Math.floor(overrides.voicePerHour ?? PACING_DEFAULTS.voicePerHour)),
    voicePerDay: Math.max(1, Math.floor(overrides.voicePerDay ?? PACING_DEFAULTS.voicePerDay)),
    repeatWindowMs: Math.max(0, Math.floor(overrides.repeatWindowMs ?? PACING_DEFAULTS.repeatWindowMs)),
    recentKeep: Math.max(1, Math.floor(overrides.recentKeep ?? PACING_DEFAULTS.recentKeep)),
  }
}

/**
 * 从配置解析发语音前要过的几道上限，缺项一律取默认值表
 * @param overrides - 配置里给的上限
 * @returns 这一段实际用的上限
 */
export function resolveVoiceLimits(overrides: Partial<VoiceLimits> = {}): VoiceLimits {
  return {
    maxSeconds: Math.max(1, Math.floor(overrides.maxSeconds ?? PACING_DEFAULTS.voiceMaxSeconds)),
    maxBytes: Math.max(1, Math.floor(overrides.maxBytes ?? PACING_DEFAULTS.voiceMaxBytes)),
    bytesPerSecond: Math.max(1, Math.floor(overrides.bytesPerSecond ?? PACING_DEFAULTS.voiceBytesPerSecond)),
  }
}

// 比例类参数夹在 0 到 1，越界的配置不算数
function clampRatio(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

/**
 * 下一个整点的时刻
 * @param at - 现在的时间
 * @returns 那一小时的开始时刻
 */
export function nextHourAt(at: number): number {
  const date = new Date(at)
  date.setMinutes(0, 0, 0)
  date.setHours(date.getHours() + 1)
  return date.getTime()
}

/**
 * 明天零点的时刻
 * @param at - 现在的时间
 * @returns 明天的开始时刻
 */
export function nextDayAt(at: number): number {
  const date = new Date(at)
  date.setHours(24, 0, 0, 0)
  return date.getTime()
}

/**
 * 按小时与按天这一档怎么判：文本与语音走同一套规则，只换读数、上限与码
 * 说话那一侧与发语音那一侧都调这一处，判据只有这一份
 * @param kind - 哪一本账
 * @param reading - 这一小时与今天各用了多少
 * @param ceiling - 这一档的上限
 * @param at - 现在的时间
 * @returns 还能不能发；不能就给码、说清用了多少、给下次时刻
 */
export function quotaVerdict(kind: QuotaKind, reading: QuotaReading, ceiling: QuotaCeiling, at: number): PacingVerdict {
  const voice = kind === 'voice'
  if (reading.hourCount >= ceiling.perHour) {
    return {
      ok: false,
      code: voice ? 'pacing.voice_hour_full' : 'pacing.hour_full',
      reason: voice
        ? `这一小时已经发了 ${reading.hourCount} 段语音，到 ${ceiling.perHour} 段的上限了`
        : `这一小时已经说了 ${reading.hourCount} 条，到 ${ceiling.perHour} 条的上限了`,
      hint: voice ? '这一轮改用文字，等下一小时再发语音' : '等下一小时再说',
      retryAt: nextHourAt(at),
    }
  }
  if (reading.dayCount >= ceiling.perDay) {
    return {
      ok: false,
      code: voice ? 'pacing.voice_day_full' : 'pacing.day_full',
      reason: voice
        ? `今天已经发了 ${reading.dayCount} 段语音，到 ${ceiling.perDay} 段的上限了`
        : `今天已经说了 ${reading.dayCount} 条，到 ${ceiling.perDay} 条的上限了`,
      hint: voice ? '这一轮改用文字，明天再发语音' : '明天再说',
      retryAt: nextDayAt(at),
    }
  }
  return { ok: true }
}

/**
 * 从配置解析条与条之间的间隔参数，缺项一律取默认值表
 * @param overrides - 配置里给的间隔参数
 * @returns 这一轮实际用的间隔参数
 */
export function resolveGapTuning(overrides: Partial<GapTuning> = {}): GapTuning {
  const minGapMs = Math.max(0, Math.floor(overrides.minGapMs ?? PACING_DEFAULTS.minGapMs))
  const longGapMinMs = Math.max(0, Math.floor(overrides.longGapMinMs ?? PACING_DEFAULTS.longGapMinMs))
  return {
    minGapMs,
    maxGapMs: Math.max(minGapMs, Math.floor(overrides.maxGapMs ?? PACING_DEFAULTS.maxGapMs)),
    gapPerCharMs: Math.max(0, Math.floor(overrides.gapPerCharMs ?? PACING_DEFAULTS.gapPerCharMs)),
    gapCapMs: Math.max(0, Math.floor(overrides.gapCapMs ?? PACING_DEFAULTS.gapCapMs)),
    gapStepMs: Math.max(0, Math.floor(overrides.gapStepMs ?? PACING_DEFAULTS.gapStepMs)),
    gapJitter: clampRatio(overrides.gapJitter ?? PACING_DEFAULTS.gapJitter),
    longGapProbability: clampRatio(overrides.longGapProbability ?? PACING_DEFAULTS.longGapProbability),
    longGapMinMs,
    longGapMaxMs: Math.max(longGapMinMs, Math.floor(overrides.longGapMaxMs ?? PACING_DEFAULTS.longGapMaxMs)),
  }
}

// 部署时的随机源，每条间隔都要重新取，测试一律换成定种子的
const liveRandom: RandomSource = () => Math.random()

/**
 * 定种子的随机源，同一颗种子给出同一串数；它自己记着走到哪一步，要重放就再取一个实例
 * @param seed - 种子，任意整数
 * @returns 每次返回 0 到 1 之间的小数
 */
export function seededRandom(seed: number): RandomSource {
  let state = Math.floor(seed) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1) >>> 0
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

// 句末标点，断句优先级最高
const SENTENCE_MARKS = /[。！？!?…]/u

// 逗号与换行，句末断不开时才退到这一档
const CLAUSE_MARKS = /[，,、；;：:\n]/u

/**
 * 按天和小时的编号
 * @param now - 现在的时间
 * @returns 拼好的话
 */
export function dayKey(now: number): string {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * 小时的编号
 * @param now - 现在的时间
 * @returns 拼好的话
 */
export function hourKey(now: number): string {
  return `${dayKey(now)}-${String(new Date(now).getHours()).padStart(2, '0')}`
}

// 代理对的低半区，切在这里会把一个字符劈成两半
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

// 把切点挪到码点边界上；挪不动就整个字带走，不能原地不动
function snapCut(text: string, at: number, from: number): number {
  if (at >= text.length) return text.length
  const cut = isLowSurrogate(text.charCodeAt(at)) ? at - 1 : at
  return cut > from ? cut : Math.min(from + 2, text.length)
}

// 从窗口里从后往前找一处断点，窗口大小就是一条的字数上限
function cutAt(text: string, from: number, maxChars: number, ranges: readonly [number, number][]): number {
  // 起点已经在整段不切的片段里，只能整块带走
  const holder = ranges.find(([start, end]) => start <= from && end > from)
  if (holder !== undefined) return holder[1]
  const windowEnd = Math.min(from + maxChars, text.length)
  // 窗口里还有整段不切的片段时，切点只能落在它之前
  const blocker = ranges.find(([start]) => start > from && start < windowEnd)
  const limit = blocker === undefined ? windowEnd : blocker[0]
  for (const marks of [SENTENCE_MARKS, CLAUSE_MARKS]) {
    for (let at = limit; at > from; at -= 1) {
      if (marks.test(text.charAt(at - 1))) return snapCut(text, at, from)
    }
  }
  return snapCut(text, limit, from)
}

// 条数不够用时把相邻的几段并成一条，按剩余字数平分，顺序不动、一字不丢
function mergeToBudget(segments: readonly string[], target: number): string[] {
  const rest = [0]
  for (let at = segments.length - 1; at >= 0; at -= 1) rest.unshift((rest[0] ?? 0) + (segments[at] ?? '').length)
  const merged: string[] = []
  let at = 0
  for (let group = 0; group < target; group += 1) {
    const left = target - group
    if (left === 1) {
      merged.push(segments.slice(at).join(''))
      break
    }
    const want = Math.ceil((rest[at] ?? 0) / left)
    let piece = ''
    // 至少并一段，且要给后面几组留下足够多的段
    while (at < segments.length - (left - 1) && (piece === '' || piece.length + (segments[at] ?? '').length <= want)) {
      piece += segments[at] ?? ''
      at += 1
    }
    merged.push(piece)
  }
  return merged
}

// 先按句末标点与换行断句，标点留在它自己那一句的末尾；整段不切的片段里的标点不算断点
function sentencesOf(body: string): string[] {
  const ranges = protectedRanges(body)
  const out: string[] = []
  let start = 0
  for (let at = 0; at < body.length; at += 1) {
    const ch = body.charAt(at)
    if (!SENTENCE_MARKS.test(ch) && ch !== '\n') continue
    if (isProtected(at, ranges)) continue
    out.push(body.slice(start, at + 1))
    start = at + 1
  }
  out.push(body.slice(start))
  return out.map(piece => piece.trim()).filter(piece => piece !== '')
}

// 一句长过上限就再断一次，断在标点上比按字数硬切更像人说话
function fitMax(segment: string, maxChars: number): string[] {
  if (segment.length <= maxChars) return [segment]
  const ranges = protectedRanges(segment)
  const pieces: string[] = []
  let at = 0
  while (at < segment.length) {
    const end = cutAt(segment, at, maxChars, ranges)
    const piece = segment.slice(at, end).trim()
    if (piece !== '') pieces.push(piece)
    at = end
  }
  return pieces
}

/**
 * 按这一轮的条数上限把一段话切成几条
 * @param text - 原文
 * @param budget - 条数上限与单条字数上限，不给就用默认表
 * @returns 切好的几条，拼起来就是原文去空白，条数不超过上限
 */
export function splitByBudget(text: string, budget: SplitBudget = PACING_DEFAULTS): string[] {
  const body = text.trim()
  if (body === '') return []
  const maxParts = Math.max(1, Math.floor(budget.maxParts))
  const maxChars = Math.max(1, Math.floor(budget.maxCharsPerPart))
  // 语义分段优先：短话不动，长话按分句拆成几个气泡，拆出来的每段仍守单条字数上限
  if (budget.semantic === true && budget.semanticSplit !== undefined && maxParts > 1) {
    const semantic = splitSemantically(body, {
      ...resolveSemanticSplit(budget.semanticSplit),
      maxParts,
    })
    // 切不动就退回原来的上限切法，让 preferSingle 与 stop 继续生效
    if (semantic.length > 1) {
      const segments = semantic.flatMap(part => fitMax(part, maxChars))
      const parts = segments.length <= maxParts ? segments : mergeToBudget(segments, maxParts)
      if (budget.stop === undefined) return parts
      let allowed = 0
      while (allowed < parts.length && !budget.stop(allowed)) allowed += 1
      return parts.slice(0, allowed)
    }
  }
  if (budget.preferSingle === true && body.length <= maxChars) {
    return budget.stop?.(0) === true ? [] : [body]
  }
  const segments = sentencesOf(body).flatMap(sentence => fitMax(sentence, maxChars))
  const parts = segments.length <= maxParts ? segments : mergeToBudget(segments, maxParts)
  // 切到第几条该停就停：判据由调用方给，这一层不猜
  if (budget.stop === undefined) return parts
  let allowed = 0
  while (allowed < parts.length && !budget.stop(allowed)) allowed += 1
  return parts.slice(0, allowed)
}

/**
 * 条与条之间隔多久
 * @param parts - 切好的几条
 * @param options - 间隔参数与随机源，不给就用默认值表与每次不同的真随机
 * @returns 每两条之间一个间隔，最后一条后面没有
 */
export function speechGaps(parts: readonly string[], options: SpeechGapOptions = {}): number[] {
  const tuning = resolveGapTuning(options.tuning)
  const random = options.random ?? liveRandom
  return parts.slice(0, -1).map((part, index) => {
    const base = tuning.minGapMs + Math.min(part.length * tuning.gapPerCharMs, tuning.gapCapMs) + index * tuning.gapStepMs
    // 先按比例抖动，再偶尔换成一次明显更长的停顿
    const jittered = base * (1 + (random() * 2 - 1) * tuning.gapJitter)
    const long = random() < tuning.longGapProbability
      ? tuning.longGapMinMs + random() * (tuning.longGapMaxMs - tuning.longGapMinMs)
      : 0
    const wanted = Math.max(jittered, long)
    return Math.round(Math.min(tuning.maxGapMs, Math.max(tuning.minGapMs, wanted)))
  })
}

/**
 * 把一段话按上限拆开，再配上条与条之间的间隔
 * @param text - 文字
 * @param options - 条数上限、单条字数上限，以及算间隔时可选的两样东西
 * @returns 处理结果
 */
export function splitSpeech(text: string, options: Partial<SplitBudget> & { gaps?: SpeechGapOptions } = {}): PlannedSpeech {
  const parts = splitByBudget(text, {
    maxParts: options.maxParts ?? PACING_DEFAULTS.maxParts,
    maxCharsPerPart: Math.max(20, options.maxCharsPerPart ?? PACING_DEFAULTS.maxCharsPerPart),
    ...options.preferSingle === undefined ? {} : { preferSingle: options.preferSingle },
    ...options.semantic === undefined ? {} : { semantic: options.semantic },
    ...options.semanticSplit === undefined ? {} : { semanticSplit: options.semanticSplit },
    ...options.stop === undefined ? {} : { stop: options.stop },
  })
  return { parts, gapsMs: speechGaps(parts, options.gaps) }
}
