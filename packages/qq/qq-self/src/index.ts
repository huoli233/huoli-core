// 自我层的装配入口：一个独占目录、一段只读面板、两档账、两把钥匙、一周一复盘


import type {
  AgencyDetail,
  ClaimInput,
  CommitmentInput,
  DriveDetail,
  DriveNeed,
  ErrorRow,
  IdentityClaim,
  IdentityRow,
  InDirVersionKind,
  KeysOutcome,
  LedgerSummary,
  LedgerViolation,
  MirrorResult,
  NarrativeTick,
  PanelAsrStatus,
  ProjectInput,
  RollbackCheck,
  RollbackOutcome,
  SelfMirrorPort,
  SelfSettings,
  StageOutcome,
  VersionEntry,
  VersionKind,
  VitalsPort,
  WeeklyReview,
  WriteOutcome,
} from './types.ts'
import type { PersonaProfile, PersonaProfileInput } from './identity.ts'

export { apply, inject, name, qqSelfOf } from './assembly.ts'
export { CLAUSES, renderConstitution } from './constitution.ts'
export { DAY_LINES, localDay } from './day.ts'
export { DEFAULTS, DIR_NAME, resolveSelfDir, resolveSettings } from './defaults.ts'
export { ACTION_KINDS, judgeComment, judgePostLevel, judgePrivate, POST_LEVELS, stageAllows } from './grade.ts'
export { generatePanelFile, panelFromStore } from './generate.ts'
export {
  createPersonaCatalog,
  IDENTITY_CLAIMS,
  identityHistory,
  identityOf,
  isIdentityClaim,
  recordIdentity,
  toIdentity,
} from './identity.ts'
export type {
  PersonaCatalog,
  PersonaCatalogState,
  PersonaProfile,
  PersonaProfileInput,
  PersonaTone,
} from './identity.ts'
export { requireKeys, STAGE_ACTION, stageAdvanceApproved } from './keys.ts'
export { auditLedger, createLedger } from './ledger.ts'
export type { LedgerOptions, SelfLedger } from './ledger.ts'
export { MIRROR_FILES, mirrorEntries } from './mirror.ts'
export type { MirrorInput } from './mirror.ts'
export {
  NARRATIVE_CHAPTERS,
  monthlyTick,
  narrativeDue,
  narrativeSkeleton,
  narrativeStateOf,
  readNarrative,
  seedNarrative,
  updateNarrative,
} from './narrative.ts'
export { panelPage, startPanelHttp } from './panel-http.ts'
export type { PanelHttp, PanelHttpOptions } from './panel-http.ts'
export { panelStateOf } from './panel-state.ts'
export type { PanelStateInput } from './panel-state.ts'
export { compressMoment, momentPort, panelBody, panelFile, panelStamp, renderPanel } from './panel.ts'
export type { MomentOptions } from './panel.ts'
export { weeklyReview } from './review.ts'
export type { ReviewOptions } from './review.ts'
export { DRIVE_NEEDS, isDriveNeed } from './rows.ts'
export { createSelfStore, newId } from './store.ts'
export type { SelfStore, SelfStoreOptions } from './store.ts'
export type {
  ActionKind,
  AgencyDetail,
  AgencyEntry,
  AgencyOutcome,
  AuditOptions,
  ClaimInput,
  ClaimRow,
  CommentFacts,
  CommitmentInput,
  CommitmentRow,
  ConstitutionClause,
  DayRow,
  DriveDetail,
  DriveEntry,
  DriveNeed,
  ErrorRow,
  GradeDecision,
  IdentityClaim,
  IdentityRow,
  KeysDecision,
  KeysOutcome,
  LedgerEntry,
  LedgerSummary,
  LedgerViolation,
  MirrorKind,
  MirrorResult,
  NarrativeState,
  NarrativeTick,
  NarrativeTickReason,
  PanelAsrStatus,
  PanelDayRow,
  PanelInput,
  PanelLabels,
  PanelLive,
  PanelState,
  PostLevelFacts,
  PrivateFacts,
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
  SelfSettings,
  StageOutcome,
  ExternalVersionKind,
  InDirVersionKind,
  VersionEntry,
  VersionKind,
  VitalsPort,
  WeeklyReview,
  WriteOutcome,
  WriteReason,
} from './types.ts'

