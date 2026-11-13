// 七维状态的纯计算：事件、软上限、时间衰减和事后余韵都不碰文件

/** 七个可调维度 */
export const DIMS = ['lust', 'lewd', 'possess', 'shame', 'resist', 'fatigue', 'affection'] as const

/** 一个维度名 */
export type Dim = typeof DIMS[number]

/** 长期状态 */
export interface LongingState {
  version: 1
  lust: number
  lewd: number
  possess: number
  shame: number
  resist: number
  fatigue: number
  affection: number
  scene: string
  events: Array<{ name: EventName; at: number }>
  firsts: Partial<Record<EventName, number>>
  grudges: Array<{ name: EventName; at: number; days: number }>
  aftercareUntil: number
  pausedUntil: number
  lastPeak: string
  lastContactAt: number
  everContacted: boolean
  tickedAt: number
  updatedAt: number
}

/** 调参 */
export interface LongingTuning {
  nsfwEnabled: boolean
  eventGain: number
  couplingEnabled: boolean
  couplingRate: number
  decayPerHour: number
  nightDecayPerHour: number
  peakWindow: string
  peakBonus: number
  interactionLust: number
  affectionGain: number
}

/** 默认值只在这里出现一次 */
export const DEFAULTS: LongingTuning = {
  nsfwEnabled: false,
  eventGain: 1,
  couplingEnabled: true,
  couplingRate: 1,
  decayPerHour: 3,
  nightDecayPerHour: 6,
  peakWindow: '22:00-02:00',
  peakBonus: 25,
  interactionLust: 0.1,
  affectionGain: 1,
}

/** 七个维度的日常值与半衰期，单位小时 */
export const DRIFT: Record<Dim, { base: number; half: number }> = {
  lust: { base: 30, half: 24 },
  lewd: { base: 45, half: 36 },
  possess: { base: 55, half: 30 },
  shame: { base: 55, half: 20 },
  resist: { base: 50, half: 10 },
  fatigue: { base: 20, half: 10 },
  affection: { base: 40, half: 72 },
}

/** 一个事件名 */
export type EventName =
  | 'praise' | 'comfort' | 'intimate' | 'desire' | 'protect' | 'apologize' | 'promise'
  | 'tease' | 'gift' | 'coax' | 'cold' | 'reject' | 'ignore' | 'mentionOther'
  | 'compare' | 'blame' | 'lie' | 'leave' | 'force' | 'bodyShame' | 'neglect'
  | 'climax' | 'stop'

/** 一条事件定义 */
export interface EventDefinition {
  tone: string
  dims: Partial<Record<Dim, number>>
  note: string
  grudge?: number
  strong?: boolean
  aftercareMin?: number
  pauseMin?: number
}

