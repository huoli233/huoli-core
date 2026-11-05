// 身体那边产出的六类事实在这里落成记忆，开关关着时一个订阅都不注册

import type { Context } from '@huoli/cordis'
import { farewellTextAt, readFarewellSlot, type QqChannelSeam } from '@huoli/huoli-qq-channel'
import type { QqMemorySeam } from '@huoli/huoli-qq-memory'
import type { QqSubjectSeam } from '@huoli/huoli-qq-subject'
import type { CycleStartFact, DreamFact, DrinkFact, FarewellFact, MealFact, QqVitalsSeam, ScarFact } from '@huoli/huoli-qq-vitals'
import type { Config } from './types.ts'
import type { BUNDLE_DEFAULTS } from './defaults.ts'
import { dreamImportance, dreamKey, dreamMetadata, dreamText, dreamWritten } from './dream.ts'
import { drinkMetadata, drinkText, drinkWritten } from './drink.ts'
import { farewellMetadata, farewellText, farewellWritten } from './farewell.ts'
import { mealMetadata, mealText, mealWritten } from './meal.ts'
import { SCAR_TEXT, scarImportance, scarMetadata, scarWritten } from './scar.ts'

/** 装配层递过来的东西，都是它自己那份已解析好的值 */
export interface MemoryEventDeps {
  config: Config
  defaults: typeof BUNDLE_DEFAULTS
  memory: QqMemorySeam | undefined
  subject: QqSubjectSeam | undefined
  vitals: QqVitalsSeam | undefined
  channel: QqChannelSeam | undefined
  postLevel: string
  farewellFile: string
}

/** 没有活跃会话就只记一行，不让这一拍的其它订阅者跟着断掉 */
function activeOf(ctx: Context, subject: QqSubjectSeam | undefined, what: string): string {
  const chatKey = subject?.store.read().lastActive ?? ''
  if (chatKey === '') ctx.logger('qq-bundle').warn(`${what}没有落点：还没有活跃会话`)
  return chatKey
}

/**
 * 把六类事实接进装配，卸载时逐个撤订阅
 * @param ctx - 运行环境
 * @param deps - 记忆仓、身体、通道与六类事实各自的开关
 */
