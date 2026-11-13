// 装配入口：一份状态、一条心跳，对外只有“读事实”和“渲染一段话”

import { join } from 'node:path'
import type { Context } from '@huoli/cordis'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import '@huoli/huoli-system-prompt'
import { cycleStartOf, type CycleFact } from './cycle.ts'
import { resolveTuning } from './defaults.ts'
import type { TuningOverride } from './tuning.ts'
import { derive } from './derive.ts'
import { dreamFactOf, type DreamFact } from './dream.ts'
import { drift } from './drift.ts'
import type { ExistenceFacts } from './existence.ts'
import { farewellOf, type FarewellFact } from './mortality.ts'
import { applyEvents, react as reactToText, type BodyEvent } from './react.ts'
import { renderPrompt } from './render.ts'
import { scarFactOf, type ScarFact } from './scar.ts'
import { createVitalsStore } from './store.ts'
import type { VitalsState } from './types.ts'
import { mealName, WORDS_PRESET, type WordLists } from './words.ts'

export type { Tuning } from './defaults.ts'
export { biasUnit, DEFAULTS, emptyState, resolveTuning } from './defaults.ts'
export { cycleOf, localDate, localDayDiff, localHour, localPoint } from './clock.ts'
export type { LocalPoint } from './clock.ts'
export { cycleStartOf } from './cycle.ts'
export type { CycleFact } from './cycle.ts'
export { derive } from './derive.ts'
export { dreamFactOf, dreamMoodOf, drawDream, startDream } from './dream.ts'
export type { DreamFact } from './dream.ts'
export { drift } from './drift.ts'
export { mixOf } from './emotion.ts'
export type { EmotionMix } from './emotion.ts'
export { applyShutdownNotice, salienceTarget, settleExistence, shutdownTarget } from './existence.ts'
export type { ExistenceFacts } from './existence.ts'
export { farewellOf, farewellReason, mortalityTarget } from './mortality.ts'
export type { FarewellFact } from './mortality.ts'
export { deltaOf, describeNetwork, propagate } from './network.ts'
export type { NetworkPass } from './network.ts'
export { peakOf } from './peak.ts'
export type { PeakKind } from './peak.ts'
export { applyEvents, react, type BodyEvent } from './react.ts'
export { renderPrompt, thirstNote } from './render.ts'
export { inCrisis, raiseScar, scarFactOf, settleScar } from './scar.ts'
export type { ScarFact } from './scar.ts'
export {
  EMPTY_WORDS, isDrink, isMeal, mealName, WORDS, WORDS_PRESET, type WordLists,
} from './words.ts'
export { createVitalsStore, VITALS_STORE_DEFAULTS } from './store.ts'
export type { VitalsStoreOptions, VitalsStore } from './store.ts'
export type {
  Baseline, CyclePhase, DreamKind, DreamMood, DreamTuning, EmotionBlend, EmotionBlendTuning, ExistenceTuning,
  ScarTuning, SleepState, TasteRecord, VitalsState,
} from './types.ts'
export type { NetworkEdge, NetworkField, NetworkMode, NetworkTuning } from './types.ts'

/** 一顿饭的事实，交给组合包以后接记忆，本包不写记忆 */
export interface MealFact {
  /** 这一顿记下的毫秒时间戳 */
  at: number
  /** 句子里命中的食物名，没命中给空串 */
  name: string
}

/** 喝一杯水的事实，交给组合包以后接记忆，本包不写记忆 */
export interface DrinkFact {
  /** 这一杯记下的毫秒时间戳 */
  at: number
  /** 句子里命中的饮品名，没命中给空串 */
  name: string
}

/** 开经日的事实，交给组合包以后接记忆，本包不写记忆 */
export type CycleStartFact = CycleFact

/** 醒来的那一刻：睡态从睡着变成别的，就算醒了一次 */
export interface WakeFact {
  /** 什么时候醒的 */
  at: number
  /** 醒之前是什么睡态 */
  from: string
  /** 醒之后是什么睡态 */
  to: string
}

