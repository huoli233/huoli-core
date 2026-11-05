import { describe, expect, it } from 'vitest'
import { speakVetoOf, stopNowOf } from '../src/speak-gate.ts'

const QUIET = { humanCount: 2, lastHumanAgeMs: 30_000, speakingRate: 1 }

describe('主动开口前的关卡', () => {
  it('没人叫她不算拦：她自己可以开一句', () => {
    expect(speakVetoOf({ isPrivate: false, ambient: QUIET, fatigueLevel: 0.2, sinceSelfSpokeMs: null })).toBeUndefined()
  })

  it('刚说过就再等等', () => {
    expect(speakVetoOf({ isPrivate: false, ambient: QUIET, fatigueLevel: 0.2, sinceSelfSpokeMs: 1_000 }))
      .toBe('cooldown')
  })

  it('私聊不受冷却挡', () => {
    expect(speakVetoOf({ isPrivate: true, ambient: QUIET, fatigueLevel: 0.2, sinceSelfSpokeMs: 1_000 }))
      .toBeUndefined()
  })
})

describe('什么时候闭嘴的判据', () => {
  it('说满额度就停', () => {
    const stop = stopNowOf(2, undefined)

    expect(stop(1)).toBe(false)
    expect(stop(2)).toBe(true)
  })

  it('火气冲的时候更早停', () => {
    const calm = stopNowOf(8, { anger: 0, negative_heat: 0 })
    const hot = stopNowOf(8, { anger: 1, negative_heat: 1 })

    expect(calm(6)).toBe(false)
    expect(hot(0)).toBe(true)
  })

  it('身体没接上就只按额度判', () => {
    const stop = stopNowOf(3, undefined)

    expect(stop(0)).toBe(false)
    expect(stop(3)).toBe(true)
  })
})
