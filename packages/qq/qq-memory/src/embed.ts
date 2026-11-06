/** 往外调嵌入模型：给几句话，换回同样多的向量 */

/** 嵌入服务怎么接 */
export interface EmbeddingConfig {
  /** 服务根地址，形如 https://api.siliconflow.cn/v1 */
  baseURL: string
  /** 模型名，形如 BAAI/bge-m3 */
  model: string
  /** 直接写在这里的 key */
  apiKey?: string
  /** key 放在哪个环境变量里，和上一条二选一 */
  apiKeyEnv?: string
  /** 一次调用最多等多久，默认六秒 */
  timeoutMs?: number
}

/** 一把嵌入器，失败就抛，不悄悄吞掉 */
export interface Embedder {
  /** 模型名，写日志和排查用 */
  readonly model: string
  /**
   * 把几句话换成向量
   * @param texts 要换的句子
   * @returns 与输入同样多、同样顺序的向量
   * @throws 网络断了、服务报错、回来的东西不成样子
   */
  embed(texts: readonly string[]): Promise<number[][]>
}

/** 一次最多等多久 */
const DEFAULT_TIMEOUT_MS = 6000

/** 服务回的东西里我们要的那一段 */
interface EmbeddingResponse {
  data?: { embedding?: unknown }[]
}

/**
 * 做一把嵌入器
 * @param config 服务地址、模型、key 从哪来
 * @returns 可以反复用的嵌入器
 */
export function createEmbedder(config: EmbeddingConfig): Embedder {
  const base = config.baseURL.replace(/\/+$/, '')
  const timeoutMs = Math.max(1, Math.floor(config.timeoutMs ?? DEFAULT_TIMEOUT_MS))
  // 写死的先用，没写才去环境里找
  const keyNow = (): string | undefined => {
    if (config.apiKey !== undefined && config.apiKey !== '') return config.apiKey
    if (config.apiKeyEnv === undefined || config.apiKeyEnv === '') return undefined
    const fromEnv = process.env[config.apiKeyEnv]
    return fromEnv === undefined || fromEnv === '' ? undefined : fromEnv
  }
  return {
    model: config.model,
    async embed(texts) {
      if (texts.length === 0) return []
      const key = keyNow()
      if (key === undefined) throw new Error(`嵌入服务没配 key：${config.apiKeyEnv ?? 'apiKey'}`)
      const response = await fetch(`${base}/embeddings`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: config.model, input: [...texts] }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      const body = await response.text()
      if (!response.ok) throw new Error(`嵌入服务回 ${String(response.status)}：${body.slice(0, 160)}`)
      const parsed = JSON.parse(body) as EmbeddingResponse
      const rows = parsed.data ?? []
      if (rows.length !== texts.length) throw new Error(`嵌入条数对不上：给了 ${String(texts.length)}，回来 ${String(rows.length)}`)
      const vectors = rows.map((row) => {
        const vector = row.embedding
        if (!Array.isArray(vector) || vector.length === 0) throw new Error('嵌入服务回了一条空向量')
        for (const value of vector) {
          if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('嵌入向量里混了非数字')
        }
        return vector as number[]
      })
      const width = vectors[0]?.length ?? 0
      for (const vector of vectors) {
        if (vector.length !== width) throw new Error(`嵌入宽度不一致：${String(width)} 与 ${String(vector.length)}`)
      }
      return vectors
    },
  }
}
