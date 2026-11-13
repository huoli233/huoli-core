// 情绪档位：把身体读出的情绪换成一份事实，抬多少、要不要抬都由配置定，不替模型下结论

import type { AttentionEmotion } from '@huoli/huoli-qq-attention'
import type { RememberOptions } from '@huoli/huoli-qq-memory'
import type { VitalsState } from '@huoli/huoli-qq-vitals'

/** 档位最平常时的那句说法 */
const CALM_LABEL = '平静'

/** 这一层认下的门槛，缺了哪项都按这里的默认值 */
export const EMOTION_DEFAULTS = {
  /** 总开关，关掉两条回路都回到原样 */
  enabled: true,
  /** 写记忆时按档位抬重要度 */
  memoryLift: true,
  /** 把当前档位写进注意力事实 */
  attentionFact: true,
  /** 峰值档从这条线起，0~1 标度 */
  peakFrom: 0.8,
  /** 偏高从这条线起 */
  highFrom: 0.55,
  /** 轻微从这条线起 */
  mildFrom: 0.3,
  /** 峰值档抬多少分重要度 */
  peakLift: 4,
  /** 偏高抬多少 */
  highLift: 3,
  /** 轻微抬多少 */
  mildLift: 1,
  /** 另外还过线的每一项再加多少 */
  mixBonus: 1,
  /** 一次最多抬多少 */
  maxLift: 8,
} as const

/** 配置里能改的那几项 */
export interface EmotionSettingsInput {
  /** 情绪这一层要不要生效，关掉两条回路都回到原样 */
  enabled?: boolean
  /** 情绪分数要不要抬记忆的基础重要度 */
  memoryLift?: boolean
  /** 要不要把当前情绪档位写进注意力那段事实 */
  attentionFact?: boolean
  /** 读数到这条线算峰值档，零到一 */
  peakFrom?: number
  /** 读数到这条线算偏高档 */
  highFrom?: number
  /** 读数到这条线算轻微档 */
  mildFrom?: number
  /** 峰值档给记忆抬几分 */
  peakLift?: number
  /** 偏高档抬几分 */
  highLift?: number
  /** 轻微档抬几分 */
  mildLift?: number
  /** 同时有几项过线时，每多一项再加几分 */
  mixBonus?: number
  /** 一次最多抬几分，也是情绪分上限 */
  maxLift?: number
}

/** 认下来的那一份门槛，所有项都齐 */
export interface EmotionSettings {
  enabled: boolean
  memoryLift: boolean
  attentionFact: boolean
  peakFrom: number
  highFrom: number
  mildFrom: number
  peakLift: number
  highLift: number
  mildLift: number
  mixBonus: number
  maxLift: number
}

/** 能当情绪档位的读数 */
export type EmotionReadingKey =
  | 'happiness'
  | 'irritability'
  | 'anger'
  | 'resentment'
  | 'sadness'
  | 'cortisol'
  | 'loneliness'
  | 'fear'
  | 'worry'
  | 'dread'

/** 档位名 */
export type EmotionTierName = 'peak' | 'high' | 'mild' | 'calm'

/** 这一会儿的情绪档位 */
export interface EmotionTier {
  tier: EmotionTierName
  /** 最热那一项的中文说法 */
  label: string
  /** 最热那一项的读数，两位小数 */
  value: number
  /** 从中性点折算出来的强度，零到一 */
  strength: number
  /** 过了轻微线的读数有几项 */
  hot: number
  /** 这一档给记忆抬多少分 */
  lift: number
}

/** 写记忆时要带的那一份情绪取值 */
export interface EmotionalDefault {
  /** 交给记忆包的情绪分，零到二十四 */
  emotional: number
  /** 这次抬了多少分重要度 */
  lift: number
  /** 这个数是模型自己给的，还是档位给的 */
  source: 'explicit' | 'tier' | 'none'
}

/** 一项情绪读数：中性点以上离得越远，强度越大 */
interface EmotionReading {
  key: EmotionReadingKey
  label: string
  /** 这一项在中性时的读数，正向情绪不是零 */
  neutral: number
}

/** 只看情绪与应激，社交饥渴与身体那几项另有自己的事实 */
const EMOTION_READINGS: readonly EmotionReading[] = [
  { key: 'happiness', label: '心情不错', neutral: 0.5 },
  { key: 'irritability', label: '有点上火', neutral: 0 },
  { key: 'anger', label: '在生气', neutral: 0 },
  { key: 'resentment', label: '心里记着事', neutral: 0 },
  { key: 'sadness', label: '情绪低', neutral: 0 },
  { key: 'cortisol', label: '绷得有点紧', neutral: 0 },
  { key: 'fear', label: '有点怕', neutral: 0 },
  { key: 'worry', label: '惦记着事', neutral: 0 },
  { key: 'dread', label: '心里发慌', neutral: 0 },
]

