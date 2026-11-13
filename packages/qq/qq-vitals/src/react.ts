// 身体写回：模型报事件就当事实应用；词表只作可选的备用，默认空着

import { localHour, nightness } from './clock.ts'
import type { Tuning } from './defaults.ts'
import { clamp } from './math.ts'
import { raiseScar } from './scar.ts'
import type { VitalsState } from './types.ts'
import { drinkName, isDrink, isMeal, mentionsAny, saidSeriously } from './words.ts'

/** 模型可以直接报的身体事件，一个事件就是一件发生过的事 */
export type BodyEvent =
  | { kind: 'drank'; name?: string }
  | { kind: 'ate' }
  | { kind: 'praised' }
  | { kind: 'apologized' }
  | { kind: 'scolded' }
  | { kind: 'threatened' }
  | { kind: 'scared' }
  | { kind: 'worried' }
  | { kind: 'dreaded' }
  | { kind: 'sick' }
  | { kind: 'hurt' }
  | { kind: 'talked' }

// 喝一杯水：写回五项，再抬多巴胺与内啡肽；last_drink 兼冷却与防重复
function giveDrink(next: VitalsState, name: string, at: number, tuning: Tuning): void {
  if (at - next.last_drink < tuning.drinkCooldownMs) return
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

// 吃一顿饭：五个量各走一步，血糖怎么回落交给漂移那套双向调节
function giveMeal(next: VitalsState, at: number, tuning: Tuning): void {
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

// 夜色浓度过线算深夜：同一句好话在深夜抬得更多，白天按一倍算
function praiseBoost(at: number, tuning: Tuning): number {
  return nightness(localHour(at, tuning.timeZone), tuning) > tuning.lateNightFrom ? tuning.lateNightPraiseGain : 1
}

// 被夸：想要与亲近都涨一点，火气随之落一点，正面热度也抬；兴奋那三项在深夜乘加成
function givePraise(next: VitalsState, at: number, tuning: Tuning): void {
  if (at - next.praise_applied_at < tuning.reactCooldownMs) return
  const boost = praiseBoost(at, tuning)
  next.praise_applied_at = at
  next.dopamine = clamp(next.dopamine + tuning.praiseDopamineGain * boost)
  next.oxytocin = clamp(next.oxytocin + tuning.praiseOxytocinGain * boost)
  next.endorphin = clamp(next.endorphin + tuning.praiseEndorphinGain * boost)
  next.cortisol = clamp(next.cortisol - tuning.praiseCortisolDrop)
  next.soothe = clamp(next.soothe + tuning.soothePraiseGain)
  next.anger = clamp(next.anger - (tuning.praiseAngerDrop + tuning.praiseAngerScale * next.soothe))
  next.resentment = clamp(next.resentment - tuning.praiseResentmentDrop)
  next.positive_heat = clamp(next.positive_heat + tuning.positiveHeatGain)
}

// 被道歉：比好话管用得多，被哄程度越高，怒气与记恨落得越快
function giveApology(next: VitalsState, at: number, tuning: Tuning): void {
  if (at - next.apology_applied_at < tuning.apologyCooldownMs) return
  next.apology_applied_at = at
  next.soothe = clamp(next.soothe + tuning.sootheApologyGain)
  next.anger = clamp(next.anger - (tuning.apologyAngerDrop + tuning.apologyAngerScale * next.soothe))
  next.resentment = clamp(next.resentment - (tuning.apologyResentmentDrop + tuning.apologyResentmentScale * next.soothe))
}

// 被凶：压力与警觉上去，稳定下来一点；怒气与负面热度记在情绪账上
function giveAnger(next: VitalsState, at: number, tuning: Tuning): void {
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

// 被威胁要关掉或换掉：怕与存在性恐惧一起抬，这一路冷却最长；极端生存威胁同时留疤
function giveThreat(next: VitalsState, at: number, tuning: Tuning): void {
  if (at - next.threat_applied_at < tuning.threatCooldownMs) return
  next.threat_applied_at = at
  next.fear = clamp(next.fear + tuning.threatFearGain)
  next.dread = clamp(next.dread + tuning.threatDreadGain)
  raiseScar(next, at, tuning)
}

// 三种怕各记各的时刻：惊吓、担心、存在性恐惧的冷却与半衰都不同
function giveFear(next: VitalsState, at: number, tuning: Tuning): void {
  if (at - next.fear_applied_at < tuning.fearCooldownMs) return
  next.fear_applied_at = at
  next.fear = clamp(next.fear + tuning.fearGainBase + tuning.fearGainIntensity * tuning.intensity)
}

function giveWorry(next: VitalsState, at: number, tuning: Tuning): void {
  if (at - next.worry_applied_at < tuning.worryCooldownMs) return
  next.worry_applied_at = at
  next.worry = clamp(next.worry + tuning.worryGainBase + tuning.worryGainIntensity * tuning.intensity)
}

function giveDread(next: VitalsState, at: number, tuning: Tuning): void {
  if (at - next.dread_applied_at < tuning.dreadCooldownMs) return
  next.dread_applied_at = at
  next.dread = clamp(next.dread + tuning.dreadGainBase + tuning.dreadGainIntensity * tuning.intensity)
}

/**
 * 按模型报的事件改身体：一个事件只做一次，冷却照样管
 * @param state - 当前状态
 * @param events - 这一轮报上来的事件，按发生顺序
 * @param at - 当前毫秒时间戳
 * @param tuning - 参数
 * @returns 写回后的状态
 */
export function applyEvents(state: VitalsState, events: readonly BodyEvent[], at: number, tuning: Tuning): VitalsState {
  const next: VitalsState = { ...state, last_msg: at }
  // 睡着时只记一笔被吵醒：这条路上不产生回不回的结论
  if (next.sleep_state === 'sleeping') {
    next.woken_at = at
    return next
  }
  if (events.some(event => event.kind === 'talked')) {
    next.loneliness = clamp(next.loneliness - 0.12)
    next.oxytocin = clamp(next.oxytocin + 0.03)
  }
  for (const event of events) {
    switch (event.kind) {
      case 'drank': giveDrink(next, event.name ?? '水', at, tuning); break
      case 'ate': giveMeal(next, at, tuning); break
      case 'praised': givePraise(next, at, tuning); break
      case 'apologized': giveApology(next, at, tuning); break
      case 'scolded': giveAnger(next, at, tuning); break
      case 'threatened': giveThreat(next, at, tuning); break
      case 'scared': giveFear(next, at, tuning); break
      case 'worried': giveWorry(next, at, tuning); break
      case 'dreaded': giveDread(next, at, tuning); break
      case 'sick': next.cytokines = clamp(next.cytokines + tuning.sickCytokinesGain); break
      case 'hurt': next.pain = clamp(next.pain + tuning.painGain); break
      case 'talked': break
      default: break
    }
  }
  return next
}

/**
 * 把一条消息写成身体的变化：词表认得出来才动，词表空着就什么都不做
 * @param state - 当前状态
 * @param text - 用户这句话
 * @param at - 当前毫秒时间戳
 * @param tuning - 参数
 * @returns 写回后的状态
 */
export function react(state: VitalsState, text: string, at: number, tuning: Tuning): VitalsState {
  const next: VitalsState = { ...state, last_msg: at, last_user_text: text }
  // 睡着时只记一笔被吵醒，别的一概不动
  if (next.sleep_state === 'sleeping') {
    next.woken_at = at
    return next
  }
  // 凶与生死两路先剔掉口头禅，剩下的才算真话
  const serious = saidSeriously(text, tuning.words)
  if (isDrink(text, tuning.words)) giveDrink(next, drinkName(text, tuning.words), at, tuning)
  if (isMeal(text, tuning.words)) giveMeal(next, at, tuning)
  if (mentionsAny(text, tuning.words.praise)) givePraise(next, at, tuning)
  if (mentionsAny(serious, tuning.words.apology)) giveApology(next, at, tuning)
  if (mentionsAny(serious, tuning.words.anger)) giveAnger(next, at, tuning)
  if (mentionsAny(serious, tuning.words.threat)) giveThreat(next, at, tuning)
  if (mentionsAny(serious, tuning.words.scare)) giveFear(next, at, tuning)
  if (mentionsAny(serious, tuning.words.worry)) giveWorry(next, at, tuning)
  if (mentionsAny(serious, tuning.words.dread)) giveDread(next, at, tuning)
  if (mentionsAny(serious, tuning.words.sick)) next.cytokines = clamp(next.cytokines + tuning.sickCytokinesGain)
  if (mentionsAny(serious, tuning.words.pain)) next.pain = clamp(next.pain + tuning.painGain)
  return next
}
