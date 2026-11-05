// 运行环境那三条事实：这一份进程活了多久、今天启动过几次、有没有关停提示

import fs from 'node:fs'
import path from 'node:path'
import type { ExistenceFacts } from '@huoli/huoli-qq-vitals'

/** 启动账的版本，结构变了才加一 */
const BOOK_VERSION = 1

/** 一份启动账 */
export interface StartsBook {
  /** 记录表的版本戳 */
  version: number
  /** 本地日期，形如 2026-11-04 */
  day: string
  /** 这一天启动过几次，第一次是 1 */
  starts: number
}

/** 记录要的东西 */
export interface LivenessOptions {
  /** 记录表落在哪个文件，不给就只报活多久，不写任何盘 */
  file?: string
  /** 现在是几点，不给就取系统时间 */
  now?: () => number
  /** 这一份进程活了多久，毫秒，不给就问运行时 */
  uptime?: () => number
}

/** 只会给出答得出来的事实 */
export interface Liveness {
  /** 这一刻的运行环境事实 */
  facts(at: number): ExistenceFacts
}

// 本地日期：跨零点才算新的一天，按运行环境时区
function localDay(at: number): string {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

// 读一份账，读不出来给空，交给调用方按缺省算
function readBook(file: string): StartsBook | undefined {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StartsBook>
    if (parsed.version !== BOOK_VERSION) return undefined
    if (typeof parsed.day !== 'string' || typeof parsed.starts !== 'number') return undefined
    return { version: BOOK_VERSION, day: parsed.day, starts: Math.max(1, Math.floor(parsed.starts)) }
  } catch {
    // 启动账坏了按没有算：重启次数宁少不多，也不要因为一份坏账起不来
    return undefined
  }
}

// 先写同目录临时文件再改名，任何一次失败都不留半截
function writeBook(file: string, book: StartsBook): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const body = `${JSON.stringify(book, null, 2)}\n`
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, body, { mode: 0o600 })
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`)
  fs.renameSync(temporary, file)
}

/**
 * 开一份启动账：这一次算一次启动，同一天累加，跨零点重新从 1 算
 * @param options - 记录表位置与两个可替换的时钟
 * @returns 记一笔结果与一个取事实的入口
 */
export function createLiveness(options: LivenessOptions): Liveness {
  const nowOf = options.now ?? (() => Date.now())
  const uptimeOf = options.uptime ?? (() => process.uptime() * 1000)
  const at = nowOf()
  const today = localDay(at)
  // 没给记录表就不数重启：没有账可记时宁可报 0，也不去猜
  const file = options.file
  let starts = 1
  if (file !== undefined) {
    // 正式文件读不出就按备份读，两份都不通就从今天第一次启动算起
    const kept = readBook(file) ?? readBook(`${file}.bak`)
    starts = kept !== undefined && kept.day === today ? kept.starts + 1 : 1
    try {
      writeBook(file, { version: BOOK_VERSION, day: today, starts })
    } catch {
      // 记录表写不进去只影响「今天重启几次」这一条，不挡整条装配
    }
  }

  return {
    facts(when: number): ExistenceFacts {
      // 只有跨到新的一天这一次启动才回零，同一天内重启次数只增不减
      const day = localDay(when)
      return {
        uptimeMs: Math.max(0, Math.round(uptimeOf())),
        restartsToday: day === today ? Math.max(0, starts - 1) : 0,
        shutdownNotice: false,
      }
    },
  }
}
