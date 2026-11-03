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

/** 默认规矩 */
export const PACING_DEFAULTS = {
  maxParts: 8,
  maxCharsPerPart: 500,
  minGapMs: 800,
  maxGapMs: 6000,
  perHour: 60,
  perDay: 600,
  repeatWindowMs: 10 * 60_000,
}

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

/**
 * 把一段话按句号换行拆开，太长再按字数硬切
 * @param text - 文字
 * @param options - 选项
 * @returns 处理结果
 */
export function splitSpeech(text: string, options: { maxParts?: number; maxCharsPerPart?: number } = {}): PlannedSpeech {
  const maxParts = Math.max(1, options.maxParts ?? PACING_DEFAULTS.maxParts)
  const maxChars = Math.max(20, options.maxCharsPerPart ?? PACING_DEFAULTS.maxCharsPerPart)
  const body = String(text ?? '').trim()
  if (body === '') return { parts: [], gapsMs: [] }

  const rough = body
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？!?…])/))
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '')

  const parts: string[] = []
  for (const piece of rough) {
    if (piece.length <= maxChars) {
      parts.push(piece)
      continue
    }
    for (let at = 0; at < piece.length; at += maxChars) parts.push(piece.slice(at, at + maxChars))
  }

  const limited = parts.slice(0, maxParts)
  const gapsMs = limited.slice(0, -1).map((part, index) => {
    const base = PACING_DEFAULTS.minGapMs + Math.min(part.length * 12, 2000)
    return Math.min(PACING_DEFAULTS.maxGapMs, base + index * 120)
  })
  return { parts: limited, gapsMs }
}
