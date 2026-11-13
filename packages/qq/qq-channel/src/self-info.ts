// 连上之后从网关读到的当前身份，没读到就明说是配置兜底

/** 当前身份事实 */
export interface SelfInfo {
  /** 当前用的昵称 */
  nickname: string
  /** 当前用的 QQ 号 */
  qqId: string
  /** 网关身份是否读到 */
  fetched: boolean
  /** 网关身份读到的时刻，毫秒；没读到为 0 */
  fetchedAt: number
  /** 当前这份是不是配置兜底 */
  fallback: boolean
  /** 最近一次没读到的原因码，一直没失败过就没有 */
  lastFailure?: string
  /** 给上层直接放进事实的一段说明 */
  fact: string
}

/** 身份事实里除说明文本以外的几项 */
export type SelfInfoReading = Omit<SelfInfo, 'fact'>

/** 读取网关身份的默认值 */
export const SELF_INFO_DEFAULTS = {
  /** 连上后要不要问网关当前身份；默认关，开了会另起一条短连接 */
  enabled: false,
  /** 问网关身份等回话多久 */
  timeoutMs: 5_000,
  /** 重连后要不要再问一次 */
  refreshOnReconnect: true,
  /** 等回话超时的下限，配得再小也不短过它 */
  minTimeoutMs: 1_000,
} as const

/** 建一份身份状态要用的东西 */
export interface SelfInfoOptions {
  /** 没读到时用的名字 */
  fallbackName: string
  /** 没读到时用的号 */
  fallbackId: string
  /** 取时刻的函数，便于测试 */
  now?: () => number
}

/** 一条连接自己留的身份 */
export interface SelfInfoStore {
  /** 读当前事实 */
  read(): SelfInfo
  /** 记下网关回的身份，号和昵称缺一个就算没读到 */
  note(data: Record<string, unknown>, at: number): boolean
  /** 记下这次没读到的原因码 */
  fail(reason: string): void
}

/**
 * 把身份渲染成给上层用的一段事实，兜底会明说来源
 * @param info - 身份事实
 * @returns 一段可直接放进事实的说明
 */
export function selfInfoFact(info: SelfInfoReading): string {
  const head = `[SYSTEM_LOAD] QQ_SELF_INFO\nNAME: ${info.nickname}\nQQ: ${info.qqId}`
  const failure = info.lastFailure === undefined ? '' : `\nLAST_FAILURE: ${info.lastFailure}`
  return info.fetched
    ? `${head}\nSTATE: gateway\nFETCHED_AT: ${new Date(info.fetchedAt).toISOString()}\nRULE: 名字与号来自网关当前登录信息${failure}`
    : `${head}\nSTATE: fallback\nRULE: 网关没读到身份，这两项是部署配置里的兜底值，不是网关当前昵称与号${failure}`
}

// 网关给的号可能是数字也可能是字符串，空的不算读到
function idOf(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 给一条连接建一份身份状态，状态只留在这份实例里
 * @param options - 兜底名字、兜底号与时钟
 * @returns 这一份身份的读写口
 */
export function createSelfInfo(options: SelfInfoOptions): SelfInfoStore {
  let nickname = ''
  let qqId = ''
  let fetchedAt = 0
  let lastFailure = ''
  const now = options.now ?? (() => Date.now())
  const read = (): SelfInfo => {
    const fetched = fetchedAt > 0
    const reading: SelfInfoReading = {
      nickname: fetched ? nickname : options.fallbackName,
      qqId: fetched ? qqId : options.fallbackId,
      fetched,
      fetchedAt,
      fallback: !fetched,
      ...lastFailure === '' ? {} : { lastFailure },
    }
    return { ...reading, fact: selfInfoFact(reading) }
  }
  return {
    read,
    note(data, at) {
      const id = idOf(data.user_id)
      const name = typeof data.nickname === 'string' ? data.nickname.trim() : ''
      if (id === '' || name === '') return false
      nickname = name
      qqId = id
      fetchedAt = at > 0 ? at : now()
      lastFailure = ''
      return true
    },
    fail(reason) {
      lastFailure = reason
    },
  }
}
