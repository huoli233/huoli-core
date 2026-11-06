// 余额：启动读一次，之后每隔几小时再读一次，把数字交给身体那边当生存压力

import type { Context } from '@huoli/cordis'
import { qqVitalsOf } from '@huoli/huoli-qq-vitals'

/** 插件的行名 */
export const name = 'qq-balance'

/** 这一行接受的配置 */
export interface Config {
  /** 余额从哪读，默认 DeepSeek 官方 */
  baseURL?: string
  /** key 直接写在这里 */
  apiKey?: string
  /** key 放在哪个环境变量里，和上一条二选一 */
  apiKeyEnv?: string
  /** 多久刷一次，毫秒，默认六小时 */
  refreshMs?: number
  /** 结算成哪条货币；不填就把各币种加起来 */
  currency?: string
  /** 一次请求最多等多久，毫秒，默认八秒 */
  timeoutMs?: number
}

/** 不填时用的那几个数 */
const DEFAULTS = {
  baseURL: 'https://api.deepseek.com',
  refreshMs: 6 * 3_600_000,
  timeoutMs: 8_000,
}

/** 余额接口回的东西里我们要的那一段 */
interface BalanceResponse {
  balance_infos?: { currency?: string; total_balance?: string | number }[]
}

/**
 * 从回来的东西里挑出该交给身体的那个数
 * @param parsed 接口回的正文
 * @param currency 想结算成哪条货币，不填就全加
 * @returns 余额数字，没有可用项时是 undefined
 */
export function amountOf(parsed: BalanceResponse, currency?: string): number | undefined {
  const infos = parsed.balance_infos ?? []
  // 指定了货币就只认那一条，没指定就把能读的都加起来
  const picked = currency === undefined ? infos : infos.filter(info => info.currency === currency)
  let total = 0
  let found = false
  for (const info of picked) {
    const value = typeof info.total_balance === 'string' ? Number(info.total_balance) : info.total_balance
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    total += value
    found = true
  }
  return found ? total : undefined
}

/** 读一次余额要的东西 */
export interface BalanceRead {
  /** 服务根地址 */
  baseURL: string
  /** 许可用的 key */
  key: string
  /** 一次最多等多久，毫秒 */
  timeoutMs: number
  /** 结算成哪条货币，不填就全加 */
  currency?: string
}

/**
 * 去接口读一次余额
 * @param read 地址、key、超时与货币
 * @returns 余额数字
 * @throws 网络断了、接口报错、回来的一堆里没有可用数字
 */
export async function readBalance(read: BalanceRead): Promise<number> {
  const response = await fetch(`${read.baseURL.replace(/\/+$/, '')}/user/balance`, {
    headers: { authorization: `Bearer ${read.key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(read.timeoutMs),
  })
  if (!response.ok) throw new Error(`余额接口回 ${String(response.status)}`)
  const amount = amountOf(JSON.parse(await response.text()) as BalanceResponse, read.currency)
  if (amount === undefined) throw new Error('回来的一堆里没有可用的数字')
  return amount
}

/**
 * 装这个插件
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const base = (config.baseURL ?? DEFAULTS.baseURL).replace(/\/+$/, '')
  const refreshMs = Math.max(60_000, Math.floor(config.refreshMs ?? DEFAULTS.refreshMs))
  const timeoutMs = Math.max(1, Math.floor(config.timeoutMs ?? DEFAULTS.timeoutMs))
  const log = ctx.logger('qq-balance')
  // 写死的先用，没写才去环境里找
  const keyNow = (): string | undefined => {
    if (config.apiKey !== undefined && config.apiKey !== '') return config.apiKey
    if (config.apiKeyEnv === undefined || config.apiKeyEnv === '') return undefined
    const fromEnv = process.env[config.apiKeyEnv]
    return fromEnv === undefined || fromEnv === '' ? undefined : fromEnv
  }

  const readOnce = async (): Promise<void> => {
    const key = keyNow()
    if (key === undefined) {
      log.warn('没配 key，这一轮不读余额')
      return
    }
    try {
      const read: BalanceRead = { baseURL: base, key, timeoutMs }
      const amount = await readBalance({ ...read, ...config.currency === undefined ? {} : { currency: config.currency } })
      qqVitalsOf(ctx)?.setBalance(amount)
    } catch (error) {
      // 读不到就什么都不交：不能因为一次网络抽风让她以为自己没钱了
      log.warn('余额没读到，这一轮不更新：%s', error)
    }
  }

  // 启动先读一次，之后按间隔刷；定时器不拖着进程
  void readOnce()
  const timer = setInterval(() => { void readOnce() }, refreshMs)
  timer.unref()
  ctx.effect(() => () => { clearInterval(timer) })
}
