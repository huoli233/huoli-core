// 长话按分句切成几个气泡：切点只认标点、换行和中文之间的空格，切完不留空格

/** 长话按语义拆成几个气泡的门槛 */
export interface SemanticSplit {
  /** 正文短于这个字数就不拆，默认 6 */
  minChars: number
  /** 至少要有这么多分句才拆，默认 2 */
  minPieces: number
  /** 拆出来短于这个字数的碎片并回邻居，默认 2 */
  minPartChars: number
}

/** 默认门槛：短对话也能按逗号或换行分成几个气泡 */
export const SEMANTIC_DEFAULTS: SemanticSplit = {
  minChars: 6,
  minPieces: 2,
  minPartChars: 2,
}

/** 从配置解析门槛，缺项一律取默认值表 */
export function resolveSemanticSplit(overrides: Partial<SemanticSplit> = {}): SemanticSplit {
  return {
    minChars: Math.max(1, Math.floor(overrides.minChars ?? SEMANTIC_DEFAULTS.minChars)),
    minPieces: Math.max(2, Math.floor(overrides.minPieces ?? SEMANTIC_DEFAULTS.minPieces)),
    minPartChars: Math.max(1, Math.floor(overrides.minPartChars ?? SEMANTIC_DEFAULTS.minPartChars)),
  }
}

