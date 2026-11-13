import { describe, expect, it } from 'vitest'
import { REPLY_DEFAULTS, replyBudget, replyRange, type ReplyFacts } from '../src/index.ts'

// 平常那一档：上限两条、下限一条
const PLAIN: ReplyFacts = { tired: 0.2, annoyed: 0.2, energy: 0.5, clingy: 0.3, lonely: 0.2 }

// 特别黏又孤独那一档：上限四条、下限三条
const CLINGY: ReplyFacts = { tired: 0.2, annoyed: 0.2, energy: 0.5, clingy: 0.9, lonely: 0.9 }

describe('条数硬规则：害怕与存在性恐惧', () => {
  it('惊吓过线把上限压到两条', () => {
    expect(replyBudget({ ...CLINGY, fear: 0.9 })).toBe(REPLY_DEFAULTS.fearCapMax)
  })

  it('存在性恐惧过线同样压到两条', () => {
    expect(replyBudget({ ...CLINGY, dread: 0.9 })).toBe(REPLY_DEFAULTS.fearCapMax)
  })

  it('没过线就不压', () => {
    expect(replyBudget({ ...CLINGY, fear: 0.2, dread: 0.2 })).toBe(REPLY_DEFAULTS.maxCap)
  })
})

describe('条数硬规则：担心', () => {
  it('担心过线把上限抬一条', () => {
    expect(replyBudget({ ...PLAIN, worry: 0.9 })).toBe(3)
  })

  it('抬过之后仍不超过上限', () => {
    expect(replyBudget({ ...CLINGY, worry: 0.9 })).toBe(REPLY_DEFAULTS.maxCap)
  })
})

describe('条数硬规则：愤怒与记恨', () => {
  it('在气头上先压到两条', () => {
    expect(replyBudget({ ...CLINGY, anger: 0.6 })).toBe(REPLY_DEFAULTS.angerCap)
  })

  it('气到顶只剩一句', () => {
    expect(replyBudget({ ...CLINGY, anger: 0.9 })).toBe(REPLY_DEFAULTS.oneMax)
  })

  it('记恨过线也只剩一句', () => {
    expect(replyBudget({ ...CLINGY, resentment: 0.9 })).toBe(REPLY_DEFAULTS.oneMax)
  })

  it('只剩一句时下限不会把上限顶回去', () => {
    const range = replyRange({ ...CLINGY, anger: 0.9 })

    expect(range.max).toBe(REPLY_DEFAULTS.oneMax)
    expect(range.min).toBe(REPLY_DEFAULTS.oneMax)
  })
})

describe('没接上的事实按零算', () => {
  it('不给惊吓与愤怒，读数与只给五项时一致', () => {
    expect(replyBudget(PLAIN)).toBe(replyBudget({ ...PLAIN, fear: 0, worry: 0, anger: 0, dread: 0, resentment: 0 }))
  })
})
