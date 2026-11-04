// 这一包可调的参数只在这里出现一次，别处一律从 Tuning 里取

import { RETENTION } from '@huoli/huoli-qq-policy'

/** 可被 Config 覆盖的参数集合 */
export interface Tuning {
  /** 重要度到这条线以上算受保护 */
  protectLine: number
  /** 每次召回注入的正文上限 */
  injectCap: number
}

/** 全包唯一的默认值表 */
export const DEFAULTS: Tuning = {
  // 保护线跟保留度表里那条锚点线是同一条
  protectLine: RETENTION.anchorImportance,
  injectCap: 1200,
}

/**
 * 把配置里的覆盖项合到默认值上
 * @param override - 调用方给的覆盖项
 * @returns 合并后的参数
 */
export function resolveTuning(override?: Partial<Tuning>): Tuning {
  return override === undefined ? DEFAULTS : { ...DEFAULTS, ...override }
}
