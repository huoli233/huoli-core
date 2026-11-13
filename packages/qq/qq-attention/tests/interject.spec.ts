import { describe, expect, it } from 'vitest'
import { renderSpeakFacts, renderStopFacts, type SpeakFacts, type StopFacts } from '../src/interject.ts'

const QUIET: SpeakFacts = {
  directed: { at: false, poke: false, isPrivate: false, replyToBot: false },
  named: false,
  ambient: { humanCount: 2, speakerCount: 2, lastHumanAgeMs: 10 * 60_000, speakingRate: 3 },
  fatigueLevel: 0.4,
  sinceSelfSpokeMs: 5 * 60_000,
  talkativeness: 0.6,
  silenced: false,
}

const BASE: StopFacts = {
  spoken: 1,
  budget: 2,
  ignoredStreak: 1,
  tension: 0.3,
  silenced: false,
}

describe('插话现场只陈述事实', () => {
  it('不替模型给出该不该开口的结论', () => {
    const text = renderSpeakFacts(QUIET)

    expect(text).toContain('【插话现场】')
    expect(text).toContain('最近一段有 2 条真人发言，来自 2 个人')
    expect(text).toContain('decide_with_scene_and_own_judgment')
    expect(text).not.toContain('"speak"')
    expect(text).not.toContain('shouldSpeak')
  })

  it('结构化直呼与安静要求都写成可观察事实', () => {
    const text = renderSpeakFacts({
      ...QUIET,
      directed: { ...QUIET.directed, isPrivate: true, at: true },
      silenced: true,
    })

    expect(text).toContain('这是一对一的对话')
    expect(text).toContain('这几条在叫你')
    expect(text).toContain('对方明确表示要安静')
  })

  it('收尾现场只写这一轮说到哪了', () => {
    const text = renderStopFacts({ ...BASE, ignoredStreak: 2 })

    expect(text).toContain('【收尾现场】')
    expect(text).toContain('这一轮已经说了 1 条，上限是 2 条')
    expect(text).toContain('连着 2 条没等到人接')
    expect(text).toContain('decide_with_scene_and_own_judgment')
    expect(text).not.toContain('"stop"')
  })
})
