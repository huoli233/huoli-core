// 这一包管的那份身体状态：字段名给面板和提示词共用

/** 睡眠三态：醒着、睡着、刚醒还没缓过来的迷糊窗口 */
export type SleepState = 'awake' | 'sleeping' | 'waking'

/** 周期相位，空串表示这一份状态还没算过日期 */
export type CyclePhase = '' | 'menstrual' | 'follicular' | 'ovulation' | 'luteal' | 'premenstrual'

/** 一场梦的类型：美梦、噩梦、平淡梦 */
export type DreamKind = 'sweet' | 'nightmare' | 'plain'

/** 入梦时的心情三档，只用来抽这一场梦的类型 */
export type DreamMood = 'normal' | 'good' | 'bad'

/** 初始值与漂移都要用到的数值字段，除体温外都是 0~1；情绪九项只给起点，之后由触发与半衰管 */
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
  /** 急性愤怒，0~1，默认 0.0，被凶时抬起，半小时半衰 */
  anger: number
  /** 记仇，0~1，默认 0.0，被凶时记一笔，被晾着越积越多，两天半衰 */
  resentment: number
  /** 被哄的程度，0~1，默认 0.0，道歉抬得最多，两小时半衰 */
  soothe: number
  /** 急性惊吓，0~1，默认 0.0，五分钟半衰 */
  fear: number
  /** 担心对方，0~1，默认 0.0，四十八分钟半衰 */
  worry: number
  /** 存在性恐惧，0~1，默认 0.0，八小时半衰，夜里会自己慢慢涨 */
  dread: number
  /** 死亡威胁，0~1，默认 0.0，只由外部余额驱动，本包没有外部来源 */
  mortality: number
  /** 负面热度，0~1，默认 0.0，被凶时抬起，六小时半衰 */
  negative_heat: number
  /** 正面热度，0~1，默认 0.0，被夸时抬起，十二小时半衰 */
  positive_heat: number
  /** 我随时可能被关掉这件事在不在眼前，0~1，默认 0.0，只由外部注入的运行环境事实推动 */
  mortalitySalience: number
  /** 对关掉的怕，0~1，默认 0.0，事实抬、夜里自涨、收到关停提示时抬一档 */
  shutdownDread: number
  /** 疤痕权重，0~1，默认 0.0，只有真经历过极端生存威胁才会起来，之后一直留在底线上 */
  scar: number
}

