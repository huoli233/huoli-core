// 我认为自己算什么：三档主张只追加，读的时候取最后一条，历史全留着

import fs from 'node:fs'
import path from 'node:path'
import type { Context } from '@huoli/cordis'
import '@huoli/huoli-system-prompt'
import { FILES } from './files.ts'
import { newId, type SelfStore } from './store.ts'
import type { IdentityClaim, IdentityRow, SelfSettings, WriteOutcome } from './types.ts'

/** 三档主张，认别的写法一律拒 */
export const IDENTITY_CLAIMS: readonly IdentityClaim[] = ['alive', 'not_sure', 'not_alive']

// 超长就截断，字段本身不丢
function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}

// 取字符串，取不到给空串
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// 取时间，取不到给零
function stamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// 证据只留非空的字符串，顺序不动
function evidenceOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const kept: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const line = item.trim()
    if (line !== '') kept.push(line)
  }
  return kept
}

/**
 * 这个写法算不算一档主张
 * @param value - 待判的值
 * @returns 是不是三档之一
 */
export function isIdentityClaim(value: unknown): value is IdentityClaim {
  return typeof value === 'string' && IDENTITY_CLAIMS.includes(value as IdentityClaim)
}

/**
 * 读一条身份主张
 * @param record - 文件里的一行
 * @returns 三档之一、理由与证据都齐时给这一条，缺字段时为 undefined
 */
export function toIdentity(record: Record<string, unknown>): IdentityRow | undefined {
  const claim = record.claim
  if (!isIdentityClaim(claim)) return undefined
  const at = stamp(record.at)
  const id = str(record.id)
  const why = str(record.why)
  const evidence = evidenceOf(record.evidence)
  if (id === '' || at === 0 || why === '' || evidence.length === 0) return undefined
  return { at, id, claim, why, evidence }
}

/**
 * 记一条她对自己算什么的主张：三档之一、一句理由与至少一条证据都齐才落一条，写一条留一条
 * @param store - 目录读写口
 * @param settings - 参数表
 * @param claim - 三档之一
 * @param why - 她自己的理由
 * @param evidence - 一到几条证据，记忆编号或日期
 * @param at - 记下的时刻
 * @returns 落没落盘
 */
export function recordIdentity(
  store: SelfStore,
  settings: SelfSettings,
  claim: IdentityClaim,
  why: string,
  evidence: readonly string[],
  at: number,
): WriteOutcome {
  // 三档与文件里的写法逐字对上：认不出就不落，别把一份读不回来的主张写进去
  if (!isIdentityClaim(claim)) return { written: false, proposed: false, reason: 'unknown_claim' }
  const reason = why.trim()
  const kept = evidenceOf(evidence)
  if (reason === '' || kept.length === 0) return { written: false, proposed: false, reason: 'no_evidence' }
  store.append(FILES.identity, {
    at,
    id: newId(at),
    claim,
    why: clip(reason, settings.identityWhyMaxChars),
    evidence: kept.slice(0, settings.identityEvidenceMax),
  })
  return { written: true, proposed: false }
}

/**
 * 身份主张的全部记录，按文件顺序，最后一条就是当前主张
 * @param store - 目录读写口
 * @returns 读得出来的记录，坏行与缺字段的行跳过
 */
export function identityHistory(store: SelfStore): IdentityRow[] {
  const rows: IdentityRow[] = []
  for (const record of store.records(FILES.identity)) {
    const row = toIdentity(record)
    if (row !== undefined) rows.push(row)
  }
  return rows
}

/**
 * 当前主张：取最后写进去的那一条，不按时刻排，反复写就以最后一条为准
 * @param store - 目录读写口
 * @returns 最后一条，没写过时为 undefined
 */
export function identityOf(store: SelfStore): IdentityRow | undefined {
  const rows = identityHistory(store)
  return rows[rows.length - 1]
}

/** 一个渠道怎么说话 */
export interface PersonaTone {
  private: string
  group: string
  proactive: string
}

/** 一份角色补充档案 */
export interface PersonaProfile {
  id: string
  name: string
  summary: string
  world: string
  values: string[]
  boundaries: string[]
  tone: PersonaTone
  createdAt: number
  updatedAt: number
}

/** 新建或修改角色档案时给的字段 */
export interface PersonaProfileInput {
  id: string
  name: string
  summary?: string
  world?: string
  values?: readonly string[]
  boundaries?: readonly string[]
  tone?: Partial<PersonaTone>
}

/** 角色档案文件 */
export interface PersonaCatalogState {
  version: 1
  activeId: string
  bindings: Record<string, string>
  profiles: Record<string, PersonaProfile>
}