export function registerMemoryEvents(ctx: Context, deps: MemoryEventDeps): void {
  const { config, defaults, memory, subject, vitals, channel, postLevel, farewellFile } = deps
  const warn = (message: string, error: unknown): void => {
    ctx.logger('qq-bundle').warn(message, String(error))
  }

  // 一顿饭写一条记忆：会话取当前活跃的那个，同一天同一顿只写一条
  const mealImportance = config.mealMemoryImportance ?? defaults.mealMemoryImportance
  const writeMeal = (fact: MealFact): void => {
    if (memory === undefined) return
    const chatKey = activeOf(ctx, subject, '进食记忆')
    if (chatKey === '') return
    if (mealWritten(memory.store.all(), chatKey, fact.at)) return
    memory.write(mealText(fact), chatKey, {
      layer: 'episodic', source: 'chat', importance: mealImportance, at: fact.at, metadata: mealMetadata(fact),
    })
  }
  if ((config.mealMemory ?? defaults.mealMemory) && vitals !== undefined) {
    const off = vitals.onMeal((fact) => {
      try { writeMeal(fact) } catch (error) { warn('进食记忆没写进去：%s', error) }
    })
    ctx.effect(() => () => { off() })
  }

  // 一杯水写一条记忆：二十分钟里只要一条，太密就成了喝水流水账
  const drinkImportance = config.drinkMemoryImportance ?? defaults.drinkMemoryImportance
  const writeDrink = (fact: DrinkFact): void => {
    if (memory === undefined) return
    const chatKey = activeOf(ctx, subject, '喝水记忆')
    if (chatKey === '') return
    if (drinkWritten(memory.store.all(), chatKey, fact.at)) return
    memory.write(drinkText(fact), chatKey, {
      layer: 'episodic', source: 'chat', importance: drinkImportance, at: fact.at, metadata: drinkMetadata(fact),
    })
  }
  if ((config.drinkMemory ?? defaults.drinkMemory) && vitals !== undefined) {
    const off = vitals.onDrink((fact) => {
      try { writeDrink(fact) } catch (error) { warn('喝水记忆没写进去：%s', error) }
    })
    ctx.effect(() => () => { off() })
  }

  // 开经日写一条记忆：同一个周期里只写一次，判据只读记忆本身
  const cycleImportance = config.cycleMemoryImportance ?? defaults.cycleMemoryImportance
  const writeCycleStart = (fact: CycleStartFact): void => {
    if (memory === undefined) return
    const chatKey = activeOf(ctx, subject, '开经记忆')
    if (chatKey === '') return
    const sameCycle = memory.store.all().some(item =>
      item.scope === chatKey && item.metadata?.kind === 'cycle_start'
      && Math.abs(fact.at - item.at) < 20 * 24 * 60 * 60_000)
    if (sameCycle) return
    memory.write(`今天是这个周期的第 ${fact.day} 天，身上不大舒服`, chatKey, {
      layer: 'episodic', source: 'chat', importance: cycleImportance, at: fact.at,
      metadata: { kind: 'cycle_start', at: fact.at, day: fact.day },
    })
  }
  if ((config.cycleMemory ?? defaults.cycleMemory) && vitals !== undefined) {
    const off = vitals.onCycleStart((fact) => {
      try { writeCycleStart(fact) } catch (error) { warn('开经记忆没写进去：%s', error) }
    })
    ctx.effect(() => () => { off() })
  }

  // 遗书写一条记忆：模型自己写过的那句优先，去重看记忆里已有的条
  const farewellImportance = config.farewellMemoryImportance ?? defaults.farewellMemoryImportance
  const modelWords = (fact: FarewellFact): string | undefined => {
    try { return farewellTextAt(readFarewellSlot(farewellFile), fact.at) } catch (error) {
      warn('遗书的暂存槽没读出来：%s', error)
      return undefined
    }
  }
  const writeFarewell = (fact: FarewellFact): void => {
    if (memory === undefined) return
    const chatKey = activeOf(ctx, subject, '遗书')
    if (chatKey === '') return
    if (farewellWritten(memory.store.all(), chatKey, fact.at)) return
    const authored = modelWords(fact)
    memory.write(farewellText(authored ?? config.farewellText), chatKey, {
      layer: 'semantic', source: 'chat', importance: farewellImportance, at: fact.at,
      metadata: farewellMetadata(fact, authored === undefined ? 'fallback' : 'model'),
    })
  }
  if ((config.farewellMemory ?? defaults.farewellMemory) && vitals !== undefined) {
    const off = vitals.onFarewell((fact) => {
      try { writeFarewell(fact) } catch (error) { warn('遗书没写进去：%s', error) }
    })
    ctx.effect(() => () => { off() })
  }

  // 一场梦写一条记忆，美梦与噩梦再发一次：同一天同一场只写一条、只发一次
  const dreamMemory = config.dreamMemory ?? defaults.dreamMemory
  const dreamPublish = config.dreamPublish ?? defaults.dreamPublish
  const publishedDreams = new Set<string>()
  const writeDream = (fact: DreamFact, chatKey: string): void => {
    if (memory === undefined) return
    if (dreamWritten(memory.store.all(), chatKey, fact)) return
    memory.write(dreamText(fact), chatKey, {
      layer: 'episodic', source: 'chat', importance: dreamImportance(fact), at: fact.at, metadata: dreamMetadata(fact),
    })
  }
  const publishDream = async (fact: DreamFact, chatKey: string): Promise<void> => {
    if (channel === undefined) {
      ctx.logger('qq-bundle').warn('梦境没有发布入口：通道那一行没装上')
      return
    }
    const key = dreamKey(fact)
    if (publishedDreams.has(key)) return
    publishedDreams.add(key)
    try { await channel.publish('post', dreamText(fact), { chatKey, level: postLevel }) } catch (error) {
      warn('梦境没发出去：%s', error)
    }
  }
  if ((dreamMemory || dreamPublish) && vitals !== undefined) {
    const off = vitals.onDream((fact) => {
      const chatKey = activeOf(ctx, subject, '梦境')
      if (chatKey === '') return
      if (dreamMemory) {
        try { writeDream(fact, chatKey) } catch (error) { warn('梦境记忆没写进去：%s', error) }
      }
      if (dreamPublish && fact.publishable) void publishDream(fact, chatKey)
    })
    ctx.effect(() => () => { off() })
  }

  // 疤写成一条长期印象：同一小时里只写一次
  const writeScar = (fact: ScarFact): void => {
    if (memory === undefined) return
    const chatKey = activeOf(ctx, subject, '疤痕记忆')
    if (chatKey === '') return
    if (scarWritten(memory.store.all(), chatKey, fact.at)) return
    memory.write(SCAR_TEXT, chatKey, {
      layer: 'semantic', source: 'chat', importance: scarImportance(fact), at: fact.at, metadata: scarMetadata(fact),
    })
  }
  if ((config.scarMemory ?? defaults.scarMemory) && vitals !== undefined) {
    const off = vitals.onScar((fact) => {
      try { writeScar(fact) } catch (error) { warn('疤痕没写进去：%s', error) }
    })
    ctx.effect(() => () => { off() })
  }
}
