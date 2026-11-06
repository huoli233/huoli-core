// 对外的面板与分级类型：目录状态那一组统一从这里转出

import type { DriveNeed, IdentityClaim, LedgerSummary } from './types-state.ts'

export type {
  AgencyDetail,
  AgencyEntry,
  AgencyOutcome,
  AuditOptions,
  ClaimInput,
  ClaimRow,
  CommitmentInput,
  CommitmentRow,
  ConstitutionClause,
  DayRow,
  DriveDetail,
  DriveEntry,
  DriveNeed,
  ErrorRow,
  IdentityClaim,
  IdentityRow,
  LedgerEntry,
  LedgerSummary,
  LedgerViolation,
  MirrorKind,
  MirrorResult,
  NarrativeState,
  NarrativeTick,
  NarrativeTickReason,
  ProjectInput,
  ProjectOutcome,
  ProjectRow,
  ProjectTally,
  QuestionRow,
  RollbackCheck,
  RollbackOutcome,
  SelfMirrorEntry,
  SelfMirrorPort,
  SelfMirrorWrite,
  VersionEntry,
  ExternalVersionKind,
  InDirVersionKind,
  VersionKind,
  WeeklyReview,
  WriteOutcome,
  WriteReason,
} from './types-state.ts'

/** 混合层露给面板的一条，只留来由与权重 */
export interface VitalsBlendLine {
  /** 一句中文来由，页面拿它当标注 */
  why: string
  /** 归一后的权重，零到一 */
  weight: number
}

/** 身体露给面板的展示读数，字段名与身体那边逐字相同，缺哪个就不给哪个 */
export interface VitalsReadout {
  /** 口渴，零到一 */
  thirst?: number
  /** 精力，零到一 */
  energy?: number
  /** 好坏偏向，零到一 */
  valence?: number
  /** 孤独，零到一 */
  loneliness?: number
  /** 想开口的劲，零到一 */
  proactive_bias?: number
  /** 饥饿，零到一 */
  hunger?: number
  /** 急性愤怒，零到一 */
  anger?: number
  /** 记恨，零到一 */
  resentment?: number
  /** 睡眠压力，零到一 */
  adenosine?: number
  /** 当前周期第几天 */
  cycle_day?: number
  /** 这个周期共几天 */
  cycle_len?: number
  /** 周期处在哪一段 */
  cycle_phase?: string
  /** 发烧程度，零到一 */
  fever?: number
  /** 免疫反应，零到一 */
  cytokines?: number
  /** 疼痛，零到一 */
  pain?: number
  /** 雌激素，零到一 */
  estrogen?: number
  /** 孕激素，零到一 */
  progesterone?: number
  /** 体温，摄氏度 */
  core_temp?: number
  /** 混合层的几条，按分数从高到低 */
  emotion_blend?: readonly VitalsBlendLine[]
}

/** 一组双条：两条拮抗的量画在同一行，谁高谁低一眼看得出 */
export interface PanelPair {
  /** 这一对叫什么 */
  name: string
  /** 左边那条的名字 */
  a: string
  /** 左边那条的读数，零到一 */
  av: number
  /** 右边那条的名字 */
  b: string
  /** 右边那条的读数，零到一 */
  bv: number
}

/** 身体露给面板的那一面，只读 */
export interface VitalsPort {
  /** 身体给的那一句，面板原样用，不再加工 */
  render(): string
  /** 画条要用的那几个数，身体给不出读数时不给这一面 */
  read?(): VitalsReadout
  /** 周期几个阶段各在第几天分开，面板按它画彩弧；不给就只画当天那一格 */
  bounds?(): readonly number[]
  /** 五组双条，哪两条是一对由身体说了算 */
  pairs?(): readonly PanelPair[]
}

/** 面板的四个来源，缺哪个就省哪一行 */
export interface PanelInput {
  /** 此刻，来自身体 */
  moment?: string
  /** 手上没做完的那个项目 */
  project?: string
  /** 下一步要做的一件事 */
  next?: string
  /** 最新一条想弄明白的事 */
  question?: string
}

/** 面板每行的抬头 */
export interface PanelLabels {
  /** 首行的标题 */
  header: string
  /** 此刻 */
  moment: string
  /** 我在做 */
  doing: string
  /** 下一步 */
  next: string
  /** 我想弄明白 */
  question: string
  /** 收尾那句 */
  refuse: string
}

/** 一次钥匙判定 */
export interface KeysDecision {
  /** 放行了没有 */
  allowed: boolean
  /** 没放行的原因 */
  reason?: 'unknown_action' | 'user_key' | 'self_key' | 'cooldown' | 'rest'
}

/** 三类公共动作，键与发布那一侧的状态分格逐字相同 */
export type ActionKind = 'post' | 'comment' | 'private'

