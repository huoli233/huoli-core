import { describe, expect, it } from 'vitest'
import { DRIVE_NEEDS, isAgencyOutcome, isDriveNeed, toAgency, toDrive, toProject, toQuestion } from '../src/rows.ts'

describe('行判据', () => {
  it('需要名只认那四种', () => {
    expect(DRIVE_NEEDS).toEqual(['hunger', 'thirst', 'adenosine', 'energy'])
    expect(isDriveNeed('hunger')).toBe(true)
    expect(isDriveNeed('sleepiness')).toBe(false)
    expect(isDriveNeed(3)).toBe(false)
    expect(isDriveNeed('thirst', ['thirst'])).toBe(true)
  })

  it('收尾只认那三种', () => {
    expect(isAgencyOutcome('done')).toBe(true)
    expect(isAgencyOutcome('open')).toBe(false)
    expect(isAgencyOutcome(undefined)).toBe(false)
  })

  it('drive 缺字段就当没有', () => {
    expect(toDrive({ at: 1, id: 'a', need: 'hunger' }))
      .toEqual({ at: 1, id: 'a', kind: 'drive', need: 'hunger', did: '', resolved: false })
    expect(toDrive({ at: 1, id: 'a', need: 'hunger', did: '吃了半个面包', resolved: true }))
      .toEqual({ at: 1, id: 'a', kind: 'drive', need: 'hunger', did: '吃了半个面包', resolved: true })
    expect(toDrive({ id: 'a', need: 'hunger' })).toBeUndefined()
    expect(toDrive({ at: 1, need: 'hunger' })).toBeUndefined()
    expect(toDrive({ at: 1, id: 'a', need: 'sleepiness' })).toBeUndefined()
    expect(toDrive({ at: '刚才', id: 'a', need: 'thirst' })).toBeUndefined()
  })

  it('agency 缺字段就当没有', () => {
    expect(toAgency({ at: 2, id: 'b', outcome: 'failed' })).toEqual({
      at: 2,
      id: 'b',
      kind: 'agency',
      project_id: '',
      verbatim: '',
      because: '',
      fail_if: '',
      outcome: 'failed',
      artifact: '',
    })
    expect(toAgency({ at: 2, id: 'b', outcome: 'pending' })).toBeUndefined()
    expect(toAgency({ at: 2, outcome: 'done' })).toBeUndefined()
    expect(toAgency({ id: 'b', outcome: 'done' })).toBeUndefined()
  })

  it('项目缺字段就当没有', () => {
    expect(toProject({ at: 3, id: 'c', title: '记一句话', outcome: 'open' }))
      .toEqual({ at: 3, id: 'c', title: '记一句话', next: '', fail_if: '', outcome: 'open' })
    expect(toProject({ at: 3, id: 'c', outcome: 'open' })).toBeUndefined()
    expect(toProject({ at: 3, title: '记一句话', outcome: 'open' })).toBeUndefined()
    expect(toProject({ at: 3, id: 'c', title: '记一句话' })).toBeUndefined()
    expect(toProject({ at: 3, id: 'c', title: '记一句话', outcome: 7 })).toBeUndefined()
    expect(toProject({ at: 3, id: 'c', title: '记一句话', outcome: 'paused' })).toBeUndefined()
  })

  it('问句缺字段就当没有', () => {
    expect(toQuestion({ at: 4, id: 'd', text: '为什么夜里更想说话' }))
      .toEqual({ at: 4, id: 'd', text: '为什么夜里更想说话' })
    expect(toQuestion({ at: 4, id: 'd' })).toBeUndefined()
    expect(toQuestion({ at: 4, text: '为什么夜里更想说话' })).toBeUndefined()
    expect(toQuestion({ id: 'd', text: '为什么夜里更想说话' })).toBeUndefined()
  })
})
