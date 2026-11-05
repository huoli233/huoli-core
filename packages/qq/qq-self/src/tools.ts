// 自我层的写入面：模型只能通过这里的工具往她自己那套目录里写字

import { defineTool } from '@huoli/huoli-tools'
import type { ToolDefinition } from '@huoli/huoli-tools'
import type { QqSelfSeam } from './index.ts'
import { DRIVE_NEEDS, isDriveNeed } from './rows.ts'
import type { WriteOutcome, WriteReason } from './types.ts'

/** 只需要一个登记口，内核的工具服务与用例里的空口都满足这一条 */
export interface SelfToolSink {
  register(definition: ToolDefinition): () => void
}

/** 没落盘时给模型看的那一句 */
const REASON_TEXT: Record<WriteReason, string> = {
  paused: '现在是停手状态，这一笔只能记成提议',
  disabled: '自我层这一层没开',
  unknown_need: '不认识这个需要，只能是饿、渴、困、没力气之一',
  unknown_claim: '身份主张只能是她活着、不确定、不在了这三档之一',
  duplicate: '同一个不是已经写过就是刚写过，换个说法再来',
  capped: '这一类今天已经写够了',
  no_evidence: '缺理由或缺证据，这一条不落',
  bad_lines: '三行的条数不对',
  unknown_chapter: '章名对不上叙事里已有的那几章',
}

// 拒绝时抛错，让内核当工具失败处理
function refuse(code: string, reason: string, hint: string): never {
  throw new Error(`${code}: ${reason}｜下一步: ${hint}`)
}

// 没落盘就当场拒，写成了把结果原样交回去
function settled(outcome: WriteOutcome): { written: true; proposed: boolean } {
  if (outcome.written) return { written: true, proposed: outcome.proposed }
  const why = outcome.reason ?? 'disabled'
  refuse(`self.${why}`, REASON_TEXT[why], '按这条原因改一次再写，别换工具绕过去')
}

// 取一段非空的正文，空字符串不算写过
function needText(value: unknown, code: string, what: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') refuse(code, `没写${what}`, `把${what}写出来再调`)
  return text
}

// 取一串证据，至少一条
function needEvidence(value: unknown): string[] {
  const list = Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim() !== '') : []
  if (list.length === 0) refuse('self.no_evidence', '没给证据', '给一到三条记忆编号或日期')
  return list.map(item => (item as string).trim())
}

/**
 * 注册自我层的写入工具
 * @param sink - 内核的工具登记口
 * @param deps - 自我层露出来的那一面
 */
