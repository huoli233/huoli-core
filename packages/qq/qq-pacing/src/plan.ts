// 说话的规矩：一条拆几条、隔多久、今天还能说几句

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
}

/** 切一条话要守的两个上限 */
export interface SplitBudget {
  /** 这一轮最多几条 */
  maxParts: number
  /** 每条最多几个字 */
  maxCharsPerPart: number
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
  perHour: 60,
  perDay: 600,
  repeatWindowMs: 10 * 60_000,
  recentKeep: 40,
}

/** 记账仓能按配置改的四项额度 */
export interface QuotaLimits {
  perHour: number
  perDay: number
  repeatWindowMs: number
  recentKeep: number
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
    repeatWindowMs: Math.max(0, Math.floor(overrides.repeatWindowMs ?? PACING_DEFAULTS.repeatWindowMs)),
    recentKeep: Math.max(1, Math.floor(overrides.recentKeep ?? PACING_DEFAULTS.recentKeep)),
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

// 从窗口里从后往前找一处断点，窗口大小就是一条的字数上限
function cutAt(text: string, from: number, maxChars: number): number {
  const window = Math.min(maxChars, text.length - from)
  for (const marks of [SENTENCE_MARKS, CLAUSE_MARKS]) {
    for (let size = window; size > 0; size -= 1) {
      if (marks.test(text.charAt(from + size - 1))) return from + size
    }
  }
  return from + window
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

// 先按句末标点与换行断句，标点留在它自己那一句的末尾
function sentencesOf(body: string): string[] {
  return body.split(/(?<=[。！？!?…\n])/u).map(piece => piece.trim()).filter(piece => piece !== '')
}

// 一句长过上限就再断一次，断在标点上比按字数硬切更像人说话
function fitMax(segment: string, maxChars: number): string[] {
  if (segment.length <= maxChars) return [segment]
  const pieces: string[] = []
  let at = 0
  while (at < segment.length) {
    const end = cutAt(segment, at, maxChars)
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
  const segments = sentencesOf(body).flatMap(sentence => fitMax(sentence, maxChars))
  if (segments.length <= maxParts) return segments
  return mergeToBudget(segments, maxParts)
}

/**
 * 条与条之间隔多久
 * @param parts - 切好的几条
 * @returns 每两条之间一个间隔，最后一条后面没有
 */
export function speechGaps(parts: readonly string[]): number[] {
  return parts.slice(0, -1).map((part, index) => {
    const base = PACING_DEFAULTS.minGapMs + Math.min(part.length * PACING_DEFAULTS.gapPerCharMs, PACING_DEFAULTS.gapCapMs)
    return Math.min(PACING_DEFAULTS.maxGapMs, base + index * PACING_DEFAULTS.gapStepMs)
  })
}

/**
 * 把一段话按上限拆开，再配上条与条之间的间隔
 * @param text - 文字
 * @param options - 条数上限与单条字数上限
 * @returns 处理结果
 */
export function splitSpeech(text: string, options: Partial<SplitBudget> = {}): PlannedSpeech {
  const parts = splitByBudget(text, {
    maxParts: options.maxParts ?? PACING_DEFAULTS.maxParts,
    maxCharsPerPart: Math.max(20, options.maxCharsPerPart ?? PACING_DEFAULTS.maxCharsPerPart),
  })
  return { parts, gapsMs: speechGaps(parts) }
}
