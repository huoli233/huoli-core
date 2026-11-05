// 装配行的配置与它对外露出的两个接口

import type { ActionResult } from '@huoli/huoli-qq-channel'
import type { DeliverResult } from '@huoli/huoli-qq-proactive'
import type { DecisionRecord } from './decisions.ts'

/** 这一行接受的配置 */
export interface Config {
  /** 说话规矩那个文件放哪 */
  rulesFile?: string
  /** 每天几点做整理与例行开口，形如 00:20 */
  dailySweepAt?: string
  /** 一轮最多走几步 */
  maxSteps?: number
  /** 去重表最多留多少条 */
  seenMax?: number
  /** 轮次记录放哪，不填就用主目录下的 data */
  decisionsFile?: string
  /** 每日维护日志放哪，不填就用主目录下的 data */
  maintenanceLogFile?: string
  /** 入站之后隔多久才再问一次要不要主动开口 */
  proactiveThrottleMs?: number
  /** 覆盖主目录，不填按 HUOLI_HOME 定 */
  home?: string
  /** 允许调用的工具名，空表示不限制 */
  allowedTools?: readonly string[]
  /** 每轮是否把召回到的记忆接在用户原话之后，关掉就一次都不召回 */
  memoryInject?: boolean
  /** 注入整串的字数上限 */
  memoryInjectMaxChars?: number
  /** 一次注入最多几条 */
  memoryInjectMaxItems?: number
  /** 同一段在最近多少轮内不重复注入 */
  memoryInjectRepeatTurns?: number
  /** 想发动态的读数高过这条线就攒一条动态候选 */
  addPostWantFrom?: number
  /** 同一个会话一天最多攒几条动态候选 */
  postCandidateDailyMax?: number
  /** 公共动态报上去的级别，默认 public，走到发布入口才会判阶段与两把钥匙 */
  postLevel?: string
  /** 多久之内有人说过话就算群里正热闹 */
  humanActiveWindowMs?: number
  /** 主动开口去重时最多回想几条已发正文 */
  deliveredHistoryMax?: number
  /** 一顿饭写不写进记忆 */
  mealMemory?: boolean
  /** 一顿饭写成一条记忆时的重要度 */
  mealMemoryImportance?: number
  /** 喝水写不写进记忆 */
  drinkMemory?: boolean
  /** 喝水写成一条记忆时的重要度 */
  drinkMemoryImportance?: number
  /** 开经日写不写进记忆 */
  cycleMemory?: boolean
  /** 开经日写成一条记忆时的重要度 */
  cycleMemoryImportance?: number
  /** 遗书写不写进记忆 */
  farewellMemory?: boolean
  /** 遗书写成一条记忆时的重要度 */
  farewellMemoryImportance?: number
  /** 一场梦写不写进记忆 */
  dreamMemory?: boolean
  /** 美梦与噩梦发不发出去，平淡梦一律不发 */
  dreamPublish?: boolean
  /** 疤写不写进记忆 */
  scarMemory?: boolean
  /** 调用方给的模型文本，模型自己没写过时遗书正文用它，再没有就写一句中性的话 */
  farewellText?: string
  /** 遗书正文的暂存槽放哪，要与通道那一份是同一个文件 */
  farewellFile?: string
  /** 外部余额系统的档位，越大越宽裕，不给就是没有来源 */
  balanceLevel?: number
  /** 启动账放哪，用来算今天重启过几次 */
  livenessFile?: string
}

/** 一次投递的结论：没投出去的码与发布入口回来的那一段都摆在这里 */
export interface BundleDelivery extends DeliverResult {
  /** 走发布入口的结果，只有想发动态的那一条才有 */
  published?: ActionResult
}

/** 排查用的接口，不进模型可见上下文 */
export interface QqBundleSeam {
  /** 从某一时刻起的轮次记录 */
  decisions(sinceAt: number, limit: number): DecisionRecord[]
  /** 把待发里的一条投出去：先预览再投递由主动性把着，动态那一路再交发布入口 */
  deliver(chatKey: string, id: string, body?: string): Promise<BundleDelivery>
}