/** 把配置认成一份齐全的门槛，写坏的数按默认那一档 */
export function resolveEmotionSettings(input?: EmotionSettingsInput): EmotionSettings {
  const base = EMOTION_DEFAULTS
  const given = input ?? {}
  const peakFrom = clamp01(given.peakFrom, base.peakFrom)
  const highFrom = Math.min(peakFrom, clamp01(given.highFrom, base.highFrom))
  return {
    enabled: given.enabled !== false,
    memoryLift: given.memoryLift !== false,
    attentionFact: given.attentionFact !== false,
    peakFrom,
    highFrom,
    mildFrom: Math.min(highFrom, clamp01(given.mildFrom, base.mildFrom)),
    peakLift: liftOf(given.peakLift, base.peakLift),
    highLift: liftOf(given.highLift, base.highLift),
    mildLift: liftOf(given.mildLift, base.mildLift),
    mixBonus: liftOf(given.mixBonus, base.mixBonus),
    maxLift: liftOf(given.maxLift, base.maxLift),
  }
}

/**
 * 这一会儿的情绪档位，最热的一项是哪一项、有多重、该抬多少
 * @param body - 身体那一份状态，没接上时为空
 * @param settings - 认下来的门槛
 * @returns 档位事实，平常时是平静那一档
 */
export function emotionTierOf(body: Partial<VitalsState> | undefined, settings: EmotionSettings): EmotionTier {
  const calm: EmotionTier = { tier: 'calm', label: CALM_LABEL, value: 0, strength: 0, hot: 0, lift: 0 }
  if (!settings.enabled || body === undefined) return calm
  let top: { reading: EmotionReading; value: number; strength: number } | undefined
  let hot = 0
  for (const reading of EMOTION_READINGS) {
    const value = body[reading.key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const strength = reading.neutral <= 0
      ? clamp01(value, 0)
      : clamp01((value - reading.neutral) / (1 - reading.neutral), 0)
    if (strength < settings.mildFrom) continue
    hot += 1
    if (top === undefined || strength > top.strength) top = { reading, value, strength }
  }
  if (top === undefined) return calm
  const tier: EmotionTierName = top.strength >= settings.peakFrom
    ? 'peak'
    : top.strength >= settings.highFrom ? 'high' : 'mild'
  const baseLift = tier === 'peak' ? settings.peakLift : tier === 'high' ? settings.highLift : settings.mildLift
  const lift = Math.max(0, Math.min(settings.maxLift, baseLift + settings.mixBonus * (hot - 1)))
  return {
    tier,
    label: top.reading.label,
    value: round2(top.value),
    strength: round2(top.strength),
    hot,
    lift,
  }
}

/**
 * 写记忆时要带上的情绪分：模型自己给过就用模型的，没给才按档位
 * @param input - 身体、门槛与模型给的那一项
 * @returns 情绪分与这次抬了多少
 */
export function memoryEmotionOf(input: {
  body: Partial<VitalsState> | undefined
  settings: EmotionSettings
  explicit?: number
}): EmotionalDefault {
  const explicit = input.explicit
  if (explicit !== undefined && Number.isFinite(explicit)) {
    return { emotional: Math.max(0, Math.min(24, explicit)), lift: 0, source: 'explicit' }
  }
  if (!input.settings.enabled || !input.settings.memoryLift) return { emotional: 0, lift: 0, source: 'none' }
  const tier = emotionTierOf(input.body, input.settings)
  return tier.lift <= 0 ? { emotional: 0, lift: 0, source: 'none' } : { emotional: tier.lift, lift: tier.lift, source: 'tier' }
}

/**
 * 把情绪默认值并进一条记忆选项：调用方给了重要度就在它上面加，情绪分只在没人给时才补
 * @param options - 这一条记忆本来要给的选项
 * @param input - 身体读数与门槛
 * @returns 并过默认值的选项，调用方给过的项一项都不改
 */
export function withEmotionDefault(
  options: RememberOptions,
  input: { body: Partial<VitalsState> | undefined; settings: EmotionSettings },
): RememberOptions {
  const picked = memoryEmotionOf({
    body: input.body,
    settings: input.settings,
    ...options.emotional === undefined ? {} : { explicit: options.emotional },
  })
  const base = options.importance
  return {
    ...options,
    emotional: picked.emotional,
    ...base === undefined ? {} : { importance: Math.min(100, base + picked.lift) },
  }
}

/**
 * 注意力那一段要的情绪事实：关掉、或此刻就是平静时不给
 * @param body - 身体那一份状态
 * @param settings - 认下来的门槛
 * @returns 给注意力渲染用的档位，不给时为空
 */
export function attentionEmotionOf(
  body: Partial<VitalsState> | undefined,
  settings: EmotionSettings,
): AttentionEmotion | undefined {
  if (!settings.enabled || !settings.attentionFact) return undefined
  const tier = emotionTierOf(body, settings)
  return tier.tier === 'calm' ? undefined : { tier: tier.tier, label: tier.label }
}

/** 把读数夹在零到一之间，写坏了用默认那一档 */
function clamp01(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(1, value))
}

/** 抬升分写成整数，越界按边界算 */
function liftOf(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.round(value))
}

/** 只留两位小数 */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}