/** 一个应用里的那份身体 */
export interface QqVitalsSeam {
  /** 读事实：当前这一份状态，别的包不许自己再算 */
  read(): VitalsState
  /** 渲染一段话：这一轮的语气提示，最多三百字 */
  render(): string
  /** 记一句话：写回身体并落盘，冷却窗口内的重复写法不再计入 */
  react(text: string, at?: number): void
  /** 按模型报的事件写回身体：一个事件只做一次，冷却照样管 */
  reactEvents(events: readonly BodyEvent[], at?: number, chatKey?: string): void
  /** 放进外部余额档位：给了就按分档朝目标走，给 undefined 表示这一路没有来源 */
  setBalance(level: number | undefined): void
  /**
   * 放进运行环境事实：进程活了多久、今天重启几次、有没有收到关停提示
   * @param facts - 三条只读事实，给 undefined 表示这一路没有来源，两个存在性字段不再朝目标走
   */
  setExistence(facts: ExistenceFacts | undefined): void
  /** 接住每一顿的写回，取消时用返回的那个函数 */
  onMeal(listener: (fact: MealFact) => void): () => void
  /** 接住每一杯水的写回，冷却挡掉的那次不算，取消时用返回的那个函数 */
  onDrink(listener: (fact: DrinkFact) => void): () => void
  /** 接住开经那一天的事实，同一周期只通知一次，取消时用返回的那个函数 */
  onCycle(listener: (fact: CycleFact) => void): () => void
  /** 接住开经那一天的事实，与 onCycle 同一个口，取消时用返回的那个函数 */
  onCycleStart(listener: (fact: CycleStartFact) => void): () => void
  /** 周期四个分界日：面板按它把一圈切成五段彩弧 */
  cycleBounds(): readonly number[]
  /** 五组双条：哪两条是一对由这一包说了算，面板只照画 */
  pairs(): readonly { name: string; a: string; av: number; b: string; bv: number }[]
  /** 接住遗书事实：死亡威胁到线那天只通知一次，取消时用返回的那个函数 */
  onFarewell(listener: (fact: FarewellFact) => void): () => void
  /** 接住每场梦的事实：入梦即产一条，平淡梦也在内，一场只产一次，取消时用返回的那个函数 */
  onDream(listener: (fact: DreamFact) => void): () => void
  /** 接住疤痕那一刻的记忆事实：抬一档才产一条，取消时用返回的那个函数 */
  onScar(listener: (fact: ScarFact) => void): () => void
  /** 接住醒来的那一刻：从睡着变回醒着才产一条，取消时用返回的那个函数 */
  onWake(listener: (fact: WakeFact) => void): () => void
}

/** 这一行接受的配置 */
export interface Config {
  /** 状态文件放哪，不给就落在数据根目录下的 data/qq-vitals.json */
  file?: string
  /** 数据根目录，不给就用默认的家目录 */
  huoliHome?: string
  /** 普通状态写入的最短落盘间隔，默认 5000 毫秒；设为 0 每次都写 */
  writeIntervalMs?: number
  /** 想改哪些默认参数 */
  tuning?: TuningOverride
  /** 口语词表：只写要换的那几张，没写的还用默认 */
  words?: Partial<WordLists>
  /** 是否启用内置口语词表作为模型事件之外的备用事实来源 */
  wordPreset?: boolean
}

const seams = new WeakMap<Context, QqVitalsSeam>()

// 同一份状态文件只许一条心跳：第二个装配者不另起一条，卸载时按自己的上下文让位
const beating = new Map<string, Context>()

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

// 提示词里留的那个名字
const VARIABLE = 'qq_vitals'