/** 一条评论报上来的分级事实 */
export interface CommentFacts {
  /** 评论挂在哪个话题上，不报就按缺话题拒 */
  topic?: string
  /** 预授权话题清单，逐字匹配 */
  topics: readonly string[]
  /** 用户那把钥匙 */
  userOk: boolean
  /** 她自己那把钥匙 */
  selfOk: boolean
  /** 现在处在哪个阶段，不给就用默认值表 */
  stage?: string
  /** 公开评论最早从哪个阶段开始，不给就用默认值表 */
  minStage?: string
  /** 阶段的先后顺序，不给就用默认值表 */
  stages?: readonly string[]
  /** 身份级动作清单，不给就用默认值表 */
  actions?: readonly string[]
}

/** 一条私信报上来的分级事实 */
export interface PrivateFacts {
  /** 写给谁，不报就按缺对象拒 */
  peer?: string
  /** 允许私信的对象名单，逐字匹配 */
  allowPeers: readonly string[]
  /** 用户那把钥匙 */
  userOk: boolean
  /** 她自己那把钥匙 */
  selfOk: boolean
  /** 现在处在哪个阶段，不给就用默认值表 */
  stage?: string
  /** 私信最早从哪个阶段开始，不给就用默认值表 */
  minStage?: string
  /** 阶段的先后顺序，不给就用默认值表 */
  stages?: readonly string[]
  /** 身份级动作清单，不给就用默认值表 */
  actions?: readonly string[]
}

/** 一条动态报上来的分级事实 */
export interface PostLevelFacts {
  /** 她自己说的级别：none、routine、public */
  level: string
  /** 话题类别，例行动态必须落在预授权清单里 */
  topic?: string
  /** 预授权话题清单，不给就当清单是空的 */
  topics?: readonly string[]
  /** 用户那把钥匙 */
  userOk: boolean
  /** 她自己那把钥匙 */
  selfOk: boolean
  /** 现在处在哪个阶段，不给就用默认值表 */
  stage?: string
  /** 公开动态最早从哪个阶段开始，不给就用默认值表 */
  minStage?: string
  /** 阶段的先后顺序，不给就用默认值表 */
  stages?: readonly string[]
  /** 身份级动作清单，不给就用默认值表 */
  actions?: readonly string[]
}

/** 一次分级判定 */
export interface GradeDecision {
  /** 放行了没有 */
  ok: boolean
  /** 没放行的码，形如 post.needs_keys */
  code?: string
  /** 一句可读原因 */
  reason?: string
  /** 下一步怎么做的提示，不给时由调用方按通用话术补 */
  hint?: string
}

/** 一次阶段推进的结果 */
export interface StageOutcome {
  /** 推成了没有 */
  ok: boolean
  /** 推进之后处在哪一档，没推成时是原来那一档 */
  stage: string
  /** 留痕落盘的时刻，没推成时不给 */
  at?: number
  /** 没推成时的码，形如 stage.skip */
  code?: string
  /** 一句可读原因 */
  reason?: string
  /** 没推成时的下一步提示 */
  hint?: string
}

/** 判级加留痕之后的结果 */
export interface KeysOutcome extends KeysDecision {
  /** 是不是只提议，PAUSE 下为真 */
  proposed: boolean
}

/** 只读出口里一天的那三行 */
export interface PanelDayRow {
  /** 记下的时刻 */
  at: number
  /** 三行正文，跳过的那天是三条空串 */
  lines: readonly string[]
  /** 今天跳过了没有 */
  skipped: boolean
}

/** 情绪条的一条：标注只用中文来由，权重只进条宽 */
export interface PanelEmotionBar {
  /** 一句中文来由 */
  why: string
  /** 画条用的权重，零到一 */
  weight: number
}

/** 面板画条要用的那几个数，缺哪一块就整块省掉 */
export interface PanelVitals {
  /** 口渴，零到一，水罐按一减它算水位 */
  thirst?: number
  /** 精力，零到一 */
  energy?: number
  /** 心情，零到一，取身体的好坏偏向 */
  mood?: number
  /** 无聊，零到一，取身体的孤独 */
  boredom?: number
  /** 想说话，零到一，取身体的想开口的劲 */
  socialHunger?: number
  /** 饥饿，零到一，画成另一只环 */
  hunger?: number
  /** 怒气，零到一，火舌高度按它算 */
  anger?: number
  /** 记恨，零到一，火底余烬按它算 */
  resentment?: number
  /** 累，零到一，取睡眠压力 */
  tired?: number
  /** 周期第几天 */
  cycleDay?: number
  /** 这个周期共几天 */
  cycleLen?: number
  /** 周期处在哪一段 */
  cyclePhase?: string
  /** 周期几个阶段的分界日，四刀切出五段 */
  cycleBounds?: readonly number[]
  /** 五组双条 */
  pairs?: readonly PanelPair[]
  /** 体温，摄氏度，画曲线时再归一 */
  temp?: number
  /** 发烧程度，零到一 */
  fever?: number
  /** 免疫反应，零到一 */
  immunity?: number
  /** 疼痛，零到一 */
  pain?: number
  /** 雌激素，零到一 */
  estrogen?: number
  /** 孕激素，零到一 */
  progesterone?: number
  /** 混合层的每条，按分数从高到低 */
  emotion?: readonly PanelEmotionBar[]
}

