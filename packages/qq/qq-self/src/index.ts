// 自我层的装配入口：一个独占目录、一段只读面板、两档账、两把钥匙

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import type {} from '@huoli/huoli-agent'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import '@huoli/huoli-system-prompt'
import { DIR_NAME, resolveSettings } from './defaults.ts'
import { requireKeys as decideKeys } from './keys.ts'
import { createLedger } from './ledger.ts'
import { mirrorEntries } from './mirror.ts'
import { renderPanel } from './panel.ts'
import { toProject, toQuestion } from './rows.ts'
import { createSelfStore, newId } from './store.ts'
import type {
  AgencyDetail,
  ClaimInput,
  CommitmentInput,
  DriveDetail,
  DriveNeed,
  KeysOutcome,
  LedgerSummary,
  MirrorResult,
  PanelInput,
  ProjectInput,
  ProjectRow,
  QuestionRow,
  SelfMirrorPort,
  SelfSettings,
  StageOutcome,
  VitalsPort,
  WriteOutcome,
} from './types.ts'

export { CLAUSES, renderConstitution } from './constitution.ts'
export { DEFAULTS, DIR_NAME, resolveSettings } from './defaults.ts'
export { ACTION_KINDS, judgeComment, judgePostLevel, judgePrivate, POST_LEVELS, stageAllows } from './grade.ts'
export { requireKeys } from './keys.ts'
export { createLedger } from './ledger.ts'
export type { LedgerOptions, SelfLedger } from './ledger.ts'
export { MIRROR_FILES, mirrorEntries } from './mirror.ts'
export type { MirrorInput } from './mirror.ts'
export { panelBody, panelFile, renderPanel } from './panel.ts'
export { DRIVE_NEEDS, isDriveNeed } from './rows.ts'
export { createSelfStore, newId } from './store.ts'
export type { SelfStore, SelfStoreOptions } from './store.ts'
export type {
  ActionKind,
  AgencyDetail,
  AgencyEntry,
  AgencyOutcome,
  ClaimInput,
  ClaimRow,
  CommentFacts,
  CommitmentInput,
  CommitmentRow,
  ConstitutionClause,
  DriveDetail,
  DriveEntry,
  DriveNeed,
  GradeDecision,
  KeysDecision,
  KeysOutcome,
  LedgerEntry,
  LedgerSummary,
  MirrorKind,
  MirrorResult,
  PanelInput,
  PanelLabels,
  PostLevelFacts,
  PrivateFacts,
  ProjectInput,
  ProjectOutcome,
  ProjectRow,
  QuestionRow,
  SelfMirrorEntry,
  SelfMirrorPort,
  SelfMirrorWrite,
  SelfSettings,
  StageOutcome,
  VitalsPort,
  WriteOutcome,
} from './types.ts'