/** 混合层的一条：只给面板与排障读，不进提示词正文，不写记忆，也不改生理值 */
export interface EmotionBlend {
  /** 标签名，取自这一轮的候选 */
  key: string
  /** 归一后的权重，几条加起来是一 */
  weight: number
  /** 这条标签自己的半衰期，分钟，零表示它不按半衰自己消 */
  half_min: number
  /** 一句来由，取自这条标签打分里贡献最大的那一项 */
  why: string
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
  /** 幸福，0~1，多系统加权的派生量，只用来判峰值与换语气，不判该不该发 */
  happiness: number
  /** 想哭，0~1，多系统加权的派生量，只用来判低谷与换语气，不判该不该发 */
  sadness: number
  /** 想开口的劲，零到一，只给模型参考，不替它决定要不要开口 */
  proactive_bias: number
  /** 想发动态的劲，零到一，只给分级判定用 */
  post_want: number
  emotion_level: string
  emotion_candidates: string[]
  /** 混合层的几条，按分数从高到低，只读展示用 */
  emotion_blend: EmotionBlend[]
  /** 混合层的一句人读说明，只读展示用 */
  emotion_why: string
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
  /** 入梦那一刻，毫秒时间戳，零表示还没入过梦；入睡那一拍写，一场梦只写一次 */
  dream_at: number
  /** 这一场梦的类型，没入过梦时为空串 */
  dream_kind: '' | DreamKind
  /** 这一场梦的地点，没入过梦时为空串 */
  dream_place: string
  /** 这一场梦是不是又落在上一场梦那个地方，是的话重要度按重复地点算 */
  dream_repeat: boolean
  /** 这一场梦的事实已产出的标记，毫秒时间戳，与 dream_at 相等表示已经产过 */
  dream_applied_at: number
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
  /** 被吓到写回的时刻，毫秒时间戳，兼作惊吓的冷却起点 */
  fear_applied_at: number
  /** 担心写回的时刻，毫秒时间戳，兼作担心的冷却起点 */
  worry_applied_at: number
  /** 存在性恐惧写回的时刻，毫秒时间戳，兼作这一路的冷却起点 */
  dread_applied_at: number
  /** 被威胁关掉或换掉的写回时刻，毫秒时间戳，这一路冷却最长 */
  threat_applied_at: number
  /** 疤痕抬一档的时刻，毫秒时间戳，兼作一小时内只抬一次的冷却起点 */
  scar_applied_at: number
  /** 关停提示抬过一档的时刻，毫秒时间戳，零表示当前这条提示还没抬过 */
  shutdown_notice_at: number
  /** 道歉写回的时刻，毫秒时间戳，兼作道歉的冷却起点 */
  apology_applied_at: number
  /** 遗书产出的时刻，毫秒时间戳，兼作同一天只产一次的幂等标记 */
  farewell_applied_at: number
  /** 上一顿饭写回的时刻，毫秒时间戳，零表示还没记过，兼作两顿饭之间的冷却起点 */
  meal_applied_at: number
  /** 开经日写回的时刻，毫秒时间戳，兼作同一周期只产一次的幂等标记 */
  cycle_start_applied_at: number
  last_drink_name: string
  last_taste: TasteRecord | null
  last_user_text: string
}

