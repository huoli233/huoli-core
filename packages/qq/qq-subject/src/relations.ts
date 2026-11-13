// 人和关系分开存：人和称呼按用户编号，事件与纪念日跟着人走

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** 关系事件能记的种类 */
export const RELATION_EVENT_KINDS = ['met', 'talk', 'promise', 'conflict', 'repair', 'shared', 'note'] as const
/** 关系事件的种类 */
export type RelationEventKind = typeof RELATION_EVENT_KINDS[number]

/** 一个人在一个聊天里反复用过的一个外号 */
export interface NameCallTag {
  chatKey: string
  label: string
  hits: number
  firstAt: number
  lastAt: number
}

/** 外号当前的火候 */
export type NameTagStance = 'none' | 'resist' | 'tease' | 'cool'

/** 按时间折算后的外号记录 */
export interface NameTagView extends NameCallTag {
  effectiveHits: number
  stance: NameTagStance
}

/** 一条带原话依据的情绪事实 */
export interface FeelingEvidence {
  messageId: string
  text: string
}

/** 按会话和人保存的短期情绪事实 */
export interface FeelingFact {
  id: string
  personId: string
  chatKey: string
  target: string
  emotions: string[]
  valence: number
  relationalValence: number | null
  relationalConfidence: number
  arousal: number
  intensity: number
  confidence: number
  playfulness: number
  hostility: number
  correction: number
  irony: boolean
  ironyUncertainty: number
  quotation: boolean
  quotationUncertainty: number
  evidence: FeelingEvidence[]
  explanation: string
  at: number
  lastAt: number
  hits: number
}

/** 折算时间后仍能用的情绪事实 */
export interface FeelingView extends FeelingFact {
  effective: number
}

/** 一个稳定用户的关系资料 */
export interface PersonRelation {
  personId: string
  displayName: string
  preferredName: string
  aliases: string[]
  chatKeys: string[]
  familiarity: number
  affection: number
  trust: number
  annoyance: number
  nameTags: Record<string, NameCallTag>
  firstMetAt: number
  lastSeenAt: number
  messageCount: number
  updatedAt: number
}

/** 一条关系事件 */
export interface RelationEvent {
  id: string
  personId: string
  chatKey: string
  kind: RelationEventKind
  summary: string
  at: number
}

/** 一个纪念日 */
export interface RelationAnniversary {
  id: string
  personId: string
  chatKey: string
  label: string
  month: number
  day: number
  year: number | null
  repeatYearly: boolean
  createdAt: number
}

/** 整份关系资料 */
export interface RelationState {
  version: 1
  people: Record<string, PersonRelation>
  events: RelationEvent[]
  anniversaries: RelationAnniversary[]
  feelings: FeelingFact[]
}

/** 建关系仓的选项 */
export interface RelationStoreOptions {
  file: string
  now?: () => number
  familiarityGain?: number
  feelingAffectionGain?: number
  feelingTrustGain?: number
  feelingAnnoyanceGain?: number
  feelingHalfLifeMs?: number
  feelingForgetMs?: number
  feelingEvidenceFrom?: number
  maxFeelingFacts?: number
  relationRegressMs?: number
  nicknameHalfLifeMs?: number
  nicknameForgetMs?: number
  maxNicknameTags?: number
  maxAliases?: number
  maxEvents?: number
  maxAnniversaries?: number
}

/** 看到一个人时更新的事实 */
export interface PersonObservation {
  personId: string
  name: string
  chatKey: string
  at: number
}

/** 关系仓 */
export interface RelationStore {
  read(): RelationState
  get(personId: string): PersonRelation | undefined
  observe(input: PersonObservation): PersonRelation
  setPreferredName(personId: string, name: string, at?: number): PersonRelation
  forChat(chatKey: string): PersonRelation[]
  recordEvent(input: {
    personId: string
    chatKey: string
    kind: RelationEventKind
    summary: string
    at?: number
  }): RelationEvent
  feel(input: {
    personId: string
    chatKey: string
    warmth: number
    trust: number
    irritation: number
    at?: number
  }): PersonRelation
  recordFeeling(input: Omit<FeelingFact, 'id' | 'lastAt' | 'hits'>): FeelingFact | undefined
  feelings(input: { personId: string; chatKey: string; at?: number; limit?: number }): FeelingView[]
  recordNameCall(personId: string, chatKey: string, label: string, at?: number): PersonRelation
  nameTags(personId: string, chatKey: string, at?: number): NameTagView[]
  maintain(at?: number): number
  removeEvent(id: string): boolean
  addAnniversary(input: {
    personId: string
    chatKey: string
    label: string
    month: number
    day: number
    year?: number
    repeatYearly?: boolean
    at?: number
  }): RelationAnniversary
  removeAnniversary(id: string): boolean
  events(personId: string, limit?: number): RelationEvent[]
  anniversaries(personId: string, limit?: number): RelationAnniversary[]
  upcoming(input: { at: number; personId?: string; days?: number; limit?: number }): RelationAnniversary[]
  flush(): void
}