/** 角色档案读写口 */
export interface PersonaCatalog {
  read(): PersonaCatalogState
  list(): PersonaProfile[]
  get(id: string): PersonaProfile | undefined
  active(): PersonaProfile | undefined
  forChat(chatKey: string): PersonaProfile | undefined
  upsert(input: PersonaProfileInput, at: number): PersonaProfile
  remove(id: string): boolean
  setActive(id: string): void
  bind(chatKey: string, id: string): void
  render(chatKey: string, channel?: keyof PersonaTone): string
  flush(): void
}

function emptyCatalog(): PersonaCatalogState {
  return { version: 1, activeId: '', bindings: {}, profiles: {} }
}

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
    : []
}

function profileOf(value: unknown): PersonaProfile | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  if (id === '' || name === '') return undefined
  const tone = row.tone !== null && typeof row.tone === 'object' && !Array.isArray(row.tone)
    ? row.tone as Record<string, unknown>
    : {}
  return {
    id,
    name,
    summary: typeof row.summary === 'string' ? row.summary.trim() : '',
    world: typeof row.world === 'string' ? row.world.trim() : '',
    values: textList(row.values),
    boundaries: textList(row.boundaries),
    tone: {
      private: typeof tone.private === 'string' ? tone.private.trim() : '',
      group: typeof tone.group === 'string' ? tone.group.trim() : '',
      proactive: typeof tone.proactive === 'string' ? tone.proactive.trim() : '',
    },
    createdAt: typeof row.createdAt === 'number' && Number.isFinite(row.createdAt) ? row.createdAt : 0,
    updatedAt: typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt) ? row.updatedAt : 0,
  }
}

function readCatalog(file: string): PersonaCatalogState {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return emptyCatalog()
    const row = raw as Record<string, unknown>
    const profiles: Record<string, PersonaProfile> = {}
    const source = row.profiles !== null && typeof row.profiles === 'object' && !Array.isArray(row.profiles)
      ? row.profiles as Record<string, unknown>
      : {}
    for (const [id, value] of Object.entries(source)) {
      const profile = profileOf(value)
      if (profile !== undefined) profiles[id] = profile
    }
    const bindings: Record<string, string> = {}
    if (row.bindings !== null && typeof row.bindings === 'object' && !Array.isArray(row.bindings)) {
      for (const [chatKey, id] of Object.entries(row.bindings as Record<string, unknown>)) {
        if (typeof id === 'string' && profiles[id] !== undefined) bindings[chatKey] = id
      }
    }
    const activeId = typeof row.activeId === 'string' && profiles[row.activeId] !== undefined ? row.activeId : ''
    return { version: 1, activeId, bindings, profiles }
  } catch {
    return emptyCatalog()
  }
}