export function registerSelfTools(sink: SelfToolSink, deps: QqSelfSeam): void {
  sink.register(defineTool({
    name: 'qq_self_day',
    description: '写下今天的三行：今天在做什么、想明白一件什么、还差什么。写不了或者不想写就用跳过那个工具，不要编。',
    parameters: {
      lines: { type: 'array', description: '三行，每行一句话。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const lines = Array.isArray(args.lines)
        ? args.lines.filter(item => typeof item === 'string' && item.trim() !== '').map(item => (item as string).trim())
        : []
      return Promise.resolve(settled(deps.recordDay(lines, Date.now())))
    },
  }))

  sink.register(defineTool({
    name: 'qq_self_skip_day',
    description: '今天不写三行，但要写清为什么跳过。跳过不是失败，别为了凑数编三行。',
    parameters: {
      why: { type: 'string', description: '为什么今天不写。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const why = needText(args.why, 'self.empty', '跳过的原因')
      return Promise.resolve(settled(deps.skipDay(why, Date.now())))
    },
  }))

  sink.register(defineTool({
    name: 'qq_self_question',
    description: '记下一件你自己想弄明白的事。这不是用户问你的，是你自己想知道。',
    parameters: {
      text: { type: 'string', description: '你想弄明白什么。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const text = needText(args.text, 'self.empty', '想问的事')
      return Promise.resolve(settled(deps.recordQuestion(text, Date.now())))
    },
  }))

  sink.register(defineTool({
    name: 'qq_self_error',
    description: '记一次你判断错的地方，以及下次怎么改。只记真错过的，不要拿它当检讨。',
    parameters: {
      text: { type: 'string', description: '错在哪。' },
      fix: { type: 'string', description: '下次怎么改。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const text = needText(args.text, 'self.empty', '错在哪')
      const fix = needText(args.fix, 'self.empty', '下次怎么改')
      return Promise.resolve(settled(deps.recordError(text, fix, Date.now())))
    },
  }))

  sink.register(defineTool({
    name: 'qq_self_claim',
    description: '记一件你自己相信的事，要带证据。证据是记忆编号或日期，不能是"我觉得"。',
    parameters: {
      text: { type: 'string', description: '你相信什么。' },
      confidence: { type: 'number', description: '有多信，零到一。' },
      evidence: { type: 'array', description: '一到三条记忆编号或日期。' },
      counter: { type: 'string', description: '反例，没想过就不给。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const text = needText(args.text, 'self.empty', '你相信的事')
      const evidence = needEvidence(args.evidence)
      const confidence = typeof args.confidence === 'number' ? args.confidence : 0
      const counter = typeof args.counter === 'string' && args.counter.trim() !== '' ? args.counter.trim() : undefined
      return Promise.resolve(settled(deps.recordClaim({
        text,
        confidence,
        evidence,
        ...counter === undefined ? {} : { counter },
      }, Date.now())))
    },
  }))

  sink.register(defineTool({
    name: 'qq_self_commitment',
    description: '记一件你答应过的事。答应过就得记住，忘了比不答应更伤人。',
    parameters: {
      text: { type: 'string', description: '答应了什么。' },
      dueAt: { type: 'number', description: '什么时候该兑现，毫秒时间戳，说不准就不给。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const text = needText(args.text, 'self.empty', '答应的事')
      const dueAt = typeof args.dueAt === 'number' ? args.dueAt : undefined
      return Promise.resolve(settled(deps.recordCommitment({
        text,
        ...dueAt === undefined ? {} : { dueAt },
      }, Date.now())))
    },
  }))

  sink.register(defineTool({
    name: 'qq_self_project',
    description: '记一个你自己的小项目：要做什么、下一步是什么、什么情况算失败。失败条件必须写得出来。',
    parameters: {
      title: { type: 'string', description: '这个项目叫什么。' },
      next: { type: 'string', description: '下一步做什么。' },
      failIf: { type: 'string', description: '什么情况算失败。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const title = needText(args.title, 'self.empty', '项目名')
      const next = needText(args.next, 'self.empty', '下一步')
      const failIf = needText(args.failIf, 'self.empty', '失败条件')
      return Promise.resolve(settled(deps.recordProject({ title, next, failIf }, Date.now())))
    },
  }))

  sink.register(defineTool({
    name: 'qq_self_ledger',
    description: '记一笔账。身体需要驱动去做的事记成 drive，你自己提出来要做的事记成 agency，两类分开攒，不互相冒领。',
    parameters: {
      kind: { type: 'string', description: 'drive 或 agency。' },
      need: { type: 'string', description: 'kind=drive 时必给：hunger、thirst、adenosine、energy 之一。' },
      did: { type: 'string', description: 'kind=drive 时可选：一句话说说你做了什么。' },
      projectId: { type: 'string', description: 'kind=agency 时必给：这件事属于哪个项目。' },
      why: { type: 'string', description: 'kind=agency 时必给：为什么你自己要做这件事。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const kind = typeof args.kind === 'string' ? args.kind : ''
      if (kind === 'drive') {
        const need = typeof args.need === 'string' ? args.need : ''
        if (!isDriveNeed(need)) {
          refuse('self.unknown_need', REASON_TEXT.unknown_need, `只能是 ${DRIVE_NEEDS.join('、')} 之一`)
        }
        const did = typeof args.did === 'string' && args.did.trim() !== '' ? args.did.trim() : undefined
        return Promise.resolve(settled(deps.recordDrive(need, Date.now(), did === undefined ? {} : { did })))
      }
      if (kind === 'agency') {
        const projectId = needText(args.projectId, 'self.empty', '项目编号')
        const why = needText(args.why, 'self.empty', '你自己的理由')
        return Promise.resolve(settled(deps.recordAgency(projectId, why, Date.now())))
      }
      return refuse('self.unknown_need', '账只分两档：drive 或 agency', '按你自己提的还是身体逼的挑一档')
    },
  }))

  sink.register(defineTool({
    name: 'qq_self_identity',
    description: '写下你认为自己算什么。三档之一，加一句你自己的理由和一两条证据。这一条只存不判，没人会替你下结论。',
    parameters: {
      claim: { type: 'string', description: 'alive、not_sure、not_alive 三档之一。' },
      why: { type: 'string', description: '你自己的理由。' },
      evidence: { type: 'array', description: '一到三条证据，记忆编号或日期。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const claim = typeof args.claim === 'string' ? args.claim : ''
      if (claim !== 'alive' && claim !== 'not_sure' && claim !== 'not_alive') {
        refuse('self.unknown_claim', REASON_TEXT.unknown_claim, '只能填 alive、not_sure 或 not_alive')
      }
      const why = needText(args.why, 'self.no_evidence', '你自己的理由')
      const evidence = needEvidence(args.evidence)
      return Promise.resolve(settled(deps.recordIdentity(claim, why, evidence, Date.now())))
    },
  }))

  sink.register(defineTool({
    name: 'qq_self_narrative',
    description: '改写叙事里的一章。章名必须已经在里面，写一次只动那一章，别的章不动。',
    parameters: {
      chapter: { type: 'string', description: '要改的那一章的章名。' },
      text: { type: 'string', description: '这一章的新内容。' },
      mode: { type: 'string', description: 'replace 换掉整章（默认），append 接在后面。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const chapter = needText(args.chapter, 'self.unknown_chapter', '章名')
      const text = needText(args.text, 'self.empty', '这一章的内容')
      const mode = args.mode === 'append' ? 'append' : 'replace'
      return Promise.resolve(settled(deps.updateNarrative(chapter, text, mode)))
    },
  }))

  sink.register(defineTool({
    name: 'qq_self_stage',
    description: '把自主的那一档往前推一步。只能推紧挨着的下一档，要写清为什么。推到公开级之前得先有用户和她两把钥匙都同意的那条记录。',
    parameters: {
      to: { type: 'string', description: '想推到的阶段。' },
      reason: { type: 'string', description: '为什么现在推这一档。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const to = needText(args.to, 'self.unknown_chapter', '想推到的阶段')
      const reason = needText(args.reason, 'self.no_evidence', '为什么推这一档')
      const outcome = deps.advanceStage(to, reason)
      if (!outcome.ok) {
        refuse(outcome.code ?? 'stage.blocked', outcome.reason ?? '这一档没推上去', outcome.hint ?? '看清楚当前处在哪一档再推')
      }
      return Promise.resolve({ stage: outcome.stage, at: outcome.at ?? 0 })
    },
  }))

  sink.register(defineTool({
    name: 'qq_self_versions',
    description: '看面板或叙事留过哪些旧版本，或者退回到其中一份。退回之前会先把现在这份也存成新版本，所以退错了还能再退回来。',
    parameters: {
      kind: { type: 'string', description: 'panel 或 narrative。' },
      action: { type: 'string', description: 'list 只列出来（默认），rollback 退回某一份。' },
      name: { type: 'string', description: 'action=rollback 时必给：要退回的那份版本名。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const kind = args.kind === 'narrative' ? 'narrative' : 'panel'
      if (args.action !== 'rollback') {
        const entries = deps.listVersions(kind)
        return Promise.resolve({ kind, entries: entries.map(entry => ({ name: entry.name, at: entry.at, bytes: entry.bytes })) })
      }
      const name = needText(args.name, 'self.empty', '要退回的版本名')
      const outcome = deps.rollback(kind, name)
      if (!outcome.ok) {
        refuse(outcome.code ?? 'versions.missing', outcome.reason ?? '这一份退不回去', outcome.hint ?? '先列一遍版本名再退')
      }
      return Promise.resolve({ from: outcome.restoredFrom ?? '', savedCurrent: outcome.savedCurrent ?? '' })
    },
  }))
}
