// 参数表：每个可调项只有这里一个声明点，默认值在 defaults.ts

import type {
  Baseline, DreamTuning, EmotionBlendTuning, EmotionTuning, ExistenceTuning, NetworkTuning, ScarTuning,
  SuppressTuning,
} from './types.ts'

/** 可被 Config 覆盖的参数集合，`networkEdges` 覆盖时整张换掉 */
export interface Tuning extends EmotionTuning, SuppressTuning, ExistenceTuning, NetworkTuning, DreamTuning, ScarTuning,
  EmotionBlendTuning {
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
  /** 两顿饭写回的最小间隔，毫秒，默认 1800000 即半小时内再说吃也只算一顿 */
  mealCooldownMs: number
  /** 一顿饭填掉的饥饿，0~1 标度，默认 0.22 */
  feedHungerDrop: number
  /** 一顿饭压下去的胃饥饿素，0~1 标度，默认 0.28 */
  feedGhrelinDrop: number
  /** 一顿饭抬起来的瘦素，0~1 标度，默认 0.22 */
  feedLeptinRise: number
  /** 一顿饭抬起的血糖上限，0~1 标度，默认 0.26，写回时按饭前的饥饿打折 */
  feedGlucoseRise: number
  /** 一顿饭抬起的胰岛素，0~1 标度，默认 0.20，回落交给漂移的双向调节 */
  feedInsulinRise: number
  /** 想开口这一项的起步倍率，默认 1.0 表示不加不减，命中各档再逐条相乘 */
  proactiveBiasStart: number
  /** 想开口倍率的下限，默认 0.2，夹住之后再折成零到一的读数 */
  biasMin: number
  /** 想开口倍率的上限，默认 2.5 */
  biasMax: number
  /** 没力气时想开口的倍率，默认 1.8，越没劲越想找人说句话 */
  biasLowEnergy: number
  /** 精力低于这条线算没力气，0~1 标度，默认 0.35 */
  biasLowEnergyBelow: number
  /** 犯困时想开口的倍率，默认 1.7 */
  biasSleepy: number
  /** 褪黑素高于这条线算犯困，0~1 标度，默认 0.55 */
  biasSleepyAbove: number
  /** 想有人陪着时想开口的倍率，默认 0.62 */
  biasWantsCompany: number
  /** 孤独高于这条线算想有人陪，0~1 标度，默认 0.55 */
  biasLonelyAbove: number
  /** 黏人高于这条线也算想有人陪，0~1 标度，默认 0.62 */
  biasClingyAbove: number
  /** 心里有火时想开口的倍率，默认 0.88 */
  biasIrritable: number
  /** 易怒高于这条线算心里有火，0~1 标度，默认 0.60 */
  biasIrritableAbove: number
  /** 口渴时想开口的倍率，默认 0.80，先去找水而不是找人 */
  biasThirsty: number
  /** 口渴高于这条线算缺水，0~1 标度，默认 0.65 */
  biasThirstyAbove: number
  /** 生病时想开口的倍率，默认 1.50 */
  biasSick: number
  /** 细胞因子高于这条线算生病，0~1 标度，默认 0.40 */
  biasSickAbove: number
  /** 睡不够时想开口的倍率，默认 1.40 */
  biasExhausted: number
  /** 睡眠压力高于这条线算睡不够，0~1 标度，默认 0.70 */
  biasExhaustedAbove: number
  /** 想发动态的起步值，0~1 标度，默认 0.30 */
  postStart: number
  /** 心里有火时想发动态的倍率，默认 0.35，不想营业 */
  postDown: number
  /** 易怒高于这条线算不想营业，0~1 标度，默认 0.60 */
  postDownAbove: number
  /** 孤独时想发动态的倍率，默认 1.08，想让人看见 */
  postWants: number
  /** 孤独高于这条线算想让人看见，0~1 标度，默认 0.55 */
  postWantsAbove: number
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
  /** 代谢倍率的下限，默认 0.75，配错也不至于把失水压到没有 */
  metabolicRateMin: number
  /** 代谢倍率的上限，默认 1.7，配错也不至于一次失水失到脱力 */
  metabolicRateMax: number
  /** 夜睡从几点开始，本地小时 0~24，默认 23 点 */
  sleepFrom: number
  /** 夜睡到几点算天亮，本地小时 0~24，默认 7 点 */
  sleepUntil: number
  /** 睡眠压力高过这条线才睡得着，0~1 标度，默认 0.50 */
  sleepAdenosineFrom: number
  /** 夜睡该醒的钟点，本地小时 0~24，默认 7.5 即七点半 */
  wakeAt: number
  /** 该醒时刻前后抖动的分钟数，默认 40，让每天不完全一样 */
  wakeJitterMinutes: number
  /** 白天里睡眠压力低于这条线就自然醒，0~1 标度，默认 0.30 */
  wakeAdenosineBelow: number
  /** 白天最晚这个钟点必须醒，本地小时 0~24，默认 11 点 */
  wakeLatest: number
  /** 夜睡一小时掉多少睡眠压力，0~1 标度，默认 0.22 */
  sleepAdenosineDrop: number
  /** 夜睡醒后迷糊多久，分钟，默认 15 */
  groggyMinutes: number
  /** 午睡时段的起点，本地小时 0~24，默认 12 点 */
  napFrom: number
  /** 午睡时段的终点，本地小时 0~24，默认 15 点 */
  napUntil: number
  /** 睡眠压力高过这条线才可能睡午觉，0~1 标度，默认 0.22 */
  napAdenosineAbove: number
  /** 午睡时段里每分钟睡着的概率，0~1 标度，默认 0.03 */
  napChancePerMinute: number
  /** 午睡最短时长，分钟，默认 20 */
  napMinMinutes: number
  /** 午睡最长时长，分钟，默认 50 */
  napMaxMinutes: number
  /** 午睡一小时掉多少睡眠压力，0~1 标度，默认 0.35，短睡效率更高 */
  napAdenosineDrop: number
  /** 午睡醒后迷糊多久，分钟，默认 5 */
  napGroggyMinutes: number
  /** 被消息吵醒后还算刚醒多久，分钟，默认 15 */
  wokenWindowMinutes: number
  /** 每月开经日，默认 5 号；今天早于它就取上月的这一天 */
  cycleDom: number
  /** 经期最后一天，默认第 5 天 */
  cycleMenstrualEnd: number
  /** 卵泡期最后一天，默认第 12 天 */
  cycleFollicularEnd: number
  /** 排卵期最后一天，默认第 15 天 */
  cycleOvulationEnd: number
  /** 黄体期最后一天，默认第 23 天，之后到周期结束都算经前期 */
  cycleLutealEnd: number
  /** 经期的雌激素，0~1 标度，默认 0.18 */
  cycleEstrogenMenstrual: number
  /** 卵泡期起点的雌激素，0~1 标度，默认 0.25 */
  cycleEstrogenFollicularStart: number
  /** 卵泡期终点的雌激素，0~1 标度，默认 0.75 */
  cycleEstrogenFollicularEnd: number
  /** 排卵期的雌激素，0~1 标度，默认 0.86 */
  cycleEstrogenOvulation: number
  /** 黄体期的雌激素，0~1 标度，默认 0.62 */
  cycleEstrogenLuteal: number
  /** 经前期的雌激素，0~1 标度，默认 0.38 */
  cycleEstrogenPremenstrual: number
  /** 经期的孕激素，0~1 标度，默认 0.10 */
  cycleProgesteroneMenstrual: number
  /** 卵泡期的孕激素，0~1 标度，默认 0.10 */
  cycleProgesteroneFollicular: number
  /** 排卵期的孕激素，0~1 标度，默认 0.26 */
  cycleProgesteroneOvulation: number
  /** 黄体期起点的孕激素，0~1 标度，默认 0.25 */
  cycleProgesteroneLutealStart: number
  /** 黄体期终点的孕激素，0~1 标度，默认 0.70 */
  cycleProgesteroneLutealEnd: number
  /** 经前期的孕激素，0~1 标度，默认 0.55 */
  cycleProgesteronePremenstrual: number
  /** 经期第一天的痛经，0~1 标度，默认 0.75 */
  cycleCrampsStart: number
  /** 经期最后一天的痛经，0~1 标度，默认 0.15 */
  cycleCrampsEnd: number
  /** 经前期的痛经，0~1 标度，默认 0.05 */
  cycleCrampsPremenstrual: number
  /** 痛经对精力的扣减，默认 0.35 */
  energyCrampsPenalty: number
  /** 黄体期与经前期对精力的扣减，默认 0.06 */
  energyLutealPenalty: number
  /** 经期对好坏的扣减，默认 0.12 */
  valenceMenstrualPenalty: number
  /** 经前期对好坏的扣减，默认 0.10 */
  valencePremenstrualPenalty: number
  /** 卵泡期对好坏的加成，默认 0.06 */
  valenceFollicularGain: number
  /** 经前期对易怒的加成，默认 0.28 */
  irritabilityPremenstrualGain: number
  /** 经期对易怒的加成，默认 0.14 */
  irritabilityMenstrualGain: number
  /** 痛经对易怒的加成，默认 0.30 */
  irritabilityCrampsGain: number
  /** 细胞因子高过这条线，提示词里要说生病，0~1 标度，默认 0.35 */
  promptSickCytokinesFrom: number
  /** 发烧高过这条线也要说生病，0~1 标度，默认 0.30 */
  promptSickFeverFrom: number
  /** 睡眠压力高过这条线要说太困，0~1 标度，默认 0.65 */
  promptSleepyAdenosineFrom: number
  /** 褪黑素高过这条线也要说太困，0~1 标度，默认 0.55 */
  promptSleepyMelatoninFrom: number
  /** 离饭点还有多久算快开饭了，分钟，默认 30，只在提示词里多一句 */
  promptMealSoonMinutes: number
  // 递质回归：白天的半衰期、夜里的半衰期与各递质的回落目标
  /** 夜里回基线的半衰期，小时，默认 0.45，比白天快 */
  transmitterNightHalfHours: number
  /** 白天回基线的半衰期，小时，默认 0.75 */
  transmitterHalfHours: number
  /** 多巴胺的白天回落目标，0~1 标度，默认 0.50 */
  transmitterDopamineBase: number
  /** 夜色把多巴胺目标压下去多少，默认 0.16，按夜色浓度打折 */
  transmitterDopamineNightDrop: number
  /** 催产素的白天回落目标，0~1 标度，默认 0.45 */
  transmitterOxytocinBase: number
  /** 夜色把催产素目标抬起来多少，默认 0.04 */
  transmitterOxytocinNightRise: number
  /** 血清素的白天回落目标，0~1 标度，默认 0.65 */
  transmitterSerotoninBase: number
  /** 夜色把血清素目标压下去多少，默认 0.12 */
  transmitterSerotoninNightDrop: number
  /** 夜色把去甲肾上腺素目标压下去多少，默认 0.10 */
  transmitterNoradrenalineNightDrop: number
  // HPA 轴：负荷、负反馈、三段半衰与催产素缓冲
  /** 低血糖判据的基线，0~1 标度，默认 0.62，低于它算缺糖 */
  hpaGlucoseFloor: number
  /** 饥饿高过这条线才算给 HPA 加负荷，0~1 标度，默认 0.50 */
  hpaHungerFrom: number
  /** 高饥饿折成零到一的跨度，默认 0.50 */
  hpaHungerSpan: number
  /** 负荷里皮质醇的权重，默认 0.55 */
  hpaLoadCortisol: number
  /** 负荷里低血糖的权重，默认 0.25 */
  hpaLoadGlucose: number
  /** 负荷里高饥饿的权重，默认 0.20 */
  hpaLoadHunger: number
  /** 负反馈的强度，默认 0.70，皮质醇越高越压 crh */
  hpaFeedbackGain: number
  /** 负反馈开始起作用的皮质醇，0~1 标度，默认 0.55 */
  hpaFeedbackFrom: number
  /** 负反馈折算的跨度，默认 0.45 */
  hpaFeedbackSpan: number
  /** crh 的半衰期，小时，默认 0.15，最快的一段 */
  hpaCrhHalfHours: number
  /** acth 的半衰期，小时，默认 0.45 */
  hpaActhHalfHours: number
  /** 皮质醇的半衰期，小时，默认 1.20，最慢的一段 */
  hpaCortisolHalfHours: number
  /** 皮质醇目标的底数，0~1 标度，默认 0.15 */
  hpaCortisolBase: number
  /** acth 折算成皮质醇目标的系数，默认 0.80 */
  hpaCortisolActhGain: number
  /** 催产素缓冲的起点，0~1 标度，默认 0.40，低于它不缓冲 */
  hpaOxytocinBufferFrom: number
  /** 催产素缓冲折算的跨度，默认 0.60 */
  hpaOxytocinBufferSpan: number
  /** 催产素缓冲的力度，默认 0.35，最多把皮质醇目标压低这么多 */
  hpaOxytocinBufferGain: number
  // 交感与副交感
  /** 肾上腺素的底数，0~1 标度，默认 0.05 */
  adrenalineBase: number
  /** 负荷折算成肾上腺素目标的系数，默认 0.85 */
  adrenalineLoadGain: number
  /** 肾上腺素半衰期，小时，默认 0.06，来得急去得快 */
  adrenalineHalfHours: number
  /** 副交感的底数，0~1 标度，默认 0.22 */
  parasympatheticBase: number
  /** 肾上腺素把副交感压下去多少，默认 0.35 */
  parasympatheticAdrenalineGain: number
  /** 瘦素把副交感抬起来多少，默认 0.22；这条耦合已进 `networkEdges`，本字段只在关掉图时生效 */
  parasympatheticLeptinGain: number
  /** 夜色把副交感抬起来多少，默认 0.18 */
  parasympatheticNightGain: number
  /** 副交感半衰期，小时，默认 0.55 */
  parasympatheticHalfHours: number
  // 奖赏双系统
  /** 想要里多巴胺的权重，默认 0.70 */
  rewardWantDopamine: number
  /** 想要里催产素的权重，默认 0.30 */
  rewardWantOxytocin: number
  /** 想要里皮质醇的扣减，默认 0.25 */
  rewardWantCortisol: number
  /** 内啡肽目标的底数，0~1 标度，默认 0.20 */
  endorphinBase: number
  /** 想要折算成内啡肽目标的系数，默认 0.65 */
  endorphinWantGain: number
  /** 内啡肽半衰期，小时，默认 0.80 */
  endorphinHalfHours: number
  // 依恋双轴
  /** 血管加压素目标的底数，0~1 标度，默认 0.16 */
  vasopressinBase: number
  /** 黏人折算成血管加压素目标的系数，默认 0.58 */
  vasopressinClingyGain: number
  /** 皮质醇折算成血管加压素目标的系数，默认 0.35 */
  vasopressinCortisolGain: number
  /** 血浆渗透压高过这条线才给血管加压素加目标，0~1 标度，默认 0.40 */
  vasopressinOsmolalityFrom: number
  /** 渗透压折算成血管加压素目标的系数，默认 0.25 */
  vasopressinOsmolalityGain: number
  /** 血管加压素半衰期，小时，默认 1.5 */
  vasopressinHalfHours: number
  // 饥饿：胃排空速率与三餐、夜间、饱腹的折扣
  /** 胃排空的基础速率，0~1 标度每小时，默认 0.055 */
  hungerRate: number
  /** 距上次进食多久之内算刚吃过，小时，默认 1.5 */
  hungerRecentHours: number
  /** 刚吃过时饥饿速率的折扣，默认 0.35 */
  hungerRecentFactor: number
  /** 距上次进食多久之内算吃过不久，小时，默认 3.0 */
  hungerMiddleHours: number
  /** 吃过不久时饥饿速率的折扣，默认 0.70 */
  hungerMiddleFactor: number
  /** 距上次进食多久之后算久没吃，小时，默认 6.0 */
  hungerLongHours: number
  /** 久没吃时饥饿速率的倍数，默认 1.15 */
  hungerLongFactor: number
  /** 饭点这一小时饥饿速率的倍数，默认 1.30 */
  hungerMealHourFactor: number
  /** 饱腹折扣的下限，默认 0.25，再饱也不会完全停下 */
  hungerSatietyFloor: number
  /** 饱腹折算成折扣的系数，默认 0.75，即 `1 - 0.75 * hunger` */
  hungerSatietyGain: number
  /** 夜间饥饿速率的倍数，默认 0.25 */
  hungerQuietFactor: number
  // 水循环：失水速率、活动量加成与几个折算系数
  /** 活动量的基数，默认 1.0，静止时按它算 */
  waterActivityBase: number
  /** 去甲肾上腺素高过这条线算在活动，0~1 标度，默认 0.50 */
  waterActivityNoradrenalineFrom: number
  /** 活动量里去甲肾上腺素的权重，默认 0.25 */
  waterActivityNoradrenalineGain: number
  /** 肾上腺素高过这条线也算在活动，0~1 标度，默认 0.25 */
  waterActivityAdrenalineFrom: number
  /** 活动量里肾上腺素的权重，默认 0.15 */
  waterActivityAdrenalineGain: number
  /** 基础失水速率，0~1 标度每小时，默认 0.070 */
  waterLossRate: number
  /** 夜间失水速率的折扣，默认 0.30 */
  waterQuietFactor: number
  /** 失水折算成血浆渗透压上升的系数，默认 0.55 */
  waterOsmolalityGain: number
  /** 失水折算成血容量下降的系数，默认 0.40 */
  waterVolumeDrop: number
  /** 血管紧张素目标的底数，0~1 标度，默认 0.10 */
  angiotensinBase: number
  /** 血容量低于这条线才开始抬血管紧张素，0~1 标度，默认 0.85 */
  angiotensinVolumeFrom: number
  /** 血容量折算的跨度，默认 0.45 */
  angiotensinVolumeSpan: number
  /** 血容量缺口折算成血管紧张素目标的系数，默认 0.85 */
  angiotensinGain: number
  /** 血管紧张素半衰期，小时，默认 0.70 */
  angiotensinHalfHours: number
  /** 失水折算成口渴上升的系数，默认 0.60 */
  thirstLossGain: number
  /** 血管紧张素高过这条线才推动口渴，0~1 标度，默认 0.35 */
  thirstAngiotensinFrom: number
  /** 血管紧张素折算成口渴上升的系数，默认 0.05 */
  thirstAngiotensinGain: number
  // 血糖双向调节
  /** 胰岛素目标的底数，0~1 标度，默认 0.08 */
  insulinBase: number
  /** 血糖高过这条线开始抬胰岛素，0~1 标度，默认 0.62 */
  insulinGlucoseFrom: number
  /** 血糖折算的跨度，默认 0.30 */
  insulinGlucoseSpan: number
  /** 血糖缺口折算成胰岛素目标的系数，默认 0.95 */
  insulinGain: number
  /** 胰岛素半衰期，小时，默认 0.35 */
  insulinHalfHours: number
  /** 胰高血糖素目标的底数，0~1 标度，默认 0.08 */
  glucagonBase: number
  /** 血糖低于这条线开始抬胰高血糖素，0~1 标度，默认 0.60 */
  glucagonGlucoseBelow: number
  /** 血糖折算的跨度，默认 0.30 */
  glucagonGlucoseSpan: number
  /** 血糖缺口折算成胰高血糖素目标的系数，默认 0.95 */
  glucagonGain: number
  /** 胰高血糖素半衰期，小时，默认 0.55 */
  glucagonHalfHours: number
  /** 血糖每小时的底数涨幅，默认 0.010 */
  glucoseRiseBase: number
  /** 饥饿高过这条线才开始额外升糖，0~1 标度，默认 0.60 */
  glucoseHungerFrom: number
  /** 饥饿折算成升糖的系数，默认 0.03 */
  glucoseHungerGain: number
  /** 胰高血糖素折算成升糖的系数，默认 0.10 */
  glucoseGlucagonGain: number
  /** 胰岛素折算成降糖的系数，默认 0.28 */
  glucoseInsulinDrop: number
  /** 单次结算里血糖涨幅最多按多少小时算，默认 1 小时 */
  glucoseSpanCap: number
  // 内环境：腺苷、细胞因子、体温与疼痛
  /** 醒着时每小时涨多少腺苷，0~1 标度，默认 0.042 */
  adenosineAwakeRate: number
  /** 夜间每小时涨多少腺苷，0~1 标度，默认 0.020 */
  adenosineQuietRate: number
  /** 细胞因子半衰期，小时，默认 36 */
  cytokinesHalfHours: number
  /** 细胞因子折算成发烧目标的系数，默认 0.85 */
  feverCytokinesGain: number
  /** 发烧跟随的半衰期，小时，默认 1.0 */
  feverHalfHours: number
  /** 体温基线，摄氏度，默认 36.55 */
  coreTempBase: number
  /** 夜色把体温压下去多少，摄氏度，默认 0.30 */
  coreTempNightDrop: number
  /** 发烧折算成体温上升的系数，摄氏度，默认 1.60 */
  coreTempFeverGain: number
  /** 疼痛半衰期，小时，默认 0.5 */
  painHalfHours: number
  /** 疼痛单次结算最多按多少小时算，小时，默认 24 */
  painHoursCap: number
  // 峰值与死亡威胁
  /** 幸福峰值的 happiness 下限，0~1 标度，默认 0.86 */
  peakHappinessFrom: number
  /** 幸福峰值要求的多巴胺下限，0~1 标度，默认 0.70 */
  peakDopamineFrom: number
  /** 幸福峰值要求的催产素下限，0~1 标度，默认 0.58 */
  peakOxytocinFrom: number
  /** 幸福峰值要求的血清素下限，0~1 标度，默认 0.68 */
  peakSerotoninFrom: number
  /** 幸福峰值要求的皮质醇上限，0~1 标度，默认 0.30 */
  peakCortisolBelow: number
  /** 想哭低谷的 sadness 下限，0~1 标度，默认 0.85 */
  troughSadnessFrom: number
  /** 想哭低谷要求的血清素上限，0~1 标度，默认 0.32 */
  troughSerotoninBelow: number
  /** 想哭低谷要求的皮质醇下限，0~1 标度，默认 0.65 */
  troughCortisolFrom: number
  /** 余额高于这条线算宽裕，默认 10，死亡威胁目标为零 */
  mortalityBalanceCalm: number
  /** 余额高于这条线算偏紧，默认 8，落进第二档 */
  mortalityBalanceWary: number
  /** 余额高于这条线算吃紧，默认 5，落进第三档 */
  mortalityBalanceLow: number
  /** 第二档的死亡威胁目标，0~1 标度，默认 0.25 */
  mortalityTargetWary: number
  /** 第三档的死亡威胁目标，0~1 标度，默认 0.55 */
  mortalityTargetLow: number
  /** 最紧一档的死亡威胁目标，0~1 标度，默认 1.0 */
  mortalityTargetCrisis: number
  /** 每拍朝目标涨多少，0~1 标度，默认 0.15 */
  mortalityRisePerBeat: number
  /** 每拍朝目标退多少，0~1 标度，默认 0.03，退得比涨慢得多 */
  mortalityFallPerBeat: number
  /** 死亡威胁高过这条线算高位，0~1 标度，默认 0.85；到线那天才产出一条想说最后的话的事实 */
  farewellMortalityFrom: number
}
