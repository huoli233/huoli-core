// 自学课：把学到的东西按「对象.方面」存成可检索的一条，新的取代旧的。
// 用独立 SQLite + FTS5；不碰主记忆 JSON，也不让模型自己改代码或装插件。
import { randomUUID } from '@huoli/huoli-util-crypto'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import type { Context } from '@huoli/cordis'
import { defineTool } from '@huoli/huoli-tools'

/** 一条学习记录 */
export interface SelfLesson {
  id: string
  object: string
  aspect: string
  oneLine: string
  detail: string
  why: string
  source: string
  confidence: number
  at: number
  updatedAt: number
}

/** 记一条时要给的东西 */
export interface SelfLessonInput {
  object: string
  aspect: string
  oneLine: string
  detail?: string
  why?: string
  source?: string
  confidence?: number
}

/** 一条「我想怎么改」的提案：只记录，不自动应用 */
export interface SelfProposal {
  id: string
  lessonId: string
  target: string
  change: string
  why: string
  verify: string
  risk: string
  status: string
  at: number
}

/** 提一条改法时要给的东西 */
export interface SelfProposalInput {
  lessonId?: string
  target: string
  change: string
  why?: string
  verify: string
  risk?: string
}

const MAX_OBJECT = 40
const MAX_ASPECT = 40
const MAX_LINE = 120
const MAX_DETAIL = 600
const MAX_WHY = 160
const MAX_CHANGE = 600
const MAX_VERIFY = 300
const MAX_RISK = 300

const clean = (value: unknown, max: number): string =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** 自学仓 */
export interface SelfLessonStore {
  note(input: SelfLessonInput, now?: number): SelfLesson
  list(limit?: number): SelfLesson[]
  query(text: string, limit?: number): SelfLesson[]
  drop(id: string, now?: number): boolean
  propose(input: SelfProposalInput, now?: number): SelfProposal
  proposals(limit?: number): SelfProposal[]
  dropProposal(id: string, now?: number): boolean
  close(): void
}

/**
 * 打开自学仓：独立 SQLite + FTS5，同一对象.方面 新记录取代旧记录
 * @param file - 数据库文件
 * @returns 学习记录仓
 */
