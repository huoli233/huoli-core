// 额度：每说完一轮就按真实用量记账，当天用掉多少、还剩多少，折成档位交给身体那边

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@huoli/cordis'
import '@huoli/huoli-session'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { qqVitalsOf } from '@huoli/huoli-qq-vitals'

/** 插件的行名 */
export const name = 'qq-balance'

/** 这一行接受的配置 */
export interface Config {
  /** 一天给多少 token，用光了就当她没钱了，默认两百万 */
  dailyTokens?: number
  /** 账记在哪，不填就放在主目录的 data 下 */
  stateFile?: string
  /** 覆盖主目录，不填按 HUOLI_HOME 定 */
  home?: string
  /** 时区，空串跟随运行环境 */
  timeZone?: string
  /** 额度满时给几档，默认十，用光就是零 */
  fullLevel?: number
  /** 一天的预算，单位与价目表一致；配了它就按钱算档位，不配按 token 算 */
  dailyCost?: number
  /** 每个模型的价，按百万 token 算；键是模型名，没配的落到 default */
  prices?: Record<string, TokenPrice>
  /** 没在价目表里的模型按这个算 */
  defaultPrice?: TokenPrice
}

/** 一个模型每百万 token 多少钱 */
export interface TokenPrice {
  /** 输入每百万 token 的价钱 */
  input?: number
  /** 输出每百万 token 的价钱 */
  output?: number
}

/** 默认值 */
const DEFAULTS = {
  dailyTokens: 2_000_000,
  fullLevel: 10,
}

/** 当天记下来的账 */
export interface DayLedger {
  /** 本地日期，形如 2026-11-06 */
  day: string
  /** 当天用掉的 token 总数 */
  used: number
  /** 当天花掉的钱，配了价目表才有数，没配就是零 */
  cost?: number
}

/**
 * 现在是哪一天，按给定时区算
 * @param at 时刻，毫秒
 * @param timeZone 时区名字，空串跟随运行环境
 * @returns 本地日期，形如 2026-11-06
 */
