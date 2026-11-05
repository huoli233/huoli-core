import { describe, expect, it } from 'vitest'
import { splitByBudget } from '../src/plan.ts'

const BUDGET = { maxParts: 8, maxCharsPerPart: 40 }

describe('切句按停止判据收口', () => {
  it('不给判据时按上限切完', () => {
    const parts = splitByBudget('第一句。第二句。第三句。', BUDGET)

    expect(parts.length).toBe(3)
  })

  it('说到第二条就该停时，只留两条', () => {
    const parts = splitByBudget('第一句。第二句。第三句。', { ...BUDGET, stop: index => index >= 2 })

    expect(parts).toEqual(['第一句。', '第二句。'])
  })

  it('一开口就该停时，一条都不留', () => {
    const parts = splitByBudget('第一句。第二句。', { ...BUDGET, stop: () => true })

    expect(parts).toEqual([])
  })

  it('判据一直说不停就照上限走', () => {
    const parts = splitByBudget('第一句。第二句。第三句。', { ...BUDGET, stop: () => false })

    expect(parts.length).toBe(3)
  })
})