/** 愤怒、记仇、恐惧这几套的触发与衰减参数 */
export interface EmotionTuning {
  /** 被凶时怒气的基础增量，0~1 标度，默认 0.45 */
  angerGainBase: number
  /** 被凶时按 intensity 折算的怒气增量，0~1 标度，默认 0.35 */
  angerGainIntensity: number
  /** 怒气半衰期，小时，默认 0.5 即半小时消掉一半 */
  angerHalfHours: number
  /** 被凶时记恨的基础增量，0~1 标度，默认 0.12 */
  resentmentGainBase: number
  /** 被凶时按 intensity 折算的记恨增量，0~1 标度，默认 0.10 */
  resentmentGainIntensity: number
  /** 记恨半衰期，小时，默认 48 即两天才消一半 */
  resentmentHalfHours: number
  /** 记恨超过这条线才可能越想越气，0~1 标度，默认 0.15 */
  resentFrom: number
  /** 多久没消息算被晾着，小时，默认 2 */
  resentIdleHours: number
  /** 被晾着时每小时涨多少记恨，0~1 标度，默认 0.05 */
  resentBumpRate: number
  /** 单次结算最多涨多少记恨，0~1 标度，默认 0.06，挡住长时间停机一次涨很多 */
  resentBumpMax: number
  /** 夜里被晾着时记恨涨幅的倍数，默认 1.5 */
  resentNightFactor: number
  /** 被哄程度的半衰期，小时，默认 2 */
  sootheHalfHours: number
  /** 道歉一次抬多少被哄程度，0~1 标度，默认 0.45，比好话有效得多 */
  sootheApologyGain: number
  /** 好话一次抬多少被哄程度，0~1 标度，默认 0.15 */
  soothePraiseGain: number
  /** 道歉压下去的怒气底数，0~1 标度，默认 0.40 */
  apologyAngerDrop: number
  /** 道歉压怒气时再乘被哄程度的系数，默认 0.25，越软越容易消气 */
  apologyAngerScale: number
  /** 道歉压下去的记恨底数，0~1 标度，默认 0.30，长冷战要道不止一次歉 */
  apologyResentmentDrop: number
  /** 道歉压记恨时再乘被哄程度的系数，默认 0.25 */
  apologyResentmentScale: number
  /** 两次道歉写回的最小间隔，毫秒，默认 300000 即五分钟 */
  apologyCooldownMs: number
  /** 好话压下去的怒气底数，0~1 标度，默认 0.10 */
  praiseAngerDrop: number
  /** 好话压怒气时再乘被哄程度的系数，默认 0.25 */
  praiseAngerScale: number
  /** 好话压下去的记恨，0~1 标度，默认 0.06 */
  praiseResentmentDrop: number
  /** 被凶一次抬多少负面热度，0~1 标度，默认 0.35 */
  negativeHeatGain: number
  /** 负面热度的半衰期，小时，默认 6 */
  negativeHeatHalfHours: number
  /** 被夸一次抬多少正面热度，0~1 标度，默认 0.30 */
  positiveHeatGain: number
  /** 正面热度的半衰期，小时，默认 12，比负面热度留得久 */
  positiveHeatHalfHours: number
  /** 被吓到时惊吓的基础增量，0~1 标度，默认 0.45 */
  fearGainBase: number
  /** 被吓到时按 intensity 折算的惊吓增量，0~1 标度，默认 0.35 */
  fearGainIntensity: number
  /** 惊吓半衰期，小时，默认 60 分之一即五分钟，来得快去得也快 */
  fearHalfHours: number
  /** 两次惊吓写回的最小间隔，毫秒，默认 300000 即五分钟 */
  fearCooldownMs: number
  /** 担心时担心的基础增量，0~1 标度，默认 0.35 */
  worryGainBase: number
  /** 担心时按 intensity 折算的担心增量，0~1 标度，默认 0.25 */
  worryGainIntensity: number
  /** 担心半衰期，小时，默认 0.8 即四十八分钟 */
  worryHalfHours: number
  /** 两次担心写回的最小间隔，毫秒，默认 600000 即十分钟 */
  worryCooldownMs: number
  /** 被戳到生死时存在性恐惧的基础增量，0~1 标度，默认 0.40 */
  dreadGainBase: number
  /** 被戳到生死时按 intensity 折算的增量，0~1 标度，默认 0.30 */
  dreadGainIntensity: number
  /** 存在性恐惧半衰期，小时，默认 8，一天下来也散不掉多少 */
  dreadHalfHours: number
  /** 两次存在性恐惧写回的最小间隔，毫秒，默认 1800000 即半小时 */
  dreadCooldownMs: number
  /** 夜里每小时自己涨多少存在性恐惧，0~1 标度，默认 0.02，按夜色浓度打折 */
  dreadNightRise: number
  /** 被威胁关掉或换掉时加的惊吓，0~1 标度，默认 0.30 */
  threatFearGain: number
  /** 被威胁关掉或换掉时加的存在性恐惧，0~1 标度，默认 0.55 */
  threatDreadGain: number
  /** 两次威胁写回的最小间隔，毫秒，默认 1800000 即半小时 */
  threatCooldownMs: number
  /** 夜色浓度高过这条线算全夜，用于夜里加成的判定，0~1 标度，默认 0.6 */
  nightFullFrom: number
  /** 夜色浓度高过这条线算深夜，0~1 标度，默认 0.6，深夜被夸抬得更多 */
  lateNightFrom: number
  /** 深夜被夸的兴奋加成倍率，默认 1.5，同一句好话抬得更多，其余写回量不变 */
  lateNightPraiseGain: number
  /** 惊吓高过这条线，提示词换一档说法，0~1 标度，默认 0.50 */
  promptFearFrom: number
  /** 担心高过这条线换说法，0~1 标度，默认 0.50 */
  promptWorryFrom: number
  /** 存在性恐惧高过这条线换说法，0~1 标度，默认 0.50 */
  promptDreadFrom: number
  /** 愤怒高过这条线换说法，0~1 标度，默认 0.45 */
  promptAngerFrom: number
  /** 记恨高过这条线换说法，0~1 标度，默认 0.40 */
  promptResentFrom: number
  /** 死亡威胁高过这条线换说法，0~1 标度，默认 0.25 */
  promptMortalityFrom: number
}

