// 自我层的装配入口：一个独占目录、一段只读面板、两档账、两把钥匙、一周一复盘

import type { Context } from '@huoli/cordis'
import type {} from '@huoli/huoli-agent'
import '@huoli/huoli-system-prompt'
import { recordDay as writeDay, skipDay as writeSkip } from './day.ts'
import { resolveSelfDir, resolveSettings } from './defaults.ts'
import { errorsSince, recordError as writeError } from './errors.ts'
import { FILES } from './files.ts'
import { panelFromStore } from './generate.ts'
import { identityOf as currentIdentity, recordIdentity as writeIdentity } from './identity.ts'
import { requireKeys as decideKeys } from './keys.ts'
import { createLedger } from './ledger.ts'
import { mirrorEntries } from './mirror.ts'
import { readNarrative as narrativeText, seedNarrative as seedNarrativeFile, updateNarrative as writeNarrative } from './narrative.ts'
import { startPanelHttp, type PanelHttp } from './panel-http.ts'
import { panelStateOf } from './panel-state.ts'
import { panelBody, panelStamp } from './panel.ts'
import { toProject } from './rows.ts'
import { weeklyReview as summarizeWeek } from './review.ts'
import { createSelfStore, newId } from './store.ts'
import type {
  AgencyDetail,
  ClaimInput,
  CommitmentInput,
  DriveDetail,
  DriveNeed,
  ErrorRow,
  IdentityClaim,
  IdentityRow,
  KeysOutcome,
  LedgerSummary,
  LedgerViolation,
  MirrorResult,
  PanelState,
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

export { CLAUSES, renderConstitution } from './constitution.ts'
export { DAY_LINES, localDay } from './day.ts'
export { DEFAULTS, DIR_NAME, resolveSelfDir, resolveSettings } from './defaults.ts'
export { ACTION_KINDS, judgeComment, judgePostLevel, judgePrivate, POST_LEVELS, stageAllows } from './grade.ts'
export { generatePanelFile, panelFromStore } from './generate.ts'
export { IDENTITY_CLAIMS, identityHistory, identityOf, isIdentityClaim, recordIdentity, toIdentity } from './identity.ts'
export { requireKeys } from './keys.ts'
export { auditLedger, createLedger } from './ledger.ts'
export type { LedgerOptions, SelfLedger } from './ledger.ts'
export { MIRROR_FILES, mirrorEntries } from './mirror.ts'
export type { MirrorInput } from './mirror.ts'
export { compressMoment, momentPort } from './moment.ts'
export type { MomentOptions } from './moment.ts'
export { NARRATIVE_CHAPTERS, narrativeSkeleton, readNarrative, seedNarrative, updateNarrative } from './narrative.ts'
export { panelPage, startPanelHttp } from './panel-http.ts'
export type { PanelHttp, PanelHttpOptions } from './panel-http.ts'
export { panelStateOf } from './panel-state.ts'
export type { PanelStateInput } from './panel-state.ts'
export { panelBody, panelFile, panelStamp, renderPanel } from './panel.ts'
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
  PanelDayRow,
  PanelInput,
  PanelLabels,
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
  /** 面板正文，主会话注入与验收都用它 */
  panel(): string
  /** 已生成的那份面板正文，只读缓存文件，不重算 */
  panelText(chatKey: string): string
  /** 面板首行记的生成时间，只读缓存文件 */
  panelGeneratedAt(chatKey: string): string
  /** 只读出口现在绑在哪个端口，没开时为 0 */
  panelPort(): number
  /** 接上身体，面板的此刻只从这里取 */
  useVitals(port: VitalsPort | undefined): void
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
  /** 停手开关在不在 */
  isPaused(): boolean
  /** 现在处在哪个阶段，公共动作按它判能不能发 */
  stage(): string
  /**
   * 按顺序把阶段往前推一档，每次推进留一条痕
   * @param to - 想推到的阶段，只能是紧挨着的下一档
   * @param reason - 为什么推这一档，留痕里要用
   * @param at - 推进的时刻，不给就取现在
   * @returns 推成了给推到的阶段，没推成给码与原因
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
  /** 首次生成叙事骨架，已有那份就不动 */
  seedNarrative(): WriteOutcome
  /** 换掉或续写叙事的一章 */
  updateNarrative(chapter: string, text: string, mode?: 'replace' | 'append'): WriteOutcome
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
  rollback(kind: VersionKind, name: string): RollbackOutcome
  /**
   * 回滚之后逐字核对当前文件与那一份版本
   * @param kind - 面板还是叙事
   * @param name - 要比对的那一份版本名
   * @returns 是否逐字相同，以及首处不同的行号
   */
  verifyAfterRollback(kind: VersionKind, name: string): RollbackCheck
}

