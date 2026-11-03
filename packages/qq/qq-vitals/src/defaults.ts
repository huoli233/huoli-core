// 所有默认参数只在这里出现一次，别处一律从 Tuning 里取

import type { Baseline, VitalsState } from './types.ts'

/** 可被 Config 覆盖的参数集合 */
export interface Tuning {
  beatMs: number
  startDelayMs: number
  hoursCap: number
  minDriftHours: number
  baseline: Baseline
  intensity: number
  drinkCooldownMs: number
  drinkMemoryMs: number
  drinkThirstDrop: number
  drinkOsmolalityDrop: number
  drinkVolumeRise: number
  drinkAngiotensinDrop: number
  drinkQueueRise: number
  drinkDopamineGain: number
  drinkEndorphinGain: number
  fluidDwellMs: number
  reactCooldownMs: number
  praiseDopamineGain: number
  praiseOxytocinGain: number
  praiseEndorphinGain: number
  praiseCortisolDrop: number
  angerCortisolGain: number
  angerAdrenalineGain: number
  angerNoradrenalineGain: number
  angerSerotoninDrop: number
  angerVasopressinGain: number
  promptMaxChars: number
  labelThreshold: number
  labelCount: number
  nightDarkFrom: number
  nightDarkUntil: number
  nightRamp: number
  melatoninFrom: number
  melatoninUntil: number
  metabolicRate: number
}

/** 全仓唯一的默认值表 */
export const DEFAULTS: Tuning = {
  // 心跳节奏：启动后二十秒开始，之后每分钟一次
  beatMs: 60_000,
  startDelayMs: 20_000,
  hoursCap: 24,
  minDriftHours: 1 / 60,
  // 初始状态：各生理字段的起点
  baseline: {
    dopamine: 0.50,
    oxytocin: 0.45,
    cortisol: 0.20,
    serotonin: 0.65,
    noradrenaline: 0.45,
    crh: 0.15,
    acth: 0.15,
    adrenaline: 0.05,
    acetylcholine: 0.45,
    endorphin: 0.45,
    vasopressin: 0.30,
    melatonin: 0.0,
    ghrelin: 0.30,
    leptin: 0.55,
    glucose: 0.65,
    insulin: 0.12,
    glucagon: 0.10,
    hunger: 0.35,
    thirst: 0.25,
    osmolality: 0.35,
    blood_volume: 0.85,
    angiotensin: 0.10,
    fluid_queue: 0.0,
    adenosine: 0.20,
    core_temp: 36.6,
    fever: 0.0,
    cytokines: 0.0,
    pain: 0.0,
  },
  // 喝一杯水的写回量
  intensity: 0.6,
  drinkCooldownMs: 180_000,
  drinkMemoryMs: 1_200_000,
  drinkThirstDrop: 0.55,
  drinkOsmolalityDrop: 0.30,
  drinkVolumeRise: 0.18,
  drinkAngiotensinDrop: 0.25,
  drinkQueueRise: 0.55,
  drinkDopamineGain: 0.06,
  drinkEndorphinGain: 0.05,
  fluidDwellMs: 3_600_000,
  // 被夸与被凶的写回量
  reactCooldownMs: 300_000,
  praiseDopamineGain: 0.10,
  praiseOxytocinGain: 0.08,
  praiseEndorphinGain: 0.03,
  praiseCortisolDrop: 0.03,
  angerCortisolGain: 0.05,
  angerAdrenalineGain: 0.18,
  angerNoradrenalineGain: 0.15,
  angerSerotoninDrop: 0.10,
  angerVasopressinGain: 0.06,
  // 提示词与标签
  promptMaxChars: 300,
  labelThreshold: 0.40,
  labelCount: 3,
  // 昼夜与时段
  nightDarkFrom: 22,
  nightDarkUntil: 7,
  nightRamp: 2,
  melatoninFrom: 21,
  melatoninUntil: 7,
  metabolicRate: 1.0,
}

/** 落盘时按数值读回来的字段 */
export const NUMERIC_FIELDS: readonly (keyof Baseline)[] = [
  'dopamine', 'oxytocin', 'cortisol', 'serotonin', 'noradrenaline',
  'crh', 'acth', 'adrenaline', 'acetylcholine', 'endorphin', 'vasopressin', 'melatonin',
  'ghrelin', 'leptin', 'glucose', 'insulin', 'glucagon', 'hunger', 'thirst',
  'osmolality', 'blood_volume', 'angiotensin', 'fluid_queue',
  'adenosine', 'core_temp', 'fever', 'cytokines', 'pain',
]

/** 派生上也要落盘的数值字段 */
export const DERIVED_FIELDS = ['energy', 'valence', 'irritability', 'clinginess', 'loneliness', 'dominance'] as const

/** 落盘时按时间戳读回来的字段 */
export const STAMP_FIELDS = [
  'last_update', 'last_msg', 'last_meal', 'last_drink', 'last_drink_at', 'last_taste_at',
  'drink_mem_at', 'fluid_applied_at', 'praise_applied_at', 'anger_applied_at',
] as const

/**
 * 把配置里的覆盖项合到默认值上
 * @param override - 调用方给的覆盖项
 * @returns 合并后的参数
 */
export function resolveTuning(override?: Partial<Tuning>): Tuning {
  return override === undefined ? DEFAULTS : { ...DEFAULTS, ...override }
}

/**
 * 按默认值造一份初始状态
 * @param tuning - 参数
 * @param at - 当前毫秒时间戳
 * @returns 初始状态
 */
export function emptyState(tuning: Tuning, at: number): VitalsState {
  return {
    ...tuning.baseline,
    energy: 0.5,
    valence: 0.5,
    irritability: 0.0,
    clinginess: 0.0,
    loneliness: 0.0,
    dominance: 0.5,
    emotion_level: '平静',
    emotion_candidates: [],
    last_update: at,
    last_msg: at,
    last_meal: at,
    last_drink: 0,
    last_drink_at: 0,
    last_taste_at: 0,
    drink_mem_at: 0,
    fluid_applied_at: 0,
    praise_applied_at: 0,
    anger_applied_at: 0,
    last_drink_name: '',
    last_taste: null,
    last_user_text: '',
  }
}