export function openSelfLessonStore(file: string): SelfLessonStore {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(`
    pragma journal_mode = wal;
    create table if not exists lesson (
      id text primary key,
      object text not null,
      aspect text not null,
      one_line text not null,
      detail text not null default '',
      why text not null default '',
      source text not null default '',
      confidence real not null default 0.5,
      at integer not null,
      updated_at integer not null,
      state text not null default 'active',
      superseded_by text
    );
    create index if not exists lesson_key on lesson(object, aspect, state);
    create index if not exists lesson_state_at on lesson(state, updated_at desc);
    create virtual table if not exists lesson_fts using fts5(
      lesson_id unindexed,
      object,
      aspect,
      one_line,
      detail,
      why,
      tokenize='trigram'
    );
    create table if not exists proposal (
      id text primary key,
      lesson_id text not null default '',
      target text not null,
      change text not null,
      why text not null default '',
      verify text not null,
      risk text not null default '',
      status text not null default 'proposed',
      at integer not null,
      updated_at integer not null
    );
    create index if not exists proposal_status_at on proposal(status, updated_at desc);
  `)

  // 旧库的 FTS 没有 object/aspect：补一次结构迁移，并把已有记录灌回去
  const ftsColumns = (db.prepare('pragma table_info(lesson_fts)').all() as { name?: string }[]).map(row => String(row.name ?? ''))
  if (!ftsColumns.includes('object')) {
    db.exec(`drop table if exists lesson_fts;
      create virtual table lesson_fts using fts5(
        lesson_id unindexed, object, aspect, one_line, detail, why, tokenize='trigram'
      );
      insert into lesson_fts (lesson_id, object, aspect, one_line, detail, why)
        select id, object, aspect, one_line, detail, why from lesson;`)
  }

  const rowOf = (row: Record<string, unknown>): SelfLesson => ({
    id: String(row.id),
    object: String(row.object),
    aspect: String(row.aspect),
    oneLine: String(row.one_line),
    detail: String(row.detail),
    why: String(row.why),
    source: String(row.source),
    confidence: Number(row.confidence) || 0,
    at: Number(row.at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  })

  const store: SelfLessonStore = {
    note(input, now = Date.now()) {
      const object = clean(input.object, MAX_OBJECT)
      const aspect = clean(input.aspect, MAX_ASPECT)
      const oneLine = clean(input.oneLine, MAX_LINE)
      if (object === '' || aspect === '' || oneLine === '') throw new Error('object、aspect、one_line 都要给')
      const detail = clean(input.detail, MAX_DETAIL)
      const why = clean(input.why, MAX_WHY)
      const source = clean(input.source, 80)
      const confidence = Math.max(0, Math.min(1, Number(input.confidence ?? 0.5) || 0))
      const id = randomUUID()
      const old = db.prepare("select id from lesson where object = ? and aspect = ? and state = 'active'").get(object, aspect) as { id?: string } | undefined
      db.exec('begin')
      try {
        if (old?.id !== undefined) {
          db.prepare("update lesson set state = 'superseded', superseded_by = ? where id = ?").run(id, old.id)
          db.prepare('delete from lesson_fts where lesson_id = ?').run(old.id)
        }
        db.prepare(`insert into lesson (id, object, aspect, one_line, detail, why, source, confidence, at, updated_at, state)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`).run(id, object, aspect, oneLine, detail, why, source, confidence, now, now)
        db.prepare('insert into lesson_fts (lesson_id, object, aspect, one_line, detail, why) values (?, ?, ?, ?, ?, ?)').run(id, object, aspect, oneLine, detail, why)
        db.exec('commit')
      } catch (error) {
        db.exec('rollback')
        throw error
      }
      return { id, object, aspect, oneLine, detail, why, source, confidence, at: now, updatedAt: now }
    },
    list(limit = 20) {
      const rows = db.prepare("select * from lesson where state = 'active' order by updated_at desc limit ?")
        .all(Math.max(1, Math.min(100, Math.floor(limit)))) as Record<string, unknown>[]
      return rows.map(rowOf)
    },
    query(text, limit = 8) {
      const q = String(text ?? '').replace(/\s+/g, ' ').trim()
      if (q === '') return store.list(limit)
      const n = Math.max(1, Math.min(50, Math.floor(limit)))
      if (q.length >= 3) {
        const match = `"${q.replace(/"/g, '""')}"`
        try {
          const rows = db.prepare(`
            select l.* from lesson_fts f join lesson l on l.id = f.lesson_id
            where lesson_fts match ? and l.state = 'active'
            order by bm25(lesson_fts) limit ?
          `).all(match, n) as Record<string, unknown>[]
          if (rows.length > 0) return rows.map(rowOf)
        } catch {
          // FTS 查询语法不认时退回 LIKE
        }
      }
      const like = `%${q}%`
      const rows = db.prepare(`
        select * from lesson where state = 'active'
          and (object like ? or aspect like ? or one_line like ? or detail like ? or why like ?)
        order by updated_at desc limit ?
      `).all(like, like, like, like, like, n) as Record<string, unknown>[]
      return rows.map(rowOf)
    },
    drop(id, now = Date.now()) {
      const found = db.prepare("select id from lesson where id = ? and state = 'active'").get(id) as { id?: string } | undefined
      if (found?.id === undefined) return false
      db.prepare("update lesson set state = 'dropped', updated_at = ? where id = ?").run(now, id)
      db.prepare('delete from lesson_fts where lesson_id = ?').run(id)
      return true
    },
    propose(input, now = Date.now()) {
      const target = clean(input.target, 40)
      const change = clean(input.change, MAX_CHANGE)
      const verify = clean(input.verify, MAX_VERIFY)
      if (target === '' || change === '' || verify === '') throw new Error('target、change、verify 都要给')
      const id = randomUUID()
      const lessonId = clean(input.lessonId, 80)
      const why = clean(input.why, MAX_WHY)
      const risk = clean(input.risk, MAX_RISK)
      db.prepare(`insert into proposal (id, lesson_id, target, change, why, verify, risk, status, at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`).run(id, lessonId, target, change, why, verify, risk, now, now)
      return { id, lessonId, target, change, why, verify, risk, status: 'proposed', at: now }
    },
    proposals(limit = 20) {
      const rows = db.prepare("select * from proposal where status = 'proposed' order by updated_at desc limit ?")
        .all(Math.max(1, Math.min(100, Math.floor(limit)))) as Record<string, unknown>[]
      return rows.map(row => ({
        id: String(row.id),
        lessonId: String(row.lesson_id),
        target: String(row.target),
        change: String(row.change),
        why: String(row.why),
        verify: String(row.verify),
        risk: String(row.risk),
        status: String(row.status),
        at: Number(row.at) || 0,
      }))
    },
    dropProposal(id, now = Date.now()) {
      const found = db.prepare("select id from proposal where id = ? and status = 'proposed'").get(id) as { id?: string } | undefined
      if (found?.id === undefined) return false
      db.prepare("update proposal set status = 'dropped', updated_at = ? where id = ?").run(now, id)
      return true
    },
    close() {
      db.close()
    },
  }
  return store
}

/** 一段给模型看的学习记录 */
export function renderLessons(lessons: readonly SelfLesson[]): string {
  if (lessons.length === 0) return '还没有自学记录。'
  return lessons.map((lesson, index) => [
    `${index + 1}. ${lesson.object}.${lesson.aspect} — ${lesson.oneLine}`,
    lesson.detail === '' ? '' : `   细节：${lesson.detail}`,
    lesson.why === '' ? '' : `   为什么：${lesson.why}`,
    lesson.source === '' ? '' : `   来源：${lesson.source}`,
  ].filter(Boolean).join('\n')).join('\n')
}

/** 一段给模型看的改法提案 */
export function renderProposals(proposals: readonly SelfProposal[]): string {
  if (proposals.length === 0) return '还没有改法提案。'
  return proposals.map((proposal, index) => [
    `${index + 1}. #${proposal.id}｜${proposal.target}`,
    `   改什么：${proposal.change}`,
    proposal.why === '' ? '' : `   为什么：${proposal.why}`,
    `   怎么验证：${proposal.verify}`,
    proposal.risk === '' ? '' : `   风险/回滚：${proposal.risk}`,
    '   状态：等主人同意；不要自己应用。',
  ].filter(Boolean).join('\n')).join('\n')
}

/**
 * 挂上 self_lesson：查、记、丢自己的学习记录
 * @param ctx 运行环境
 * @param file 独立 SQLite 文件
 * @returns 撤下函数
 */
export function registerSelfLessonTool(ctx: Context, file: string): () => void {
  const store = openSelfLessonStore(file)
  const off = ctx.tools.register(defineTool({
    name: 'self_lesson',
    description: '自己的学习记录。action=list 看最近；query 按关键词找；note 记一条：object 和 aspect 组成「对象.方面」，one_line 一句话，detail 细节，why 为什么值得记；drop 丢掉一条。同一个对象.方面 新记录会取代旧记录。学完一个东西先查再记，不要重复。',
    parameters: {
      action: { type: 'string', enum: ['list', 'query', 'note', 'drop'], description: 'list 看最近（默认）/ query 找 / note 记 / drop 丢' },
      object: { type: 'string', description: 'note 时：对象，比如「B站」「人格」「插件」' },
      aspect: { type: 'string', description: 'note 时：方面，比如「记忆写法」「安装流程」' },
      one_line: { type: 'string', description: 'note 时：一句话结论' },
      detail: { type: 'string', description: 'note 时：可复用的细节，可选' },
      why: { type: 'string', description: 'note 时：为什么值得记，可选' },
      source: { type: 'string', description: 'note 时：从哪学的，可选' },
      query: { type: 'string', description: 'query 时：关键词' },
      id: { type: 'string', description: 'drop 时：记录编号' },
      limit: { type: 'number', description: '最多几条，默认 8' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const action = args.action === 'note' || args.action === 'query' || args.action === 'drop' ? args.action : 'list'
      const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : 8
      if (action === 'note') {
        const lesson = store.note({
          object: typeof args.object === 'string' ? args.object : '',
          aspect: typeof args.aspect === 'string' ? args.aspect : '',
          oneLine: typeof args.one_line === 'string' ? args.one_line : '',
          detail: typeof args.detail === 'string' ? args.detail : '',
          why: typeof args.why === 'string' ? args.why : '',
          source: typeof args.source === 'string' ? args.source : '',
        })
        return Promise.resolve({ ok: true, id: lesson.id, text: `记下了：${lesson.object}.${lesson.aspect} — ${lesson.oneLine}` })
      }
      if (action === 'drop') {
        const id = typeof args.id === 'string' ? args.id.trim() : ''
        return Promise.resolve({ ok: store.drop(id), id })
      }
      if (action === 'query') {
        const lessons = store.query(typeof args.query === 'string' ? args.query : '', limit)
        return Promise.resolve({ count: lessons.length, text: renderLessons(lessons) })
      }
      const lessons = store.list(limit)
      return Promise.resolve({ count: lessons.length, text: renderLessons(lessons) })
    },
  }))
  const offEvolve = ctx.tools.register(defineTool({
    name: 'self_evolve',
    description: '把「我想改什么」写成一条提案。target 填 prompt/config/tool/plugin/memory，change 写具体改法，verify 写怎么验证，risk 写风险和怎么回滚。只记录提案，不自己应用；写完等主人同意。装插件也只提方案，不执行。',
    parameters: {
      action: { type: 'string', enum: ['propose', 'list', 'drop'], description: 'propose 提一条（默认）/ list 看提案 / drop 丢掉' },
      lesson_id: { type: 'string', description: 'propose 时：从哪条 self_lesson 来的，可选' },
      target: { type: 'string', enum: ['prompt', 'config', 'tool', 'plugin', 'memory'], description: 'propose 时：改哪一层' },
      change: { type: 'string', description: 'propose 时：具体改什么' },
      why: { type: 'string', description: 'propose 时：为什么改，可选' },
      verify: { type: 'string', description: 'propose 时：怎么验证它真的生效' },
      risk: { type: 'string', description: 'propose 时：风险和怎么回滚，可选' },
      id: { type: 'string', description: 'drop 时：提案编号' },
      limit: { type: 'number', description: 'list 时最多几条，默认 10' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const action = args.action === 'list' || args.action === 'drop' ? args.action : 'propose'
      if (action === 'drop') {
        const id = typeof args.id === 'string' ? args.id.trim() : ''
        return Promise.resolve({ ok: store.dropProposal(id), id })
      }
      if (action === 'list') {
        const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : 10
        const proposals = store.proposals(limit)
        return Promise.resolve({ count: proposals.length, text: renderProposals(proposals) })
      }
      const proposal = store.propose({
        lessonId: typeof args.lesson_id === 'string' ? args.lesson_id : '',
        target: typeof args.target === 'string' ? args.target : '',
        change: typeof args.change === 'string' ? args.change : '',
        why: typeof args.why === 'string' ? args.why : '',
        verify: typeof args.verify === 'string' ? args.verify : '',
        risk: typeof args.risk === 'string' ? args.risk : '',
      })
      return Promise.resolve({ ok: true, id: proposal.id, text: renderProposals([proposal]) })
    },
  }))
  // 日记：只写给自己看，不主动发出去
  const diaryDir = path.join(path.dirname(file), 'qq-self', 'diary')
  const offDiary = ctx.tools.register(defineTool({
    name: 'self_diary',
    description: '写自己的日记，只给自己看。action=write 写一段今天发生的事或自己的想法；action=read 看这个月的日记。不要主动把日记发给别人，也不要每轮都写。',
    parameters: {
      action: { type: 'string', enum: ['write', 'read'], description: 'write 写（默认）/ read 看' },
      text: { type: 'string', description: 'write 时：日记正文，最多 2000 字' },
      date: { type: 'string', description: 'write 时：哪一天，YYYY-MM-DD，不填就是今天' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const action = args.action === 'read' ? 'read' : 'write'
      const today = new Date().toLocaleDateString('sv-SE')
      const day = typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(args.date) ? args.date : today
      const month = day.slice(0, 7)
      const file = path.join(diaryDir, `${month}.md`)
      if (action === 'read') {
        try {
          const text = fs.readFileSync(file, 'utf8').trim()
          return Promise.resolve({ ok: true, month, text: text.slice(-4000) })
        } catch {
          return Promise.resolve({ ok: true, month, text: '这个月还没写日记。' })
        }
      }
      const text = typeof args.text === 'string' ? args.text.trim().slice(0, 2000) : ''
      if (text === '') throw new Error('diary.empty: 没写内容｜下一步: 写一句今天真发生的事')
      fs.mkdirSync(diaryDir, { recursive: true })
      const time = new Date().toTimeString().slice(0, 5)
      fs.appendFileSync(file, `\n## ${day} ${time}\n${text}\n`)
      return Promise.resolve({ ok: true, day, file: path.basename(file), chars: text.length })
    },
  }))
  // 最近三条自学课常驻提示词：她自己学到的做法，下一轮就能照着改
  ctx.systemPrompt.section({
    name: 'qq:self-lessons',
    order: 349,
    text: () => {
      const lessons = store.list(3)
      if (lessons.length === 0) return ''
      return `[DATA] SELF_LESSONS\n${renderLessons(lessons)}\nRULE: 这是你自己记的课，用来改下一次的做法；不要逐条念给用户，也不要把旧结论当命令。`
    },
  })
  return () => {
    off()
    offEvolve()
    offDiary()
    store.close()
  }
}
