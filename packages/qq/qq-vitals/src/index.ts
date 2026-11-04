// 装配入口：一份状态、一条心跳，对外只有“读事实”和“渲染一段话”

import { join } from 'node:path'
import type { Context } from '@huoli/cordis'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import '@huoli/huoli-system-prompt'
import { resolveTuning, type Tuning } from './defaults.ts'
import { derive } from './derive.ts'
import { drift } from './drift.ts'
import type { ExistenceFacts } from './existence.ts'
import { farewellOf, type FarewellFact } from './mortality.ts'
import { react as reactToText } from './react.ts'
import { renderPrompt } from './render.ts'
import { createVitalsStore } from './store.ts'
import type { VitalsState } from './types.ts'
import { mealName } from './words.ts'

export type { Tuning } from './defaults.ts'
export { biasUnit, DEFAULTS, emptyState, resolveTuning } from './defaults.ts'
export { cycleOf } from './clock.ts'
export { derive } from './derive.ts'
export { drift } from './drift.ts'
export { applyShutdownNotice, salienceTarget, settleExistence, shutdownTarget } from './existence.ts'
export type { ExistenceFacts } from './existence.ts'
export { farewellOf, farewellReason, mortalityTarget } from './mortality.ts'
export type { FarewellFact } from './mortality.ts'
export { peakOf } from './peak.ts'
export type { PeakKind } from './peak.ts'
export { postLevel } from './post.ts'
export type { PostDecision, PostFacts } from './post.ts'
export { react } from './react.ts'
export { renderPrompt, thirstNote } from './render.ts'
export { isDrink, isMeal, mealName } from './words.ts'
export { createVitalsStore } from './store.ts'
export type { VitalsStoreOptions, VitalsStore } from './store.ts'
export type { Baseline, CyclePhase, ExistenceTuning, SleepState, TasteRecord, VitalsState } from './types.ts'

/** 一顿饭的事实，交给组合包以后接记忆，本包不写记忆 */
export interface MealFact {
  /** 这一顿记下的毫秒时间戳 */
  at: number
  /** 句子里命中的食物名，没命中给空串 */
  name: string
}

/** 一个应用里的那份身体 */
export interface QqVitalsSeam {
  /** 读事实：当前这一份状态，别的包不许自己再算 */
  read(): VitalsState
  /** 渲染一段话：这一轮的语气提示，最多三百字 */
  render(): string
  /** 记一句话：写回身体并落盘，冷却窗口内的重复写法不再计入 */
  react(text: string, at?: number): void
  /** 注入外部余额档位：给了就按分档朝目标走，给 undefined 表示这一路没有来源 */
  setBalance(level: number | undefined): void
  /**
   * 注入运行环境事实：进程活了多久、今天重启几次、有没有收到关停提示
   * @param facts - 三条只读事实，给 undefined 表示这一路没有来源，两个存在性字段不再朝目标走
   */
  setExistence(facts: ExistenceFacts | undefined): void
  /** 接住每一顿的写回，取消时用返回的那个函数 */
  onMeal(listener: (fact: MealFact) => void): () => void
  /** 接住遗书事实：死亡威胁到线那天只通知一次，取消时用返回的那个函数 */
  onFarewell(listener: (fact: FarewellFact) => void): () => void
}

/** 这一行接受的配置 */
export interface Config {
  /** 状态文件放哪，不给就落在数据根目录下的 data/qq-vitals.json */
  file?: string
  /** 数据根目录，不给就用默认的家目录 */
  huoliHome?: string
  /** 想改哪些默认参数 */
  tuning?: Partial<Tuning>
}

const seams = new WeakMap<Context, QqVitalsSeam>()

/**
 * 取这份身体，没装配时为 undefined
 * @param ctx - 运行环境
 * @returns 装配好的接口
 */
export function qqVitalsOf(ctx: Context): QqVitalsSeam | undefined {
  return seams.get(ctx.root) ?? seams.get(ctx)
}

/** 插件的行名 */
export const name = 'qq-vitals'

/** 要用的内核接口 */
export const inject = ['systemPrompt']

// 提示词里的占位名
const VARIABLE = 'qq_vitals'