/** 这一层对别处露出来的那一面 */
export interface QqSelfSeam {
  /** 这块自我落在哪个目录 */
  readonly dir: string
  /** 面板正文，主会话放进与验收都用它 */
  panel(): string
  /** 已生成的那份面板正文，只读缓存文件，不重算 */
  panelText(chatKey: string): string
  /** 面板首行记的生成时间，只读缓存文件 */
  panelGeneratedAt(chatKey: string): string
  /** 只读出口现在绑在哪个端口，没开时为 0 */
  panelPort(): number
  /** 接上身体，面板的此刻只从这里取 */
  useVitals(port: VitalsPort | undefined): void
  /** 接上全局急停控制 */
  useEmergencyControl(port: EmergencyControlPort | undefined): void
  /** 接上互动模式控制，面板只显示当前层提供的三种模式 */
  useModeControl(port: ModeControlPort | undefined): void
  /** 面板能拧的行为约束 */
  useLimitsControl(port: LimitsControlPort | undefined): void
  /** 接上关系与诊断查看，只供本机面板查询 */
  useQqPanel(port: QqPanelPort | undefined): void
  /** 接上记忆库，镜像只往那里写 */
  useMemory(port: SelfMirrorPort | undefined): void
  /** 把还没镜过的三类记录写进记忆库 */
  mirror(at?: number): MirrorResult
  /** 记一条 drive */
  recordDrive(need: DriveNeed, at: number, detail?: DriveDetail): WriteOutcome
  /** 记一条 agency */
  recordAgency(projectId: string, why: string, at: number, detail?: AgencyDetail): WriteOutcome
  /** 两档分开计数 */
  ledgerSummary(now: number): LedgerSummary
  /** 判据三与判据四查出来的违规，每日维护拿它写日志 */
  audit(now: number): readonly LedgerViolation[]
  /** 判级并留痕 */
  requireKeys(action: string, userOk: boolean, selfOk: boolean, at?: number): KeysOutcome
  /**
   * 记一次抬级的放行：两把钥匙都在才往 keys.jsonl 写一条 stage.advance
   * @param userOk - 用户那把钥匙
   * @param selfOk - 她自己那把钥匙
   * @param at - 放行的时刻，不给就取现在
   * @returns 放行结果与是不是只提议
   */
  approveStageAdvance(userOk: boolean, selfOk: boolean, at?: number): KeysOutcome
  /** 停手开关在不在 */
  isPaused(): boolean
  /** 现在处在哪个阶段，公共动作按它判能不能发 */
  stage(): string
  /**
   * 按顺序把阶段往前推一档，每次推进留一条痕
   * @param to - 想推到的阶段，只能是紧挨着的下一档
   * @param reason - 为什么推这一档，留痕里要用
   * @param at - 推进的时刻，不给就取现在
   * @returns 推成了给推到的阶段，没推成给码与原因；推到公开级起要求先有一条双钥匙放行的 stage.advance，没有就回 stage.needs_keys
   */
  advanceStage(to: string, reason: string, at?: number): StageOutcome
  /** 记一个项目，停手期间只写一条提议 */
  recordProject(input: ProjectInput, at: number): WriteOutcome
  /** 记一条想问的事 */
  recordQuestion(text: string, at: number): WriteOutcome
  /** 记一条她相信的事 */
  recordClaim(input: ClaimInput, at: number): WriteOutcome
  /** 记一件答应过的事 */
  recordCommitment(input: CommitmentInput, at: number): WriteOutcome
  /**
   * 记一条她对自己算什么的主张：三档之一加理由与证据，写一条留一条，当前主张取最后一条
   * @param claim - alive、not_sure、not_alive 三档之一
   * @param why - 她自己的理由
   * @param evidence - 一到几条证据，记忆编号或日期
   * @param at - 记下的时刻
   * @returns 落没落盘，缺理由或缺证据一律不落
   */
  recordIdentity(claim: IdentityClaim, why: string, evidence: readonly string[], at: number): WriteOutcome
  /** 当前主张：取最后写进去的那一条，没写过时为 undefined */
  identityOf(): IdentityRow | undefined
  /** 叙事全文，还没生成时为空串 */
  narrative(): string
  /** 首次生成叙事底稿，已有那份就不动 */
  seedNarrative(): WriteOutcome
  /** 换掉或续写叙事的一章 */
  updateNarrative(chapter: string, text: string, mode?: 'replace' | 'append'): WriteOutcome
  /**
   * 叙事该不该重写了：从上次更新起满一个日历月，从没写过也算到期
   * @param now - 判断的时刻
   * @returns 到期为真，这一层关着恒为假
   */
  narrativeDue(now: number): boolean
  /**
   * 月更提醒：到期时给出「该写叙事」的信号，只给信号不写正文
   * @param now - 判断的时刻
   * @returns 到期没有、这一次要不要提醒；同一个月只提醒一次，PAUSE 下不记提醒
   */
  monthlyTick(now: number): NarrativeTick
  /** 记当天的三行 */
  recordDay(lines: readonly string[], at: number): WriteOutcome
  /** 今天跳过，原因要写 */
  skipDay(why: string, at: number): WriteOutcome
  /** 记一条判断错的地方与改法 */
  recordError(text: string, fix: string, at: number): WriteOutcome
  /** 某一刻之后的错处，不给起点就从最早算 */
  errors(sinceAt?: number): ErrorRow[]
  /** 近七天的汇总：三行、错处、两档账、项目状态 */
  weeklyReview(now: number): WeeklyReview
  /** 记一条每月十问：一个月一条，正好十问 */
  probe(answers: readonly string[], at: number): WriteOutcome
  /** 三行真写进去了才通知，返回撤掉的函数 */
  onDay(listener: (lines: readonly string[], at: number) => void): () => void
  /** 阶段真推进了才通知，返回撤掉的函数 */
  onStage(listener: (from: string, to: string, at: number) => void): () => void
  /** 叙事真写进去了才通知，返回撤掉的函数 */
  onNarrative(listener: (chapter: string, text: string, at: number) => void): () => void
  /** 十问真写进去了才通知，返回撤掉的函数 */
  onProbe(listener: (answers: readonly string[], at: number) => void): () => void
  /** 这个月那一次十问，没写过就是 undefined */
  probeThisMonth(at: number): Record<string, unknown> | undefined
  /**
   * 列一个种类的旧版本，最近的在前
   * @param kind - 面板还是叙事
   * @returns 每份版本的名字、种类、时刻与字节数
   */
  listVersions(kind: VersionKind): VersionEntry[]
  /**
   * 回滚到某一份旧版本，动手前先把现场存成新版本
   * @param kind - 面板还是叙事，名字必须属于这个种类
   * @param name - listVersions 给的名字，逐字相同
   * @returns 从哪一份恢复、现场存成了哪一份，或一个带原因与提示的码
   */
  rollback(kind: InDirVersionKind, name: string): RollbackOutcome
  /**
   * 回滚之后逐字核对当前文件与那一份版本
   * @param kind - 面板还是叙事
   * @param name - 要比对的那一份版本名
   * @returns 是否逐字相同，以及首处不同的行号
   */
  verifyAfterRollback(kind: InDirVersionKind, name: string): RollbackCheck
  /**
   * 人格规矩存下来的那几版，最近的在前
   * @returns 每份版本的名字、种类、时刻与字节数
   */
  rulesVersions(): VersionEntry[]
  /**
   * 用某一版人格规矩盖回配置文件里那份，盖之前先把现场存一版
   * @param name - rulesVersions 给的名字，逐字相同
   * @returns 从哪一份恢复、现场存成了哪一份，或一个带原因与提示的码
   */
  restoreRules(name: string): RollbackOutcome
  /**
   * 现在这份人格正文
   * @returns 文件里的正文，文件不在时是空串
   */
  persona(): string
  /**
   * 人格正文存下来的那几版，最近的在前
   * @returns 每份版本的名字、种类、时刻与字节数
   */
  personaVersions(): VersionEntry[]
  /**
   * 用某一版人格正文盖回去，盖之前先把现场存一版
   * @param name - personaVersions 给的名字，逐字相同
   * @returns 从哪一份恢复、现场存成了哪一份，或一个带原因与提示的码
   */
  restorePersona(name: string): RollbackOutcome
  /** 当前会话选中的角色补充档案 */
  personaProfile(chatKey: string): PersonaProfile | undefined
  /** 所有角色补充档案 */
  personaProfiles(): PersonaProfile[]
  /** 新建或修改一份角色补充档案 */
  savePersonaProfile(input: PersonaProfileInput, at?: number): WriteOutcome
  /** 选全局默认角色 */
  setActivePersona(id: string): WriteOutcome
  /** 给某个群或私聊绑定角色，空串表示解除绑定 */
  bindPersona(chatKey: string, id: string): WriteOutcome
  /** 删除一份角色补充档案 */
  removePersonaProfile(id: string): WriteOutcome
}