/** 只读出口露出去的全部内容：只有她自己的话与计数，没有用户原文、记忆正文与钥匙记录 */
export interface PanelState {
  /** 面板正文与首行记的生成时间，还没生成时两个都是空串 */
  panel: { body: string; generatedAt: string }
  /** 画条要用的那几个数与情绪来由，没接上身体时整个字段省掉 */
  vitals?: PanelVitals
  /** 当前身份主张，一条都没写过时不给 */
  identity?: { claim: IdentityClaim; why: string; at: number }
  /** 两档账汇总，两档从不相加 */
  ledger: LedgerSummary
  /** 最近七天的三行，按时间先后 */
  days: readonly PanelDayRow[]
  /** 健康一行，永远只有一行 */
  health: string
}

/** 这一层的参数表，Config.settings 可以逐项覆盖 */
export interface SelfSettings {
  /** 面板正文最多几个字 */
  panelMaxChars: number
  /** 面板复用多久之后才重做 */
  panelMaxAgeMs: number
  /** 此刻那一句最多几个字 */
  momentMaxChars: number
  /** 电量低于这条线就不做身份级决定，0~1 标度 */
  restEnergyBelow: number
  /** 困到这条线以上就不做身份级决定，0~1 标度，取睡眠压力 */
  restTiredAbove: number
  /** 项目名最多几个字 */
  projectMaxChars: number
  /** 下一步最多几个字 */
  nextMaxChars: number
  /** 想问的事最多几个字 */
  questionMaxChars: number
  /** did 那一句最多几个字 */
  didMaxChars: number
  /** 原话最多几个字 */
  verbatimMaxChars: number
  /** 相信的事最多几个字 */
  claimMaxChars: number
  /** 一条相信的事最多挂几个证据 */
  claimEvidenceMax: number
  /** 十问一共几问，默认十问 */
  probeQuestionCount: number
  /** 十问每一答最多几个字 */
  probeAnswerMaxChars: number
  /** 身份主张的理由最多几个字 */
  identityWhyMaxChars: number
  /** 一条身份主张最多挂几个证据 */
  identityEvidenceMax: number
  /** 答应的事最多几个字 */
  commitmentMaxChars: number
  /** 每天固定几行 */
  dayLines: number
  /** 每天那三行每行最多几个字，跳过原因也按它截 */
  dayLineMaxChars: number
  /** 错处与改法最多几个字 */
  errorMaxChars: number
  /** 叙事每段最多几个字 */
  narrativeParaMaxChars: number
  /** 叙事每章最多几段 */
  narrativeParasMax: number
  /** 面板与叙事各留最近几份旧版本 */
  versionsKeep: number
  /** 同时最多几个没结束的项目 */
  openProjectMax: number
  /** 一周最多问几条 */
  questionPerWeekMax: number
  /** 一周多长 */
  weekMs: number
  /** 判据四看的窗口，超过这么久没有一条失败就算违规 */
  auditFailedWindowMs: number
  /** 镜像进记忆时给多少重要度 */
  mirrorImportance: number
  /** 一条镜像正文最多几个字 */
  mirrorMaxChars: number
  /** 没有主会话键时镜像落到哪个会话 */
  mirrorScope: string
  /** 身体的四种需要 */
  driveNeeds: readonly DriveNeed[]
  /** 身份级动作清单，逐字匹配 */
  identityActions: readonly string[]
  /** 同一个身份级动作两次之间至少隔多久，毫秒 */
  identityCooldownMs: number
  /** 现在处在哪个阶段，形如 P2 */
  stage: string
  /** 公开展示（动态与评论）最早从哪个阶段开始 */
  publicMinStage: string
  /** 私信最早从哪个阶段开始 */
  privateMinStage: string
  /** 阶段的先后顺序，比高低只看这张表的次序 */
  stages: readonly string[]
  /** 提示词里的段落名 */
  sectionName: string
  /** 提示词里的位置名 */
  variableName: string
  /** 段落排在什么位置 */
  sectionOrder: number
  /** 面板每行的抬头 */
  labels: PanelLabels
}