/** 这一行接受的配置 */
export interface Config {
  /** 打开这一层，默认关 */
  enabled?: boolean
  /** SELF_DIR 放哪，不给就落在数据根目录下的 data/qq-self */
  dir?: string
  /** 数据根目录，不给就用默认的家目录 */
  huoliHome?: string
  /** 主会话的键，不配就哪个会话都不注入 */
  mainChatKey?: string
  /** 只读面板出口绑哪个端口，默认 0 表示不开；开了只绑回环地址，没有鉴权 */
  panelPort?: number
  /** 想改哪些默认参数 */
  settings?: Partial<SelfSettings>
}

const seams = new WeakMap<Context, QqSelfSeam>()

/**
 * 取这一层，没装配时为 undefined
 * @param ctx - 运行环境
 * @returns 装配好的接口
 */
export function qqSelfOf(ctx: Context): QqSelfSeam | undefined {
  return seams.get(ctx.root) ?? seams.get(ctx)
}

/** 插件的行名 */
export const name = 'qq-self'

/** 要用的内核接口 */
export const inject = ['systemPrompt']

// 超长就截断，字段本身不丢
function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}

/**
 * 装配这一层与它的那一段提示词
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const settings = resolveSettings(config.settings)
  const dir = resolveSelfDir({ dir: config.dir, huoliHome: config.huoliHome })
  const store = createSelfStore({ dir, settings })
  const ledger = createLedger({ store, settings })
  const enabled = config.enabled ?? false
  const mainChatKey = config.mainChatKey ?? ''
  // 出口的端口只认 0 到 65535 的整数，别的写法按不开算
  const wantedPort = config.panelPort ?? 0
  const panelPort = Number.isInteger(wantedPort) && wantedPort >= 0 && wantedPort <= 65_535 ? wantedPort : 0
  let vitals: VitalsPort | undefined
  let memory: SelfMirrorPort | undefined
  let cache: string | undefined
  let broken = false
  let panel: PanelHttp | undefined
  let unloaded = false

  // 画一份新面板：此刻只问身体，其余只问目录
  const build = (): string => {
    store.seedConstitution()
    return panelFromStore(store, settings, vitals === undefined ? undefined : vitals.render())
  }

  // 本进程内定稿一次，之后逐字复用；文件还新就直接用文件里的
  const panelNow = (now: number): string => {
    if (cache !== undefined) return cache
    if (store.fresh(now)) {
      const kept = store.panel()
      if (kept !== undefined && kept !== '') {
        cache = kept
        return kept
      }
    }
    const body = build()
    store.writePanel(body, now)
    cache = body
    return body
  }

  // 关着的时候任何写入都不落盘
  const off = (): WriteOutcome | undefined => enabled ? undefined : { written: false, proposed: false, reason: 'disabled' }

  // 停手期间第二个写入一律只提议
  const held = (): WriteOutcome | undefined => store.paused() ? { written: false, proposed: true, reason: 'paused' } : undefined

  // 只读出口每次现算一份：只读目录，不写盘，也不碰提示词那一段的缓存
  const panelStateNow = (now: number): PanelState => {
    const text = store.readText(FILES.panel)
    const kept = text === undefined ? '' : panelBody(text)
    const stamp = text === undefined ? '' : panelStamp(text)
    const moment = vitals === undefined ? undefined : vitals.render()
    return panelStateOf({
      store,
      settings,
      now,
      panel: kept === '' ? panelFromStore(store, settings, moment) : kept,
      generatedAt: kept === '' ? '' : stamp,
      ledger: ledger.summary(now),
    })
  }

  // 只有主会话键对得上才给读面板，没配主会话就不按会话过滤
  const mine = (chatKey: string): boolean => mainChatKey === '' || chatKey === mainChatKey

  // 阶段读留痕里的最后一条：没推进过就用参数表里的那一档
  const stageNow = (): string => {
    const rows = store.records(FILES.stage)
    for (let at = rows.length - 1; at >= 0; at -= 1) {
      const kept = rows[at]?.to
      if (typeof kept === 'string' && settings.stages.includes(kept)) return kept
    }
    return settings.stage
  }

  const seam: QqSelfSeam = {
    dir,
    panel() {
      return enabled ? panelNow(Date.now()) : ''
    },
    panelText(chatKey) {
      if (!enabled || !mine(chatKey)) return ''
      return store.panel() ?? ''
    },
    panelGeneratedAt(chatKey) {
      if (!enabled || !mine(chatKey)) return ''
      const text = store.readText(FILES.panel)
      return text === undefined ? '' : panelStamp(text)
    },
    panelPort() {
      return panel === undefined ? 0 : panel.port
    },
    useVitals(port) {
      vitals = port
      cache = undefined
    },
    useMemory(port) {
      memory = port
    },
    mirror(at) {
      if (!enabled) return { written: 0, skipped: 0, split: 0, unverified: 0, reason: 'disabled' }
      if (memory === undefined) return { written: 0, skipped: 0, split: 0, unverified: 0, reason: 'no_memory' }
      return mirrorEntries({
        store,
        port: memory,
        at: at ?? Date.now(),
        scope: mainChatKey === '' ? settings.mirrorScope : mainChatKey,
        importance: settings.mirrorImportance,
        maxChars: settings.mirrorMaxChars,
        evidenceMax: settings.claimEvidenceMax,
      })
    },
    recordDrive(need, at, detail) {
      const stop = off()
      if (stop !== undefined) return stop
      return ledger.recordDrive(need, at, detail)
    },
    recordAgency(projectId, why, at, detail) {
      const stop = off()
      if (stop !== undefined) return stop
      return ledger.recordAgency(projectId, why, at, detail)
    },
    ledgerSummary(now) {
      return ledger.summary(now)
    },
    audit(now) {
      return ledger.audit(now)
    },
    requireKeys(action, userOk, selfOk, at) {
      const decision = decideKeys(action, userOk, selfOk, settings.identityActions)
      if (!decision.allowed) return { ...decision, proposed: false }
      const stop = off()
      if (stop !== undefined) return { ...decision, proposed: stop.proposed }
      if (store.paused()) return { ...decision, proposed: true }
      const moment = at ?? Date.now()
      store.append(FILES.keys, { at: moment, id: newId(moment), action, user_ok: userOk, self_ok: selfOk })
      return { ...decision, proposed: false }
    },
    isPaused() {
      return store.paused()
    },
    stage() {
      return stageNow()
    },
    advanceStage(to, reason, at) {
      const from = stageNow()
      const stop = off()
      if (stop !== undefined) return { ok: false, stage: from, code: 'stage.disabled', reason: '这一层关着，推进不落盘', hint: '先把 Config.enabled 打开' }
      const here = settings.stages.indexOf(from)
      const target = settings.stages.indexOf(to)
      if (here < 0 || target < 0) {
        const unknown = here < 0 ? from : to
        return { ok: false, stage: from, code: 'stage.unknown', reason: `认不出 ${unknown} 这一档，阶段只有 ${settings.stages.join('、')}`, hint: '照参数表里那几档的写法写' }
      }
      if (target === here) return { ok: false, stage: from, code: 'stage.same', reason: `已经处在 ${from}，没有可推的`, hint: '往紧挨着的下一档推' }
      if (target < here) return { ok: false, stage: from, code: 'stage.back', reason: `阶段不许后退：现在 ${from}，想退到 ${to}`, hint: '只往前推，退不回去' }
      const next = settings.stages[here + 1] ?? ''
      if (target > here + 1) return { ok: false, stage: from, code: 'stage.skip', reason: `阶段不许跳级：现在 ${from}，下一档是 ${next}，想直接到 ${to}`, hint: `先推到 ${next}` }
      const why = reason.trim()
      if (why === '') return { ok: false, stage: from, code: 'stage.reason_required', reason: '推进要说清为什么', hint: '写一句为什么推这一档' }
      const moment = at ?? Date.now()
      store.append(FILES.stage, { at: moment, id: newId(moment), from, to, reason: why })
      return { ok: true, stage: to, at: moment }
    },
    recordProject(input, at) {
      const stop = off()
      if (stop !== undefined) return stop
      const failIf = clip(input.failIf, settings.questionMaxChars)
      const title = clip(input.title, settings.projectMaxChars)
      if (failIf.trim() === '' || title.trim() === '') return { written: false, proposed: false, reason: 'no_evidence' }
      // 停手期间只留一条提议：算提议不算做成，也不占没结束项目的额度
      if (store.paused()) {
        store.append(FILES.projects, {
          at,
          id: newId(at),
          title,
          next: clip(input.next, settings.nextMaxChars),
          fail_if: failIf,
          outcome: 'dropped',
          proposed: true,
        })
        cache = undefined
        return { written: true, proposed: true }
      }
      const open = store.records(FILES.projects)
        .filter(record => record.proposed !== true && toProject(record)?.outcome === 'open').length
      if (open >= settings.openProjectMax) return { written: false, proposed: false, reason: 'capped' }
      store.append(FILES.projects, {
        at,
        id: newId(at),
        title,
        next: clip(input.next, settings.nextMaxChars),
        fail_if: failIf,
        outcome: 'open',
      })
      cache = undefined
      return { written: true, proposed: false }
    },
    recordQuestion(text, at) {
      const stop = off()
      if (stop !== undefined) return stop
      const blocked = held()
      if (blocked !== undefined) return blocked
      const since = at - settings.weekMs
      const recent = store.records(FILES.questions)
        .filter(record => (typeof record.at === 'number' ? record.at : 0) > since).length
      if (recent >= settings.questionPerWeekMax) return { written: false, proposed: false, reason: 'capped' }
      const line = clip(text, settings.questionMaxChars)
      if (line.trim() === '') return { written: false, proposed: false, reason: 'no_evidence' }
      store.append(FILES.questions, { at, id: newId(at), text: line })
      cache = undefined
      return { written: true, proposed: false }
    },
    recordClaim(input, at) {
      const stop = off()
      if (stop !== undefined) return stop
      const blocked = held()
      if (blocked !== undefined) return blocked
      const text = clip(input.text, settings.claimMaxChars)
      if (text.trim() === '' || input.evidence.length === 0) return { written: false, proposed: false, reason: 'no_evidence' }
      store.append(FILES.claims, {
        at,
        id: newId(at),
        text,
        confidence: input.confidence,
        evidence: [...input.evidence].slice(0, settings.claimEvidenceMax),
        counter: clip(input.counter ?? '', settings.claimMaxChars),
      })
      return { written: true, proposed: false }
    },
    recordCommitment(input, at) {
      const stop = off()
      if (stop !== undefined) return stop
      const blocked = held()
      if (blocked !== undefined) return blocked
      const line = clip(input.text, settings.commitmentMaxChars)
      if (line.trim() === '') return { written: false, proposed: false, reason: 'no_evidence' }
      store.append(FILES.commitments, { at, id: newId(at), text: line, due_at: input.dueAt ?? 0 })
      return { written: true, proposed: false }
    },
    recordIdentity(claim, why, evidence, at) {
      const stop = off()
      if (stop !== undefined) return stop
      const blocked = held()
      if (blocked !== undefined) return blocked
      return writeIdentity(store, settings, claim, why, evidence, at)
    },
    identityOf() {
      return enabled ? currentIdentity(store) : undefined
    },
    narrative() {
      return enabled ? narrativeText(store) : ''
    },
    seedNarrative() {
      const stop = off()
      if (stop !== undefined) return stop
      const blocked = held()
      if (blocked !== undefined) return blocked
      return seedNarrativeFile(store)
        ? { written: true, proposed: false }
        : { written: false, proposed: false, reason: 'duplicate' }
    },
    updateNarrative(chapter, text, mode) {
      const stop = off()
      if (stop !== undefined) return stop
      const blocked = held()
      if (blocked !== undefined) return blocked
      return writeNarrative(store, settings, chapter, text, mode ?? 'replace')
    },
    recordDay(lines, at) {
      const stop = off()
      if (stop !== undefined) return stop
      const blocked = held()
      if (blocked !== undefined) return blocked
      return writeDay(store, settings, lines, at)
    },
    skipDay(why, at) {
      const stop = off()
      if (stop !== undefined) return stop
      const blocked = held()
      if (blocked !== undefined) return blocked
      return writeSkip(store, settings, why, at)
    },
    recordError(text, fix, at) {
      const stop = off()
      if (stop !== undefined) return stop
      const blocked = held()
      if (blocked !== undefined) return blocked
      return writeError(store, settings, text, fix, at)
    },
    errors(sinceAt) {
      return enabled ? errorsSince(store, sinceAt ?? 0) : []
    },
    weeklyReview(now) {
      return summarizeWeek({ store, settings, now, ledger: ledger.summary(now) })
    },
    listVersions(kind) {
      return store.listVersions(kind)
    },
    rollback(kind, name) {
      const stop = off()
      if (stop !== undefined) return { ok: false, code: 'versions.disabled', reason: '这一层关着，回滚不落盘', hint: '先把 Config.enabled 打开' }
      return store.rollback(kind, name)
    },
    verifyAfterRollback(kind, name) {
      return store.verifyAfterRollback(kind, name)
    },
  }
  seams.set(ctx.root, seam)

  // 只读出口：只绑回环地址，这一层关着或端口是 0 就一个都不开
  if (enabled && panelPort === 0 && wantedPort !== 0) {
    ctx.logger('qq-self').warn('只读出口的端口 %s 认不出来，这一次不开', String(wantedPort))
  }
  const opening = enabled && panelPort > 0
    ? startPanelHttp({
      port: panelPort,
      state: panelStateNow,
      warn: (message) => { ctx.logger('qq-self').warn('%s', message) },
    })
    : Promise.resolve(undefined)
  // 起来的那一下才记下端口；卸载先到就当场关掉，绝不留一个在听的端口
  void opening.then((started) => {
    if (started === undefined) return
    if (unloaded) {
      void started.close()
      return
    }
    panel = started
  })

  // 只给主会话注入这一段，其它会话拿到空串
  if (enabled) {
    ctx.systemPrompt.section({
      name: settings.sectionName,
      order: settings.sectionOrder,
      text: `{{${settings.variableName}}}`,
    })
    ctx.systemPrompt.variable(settings.variableName, (context) => {
      const agent = context.agent
      if (mainChatKey === '' || agent === undefined || String(agent.id) !== mainChatKey) return ''
      if (broken) return ''
      try {
        return panelNow(Date.now())
      } catch (error) {
        // 这一轮起不再重试，聊天与别的段照旧
        broken = true
        ctx.logger('qq-self').warn('面板这一段没给出来：%s', String(error))
        return ''
      }
    })
  }

  ctx.effect(() => () => {
    unloaded = true
    seams.delete(ctx.root)
    // 卸载时把出口关掉：等它起完再关，关完那个端口就空出来了
    return opening.then(started => started === undefined ? undefined : started.close())
  })
}
