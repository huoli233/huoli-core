// 自我层对外的类型：面板输入、两档账、钥匙判定、目录里的行

/** 身体露给面板的那一面，只读 */
export interface VitalsPort {
  /** 身体给的那一句，面板原样用，不再加工 */
  render(): string
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

/** 一次写入的结果 */
export interface WriteOutcome {
  /** 落盘了没有 */
  written: boolean
  /** 是不是只提议，PAUSE 下为真 */
  proposed: boolean
  /** 没落盘的原因 */
  reason?: 'paused' | 'disabled' | 'unknown_need' | 'duplicate' | 'capped' | 'no_evidence'
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


/** 一次钥匙判定 */
export interface KeysDecision {
  /** 放行了没有 */
  allowed: boolean
  /** 没放行的原因 */
  reason?: 'unknown_action' | 'user_key' | 'self_key'
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
  /** 答应的事最多几个字 */
  commitmentMaxChars: number
  /** 同时最多几个没结束的项目 */
  openProjectMax: number
  /** 一周最多问几条 */
  questionPerWeekMax: number
  /** 一周多长 */
  weekMs: number
  /** 身体的四种需要 */
  driveNeeds: readonly DriveNeed[]
  /** 身份级动作清单，逐字匹配 */
  identityActions: readonly string[]
  /** 提示词里的段落名 */
  sectionName: string
  /** 提示词里的占位名 */
  variableName: string
  /** 段落排在什么位置 */
  sectionOrder: number
  /** 面板每行的抬头 */
  labels: PanelLabels
}