/** 这一层对别处露出来的那一面 */
export interface QqSelfSeam {
  /** 这块自我落在哪个目录 */
  readonly dir: string
  /** 面板正文，主会话注入与验收都用它 */
  panel(): string
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
  /** 记一个项目 */
  recordProject(input: ProjectInput, at: number): WriteOutcome
  /** 记一条想问的事 */
  recordQuestion(text: string, at: number): WriteOutcome
  /** 记一条她相信的事 */
  recordClaim(input: ClaimInput, at: number): WriteOutcome
  /** 记一件答应过的事 */
  recordCommitment(input: CommitmentInput, at: number): WriteOutcome
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

// 目录里这几份事件流，写进去时按这些名字找
const PROJECTS = 'projects.jsonl'
const QUESTIONS = 'questions.jsonl'
const CLAIMS = 'claims.jsonl'
const COMMITMENTS = 'commitments.jsonl'
const KEYS = 'keys.jsonl'
// 阶段推进单独留痕：keys.jsonl 每行是一次两把钥匙的授权，混进去就分不清授权与推进
const STAGE_LOG = 'stage.jsonl'

/**
 * 装配这一层与它的那一段提示词
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const settings = resolveSettings(config.settings)
  const dir = config.dir ?? path.join(resolveHuoliHome(config.huoliHome), 'data', DIR_NAME)
  const store = createSelfStore({ dir, settings })
  const ledger = createLedger({ store, settings })
  const enabled = config.enabled ?? false
  const mainChatKey = config.mainChatKey ?? ''
  let vitals: VitalsPort | undefined
  let memory: SelfMirrorPort | undefined
  let cache: string | undefined
  let broken = false

  const newestProject = (): ProjectRow | undefined => {
    let picked: ProjectRow | undefined
    for (const record of store.records(PROJECTS)) {
      const row = toProject(record)
      if (row === undefined || row.outcome !== 'open') continue
      if (picked === undefined || row.at > picked.at) picked = row
    }
    return picked
  }

  const newestQuestion = (): QuestionRow | undefined => {
    let picked: QuestionRow | undefined
    for (const record of store.records(QUESTIONS)) {
      const row = toQuestion(record)
      if (row === undefined) continue
      if (picked === undefined || row.at > picked.at) picked = row
    }
    return picked
  }

  // 画一份新面板：此刻只问身体，其余只问目录
  const build = (): string => {
    store.seedConstitution()
    const project = newestProject()
    const question = newestQuestion()
    const input: PanelInput = {
      ...vitals === undefined ? {} : { moment: vitals.render() },
      ...project === undefined ? {} : { project: project.title, next: project.next },
      ...question === undefined ? {} : { question: question.text },
    }
    return renderPanel(input, settings)
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

  // 阶段读留痕里的最后一条：没推进过就用参数表里的那一档
  const stageNow = (): string => {
    const rows = store.records(STAGE_LOG)
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
    useVitals(port) {
      vitals = port
      cache = undefined
    },
    useMemory(port) {
      memory = port
    },
    mirror(at) {
      if (!enabled) return { written: 0, skipped: 0, overlong: 0, reason: 'disabled' }
      if (memory === undefined) return { written: 0, skipped: 0, overlong: 0, reason: 'no_memory' }
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
    requireKeys(action, userOk, selfOk, at) {
      const decision = decideKeys(action, userOk, selfOk, settings.identityActions)
      if (!decision.allowed) return { ...decision, proposed: false }
      const stop = off()
      if (stop !== undefined) return { ...decision, proposed: stop.proposed }
      if (store.paused()) return { ...decision, proposed: true }
      const moment = at ?? Date.now()
      store.append(KEYS, { at: moment, id: newId(moment), action, user_ok: userOk, self_ok: selfOk })
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
      store.append(STAGE_LOG, { at: moment, id: newId(moment), from, to, reason: why })
      return { ok: true, stage: to, at: moment }
    },
    recordProject(input, at) {
      const stop = off()
      if (stop !== undefined) return stop
      if (store.paused()) return { written: false, proposed: true, reason: 'paused' }
      const open = store.records(PROJECTS).filter(record => toProject(record)?.outcome === 'open').length
      if (open >= settings.openProjectMax) return { written: false, proposed: false, reason: 'capped' }
      const failIf = clip(input.failIf, settings.questionMaxChars)
      if (failIf.trim() === '') return { written: false, proposed: false, reason: 'no_evidence' }
      const title = clip(input.title, settings.projectMaxChars)
      if (title.trim() === '') return { written: false, proposed: false, reason: 'no_evidence' }
      store.append(PROJECTS, {
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
      if (store.paused()) return { written: false, proposed: true, reason: 'paused' }
      const since = at - settings.weekMs
      const recent = store.records(QUESTIONS).filter(record => (toQuestion(record)?.at ?? 0) > since).length
      if (recent >= settings.questionPerWeekMax) return { written: false, proposed: false, reason: 'capped' }
      const line = clip(text, settings.questionMaxChars)
      if (line.trim() === '') return { written: false, proposed: false, reason: 'no_evidence' }
      store.append(QUESTIONS, { at, id: newId(at), text: line })
      cache = undefined
      return { written: true, proposed: false }
    },
    recordClaim(input, at) {
      const stop = off()
      if (stop !== undefined) return stop
      if (store.paused()) return { written: false, proposed: true, reason: 'paused' }
      const text = clip(input.text, settings.claimMaxChars)
      if (text.trim() === '' || input.evidence.length === 0) return { written: false, proposed: false, reason: 'no_evidence' }
      store.append(CLAIMS, {
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
      if (store.paused()) return { written: false, proposed: true, reason: 'paused' }
      const line = clip(input.text, settings.commitmentMaxChars)
      if (line.trim() === '') return { written: false, proposed: false, reason: 'no_evidence' }
      store.append(COMMITMENTS, { at, id: newId(at), text: line, due_at: input.dueAt ?? 0 })
      return { written: true, proposed: false }
    },
  }
  seams.set(ctx.root, seam)

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
    seams.delete(ctx.root)
  })
}