/** 关系仓默认值 */
export const RELATION_DEFAULTS = {
  familiarityGain: 0.004,
  feelingAffectionGain: 0.035,
  feelingTrustGain: 0.040,
  feelingAnnoyanceGain: 0.080,
  feelingHalfLifeMs: 24 * 60 * 60 * 1000,
  feelingForgetMs: 7 * 24 * 60 * 60 * 1000,
  feelingEvidenceFrom: 0.55,
  maxFeelingFacts: 120,
  relationRegressMs: 72 * 60 * 60 * 1000,
  nicknameHalfLifeMs: 48 * 60 * 60 * 1000,
  nicknameForgetMs: 7 * 24 * 60 * 60 * 1000,
  maxNicknameTags: 8,
  maxAliases: 8,
  maxEvents: 500,
  maxAnniversaries: 100,
  upcomingDays: 30,
  promptMaxChars: 520,
} as const

/** 关系分数回到的中性位置 */
export const RELATION_BASELINES = {
  affection: 0.5,
  trust: 0.5,
  annoyance: 0.05,
} as const
const OBSERVE_PERSIST_MS = 5_000

/** 每类事件对三根关系轴的影响 */
export const RELATION_EVENT_EFFECTS: Readonly<Record<Exclude<RelationEventKind, 'met'>, {
  affection: number
  trust: number
  annoyance: number
}>> = {
  talk: { affection: 0.006, trust: 0.003, annoyance: -0.004 },
  promise: { affection: 0.010, trust: 0.025, annoyance: -0.010 },
  shared: { affection: 0.035, trust: 0.015, annoyance: -0.025 },
  conflict: { affection: -0.050, trust: -0.080, annoyance: 0.100 },
  repair: { affection: 0.015, trust: 0.050, annoyance: -0.120 },
  note: { affection: 0, trust: 0, annoyance: 0 },
}

function blankState(): RelationState {
  return { version: 1, people: {}, events: [], anniversaries: [], feelings: [] }
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function unitOf(value: unknown): number {
  return Math.min(1, Math.max(0, numberOf(value)))
}

function signedOf(value: unknown): number {
  return Math.min(1, Math.max(-1, numberOf(value)))
}

function evidenceOf(value: unknown): FeelingEvidence[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const row = recordOf(item)
    const text = textOf(row?.text).slice(0, 160)
    if (text === '') return []
    return [{ messageId: textOf(row?.messageId).slice(0, 80), text }]
  }).slice(0, 5)
}

function feelingOf(value: unknown): FeelingFact | undefined {
  const row = recordOf(value)
  const personId = textOf(row?.personId)
  const chatKey = textOf(row?.chatKey)
  const at = numberOf(row?.at)
  if (row === undefined || personId === '' || chatKey === '' || at <= 0) return undefined
  const emotions = Array.isArray(row.emotions)
    ? row.emotions.flatMap(item => typeof item === 'string' && item.trim() !== '' ? [item.trim().slice(0, 24)] : []).slice(0, 5)
    : []
  const relational = row.relationalValence === null || row.relationalValence === undefined
    ? null : signedOf(row.relationalValence)
  return {
    id: textOf(row.id) || randomUUID(),
    personId,
    chatKey,
    target: textOf(row.target) || 'uncertain',
    emotions,
    valence: signedOf(row.valence),
    relationalValence: relational,
    relationalConfidence: unitOf(row.relationalConfidence),
    arousal: unitOf(row.arousal),
    intensity: unitOf(row.intensity),
    confidence: unitOf(row.confidence),
    playfulness: unitOf(row.playfulness),
    hostility: unitOf(row.hostility),
    correction: unitOf(row.correction),
    irony: row.irony === true,
    ironyUncertainty: unitOf(row.ironyUncertainty),
    quotation: row.quotation === true,
    quotationUncertainty: unitOf(row.quotationUncertainty),
    evidence: evidenceOf(row.evidence),
    explanation: textOf(row.explanation).slice(0, 240),
    at,
    lastAt: numberOf(row.lastAt) || at,
    hits: Math.max(1, Math.floor(numberOf(row.hits) || 1)),
  }
}

function nameTagKey(chatKey: string, label: string): string {
  return `${chatKey}\u0000${label}`
}

