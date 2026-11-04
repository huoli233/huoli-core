// 把目录里的行读成能用的样子：字段不全就当没有这条

import type {
  AgencyEntry,
  AgencyOutcome,
  DriveEntry,
  DriveNeed,
  ProjectOutcome,
  ProjectRow,
  QuestionRow,
} from './types.ts'

/** 身体的四种需要，与身体那边的字段名逐字相同 */
export const DRIVE_NEEDS: readonly DriveNeed[] = ['hunger', 'thirst', 'adenosine', 'energy']

// 收尾的三种结果
const AGENCY_OUTCOMES: readonly AgencyOutcome[] = ['done', 'failed', 'dropped']

// 项目的四种状态
const PROJECT_OUTCOMES: readonly ProjectOutcome[] = ['open', 'done', 'failed', 'dropped']

// 取字符串，取不到给空串
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// 取时间，取不到给零
function stamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// 取布尔
function flag(value: unknown): boolean {
  return value === true
}

/**
 * 这个名字在不在四种需要里
 * @param value - 待判的值
 * @param needs - 允许的名字
 * @returns 是不是需要
 */
export function isDriveNeed(value: unknown, needs: readonly DriveNeed[] = DRIVE_NEEDS): value is DriveNeed {
  return typeof value === 'string' && needs.includes(value as DriveNeed)
}

/**
 * 这个收尾结果认不认
 * @param value - 待判的值
 * @returns 是不是三种之一
 */
export function isAgencyOutcome(value: unknown): value is AgencyOutcome {
  return typeof value === 'string' && AGENCY_OUTCOMES.includes(value as AgencyOutcome)
}

/**
 * 读一条 drive
 * @param record - 文件里的一行
 * @returns 缺字段或需要不认识时为 undefined
 */
export function toDrive(record: Record<string, unknown>): DriveEntry | undefined {
  const need = record.need
  if (!isDriveNeed(need)) return undefined
  const at = stamp(record.at)
  const id = str(record.id)
  if (id === '' || at === 0) return undefined
  return { at, id, kind: 'drive', need, did: str(record.did), resolved: flag(record.resolved) }
}

/**
 * 读一条 agency
 * @param record - 文件里的一行
 * @returns 缺字段时为 undefined
 */
export function toAgency(record: Record<string, unknown>): AgencyEntry | undefined {
  const at = stamp(record.at)
  const id = str(record.id)
  const outcome = record.outcome
  if (id === '' || at === 0 || !isAgencyOutcome(outcome)) return undefined
  return {
    at,
    id,
    kind: 'agency',
    project_id: str(record.project_id),
    verbatim: str(record.verbatim),
    because: str(record.because),
    fail_if: str(record.fail_if),
    outcome,
    artifact: str(record.artifact),
  }
}

/**
 * 读一条项目
 * @param record - 文件里的一行
 * @returns 缺字段时为 undefined
 */
export function toProject(record: Record<string, unknown>): ProjectRow | undefined {
  const at = stamp(record.at)
  const id = str(record.id)
  const title = str(record.title)
  const outcome = record.outcome
  if (id === '' || at === 0 || title === '') return undefined
  if (typeof outcome !== 'string' || !PROJECT_OUTCOMES.includes(outcome as ProjectOutcome)) return undefined
  return { at, id, title, next: str(record.next), fail_if: str(record.fail_if), outcome: outcome as ProjectOutcome }
}

/**
 * 读一条想问的事
 * @param record - 文件里的一行
 * @returns 缺字段时为 undefined
 */
export function toQuestion(record: Record<string, unknown>): QuestionRow | undefined {
  const at = stamp(record.at)
  const id = str(record.id)
  const text = str(record.text)
  if (id === '' || at === 0 || text === '') return undefined
  return { at, id, text }
}
