// 情绪档位：抬多少、什么时候不抬、谁说了算

import { describe, expect, it } from 'vitest'
import {
  attentionEmotionOf,
  EMOTION_DEFAULTS,
  emotionTierOf,
  memoryEmotionOf,
  resolveEmotionSettings,
  withEmotionDefault,
} from '../src/emotion-tier.ts'
import { BUNDLE_DEFAULTS } from '../src/index.ts'

const plain = resolveEmotionSettings()

describe('情绪档位怎么分', () => {
  it('什么都很平的时候是平静，一分都不抬', () => {
    const tier = emotionTierOf({ happiness: 0.5, irritability: 0.1, cortisol: 0.2 }, plain)

    expect(tier.tier).toBe('calm')
    expect(tier.label).toBe('平静')
    expect(tier.lift).toBe(0)
  })

  it('过偏高的线是偏高，抬三分', () => {
    const tier = emotionTierOf({ irritability: 0.6 }, plain)

    expect(tier.tier).toBe('high')
    expect(tier.label).toBe('有点上火')
    expect(tier.lift).toBe(EMOTION_DEFAULTS.highLift)
  })

  it('过峰值的线是峰值，抬四分', () => {
    const tier = emotionTierOf({ sadness: 0.85 }, plain)

    expect(tier.tier).toBe('peak')
    expect(tier.label).toBe('情绪低')
    expect(tier.lift).toBe(EMOTION_DEFAULTS.peakLift)
  })

  it('刚过轻微线只抬一分', () => {
    const tier = emotionTierOf({ cortisol: 0.35 }, plain)

    expect(tier.tier).toBe('mild')
    expect(tier.lift).toBe(EMOTION_DEFAULTS.mildLift)
  })

  it('几项一起过线就再加一点，但不超上限', () => {
    const tier = emotionTierOf({ sadness: 0.9, irritability: 0.9, cortisol: 0.9, fear: 0.9 }, plain)

    expect(tier.hot).toBe(4)
    expect(tier.lift).toBe(EMOTION_DEFAULTS.peakLift + 3 * EMOTION_DEFAULTS.mixBonus)
    expect(tier.lift).toBeLessThanOrEqual(EMOTION_DEFAULTS.maxLift)
  })

  it('正向情绪按中性点算，心情平常不算情绪', () => {
    expect(emotionTierOf({ happiness: 0.5 }, plain).tier).toBe('calm')
    expect(emotionTierOf({ happiness: 0.95 }, plain).tier).toBe('peak')
  })

  it('身体没接上时按平静算', () => {
    expect(emotionTierOf(undefined, plain).tier).toBe('calm')
  })
})

describe('写记忆时那份默认值', () => {
  it('没人给情绪分就按档位抬', () => {
    const picked = memoryEmotionOf({ body: { irritability: 0.8 }, settings: plain })

    expect(picked.source).toBe('tier')
    expect(picked.emotional).toBe(4)
    expect(picked.lift).toBe(4)
  })

  it('档位低就不抬，也不用补零以外的分', () => {
    const picked = memoryEmotionOf({ body: { irritability: 0.1 }, settings: plain })

    expect(picked.source).toBe('none')
    expect(picked.emotional).toBe(0)
    expect(picked.lift).toBe(0)
  })

  it('调用方自己给过情绪分就按它的，不再按档位抬', () => {
    const picked = memoryEmotionOf({ body: { irritability: 0.9 }, settings: plain, explicit: 7 })

    expect(picked.source).toBe('explicit')
    expect(picked.emotional).toBe(7)
    expect(picked.lift).toBe(0)
  })

  it('给的重了夹在零到二十四之间', () => {
    expect(memoryEmotionOf({ body: {}, settings: plain, explicit: 99 }).emotional).toBe(24)
    expect(memoryEmotionOf({ body: {}, settings: plain, explicit: -3 }).emotional).toBe(0)
  })

  it('并进记忆选项时只加在调用的重要度上，别的项一项不动', () => {
    const merged = withEmotionDefault(
      { layer: 'episodic', importance: 30, at: 1_700_000_000_000 },
      { body: { irritability: 0.8 }, settings: plain },
    )

    expect(merged.importance).toBe(34)
    expect(merged.emotional).toBe(4)
    expect(merged.layer).toBe('episodic')
    expect(merged.at).toBe(1_700_000_000_000)
  })

  it('调用方给过情绪分时重要度原样，不被抬', () => {
    const merged = withEmotionDefault(
      { importance: 30, emotional: 9 },
      { body: { irritability: 0.9 }, settings: plain },
    )

    expect(merged.importance).toBe(30)
    expect(merged.emotional).toBe(9)
  })

  it('重要度已经到顶就不再往上加', () => {
    const merged = withEmotionDefault({ importance: 99 }, { body: { sadness: 0.95 }, settings: plain })

    expect(merged.importance).toBe(100)
  })
})

