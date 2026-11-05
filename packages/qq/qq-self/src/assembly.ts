// 装配这一层：目录、面板、账本、钥匙、工具、提示词与只读出口接成一个接缝

import type { Context } from '@huoli/cordis'
import type {} from '@huoli/huoli-agent'
import '@huoli/huoli-system-prompt'
import { recordDay as writeDay, skipDay as writeSkip } from './day.ts'
import { resolveSelfDir, resolveSettings } from './defaults.ts'
import { errorsSince, recordError as writeError } from './errors.ts'
import { FILES } from './files.ts'
import { panelFromStore } from './generate.ts'
import { stageAllows } from './grade.ts'
import { identityOf as currentIdentity, recordIdentity as writeIdentity } from './identity.ts'
import { identityCooldownLeft, requireKeys as decideKeys, STAGE_ACTION, stageAdvanceApproved } from './keys.ts'
import { createLedger } from './ledger.ts'
import { mirrorEntries } from './mirror.ts'
import {
  monthlyTick as tickNarrative,
  narrativeDue as narrativeIsDue,
  narrativeStateOf,
  readNarrative as narrativeText,
  seedNarrative as seedNarrativeFile,
  updateNarrative as writeNarrative,
} from './narrative.ts'
import { startPanelHttp, type PanelHttp } from './panel-http.ts'
import { panelStateOf } from './panel-state.ts'
import { panelVitalsOf } from './panel-vitals.ts'
import { panelBody, panelStamp } from './panel.ts'
import { weeklyReview as summarizeWeek } from './review.ts'
import { toProject } from './rows.ts'
import { createSelfStore, newId } from './store.ts'
import { registerSelfTools } from './tools.ts'
import type { Config, QqSelfSeam } from './index.ts'
import type { KeysOutcome, PanelState, SelfMirrorPort, VitalsPort, WriteOutcome } from './types.ts'

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

  // 判一次身份级动作，放行时把这一条写进钥匙账；关着或停手时只回结果不落盘
  const allowKeys = (action: string, userOk: boolean, selfOk: boolean, at: number | undefined): KeysOutcome => {
    const decision = decideKeys(action, userOk, selfOk, settings.identityActions)
    if (!decision.allowed) return { ...decision, proposed: false }
    const stop = off()
    if (stop !== undefined) return { ...decision, proposed: stop.proposed }
    if (store.paused()) return { ...decision, proposed: true }
    const moment = at ?? Date.now()
    // 同一个动作还在冷却里就只留一条提议，不记账也不放行
    if (identityCooldownLeft(store, action, moment, settings.identityCooldownMs) > 0) {
      return { allowed: false, reason: 'cooldown', proposed: true }
    }
    store.append(FILES.keys, { at: moment, id: newId(moment), action, user_ok: userOk, self_ok: selfOk })
    return { ...decision, proposed: false }
  }

  // 只读出口每次现算一份：只读目录，不写盘，也不碰提示词那一段的缓存
  const panelStateNow = (now: number): PanelState => {
    const text = store.readText(FILES.panel)
    const kept = text === undefined ? '' : panelBody(text)
    const stamp = text === undefined ? '' : panelStamp(text)
    const moment = vitals === undefined ? undefined : vitals.render()
    // 身体接上了就把画条要的那几个数一起带出去，没接上就整块省掉
    const body = panelVitalsOf(vitals)
    return panelStateOf({
      store,
      settings,
      now,
      panel: kept === '' ? panelFromStore(store, settings, moment) : kept,
      generatedAt: kept === '' ? '' : stamp,
      ledger: ledger.summary(now),
      ...body === undefined ? {} : { vitals: body },
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
      return allowKeys(action, userOk, selfOk, at)
    },
    approveStageAdvance(userOk, selfOk, at) {
      return allowKeys(STAGE_ACTION, userOk, selfOk, at)
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
      // 推到公开级这一档起要先有一条双钥匙放行，钥匙账里没有就停在这里
      if (stageAllows(to, settings.publicMinStage, settings.stages) && !stageAdvanceApproved(store)) {
        return {
          ok: false,
          stage: from,
          code: 'stage.needs_keys',
          reason: `推到 ${to} 就是公开级了，要先把两把钥匙都交上来`,
          hint: '先调 approveStageAdvance(userOk, selfOk) 记一条 stage.advance，再来推这一档',
        }
      }
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
      return seedNarrativeFile(store, Date.now())
        ? { written: true, proposed: false }
        : { written: false, proposed: false, reason: 'duplicate' }
    },
    updateNarrative(chapter, text, mode) {
      const stop = off()
      if (stop !== undefined) return stop
      const blocked = held()
      if (blocked !== undefined) return blocked
      return writeNarrative(store, settings, chapter, text, Date.now(), mode ?? 'replace')
    },
    narrativeDue(now) {
      return enabled ? narrativeIsDue(store, now) : false
    },
    monthlyTick(now) {
      const stop = off()
      if (stop !== undefined) return { due: false, remind: false, at: now, lastUpdateAt: 0, reason: 'disabled' }
      // 停手期间照样算到期，但不记提醒：醒来之后还欠着这一篇
      if (store.paused()) {
        return {
          due: narrativeIsDue(store, now),
          remind: false,
          at: now,
          lastUpdateAt: narrativeStateOf(store).lastUpdateAt,
          reason: 'paused',
        }
      }
      return tickNarrative(store, now)
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
    // 没有工具服务时写入口这一次挂不上，只记一行；面板与提示词照旧
    const toolSink = ctx.get('tools')
    if (toolSink === undefined) ctx.logger('qq-self').warn('没有工具服务，自我层的写入口这一次没挂')
    else registerSelfTools(toolSink, seam)
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