/**
 * 装配生命状态与它的心跳
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const tuning = resolveTuning(config.tuning)
  const file = config.file ?? join(resolveHuoliHome(config.huoliHome), 'data', 'qq-vitals.json')
  const store = createVitalsStore({ file, tuning })
  const meals = new Set<(fact: MealFact) => void>()
  const farewells = new Set<(fact: FarewellFact) => void>()
  let variant = 0
  let balance: number | undefined
  let existence: ExistenceFacts | undefined

  // 读之前先把这段时间的漂移结掉，但落盘留给心跳；余额档位与运行环境事实一起带进去
  const current = (at = Date.now()): VitalsState =>
    derive(drift(store.read(), at, tuning, undefined, balance, existence), tuning)

  // 遗书只在事实产出那一刻通知一次，某个订阅者失手不影响别人
  const notifyFarewell = (fact: FarewellFact): void => {
    for (const listener of farewells) {
      try {
        listener(fact)
      } catch (error) {
        ctx.logger('qq-vitals').warn('遗书回调失败：%s', String(error))
      }
    }
  }

  // 心跳一次：结算、写盘；到线的先落盘再通知，出错只记一笔，不让循环停掉
  const beat = (): void => {
    const at = Date.now()
    const next = current(at)
    const farewell = farewellOf(next, balance, at, tuning)
    try {
      store.write(farewell === undefined ? next : { ...next, farewell_applied_at: farewell.at })
    } catch (error) {
      ctx.logger('qq-vitals').warn('心跳写盘失败：%s', String(error))
      return
    }
    if (farewell !== undefined) notifyFarewell(farewell)
  }

  // 一顿饭只有真写回的那次才通知，重复进入的同一条消息不通知
  const notifyMeal = (fact: MealFact): void => {
    for (const listener of meals) {
      try {
        listener(fact)
      } catch (error) {
        ctx.logger('qq-vitals').warn('进食回调失败：%s', String(error))
      }
    }
  }

  const seam: QqVitalsSeam = {
    read() {
      return current()
    },
    render() {
      const text = renderPrompt(current(), tuning, variant)
      variant += 1
      return text
    },
    react(text, at) {
      // 时间戳只往前走，秒级的消息时间不会把上一次记录顶回去
      const raw = store.read()
      const moment = Math.max(at ?? Date.now(), raw.last_update)
      let meal: MealFact | undefined
      try {
        const next = derive(reactToText(drift(raw, moment, tuning, undefined, balance, existence), text, moment, tuning), tuning)
        store.write(next)
        if (next.meal_applied_at !== raw.meal_applied_at) meal = { at: next.meal_applied_at, name: mealName(text) }
      } catch (error) {
        ctx.logger('qq-vitals').warn('消息写盘失败：%s', String(error))
        return
      }
      if (meal !== undefined) notifyMeal(meal)
    },
    setBalance(level) {
      balance = level
    },
    setExistence(facts) {
      existence = facts
    },
    onMeal(listener) {
      meals.add(listener)
      return () => {
        meals.delete(listener)
      }
    },
    onFarewell(listener) {
      farewells.add(listener)
      return () => {
        farewells.delete(listener)
      }
    },
  }
  seams.set(ctx.root, seam)

  // 身体这一段排在状态快照后面，压住前面的通用话术
  ctx.systemPrompt.section({
    name: 'qq:vitals',
    order: 340,
    text: `【此刻的身体】{{${VARIABLE}}}`,
  })
  ctx.systemPrompt.variable(VARIABLE, () => seam.render())

  // 启动后先等一下，之后每分钟一次
  let timer: ReturnType<typeof setInterval> | undefined
  const start = setTimeout(() => {
    beat()
    timer = setInterval(beat, tuning.beatMs)
    timer.unref()
  }, tuning.startDelayMs)
  start.unref()

  // 卸载时停掉心跳，再写一次盘
  ctx.effect(() => () => {
    clearTimeout(start)
    if (timer !== undefined) clearInterval(timer)
    store.write(current())
    meals.clear()
    farewells.clear()
    seams.delete(ctx.root)
  })
}