/** 面板能操作的全局急停 */
export interface EmergencyControlPort {
  /** 当前状态 */
  state(): { active: boolean; at: number; reason: string }
  /** 打开急停 */
  stop(reason: string): unknown
  /** 解除急停 */
  resume(): unknown
}

/** 面板能切换的互动模式 */
export interface ModeControlPort {
  state(): { mode: string; changedAt: number }
  options: readonly { value: string; label: string; description?: string }[]
  set(mode: string): unknown
}

/** 面板能拧的几个约束：静默多久、还开不开口、每小时几条、几点睡 */
export interface LimitsControlPort {
  /** 现在这几项各是多少 */
  state(): LimitsState
  /** 改其中任意几项，返回改完的结果 */
  set(patch: Partial<LimitsState>): LimitsState
}

/** 面板上能改的行为约束 */
export interface LimitsState {
  /** 还要静默多少分钟，0 表示不静默 */
  quietMinutes: number
  /** 关掉之后完全不主动开口，只回人 */
  proactiveAllowed: boolean
  /** 每小时最多主动开口几次 */
  proactivePerHour: number
  /** 几点开始睡 */
  sleepFrom: number
  /** 几点醒 */
  sleepUntil: number
}

/** QQ 关系与诊断的本机只读出口 */
export interface QqPanelPort {
  relation(personId: string, chatKey: string): unknown
  timeline(traceId: string, limit: number): unknown
  asrStatus?(): PanelAsrStatus | undefined
  /** DSH 与 QQ 运行身体的真实健康读数 */
  health?(): {
    score: number
    status: string
    checkedAt: number
    issues: readonly string[]
  } | undefined
}

