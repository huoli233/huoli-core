// 目录里存下的类型：记录表、行、身份、写入、版本、镜像与叙事

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

/** 记录表里的一行，只有这两档 */
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

/** 记录表判据查出来的一条违规 */
export interface LedgerViolation {
  /** 哪条判据：三是有产出才算做成，四是隔一两周要有一次失败 */
  rule: 'done_without_artifact' | 'no_recent_failed'
  /** 一句可读的说明 */
  text: string
  /** 牵扯的条数 */
  count: number
}

/** 查判据三与判据四的说法 */
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
  | 'rest'
  | 'wrong_count'

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
  /** 比不了时给人看的下一步 */
  hint?: string
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

/** 宪法一条 */
export interface ConstitutionClause {
  /** 第几条 */
  no: number
  /** 这一条的话 */
  text: string
  /** 要不要两把钥匙才能改 */
  keys: boolean
}
