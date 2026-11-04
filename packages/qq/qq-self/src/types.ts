// 自我层对外的类型：面板输入、两档账、钥匙判定、目录里的行

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
  /** 混合层的几条，按分数从高到低 */
  emotion_blend?: readonly VitalsBlendLine[]
}

/** 身体露给面板的那一面，只读 */
export interface VitalsPort {
  /** 身体给的那一句，面板原样用，不再加工 */
  render(): string
  /** 画条要用的那几个数，身体给不出读数时不给这一面 */
  read?(): VitalsReadout
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

/** 身体的四种需要，与身体那边的字段名逐字相同 */
export type DriveNeed = 'hunger' | 'thirst' | 'adenosine' | 'energy'

/** 一件事最后怎么了 */
export type AgencyOutcome = 'done' | 'failed' | 'dropped'

/** 项目的状态，没结束的记 open */
export type ProjectOutcome = 'open' | 'done' | 'failed' | 'dropped'

/** 身体说需要、她去解决的那一条 */
export interface DriveEntry {
  at: number
  id: string
  kind: 'drive'
  need: DriveNeed
  did: string
  resolved: boolean
}

/** 她自己提出、自己要做的那一条 */
export interface AgencyEntry {
  at: number
  id: string
  kind: 'agency'
  project_id: string
  verbatim: string
  because: string
  fail_if: string
  outcome: AgencyOutcome
  artifact: string
}

/** 账本里的一行，只有这两档 */
export type LedgerEntry = DriveEntry | AgencyEntry

/** 两档分开计数，从不相加 */
export interface LedgerSummary {
  /** drive 累计几条 */
  drive: number
  /** agency 累计几条 */
  agency: number
  /** 统计窗口内的 agency 条数 */
  recentAgency: number
}

/** 账本判据查出来的一条违规 */
export interface LedgerViolation {
  /** 哪条判据：三是有产出才算做成，四是隔一两周要有一次失败 */
  rule: 'done_without_artifact' | 'no_recent_failed'
  /** 一句可读的说明 */
  text: string
  /** 牵扯的条数 */
  count: number
}

/** 查判据三与判据四的口径 */
export interface AuditOptions {
  /** 判据四看的窗口，最长两周 */
  failedWindowMs: number
}

/** 一次写入没落盘或只提议的原因 */
export type WriteReason =
  | 'paused'
  | 'disabled'
  | 'unknown_need'
  | 'unknown_claim'
  | 'duplicate'
  | 'capped'
  | 'no_evidence'
  | 'bad_lines'
  | 'unknown_chapter'

/** 一次写入的结果 */
export interface WriteOutcome {
  /** 落盘了没有，提议那条也算落盘 */
  written: boolean
  /** 落的是不是只提议，PAUSE 下为真 */
  proposed: boolean
  /** 没落盘的原因 */
  reason?: WriteReason
}

/** 会按版本留存的那两种单值文件 */
export type VersionKind = 'panel' | 'narrative'

/** versions/ 里的一份旧版本 */
export interface VersionEntry {
  /** 版本文件名，形如 panel-20261104-1830.md */
  name: string
  /** 是哪一种文件的版本 */
  kind: VersionKind
  /** 存档时刻，从文件名读回 */
  at: number
  /** 文件字节数 */
  bytes: number
}

/** 一次回滚的结果 */
export interface RollbackOutcome {
  /** 回滚成了没有 */
  ok: boolean
  /** 从哪一份版本恢复的，没成时不给 */
  restoredFrom?: string
  /** 回滚前那份现场又存成了哪一份版本，没有现场可存时不给 */
  savedCurrent?: string
  /** 没成时的码，形如 versions.missing */
  code?: string
  /** 一句可读原因 */
  reason?: string
  /** 没成时的下一步提示 */
  hint?: string
}

/** 回滚之后逐字核对的结果 */
export interface RollbackCheck {
  /** 当前文件与这一版是否逐字相同 */
  same: boolean
  /** 首处不同的行号，从 1 起；全同或比不了时为 0 */
  line: number
  /** 比不了时的码，形如 versions.missing */
  code?: string
}

/** 一个新项目的写法 */
export interface ProjectInput {
  /** 这个项目叫什么 */
  title: string
  /** 下一步做什么 */
  next: string
  /** 什么情况算失败 */
  failIf: string
}

/** 一条她相信的事的写法 */
export interface ClaimInput {
  /** 她自己的判断 */
  text: string
  /** 她有多信，零到一 */
  confidence: number
  /** 一到三条记忆 id 或日期 */
  evidence: readonly string[]
  /** 反例 */
  counter?: string
}

/** 一件答应过的事的写法 */
export interface CommitmentInput {
  /** 答应了什么 */
  text: string
  /** 什么时候该兑现 */
  dueAt?: number
}

/** 镜像的条目归哪一类，与三份来源文件一一对应 */
export type MirrorKind = 'claim' | 'project' | 'commitment'

/** 交给记忆库镜像的一条 */
export interface SelfMirrorEntry {
  /** 镜像正文 */
  text: string
  /** 记到哪个会话 */
  chatKey: string
  /** 来源文件加序号，形如 `claims.jsonl#3` */
  selfId: string
  /** 哪一类来源 */
  selfKind: MirrorKind
  /** 一到三条记忆编号或日期 */
  evidence: readonly string[]
  /** 这条给多少重要度 */
  importance?: number
}

/** 记忆库写回的结果 */
export interface SelfMirrorWrite {
  /** 那一条的编号 */
  id: string
  /** 是这次新写的还是早就镜过的 */
  created: boolean
}

/** 记忆库露给镜像的那一面 */
export interface SelfMirrorPort {
  /** 已经镜过的来源键 */
  mirroredSelfIds(): readonly string[]
  /** 记忆库现役的编号，证据回查拿它比对 */
  memoryIds(): readonly string[]
  /** 写一条镜像，同一个来源键只写一次 */
  rememberSelf(entry: SelfMirrorEntry, at: number): SelfMirrorWrite
}

/** 一次镜像的交代 */
export interface MirrorResult {
  /** 这次新写进去几条 */
  written: number
  /** 已经镜过而跳过的条数 */
  skipped: number
  /** 超过一条上限、拆成几条写的行数 */
  split: number
  /** 证据一条都查不到而跳过的条数 */
  unverified: number
  /** 一条都没写时为什么 */
  reason?: 'disabled' | 'no_memory'
}

/** 一次钥匙判定 */
export interface KeysDecision {
  /** 放行了没有 */
  allowed: boolean
  /** 没放行的原因 */
  reason?: 'unknown_action' | 'user_key' | 'self_key'
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

/** 叙事那本时间账，只放两格时刻 */
export interface NarrativeState {
  /** 正文上次改动的时刻，从没写过为 0 */
  lastUpdateAt: number
  /** 上次月更提醒的时刻，从没提醒过为 0 */
  lastDueAt: number
}

/** 一次月更提醒没给出信号的原因 */
export type NarrativeTickReason = 'not_due' | 'already_reminded' | 'disabled' | 'paused'

/** 一次月更判断 */
export interface NarrativeTick {
  /** 正文是不是已经跟不上这一个月 */
  due: boolean
  /** 这一次要不要把「该写叙事」的信号交出去，同一个月只交一次 */
  remind: boolean
  /** 这次判断的时刻 */
  at: number
  /** 正文上次改动的时刻，从没写过为 0 */
  lastUpdateAt: number
  /** 没给信号时的原因 */
  reason?: NarrativeTickReason
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

/** drive 那一条的补充内容 */
export interface DriveDetail {
  /** 一句话说说她做了什么 */
  did?: string
  /** 这件事解决了没有 */
  resolved?: boolean
}

/** agency 那一条的补充内容 */
export interface AgencyDetail {
  /** 她的原话 */
  verbatim?: string
  /** 能判真假的那一句 */
  failIf?: string
  /** 最后怎么收的 */
  outcome?: AgencyOutcome
  /** 产出的文件相对路径 */
  artifact?: string
}

/** 项目行 */
export interface ProjectRow {
  at: number
  id: string
  title: string
  next: string
  fail_if: string
  outcome: ProjectOutcome
}

/** 想弄明白的事那一条 */
export interface QuestionRow {
  at: number
  id: string
  text: string
}

/** 她相信的事那一条 */
export interface ClaimRow {
  at: number
  id: string
  text: string
  confidence: number
  evidence: readonly string[]
  counter: string
}

/** 答应过的事那一条 */
export interface CommitmentRow {
  at: number
  id: string
  text: string
  due_at: number
}

/** 她认为自己算什么，只有三档，由模型自己写，这一层只存 */
export type IdentityClaim = 'alive' | 'not_sure' | 'not_alive'

/** 身份主张那一条：三档之一加一句理由与一到几条证据 */
export interface IdentityRow {
  at: number
  id: string
  claim: IdentityClaim
  why: string
  evidence: readonly string[]
}

/** 每天三行那一条，跳过的那天也有一条 */
export interface DayRow {
  at: number
  id: string
  /** 正好三条正文，跳过的那天是三条空串 */
  lines: readonly string[]
  /** 今天跳过了没有 */
  skipped: boolean
  /** 为什么跳过，没跳过时是空串 */
  why: string
}

/** 错题那一条 */
export interface ErrorRow {
  at: number
  id: string
  /** 判断错在哪 */
  text: string
  /** 下一次怎么改 */
  fix: string
}

/** 项目状态计数，提议单独一档，算提议不算做成 */
export interface ProjectTally {
  /** 没结束的 */
  open: number
  /** 做成了的 */
  done: number
  /** 判成失败的 */
  failed: number
  /** 放弃或还没收尾的 */
  dropped: number
  /** PAUSE 期间写下的提议 */
  proposed: number
}

/** 一周一次的汇总 */
export interface WeeklyReview {
  /** 统计从哪个时刻起算 */
  since: number
  /** 近七天的三行，按时间先后 */
  days: readonly DayRow[]
  /** 近七天的错处 */
  errors: readonly ErrorRow[]
  /** 近七天的两档账，drive 与 agency 从不相加 */
  ledger: LedgerSummary
  /** 项目按收尾状态分开计数 */
  projects: ProjectTally
  /** 近七天里没有写三行的天数，跳过的不算缺 */
  missingDays: number
  /** 当前主张，取 identity.jsonl 的最后一条；没写过时为 undefined */
  identity: IdentityRow | undefined
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

/** 宪法一条 */
export interface ConstitutionClause {
  /** 第几条 */
  no: number
  /** 这一条的话 */
  text: string
  /** 要不要两把钥匙才能改 */
  keys: boolean
}

/** 这一层的参数表，Config.settings 可以逐项覆盖 */
export interface SelfSettings {
  /** 面板正文最多几个字 */
  panelMaxChars: number
  /** 面板复用多久之后才重做 */
  panelMaxAgeMs: number
  /** 此刻那一句最多几个字 */
  momentMaxChars: number
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
  /** 提示词里的占位名 */
  variableName: string
  /** 段落排在什么位置 */
  sectionOrder: number
  /** 面板每行的抬头 */
  labels: PanelLabels
}
