// 组合包的默认值表

import { DEFAULTS as MEMORY_DEFAULTS } from '@huoli/huoli-qq-memory'
import { COMPLAINT_DEFAULTS } from './complaint.ts'
import { EMOTION_DEFAULTS } from './emotion-tier.ts'
import { OWNER_SELF_REPAIR_TOOLS } from './tool-whitelist.ts'

/** 组合包的默认值 */
export const BUNDLE_DEFAULTS = {
  /** 默认使用完整拟人自主模式 */
  interactionMode: 'autonomous' as 'probability' | 'heartflow' | 'autonomous',
  /** 当前角色年龄；仅是可自定义的角色事实，不参与亲密内容放行判定 */
  characterAge: 20,
  /** 主人是谁不写死，由部署配置提供 QQ 号与称呼 */
  creatorQq: '',
  creatorTitle: '',
  /** 她对主人的称呼，与 creatorTitle 分开：一个是别人怎么叫主人，一个是她怎么叫 */
  ownerAddress: '',
  /** 群里用的名字，部署可覆盖 */
  selfName: '小鲸鱼',
  /** 自己声明安静的状态文件 */
  selfQuietFile: 'data/qq-self-quiet.json',
  /** 面板能拧的行为约束存哪 */
  limitsFile: 'data/qq-limits.json',
  /** 自己发过的原话、撤回改口与没接住的事实存哪，只摆给模型自己看 */
  ownSpeechFile: 'data/qq-own-speech.jsonl',
  /** 安静最短与最长分钟数 */
  selfQuietMinMinutes: 5,
  selfQuietMaxMinutes: 720,
  /** 私聊亲密互动的独立开关；与年龄无关，公开场合与未经同意的情形仍受边界约束 */
  adultIntimacyEnabled: true,
  /** 真正睡着时不让入站消息叫醒模型 */
  hardRest: true,
  /** 好友私聊默认仍能被睡着时的消息叫醒，群聊不享受这条 */
  privateWakeWhileSleeping: true,
  /** 当前互动模式存哪 */
  modeFile: 'data/qq-mode.json',
  /** 离步数上限还有几步时提醒一次收尾 */
  wrapUpSteps: 8,
  /** 一轮最多走几步 */
  maxSteps: 40,
  /** 睡着时仍允许分出的最多气泡数 */
  sleepingReplyCap: 3,
  /** 精力低、身体该休息时最多分出的气泡数 */
  restingReplyCap: 3,
  /** 已授权私聊默认启用 DSH 原生长任务工具 */
  longTaskMode: true,
  /** 同一工具带着同一错误重复几次就停 */
  maxRepeatedToolErrors: 3,
  /** 同时能处理几个不同聊天，同一个聊天仍按顺序 */
  foregroundSlots: 1,
  /** 这些工具改到后台执行，空名单表示不启用 */
  backgroundTools: [] as readonly string[],
  /** 单个后台工具最长执行十分钟 */
  backgroundToolTimeoutMs: 600_000,
  /** 长工具接手时对所有会话发出的可见短句 */
  backgroundWorkingAckText: '这事我接着看，等下回你。',
  /** 后台工具没能完成时说清楚 */
  backgroundFailureText: '刚才那件事没办完，我这边卡了一下。',
  /** 同一会话最多同时跑两个后台工具 */
  backgroundMaxPerChat: 2,
  /** 一个聊天最多排几项 */
  queuedPerChat: 64,
  /** 私聊短消息等多久再合起来 */
  privateMergeMs: 1_500,
  /** 私聊从第一句算起最多等多久 */
  privateMergeMaxMs: 4_000,
  /** 私聊连续两次只写旁白时，部署可选的真实短句；留空就不塞固定话术 */
  privateFallbackText: '',
  /** 私聊开始调用工具时可选的可见回复；留空就让模型自己写 */
  privateWorkingAck: '',
  /** 私聊模型请求失败时发出的简短说明 */
  privateErrorFallbackText: '我这边刚才卡了一下，没接住你的消息，你再发我一次。',
  /** 这一轮判读有多少把握才写回关系和身体 */
  affectConfidenceFrom: 0.55,
  /** 有原话依据的情绪判读至少多少把握才保存 */
  affectEvidenceFrom: 0.55,
  /** 判读到多强的敌意才当场记成被凶 */
  affectHostilityFrom: 0.55,
  /** 判读到多强的亲近才当场记成被夸 */
  affectPraiseFrom: 0.55,
  /** 群聊普通短消息最多等多久合并成一次现场，点名与引用不等 */
  groupMergeMs: 800,
  /** 合起来最多多少字 */
  mergeMaxChars: 8_000,
  /** 超过多少字就不再等，直接处理 */
  mergeImmediateChars: 120,
  /** 一条消息最多保存几个附件 */
  mediaMaxItems: 4,
  /** 一个附件最多下载多少字节 */
  mediaMaxBytes: 20 * 1024 * 1024,
  /** 一个附件最多下载多久 */
  mediaTimeoutMs: 20_000,
  videoVisionEnabled: true,
  videoVisionMaxSeconds: 60,
  groupVideoVisionMaxSeconds: 30,
  videoVisionFrameIntervalSeconds: 8,
  videoVisionMaxFrames: 6,
  groupVideoVisionMaxFrames: 4,
  videoVisionMaxFrameDimension: 640,
  videoVisionMaxFrameBytes: 1_048_576,
  videoVisionTimeoutMs: 15_000,
  /** 读图用哪个提供方，空表示关闭 */
  visionProvider: '',
  /** 读图用哪个模型，空表示关闭 */
  visionModel: '',
  visionModels: [] as readonly string[],
  visionHighModel: '',
  visionHighModels: [] as readonly string[],
  visionAlwaysUseConfiguredModel: false,
  visionBatchMaxImages: 8,
  visionBatchMaxBytes: 16 * 1024 * 1024,
  /** 一次读图最多生成多少 token */
  visionMaxTokens: 1200,
  /** 一次读图最多留多少字 */
  visionMaxChars: 2_400,
  /** 一次读图最多等多久 */
  visionTimeoutMs: 30_000,
  /** 自动路由时每个候选模型各等多久，失败就换下一个 */
  visionAttemptTimeoutMs: 10_000,
  /** 失败模型暂停多久，过了再自动探测 */
  visionFailureCooldownMs: 15 * 60_000,
  /** 图片档放哪 */
  imageArchiveFile: 'data/qq-images.json',
  /** 图片与视频自动识别的小时和每日用量 */
  mediaBudgetFile: 'data/qq-media-budget.json',
  /** 图片档最多留几张 */
  imageArchiveMax: 500,
  /** 图片兴趣权重多久减半 */
  imageWeightHalfLifeHours: 24,
  /** 到这个权重就先快速看 */
  imageQuickWeightFrom: 35,
  /** 到这个权重可以在首轮回复后深入看 */
  imageDeepWeightFrom: 60,
  /** 明确要求先不看的图片短语，可由 profile 覆盖 */
  imageIgnorePhrases: ['别看', '不用看', '不必看', '不感兴趣', '跳过这张', '忽略这张'] as readonly string[],
  /** 默认不在首答后再发视觉请求；需要时由模型调用图片回看工具 */
  imageDeepAfterReply: false,
  /** 没有额外配置时只拿当前 QQ 头像做自我识别参考 */
  selfReferenceImages: [] as readonly string[],
  /** 角色外观的稳定文字基线；留空只靠参考图 */
  selfReferenceDescription: '',
  /** 单张形象参考图最多读多少字节 */
  selfImageMaxBytes: 8 * 1024 * 1024,
  /** 一次自我识别最多带几张参考图 */
  selfImageMaxReferences: 3,
  /** 图片记忆提示词最多列几张 */
  imageRecentPromptMax: 5,
  /** 私聊或普通会话每小时最多自动识别几张图片 */
  imageRecognitionsPerHour: 12,
  /** 一天最多自动识别几张图片 */
  imageRecognitionsPerDay: 60,
  /** 私聊或普通会话每小时最多分析几个视频 */
  videoRecognitionsPerHour: 3,
  /** 一天最多分析几个视频 */
  videoRecognitionsPerDay: 10,
  /** 群聊每小时最多自动识别几张图片 */
  groupImageRecognitionsPerHour: 6,
  /** 群聊每小时最多分析几个视频 */
  groupVideoRecognitionsPerHour: 1,
  /** 自动识图需要的最低精力 */
  imageRecognitionMinEnergy: 0.18,
  /** 自动分析视频需要的最低精力 */
  videoRecognitionMinEnergy: 0.28,
  /** 生图接口：留空就不接；模型走 relay 上的 gpt-image-2 这一路 */
  imageGenBaseURL: '',
  imageGenModel: 'gpt-image-2.5-sunburst',
  imageGenFallbackModel: 'gpt-image-2.5-flare',
  imageGenReferenceImages: [] as readonly string[],
  imageGenStyleAnchor: '',
  imageGenKeyRef: 'RELAY_103_KEY',
  imageGenCredentialFile: '',
  imageGenSize: '1024x1024',
  imageGenTimeoutMs: 180_000,
  /** 默认不自动读链接；需要时由模型按兴趣和当前话题决定 */
  linkFetch: 'off' as 'off' | 'private' | 'all',
  /** 一条消息最多读几个链接 */
  linkFetchMaxLinks: 1,
  /** 一个链接最多留多少字 */
  linkFetchMaxChars: 6_000,
  /** 一个链接最多读多久 */
  linkFetchTimeoutMs: 15_000,
  /** 急停状态文件 */
  emergencyStopFile: 'data/qq-emergency-stop.json',
  /** 统一诊断时间线放哪 */
  timelineFile: 'data/qq-timeline.jsonl',
  /** 时间线最多留几条 */
  timelineMaxLines: 5_000,
  /** 时间线最多留多久 */
  timelineRetentionMs: 7 * 24 * 3_600_000,
  /** 自动检查 DSH 本体健康 */
  selfHealthEnabled: true,
  /** 五分钟自动体检一次 */
  selfHealthIntervalMs: 5 * 60_000,
  /** 启动后先等 Loader 与工具面装稳，再报第一份完整健康 */
  selfHealthStartupDelayMs: 30_000,
  /** 最近六小时的故障进入体检 */
  selfHealthWindowMs: 6 * 3_600_000,
  /** 同一问题半小时内只叫醒一次 */
  selfHealthAlertCooldownMs: 30 * 60_000,
  /** 健康、留意与退化的分数门槛 */
  selfHealthHealthyAt: 90,
  selfHealthWatchAt: 70,
  selfHealthDegradedAt: 40,
  /** 最新健康快照放哪 */
  selfHealthStateFile: 'data/qq-self-health.json',
  /** 每月健康日记目录 */
  selfHealthJournalDir: 'data/qq-self/health',
  /** 多久检查一次急停状态 */
  emergencyCheckMs: 1_000,
  /** 每天几点做整理与例行开口，形如 00:20 */
  dailySweepAt: '00:20',
  /** 去重表最多留多少条 */
  seenMax: 256,
  /** 群历史补回来时要不要进入模型判断 */
  groupHistoryWake: false,
  primaryProvider: '',
  /** 主模型 id，只有当前模型等于它时才允许退到备用 */
  primaryModel: '',
  /** 备用模型的 provider，留空表示不启用回退 */
  fallbackProvider: '',
  /** 备用模型的 id */
  fallbackModel: '',
  /** 退到备用后隔多久试着切回主模型，零表示不切回 */
  fallbackRetryMs: 600_000,
  /** 入站之后隔多久才再问一次要不要主动开口 */
  proactiveThrottleMs: 60_000,
  proactiveSoftPacing: true,
  /** 主动候选段最多摆三条，攒下来的旧候选不进提示词 */
  pendingMaxLines: 3,
  /** 主动候选段整段最多六百字 */
  pendingMaxChars: 600,
  /** 理由一字不差地重复时只留一条 */
  pendingDedupeByWhy: true,
  /** 行为倾向事实文件，换文件就能改语气提示 */
  toneFactsFile: '',
  /** 是否把身体与关系读数写成当前轮事实 */
  stateDriveFacts: true,
  /** 没人说话时每隔多久检查一次主动候选，默认十五分钟 */
  nudgeMs: 900_000,
  /** 允许调用的工具名，空表示不限制：插件注册什么就能用什么 */
  allowedTools: [] as readonly string[],
  /** 群聊/私聊/主人私聊三套工具面；空则回落到 allowedTools */
  groupAllowedTools: [] as readonly string[],
  privateAllowedTools: [] as readonly string[],
  ownerAllowedTools: [] as readonly string[],
  /** 主人私聊自动并入的自我诊断、编辑与插件管理能力 */
  ownerSelfRepairTools: OWNER_SELF_REPAIR_TOOLS,
  /** 唯一主人的私聊默认解除工具、沙盒与社交节奏限制；其他会话不受影响 */
  ownerUnrestricted: true,
  /** 是否转写 QQ 语音 */
  asrEnabled: true,
  asrMode: 'local',
  asrPrepareOnStart: true,
  asrAutoStart: true,
  asrStartCommand: [] as readonly string[],
  asrStartWaitMs: 8_000,
  asrBaseURL: '',
  asrModel: '',
  asrKeyRef: '',
  asrCredentialFile: '',
  asrLanguage: 'zh',
  asrTimeoutMs: 120_000,
  asrMaxSeconds: 120,
  asrFfmpegPath: 'ffmpeg',
  asrConfigFile: '',
  biliShareFile: '',
  /** 未读 B站推荐主动叫醒同一会话的最小间隔 */
  biliShareWakeMs: 10 * 60_000,
  /** 额外禁掉的工具名；本机文件、命令与自我改造类不用写这里，代码里已经一律拦住 */
  deniedTools: [] as readonly string[],
  /** 每轮是否把召回到的记忆接在用户原话之后 */
  memoryInject: true,
  /** 放进整串的字数上限，与记忆包同一份默认值 */
  memoryInjectMaxChars: MEMORY_DEFAULTS.injectMaxChars,
  /** 一次放进最多几条，与记忆包同一份默认值 */
  memoryInjectMaxItems: MEMORY_DEFAULTS.injectMaxItems,
  /** 同一段在最近多少轮内不重复放进，与记忆包同一份默认值 */
  memoryInjectRepeatTurns: MEMORY_DEFAULTS.injectRepeatTurns,
  /** 公共动态报上去的级别，公开发布要过阶段与两把钥匙 */
  postLevel: 'public',
  /** 多久之内有人说过话就算群里正热闹，只用来给关卡报事实 */
  humanActiveWindowMs: 120_000,
  /** 主动开口去重时最多回想几条已发正文 */
  deliveredHistoryMax: 20,
  /** 想发动态的读数高过这条线就攒一条动态候选，0~1 标度，取平常那一档，只有涨上去才攒 */
  addPostWantFrom: 0.30,
  /** 同一个会话一天最多攒几条动态候选，攒到就不再看读数 */
  postCandidateDailyMax: 1,
  /** 一顿饭写不写进记忆，关掉就一次都不挂上 */
  mealMemory: true,
  /** 一顿饭写成一条记忆时的重要度，例行的一顿比事件轻，但要过记忆的写入门槛 */
  mealMemoryImportance: 30,
  /** 喝水写不写进记忆，关掉就一次都不挂上 */
  drinkMemory: true,
  /** 喝水写成一条记忆时的重要度，比一顿饭还轻，日常到不值得记太久 */
  drinkMemoryImportance: 25,
  /** 开经日写不写进记忆，关掉就一次都不挂上 */
  cycleMemory: true,
  /** 开经日写成一条记忆时的重要度，一个周期一次，比喝水重一点 */
  cycleMemoryImportance: 35,
  /** 遗书写不写进记忆，关掉就一次都不挂上 */
  farewellMemory: true,
  /** 一场梦写不写进记忆 */
  dreamMemory: true,
  /** 美梦与噩梦发不发出去，关掉就一条动态都不发 */
  dreamPublish: true,
  /** 疤写不写进记忆，关掉就一次都不挂上 */
  scarMemory: true,
  /** 遗书写成一条记忆时的重要度，一辈子只留一句，压在保护线以上 */
  farewellMemoryImportance: 95,
  /** 发牢骚的门槛与代码里那份解析同一处，改配置就改这一块的默认 */
  complaint: COMPLAINT_DEFAULTS,
  /** 情绪档位那一层，与代码里那份解析同一处 */
  emotion: EMOTION_DEFAULTS,
  /** 顺手配一张表情包的候选要不要进提示词 */
  stickerSuggest: true,
  /** 同一处刚发过表情包后多久不再推，避免连着刷 */
  stickerRecentWindowMs: 10 * 60_000,
  /** 一次最多给几张表情候选 */
  stickerCandidateLimit: 3,
  /** 项目内的图片目录，收到的图片和文件按内容分类放进去 */
  mediaRoot: 'data/media',
  /** 图片目录的索引，记分档、权重和来源 */
  mediaIndexFile: 'data/qq-media.json',
  /** 表情包库默认位置，与通道读的那一份是同一个文件 */
  mediaStickerFile: 'data/qq-stickers.json',
  /** 图片目录的索引最多留几条 */
  mediaIndexMax: 500,
  /** 图片权重多久减半，十四天 */
  mediaHalfLifeHours: 14 * 24,
  /** 收藏档的权重倍数 */
  mediaFavoriteWeight: 2.2,
  /** 权重低于这条线就降到冷归档档 */
  mediaArchiveBelowWeight: 0.25,
  /** 缓存档最多留三天 */
  mediaCacheMaxAgeHours: 72,
  /** 缓存档最多留五百条 */
  mediaCacheMaxItems: 500,
  /** 每六小时按档位清理一次 */
  mediaSweepIntervalMs: 6 * 3_600_000,
  /** 入站素材默认按文件信息粗分；需要模型归档时显式开启 */
  mediaClassify: false,
  /** 一次判类最多生成多少 token */
  mediaClassifyMaxTokens: 400,
  /** 一次判类最多留多少字 */
  mediaClassifyMaxChars: 2_000,
  /** 一次判类最多等十五秒，超时按扩展名粗分 */
  mediaClassifyTimeoutMs: 15_000,
  /** 第一次进某个群或私聊时给不给一段环境说明 */
  briefingEnabled: true,
  /** 会话级环境说明表放哪，一个会话一段 */
  briefingFile: 'data/qq-briefing.json',
  /** 已经给过说明的会话记在哪，记过的不再给 */
  briefingLedgerFile: 'data/qq-briefing-sent.json',
  /** 默认给发言统计、自身资料与群上下文 */
  selfAwarenessEnabled: true,
  /** 发言统计看近五分钟、二十分钟与一小时 */
  selfTalkWindowsMs: [5 * 60_000, 20 * 60_000, 60 * 60_000] as readonly number[],
  /** 原话、素材与表情包各最多摆六条 */
  selfMaxSamples: 6,
  /** 整段最多一千六百字，避免把提示词撑大 */
  selfMaxChars: 1_600,
  /** 视频线索常驻：整段最多二百六十字，对提示词几乎不增重 */
  videoInterestEnabled: true,
  /** 视频线索只摆三条原话样本 */
  videoInterestMaxSamples: 3,
  /** 整段视频线索最多二百六十字，超了从末尾收口 */
  videoInterestMaxChars: 260,
  /** 把站内插件想转达的话送回主人私聊 */
  biliGateEnabled: true,
  /** 转达正文最多五百字，够放草稿编号和两三行原话，又不把整段材料倒进私聊 */
  biliGateMaxChars: 500,
  /** 门卫一次最多翻三十条最近消息 */
  biliGateMaxMessages: 30,
}