// 逗号、顿号、分号和冒号只负责分句；分成气泡后不必每段都带着它们
const WRITTEN = /[，,、；;：:]/u
// 句号与问号感叹号省略号带语气，留在它自己那一句的末尾，别为了分段把正常标点删光
const TONE = /[。!?！？…~～]/u
// 汉字与中文标点，用来认「中文之间的空格」
const HAN_LIKE = /[\p{Script=Han}，。、；：！？…]/u
const BLANK = /\s/u
// 收口保险：一条气泡里不该再有中文之间的空格
const CHINESE_GAP = /(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu

/**
 * 判断一处空格是不是中文之间的分句空隙；英文单词、数字两侧的空格不算。
 * @param text - 整行原文
 * @param at - 空格的下标
 * @returns 该空格要当切点时返回真
 */
function chineseGap(text: string, at: number): boolean {
  const before = text.slice(0, at).trimEnd().at(-1) ?? ''
  const after = text.slice(at + 1).trimStart()[0] ?? ''
  return HAN_LIKE.test(before) && HAN_LIKE.test(after)
}

// 中文标点不会出现在网址或 @ 里面，遇到就收尾，否则后面的整句话都会被并成一段
const TAIL_STOP = '，。；：！？、…～（）【】「」《》“”‘’'

// 网址、CQ 码、@、markdown 链接整段不切，里面的冒号斜杠空格都不当切点
const PROTECTED = new RegExp(`https?://[^\\s）)】」${TAIL_STOP}]+|\\[CQ:[^\\]]+\\]|@[^\\s${TAIL_STOP}]+|\\[[^\\]]*\\]\\([^)\\s]+\\)|\\d{1,2}:\\d{2}|\\d+\\s+\\p{Script=Han}(?:\\s+\\p{Script=Han})*`, 'giu')

/**
 * 找出一行里整段不切的片段，供按上限切分时避开
 * @param line - 整行原文
 * @returns 每段的起止下标，止下标不含
 */
export function protectedRanges(line: string): [number, number][] {
  const ranges: [number, number][] = []
  for (const match of line.matchAll(PROTECTED)) {
    const start = match.index
    ranges.push([start, start + match[0].length])
  }
  return ranges
}

/**
 * 判断一处下标是否落在整段不切的片段里
 * @param at - 下标
 * @param ranges - 整段不切的片段
 * @returns 落在里面返回真
 */
export function isProtected(at: number, ranges: readonly [number, number][]): boolean {
  return ranges.some(([start, end]) => at >= start && at < end)
}

// 一行里按标点与中文间空格切成片段；轻标点不留在气泡里，有语气的标点留在句尾
function piecesOf(line: string): string[] {
  const out: string[] = []
  let buf = ''
  const ranges = protectedRanges(line)
  const flush = (): void => {
    const piece = buf.replace(CHINESE_GAP, '').trim()
    if (piece !== '') out.push(piece)
    buf = ''
  }
  for (let at = 0; at < line.length; at += 1) {
    const ch = line[at] ?? ''
    if (isProtected(at, ranges)) { buf += ch; continue }
    if (BLANK.test(ch)) {
      if (chineseGap(line, at)) { flush(); continue }
      if (buf !== '') buf += ch
      continue
    }
    if (WRITTEN.test(ch)) { flush(); continue }
    buf += ch
    if (TONE.test(ch)) flush()
  }
  flush()
  return out
}

// 过短的碎片并回更短的那一边邻居，拼接不加空格
function mergeShort(pieces: readonly string[], minPartChars: number): string[] {
  const out = pieces.map(piece => piece)
  let at = 0
  while (at < out.length) {
    const current = out[at] ?? ''
    if (current.length >= minPartChars) { at += 1; continue }
    const prev = at > 0 ? (out[at - 1] ?? '').length : Infinity
    const next = at + 1 < out.length ? (out[at + 1] ?? '').length : Infinity
    if (prev === Infinity && next === Infinity) break
    if (next <= prev) out.splice(at, 2, `${current}${out[at + 1] ?? ''}`)
    else { out.splice(at - 1, 2, `${out[at - 1] ?? ''}${current}`); at -= 1 }
  }
  return out.filter(piece => piece !== '')
}

// 条数超上限时先合并同一行内的相邻片段，同一行只剩一条后才跨行合并
function capParts(pieces: readonly string[], groups: readonly number[], maxParts: number): string[] {
  const out = pieces.map(piece => piece)
  const owners = groups.slice()
  while (out.length > maxParts && out.length > 1) {
    let best = 0
    let bestLen = Infinity
    let bestSameLine = false
    for (let at = 0; at < out.length - 1; at += 1) {
      const sum = (out[at] ?? '').length + (out[at + 1] ?? '').length
      const sameLine = owners[at] === owners[at + 1]
      // 同行合并永远优先；同行里再挑最短的一对
      if ((sameLine && !bestSameLine) || (sameLine === bestSameLine && sum < bestLen)) {
        bestLen = sum
        best = at
        bestSameLine = sameLine
      }
    }
    out.splice(best, 2, `${out[best] ?? ''}${out[best + 1] ?? ''}`)
    owners.splice(best + 1, 1)
  }
  return out
}

/**
 * 把一段正文按分句切成几个气泡；够短、分句太少或切不动时返回一条原文。
 * 换行是模型明确给出的边界，只在行内并碎片，不把两行并回一条。
 * @param text - 模型写出的正文，标点与空格都还在
 * @param options - 门槛与这一轮最多几条
 * @returns 切好的几条；返回一条原文时表示不该语义分段
 */
export function splitSemantically(text: string, options: SemanticSplit & { maxParts: number }): string[] {
  const raw = text.trim()
  if (raw === '') return []
  const lines = raw.split(/\n+/u).filter(line => line.trim() !== '')
  // 换行是模型写出的气泡边界，逐行收碎片，不跨行合并
  const byLine = lines.map(line => mergeShort(piecesOf(line), options.minPartChars))
  const owners = byLine.flatMap((pieces, line) => pieces.map(() => line))
  const pieces = byLine.flat()
  const hasNewline = lines.length > 1
  const chars = raw.replace(/\s/gu, '').length
  if (!hasNewline && (chars < options.minChars || pieces.length < options.minPieces)) return [raw]
  if (pieces.length <= 1) return [raw]
  return capParts(pieces, owners, Math.max(1, Math.floor(options.maxParts)))
}