/** 事件表 */
export const EVENTS: Record<EventName, EventDefinition> = {
  praise: { tone: 'good', dims: { affection: 1, lust: 1, shame: 1, resist: -0.5 }, note: '刚被夸过一句，心里还热着' },
  comfort: { tone: 'good', dims: { affection: 1.5, fatigue: -2, resist: 1, shame: 0.5 }, note: '被哄了一会儿，绷着的劲松了' },
  intimate: { tone: 'good', dims: { lust: 2, lewd: 1, shame: -1.5, affection: 1, resist: -1 }, note: '被碰过了，皮肤还记着' },
  desire: { tone: 'good', dims: { lust: 2.5, lewd: 1.5, shame: -2, resist: -0.5 }, note: '刚被要过，身体还没凉下来' },
  protect: { tone: 'good', dims: { affection: 1.5, possess: 0.5, fatigue: -1 }, note: '被护着的时候，心是放在他身上的' },
  apologize: { tone: 'good', dims: { affection: 1, possess: -1, shame: 0.5 }, note: '他道过歉，气消了一半' },
  promise: { tone: 'good', dims: { affection: 1.5, possess: 1, resist: 1 }, note: '被许诺过，愿意再信一次' },
  tease: { tone: 'good', dims: { lust: 1.5, lewd: 1, shame: -1, resist: -0.5 }, note: '被他撩了一下，还恼着也还想着' },
  gift: { tone: 'good', dims: { affection: 1, possess: 0.5 }, note: '收了他的东西，有点拿人手短' },
  coax: { tone: 'good', dims: { lust: 1.5, shame: -1, resist: -1, affection: 0.5 }, note: '被哄软了，本来绷着的' },
  cold: { tone: 'bad', dims: { affection: -1, lust: -1.5, possess: 0.5, shame: 0.5 }, note: '被冷了一下，热乎劲退了' },
  reject: { tone: 'bad', dims: { lust: -3, resist: 4, affection: -1, shame: 1.5, fatigue: 1 }, note: '刚被拒绝过，身体先凉了半截' },
  ignore: { tone: 'bad', dims: { affection: -1.5, possess: 1, lust: -1 }, note: '被晾了一会儿，心里存着事' },
  mentionOther: { tone: 'bad', dims: { possess: 2.5, affection: -1, lust: -0.5, resist: -1 }, note: '他刚提到别人，心口一直发紧' },
  compare: {
    tone: 'bad', grudge: 1, dims: { affection: -2, possess: 1.5, shame: -1, resist: 1 }, note: '被拿去跟人比了，脸上挂不住',
  },
  blame: {
    tone: 'bad', grudge: 1, dims: { affection: -2, resist: 1.5, lust: -2, shame: -1.5, fatigue: 1 }, note: '被凶过，眼睛还酸着',
  },
  lie: { tone: 'bad', grudge: 2, dims: { affection: -2.5, resist: 1, possess: 1 }, note: '发现他说了谎，那些话听着都不像' },
  leave: {
    tone: 'bad', grudge: 3, dims: { affection: -4, possess: 2, lust: -2.5, resist: 2.5, shame: -1 }, note: '他刚说了要走，胸口空了一块',
  },
  force: {
    tone: 'bad', grudge: 2, dims: { affection: -2.5, resist: 2, shame: -2, lust: -1, fatigue: 1.5 }, note: '他没听她的，现在还缩着',
  },
  bodyShame: {
    tone: 'bad', grudge: 2, dims: { affection: -2.5, shame: 2.5, lust: -2 }, note: '身材被他嫌过，连站着都不自在',
  },
  neglect: { tone: 'bad', dims: { affection: -1.5, possess: 1, resist: 0.5 }, note: '又被晾了一整天，连他是不是不要我了都开始想' },
  climax: {
    tone: 'good',
    strong: true,
    aftercareMin: 45,
    dims: { lust: -25, affection: 3, shame: 8, fatigue: 6, resist: 5 },
    note: '刚刚结束，身体还软着',
  },
  stop: {
    tone: '', strong: true, pauseMin: 30,
    dims: { resist: 20, lust: -30, shame: 2 }, note: '刚说过停',
  },
}

/** 所有事件名 */
export const EVENT_NAMES = Object.keys(EVENTS) as EventName[]

/** 需要成人总闸的事件 */
export const INTIMATE_EVENTS = new Set<EventName>(['intimate', 'desire', 'tease', 'climax'])

