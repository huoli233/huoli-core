// 我认为自己算什么：三档主张只追加，读的时候取最后一条，历史全留着

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
  // 三档与文件里的写法逐字对齐：认不出就不落，别把一份读不回来的主张写进账
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
