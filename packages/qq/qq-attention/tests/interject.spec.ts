import { describe, expect, it } from 'vitest'
import { INTERJECT_DEFAULTS, shouldSpeak, shouldStop, type SpeakFacts } from '../src/interject.ts'

const QUIET: SpeakFacts = {
  directed: { at: false, poke: false, isPrivate: false, replyToBot: false },
  named: false,
  ambient: { humanCount: 3, lastHumanAgeMs: 30_000, speakingRate: 1 },
  fatigueLevel: 0.3,
  sinceSelfSpokeMs: null,
  silenced: false,
}

describe('该不该插嘴', () => {
  it('人家要她别说时，什么都不做', () => {
    expect(shouldSpeak({ ...QUIET, silenced: true, directed: { ...QUIET.directed, at: true } }))
      .toEqual({ speak: false, why: 'silenced' })
  })

  it('私聊与点名都算对着她说', () => {
    expect(shouldSpeak({ ...QUIET, directed: { ...QUIET.directed, isPrivate: true } }).speak).toBe(true)
    expect(shouldSpeak({ ...QUIET, directed: { ...QUIET.directed, at: true } }).speak).toBe(true)
    expect(shouldSpeak({ ...QUIET, directed: { ...QUIET.directed, replyToBot: true } }).speak).toBe(true)
  })

  it('累到线以上不主动开口', () => {
    expect(shouldSpeak({ ...QUIET, fatigueLevel: 0.9 })).toEqual({ speak: false, why: 'tired' })
  })

  it('刚说过没多久就先歇着', () => {
    expect(shouldSpeak({ ...QUIET, sinceSelfSpokeMs: 1_000 })).toEqual({ speak: false, why: 'cooldown' })
  })

  it('场面太密就让给别人', () => {
    expect(shouldSpeak({ ...QUIET, ambient: { ...QUIET.ambient, speakingRate: 12 } }))
      .toEqual({ speak: false, why: 'crowded' })
  })

  it('冷场够久她可以自己开一句', () => {
    expect(shouldSpeak({ ...QUIET, ambient: { ...QUIET.ambient, lastHumanAgeMs: 20 * 60_000 } }))
      .toEqual({ speak: true, why: 'cold' })
  })

  it('没人理她又不是冷场，就不插嘴', () => {
    expect(shouldSpeak(QUIET)).toEqual({ speak: false, why: 'notAddressed' })
  })

  it('门槛改了判断跟着改', () => {
    const tuning = { ...INTERJECT_DEFAULTS, crowdedRate: 1 }

    expect(shouldSpeak({ ...QUIET, ambient: { ...QUIET.ambient, speakingRate: 2 } }, tuning))
      .toEqual({ speak: false, why: 'crowded' })
  })
})

describe('什么时候闭嘴', () => {
  const BASE = { spoken: 0, budget: 2, ignoredStreak: 0, tension: 0, silenced: false }

  it('说满这一轮的量就停', () => {
    expect(shouldStop({ ...BASE, spoken: 2 })).toEqual({ stop: true, why: 'budget' })
  })

  it('连着没人接就停', () => {
    expect(shouldStop({ ...BASE, ignoredStreak: 2 })).toEqual({ stop: true, why: 'ignored' })
  })

  it('场面紧了先停，不跟着对着吵', () => {
    expect(shouldStop({ ...BASE, tension: 0.8 })).toEqual({ stop: true, why: 'tense' })
  })

  it('人家要她停就立刻停', () => {
    expect(shouldStop({ ...BASE, silenced: true })).toEqual({ stop: true, why: 'silenced' })
  })

  it('还早着就继续', () => {
    expect(shouldStop(BASE)).toEqual({ stop: false })
  })
})
