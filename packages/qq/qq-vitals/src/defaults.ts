// 所有默认参数只在这里出现一次，别处一律从 Tuning 里取

import type { Baseline, VitalsState } from './types.ts'

/** 可被 Config 覆盖的参数集合 */
export interface Tuning {
  /** 心跳间隔，毫秒，默认 60000 表示每分钟结算一次漂移并写盘 */
  beatMs: number
  /** 装配后第一次心跳前的等待，毫秒，默认 20000 让插件先挂完再写盘 */
  startDelayMs: number
  /** 单次漂移最多补算多少小时，默认 24 小时，挡住长时间停机后一次算过头 */
  hoursCap: number
  /** 触发漂移所需的最小间隔，小时，默认 60 分之一即一分钟，更密的重复读取不再重算 */
  minDriftHours: number
  /** 初始身体状态，各字段是这份状态第一次落盘时的数值起点 */
  baseline: Baseline
  /** 喝水得到的多巴胺与内啡肽奖励倍率，默认 0.6 让一杯水的快感压不过被夸 */
  intensity: number
  /** 两次喝水写回的最小间隔，毫秒，默认 180000 即三分钟内重复说要水不再叠加 */
  drinkCooldownMs: number
  /** 喝水写进记忆的最小间隔，毫秒，默认 1200000 即二十分钟内连着喝只记一次 */
  drinkMemoryMs: number
  /** 喝一次水让口渴下降多少，0~1 标度，默认 0.55 表示一口能缓掉一半 */
  drinkThirstDrop: number
  /** 喝一次水让血浆渗透压下降多少，0~1 标度，默认 0.30 */
  drinkOsmolalityDrop: number
  /** 喝一次水让血容量回升多少，0~1 标度，默认 0.18 */
  drinkVolumeRise: number
  /** 喝一次水让血管紧张素下降多少，0~1 标度，默认 0.25，血量补回来后渴觉驱动随之减弱 */
  drinkAngiotensinDrop: number
  /** 喝一次水往待排水队列里加多少，0~1 标度，默认 0.55，停留够时长的下一拍才排空 */
  drinkQueueRise: number
  /** 喝水给多巴胺的基础增量，0~1 标度，默认 0.06，写回时还要再乘 intensity */
  drinkDopamineGain: number
  /** 喝水给内啡肽的基础增量，0~1 标度，默认 0.05，写回时还要再乘 intensity */
  drinkEndorphinGain: number
  /** 水待在体内多久才排掉，毫秒，默认 3600000 即一小时 */
  fluidDwellMs: number
  /** 被夸与被凶各自写回的最小间隔，毫秒，默认 300000 即五分钟，防止连发消息反复加成 */
  reactCooldownMs: number
  /** 被夸一次加多少多巴胺，0~1 标度，默认 0.10 */
  praiseDopamineGain: number
  /** 被夸一次加多少催产素，0~1 标度，默认 0.08 */
  praiseOxytocinGain: number
  /** 被夸一次加多少内啡肽，0~1 标度，默认 0.03 */
  praiseEndorphinGain: number
  /** 被夸一次减多少皮质醇，0~1 标度，默认 0.03 */
  praiseCortisolDrop: number
  /** 被凶一次加多少皮质醇，0~1 标度，默认 0.05 */
  angerCortisolGain: number
  /** 被凶一次加多少肾上腺素，0~1 标度，默认 0.18，让心跳与警觉立刻上来 */
  angerAdrenalineGain: number
  /** 被凶一次加多少去甲肾上腺素，0~1 标度，默认 0.15 */
  angerNoradrenalineGain: number
  /** 被凶一次减多少血清素，0~1 标度，默认 0.10 */
  angerSerotoninDrop: number
  /** 被凶一次加多少血管加压素，0~1 标度，默认 0.06，对应更强的占有与黏人 */
  angerVasopressinGain: number
  /** 每轮身体提示词的字数上限，默认 300，超出就截断且至少保留 60 字 */
  promptMaxChars: number
  /** 情绪标签入选的分数阈值，0~1 标度，默认 0.40，低于它的候选不写进提示词 */
  labelThreshold: number
  /** 每轮最多带几个情绪标签，默认 3，按分数从高到低取 */
  labelCount: number
  /** 夜色算全黑的起始钟点，本地小时 0~24，默认 22 点 */
  nightDarkFrom: number
  /** 夜色算全黑的结束钟点，本地小时 0~24，默认 7 点 */
  nightDarkUntil: number
  /** 全黑与白天之间爬上爬下的过渡时长，小时，默认 2 小时，夜色浓度按它线性过渡 */
  nightRamp: number
  /** 褪黑素跟随夜色的时间窗起始钟点，本地小时 0~24，默认 21 点 */
  melatoninFrom: number
  /** 该时间窗的结束钟点，本地小时 0~24，默认 7 点，窗外褪黑素朝零回落 */
  melatoninUntil: number
  /** 水分流失的代谢倍率，默认 1.0 为基准，参与计算时夹在 0.75 到 1.7 之间 */
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
