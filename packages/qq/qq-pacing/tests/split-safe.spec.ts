import { describe, expect, it } from 'vitest'
import { PACING_DEFAULTS, seededRandom, speechGaps, splitByBudget, splitSpeech } from '../src/index.ts'

// 去掉空白再比，切分允许把断点旁边的空格吃掉
const flat = (text: string): string => text.replace(/\s+/gu, '')

// 一段文字是不是完整：不留孤立的代理项
function wellFormed(text: string): boolean {
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(at + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      at += 1
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}

const LONG_URL = 'https://example.com/a/rather/long/path/segments?query=1&token=abcdef0123456789&page=2&mode=full'

describe('整段不切的片段', () => {
  it('长网址不被切断，整条留在同一个气泡里', () => {
    const body = `看这个${LONG_URL}先说这么多`
    const parts = splitByBudget(body, { maxParts: 8, maxCharsPerPart: 12 })

    expect(parts.join('')).toBe(body)
    const withUrl = parts.filter(part => part.includes('https://'))
    expect(withUrl).toHaveLength(1)
    expect(withUrl[0]).toContain(LONG_URL)
  })

  it('比单条上限还长的网址整块带走，不按字数硬切', () => {
    const body = `前缀${LONG_URL}后缀`
    const parts = splitByBudget(body, { maxParts: 8, maxCharsPerPart: 20 })

    expect(parts.join('')).toBe(body)
    expect(parts.some(part => part.includes(LONG_URL) && part.length > 20)).toBe(true)
    expect(parts.every(wellFormed)).toBe(true)
  })

  it('网址里的问号不算断句点', () => {
    const url = 'https://example.com/search?q=abc&page=2'
    const parts = splitByBudget(`这个${url}你试试`, { maxParts: 8, maxCharsPerPart: 8 })

    expect(parts.join('')).toBe(`这个${url}你试试`)
    expect(parts.some(part => part.includes(url))).toBe(true)
  })

  it('markdown 链接不被切断', () => {
    const link = '[点这里看看](https://example.com/x/y?z=1)'
    const parts = splitByBudget(`前文${link}后文`, { maxParts: 8, maxCharsPerPart: 6 })

    expect(parts.join('')).toBe(`前文${link}后文`)
    expect(parts.some(part => part.includes(link))).toBe(true)
  })

  it('CQ 码段不被切断', () => {
    const cq = '[CQ:image,file=abc.jpg,url=https://example.com/p.png]'
    const parts = splitByBudget(`先看${cq}再说`, { maxParts: 8, maxCharsPerPart: 6 })

    expect(parts.join('')).toBe(`先看${cq}再说`)
    expect(parts.some(part => part.includes(cq))).toBe(true)
  })

  it('一条里有多处链接时每处都完整', () => {
    const body = `先看[一](https://a.example.com/1)再看${LONG_URL}最后说别的`
    const parts = splitByBudget(body, { maxParts: 8, maxCharsPerPart: 10 })

    expect(parts.join('')).toBe(body)
    expect(parts.some(part => part.includes('[一](https://a.example.com/1)'))).toBe(true)
    expect(parts.some(part => part.includes(LONG_URL))).toBe(true)
  })
})

describe('按码点切', () => {
  it('全是表情的长串切出来两段都是完整字符', () => {
    const body = '😀'.repeat(12)
    const parts = splitByBudget(body, { maxParts: 8, maxCharsPerPart: 5 })

    expect(parts.join('')).toBe(body)
    expect(parts.every(wellFormed)).toBe(true)
    expect(parts.every(part => part.length <= 5)).toBe(true)
  })

  it('汉字夹表情的正文不留孤立代理项', () => {
    const body = '一二😀三四😀五'.repeat(6)
    const parts = splitByBudget(body, { maxParts: 8, maxCharsPerPart: 4 })

    expect(parts.join('')).toBe(body)
    expect(parts.every(wellFormed)).toBe(true)
    for (const part of parts) {
      expect(part.charCodeAt(0) >= 0xdc00 && part.charCodeAt(0) <= 0xdfff).toBe(false)
    }
  })

  it('表情与标点混排时不断在代理对中间', () => {
    const body = '好看😀，再来😀。还有😀和😀'
    const parts = splitByBudget(body, { maxParts: 8, maxCharsPerPart: 5 })

    expect(parts.join('')).toBe(body)
    expect(parts.every(wellFormed)).toBe(true)
  })

  it('纯英文长串按上限硬切，不整段留成一条', () => {
    const body = 'a'.repeat(500)
    const parts = splitByBudget(body, { maxParts: 8, maxCharsPerPart: 100 })

    expect(parts).toHaveLength(5)
    expect(parts.every(part => part.length <= 100)).toBe(true)
    expect(parts.join('')).toBe(body)
  })
})

describe('条与条之间的间隔', () => {
  const PARTS = ['一二三', '四五六七八', '九十', '十字路口', '再说一句', '还有', '最后']

  it('同一颗种子给出同一串间隔', () => {
    const once = speechGaps(PARTS, { random: seededRandom(11) })
    const twice = speechGaps(PARTS, { random: seededRandom(11) })

    expect(twice).toEqual(once)
  })

  it('换一颗种子结果就变，不再是一个固定公式', () => {
    const first = speechGaps(PARTS, { random: seededRandom(1) })
    const second = speechGaps(PARTS, { random: seededRandom(2) })

    expect(second).not.toEqual(first)
  })

  it('抖动过的间隔都落在下限与上限之间，且是整数', () => {
    const gaps = speechGaps(PARTS, { random: seededRandom(7) })

    expect(gaps).toHaveLength(PARTS.length - 1)
    expect(gaps.every(gap => Number.isInteger(gap))).toBe(true)
    expect(gaps.every(gap => gap >= PACING_DEFAULTS.minGapMs)).toBe(true)
    expect(gaps.every(gap => gap <= PACING_DEFAULTS.maxGapMs)).toBe(true)
  })

  it('抖动关掉时回到原来的估法，用来对照', () => {
    const flatGaps = speechGaps(PARTS, { tuning: { gapJitter: 0, longGapProbability: 0 } })
    const jittered = speechGaps(PARTS, { random: seededRandom(3) })

    expect(flatGaps.every(gap => gap >= PACING_DEFAULTS.minGapMs && gap <= PACING_DEFAULTS.maxGapMs)).toBe(true)
    expect(jittered).not.toEqual(flatGaps)
  })

  it('偶尔一次明显停顿是可配的，落在长停顿区间里', () => {
    const gaps = speechGaps(PARTS, {
      tuning: { longGapProbability: 1, longGapMinMs: 3000, longGapMaxMs: 4000 },
      random: seededRandom(5),
    })

    expect(gaps.every(gap => gap >= 3000 && gap <= 4000)).toBe(true)
  })

  it('长停顿也受上限夹住，不会超过配置的上限', () => {
    const gaps = speechGaps(PARTS, {
      tuning: { minGapMs: 1000, maxGapMs: 1200, longGapProbability: 1, longGapMinMs: 5000, longGapMaxMs: 6000 },
      random: seededRandom(9),
    })

    expect(gaps.every(gap => gap >= 1000 && gap <= 1200)).toBe(true)
  })

  it('概率为零时不会冒长停顿', () => {
    const gaps = speechGaps(PARTS, {
      tuning: { longGapProbability: 0 },
      random: seededRandom(13),
    })

    expect(gaps.every(gap => gap <= PACING_DEFAULTS.maxGapMs)).toBe(true)
  })

  it('一条话没有间隔，种子给了也不给空数组添数', () => {
    expect(speechGaps(['在的'], { random: seededRandom(4) })).toEqual([])
  })
})

describe('整段话拆开再配间隔', () => {
  it('种子固定以后整份计划每次都一样', () => {
    const body = '第一句。第二句。第三句。第四句。'

    // 随机源是有状态的，同一颗种子要重新取一次实例
    const once = splitSpeech(body, { maxParts: 4, gaps: { random: seededRandom(21) } })
    const twice = splitSpeech(body, { maxParts: 4, gaps: { random: seededRandom(21) } })

    expect(twice.parts).toEqual(once.parts)
    expect(twice.gapsMs).toEqual(once.gapsMs)
    expect(once.gapsMs).toHaveLength(once.parts.length - 1)
  })

  it('整份计划里的间隔也都落在区间内', () => {
    const planned = splitSpeech('第一句。第二句。第三句。第四句。', { maxParts: 4 })

    expect(planned.gapsMs.every(gap => gap >= PACING_DEFAULTS.minGapMs)).toBe(true)
    expect(planned.gapsMs.every(gap => gap <= PACING_DEFAULTS.maxGapMs)).toBe(true)
  })

  it('拆开的几条拼起来仍是原文', () => {
    const body = `看${LONG_URL}和😀😀再说两句。还有别的。`
    const planned = splitSpeech(body, { maxParts: 8, gaps: { random: seededRandom(31) } })

    expect(flat(planned.parts.join(''))).toBe(flat(body))
    expect(planned.parts.every(wellFormed)).toBe(true)
  })
})
