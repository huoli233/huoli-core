// 一周一次汇总：近七天的三行、错处、两档账与项目状态

import { daysSince, localDay } from './day.ts'
import { errorsSince } from './errors.ts'
import { FILES } from './files.ts'
import { identityOf } from './identity.ts'
import { toProject } from './rows.ts'
import type { SelfStore } from './store.ts'
import type { LedgerSummary, ProjectTally, SelfSettings, WeeklyReview, WriteOutcome } from './types.ts'

// 一天多长，用来算七天里有几天没写
const DAY_MS = 24 * 60 * 60 * 1000

// 月份键：每月十问一个月只留一条
function monthOf(at: number): string {
  return localDay(at).slice(0, 7)
}

/**
 * 这个月那一次十问
 * @param store - 目录读写口
 * @param at - 要看哪个月，按当地日历算
 * @returns 本月那条，没写过就是 undefined
 */
export function probeOf(store: SelfStore, at: number): Record<string, unknown> | undefined {
  const month = monthOf(at)
  for (const row of store.records(FILES.probe)) {
    const taken = row.at
    if (typeof taken !== 'number' || !Number.isFinite(taken)) continue
    if (monthOf(taken) === month) return row
  }
  return undefined
}

/**
 * 记一次每月十问：一个月一条，条数与每条字数都卡住
 * @param store - 目录读写口
 * @param settings - 参数表，问数与每答字数在里面
 * @param answers - 十问的回答，按顺序
 * @param at - 记录的时刻
 * @returns 落盘结果，条数不对或本月已写过时给原因
 */
export function writeProbe(
  store: SelfStore,
  settings: SelfSettings,
  answers: readonly string[],
  at: number,
): WriteOutcome {
  const kept = answers.map(answer => answer.trim()).filter(answer => answer !== '')
  if (kept.length !== settings.probeQuestionCount) return { written: false, proposed: false, reason: 'wrong_count' }
  if (kept.some(answer => answer.length > settings.probeAnswerMaxChars)) {
    return { written: false, proposed: false, reason: 'no_evidence' }
  }
  if (probeOf(store, at) !== undefined) return { written: false, proposed: false, reason: 'capped' }
  store.append(FILES.probe, { at, month: monthOf(at), answers: kept })
  return { written: true, proposed: false }
}

/** 汇总一次要用的东西 */
export interface ReviewOptions {
  /** 目录读写口 */
  store: SelfStore
  /** 参数表 */
  settings: SelfSettings
  /** 汇总的时刻 */
  now: number
  /** 两档账，由记录表自己算好递进来，两档从不相加 */
  ledger: LedgerSummary
}

// 项目按收尾状态分别计数，提议单独一档
function tallyProjects(store: SelfStore): ProjectTally {
  const tally: ProjectTally = { open: 0, done: 0, failed: 0, dropped: 0, proposed: 0 }
  for (const record of store.records(FILES.projects)) {
    const row = toProject(record)
    if (row === undefined) continue
    if (record.proposed === true) {
      tally.proposed += 1
      continue
    }
    tally[row.outcome] += 1
  }
  return tally
}

/**
 * 汇总近七天
 * @param options - 目录、参数、时刻与两档账
 * @returns 三行、错处、两档账、项目状态、缺了几天与当前主张
 */
export function weeklyReview(options: ReviewOptions): WeeklyReview {
  const { store, settings, now } = options
  const since = now - settings.weekMs
  const days = daysSince(store, since)
  const errors = errorsSince(store, since)
  const dayCount = Math.max(1, Math.round(settings.weekMs / DAY_MS))
  const covered = new Set(days.filter(row => !row.skipped).map(row => localDay(row.at)))
  return {
    since,
    days,
    errors,
    ledger: options.ledger,
    projects: tallyProjects(store),
    missingDays: Math.max(0, dayCount - covered.size),
    identity: identityOf(store),
  }
}
