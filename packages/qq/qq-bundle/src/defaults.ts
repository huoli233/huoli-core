// 组合包的默认值表

import { DEFAULTS as MEMORY_DEFAULTS } from '@huoli/huoli-qq-memory'

/** 组合包的默认值 */
export const BUNDLE_DEFAULTS = {
  /** 一轮最多走几步 */
  maxSteps: 40,
  /** 每天几点做整理与例行开口，形如 00:20 */
  dailySweepAt: '00:20',
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
  /** 想发动态的读数高过这条线就攒一条动态候选，0~1 标度，取平常那一档，只有涨上去才攒 */
  addPostWantFrom: 0.30,
  /** 同一个会话一天最多攒几条动态候选，攒到就不再看读数 */
  postCandidateDailyMax: 1,
  /** 一顿饭写不写进记忆，关掉就一次都不订阅 */
  mealMemory: true,
  /** 一顿饭写成一条记忆时的重要度，例行的一顿比事件轻，但要过记忆的写入门槛 */
  mealMemoryImportance: 30,
  /** 喝水写不写进记忆，关掉就一次都不订阅 */
  drinkMemory: true,
  /** 喝水写成一条记忆时的重要度，比一顿饭还轻，日常到不值得记太久 */
  drinkMemoryImportance: 25,
  /** 遗书写不写进记忆，关掉就一次都不订阅 */
  farewellMemory: true,
  /** 一场梦写不写进记忆 */
  dreamMemory: true,
  /** 美梦与噩梦发不发出去，关掉就一条动态都不发 */
  dreamPublish: true,
  /** 疤写不写进记忆，关掉就一次都不订阅 */
  scarMemory: true,
  /** 遗书写成一条记忆时的重要度，一辈子只留一句，压在保护线以上 */
  farewellMemoryImportance: 95,
}
