// 组合包的默认值表

import { DEFAULTS as MEMORY_DEFAULTS } from '@huoli/huoli-qq-memory'

/** 组合包的默认值 */
export const BUNDLE_DEFAULTS = {
  /** 一轮最多走几步 */
  maxSteps: 40,
  /** 每天几点整理记忆 */
  dailySweepHour: 4,
  /** 去重表最多留多少条 */
  seenMax: 256,
  /** 入站之后隔多久才再问一次要不要主动开口 */
  proactiveThrottleMs: 60_000,
  /** 允许调用的工具名，空表示不限制 */
  allowedTools: [] as readonly string[],
  /** 每轮是否把召回到的记忆接在用户原话之后 */
  memoryInject: true,
  /** 注入整串的字数上限，与记忆包同一份默认值 */
  memoryInjectMaxChars: MEMORY_DEFAULTS.injectMaxChars,
  /** 一次注入最多几条，与记忆包同一份默认值 */
  memoryInjectMaxItems: MEMORY_DEFAULTS.injectMaxItems,
  /** 同一段在最近多少轮内不重复注入，与记忆包同一份默认值 */
  memoryInjectRepeatTurns: MEMORY_DEFAULTS.injectRepeatTurns,
}