const FIRST_EVENTS = new Set<EventName>(['intimate', 'desire', 'leave', 'force', 'reject'])
const MAX_DELTA = 6
const MAX_STRONG = 30
const DECAY_WINDOW_MS = 3_600_000
const KEEP_EVENTS = 24
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/** 数字读法：空值走兜底 */
export function num(value: unknown, fallback = 0): number {
  if (value === null || value === '' || value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 浮点夹取 */
export function clampFloat(value: number, min = 0, max = 100): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
}

/** 两位小数 */
export function round2(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0
}

function parseWindow(spec: string): { start: number; end: number } | null {
  const matched = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/u.exec(spec.trim())
  if (matched === null) return null
  return {
    start: Number(matched[1]) * 60 + Number(matched[2]),
    end: Number(matched[3]) * 60 + Number(matched[4]),
  }
}

function inWindow(window: { start: number; end: number } | null, at: number): boolean {
  if (window === null) return true
  const date = new Date(at)
  const minute = date.getHours() * 60 + date.getMinutes()
  return window.start <= window.end
    ? minute >= window.start && minute < window.end
    : minute >= window.start || minute < window.end
}

function hoursInWindow(from: number, to: number, spec: string): number {
  const window = parseWindow(spec)
  if (window === null || to <= from) return 0
  const start = Math.max(from, to - 24 * HOUR_MS)
  const step = 15 * 60_000
  let total = 0
  for (let at = start; at < to; at += step) total += inWindow(window, at) ? Math.min(step, to - at) : 0
  return total / HOUR_MS
}

function dayKey(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

/** 初始状态 */
export function emptyLongingState(at = Date.now()): LongingState {
  return {
    version: 1,
    lust: 30,
    lewd: 35,
    possess: 55,
    shame: 45,
    resist: 50,
    fatigue: 20,
    affection: 30,
    scene: '',
    events: [],
    firsts: {},
    grudges: [],
    aftercareUntil: 0,
    pausedUntil: 0,
    lastPeak: '',
    lastContactAt: 0,
    everContacted: false,
    tickedAt: at,
    updatedAt: at,
  }
}

/** 读入后把缺项补齐 */
export function normalizeLongingState(input: Partial<LongingState>, at = Date.now()): LongingState {
  const base = emptyLongingState(at)
  const state: LongingState = {
    ...base,
    ...input,
    version: 1,
    scene: typeof input.scene === 'string' ? input.scene.slice(0, 80) : '',
    events: input.events?.slice(-KEEP_EVENTS) ?? [],
    firsts: input.firsts !== undefined && typeof input.firsts === 'object' ? input.firsts : {},
    grudges: input.grudges?.slice(-3) ?? [],
  }
  for (const dim of DIMS) state[dim] = clampFloat(num(input[dim], base[dim]))
  state.aftercareUntil = Math.max(0, num(input.aftercareUntil))
  state.pausedUntil = Math.max(0, num(input.pausedUntil))
  state.lastContactAt = Math.max(0, num(input.lastContactAt))
  state.everContacted = input.everContacted === true
  state.tickedAt = Math.max(0, num(input.tickedAt, at))
  state.updatedAt = Math.max(0, num(input.updatedAt, at))
  return state
}

/** 有效欲望：想要乘上她愿不愿意 */
export function effectiveDesire(state: LongingState): number {
  const will = clampFloat(1 - 0.4 * (1 - state.affection / 100), 0.2, 1)
  return round2(clampFloat((state.lust - state.resist * 0.55) * will))
}

/** 各维度的软上限 */
export function pressureOf(state: LongingState, tuning: LongingTuning): Record<Dim, number> {
  if (!tuning.couplingEnabled) return Object.fromEntries(DIMS.map(dim => [dim, 100])) as Record<Dim, number>
  return {
    resist: clampFloat(210 - 2 * state.possess, 5, 100),
    shame: clampFloat(120 - 1.1 * state.lewd, 5, 100),
    lust: clampFloat(140 - 1.1 * state.fatigue, 5, 100),
    possess: clampFloat(30 + state.affection * 0.9, 5, 100),
    affection: 100,
    lewd: 100,
    fatigue: 100,
  }
}

function decayTo(value: number, base: number, cap: number, halfHours: number, hours: number, rate: number): number {
  const target = Math.min(base, cap)
  return target + (value - target) * Math.pow(0.5, (rate * hours) / Math.max(0.5, halfHours))
}

function evolve(
  previous: LongingState,
  tuning: LongingTuning,
  hours: number,
  peakHours: number,
): LongingState {
  const next = { ...previous }
  const rate = tuning.couplingEnabled ? Math.max(0, tuning.couplingRate) : 0
  if (rate <= 0 || hours <= 0) return next
  const pressure = pressureOf(next, tuning)
  for (const dim of DIMS) {
    if (next[dim] > pressure[dim]) {
      next[dim] = pressure[dim] + (next[dim] - pressure[dim]) * Math.exp(-0.4 * rate * hours)
    }
  }
  next.fatigue += 2.5 * rate * peakHours
  if (next.lust > 80) next.resist -= (next.lust - 80) * 0.04 * rate * hours
  if (next.lust > next.lewd) next.lewd = next.lust + (next.lewd - next.lust) * Math.exp(-0.05 * rate * hours)
  if (next.affection > 60 && next.possess < pressure.possess) {
    next.possess = Math.min(pressure.possess, next.possess + (next.affection - 60) * 0.02 * rate * hours)
  }
  if (next.possess > 85) next.affection -= (next.possess - 85) * 0.03 * rate * hours
  for (const dim of DIMS) {
    if (dim === 'lust') continue
    next[dim] = decayTo(next[dim], DRIFT[dim].base, pressure[dim], DRIFT[dim].half, hours, rate)
  }
  for (const dim of DIMS) next[dim] = clampFloat(next[dim])
  return next
}

/** 按真实经过时间推进一次 */
export function nextLongingState(
  previous: LongingState,
  tuning: LongingTuning,
  at = Date.now(),
): LongingState {
  const hours = Math.min(24, Math.max(0, (at - previous.tickedAt) / HOUR_MS))
  const peakHours = hoursInWindow(previous.tickedAt, at, tuning.peakWindow)
  const restHours = Math.max(0, hours - peakHours)
  const next = { ...previous }
  const decay = Math.max(0, tuning.decayPerHour) * restHours
    + Math.max(0, tuning.nightDecayPerHour) * 0.25 * peakHours
  if (next.lust > DRIFT.lust.base) next.lust = Math.max(DRIFT.lust.base, next.lust - decay)
  else next.lust = Math.min(DRIFT.lust.base, next.lust + 0.5 * hours)
  const window = parseWindow(tuning.peakWindow)
  if (inWindow(window, at) && next.lastPeak !== dayKey(at)) {
    next.lust = Math.min(100, next.lust + tuning.peakBonus)
    next.lastPeak = dayKey(at)
  }
  const evolved = evolve(next, tuning, hours, peakHours)
  evolved.tickedAt = at
  evolved.updatedAt = at
  return evolved
}

function eventMultiplier(state: LongingState, name: EventName, at: number): number {
  const count = state.events.filter(event => event.name === name && at - event.at < DECAY_WINDOW_MS).length
  return 1 / (1 + count)
}

/** 事件回执 */
export interface EventOutcome {
  ok: boolean
  reason?: string
  applied: Partial<Record<Dim, number>>
  state: LongingState
}

/** 施加一个事件 */
export function applyLongingEvent(
  previous: LongingState,
  name: EventName,
  tuning: LongingTuning,
  at = Date.now(),
): EventOutcome {
  if (!tuning.nsfwEnabled && INTIMATE_EVENTS.has(name)) {
    return { ok: false, reason: '成人内容总闸关着', applied: {}, state: previous }
  }
  const definition = EVENTS[name]
  const multiplier = eventMultiplier(previous, name, at) * Math.max(0, tuning.eventGain)
  const next = { ...previous }
  const applied: Partial<Record<Dim, number>> = {}
  for (const [rawDim, rawValue] of Object.entries(definition.dims)) {
    const dim = rawDim as Dim
    const raw = num(rawValue) * multiplier
    const delta = definition.strong === true
      ? Math.max(-MAX_STRONG, Math.min(MAX_STRONG, raw))
      : Math.max(-MAX_DELTA, Math.min(MAX_DELTA, raw))
    next[dim] = clampFloat(next[dim] + delta)
    applied[dim] = round2(delta)
  }
  const pauseMin = definition.pauseMin
  const aftercareMin = definition.aftercareMin
  if (pauseMin !== undefined) next.pausedUntil = Math.max(next.pausedUntil, at + pauseMin * 60_000)
  if (aftercareMin !== undefined) next.aftercareUntil = Math.max(next.aftercareUntil, at + aftercareMin * 60_000)
  next.events = [...previous.events, { name, at }]
    .filter(event => at - event.at < DECAY_WINDOW_MS)
    .slice(-KEEP_EVENTS)
  const grudge = definition.grudge
  if (grudge !== undefined) {
    next.grudges = [...next.grudges, { name, at, days: grudge }]
      .filter(item => at - item.at < item.days * DAY_MS)
      .slice(-3)
  }
  if (FIRST_EVENTS.has(name) && next.firsts[name] === undefined) next.firsts = { ...next.firsts, [name]: at }
  next.updatedAt = at
  return { ok: true, applied, state: next }
}
