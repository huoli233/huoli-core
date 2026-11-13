// 额度记一笔：今天说了几句、这一小时说了几句、这句话是不是刚说过

import fs from 'node:fs'
import path from 'node:path'
import { dayKey, hourKey, quotaVerdict, resolveQuotaLimits, type PacingVerdict, type QuotaLimits, type QuotaUse } from './plan.ts'

/** 记录选项 */
export interface PacingStoreOptions {
  file: string
  now?: () => number
  limits?: Partial<QuotaLimits>
}

/** 固定时刻只给测试用，正式装配走配置里的额度 */
export interface PacingFixedClockOptions extends PacingStoreOptions {
  at: number
}

/** 记录仓 */
export interface PacingStore {
  used(): QuotaUse
  /** 只看按小时与按天这两档，不闻重复；体检那一路也读这一处 */
  quota(): PacingVerdict
  check(text: string): PacingVerdict
  /** 一次检查一组正文，不写账；按发出顺序模拟额度与重复句 */
  checkBatch(texts: readonly string[]): PacingVerdict
  record(text: string): QuotaUse
  /** 语音自己一本账，与文本额度互不占 */
  voiceUsed(): QuotaUse
  voiceCheck(): PacingVerdict
  voiceRecord(): QuotaUse
  flush(): void
}

// 文件里存的样子
interface StoredPacing {
  version: 1
  day: string
  dayCount: number
  hourKey: string
  hourCount: number
  voiceDayCount: number
  voiceHourCount: number
  recent: Array<{ text: string; at: number }>
}

// 读文件，出错就当今天刚开始
function load(file: string, now: number): StoredPacing {
  const empty: StoredPacing = {
    version: 1,
    day: dayKey(now),
    dayCount: 0,
    hourKey: '',
    hourCount: 0,
    voiceDayCount: 0,
    voiceHourCount: 0,
    recent: [],
  }
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
      voiceDayCount: Number(parsed.voiceDayCount) || 0,
      voiceHourCount: Number(parsed.voiceHourCount) || 0,
      recent: Array.isArray(parsed.recent) ? parsed.recent : [],
    }
  } catch (readError) {
    // 记一笔文件读坏了就按今天刚开始，下一次记录会重写它
    void readError
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
function refresh(data: StoredPacing, now: number, limits: QuotaLimits): StoredPacing {
  const today = dayKey(now)
  const hour = hourKey(now)
  let next = data
  if (next.day !== today) next = { ...next, day: today, dayCount: 0, voiceDayCount: 0 }
  if (next.hourKey !== hour) next = { ...next, hourKey: hour, hourCount: 0, voiceHourCount: 0 }
  const since = now - limits.repeatWindowMs
  const recent = next.recent.filter(row => row.at >= since)
  return recent.length === next.recent.length ? next : { ...next, recent }
}

// 语音那本账的当前读数
function voiceUse(data: StoredPacing): QuotaUse {
  return { day: data.day, hourKey: data.hourKey, dayCount: data.voiceDayCount, hourCount: data.voiceHourCount }
}

/**
 * 建一个记一笔仓
 * @param options - 选项
 * @returns 处理结果
 */
export function createPacingStore(options: PacingStoreOptions | PacingFixedClockOptions): PacingStore {
  const clock = 'at' in options ? options.at : undefined
  const now = clock !== undefined ? () => clock : options.now ?? (() => Date.now())
  const tuning = resolveQuotaLimits(options.limits)
  let data = refresh(load(options.file, now()), now(), tuning)

  const persist = (): void => {
    save(options.file, data)
  }

  // 按小时与按天这一档只在这里判一次，说话与发语音都读它
  const textQuota = (): PacingVerdict => {
    const at = now()
    data = refresh(data, at, tuning)
    return quotaVerdict('text', { hourCount: data.hourCount, dayCount: data.dayCount }, tuning, at)
  }

  const voiceQuota = (): PacingVerdict => {
    const at = now()
    data = refresh(data, at, tuning)
    return quotaVerdict('voice', { hourCount: data.voiceHourCount, dayCount: data.voiceDayCount }, {
      perHour: tuning.voicePerHour,
      perDay: tuning.voicePerDay,
    }, at)
  }

  const checkBatch = (texts: readonly string[]): PacingVerdict => {
    const at = now()
    data = refresh(data, at, tuning)
    let hourCount = data.hourCount
    let dayCount = data.dayCount
    const recent = [...data.recent]
    for (const text of texts) {
      const quota = quotaVerdict('text', { hourCount, dayCount }, tuning, at)
      if (!quota.ok) return quota
      const body = text.trim()
      if (recent.some(row => row.text === body)) {
        return { ok: false, code: 'pacing.repeated', reason: '这句刚说过', hint: '换一句，或者这次不说' }
      }
      recent.push({ text: body, at })
      hourCount += 1
      dayCount += 1
    }
    return { ok: true }
  }

  return {
    used() {
      data = refresh(data, now(), tuning)
      return { day: data.day, hourKey: data.hourKey, dayCount: data.dayCount, hourCount: data.hourCount }
    },
    quota() {
      return textQuota()
    },
    check(text) {
      return checkBatch([text])
    },
    checkBatch,
    record(text) {
      const at = now()
      data = refresh(data, at, tuning)
      data = {
        ...data,
        dayCount: data.dayCount + 1,
        hourCount: data.hourCount + 1,
        recent: [...data.recent, { text: text.trim(), at }].slice(-tuning.recentKeep),
      }
      persist()
      return { day: data.day, hourKey: data.hourKey, dayCount: data.dayCount, hourCount: data.hourCount }
    },
    voiceUsed() {
      data = refresh(data, now(), tuning)
      return voiceUse(data)
    },
    voiceCheck() {
      return voiceQuota()
    },
    voiceRecord() {
      data = refresh(data, now(), tuning)
      data = { ...data, voiceDayCount: data.voiceDayCount + 1, voiceHourCount: data.voiceHourCount + 1 }
      persist()
      return voiceUse(data)
    },
    flush() {
      persist()
    },
  }
}
