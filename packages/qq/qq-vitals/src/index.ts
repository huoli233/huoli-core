// 装配入口：一份状态、一条心跳，对外只有“读事实”和“渲染一段话”

import { join } from 'node:path'
import type { Context } from '@huoli/cordis'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import '@huoli/huoli-system-prompt'
import { resolveTuning, type Tuning } from './defaults.ts'
import { derive } from './derive.ts'
import { drift } from './drift.ts'
import { react as reactToText } from './react.ts'
import { renderPrompt } from './render.ts'
import { createVitalsStore } from './store.ts'
import type { VitalsState } from './types.ts'

export type { Tuning } from './defaults.ts'
export { DEFAULTS, emptyState, resolveTuning } from './defaults.ts'
export { derive } from './derive.ts'
export { drift } from './drift.ts'
export { react } from './react.ts'
export { renderPrompt, thirstNote } from './render.ts'
export { isDrink } from './words.ts'
export { createVitalsStore } from './store.ts'
export type { VitalsStoreOptions, VitalsStore } from './store.ts'
export type { Baseline, TasteRecord, VitalsState } from './types.ts'

/** 一个应用里的那份身体 */
export interface QqVitalsSeam {
  /** 读事实：当前这一份状态，别的包不许自己再算 */
  read(): VitalsState
  /** 渲染一段话：这一轮的语气提示，最多三百字 */
  render(): string
  /** 记一句话：写回身体并落盘，冷却窗口内的重复写法不再计入 */
  react(text: string, at?: number): void
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
  return seams.get(ctx)
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
  let variant = 0

  // 读之前先把这段时间的漂移结掉，但落盘留给心跳
  const current = (): VitalsState => derive(drift(store.read(), Date.now(), tuning), tuning)

  // 心跳一次：结算、写盘；出错只记一笔，不让循环停掉
  const beat = (): void => {
    try {
      store.write(current())
    } catch (error) {
      ctx.logger('qq-vitals').warn('心跳写盘失败：%s', String(error))
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
      try {
        store.write(derive(reactToText(drift(raw, moment, tuning), text, moment, tuning), tuning))
      } catch (error) {
        ctx.logger('qq-vitals').warn('消息写盘失败：%s', String(error))
      }
    },
  }
  seams.set(ctx, seam)

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
    seams.delete(ctx)
  })
}