describe('两条回路各自的开关', () => {
  it('总开关关掉，档位回到平静，两条回路都不给', () => {
    const off = resolveEmotionSettings({ enabled: false })
    const tier = emotionTierOf({ irritability: 0.9 }, off)

    expect(tier.tier).toBe('calm')
    expect(tier.lift).toBe(0)
    expect(memoryEmotionOf({ body: { irritability: 0.9 }, settings: off }).emotional).toBe(0)
    expect(attentionEmotionOf({ irritability: 0.9 }, off)).toBeUndefined()
  })

  it('只关记忆那一条时，注意力事实照给', () => {
    const settings = resolveEmotionSettings({ memoryLift: false })

    expect(memoryEmotionOf({ body: { irritability: 0.8 }, settings }).emotional).toBe(0)
    expect(attentionEmotionOf({ irritability: 0.8 }, settings)?.label).toBe('有点上火')
  })

  it('只关注意力那一条时，记忆照抬', () => {
    const settings = resolveEmotionSettings({ attentionFact: false })

    expect(memoryEmotionOf({ body: { irritability: 0.8 }, settings }).emotional).toBe(4)
    expect(attentionEmotionOf({ irritability: 0.8 }, settings)).toBeUndefined()
  })

  it('注意力只在真有情绪时给那一条', () => {
    expect(attentionEmotionOf({ irritability: 0.1 }, plain)).toBeUndefined()
    expect(attentionEmotionOf({ irritability: 0.7 }, plain)).toEqual({ tier: 'high', label: '有点上火' })
  })
})

describe('门槛配置', () => {
  it('不写就按默认那一档', () => {
    expect(resolveEmotionSettings()).toEqual({
      enabled: true,
      memoryLift: true,
      attentionFact: true,
      peakFrom: 0.8,
      highFrom: 0.55,
      mildFrom: 0.3,
      peakLift: 4,
      highLift: 3,
      mildLift: 1,
      mixBonus: 1,
      maxLift: 8,
    })
  })

  it('默认值表与代码里那份是同一处', () => {
    expect(BUNDLE_DEFAULTS.emotion).toBe(EMOTION_DEFAULTS)
  })

  it('写坏的线按默认收，几条线不会互相压过', () => {
    const settings = resolveEmotionSettings({ peakFrom: 0.4, highFrom: 0.9, mildFrom: 2 })

    expect(settings.peakFrom).toBe(0.4)
    expect(settings.highFrom).toBe(0.4)
    expect(settings.mildFrom).toBe(0.4)
  })

  it('抬升分写成整数，负数按零算', () => {
    const settings = resolveEmotionSettings({ peakLift: -3, mixBonus: 2.4 })

    expect(settings.peakLift).toBe(0)
    expect(settings.mixBonus).toBe(2)
  })

  it('改门槛就改抬升', () => {
    const settings = resolveEmotionSettings({ highLift: 6 })

    expect(emotionTierOf({ irritability: 0.6 }, settings).lift).toBe(6)
  })
})