/** 这一行接受的配置 */
export interface Config {
  /** 打开这一层，默认关 */
  enabled?: boolean
  /** SELF_DIR 放哪，不给就落在数据根目录下的 data/qq-self */
  dir?: string
  /** 数据根目录，不给就用默认的家目录 */
  huoliHome?: string
  /** 人格规矩那份文件在哪，填了就在启动时存一版，改坏了能拿旧版盖回来 */
  rulesFile?: string
  /** 人格正文那份文件在哪，不填就放在自我层目录下的 persona.md */
  personaFile?: string
  /** 第一次启动时用来落成文件的那段人格，文件已经在就不覆盖 */
  personaSeed?: string
  /** 角色补充档案文件，不填就放在自我层目录下的 persona-profiles.json */
  personaProfilesFile?: string
  /** 首次启动时写入的角色补充档案；已有同编号不覆盖 */
  personaProfiles?: readonly PersonaProfileInput[]
  /** 第一次启动时默认选哪个角色 */
  activePersonaId?: string
  /** 主会话的键，不配就哪个会话都不放进 */
  mainChatKey?: string
  /** 只读面板出口绑哪个端口，默认 0 表示不开；开了只绑回环地址 */
  panelPort?: number
  /** 面板访问口令，设了就要带 `?token=` 或那块饼干；空串等于不要求 */
  panelToken?: string
  /** 记忆文件放哪，星海读它；不给就跟记忆包的默认位置一致 */
  memoryFile?: string
  /** 想改哪些默认参数 */
  settings?: Partial<SelfSettings>
}
