// 这一包管的那份身体状态：字段名给面板和提示词共用

/** 睡眠三态：醒着、睡着、刚醒还没缓过来的迷糊窗口 */
export type SleepState = 'awake' | 'sleeping' | 'waking'

/** 周期相位，空串表示这一份状态还没算过日期 */
export type CyclePhase = '' | 'menstrual' | 'follicular' | 'ovulation' | 'luteal' | 'premenstrual'

/** 初始值与漂移都要用到的数值字段，除体温外都是 0~1 */
export interface Baseline {
  /** 多巴胺，0~1，默认 0.50，给想要与动力定个中间起点 */
  dopamine: number
  /** 催产素，0~1，默认 0.45，决定一上来有多亲近 */
  oxytocin: number
  /** 皮质醇，0~1，默认 0.20，偏低表示初始没有压力 */
  cortisol: number
  /** 血清素，0~1，默认 0.65，给情绪稳定定个偏高的起点 */
  serotonin: number
  /** 去甲肾上腺素，0~1，默认 0.45，之后按时段基线漂移 */
  noradrenaline: number
  /** 促肾上腺皮质激素释放激素，0~1，默认 0.15，HPA 轴最上游的静息水平 */
  crh: number
  /** 促肾上腺皮质激素，0~1，默认 0.15，跟着 crh 慢半拍走 */
  acth: number
  /** 肾上腺素，0~1，默认 0.05，平时几乎不分泌 */
  adrenaline: number
  /** 乙酰胆碱，0~1，默认 0.45，副交感张力的起点 */
  acetylcholine: number
  /** 内啡肽，0~1，默认 0.45，舒适感的起点 */
  endorphin: number
  /** 血管加压素，0~1，默认 0.30，对应依恋与占有 */
  vasopressin: number
  /** 褪黑素，0~1，默认 0.0，白天醒着时不参与压低精力 */
  melatonin: number
  /** 胃饥饿素，0~1，默认 0.30，目前只随状态落盘与读回，不进入漂移计算 */
  ghrelin: number
  /** 瘦素，0~1，默认 0.55，饱腹信号，会抬高副交感目标 */
  leptin: number
  /** 血糖，0~1，默认 0.65，落在正常范围的偏上 */
  glucose: number
  /** 胰岛素，0~1，默认 0.12，血糖升高时朝上涨 */
  insulin: number
  /** 胰高血糖素，0~1，默认 0.10，血糖走低时朝上涨 */
  glucagon: number
  /** 饥饿，0~1，默认 0.35，之后按胃排空与三餐节律累积 */
  hunger: number
  /** 口渴，0~1，默认 0.25，之后只累积不回滑，靠喝水往下压 */
  thirst: number
  /** 血浆渗透压，0~1，默认 0.35，随失水上升 */
  osmolality: number
  /** 血容量，0~1，默认 0.85，随失水下降并驱动血管紧张素 */
  blood_volume: number
  /** 血管紧张素，0~1，默认 0.10，血容量不足时上来带动渴觉 */
  angiotensin: number
  /** 待排水队列，0~1，默认 0.0，初始没有积存，喝水后累积 */
  fluid_queue: number
  /** 腺苷即睡眠压力，0~1，默认 0.20，醒着越久越高 */
  adenosine: number
  /** 核心体温，摄氏度，默认 36.6，每拍按夜色与发热重算 */
  core_temp: number
  /** 发热程度，0~1，默认 0.0，表示不发烧 */
  fever: number
  /** 细胞因子，0~1，默认 0.0，无炎症时为零 */
  cytokines: number
  /** 疼痛，0~1，默认 0.0，不疼 */
  pain: number
  /** 雌激素，0~1，默认 0.35，之后按周期相位重算 */
  estrogen: number
  /** 孕激素，0~1，默认 0.20，之后按周期相位重算 */
  progesterone: number
  /** 痛经，0~1，默认 0.0，只在经期与前经期抬起来 */
  cramps: number
}

/** 最近一次尝到或喝到的东西 */
export interface TasteRecord {
  name: string
  desc: string
  feel: string
  preference: number
  emotion_label: string
  source: string
}

/** 唯一事实来源：别的包只读它，不另算一套 */
export interface VitalsState extends Baseline {
  energy: number
  valence: number
  irritability: number
  clinginess: number
  loneliness: number
  dominance: number
  /** 想开口的劲，零到一，只给模型参考，不替它决定要不要开口 */
  proactive_bias: number
  /** 想发动态的劲，零到一，只给分级判定用 */
  post_want: number
  emotion_level: string
  emotion_candidates: string[]
  /** 睡眠三态，睡着期间身体照常漂移，交互只剩被吵醒一种 */
  sleep_state: SleepState
  /** 睡着这一态的布尔投影，给只读这段状态的下游用，写的地方只有一处 */
  asleep: boolean
  /** 这一觉是夜睡还是午睡，醒着时为空串 */
  sleep_kind: '' | 'night' | 'nap'
  /** 预计醒来的毫秒时间戳，零表示没排期 */
  wake_after: number
  /** 迷糊窗口的截止毫秒时间戳，零表示不迷糊 */
  groggy_until: number
  /** 被消息吵醒的时刻，毫秒时间戳，零表示没被吵过 */
  woken_at: number
  /** 上次午睡开始的时刻，毫秒时间戳，用来判当天已经睡过 */
  nap_at: number
  /** 每月开经日，取自配置里的 cycleDom */
  cycle_dom: number
  /** 当前周期第几天，从开经日算起 */
  cycle_day: number
  /** 本月周期长度，随月份是 28~31 天 */
  cycle_len: number
  /** 当前相位，由开经日与今天的真实日期差算出 */
  cycle_phase: CyclePhase
  last_update: number
  last_msg: number
  last_meal: number
  last_drink: number
  last_drink_at: number
  last_taste_at: number
  drink_mem_at: number
  fluid_applied_at: number
  praise_applied_at: number
  anger_applied_at: number
  last_drink_name: string
  last_taste: TasteRecord | null
  last_user_text: string
}
