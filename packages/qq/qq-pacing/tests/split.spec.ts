import { describe, expect, it } from 'vitest'
import { PACING_DEFAULTS, speechGaps, splitByBudget, splitSpeech } from '../src/index.ts'

// 去掉空白再比，切分允许把断点旁边的空格吃掉
const flat = (text: string): string => text.replace(/\s+/gu, '')

describe('按上限切一段话', () => {
  it('短句不切', () => {
    expect(splitByBudget('在的', { maxParts: 4, maxCharsPerPart: 50 })).toEqual(['在的'])
  })

  it('优先一条时，不超过单条上限就整段不拆', () => {
    const body = '第一句。第二句。第三句。'
    const parts = splitByBudget(body, { maxParts: 4, maxCharsPerPart: 50, preferSingle: true })

    expect(parts).toEqual([body])
  })

  it('优先一条仍守住单条上限，太长才拆', () => {
    const body = '第一句。第二句。第三句。'
    const parts = splitByBudget(body, { maxParts: 4, maxCharsPerPart: 7, preferSingle: true })

    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every(part => part.length <= 7)).toBe(true)
  })

  it('空话切出来一条都没有', () => {
    expect(splitByBudget('   ', { maxParts: 4, maxCharsPerPart: 50 })).toEqual([])
  })

  it('长句在标点处切，每条不超单条上限', () => {
    const parts = splitByBudget('一二三四五，六七八九十。', { maxParts: 4, maxCharsPerPart: 6 })

    expect(parts).toEqual(['一二三四五，', '六七八九十。'])
    expect(parts.every(part => part.length <= 6)).toBe(true)
  })

  it('句末标点比逗号先断', () => {
    const parts = splitByBudget('一二，三四。五六', { maxParts: 4, maxCharsPerPart: 8 })

    expect(parts[0]).toBe('一二，三四。')
  })

  it('没有标点时按长度切且不丢字', () => {
    const body = '字'.repeat(25)

    const parts = splitByBudget(body, { maxParts: 8, maxCharsPerPart: 10 })

    expect(parts.every(part => part.length <= 10)).toBe(true)
    expect(parts.join('')).toBe(body)
  })

  it('同样输入两次切出来逐字一样', () => {
    const body = '今天下午看了个片子，里面有个镜头特别像我们楼下。然后就想起上次说的那件事。'
    const once = splitByBudget(body, { maxParts: 3, maxCharsPerPart: 12 })
    const twice = splitByBudget(body, { maxParts: 3, maxCharsPerPart: 12 })

    expect(twice).toEqual(once)
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })

  it('上限是一就整段一条', () => {
    const body = '第一句。第二句。第三句。'

    const parts = splitByBudget(body, { maxParts: 1, maxCharsPerPart: 4 })

    expect(parts).toEqual([body])
  })

  it('条数超过上限时并进前面几条，一个字都不丢', () => {
    const body = '第一句。第二句。第三句。第四句。'

    const parts = splitByBudget(body, { maxParts: 2, maxCharsPerPart: 500 })

    expect(parts).toHaveLength(2)
    expect(flat(parts.join(''))).toBe(flat(body))
  })

  it('单条上限压得很紧时超出上限的字数也不丢', () => {
    const body = '一二三四五六七八。九十。'

    const parts = splitByBudget(body, { maxParts: 2, maxCharsPerPart: 3 })

    expect(parts).toHaveLength(2)
    expect(flat(parts.join(''))).toBe(flat(body))
  })

  it('换行也算断点，切完不留空条', () => {
    const parts = splitByBudget('第一行\n第二行\n', { maxParts: 8, maxCharsPerPart: 50 })

    expect(parts).toEqual(['第一行', '第二行'])
  })
})

describe('条与条之间隔多久', () => {
  it('一条话没有间隔', () => {
    expect(speechGaps(['在的'])).toEqual([])
  })

  it('每条之间一个间隔，且都不短于下限', () => {
    const gaps = speechGaps(['在的', '好的', '嗯'])

    expect(gaps).toHaveLength(2)
    expect(gaps.every(gap => gap >= PACING_DEFAULTS.minGapMs)).toBe(true)
    expect(gaps.every(gap => gap <= PACING_DEFAULTS.maxGapMs)).toBe(true)
  })
})

describe('整段话拆开再配间隔', () => {
  it('上限收窄以后条数跟着收', () => {
    const body = '第一句。第二句。第三句。第四句。'

    expect(splitSpeech(body, { maxParts: 2 }).parts).toHaveLength(2)
    expect(splitSpeech(body, { maxParts: 1 }).parts).toHaveLength(1)
    expect(splitSpeech(body, { maxParts: 1 }).gapsMs).toEqual([])
  })
})