/**
 * 装配生命状态与它的心跳
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  // 词表跟着参数一起合：只换一张表时，别的表还是默认那份
  const tuning = resolveTuning({
    ...config.tuning,
    words: {
      ...config.wordPreset === true ? WORDS_PRESET : {},
      ...config.tuning?.words,
      ...config.words,
    },
  })
  const file = config.file ?? join(resolveHuoliHome(config.huoliHome), 'data', 'qq-vitals.json')
  const store = createVitalsStore({
    file,
    tuning,
    ...config.writeIntervalMs === undefined ? {} : { writeIntervalMs: config.writeIntervalMs },
  })
  const meals = new Set<(fact: MealFact) => void>()
  const drinks = new Set<(fact: DrinkFact) => void>()
  const cycles = new Set<(fact: CycleFact) => void>()
  const farewells = new Set<(fact: FarewellFact) => void>()
  const dreams = new Set<(fact: DreamFact) => void>()
  const scars = new Set<(fact: ScarFact) => void>()
  const wakes = new Set<(fact: WakeFact) => void>()
  let balance: number | undefined
  let existence: ExistenceFacts | undefined

  // 读之前先把这段时间的漂移结掉，但落盘留给心跳；余额档位与运行环境事实一起带进去
  const current = (at = Date.now()): VitalsState =>
    derive(drift(store.read(), at, tuning, undefined, balance, existence), tuning)

  // 事实只在产出那一刻通知一次，某个听的人失手不影响别人
  const notify = <F>(listeners: Set<(fact: F) => void>, what: string, fact: F): void => {
    for (const listener of listeners) {
      try {
        listener(fact)
      } catch (error) {
        ctx.logger('qq-vitals').warn('%s回调失败：%s', what, String(error))
      }
    }
  }

  // 心跳一次：结算、写盘；到线的先落盘再通知，出错只记一笔，不让循环停掉
  const beat = (): void => {
    const at = Date.now()
    const before = store.read()
    const settled = current(at)
    const dream = dreamFactOf(settled, tuning)
    const scar = scarFactOf(before, settled, at)
    const farewell = farewellOf(settled, balance, at, tuning)
    // 开经判定与防重复的标记只在这一份纯函数里算，两条结算路径共用，挡掉的重复不通知
    const cycleStart = cycleStartOf(before, settled, at, tuning)
    // 三个标记跟状态一起落盘：先写盘再通知，落盘失败就当这一拍没发生过
    const next: VitalsState = { ...settled }
    if (dream !== undefined) next.dream_applied_at = dream.at
    if (farewell !== undefined) next.farewell_applied_at = farewell.at
    if (cycleStart !== undefined) next.cycle_start_applied_at = cycleStart.at
    try {
      store.write(next)
    } catch (error) {
      ctx.logger('qq-vitals').warn('心跳写盘失败：%s', String(error))
      return
    }
    if (dream !== undefined) notify(dreams, '梦境', dream)
    if (scar !== undefined) notify(scars, '疤痕', scar)
    if (farewell !== undefined) notify(farewells, '遗书', farewell)
    if (cycleStart !== undefined) notify(cycles, '开经', cycleStart)
    // 睡醒了才通知：睡前是睡着、这一拍已经不是了，就算醒了一次
    if (before.sleep_state === 'sleeping' && next.sleep_state !== 'sleeping') {
      notify(wakes, '醒来', { at, from: before.sleep_state, to: next.sleep_state })
    }
  }

  const seam: QqVitalsSeam = {
    read() {
      return current()
    },
    render() {
      // 换措辞按天轮换，别每轮变一句，否则提示词前缀每轮都不同、缓存全失效
      const day = Math.floor(Date.now() / 86_400_000)
      return renderPrompt(current(), tuning, day % 6)
    },
    cycleBounds() {
      return [tuning.cycleMenstrualEnd, tuning.cycleFollicularEnd, tuning.cycleOvulationEnd, tuning.cycleLutealEnd]
    },
    pairs() {
      const now = current()
      // 拮抗与搭配各成一对：这一对里谁高谁低，画出来比读数字快
      return [
        { name: '自主神经', a: '交感', av: now.adrenaline, b: '副交感', bv: now.acetylcholine },
        { name: '奖赏', a: '想要', av: now.dopamine, b: '满足', bv: now.endorphin },
        { name: '依恋', a: '亲近', av: now.oxytocin, b: '占有', bv: now.vasopressin },
        { name: '应激', a: '压力', av: now.cortisol, b: '稳定', bv: now.serotonin },
        { name: '血糖', a: '血糖', av: now.glucose, b: '胰岛素', bv: now.insulin },
      ]
    },
    react(text, at) {
      // 时间戳只往前走，秒级的消息时间不会把上一次记录顶回去
      const raw = store.read()
      const moment = Math.max(at ?? Date.now(), raw.last_update)
      let meal: MealFact | undefined
      let drink: DrinkFact | undefined
      let dream: DreamFact | undefined
      let scar: ScarFact | undefined
      let cycleStart: CycleFact | undefined
      try {
        const settled = derive(
          reactToText(drift(raw, moment, tuning, undefined, balance, existence), text, moment, tuning),
          tuning,
        )
        dream = dreamFactOf(settled, tuning)
        scar = scarFactOf(raw, settled, moment)
        cycleStart = cycleStartOf(raw, settled, moment, tuning)
        const next: VitalsState = { ...settled }
        if (dream !== undefined) next.dream_applied_at = dream.at
        if (cycleStart !== undefined) next.cycle_start_applied_at = cycleStart.at
        if (next.meal_applied_at !== raw.meal_applied_at) meal = { at: next.meal_applied_at, name: mealName(text, tuning.words) }
        // 只在这一杯真写进去了才产事实：冷却挡掉的那次 last_drink 不动
        if (next.last_drink !== raw.last_drink) drink = { at: next.last_drink, name: next.last_drink_name }
        const significant = dream !== undefined || scar !== undefined || cycleStart !== undefined
          || meal !== undefined || drink !== undefined
        store.write(next, significant)
      } catch (error) {
        ctx.logger('qq-vitals').warn('消息写盘失败：%s', String(error))
        return
      }
      if (meal !== undefined) notify(meals, '进食', meal)
      if (drink !== undefined) notify(drinks, '喝水', drink)
      if (dream !== undefined) notify(dreams, '梦境', dream)
      if (scar !== undefined) notify(scars, '疤痕', scar)
      if (cycleStart !== undefined) notify(cycles, '开经', cycleStart)
    },
    reactEvents(events, at, _chatKey) {
      if (events.length === 0) return
      const raw = store.read()
      const moment = Math.max(at ?? Date.now(), raw.last_update)
      let meal: MealFact | undefined
      let drink: DrinkFact | undefined
      let dream: DreamFact | undefined
      let scar: ScarFact | undefined
      let cycleStart: CycleFact | undefined
      try {
        const settled = derive(
          applyEvents(drift(raw, moment, tuning, undefined, balance, existence), events, moment, tuning),
          tuning,
        )
        dream = dreamFactOf(settled, tuning)
        scar = scarFactOf(raw, settled, moment)
        cycleStart = cycleStartOf(raw, settled, moment, tuning)
        const next: VitalsState = { ...settled }
        if (dream !== undefined) next.dream_applied_at = dream.at
        if (cycleStart !== undefined) next.cycle_start_applied_at = cycleStart.at
        // 只有真吃进去、真喝下去才产事实：冷却挡掉的那次不动这两个时刻
        if (next.meal_applied_at !== raw.meal_applied_at) meal = { at: next.meal_applied_at, name: '饭' }
        if (next.last_drink !== raw.last_drink) drink = { at: next.last_drink, name: next.last_drink_name }
        const significant = dream !== undefined || scar !== undefined || cycleStart !== undefined
          || meal !== undefined || drink !== undefined
        store.write(next, significant)
      } catch (error) {
        ctx.logger('qq-vitals').warn('事件写盘失败：%s', String(error))
        return
      }
      if (meal !== undefined) notify(meals, '进食', meal)
      if (drink !== undefined) notify(drinks, '喝水', drink)
      if (dream !== undefined) notify(dreams, '梦境', dream)
      if (scar !== undefined) notify(scars, '疤痕', scar)
      if (cycleStart !== undefined) notify(cycles, '开经', cycleStart)
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
    onDrink(listener) {
      drinks.add(listener)
      return () => {
        drinks.delete(listener)
      }
    },
    onCycle(listener) {
      cycles.add(listener)
      return () => {
        cycles.delete(listener)
      }
    },
    onCycleStart(listener) {
      cycles.add(listener)
      return () => {
        cycles.delete(listener)
      }
    },
    onFarewell(listener) {
      farewells.add(listener)
      return () => {
        farewells.delete(listener)
      }
    },
    onDream(listener) {
      dreams.add(listener)
      return () => {
        dreams.delete(listener)
      }
    },
    onWake(listener) {
      wakes.add(listener)
      return () => {
        wakes.delete(listener)
      }
    },
    onScar(listener) {
      scars.add(listener)
      return () => {
        scars.delete(listener)
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

  // 启动后先等一下，之后每分钟一次；同一份状态文件只许一条心跳在跳
  let timer: ReturnType<typeof setInterval> | undefined
  const holder = beating.get(file)
  if (holder !== undefined && holder !== ctx.root) {
    ctx.logger('qq-vitals').warn('这份状态已经有一条心跳在跳，这一次不另起：%s', file)
  } else {
    beating.set(file, ctx.root)
    const start = setTimeout(() => {
      beat()
      timer = setInterval(beat, tuning.beatMs)
      timer.unref()
    }, tuning.startDelayMs)
    start.unref()
    ctx.effect(() => () => {
      clearTimeout(start)
    })
  }

  // 卸载时停掉心跳，再写一次盘
  ctx.effect(() => () => {
    if (timer !== undefined) clearInterval(timer)
    if (beating.get(file) === ctx.root) beating.delete(file)
    store.write(current())
    meals.clear()
    drinks.clear()
    cycles.clear()
    farewells.clear()
    dreams.clear()
    scars.clear()
    seams.delete(ctx.root)
  })
}
