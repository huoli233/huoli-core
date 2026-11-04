// 一周一次汇总：近七天的三行、错处、两档账与项目状态

import { daysSince, localDay } from './day.ts'
import { errorsSince } from './errors.ts'
import { FILES } from './files.ts'
import { toProject } from './rows.ts'
import type { SelfStore } from './store.ts'
import type { LedgerSummary, ProjectTally, SelfSettings, WeeklyReview } from './types.ts'

// 一天多长，用来算七天里有几天没写
const DAY_MS = 24 * 60 * 60 * 1000

/** 汇总一次要用的东西 */
export interface ReviewOptions {
  /** 目录读写口 */
  store: SelfStore
  /** 参数表 */
  settings: SelfSettings
  /** 汇总的时刻 */
  now: number
  /** 两档账，由账本自己算好递进来，两档从不相加 */
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
 * @returns 三行、错处、两档账、项目状态与缺了几天
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
  }
}