export function dayOf(at: number, timeZone = ''): string {
  const format = new Intl.DateTimeFormat('en-CA', {
    ...timeZone === '' ? {} : { timeZone },
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return format.format(new Date(at))
}

/**
 * 今天的账该给几档：用得越少档位越高
 * @param used 当天已经用掉的 token
 * @param dailyTokens 一天给多少
 * @param fullLevel 满额度时的档位
 * @returns 零到满档之间的数，用光就是零
 */
export function levelOf(used: number, dailyTokens: number, fullLevel: number): number {
  if (!(dailyTokens > 0)) return 0
  const left = Math.max(0, 1 - used / dailyTokens)
  return Math.min(fullLevel, Math.max(0, left * fullLevel))
}

/** 一条用量换算成总共多少 token */
interface UsageLike {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/**
 * 一条用量一共用了多少 token
 * @param usage 适配器报的那一份
 * @returns 输入、输出与缓存读写加起来的总数
 */
export function tokensOf(usage: UsageLike): number {
  const sum = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
    + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  return Number.isFinite(sum) ? Math.max(0, sum) : 0
}

/**
 * 这一笔用量按价目表花掉多少钱
 * @param usage 这一笔用量
 * @param price 这个模型每百万 token 的价钱
 * @returns 这一笔的钱，没配价就是零
 */
export function costOf(usage: UsageLike, price: TokenPrice | undefined): number {
  if (price === undefined) return 0
  // 缓存读写也算输入：读的是同一段前缀，只是便宜些，这里不另立一档
  const input = Math.max(0, usage.inputTokens ?? 0)
    + Math.max(0, usage.cacheReadTokens ?? 0) + Math.max(0, usage.cacheWriteTokens ?? 0)
  const output = Math.max(0, usage.outputTokens ?? 0)
  const cost = (input / 1_000_000) * (price.input ?? 0) + (output / 1_000_000) * (price.output ?? 0)
  return Number.isFinite(cost) ? Math.max(0, cost) : 0
}

/**
 * 把一笔用量记到账上：换天先清零，再加进去
 * @param ledger 原来的账
 * @param usage 这一笔用量
 * @param at 这一笔的时刻，毫秒
 * @param timeZone 时区名字，空串跟随运行环境
 * @param price 这个模型每百万 token 的价钱，不配就只记 token
 * @returns 记完之后的账
 */
export function applyUsage(ledger: DayLedger, usage: UsageLike, at: number, timeZone = '', price?: TokenPrice): DayLedger {
  const day = dayOf(at, timeZone)
  // 换了一天就从零开始，旧的那天已经过去了
  const base = ledger.day === day ? ledger : { day, used: 0, cost: 0 }
  const added = tokensOf(usage)
  const spent = costOf(usage, price)
  if (added <= 0 && spent <= 0) return base
  return { day, used: base.used + added, cost: (base.cost ?? 0) + spent }
}

/** 把账读回来，坏了就当今天还没花 */
function readLedger(file: string): DayLedger {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<DayLedger>
    if (typeof parsed.day !== 'string' || typeof parsed.used !== 'number' || !Number.isFinite(parsed.used)) {
      return { day: '', used: 0 }
    }
    const cost = typeof parsed.cost === 'number' && Number.isFinite(parsed.cost) ? Math.max(0, parsed.cost) : 0
    return { day: parsed.day, used: Math.max(0, parsed.used), cost }
  } catch {
    return { day: '', used: 0 }
  }
}

/** 把账写回去，先写临时文件再改名，写一半断电也不会留坏文件 */
function writeLedger(file: string, ledger: DayLedger): void {
  writeFileSync(file, `${JSON.stringify(ledger)}\n`)
}

/**
 * 装这个插件
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const dailyTokens = Math.max(1, config.dailyTokens ?? DEFAULTS.dailyTokens)
  const dailyCost = config.dailyCost ?? 0
  const fullLevel = Math.max(0.01, config.fullLevel ?? DEFAULTS.fullLevel)
  const timeZone = config.timeZone ?? ''
  const prices = config.prices ?? {}
  const defaultPrice = config.defaultPrice
  // 配了预算与价目才按钱算，否则还是按 token 算
  const byCost = dailyCost > 0 && (Object.keys(prices).length > 0 || defaultPrice !== undefined)
  const priceOf = (model: string): TokenPrice | undefined => prices[model] ?? defaultPrice
  const file = config.stateFile ?? join(resolveHuoliHome(config.home), 'data', 'qq-balance.json')
  const log = ctx.logger('qq-balance')
  let ledger = readLedger(file)

  // 换天了就把当天的数清零重来，跨天那一刻不需要谁去叫它
  const rollIfNeeded = (at: number): void => {
    const day = dayOf(at, timeZone)
    if (ledger.day === day) return
    ledger = { day, used: 0, cost: 0 }
    writeLedger(file, ledger)
  }
  const publish = (): void => {
    qqVitalsOf(ctx)?.setBalance(levelOf(byCost ? ledger.cost ?? 0 : ledger.used, byCost ? dailyCost : dailyTokens, fullLevel))
  }

  rollIfNeeded(Date.now())
  publish()

  // 每提交一条带用量的回答就记一笔：不用等定时器，说完就更新
  ctx.on('session/event', (_session, event) => {
    // 只认最终那条：重试的中间尝试不算，免得同一笔算两遍
    if (event.type !== 'assistant/message') return
    const usage = event.data.usage
    if (usage === undefined) return
    const model = event.data.message.source.model
    const next = applyUsage(ledger, usage, event.time, timeZone, priceOf(model))
    if (next.used === ledger.used && next.day === ledger.day) return
    ledger = next
    try {
      writeLedger(file, ledger)
    } catch (error) {
      log.warn('账没写进去，这一笔只在内存里：%s', error)
    }
    publish()
  })
}