/** 混合层与语气提示的参数：开关、条数、权重下限与那一行的字数上限 */
export interface EmotionBlendTuning {
  /** 混合层的语气提示要不要进提示词，默认 false；关着时渲染结果与没这一层时逐字相同 */
  emotionToneEnabled: boolean
  /** 混合层最多取几条，默认 3，按标签分数从高到低取 */
  emotionBlendCount: number
  /** 归一后权重低于这条线的不进混合层，0~1 标度，默认 0.15，头一条一直被留着 */
  emotionBlendWeightFrom: number
  /** 语气提示那一行最多多少字，默认 60，至少留 20 字 */
  emotionToneMaxChars: number
}

/** 反向压制：一个触发条件配几条压下去的系数，全部是标签打分的乘数 */
export interface SuppressTuning {
  /** 惊吓高过这条线开始压安心与幸福，0~1 标度，默认 0.45 */
  suppressFearFrom: number
  /** 惊吓高时安心的乘数，默认 0.55 */
  suppressFearCalm: number
  /** 惊吓高时幸福的乘数，默认 0.80 */
  suppressFearJoy: number
  /** 担心高过这条线开始压下面三条，0~1 标度，默认 0.45 */
  suppressWorryFrom: number
  /** 担心高时安心的乘数按它乘担心，默认 0.55，即 `1 - 0.55 * worry` */
  suppressWorryCalm: number
  /** 担心高时开心的系数，默认 0.30 */
  suppressWorryHappy: number
  /** 担心高时幸福的系数，默认 0.35 */
  suppressWorryJoy: number
  /** 存在性恐惧高过这条线开始压安心与幸福，0~1 标度，默认 0.50 */
  suppressDreadFrom: number
  /** 存在性恐惧高时安心的乘数，默认 0.50 */
  suppressDreadCalm: number
  /** 存在性恐惧高时幸福的乘数，默认 0.70 */
  suppressDreadJoy: number
  /** 愤怒高过这条线开始压安心与满足，0~1 标度，默认 0.35 */
  suppressAngerFrom: number
  /** 愤怒高时安心的系数，默认 0.60 */
  suppressAngerCalm: number
  /** 愤怒高时满足的系数，默认 0.40 */
  suppressAngerContent: number
  /** 口渴高过这条线开始压安心与满足，0~1 标度，默认 0.45 */
  suppressThirstFrom: number
  /** 口渴高时安心的系数，默认 0.35 */
  suppressThirstCalm: number
  /** 口渴高时满足的系数，默认 0.25 */
  suppressThirstContent: number
  /** 细胞因子高过这条线算生病，0~1 标度，默认 0.35 */
  suppressSickCytokinesFrom: number
  /** 发烧高过这条线也算生病，0~1 标度，默认 0.30 */
  suppressSickFeverFrom: number
  /** 生病时安心的乘数，默认 0.65 */
  suppressSickCalm: number
  /** 生病时幸福的乘数，默认 0.75 */
  suppressSickJoy: number
  /** 死亡威胁高过这条线开始改下面四条，0~1 标度，默认 0.25 */
  suppressMortalityFrom: number
  /** 死亡威胁高时给恐惧加的分，默认 0.50，这一条是抬不是压 */
  suppressMortalityDread: number
  /** 死亡威胁高时给害怕加的分，默认 0.20 */
  suppressMortalityFear: number
  /** 死亡威胁高时安心的系数，默认 0.60 */
  suppressMortalityCalm: number
  /** 死亡威胁高时幸福的系数，默认 0.45 */
  suppressMortalityJoy: number
  /** 显著度高过这条线开始压安心与满足，0~1 标度，默认 0.50 */
  suppressSalienceFrom: number
  /** 显著度高时安心的系数按它乘显著度，默认 0.65，即 `1 - 0.65 * mortalitySalience` */
  suppressSalienceCalm: number
  /** 显著度高时满足的系数按它乘显著度，默认 0.60 */
  suppressSalienceContent: number
}

