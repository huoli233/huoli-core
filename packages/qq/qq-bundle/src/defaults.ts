// 组合包的默认值表

/** 组合包的默认值 */
export const BUNDLE_DEFAULTS = {
  /** 一轮最多走几步 */
  maxSteps: 40,
  /** 每天几点整理记忆 */
  dailySweepHour: 4,
  /** 去重表最多留多少条 */
  seenMax: 256,
  /** 允许调用的工具名，空表示不限制 */
  allowedTools: [] as readonly string[],
}
