// 允许调用的工具：名单外的一律不许调，名单空着就不限制

import type { Context } from '@huoli/cordis'
import '@huoli/huoli-tools'

/** 名单空着时打印的那一句 */
export const TOOL_WHITELIST_OPEN = '工具白名单为空，所有工具都能调'

/**
 * 看住允许调用的工具
 * @param ctx - 运行环境
 * @param allowed - 允许调用的工具名，空表示不限制
 * @returns 撤下函数
 */
export function registerToolWhitelist(ctx: Context, allowed: readonly string[]): () => void {
  if (allowed.length === 0) {
    ctx.logger('qq-bundle').info(TOOL_WHITELIST_OPEN)
    return () => {}
  }
  return ctx.tools.guard(exec => allowed.includes(exec.name)
    ? undefined
    : `qq.tool_not_allowed: ${exec.name} 不在工具白名单里｜下一步: 换一个名单里的工具`)
}