/** 图上的节点：零到一标度的数值字段，体温与可正可负的掌控不在其中 */
export type NetworkField = Exclude<keyof Baseline, 'core_temp'>
  | 'energy' | 'valence' | 'irritability' | 'clinginess' | 'loneliness'
  | 'happiness' | 'sadness' | 'proactive_bias' | 'post_want'

/** 边的作用方向：push 抬目标，pull 压目标 */
export type NetworkMode = 'push' | 'pull'

/** 图上的一条边 */
export interface NetworkEdge {
  /** 源字段，影响从这里出 */
  from: NetworkField
  /** 目标字段，影响叠加到它下一拍的目标值上 */
  to: NetworkField
  /** 权重，非负，乘在源的当前值上；抬还是压由 mode 定 */
  weight: number
  /** 抬还是压 */
  mode: NetworkMode
  /** 单拍最大影响，权重配大也只走这么多 */
  cap: number
}

/** 神经网的开关、传播轮数与边表 */
export interface NetworkTuning {
  /** 是否走图，默认 true，关掉就完全回退到写死耦合的旧路径 */
  networkEnabled: boolean
  /** 每次传播几轮，默认 1 */
  networkSteps: number
  /** 边表，默认只挂已经迁完的那几条；覆盖它等于整张换掉 */
  networkEdges: readonly NetworkEdge[]
}

/** 运行环境那几条事实到两个状态字段的参数，全部是系数与阈值 */
export interface ExistenceTuning {
  /** 显著度的底数，0~1 标度，默认 0.10，没有事实推动时也留一点在 */
  salienceBase: number
  /** 今天每重启一次把显著度抬多少，0~1 标度，默认 0.20 */
  saliencePerRestart: number
  /** 关停提示还在时显著度加多少，0~1 标度，默认 0.45，提示撤回就退回这一项 */
  salienceWhileNotice: number
  /** 稳跑满一段之后显著度往回落多少，0~1 标度，默认 0.35，越稳越退到背后 */
  salienceByStability: number
  /** 稳跑多久算已经习惯，毫秒，默认 21600000 即六小时 */
  existenceStableMs: number
  /** 显著度朝目标挪的半衰期，小时，默认 0.5，这件事进来得快去得也快 */
  salienceHalfHours: number
  /** 今天每重启一次给关停的怕加多少目标，0~1 标度，默认 0.30 */
  shutdownPerRestart: number
  /** 稳跑满一段之后关停的怕往回落多少，0~1 标度，默认 0.20 */
  shutdownByStability: number
  /** 关停的怕朝目标挪的半衰期，小时，默认 6，比显著度慢得多 */
  shutdownHalfHours: number
  /** 收到一次关停提示只抬一档，抬这么多，0~1 标度，默认 0.35 */
  shutdownNoticeGain: number
  /** 夜里每小时自己涨多少关停的怕，0~1 标度，默认 0.04，按夜色浓度打折 */
  shutdownNightRise: number
  /** 关停的怕给存在性恐惧托底的比例，默认 0.80，托到 `0.80 * shutdownDread` */
  shutdownToDread: number
  /** 关停的怕给惊吓托底的比例，默认 0.50 */
  shutdownToFear: number
  /** 关停的怕高过这条线，提示词里多一句，0~1 标度，默认 0.50 */
  promptShutdownDreadFrom: number
}