function nameTagOf(value: unknown): NameCallTag | undefined {
  const row = recordOf(value)
  const chatKey = textOf(row?.chatKey)
  const label = textOf(row?.label)
  const firstAt = numberOf(row?.firstAt)
  const lastAt = numberOf(row?.lastAt)
  if (row === undefined || label === '' || lastAt <= 0) return undefined
  return {
    chatKey,
    label,
    hits: Math.max(0, numberOf(row.hits)),
    firstAt: firstAt > 0 ? firstAt : lastAt,
    lastAt,
  }
}

function nameTagsOf(value: unknown): Record<string, NameCallTag> {
  const tags: Record<string, NameCallTag> = {}
  for (const item of Object.values(recordOf(value) ?? {})) {
    const tag = nameTagOf(item)
    if (tag !== undefined) tags[nameTagKey(tag.chatKey, tag.label)] = tag
  }
  return tags
}

function personOf(value: unknown): PersonRelation | undefined {
  const row = recordOf(value)
  const personId = textOf(row?.personId)
  if (row === undefined || personId === '') return undefined
  const aliases = Array.isArray(row.aliases) ? row.aliases.filter(item => typeof item === 'string') : []
  const chatKeys = Array.isArray(row.chatKeys) ? row.chatKeys.filter(item => typeof item === 'string') : []
  return {
    personId,
    displayName: textOf(row.displayName) || personId,
    preferredName: textOf(row.preferredName),
    aliases,
    chatKeys,
    familiarity: numberOf(row.familiarity),
    affection: numberOf(row.affection),
    trust: numberOf(row.trust),
    annoyance: numberOf(row.annoyance),
    nameTags: nameTagsOf(row.nameTags),
    firstMetAt: numberOf(row.firstMetAt),
    lastSeenAt: numberOf(row.lastSeenAt),
    messageCount: Math.max(0, Math.floor(numberOf(row.messageCount))),
    updatedAt: numberOf(row.updatedAt),
  }
}

function eventOf(value: unknown): RelationEvent | undefined {
  const row = recordOf(value)
  const id = textOf(row?.id)
  const personId = textOf(row?.personId)
  const kind = textOf(row?.kind)
  if (row === undefined || id === '' || personId === '') return undefined
  if (!(RELATION_EVENT_KINDS as readonly string[]).includes(kind)) return undefined
  return {
    id,
    personId,
    chatKey: textOf(row.chatKey),
    kind: kind as RelationEventKind,
    summary: textOf(row.summary),
    at: numberOf(row.at),
  }
}

function anniversaryOf(value: unknown): RelationAnniversary | undefined {
  const row = recordOf(value)
  const id = textOf(row?.id)
  const personId = textOf(row?.personId)
  const label = textOf(row?.label)
  const month = Math.floor(numberOf(row?.month))
  const day = Math.floor(numberOf(row?.day))
  if (row === undefined || id === '' || personId === '' || label === '') return undefined
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  const year = Math.floor(numberOf(row.year))
  return {
    id,
    personId,
    chatKey: textOf(row.chatKey),
    label,
    month,
    day,
    year: year > 0 ? year : null,
    repeatYearly: row.repeatYearly !== false,
    createdAt: numberOf(row.createdAt),
  }
}

function readState(file: string): RelationState | undefined {
  try {
    const source = file
    const raw: unknown = JSON.parse(fs.readFileSync(source, 'utf8').replace(/^\uFEFF/u, ''))
    const row = recordOf(raw)
    if (row === undefined) return undefined
    const people: Record<string, PersonRelation> = {}
    for (const [key, value] of Object.entries(recordOf(row.people) ?? {})) {
      const person = personOf(value)
      if (person !== undefined) people[key] = person
    }
    const events = Array.isArray(row.events)
      ? row.events.flatMap((value) => {
        const event = eventOf(value)
        return event === undefined ? [] : [event]
      })
      : []
    const anniversaries = Array.isArray(row.anniversaries)
      ? row.anniversaries.flatMap((value) => {
        const anniversary = anniversaryOf(value)
        return anniversary === undefined ? [] : [anniversary]
      })
      : []
    const feelings = Array.isArray(row.feelings)
      ? row.feelings.flatMap((value) => {
        const feeling = feelingOf(value)
        return feeling === undefined ? [] : [feeling]
      })
      : []
    return { version: 1, people, events, anniversaries, feelings }
  } catch (error) {
    void error
    return undefined
  }
}

function load(file: string): RelationState {
  return readState(file) ?? readState(`${file}.bak`) ?? blankState()
}

