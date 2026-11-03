// 一句话进来，身体改一点：喝水、被夸、被凶

import type { Tuning } from './defaults.ts'
import { clamp } from './math.ts'
import type { VitalsState } from './types.ts'
import { ANGER, drinkName, isDrink, mentionsAny, PRAISE } from './words.ts'

// 喝一杯水：写回五项，再加多巴胺与内啡肽；last_drink 兼冷却与幂等
function applyDrink(next: VitalsState, text: string, at: number, tuning: Tuning): void {
  if (!isDrink(text)) return
  if (at - next.last_drink < tuning.drinkCooldownMs) return
  const name = drinkName(text)
  next.thirst = clamp(next.thirst - tuning.drinkThirstDrop)
  next.osmolality = clamp(next.osmolality - tuning.drinkOsmolalityDrop)
  next.blood_volume = clamp(next.blood_volume + tuning.drinkVolumeRise)
  next.angiotensin = clamp(next.angiotensin - tuning.drinkAngiotensinDrop)
  next.fluid_queue = clamp(next.fluid_queue + tuning.drinkQueueRise)
  next.dopamine = clamp(next.dopamine + tuning.drinkDopamineGain * tuning.intensity)
  next.endorphin = clamp(next.endorphin + tuning.drinkEndorphinGain * tuning.intensity)
  next.last_drink = at
  next.last_drink_at = at
  next.last_drink_name = name
  next.fluid_applied_at = at
  next.last_taste = {
    name,
    desc: '对方给我倒的',
    feel: '嗓子一下就舒服了',
    preference: 0.2,
    emotion_label: '舒服',
    source: 'drink',
  }
  next.last_taste_at = at
  if (at - next.drink_mem_at > tuning.drinkMemoryMs) next.drink_mem_at = at
}

// 被夸：想要与亲近都涨一点
function applyPraise(next: VitalsState, text: string, at: number, tuning: Tuning): void {
  if (!mentionsAny(text, PRAISE)) return
  if (at - next.praise_applied_at < tuning.reactCooldownMs) return
  next.praise_applied_at = at
  next.dopamine = clamp(next.dopamine + tuning.praiseDopamineGain)
  next.oxytocin = clamp(next.oxytocin + tuning.praiseOxytocinGain)
  next.endorphin = clamp(next.endorphin + tuning.praiseEndorphinGain)
  next.cortisol = clamp(next.cortisol - tuning.praiseCortisolDrop)
}

// 被凶：压力与警觉上去，稳定下来一点
function applyAnger(next: VitalsState, text: string, at: number, tuning: Tuning): void {
  if (!mentionsAny(text, ANGER)) return
  if (at - next.anger_applied_at < tuning.reactCooldownMs) return
  next.anger_applied_at = at
  next.cortisol = clamp(next.cortisol + tuning.angerCortisolGain)
  next.adrenaline = clamp(next.adrenaline + tuning.angerAdrenalineGain)
  next.noradrenaline = clamp(next.noradrenaline + tuning.angerNoradrenalineGain)
  next.serotonin = clamp(next.serotonin - tuning.angerSerotoninDrop)
  next.vasopressin = clamp(next.vasopressin + tuning.angerVasopressinGain)
}

/**
 * 把一条消息写成身体的变化
 * @param state - 当前状态
 * @param text - 用户这句话
 * @param at - 当前毫秒时间戳
 * @param tuning - 参数
 * @returns 写回后的状态
 */
export function react(state: VitalsState, text: string, at: number, tuning: Tuning): VitalsState {
  const next: VitalsState = { ...state, last_msg: at, last_user_text: text }
  applyDrink(next, text, at, tuning)
  applyPraise(next, text, at, tuning)
  applyAnger(next, text, at, tuning)
  return next
}