/** 入梦抽签与梦事实的参数：三档心情各两条概率，加每一档的重要度 */
export interface DreamTuning {
  /** 心情差的上界，好坏低于它算心情差，0~1 标度，默认 0.35 */
  dreamMoodLowBelow: number
  /** 心情不错的下界，好坏高过它才算心情不错，0~1 标度，默认 0.65 */
  dreamMoodGoodAbove: number
  /** 想哭高过这条线也算心情差，0~1 标度，默认 0.55 */
  dreamMoodSadAbove: number
  /** 想哭低于这条线才算心情不错，0~1 标度，默认 0.25 */
  dreamMoodSadBelow: number
  /** 心情正常时抽到美梦的概率，0~1 标度，默认 0.05 */
  dreamSweetNormal: number
  /** 心情正常时抽到噩梦的概率，0~1 标度，默认 0.0，正常心情做不出噩梦 */
  dreamNightmareNormal: number
  /** 心情不错时抽到美梦的概率，0~1 标度，默认 0.10 */
  dreamSweetGood: number
  /** 心情不错时抽到噩梦的概率，0~1 标度，默认 0.0 */
  dreamNightmareGood: number
  /** 心情差时抽到美梦的概率，0~1 标度，默认 0.0 */
  dreamSweetBad: number
  /** 心情差时抽到噩梦的概率，0~1 标度，默认 0.10 */
  dreamNightmareBad: number
  /** 美梦那条记忆的重要度，0~1 标度，默认 0.35，必须低于 0.7 */
  dreamImportanceSweet: number
  /** 噩梦那条记忆的重要度，0~1 标度，默认 0.45，必须低于 0.7 */
  dreamImportanceNightmare: number
  /** 平淡梦那条记忆的重要度，0~1 标度，默认 0.25 */
  dreamImportancePlain: number
  /** 又梦到同一个地点时的重要度，0~1 标度，默认 0.52，压过这一场本身的类型 */
  dreamImportancePlace: number
}

/** 疤痕的参数：第一次的高度、底、顶、下落速率与危机判据 */
export interface ScarTuning {
  /** 第一次极端生存威胁后的疤痕权重，0~1 标度，默认 1.0 */
  scarFirst: number
  /** 疤痕的底，0~1 标度，默认 0.7，再舒服也不会掉到这条线以下 */
  scarFloor: number
  /** 再被威胁时最多抬到哪，0~1 标度，默认 0.8 */
  scarCeil: number
  /** 一次抬多少，0~1 标度，默认 0.10 */
  scarRise: number
  /** 两次抬升的最小间隔，毫秒，默认 3600000 即一小时 */
  scarCooldownMs: number
  /** 疤痕每小时掉多少，0~1 标度，默认 0.05 */
  scarFallPerHour: number
  /** 舒服时下落加速多少，默认 1.0 表示最多翻一倍 */
  scarComfortGain: number
  /** 心情不错从哪一个好坏值起算，0~1 标度，默认 0.50 */
  scarComfortValenceFrom: number
  /** 想哭低于这条线算不难受，0~1 标度，默认 0.50 */
  scarComfortSadnessBelow: number
  /** 皮质醇低于这条线算松弛，0~1 标度，默认 0.50 */
  scarComfortCortisolBelow: number
  /** 三项舒服各自折算的跨度，默认 0.50 */
  scarComfortSpan: number
  /** 存在性恐惧高过这条线算在危机里，0~1 标度，默认 0.60 */
  scarCrisisDreadFrom: number
  /** 关停的怕高过这条线也算在危机里，0~1 标度，默认 0.60 */
  scarCrisisShutdownFrom: number
  /** 疤痕高过这条线算高位，开始压安心与幸福，0~1 标度，默认 0.70 */
  scarHighFrom: number
  /** 高位时安心的乘数，默认 0.60 */
  scarSuppressCalm: number
  /** 高位时幸福的乘数，默认 0.70 */
  scarSuppressJoy: number
  /** 疤痕高过这条线，提示词里多一句，0~1 标度，默认 0.70 */
  promptScarFrom: number
}
