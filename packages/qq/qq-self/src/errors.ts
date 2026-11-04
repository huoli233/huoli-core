// 错题本：判断错在哪、下一次怎么改，两句都非空才落一条

import { FILES } from './files.ts'
import { newId, type SelfStore } from './store.ts'
import type { ErrorRow, SelfSettings, WriteOutcome } from './types.ts'

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

/**
 * 读一条错题
 * @param record - 文件里的一行
 * @returns 缺字段时为 undefined
 */
export function toError(record: Record<string, unknown>): ErrorRow | undefined {
  const at = stamp(record.at)
  const id = str(record.id)
  const text = str(record.text)
  const fix = str(record.fix)
  if (id === '' || at === 0 || text === '' || fix === '') return undefined
  return { at, id, text, fix }
}

/**
 * 记一条判断错的地方与改法
 * @param store - 目录读写口
 * @param settings - 参数表
 * @param text - 错在哪
 * @param fix - 下次怎么改
 * @param at - 记下的时刻
 * @returns 落没落盘
 */
export function recordError(
  store: SelfStore,
  settings: SelfSettings,
  text: string,
  fix: string,
  at: number,
): WriteOutcome {
  const wrong = text.trim()
  const better = fix.trim()
  if (wrong === '' || better === '') return { written: false, proposed: false, reason: 'no_evidence' }
  store.append(FILES.errors, {
    at,
    id: newId(at),
    text: clip(wrong, settings.errorMaxChars),
    fix: clip(better, settings.errorMaxChars),
  })
  return { written: true, proposed: false }
}

/**
 * 某一刻之后的错题，按时间先后
 * @param store - 目录读写口
 * @param since - 从哪个时刻起算
 * @returns 这一段里的错题
 */
export function errorsSince(store: SelfStore, since: number): ErrorRow[] {
  const rows: ErrorRow[] = []
  for (const record of store.records(FILES.errors)) {
    const row = toError(record)
    if (row === undefined || row.at <= since) continue
    rows.push(row)
  }
  return rows.sort((left, right) => left.at - right.at)
}
