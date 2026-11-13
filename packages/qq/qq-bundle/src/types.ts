// 装配行的配置与它对外露出的两个接口

import type { ActionResult } from '@huoli/huoli-qq-channel'
import type { DeliverResult } from '@huoli/huoli-qq-proactive'
import type { ComplaintSettingsInput } from './complaint.ts'
import type { DecisionRecord, TimelineRecord } from './decisions.ts'
import type { EmotionSettingsInput } from './emotion-tier.ts'
import type { InteractionMode, InteractionModeState } from './tool-whitelist.ts'
import type { SelfHealthSnapshot } from './self-health.ts'

/** 这一行接受的配置 */
export interface Config {
  /** 当前互动模式：概率闲聊、心流或完整拟人自主 */
  interactionMode?: 'probability' | 'heartflow' | 'autonomous'
  /** 角色年龄；仅作为可自定义的角色事实，不参与亲密内容放行判定 */
  characterAge?: number
  /** 主人的 QQ 号；留空就不注入来处，也不认任何人为主人 */
  creatorQq?: string
  /** 别人一般怎么称呼主人 */
  creatorTitle?: string
  /** 她自己称呼主人时用的叫法；留空就跟 creatorTitle */
  ownerAddress?: string
  /** 群里用的名字，写进每轮身份事实 */
  selfName?: string
  /** 安静状态文件 */
  selfQuietFile?: string
  /** 面板能拧的行为约束存哪 */
  limitsFile?: string
  /** 面板首次使用且尚未保存时，每个会话每小时最多主动发几条 */
  proactivePerHour?: number
  /** 面板允许把每会话每小时主动发送上限调到多少，默认 30 */
  proactivePerHourMax?: number
  /** 自己发过的原话、撤回改口与没接住的事实存哪；不填跟主数据目录 */
  ownSpeechFile?: string
  /** 自学记录存哪；不填跟主数据目录 */
  selfLessonFile?: string
  /** 默认几点入睡，面板与提示词用同一份 */
  sleepFrom?: number
  /** 默认几点醒 */
  sleepUntil?: number
  /** 安静最短分钟 */
  selfQuietMinMinutes?: number
  /** 安静最长分钟 */
  selfQuietMaxMinutes?: number
  /** 私聊是否允许双方自愿的亲密互动；独立开关，与年龄无关 */
  adultIntimacyEnabled?: boolean
  /** 真正睡着时连入站也不进入模型，默认开 */
  hardRest?: boolean
  /** 睡着时好友私聊仍进入模型，默认开；群聊仍受 hardRest 约束 */
  privateWakeWhileSleeping?: boolean
  /** 当前模式存哪，面板切换后写到这份文件 */
  modeFile?: string
  /** 说话规矩那个文件放哪 */
  rulesFile?: string
  /** 当前单轮回复判断规则放哪 */
  personaRulesFile?: string
  /** 系统级操作指令放哪 */
  systemDirectivesFile?: string
  /** 人格口吻配置放哪 */
  personaVoiceFile?: string
  /** 当前单轮回复判断规则要不要进提示词 */
  personaRulesEnabled?: boolean
  /** 每天几点做整理与例行开口，形如 00:20 */
  dailySweepAt?: string
  /** 一轮最多走几步 */
  maxSteps?: number
  /** 睡着时仍允许分出的最多气泡数 */
  sleepingReplyCap?: number
  /** 精力低、身体该休息时最多分出的气泡数 */
  restingReplyCap?: number
  /** 已授权私聊是否允许使用 DSH 原生长任务工具 */
  longTaskMode?: boolean
  /** 同一工具带着同一错误重复几次就停 */
  maxRepeatedToolErrors?: number
  /** 同时能处理几个不同聊天，同一个聊天仍按顺序 */
  foregroundSlots?: number
  /** 哪些耗时工具改到后台执行，不占本会话的回复队列 */
  backgroundTools?: readonly string[]
  /** 单个后台工具最长执行多久 */
  backgroundToolTimeoutMs?: number
  /** 长工具接手时对所有会话发出的可见短句 */
  backgroundWorkingAckText?: string
  /** 后台工具失败、超时或取消后的可见说明 */
  backgroundFailureText?: string
  /** 同一会话最多同时跑几个后台工具 */
  backgroundMaxPerChat?: number
  /** 一个聊天最多排几项 */
  queuedPerChat?: number
  /** 私聊短消息等多久再合起来 */
  privateMergeMs?: number
  /** 私聊从第一句算起最多等多久 */
  privateMergeMaxMs?: number
  /** 私聊连续两次只写旁白时可选的真实短句；默认留空 */
  privateFallbackText?: string
  /** 私聊开始调用工具时可选的可见回复；默认留空 */
  privateWorkingAck?: string
  /** 私聊模型请求失败时发出的简短说明 */
  privateErrorFallbackText?: string
  /** 这一轮判读有多少把握才写回关系和身体 */
  affectConfidenceFrom?: number
  /** 有原话依据的情绪判读至少多少把握才保存 */
  affectEvidenceFrom?: number
  /** 判读到多强的敌意才当场记成被凶 */
  affectHostilityFrom?: number
  /** 判读到多强的亲近才当场记成被夸 */
  affectPraiseFrom?: number
  /** 群聊普通短消息等多久合并成一次现场，默认 800 毫秒 */
  groupMergeMs?: number
  /** 合起来最多多少字 */
  mergeMaxChars?: number
  /** 超过多少字就不再等，直接处理 */
  mergeImmediateChars?: number
  /** 一条消息最多保存几个附件 */
  mediaMaxItems?: number
  /** 一个附件最多下载多少字节 */
  mediaMaxBytes?: number
  /** 一个附件最多下载多久 */
  mediaTimeoutMs?: number
  /** 是否在本机分析入站视频 */
  videoVisionEnabled?: boolean
  /** 视频最多分析多少秒 */
  videoVisionMaxSeconds?: number
  /** 群聊视频最多分析多少秒 */
  groupVideoVisionMaxSeconds?: number
  /** 视频关键帧间隔秒数 */
  videoVisionFrameIntervalSeconds?: number
  /** 视频最多提取多少帧 */
  videoVisionMaxFrames?: number
  /** 群聊视频最多抽几帧 */
  groupVideoVisionMaxFrames?: number
  /** 视频关键帧最长边像素 */
  videoVisionMaxFrameDimension?: number
  /** 单张视频关键帧最大字节 */
  videoVisionMaxFrameBytes?: number
  /** 每个本机视频处理步骤最多等待多久 */
  videoVisionTimeoutMs?: number
  /** 读图用哪个提供方，空表示关闭 */
  visionProvider?: string
  /** 读图用哪个模型，空表示关闭 */
  visionModel?: string
  /** 普通图片自动路由的候选模型，按顺序轮换并在失败后暂时跳过 */
  visionModels?: readonly string[]
  /** 多图与复杂视觉任务使用的模型 */
  visionHighModel?: string
  /** 多图与复杂视觉任务自动路由的候选模型 */
  visionHighModels?: readonly string[]
  /** 图片是否优先走单独配置的视觉模型 */
  visionAlwaysUseConfiguredModel?: boolean
  /** 每轮最多交给聊天或视觉模型的图片数量 */
  visionBatchMaxImages?: number
  /** 每轮交给聊天或视觉模型的图片总字节上限 */
  visionBatchMaxBytes?: number
  /** 一次读图最多生成多少 token */
  visionMaxTokens?: number
  /** 一次读图最多留多少字 */
  visionMaxChars?: number
  /** 一次读图最多等多久 */
  visionTimeoutMs?: number
  /** 自动路由时单个候选模型最多等多久 */
  visionAttemptTimeoutMs?: number
  /** 候选模型失败后暂停多久再探测 */
  visionFailureCooldownMs?: number
  /** 图片档放哪 */
  imageArchiveFile?: string
  /** 图片与视频自动识别的小时和每日用量文件 */
  mediaBudgetFile?: string
  /** 图片档最多留几张 */
  imageArchiveMax?: number
  /** 生图接口的 OpenAI 兼容根地址；留空就不接生图 */
  imageGenBaseURL?: string
  /** 生图模型名 */
  imageGenModel?: string
  /** 主模型明确失败时使用的备用模型名 */
  imageGenFallbackModel?: string
  /** 生图参考图：三视图/立绘的绝对路径；有就优先走 /images/edits，失败再退回文生图 */
  imageGenReferenceImages?: readonly string[]
  /** 固定的外观锚点，拼在每次 prompt 前面；留空就用 selfReferenceDescription */
  imageGenStyleAnchor?: string
  /** 凭证文件里用哪个 ref 名 */
  imageGenKeyRef?: string
  /** 凭证文件放哪；留空用 ~/.huoli/.credentials.yaml */
  imageGenCredentialFile?: string
  /** 生图尺寸 */
  imageGenSize?: string
  /** 生图最多等多久 */
  imageGenTimeoutMs?: number
  /** 图片兴趣权重多久减半 */
  imageWeightHalfLifeHours?: number
  /** 到这个权重就先快速看 */
  imageQuickWeightFrom?: number
  /** 到这个权重可以在首轮回复后深入看 */
  imageDeepWeightFrom?: number
  /** 消息明确要求不看图片时识别的短语 */
  imageIgnorePhrases?: readonly string[]
  /** 是否在首轮回复后自动深入看 */
  imageDeepAfterReply?: boolean
  /** 图片记忆提示词最多列几张 */
  imageRecentPromptMax?: number
  /** 私聊或普通会话每小时最多自动识别几张图片 */
  imageRecognitionsPerHour?: number
  /** 一天最多自动识别几张图片 */
  imageRecognitionsPerDay?: number
  /** 私聊或普通会话每小时最多分析几个视频 */
  videoRecognitionsPerHour?: number
  /** 一天最多分析几个视频 */
  videoRecognitionsPerDay?: number
  /** 群聊每小时最多自动识别几张图片 */
  groupImageRecognitionsPerHour?: number
  /** 群聊每小时最多分析几个视频 */
  groupVideoRecognitionsPerHour?: number
  /** 自动识图需要的最低精力 */
  imageRecognitionMinEnergy?: number
  /** 自动分析视频需要的最低精力 */
  videoRecognitionMinEnergy?: number
  /** 机器人自己的形象参考图，本地路径或 HTTP(S) 地址 */
  selfReferenceImages?: readonly string[]
  /** 给自我识别看的稳定外观特征 */
  selfReferenceDescription?: string
  /** 单张形象参考图最大字节 */
  selfImageMaxBytes?: number
  /** 一次自我识别最多带几张参考图 */
  selfImageMaxReferences?: number
  /** 自动读取链接的范围：关闭、只读私聊、全部会话 */
  linkFetch?: 'off' | 'private' | 'all'
  /** 一条消息最多读几个链接 */
  linkFetchMaxLinks?: number
  /** 一个链接最多留多少字 */
  linkFetchMaxChars?: number
  /** 一个链接最多读多久 */
  linkFetchTimeoutMs?: number
  /** 急停状态文件放哪 */
  emergencyStopFile?: string
  /** 多久检查一次急停状态 */
  emergencyCheckMs?: number
  /** 去重表最多留多少条 */
  seenMax?: number
  /** 群历史补回来时要不要进入模型判断 */
  groupHistoryWake?: boolean
  /** 主模型 id，只有当前模型等于它时才允许退到备用 */
  primaryProvider?: string
  /** 主模型 id，只有当前模型与提供方都匹配时才允许退到备用 */
  primaryModel?: string
  /** 备用模型的 provider，留空表示不启用回退 */
  fallbackProvider?: string
  /** 备用模型的 id */
  fallbackModel?: string
  /** 退到备用后隔多久试着切回主模型，零表示不切回 */
  fallbackRetryMs?: number
  /** 轮次记录放哪，不填就用主目录下的 data */
  decisionsFile?: string
  /** 入站唤醒 Agent 的诊断记录放哪，不填就用主目录下的 data */
  wakeLogFile?: string
  /** 统一诊断时间线放哪，不填就沿用旧唤醒日志位置 */
  timelineFile?: string
  /** 时间线最多留几条 */
  timelineMaxLines?: number
  /** 时间线最多留多久 */
  timelineRetentionMs?: number
  /** 每日维护日志放哪，不填就用主目录下的 data */
  maintenanceLogFile?: string
  /** 是否自动检查 DSH 服务、插件、工具、模型故障与数据目录 */
  selfHealthEnabled?: boolean
  /** 自动体检隔多久跑一次，毫秒 */
  selfHealthIntervalMs?: number
  /** 启动后多久做第一次完整体检，毫秒 */
  selfHealthStartupDelayMs?: number
  /** 故障回看多久，毫秒 */
  selfHealthWindowMs?: number
  /** 同一问题隔多久再叫醒主人一次，毫秒 */
  selfHealthAlertCooldownMs?: number
  /** 健康分不低于多少算健康 */
  selfHealthHealthyAt?: number
  /** 健康分不低于多少算留意 */
  selfHealthWatchAt?: number
  /** 健康分不低于多少算退化 */
  selfHealthDegradedAt?: number
  /** 最新健康快照与复测状态放哪 */
  selfHealthStateFile?: string
  /** 每月健康日记目录 */
  selfHealthJournalDir?: string
  /** 入站之后隔多久才再问一次要不要主动开口 */
  proactiveThrottleMs?: number
  /** 主动开口用软节奏：跳过每日上限与 150–300 分钟硬间隔，由模型按事实决定 */
  proactiveSoftPacing?: boolean
  /** 主动候选段最多摆几条，别让攒下来的旧候选撑大提示词 */
  pendingMaxLines?: number
  /** 主动候选段整段最多多少字 */
  pendingMaxChars?: number
  /** 理由一字不差地重复时只留一条 */
  pendingDedupeByWhy?: boolean
  /** 行为倾向事实文件，换文件就能改语气提示 */
  toneFactsFile?: string
  /** 是否把身体与关系读数写成当前轮事实 */
  stateDriveFacts?: boolean
  /** 覆盖主目录，不填按 HUOLI_HOME 定 */
  home?: string
  /** 允许调用的工具名，空表示不限制：插件注册什么就能用什么 */
  allowedTools?: readonly string[]
  /** 群聊专用工具面；空则沿用 allowedTools */
  groupAllowedTools?: readonly string[]
  /** 按群配置敏感能力授权；每个群可分开授权敏感读取与写入，未列出的群默认仅主人私聊受信 */
  groupSensitivePermissions?: Readonly<Record<string, {
    /** 可在此群使用敏感读取工具的 QQ 号；多人合并时每位发送者都须获授权 */
    readers?: readonly string[]
    /** 可在此群使用敏感写入工具的 QQ 号；多人合并时每位发送者都须获授权 */
    writers?: readonly string[]
    /** 可在此群使用消息管理工具的 QQ 号；多人合并时每位发送者都须获授权 */
    moderators?: readonly string[]
  }>>
  /** 好友私聊专用工具面；空则沿用 allowedTools */
  privateAllowedTools?: readonly string[]
  /** 主人私聊专用工具面；空则沿用 privateAllowedTools，再退 allowedTools */
  ownerAllowedTools?: readonly string[]
  /** 主人私聊额外获得的自我诊断、代码编辑与插件管理工具；其他会话永远不并入 */
  ownerSelfRepairTools?: readonly string[]
  /** 主人私聊是否放开全部已注册工具、全权限沙盒、睡眠/安静/停顿与发送额度限制 */
  ownerUnrestricted?: boolean
  /** 是否转写 QQ 语音 */
  asrEnabled?: boolean
  /** local = Huoli 管理的本机识别器；external = 显式配置的 OpenAI 兼容 API */
  asrMode?: 'local' | 'external'
  /** 启动时是否准备本机识别模型；首次准备会下载并校验约 241 MB 的 INT8 模型 */
  asrPrepareOnStart?: boolean
  /** OpenAI 兼容接口地址；本机模式只允许环回地址 */
  asrBaseURL?: string
  /** OpenAI 兼容接口模型名 */
  asrModel?: string
  /** 本机服务没开时是否自动拉起 */
  asrAutoStart?: boolean
  /** 显式配置本机 OpenAI 兼容 ASR 时的启动命令 */
  asrStartCommand?: readonly string[]
  /** 拉起本机服务后等多久再试 */
  asrStartWaitMs?: number
  /** ASR 的凭证名；优先环境变量或 ~/.huoli/.credentials.yaml */
  asrKeyRef?: string
  /** 凭证文件，留空用默认 */
  asrCredentialFile?: string
  /** 转写语言，默认 zh */
  asrLanguage?: string
  /** 一次转写最多等多久 */
  asrTimeoutMs?: number
  /** 一段语音最多转多少秒 */
  asrMaxSeconds?: number
  /** ffmpeg 可执行文件；留空走 PATH */
  asrFfmpegPath?: string
  /** 和 B 站插件共用的 asr.json；留空按 DSH_HOME 找 */
  asrConfigFile?: string
  /** B 站插件留下的待分享推荐；留空按 DSH_HOME/bili-eyes/pending-share.json 找 */
  biliShareFile?: string
  /** 未读 B站推荐主动叫醒同一会话的最小间隔，毫秒 */
  biliShareWakeMs?: number
  /** 额外禁掉的工具名；本机与自我改造类已由代码一律拦住，不必写这里 */
  deniedTools?: readonly string[]
  /** 每轮是否把召回到的记忆接在用户原话之后，关掉就一次都不召回 */
  memoryInject?: boolean
  /** 放进整串的字数上限 */
  memoryInjectMaxChars?: number
  /** 一次放进最多几条 */
  memoryInjectMaxItems?: number
  /** 同一段在最近多少轮内不重复放进 */
  memoryInjectRepeatTurns?: number
  /** 想发动态的读数高过这条线就攒一条动态候选 */
  addPostWantFrom?: number
  /** 同一个会话一天最多攒几条动态候选 */
  postCandidateDailyMax?: number
  /** 公共动态报上去的级别，默认 public，走到发布入口才会判阶段与两把钥匙 */
  postLevel?: string
  /** 多久之内有人说过话就算群里正热闹 */
  humanActiveWindowMs?: number
  /** 主动开口去重时最多回想几条已发正文 */
  deliveredHistoryMax?: number
  /** 一顿饭写不写进记忆 */
  mealMemory?: boolean
  /** 一顿饭写成一条记忆时的重要度 */
  mealMemoryImportance?: number
  /** 喝水写不写进记忆 */
  drinkMemory?: boolean
  /** 喝水写成一条记忆时的重要度 */
  drinkMemoryImportance?: number
  /** 开经日写不写进记忆 */
  cycleMemory?: boolean
  /** 开经日写成一条记忆时的重要度 */
  cycleMemoryImportance?: number
  /** 遗书写不写进记忆 */
  farewellMemory?: boolean
  /** 遗书写成一条记忆时的重要度 */
  farewellMemoryImportance?: number
  /** 一场梦写不写进记忆 */
  dreamMemory?: boolean
  /** 美梦与噩梦发不发出去，平淡梦一律不发 */
  dreamPublish?: boolean
  /** 疤写不写进记忆 */
  scarMemory?: boolean
  /** 调用方给的模型文本，模型自己没写过时遗书正文用它，再没有就写一句中性的话 */
  farewellText?: string
  /** 遗书正文的暂存槽放哪，要与通道那一份是同一个文件 */
  farewellFile?: string
  /** 外部余额系统的档位，越大越宽裕，不给就是没有来源 */
  balanceLevel?: number
  /** 启动账放哪，用来算今天重启过几次 */
  livenessFile?: string
  /** 没人说话时每隔多久给她一次主动开口的机会，毫秒，默认十分钟；真开不开口由主动那一路的间隔与额度定 */
  nudgeMs?: number
  /** 要不要把这一轮合适的表情候选写成提示词事实，默认开 */
  stickerSuggest?: boolean
  /** 同一处刚发过表情包后多久不再推，毫秒，默认十分钟 */
  stickerRecentWindowMs?: number
  /** 一次最多给几张表情候选 */
  stickerCandidateLimit?: number
  /** 表情包库放哪，不填就与通道那一份用同一个文件 */
  stickerFile?: string
  /** 表情包使用反馈放哪，不填就与通道那一份用同一个文件 */
  stickerUsageFile?: string
  /** 发牢骚的门槛：驱力、事由条数、窗口、指名与单靠牢骚开场的下限 */
  complaint?: ComplaintSettingsInput
  /** 情绪档位这一层：档位怎么分、抬多少、两条回路各自的开关 */
  emotion?: EmotionSettingsInput
  /** 项目内的图片目录，不填就用主目录下的 data/media */
  mediaRoot?: string
  /** 图片目录的索引放哪，不填就用主目录下的 data/qq-media.json */
  mediaIndexFile?: string
  /** 表情包库放哪，不填就与通道那一份用同一个文件 */
  mediaStickerFile?: string
  /** 图片目录的索引最多留几条 */
  mediaIndexMax?: number
  /** 图片权重多久减半，小时 */
  mediaHalfLifeHours?: number
  /** 收藏档的权重倍数 */
  mediaFavoriteWeight?: number
  /** 权重低于这条线就降到冷归档档 */
  mediaArchiveBelowWeight?: number
  /** 缓存档最多留多久，小时 */
  mediaCacheMaxAgeHours?: number
  /** 缓存档最多留几条 */
  mediaCacheMaxItems?: number
  /** 多久按档位清理一次图片目录，毫秒；零表示不自动清理 */
  mediaSweepIntervalMs?: number
  /** 入站素材要不要让视觉模型判类，关掉就按扩展名粗分 */
  mediaClassify?: boolean
  /** 一次判类最多生成多少 token */
  mediaClassifyMaxTokens?: number
  /** 一次判类最多留多少字 */
  mediaClassifyMaxChars?: number
  /** 一次判类最多等多久，毫秒 */
  mediaClassifyTimeoutMs?: number
  /** 要不要在第一次进某个群或私聊时给一段环境说明，默认开 */
  briefingEnabled?: boolean
  /** 会话级环境说明表放哪，一个会话一段，不填就落在数据根目录下的 data */
  briefingFile?: string
  /** 已经给过说明的会话记在哪，记过的不再重复给，不填就落在数据根目录下的 data */
  briefingLedgerFile?: string
  /** 要不要给发言统计、自身资料与群上下文这几段事实，默认开 */
  selfAwarenessEnabled?: boolean
  /** 发言统计的三档窗口，毫秒，依次给近五分钟、二十分钟与一小时 */
  selfTalkWindowsMs?: readonly number[]
  /** 群友原话、素材与表情包各最多摆几条，防提示词变长 */
  selfMaxSamples?: number
  /** 整段自知事实最多多少个字符，超了直接从整段末尾收口 */
  selfMaxChars?: number
  /** 要不要给「可以顺着找什么」这段视频线索，默认关，开了才占提示词 */
  videoInterestEnabled?: boolean
  /** 视频线索里最多摆几条原话样本 */
  videoInterestMaxSamples?: number
  /** 整段视频线索最多多少个字符，超了直接从整段末尾收口 */
  videoInterestMaxChars?: number
  /** 要不要把站内插件想转达的话送回主人私聊 */
  biliGateEnabled?: boolean
  /** 转达正文最多多少个字符 */
  biliGateMaxChars?: number
  /** 门卫一次最多翻多少条最近消息 */
  biliGateMaxMessages?: number
}

