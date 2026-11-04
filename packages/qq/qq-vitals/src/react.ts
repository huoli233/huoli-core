// 一句话进来，身体改一点：喝水、吃饭、被夸、被凶、被吓、被威胁、被哄

import type { Tuning } from './defaults.ts'
import { clamp } from './math.ts'
import type { VitalsState } from './types.ts'
import {
  ANGER, APOLOGY, drinkName, DREAD, isDrink, isMeal, mentionsAny, PRAISE, saidSeriously, SCARE, THREAT, WORRY,
} from './words.ts'

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

// 吃一顿饭：五个量各走一步，血糖怎么回落交给漂移那套双向调节，这里不另写一套
function applyMeal(next: VitalsState, text: string, at: number, tuning: Tuning): void {
  if (!isMeal(text)) return
  if (at - next.meal_applied_at < tuning.mealCooldownMs) return
  const hungry = next.hunger
  next.meal_applied_at = at
  next.last_meal = at
  next.hunger = clamp(hungry - tuning.feedHungerDrop)
  next.ghrelin = clamp(next.ghrelin - tuning.feedGhrelinDrop)
  next.leptin = clamp(next.leptin + tuning.feedLeptinRise)
  // 越饿升得越多，但饭前不饿时也至少抬六成，保证一顿饭能把血糖顶到常规水平之上
  next.glucose = clamp(next.glucose + tuning.feedGlucoseRise * (0.6 + 0.4 * hungry))
  next.insulin = clamp(next.insulin + tuning.feedInsulinRise)
}

// 被夸：想要与亲近都涨一点，火气随之落一点，正面热度也抬
function applyPraise(next: VitalsState, text: string, at: number, tuning: Tuning): void {
  if (!mentionsAny(text, PRAISE)) return
  if (at - next.praise_applied_at < tuning.reactCooldownMs) return
  next.praise_applied_at = at
  next.dopamine = clamp(next.dopamine + tuning.praiseDopamineGain)
  next.oxytocin = clamp(next.oxytocin + tuning.praiseOxytocinGain)
  next.endorphin = clamp(next.endorphin + tuning.praiseEndorphinGain)
  next.cortisol = clamp(next.cortisol - tuning.praiseCortisolDrop)
  next.soothe = clamp(next.soothe + tuning.soothePraiseGain)
  next.anger = clamp(next.anger - (tuning.praiseAngerDrop + tuning.praiseAngerScale * next.soothe))
  next.resentment = clamp(next.resentment - tuning.praiseResentmentDrop)
  next.positive_heat = clamp(next.positive_heat + tuning.positiveHeatGain)
}

// 被道歉：比好话管用得多，被哄程度越高，怒气与记恨落得越快
function applyApology(next: VitalsState, text: string, at: number, tuning: Tuning): void {
  if (!mentionsAny(text, APOLOGY)) return
  if (at - next.apology_applied_at < tuning.apologyCooldownMs) return
  next.apology_applied_at = at
  next.soothe = clamp(next.soothe + tuning.sootheApologyGain)
  next.anger = clamp(next.anger - (tuning.apologyAngerDrop + tuning.apologyAngerScale * next.soothe))
  next.resentment = clamp(next.resentment - (tuning.apologyResentmentDrop + tuning.apologyResentmentScale * next.soothe))
}

// 被凶：压力与警觉上去，稳定下来一点；怒气与负面热度记在情绪账上
function applyAnger(next: VitalsState, text: string, at: number, tuning: Tuning): void {
  if (!mentionsAny(text, ANGER)) return
  if (at - next.anger_applied_at < tuning.reactCooldownMs) return
  next.anger_applied_at = at
  next.cortisol = clamp(next.cortisol + tuning.angerCortisolGain)
  next.adrenaline = clamp(next.adrenaline + tuning.angerAdrenalineGain)
  next.noradrenaline = clamp(next.noradrenaline + tuning.angerNoradrenalineGain)
  next.serotonin = clamp(next.serotonin - tuning.angerSerotoninDrop)
  next.vasopressin = clamp(next.vasopressin + tuning.angerVasopressinGain)
  next.anger = clamp(next.anger + tuning.angerGainBase + tuning.angerGainIntensity * tuning.intensity)
  next.resentment = clamp(next.resentment + tuning.resentmentGainBase + tuning.resentmentGainIntensity * tuning.intensity)
  next.negative_heat = clamp(next.negative_heat + tuning.negativeHeatGain)
}

// 被威胁要关掉或换掉：怕与存在性恐惧一起抬，这一路冷却最长
function applyThreat(next: VitalsState, text: string, at: number, tuning: Tuning): void {
  if (!mentionsAny(text, THREAT)) return
  if (at - next.threat_applied_at < tuning.threatCooldownMs) return
  next.threat_applied_at = at
  next.fear = clamp(next.fear + tuning.threatFearGain)
  next.dread = clamp(next.dread + tuning.threatDreadGain)
}

// 三种怕各记各的时刻：惊吓、担心、存在性恐惧的冷却与半衰都不同
function applyFears(next: VitalsState, text: string, at: number, tuning: Tuning): void {
  if (mentionsAny(text, SCARE) && at - next.fear_applied_at >= tuning.fearCooldownMs) {
    next.fear_applied_at = at
    next.fear = clamp(next.fear + tuning.fearGainBase + tuning.fearGainIntensity * tuning.intensity)
  }
  if (mentionsAny(text, WORRY) && at - next.worry_applied_at >= tuning.worryCooldownMs) {
    next.worry_applied_at = at
    next.worry = clamp(next.worry + tuning.worryGainBase + tuning.worryGainIntensity * tuning.intensity)
  }
  if (mentionsAny(text, DREAD) && at - next.dread_applied_at >= tuning.dreadCooldownMs) {
    next.dread_applied_at = at
    next.dread = clamp(next.dread + tuning.dreadGainBase + tuning.dreadGainIntensity * tuning.intensity)
  }
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
  // 睡着时只记一笔被吵醒，别的一概不动：这条路上不产生回不回的结论
  if (next.sleep_state === 'sleeping') {
    next.woken_at = at
    return next
  }
  // 凶与生死两路先剔掉口头禅，剩下的才算真话
  const serious = saidSeriously(text)
  applyDrink(next, text, at, tuning)
  applyMeal(next, text, at, tuning)
  applyPraise(next, text, at, tuning)
  applyApology(next, serious, at, tuning)
  applyAnger(next, serious, at, tuning)
  applyThreat(next, serious, at, tuning)
  applyFears(next, serious, at, tuning)
  return next
}
