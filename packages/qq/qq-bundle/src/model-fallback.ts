// 主模型请求失败时把这一条会话退到备用模型，过一会儿再试着切回来；不碰部署配置

import type { Context } from '@huoli/cordis'
import type { ModelSelection, RequestErrorAction } from '@huoli/huoli-agent'

/** 备用模型配置与记录口 */
export interface ModelFallbackOptions {
  /** 主模型的 provider */
  primaryProvider: string
  /** 主模型的 id */
  primaryModel: string
  /** 备用模型的 provider，留空表示不启用 */
  fallbackProvider: string
  /** 备用模型的 id */
  fallbackModel: string
  /** 退到备用后隔多久试着切回主模型，零表示不切回 */
  retryBackMs: number
  /** 切换时记一行诊断 */
  note: (event: string, detail: Record<string, unknown>) => void
}

/** 会话里能换模型的那部分 */
interface ModelSwitchable {
  current(): Readonly<ModelSelection> | undefined
  select(next: Readonly<ModelSelection>): void
}

/**
 * 挂上模型自动回退与切回
 * @param ctx - 运行环境
 * @param options - 主备模型、切回间隔与诊断口
 */
export function registerModelFallback(ctx: Context, options: ModelFallbackOptions): void {
  if (options.fallbackProvider === '' || options.fallbackModel === '') return
  // 只记在这条会话上：哪一刻可以试着切回主模型
  const retryAt = new WeakMap<object, number>()
  const modelOf = (agent: unknown): ModelSwitchable | undefined => {
    const model = (agent as { model?: ModelSwitchable } | undefined)?.model
    return model === undefined || typeof model.current !== 'function' || typeof model.select !== 'function'
      ? undefined
      : model
  }
  const primary: ModelSelection = { provider: options.primaryProvider, model: options.primaryModel }
  const fallback: ModelSelection = { provider: options.fallbackProvider, model: options.fallbackModel }

  // 每次请求前先看要不要试回主模型，失败会再次触发下面的回退
  ctx.on('agent/request', async ({ agent }, next) => {
    const model = modelOf(agent)
    const due = retryAt.get(agent)
    if (model !== undefined && due !== undefined && Date.now() >= due) {
      const current = model.current()
      if (current !== undefined && current.provider === options.fallbackProvider && current.model === options.fallbackModel) {
        model.select(primary)
        options.note('model_retry_back', { to: options.primaryModel })
      }
      retryAt.delete(agent)
    }
    return next()
  })

  // 这是瀑布事件，处理完还要往下交给别的恢复策略
  ctx.on('agent/request-error', async (
    { agent, failure }: { agent: object; failure: { code: string } },
    next: () => Promise<RequestErrorAction>,
  ): Promise<RequestErrorAction> => {
    const model = modelOf(agent)
    if (failure.code !== 'ABORTED' && model !== undefined) {
      const current = model.current()
      if (current !== undefined && current.provider === options.primaryProvider && current.model === options.primaryModel) {
        model.select(fallback)
        retryAt.set(agent, Date.now() + Math.max(0, options.retryBackMs))
        options.note('model_fallback', { from: current.model, to: options.fallbackModel, code: failure.code })
      }
    }
    return next()
  })
}