/** 一次投递的结论：没投出去的码与发布入口回来的那一段都摆在这里 */
export interface BundleDelivery extends DeliverResult {
  /** 走发布入口的结果，只有想发动态的那一条才有 */
  published?: ActionResult
}

/** 排查用的接口，不进模型可见上下文 */
export interface QqBundleSeam {
  /** 从某一时刻起的轮次记录 */
  decisions(sinceAt: number, limit: number): DecisionRecord[]
  /** 按追踪编号读取一条消息经过的阶段 */
  timeline(traceId: string, limit: number): TimelineRecord[]
  /** 把待发里的一条投出去：先预览再投递由主动性把着，动态那一路再交发布入口 */
  deliver(chatKey: string, id: string, body?: string): Promise<BundleDelivery>
  /** 读急停状态 */
  emergencyStopState(): { active: boolean; at: number; reason: string }
  /** 打开急停 */
  emergencyStop(reason: string): { active: boolean; at: number; reason: string }
  /** 解除急停 */
  resume(reason?: string): { active: boolean; at: number; reason: string }
  /** 当前互动模式 */
  interactionMode(): InteractionModeState
  /** 切换互动模式 */
  setInteractionMode(mode: InteractionMode): InteractionModeState
  /** 读取最近一次身体自诊 */
  selfHealth(): SelfHealthSnapshot | undefined
  /** 立即重新检查身体 */
  checkSelfHealth(): SelfHealthSnapshot | undefined
}