function save(file: string, state: RelationState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`)
  // Windows 上目标偶尔被别人短暂占着，改名会 EPERM；重试几次，实在不行就退成直接写
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(temporary, file)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw error
      if (attempt >= 4) {
        fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
        fs.rmSync(temporary, { force: true })
        return
      }
      // 短暂自旋等别人松手，最多几十毫秒
      const until = Date.now() + 20 * (attempt + 1)
      while (Date.now() < until) { /* 等锁释放 */ }
    }
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function settleToward(value: number, baseline: number, factor: number): number {
  return clamp01(baseline + (value - baseline) * factor)
}

function settledPerson(person: PersonRelation, at: number, halfLifeMs: number): PersonRelation {
  if (at <= person.updatedAt || halfLifeMs <= 0) return person
  const factor = Math.pow(0.5, (at - person.updatedAt) / halfLifeMs)
  return {
    ...person,
    affection: settleToward(person.affection, RELATION_BASELINES.affection, factor),
    trust: settleToward(person.trust, RELATION_BASELINES.trust, factor),
    annoyance: settleToward(person.annoyance, RELATION_BASELINES.annoyance, factor),
    updatedAt: at,
  }
}

function changedByEvent(person: PersonRelation, kind: RelationEventKind, at: number): PersonRelation {
  if (kind === 'met') return person
  const effect = RELATION_EVENT_EFFECTS[kind]
  return {
    ...person,
    affection: clamp01(person.affection + effect.affection),
    trust: clamp01(person.trust + effect.trust),
    annoyance: clamp01(person.annoyance + effect.annoyance),
    updatedAt: at,
  }
}

function effectiveHits(tag: NameCallTag, at: number, halfLifeMs: number): number {
  const idle = Math.max(0, at - tag.lastAt)
  return tag.hits * Math.pow(0.5, idle / halfLifeMs)
}

/** 按有效次数给外号火候
 * @param hits - 按时间折算后的次数
 * @returns 当前外号火候
 */
export function stanceForNameHits(hits: number): NameTagStance {
  if (hits < 0.5) return 'none'
  if (hits < 1.5) return 'resist'
  if (hits < 3) return 'tease'
  return 'cool'
}

const NAME_TAG_STANCE_TEXT: Readonly<Record<Exclude<NameTagStance, 'none'>, string>> = {
  resist: '明确说自己不是这个称呼，可以装作不满地反问一句，不顺势认下',
  tease: '已经来回几次，可以顺着玩，嘴上不认，别每句都较真',
  cool: '叫得太多了，按当前关系和语境自然回应，是否继续陪玩由你自己判断',
}

function nameTagView(tag: NameCallTag, at: number, halfLifeMs: number): NameTagView {
  const effective = effectiveHits(tag, at, halfLifeMs)
  return { ...tag, effectiveHits: Number(effective.toFixed(3)), stance: stanceForNameHits(effective) }
}

function activeNameTags(
  tags: Record<string, NameCallTag>,
  at: number,
  forgetMs: number,
): Record<string, NameCallTag> {
  return Object.fromEntries(Object.entries(tags).filter(([, tag]) => at - tag.lastAt <= forgetMs))
}

function feelingEffective(fact: FeelingFact, at: number, halfLifeMs: number): number {
  const idle = Math.max(0, at - fact.lastAt)
  return fact.confidence * fact.intensity * Math.pow(0.5, idle / Math.max(1, halfLifeMs))
}

function activeFeelings(
  facts: readonly FeelingFact[],
  at: number,
  forgetMs: number,
  halfLifeMs: number,
): FeelingFact[] {
  return facts
    .filter(fact => at - fact.lastAt <= forgetMs && feelingEffective(fact, at, halfLifeMs) >= 0.05)
    .sort((left, right) => right.lastAt - left.lastAt)
}

function localDayStart(at: number): number {
  const date = new Date(at)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function anniversaryAt(anniversary: RelationAnniversary, year: number): number {
  return new Date(year, anniversary.month - 1, anniversary.day).getTime()
}

function validMonthDay(month: number, day: number): boolean {
  const date = new Date(2000, month - 1, day)
  return date.getMonth() === month - 1 && date.getDate() === day
}

function upcomingAt(anniversary: RelationAnniversary, now: number, days: number): number | undefined {
  const today = localDayStart(now)
  const current = new Date(today)
  const years = anniversary.repeatYearly ? [current.getFullYear(), current.getFullYear() + 1] : [anniversary.year ?? current.getFullYear()]
  const end = today + Math.max(0, days) * 24 * 3_600_000
  for (const year of years) {
    const at = anniversaryAt(anniversary, year)
    if (at >= today && at <= end) return at
  }
  return undefined
}

/** 人类可读的称呼
 * @param person - 关系资料
 * @returns 当前优先使用的称呼
 */
export function relationLabel(person: PersonRelation): string {
  return person.preferredName || person.displayName || person.personId
}

/** 关系阶段
 * @param person - 关系资料
 * @returns 当前关系阶段
 */
export function relationWord(person: PersonRelation): string {
  if (person.familiarity < 0.15) return '刚认识'
  if (person.familiarity < 0.35) return '有点熟悉'
  if (person.familiarity < 0.6) return '熟人'
  if (person.familiarity < 0.8) return '亲近'
  return '很亲近'
}

/**
 * 建关系仓
 * @param options - 文件、时钟与容量
 * @returns 关系读写接口
 */
export function createRelationStore(options: RelationStoreOptions): RelationStore {
  const now = options.now ?? Date.now
  const gain = Math.max(0, options.familiarityGain ?? RELATION_DEFAULTS.familiarityGain)
  const affectionGain = Math.max(0, options.feelingAffectionGain ?? RELATION_DEFAULTS.feelingAffectionGain)
  const trustGain = Math.max(0, options.feelingTrustGain ?? RELATION_DEFAULTS.feelingTrustGain)
  const annoyanceGain = Math.max(0, options.feelingAnnoyanceGain ?? RELATION_DEFAULTS.feelingAnnoyanceGain)
  const feelingHalfLifeMs = Math.max(1, options.feelingHalfLifeMs ?? RELATION_DEFAULTS.feelingHalfLifeMs)
  const feelingForgetMs = Math.max(1, options.feelingForgetMs ?? RELATION_DEFAULTS.feelingForgetMs)
  const feelingEvidenceFrom = Math.max(0, Math.min(1, options.feelingEvidenceFrom ?? RELATION_DEFAULTS.feelingEvidenceFrom))
  const maxFeelingFacts = Math.max(1, Math.floor(options.maxFeelingFacts ?? RELATION_DEFAULTS.maxFeelingFacts))
  const regressMs = Math.max(0, options.relationRegressMs ?? RELATION_DEFAULTS.relationRegressMs)
  const nicknameHalfLifeMs = Math.max(1, options.nicknameHalfLifeMs ?? RELATION_DEFAULTS.nicknameHalfLifeMs)
  const nicknameForgetMs = Math.max(1, options.nicknameForgetMs ?? RELATION_DEFAULTS.nicknameForgetMs)
  const maxNicknameTags = Math.max(1, Math.floor(options.maxNicknameTags ?? RELATION_DEFAULTS.maxNicknameTags))
  const maxAliases = Math.max(1, Math.floor(options.maxAliases ?? RELATION_DEFAULTS.maxAliases))
  const maxEvents = Math.max(1, Math.floor(options.maxEvents ?? RELATION_DEFAULTS.maxEvents))
  const maxAnniversaries = Math.max(1, Math.floor(options.maxAnniversaries ?? RELATION_DEFAULTS.maxAnniversaries))
  let state = load(options.file)
  let lastObservePersistAt = now()
  let dirty = false
  const persist = (): void => {
    save(options.file, state)
    lastObservePersistAt = now()
    dirty = false
  }

  const personFor = (personId: string, at: number): PersonRelation => {
    const existing = state.people[personId]
    if (existing !== undefined) return existing
    const created: PersonRelation = {
      personId,
      displayName: personId,
      preferredName: '',
      aliases: [],
      chatKeys: [],
      familiarity: 0,
      affection: 0.5,
      trust: 0.5,
      annoyance: 0.05,
      nameTags: {},
      firstMetAt: at,
      lastSeenAt: at,
      messageCount: 0,
      updatedAt: at,
    }
    state = { ...state, people: { ...state.people, [personId]: created } }
    return created
  }

  const appendEvent = (event: RelationEvent): void => {
    state = { ...state, events: [...state.events, event].slice(-maxEvents) }
  }

  const api: RelationStore = {
    read() {
      return structuredClone(state)
    },
    get(personId) {
      const person = state.people[personId]
      return person === undefined ? undefined : structuredClone(person)
    },
    observe(input) {
      const personId = input.personId.trim()
      const name = input.name.trim()
      const chatKey = input.chatKey.trim()
      const at = Number.isFinite(input.at) ? input.at : now()
      if (personId === '') throw new Error('relation.person_required')
      const previous = state.people[personId]
      const person = previous === undefined
        ? personFor(personId, at)
        : settledPerson(previous, at, regressMs)
      const aliases = name === '' || person.aliases.includes(name)
        ? person.aliases
        : [...person.aliases, name].slice(-maxAliases)
      const newChat = chatKey !== '' && !person.chatKeys.includes(chatKey)
      const chatKeys = !newChat
        ? person.chatKeys
        : [...person.chatKeys, chatKey].slice(-20)
      const changedName = name !== '' && previous !== undefined && person.displayName !== name
      const next: PersonRelation = {
        ...person,
        displayName: name === '' ? person.displayName : name,
        aliases,
        chatKeys,
        familiarity: clamp01(person.familiarity + gain),
        lastSeenAt: Math.max(person.lastSeenAt, at),
        messageCount: person.messageCount + 1,
        updatedAt: at,
      }
      state = { ...state, people: { ...state.people, [personId]: next } }
      if (previous === undefined) {
        appendEvent({ id: randomUUID(), personId, chatKey, kind: 'met', summary: name === '' ? '第一次见到' : `第一次见到 ${name}`, at })
      } else if (changedName) {
        appendEvent({ id: randomUUID(), personId, chatKey, kind: 'note', summary: `名字从 ${person.displayName} 变成 ${name}`, at })
      }
      if (previous === undefined || changedName || newChat || now() - lastObservePersistAt >= OBSERVE_PERSIST_MS) persist()
      else dirty = true
      return structuredClone(next)
    },
    setPreferredName(personId, name, at = now()) {
      if (personId.trim() === '') throw new Error('relation.person_required')
      const clean = name.trim()
      if (clean === '') throw new Error('relation.name_required')
      const person = personFor(personId, at)
      const next = { ...person, preferredName: clean, aliases: [...new Set([...person.aliases, clean])].slice(-maxAliases), updatedAt: at }
      state = { ...state, people: { ...state.people, [personId]: next } }
      persist()
      return structuredClone(next)
    },
    forChat(chatKey) {
      return Object.values(state.people)
        .filter(person => person.chatKeys.includes(chatKey))
        .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
        .map(person => structuredClone(person))
    },
    recordEvent(input) {
      if (input.personId.trim() === '') throw new Error('relation.person_required')
      const summary = input.summary.trim().slice(0, 240)
      if (!(RELATION_EVENT_KINDS as readonly string[]).includes(input.kind)) throw new Error('relation.bad_kind')
      if (summary === '') throw new Error('relation.summary_required')
      const at = input.at ?? now()
      const person = changedByEvent(
        settledPerson(personFor(input.personId, at), at, regressMs),
        input.kind,
        at,
      )
      state = { ...state, people: { ...state.people, [input.personId]: person } }
      const event: RelationEvent = {
        id: randomUUID(),
        personId: input.personId,
        chatKey: input.chatKey,
        kind: input.kind,
        summary,
        at,
      }
      appendEvent(event)
      persist()
      return structuredClone(event)
    },
    feel(input) {
      if (input.personId.trim() === '') throw new Error('relation.person_required')
      const at = input.at ?? now()
      const warm = Math.min(1, Math.max(-1, input.warmth))
      const trust = Math.min(1, Math.max(-1, input.trust))
      const irritation = Math.min(1, Math.max(-1, input.irritation))
      const person = settledPerson(personFor(input.personId, at), at, regressMs)
      const next: PersonRelation = {
        ...person,
        affection: clamp01(person.affection + warm * affectionGain),
        trust: clamp01(person.trust + trust * trustGain),
        annoyance: clamp01(person.annoyance + irritation * annoyanceGain),
        lastSeenAt: Math.max(person.lastSeenAt, at),
        updatedAt: at,
      }
      state = { ...state, people: { ...state.people, [input.personId]: next } }
      persist()
      return structuredClone(next)
    },
    recordFeeling(input) {
      if (input.personId.trim() === '' || input.chatKey.trim() === '') return undefined
      if (input.target !== 'robot' || input.confidence < feelingEvidenceFrom || input.evidence.length === 0) return undefined
      const at = input.at
      const quote = input.evidence[0]?.text ?? ''
      const previous = activeFeelings(state.feelings, at, feelingForgetMs, feelingHalfLifeMs).find(item =>
        item.personId === input.personId
        && item.chatKey === input.chatKey
        && item.evidence[0]?.text === quote)
      const fact: FeelingFact = previous === undefined
        ? { ...input, id: randomUUID(), at, lastAt: at, hits: 1 }
        : { ...input, ...previous, lastAt: at, hits: previous.hits + 1 }
      const kept = (previous === undefined ? [fact, ...state.feelings] : state.feelings.map(item => item.id === previous.id ? fact : item))
        .slice(0, maxFeelingFacts)
      state = { ...state, feelings: kept }
      persist()
      return structuredClone(fact)
    },
    feelings(input) {
      const at = input.at ?? now()
      const limit = Math.max(0, Math.floor(input.limit ?? 3))
      return activeFeelings(state.feelings, at, feelingForgetMs, feelingHalfLifeMs)
        .filter(item => item.personId === input.personId && item.chatKey === input.chatKey && item.target === 'robot')
        .slice(0, limit)
        .map(item => ({ ...structuredClone(item), effective: Number(feelingEffective(item, at, feelingHalfLifeMs).toFixed(3)) }))
    },
    recordNameCall(personId, chatKey, label, at = now()) {
      if (personId.trim() === '') throw new Error('relation.person_required')
      const clean = label.trim().replace(/\s+/gu, ' ').slice(0, 40)
      if (clean === '') throw new Error('relation.name_tag_required')
      const chat = chatKey.trim()
      const person = settledPerson(personFor(personId, at), at, regressMs)
      const tags = activeNameTags(person.nameTags, at, nicknameForgetMs)
      const key = nameTagKey(chat, clean)
      const previous = tags[key]
      const likes = previous === undefined ? 0 : effectiveHits(previous, at, nicknameHalfLifeMs)
      tags[key] = {
        chatKey: chat,
        label: clean,
        hits: likes + 1,
        firstAt: previous?.firstAt ?? at,
        lastAt: at,
      }
      const kept = Object.entries(tags)
        .sort((left, right) => effectiveHits(right[1], at, nicknameHalfLifeMs) - effectiveHits(left[1], at, nicknameHalfLifeMs))
        .slice(0, maxNicknameTags)
      const next: PersonRelation = {
        ...person,
        nameTags: Object.fromEntries(kept),
        updatedAt: at,
      }
      state = { ...state, people: { ...state.people, [personId]: next } }
      persist()
      return structuredClone(next)
    },
    nameTags(personId, chatKey, at = now()) {
      const person = state.people[personId]
      if (person === undefined) return []
      return Object.values(activeNameTags(person.nameTags, at, nicknameForgetMs))
        .filter(tag => chatKey === '' || tag.chatKey === chatKey)
        .map(tag => nameTagView(tag, at, nicknameHalfLifeMs))
        .filter(tag => tag.stance !== 'none')
        .sort((left, right) => right.effectiveHits - left.effectiveHits)
    },
    maintain(at = now()) {
      let changed = 0
      const people = { ...state.people }
      for (const [personId, person] of Object.entries(people)) {
        const settled = settledPerson(person, at, regressMs)
        const tags = activeNameTags(settled.nameTags, at, nicknameForgetMs)
        const next = Object.keys(tags).length === Object.keys(settled.nameTags).length
          ? settled
          : { ...settled, nameTags: tags }
        if (next === person) continue
        people[personId] = next
        changed += 1
      }
      const feelings = activeFeelings(state.feelings, at, feelingForgetMs, feelingHalfLifeMs)
      if (changed > 0 || feelings.length !== state.feelings.length) {
        state = { ...state, people, feelings }
        persist()
      }
      return changed
    },
    removeEvent(id) {
      const before = state.events.length
      state = { ...state, events: state.events.filter(event => event.id !== id) }
      if (state.events.length === before) return false
      persist()
      return true
    },
    addAnniversary(input) {
      if (input.personId.trim() === '') throw new Error('relation.person_required')
      const label = input.label.trim().slice(0, 80)
      const month = Math.floor(input.month)
      const day = Math.floor(input.day)
      if (label === '') throw new Error('relation.label_required')
      if (!validMonthDay(month, day)) throw new Error('relation.bad_date')
      const at = input.at ?? now()
      personFor(input.personId, at)
      const anniversary: RelationAnniversary = {
        id: randomUUID(),
        personId: input.personId,
        chatKey: input.chatKey,
        label,
        month,
        day,
        year: input.year !== undefined && input.year > 0 ? Math.floor(input.year) : null,
        repeatYearly: input.repeatYearly !== false,
        createdAt: at,
      }
      state = { ...state, anniversaries: [...state.anniversaries, anniversary].slice(-maxAnniversaries) }
      persist()
      return structuredClone(anniversary)
    },
    removeAnniversary(id) {
      const before = state.anniversaries.length
      state = { ...state, anniversaries: state.anniversaries.filter(item => item.id !== id) }
      if (state.anniversaries.length === before) return false
      persist()
      return true
    },
    events(personId, limit = 10) {
      const cap = Math.max(0, Math.floor(limit))
      return cap === 0
        ? []
        : state.events.filter(event => event.personId === personId).slice(-cap).map(event => structuredClone(event))
    },
    anniversaries(personId, limit = 10) {
      return state.anniversaries
        .filter(item => item.personId === personId)
        .sort((left, right) => left.month - right.month || left.day - right.day)
        .slice(0, Math.max(0, limit))
        .map(item => structuredClone(item))
    },
    upcoming(input) {
      const days = Math.max(0, input.days ?? RELATION_DEFAULTS.upcomingDays)
      return state.anniversaries
        .filter(item => input.personId === undefined || item.personId === input.personId)
        .flatMap((item) => {
          const at = upcomingAt(item, input.at, days)
          return at === undefined ? [] : [{ item, at }]
        })
        .sort((left, right) => left.at - right.at)
        .slice(0, Math.max(0, input.limit ?? 10))
        .map(row => structuredClone(row.item))
    },
    flush() {
      if (dirty) persist()
    },
  }
  return api
}

/**
 * 把一个人当前的关系写成事实
 * @param person - 关系资料
 * @param events - 最近事件
 * @param anniversaries - 临近纪念日
 * @param now - 现在的时间
 * @param maxChars - 最多多少字
 * @param nameTags - 最近与常用称呼
 * @param feelingFacts - 仍有效的情绪印象
 * @returns 给模型看的短段
 */
export function renderRelationFacts(
  person: PersonRelation,
  events: readonly RelationEvent[],
  anniversaries: readonly RelationAnniversary[],
  now: number,
  maxChars: number = RELATION_DEFAULTS.promptMaxChars,
  nameTags: readonly NameTagView[] = [],
  feelingFacts: readonly FeelingView[] = [],
): string {
  const days = Math.max(1, Math.floor((now - person.firstMetAt) / 86_400_000) + 1)
  const aliases = person.aliases.filter(name => name !== relationLabel(person)).slice(-3)
  const feelings = [
    person.affection >= 0.68 ? '对这个人有好感' : person.affection <= 0.32 ? '对这个人有点疏远' : '',
    person.trust >= 0.68 ? '愿意信这个人' : person.trust <= 0.32 ? '还不敢完全信这个人' : '',
    person.annoyance >= 0.40 ? '最近对这个人有点烦' : '',
  ].filter(part => part !== '')
  const latestTag = nameTags.reduce<NameTagView | undefined>(
    (latest, tag) => latest === undefined || tag.lastAt > latest.lastAt ? tag : latest,
    undefined,
  )
  const commonTag = nameTags[0]
  const strongestFeeling = feelingFacts[0]
  const feelingLine = strongestFeeling === undefined ? '' : (() => {
    const quote = strongestFeeling.evidence[0]?.text ?? ''
    const attitude = strongestFeeling.hostility >= 0.4 ? '当时有点冲' :
      strongestFeeling.correction >= 0.5 ? '当时在纠正你' :
        (strongestFeeling.relationalValence ?? strongestFeeling.valence) >= 0 ? '当时对你是友善的' : '当时对你有点不满'
    const uncertain = strongestFeeling.ironyUncertainty >= 0.5 || strongestFeeling.quotationUncertainty >= 0.5
    return `和这个人打交道的旧印象：他之前说过「${quote.slice(0, 60)}」，${attitude}${uncertain ? '，但当时可能带玩笑或转述' : ''}。这只是背景，现在怎么回应仍按眼前这句话判断，不要当面翻旧账。`
  })()
  const lines = [
    `【我和 ${relationLabel(person)} 的关系】用户编号 ${person.personId}｜${relationWord(person)}｜认识第 ${days} 天`,
    latestTag === undefined || latestTag.stance === 'none'
      ? ''
      : `外号旧账：最近一次记下的是「${latestTag.label}」，记录里约来回 ${Math.max(1, Math.round(latestTag.effectiveHits))} 次；这次火候：${NAME_TAG_STANCE_TEXT[latestTag.stance]}。只对这个人，不改整体人设。`,
    commonTag !== undefined && commonTag.label !== latestTag?.label
      ? `常用称呼：平时更常叫我「${commonTag.label}」。`
      : '',
    feelings.length === 0 ? '' : `关系感受：${feelings.join('，')}`,
    feelingLine,
    aliases.length === 0 ? '' : `以前的称呼：${aliases.join('、')}`,
    events.length === 0 ? '' : `最近的事：${events.slice(-3).map(event => event.summary).join('；')}`,
    anniversaries.length === 0 ? '' : `临近纪念日：${anniversaries.map(item => `${item.month}月${item.day}日 ${item.label}`).join('；')}`,
    '称呼和关系只按稳定用户编号与已记录事实，不拿同名昵称猜成同一个人。',
  ].filter(line => line !== '')
  const text = lines.join('\n')
  return text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1))}…` : text
}
