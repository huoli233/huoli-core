// 额度记账：今天说了几句、这一小时说了几句、这句话是不是刚说过

import fs from 'node:fs'
import path from 'node:path'
import { dayKey, PACING_DEFAULTS, type PacingVerdict, type QuotaUse } from './plan.ts'

/** 记账选项 */
export interface PacingStoreOptions {
  file: string
  now?: () => number
}

/** 记账仓 */
export interface PacingStore {
  used(): QuotaUse
  check(text: string): PacingVerdict
  record(text: string): QuotaUse
  resetTurn(): void
  flush(): void
}

// 文件里存的样子
interface StoredPacing {
  version: 1
  day: string
  dayCount: number
  hourKey: string
  hourCount: number
  turnBurst: number
  recent: Array<{ text: string; at: number }>
}

// 读文件，出错就当今天刚开始
function load(file: string, now: number): StoredPacing {
  const empty: StoredPacing = { version: 1, day: dayKey(now), dayCount: 0, hourKey: '', hourCount: 0, turnBurst: 0, recent: [] }
  try {
    if (!fs.existsSync(file)) return empty
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (text.trim().length === 0) return empty
    const parsed = JSON.parse(text) as Partial<StoredPacing>
    return {
      version: 1,
      day: typeof parsed.day === 'string' ? parsed.day : empty.day,
      dayCount: Number(parsed.dayCount) || 0,
      hourKey: typeof parsed.hourKey === 'string' ? parsed.hourKey : '',
      hourCount: Number(parsed.hourCount) || 0,
      turnBurst: Number(parsed.turnBurst) || 0,
      recent: Array.isArray(parsed.recent) ? parsed.recent : [],
    }
  } catch {
    return empty
  }
}

// 整份写回
function save(file: string, data: StoredPacing): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

// 把过期的计数清掉
function refresh(data: StoredPacing, now: number): StoredPacing {
  const today = dayKey(now)
  const hour = `${today}-${String(new Date(now).getHours()).padStart(2, '0')}`
  let next = data
  if (next.day !== today) next = { ...next, day: today, dayCount: 0 }
  if (next.hourKey !== hour) next = { ...next, hourKey: hour, hourCount: 0 }
  const since = now - PACING_DEFAULTS.repeatWindowMs
  const recent = next.recent.filter(row => row.at >= since)
  return recent.length === next.recent.length ? next : { ...next, recent }
}

/**
 * 建一个记账仓
 * @param options - 选项
 * @returns 处理结果
 */
export function createPacingStore(options: PacingStoreOptions): PacingStore {
  const now = options.now ?? (() => Date.now())
  let data = refresh(load(options.file, now()), now())

  const persist = (): void => {
    save(options.file, data)
  }

  return {
    used() {
      data = refresh(data, now())
      return { day: data.day, hourKey: data.hourKey, dayCount: data.dayCount, hourCount: data.hourCount }
    },
    check(text) {
      const at = now()
      data = refresh(data, at)
      if (data.hourCount >= PACING_DEFAULTS.perHour) {
        return { ok: false, code: 'pacing.hour_full', reason: '这一小时说得够多了', hint: '等下一小时' }
      }
      if (data.dayCount >= PACING_DEFAULTS.perDay) {
        return { ok: false, code: 'pacing.day_full', reason: '今天说得够多了', hint: '明天再说' }
      }
      const body = text.trim()
      const same = data.recent.find(row => row.text === body)
      if (same !== undefined) {
        return { ok: false, code: 'pacing.repeated', reason: '这句刚说过', hint: '换一句，或者这次不说' }
      }
      return { ok: true }
    },
    record(text) {
      const at = now()
      data = refresh(data, at)
      data = {
        ...data,
        dayCount: data.dayCount + 1,
        hourCount: data.hourCount + 1,
        turnBurst: data.turnBurst + 1,
        recent: [...data.recent, { text: text.trim(), at }].slice(-40),
      }
      persist()
      return { day: data.day, hourKey: data.hourKey, dayCount: data.dayCount, hourCount: data.hourCount }
    },
    resetTurn() {
      data = { ...data, turnBurst: 0 }
      persist()
    },
    flush() {
      persist()
    },
  }
}