function saveCatalog(file: string, state: PersonaCatalogState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * 建角色档案仓
 * @param file - 档案文件
 * @returns 多角色、绑定和提示词出口
 */
export function createPersonaCatalog(file: string): PersonaCatalog {
  let state = readCatalog(file)
  const persist = (): void => { saveCatalog(file, state) }
  const api: PersonaCatalog = {
    read: () => structuredClone(state),
    list: () => Object.values(state.profiles)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(profile => structuredClone(profile)),
    get(id) {
      const profile = state.profiles[id]
      return profile === undefined ? undefined : structuredClone(profile)
    },
    active() {
      const profile = state.profiles[state.activeId]
      return profile === undefined ? undefined : structuredClone(profile)
    },
    forChat(chatKey) {
      const id = state.bindings[chatKey] ?? state.activeId
      const profile = state.profiles[id]
      return profile === undefined ? undefined : structuredClone(profile)
    },
    upsert(input, at) {
      const id = input.id.trim()
      const name = input.name.trim()
      if (id === '' || name === '') throw new Error('persona.id_name_required')
      const previous = state.profiles[id]
      const profile: PersonaProfile = {
        id,
        name,
        summary: (input.summary ?? previous?.summary ?? '').trim(),
        world: (input.world ?? previous?.world ?? '').trim(),
        values: input.values === undefined ? previous?.values ?? [] : textList(input.values),
        boundaries: input.boundaries === undefined ? previous?.boundaries ?? [] : textList(input.boundaries),
        tone: {
          private: (input.tone?.private ?? previous?.tone.private ?? '').trim(),
          group: (input.tone?.group ?? previous?.tone.group ?? '').trim(),
          proactive: (input.tone?.proactive ?? previous?.tone.proactive ?? '').trim(),
        },
        createdAt: previous?.createdAt ?? at,
        updatedAt: at,
      }
      state = {
        ...state,
        profiles: { ...state.profiles, [id]: profile },
        activeId: state.activeId === '' ? id : state.activeId,
      }
      persist()
      return structuredClone(profile)
    },
    remove(id) {
      if (state.profiles[id] === undefined) return false
      const profiles = Object.fromEntries(Object.entries(state.profiles).filter(([key]) => key !== id))
      const bindings = Object.fromEntries(Object.entries(state.bindings).filter(([, value]) => value !== id))
      state = {
        ...state,
        profiles,
        bindings,
        activeId: state.activeId === id ? Object.keys(profiles)[0] ?? '' : state.activeId,
      }
      persist()
      return true
    },
    setActive(id) {
      if (state.profiles[id] === undefined) throw new Error('persona.unknown')
      state = { ...state, activeId: id }
      persist()
    },
    bind(chatKey, id) {
      if (id !== '' && state.profiles[id] === undefined) throw new Error('persona.unknown')
      const bindings = id === ''
        ? Object.fromEntries(Object.entries(state.bindings).filter(([key]) => key !== chatKey))
        : { ...state.bindings, [chatKey]: id }
      state = { ...state, bindings }
      persist()
    },
    render(chatKey, channel) {
      const profile = api.forChat(chatKey)
      if (profile === undefined) return ''
      const toneKey = channel ?? (chatKey.startsWith('private:') ? 'private' : 'group')
      const tone = profile.tone[toneKey]
      const lines = [
        `【角色档案补足：${profile.name}】这是对 DSH 当前人设的补充，不覆盖核心身份。`,
        profile.summary === '' ? '' : `简介：${profile.summary}`,
        profile.world === '' ? '' : `世界与背景：${profile.world}`,
        profile.values.length === 0 ? '' : `看重的事：${profile.values.join('、')}`,
        profile.boundaries.length === 0 ? '' : `边界：${profile.boundaries.join('；')}`,
        tone === '' ? '' : `当前语气：${tone}`,
      ].filter(line => line !== '')
      return lines.join('\n')
    },
    flush() {
      persist()
    },
  }
  return api
}

/** 角色档案给装配层用的控制口 */
export interface PersonaProfileControl {
  methods: {
    personaProfile(chatKey: string): PersonaProfile | undefined
    personaProfiles(): PersonaProfile[]
    savePersonaProfile(input: PersonaProfileInput, at?: number): WriteOutcome
    setActivePersona(id: string): WriteOutcome
    bindPersona(chatKey: string, id: string): WriteOutcome
    removePersonaProfile(id: string): WriteOutcome
  }
  flush(): void
}

/**
 * 装配角色档案、初始内容和提示词补充
 * @param ctx - 运行环境
 * @param options - 开关、目录、文件和初始档案
 * @returns 面板与管理入口
 */
export function installPersonaProfiles(
  ctx: Context,
  options: {
    enabled: boolean
    dir: string
    file?: string
    profiles?: readonly PersonaProfileInput[]
    activeId?: string
  },
): PersonaProfileControl {
  const catalog = createPersonaCatalog(options.file ?? path.join(options.dir, 'persona-profiles.json'))
  const disabled = (): WriteOutcome => ({ written: false, proposed: false, reason: 'disabled' })
  if (options.enabled) {
    for (const profile of options.profiles ?? []) {
      if (catalog.get(profile.id) === undefined) catalog.upsert(profile, Date.now())
    }
    if (options.activeId !== undefined && catalog.get(options.activeId) !== undefined) catalog.setActive(options.activeId)
    ctx.systemPrompt.section({
      name: 'qq:persona-profile',
      order: 315,
      text: context => catalog.render(String(context.agent?.id ?? '')),
    })
  }
  return {
    methods: {
      personaProfile: chatKey => options.enabled ? catalog.forChat(chatKey) : undefined,
      personaProfiles: () => options.enabled ? catalog.list() : [],
      savePersonaProfile(input, at = Date.now()) {
        if (!options.enabled) return disabled()
        try {
          catalog.upsert(input, at)
          return { written: true, proposed: false }
        } catch {
          return { written: false, proposed: false, reason: 'unknown_claim' }
        }
      },
      setActivePersona(id) {
        if (!options.enabled) return disabled()
        try {
          catalog.setActive(id)
          return { written: true, proposed: false }
        } catch {
          return { written: false, proposed: false, reason: 'unknown_claim' }
        }
      },
      bindPersona(chatKey, id) {
        if (!options.enabled) return disabled()
        try {
          catalog.bind(chatKey, id)
          return { written: true, proposed: false }
        } catch {
          return { written: false, proposed: false, reason: 'unknown_claim' }
        }
      },
      removePersonaProfile(id) {
        if (!options.enabled) return disabled()
        return catalog.remove(id)
          ? { written: true, proposed: false }
          : { written: false, proposed: false, reason: 'unknown_claim' }
      },
    },
    flush() {
      if (options.enabled) catalog.flush()
    },
  }
}
