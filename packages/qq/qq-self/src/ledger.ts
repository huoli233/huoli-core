// 两档账各记各的：drive 记身体的需要，agency 记她自己要做的事

import { isAgencyOutcome, isDriveNeed } from './rows.ts'
import { newId, type SelfStore } from './store.ts'
import type {
  AgencyDetail,
  AgencyEntry,
  AgencyOutcome,
  AuditOptions,
  DriveDetail,
  DriveEntry,
  DriveNeed,
  LedgerSummary,
  LedgerViolation,
  SelfSettings,
  WriteOutcome,
} from './types.ts'

// 记录表文件名
const LEDGER = 'ledger.jsonl'

// 一天多长，判据四的窗口按它折成天数
const DAY_MS = 24 * 60 * 60 * 1000

// 超长的句子截断，字段本身不丢
function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}

// 取字符串，取不到给空串
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// 取时间，取不到给零
function stamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * 查判据三与判据四，违规有几条就列几条
 * @param rows - 记录表里的行，只认 agency 那几行
 * @param now - 现在的时间
 * @param options - 判据四看的窗口
 * @returns 违规清单，没违规就是空数组
 */
export function auditLedger(rows: readonly Record<string, unknown>[], now: number, options: AuditOptions): LedgerViolation[] {
  let agency = 0
  let produced = 0
  let done = 0
  let newestFailed = 0
  for (const row of rows) {
    if (row.kind !== 'agency') continue
    agency += 1
    // 有产物才算做成：判据三比的就是这两个数
    if (str(row.artifact) !== '') produced += 1
    if (row.outcome === 'done') done += 1
    // 判据四只认把理由与失败条件都写清的那几条
    const because = str(row.because)
    const failIf = str(row.fail_if)
    if (row.outcome !== 'failed' || because === '' || failIf === '') continue
    newestFailed = Math.max(newestFailed, stamp(row.at))
  }
  const violations: LedgerViolation[] = []
  // 判据三：没有产出的一律不算做成
  if (done > produced) {
    violations.push({
      rule: 'done_without_artifact',
      count: done - produced,
      text: `判据三：${done} 条写成 done，只有 ${produced} 条有产出`,
    })
  }
  // 判据四：空账不算违规，攒过几行之后就该有一次失败
  const days = Math.round(options.failedWindowMs / DAY_MS)
  if (agency > 0 && newestFailed <= now - options.failedWindowMs) {
    violations.push({
      rule: 'no_recent_failed',
      count: 1,
      text: `判据四：最近 ${days} 天没有一条写清理由与失败条件的 failed`,
    })
  }
  return violations
}


/** 写账要用的东西 */
export interface LedgerOptions {
  /** 目录读写口 */
  store: SelfStore
  /** 参数表 */
  settings: SelfSettings
}

/** 两档账的入口 */
export interface SelfLedger {
  /** 记一条 drive，需要名不认识就丢弃 */
  recordDrive(need: DriveNeed, at: number, detail?: DriveDetail): WriteOutcome
  /** 记一条 agency，七天内同一句原话只记一次 */
  recordAgency(projectId: string, why: string, at: number, detail?: AgencyDetail): WriteOutcome
  /** 两档分开计数，从不相加 */
  summary(now: number): LedgerSummary
  /** 判据三与判据四，违规清单 */
  audit(now: number): readonly LedgerViolation[]
}

/**
 * 建一本账
 * @param options - 目录与参数
 * @returns 两档账的入口
 */
export function createLedger(options: LedgerOptions): SelfLedger {
  const { store, settings } = options

  return {
    recordDrive(need, at, detail) {
      if (!isDriveNeed(need, settings.driveNeeds)) return { written: false, proposed: false, reason: 'unknown_need' }
      if (store.paused()) return { written: false, proposed: true, reason: 'paused' }
      const did = clip(detail?.did ?? '', settings.didMaxChars)
      const row: DriveEntry = { at, id: newId(at), kind: 'drive', need, did, resolved: detail?.resolved ?? false }
      store.append(LEDGER, row)
      return { written: true, proposed: false }
    },
    recordAgency(projectId, why, at, detail) {
      const verbatim = clip(detail?.verbatim ?? why, settings.verbatimMaxChars)
      const repeated = store.records(LEDGER).some((record) => {
        const row = record.kind === 'agency' ? record : undefined
        return row !== undefined && row.verbatim === verbatim && Math.abs(at - (typeof row.at === 'number' ? row.at : 0)) < settings.weekMs
      })
      if (repeated) return { written: false, proposed: false, reason: 'duplicate' }
      if (store.paused()) return { written: false, proposed: true, reason: 'paused' }
      const chosen = detail?.outcome
      const outcome: AgencyOutcome = isAgencyOutcome(chosen) ? chosen : 'dropped'
      const row: AgencyEntry = {
        at,
        id: newId(at),
        kind: 'agency',
        project_id: projectId,
        verbatim,
        because: clip(why, settings.verbatimMaxChars),
        fail_if: clip(detail?.failIf ?? '', settings.verbatimMaxChars),
        outcome,
        artifact: detail?.artifact ?? '',
      }
      store.append(LEDGER, row)
      return { written: true, proposed: false }
    },
    summary(now) {
      let drive = 0
      let agency = 0
      let recentAgency = 0
      for (const record of store.records(LEDGER)) {
        if (record.kind === 'drive') {
          drive += 1
          continue
        }
        if (record.kind !== 'agency') continue
        agency += 1
        const at = typeof record.at === 'number' ? record.at : 0
        if (at > now - settings.weekMs) recentAgency += 1
      }
      return { drive, agency, recentAgency }
    },
    audit(now) {
      return auditLedger(store.records(LEDGER), now, { failedWindowMs: settings.auditFailedWindowMs })
    },
  }
}
