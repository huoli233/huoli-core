// 两档账各记各的：drive 记身体的需要，agency 记她自己要做的事

import { isAgencyOutcome, isDriveNeed } from './rows.ts'
import { newId, type SelfStore } from './store.ts'
import type {
  AgencyDetail,
  AgencyEntry,
  AgencyOutcome,
  DriveDetail,
  DriveEntry,
  DriveNeed,
  LedgerSummary,
  SelfSettings,
  WriteOutcome,
} from './types.ts'

// 账本文件名
const LEDGER = 'ledger.jsonl'

// 超长的句子截断，字段本身不丢
function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
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
  }
}
