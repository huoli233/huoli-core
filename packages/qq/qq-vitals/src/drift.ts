// 按小时漂移：递质往基线回，口渴这类存量直接累积

import type { Tuning } from './defaults.ts'
import {
  cycleAnchorDay, cycleOf, inNapWindow, inSleepWindow, isDaytime, isMealHour, isQuietHour, localHour,
  localPoint, melatoninTarget, nightness, nightWakeAt, noradrenalineBaseline,
} from './clock.ts'
import { above, clamp, clampRange, decay, follow } from './math.ts'
import { mortalityTarget } from './mortality.ts'
import type { CyclePhase, VitalsState } from './types.ts'

// 递质回基线：皮质醇不在这里，它只由 HPA 轴管
function settleTransmitters(next: VitalsState, hours: number, night: number, hour: number, tuning: Tuning): void {
  const halfLife = night >= tuning.nightFullFrom ? tuning.transmitterNightHalfHours : tuning.transmitterHalfHours
  const naBase = noradrenalineBaseline(hour)
  const dopamineTarget = tuning.transmitterDopamineBase - tuning.transmitterDopamineNightDrop * night
  const oxytocinTarget = tuning.transmitterOxytocinBase + tuning.transmitterOxytocinNightRise * night
  const serotoninTarget = tuning.transmitterSerotoninBase - tuning.transmitterSerotoninNightDrop * night
  const naTarget = naBase - tuning.transmitterNoradrenalineNightDrop * night
  next.dopamine = clamp(follow(next.dopamine, dopamineTarget, halfLife, hours))
  next.oxytocin = clamp(follow(next.oxytocin, oxytocinTarget, halfLife, hours))
  next.serotonin = clamp(follow(next.serotonin, serotoninTarget, halfLife, hours))
  next.noradrenaline = clamp(follow(next.noradrenaline, naTarget, halfLife, hours))
}

// 缺糖与高饥饿折成零到一，一起算进这一轮的负荷
function hpaLoadOf(next: VitalsState, tuning: Tuning): number {
  const lowGlucose = above((tuning.hpaGlucoseFloor - next.glucose) / tuning.hpaGlucoseFloor)
  const highHunger = above((next.hunger - tuning.hpaHungerFrom) / tuning.hpaHungerSpan)
  return clamp(tuning.hpaLoadCortisol * next.cortisol + tuning.hpaLoadGlucose * lowGlucose
    + tuning.hpaLoadHunger * highHunger)
}

// 负反馈：皮质醇越高越压 crh，压回去的那部分按自己的跨度折算
function hpaFeedbackOf(next: VitalsState, tuning: Tuning): number {
  return 1 - tuning.hpaFeedbackGain * clamp((next.cortisol - tuning.hpaFeedbackFrom) / tuning.hpaFeedbackSpan)
}

// HPA 轴：慢，被催产素缓冲；返回这一轮的负荷，交感也用它
function settleHpa(next: VitalsState, hours: number, tuning: Tuning): number {
  const load = hpaLoadOf(next, tuning)
  const feedback = hpaFeedbackOf(next, tuning)
  next.crh = clamp(follow(next.crh, clamp(load * feedback), tuning.hpaCrhHalfHours, hours))
  next.acth = clamp(follow(next.acth, next.crh, tuning.hpaActhHalfHours, hours))
  const buffer = 1 - tuning.hpaOxytocinBufferGain
    * clamp((next.oxytocin - tuning.hpaOxytocinBufferFrom) / tuning.hpaOxytocinBufferSpan)
  next.cortisol = clamp(follow(
    next.cortisol,
    clamp(tuning.hpaCortisolBase + tuning.hpaCortisolActhGain * next.acth) * buffer,
    tuning.hpaCortisolHalfHours,
    hours,
  ))
  return load
}

// 交感与副交感
function settleAutonomic(next: VitalsState, hours: number, night: number, load: number, tuning: Tuning): void {
  const adrenalineTarget = clamp(tuning.adrenalineBase + tuning.adrenalineLoadGain * load)
  next.adrenaline = clamp(follow(next.adrenaline, adrenalineTarget, tuning.adrenalineHalfHours, hours))
  const paraTarget = clamp(tuning.parasympatheticBase
    + tuning.parasympatheticAdrenalineGain * (1 - next.adrenaline)
    + tuning.parasympatheticLeptinGain * next.leptin
    + tuning.parasympatheticNightGain * night)
  next.acetylcholine = clamp(follow(next.acetylcholine, paraTarget, tuning.parasympatheticHalfHours, hours))
}

// 奖赏双系统
function settleReward(next: VitalsState, hours: number, tuning: Tuning): void {
  const want = clamp(tuning.rewardWantDopamine * next.dopamine + tuning.rewardWantOxytocin * next.oxytocin
    - tuning.rewardWantCortisol * next.cortisol)
  const target = clamp(tuning.endorphinBase + tuning.endorphinWantGain * want)
  next.endorphin = clamp(follow(next.endorphin, target, tuning.endorphinHalfHours, hours))
}

// 依恋：渴了更想抓住人
function settleAttachment(next: VitalsState, hours: number, tuning: Tuning): void {
  const target = clamp(tuning.vasopressinBase
    + tuning.vasopressinClingyGain * next.clinginess
    + tuning.vasopressinCortisolGain * next.cortisol
    + tuning.vasopressinOsmolalityGain * above(next.osmolality - tuning.vasopressinOsmolalityFrom))
  next.vasopressin = clamp(follow(next.vasopressin, target, tuning.vasopressinHalfHours, hours))
}

// 距上次进食越久涨得越快，饭点再快一点，越饱越慢
function hungerRateOf(next: VitalsState, hour: number, meal: number, tuning: Tuning): number {
  let rate = tuning.hungerRate
  if (meal < tuning.hungerRecentHours) rate *= tuning.hungerRecentFactor
  else if (meal < tuning.hungerMiddleHours) rate *= tuning.hungerMiddleFactor
  else if (meal > tuning.hungerLongHours) rate *= tuning.hungerLongFactor
  if (isMealHour(hour)) rate *= tuning.hungerMealHourFactor
  rate *= Math.max(tuning.hungerSatietyFloor, 1 - tuning.hungerSatietyGain * next.hunger)
  if (isQuietHour(hour)) rate *= tuning.hungerQuietFactor
  return rate
}

// 胃排空加三餐节律
function settleHunger(next: VitalsState, hours: number, hour: number, meal: number, tuning: Tuning): void {
  next.hunger = clamp(next.hunger + hours * hungerRateOf(next, hour, meal, tuning))
}

// 活动量：警觉高、急性应激高都算在动
function activityOf(next: VitalsState, tuning: Tuning): number {
  return tuning.waterActivityBase
    + tuning.waterActivityNoradrenalineGain * above(next.noradrenaline - tuning.waterActivityNoradrenalineFrom)
    + tuning.waterActivityAdrenalineGain * above(next.adrenaline - tuning.waterActivityAdrenalineFrom)
}

// 水循环：口渴是累积量，不许写成向目标平滑
function settleWater(next: VitalsState, hours: number, hour: number, tuning: Tuning): void {
  const activity = activityOf(next, tuning)
  const quiet = isQuietHour(hour) ? tuning.waterQuietFactor : 1.0
  let loss = tuning.waterLossRate * hours * quiet * activity
  loss *= clampRange(tuning.metabolicRate, tuning.metabolicRateMin, tuning.metabolicRateMax)
  next.osmolality = clamp(next.osmolality + loss * tuning.waterOsmolalityGain)
  next.blood_volume = clamp(next.blood_volume - loss * tuning.waterVolumeDrop)
  const gap = above((tuning.angiotensinVolumeFrom - next.blood_volume) / tuning.angiotensinVolumeSpan)
  next.angiotensin = clamp(follow(
    next.angiotensin,
    clamp(tuning.angiotensinBase + tuning.angiotensinGain * gap),
    tuning.angiotensinHalfHours,
    hours,
  ))
  next.thirst = clamp(next.thirst + loss * tuning.thirstLossGain
    + tuning.thirstAngiotensinGain * above(next.angiotensin - tuning.thirstAngiotensinFrom))
}

// 血糖双向调节：只升不降会一路不回落
function settleGlucose(next: VitalsState, hours: number, tuning: Tuning): void {
  const insulinTarget = clamp(tuning.insulinBase
    + tuning.insulinGain * above((next.glucose - tuning.insulinGlucoseFrom) / tuning.insulinGlucoseSpan))
  next.insulin = clamp(follow(next.insulin, insulinTarget, tuning.insulinHalfHours, hours))
  const glucagonTarget = clamp(tuning.glucagonBase
    + tuning.glucagonGain * above((tuning.glucagonGlucoseBelow - next.glucose) / tuning.glucagonGlucoseSpan))
  next.glucagon = clamp(follow(next.glucagon, glucagonTarget, tuning.glucagonHalfHours, hours))
  const span = Math.min(tuning.glucoseSpanCap, hours)
  const rise = tuning.glucoseRiseBase
    + tuning.glucoseHungerGain * above(next.hunger - tuning.glucoseHungerFrom)
    + tuning.glucoseGlucagonGain * next.glucagon
    - tuning.glucoseInsulinDrop * next.insulin
  next.glucose = clamp(next.glucose + rise * span)
}

// 睡眠压力、体温、免疫、疼痛
function settleInner(next: VitalsState, hours: number, hour: number, night: number, tuning: Tuning): void {
  next.adenosine = clamp(next.adenosine + adenosineStep(next, hours, hour, tuning))
  next.cytokines = clamp(decay(next.cytokines, hours, tuning.cytokinesHalfHours))
  const feverTarget = clamp(next.cytokines * tuning.feverCytokinesGain)
  next.fever = clamp(follow(next.fever, feverTarget, tuning.feverHalfHours, hours))
  next.core_temp = Math.round(coreTempOf(next, night, tuning) * 100) / 100
  next.pain = clamp(decay(next.pain, Math.min(tuning.painHoursCap, hours), tuning.painHalfHours))
}

// 体温由夜色与发烧两件事撑着，落在两位小数上
function coreTempOf(next: VitalsState, night: number, tuning: Tuning): number {
  return tuning.coreTempBase - tuning.coreTempNightDrop * night + tuning.coreTempFeverGain * next.fever
}

// 醒着继续累积，睡着按睡的速率回血；午睡回得更快
function adenosineStep(next: VitalsState, hours: number, hour: number, tuning: Tuning): number {
  if (next.sleep_state === 'sleeping') {
    const drop = next.sleep_kind === 'nap' ? tuning.napAdenosineDrop : tuning.sleepAdenosineDrop
    return -drop * hours
  }
  return (isQuietHour(hour) ? tuning.adenosineQuietRate : tuning.adenosineAwakeRate) * hours
}

// 午睡一天只睡一次：上一次午睡和现在是同一个本地零点
function nappedToday(next: VitalsState, at: number): boolean {
  if (next.nap_at <= 0) return false
  return localPoint(next.nap_at).midnight === localPoint(at).midnight
}

// 入睡：夜里睡眠压力够了就睡，午后按每分钟的概率眯一会
function startSleep(next: VitalsState, at: number, hour: number, hours: number, tuning: Tuning, random: () => number): void {
  if (inSleepWindow(hour, tuning) && next.adenosine > tuning.sleepAdenosineFrom) {
    next.sleep_state = 'sleeping'
    next.sleep_kind = 'night'
    next.wake_after = nightWakeAt(at, tuning, random)
    return
  }
  if (!inNapWindow(hour, tuning)) return
  if (next.adenosine <= tuning.napAdenosineAbove || nappedToday(next, at)) return
  const chance = clampRange(1 - (1 - tuning.napChancePerMinute) ** (hours * 60), 0, 1)
  if (random() >= chance) return
  const span = tuning.napMaxMinutes - tuning.napMinMinutes
  next.sleep_state = 'sleeping'
  next.sleep_kind = 'nap'
  next.nap_at = at
  next.wake_after = at + Math.round((tuning.napMinMinutes + random() * span) * 60_000)
}

// 醒来：留一段迷糊窗口，睡的是哪一种决定迷糊多久
function wakeUp(next: VitalsState, at: number, tuning: Tuning): void {
  const minutes = next.sleep_kind === 'nap' ? tuning.napGroggyMinutes : tuning.groggyMinutes
  next.sleep_state = 'waking'
  next.sleep_kind = ''
  next.groggy_until = at + Math.round(minutes * 60_000)
  next.woken_at = 0
}

// 醒来只看三条：到点、白天里睡眠压力回落到低位、白天最晚那一下
function wakesNow(next: VitalsState, at: number, hour: number, tuning: Tuning): boolean {
  if (next.wake_after > 0 && at >= next.wake_after) return true
  // 午睡只认到点这一条：白天强制醒会把午睡立刻叫醒
  if (next.sleep_kind === 'nap') return false
  if (!isDaytime(hour, tuning)) return false
  if (hour < tuning.wakeLatest) return next.adenosine < tuning.wakeAdenosineBelow
  return true
}

// 睡眠三态：睡着时身体照常漂移，只是交互只剩被吵醒一种
function settleSleep(next: VitalsState, at: number, hour: number, hours: number, tuning: Tuning, random: () => number): void {
  if (next.sleep_state === 'sleeping') {
    if (wakesNow(next, at, hour, tuning)) wakeUp(next, at, tuning)
  } else if (next.sleep_state === 'waking') {
    if (at >= next.groggy_until) next.sleep_state = 'awake'
  } else {
    startSleep(next, at, hour, hours, tuning, random)
  }
  next.asleep = next.sleep_state === 'sleeping'
}

// 落在某一段里的进度，零到一
function span(day: number, from: number, to: number): number {
  return clampRange((day - from) / Math.max(1, to - from), 0, 1)
}

// 雌激素按相位走，卵泡期一路爬升，经期与前经期压得最低
function estrogenOf(day: number, phase: CyclePhase, tuning: Tuning): number {
  switch (phase) {
    case '': return tuning.baseline.estrogen
    case 'menstrual': return tuning.cycleEstrogenMenstrual
    case 'follicular': {
      const start = tuning.cycleMenstrualEnd + 1
      const t = span(day, start, tuning.cycleFollicularEnd)
      return tuning.cycleEstrogenFollicularStart + (tuning.cycleEstrogenFollicularEnd - tuning.cycleEstrogenFollicularStart) * t
    }
    case 'ovulation': return tuning.cycleEstrogenOvulation
    case 'luteal': return tuning.cycleEstrogenLuteal
    case 'premenstrual': return tuning.cycleEstrogenPremenstrual
  }
}

// 孕激素在黄体期爬升，经前期维持在高位
function progesteroneOf(day: number, phase: CyclePhase, tuning: Tuning): number {
  switch (phase) {
    case '': return tuning.baseline.progesterone
    case 'menstrual': return tuning.cycleProgesteroneMenstrual
    case 'follicular': return tuning.cycleProgesteroneFollicular
    case 'ovulation': return tuning.cycleProgesteroneOvulation
    case 'luteal': {
      const start = tuning.cycleOvulationEnd + 1
      const t = span(day, start, tuning.cycleLutealEnd)
      return tuning.cycleProgesteroneLutealStart + (tuning.cycleProgesteroneLutealEnd - tuning.cycleProgesteroneLutealStart) * t
    }
    case 'premenstrual': return tuning.cycleProgesteronePremenstrual
  }
}

// 痛经只在经期头几天重，往后一天天松下来，经前期留一点
function crampsOf(day: number, phase: CyclePhase, tuning: Tuning): number {
  if (phase === 'menstrual') {
    const t = span(day, 1, tuning.cycleMenstrualEnd)
    return tuning.cycleCrampsStart + (tuning.cycleCrampsEnd - tuning.cycleCrampsStart) * t
  }
  if (phase === 'premenstrual') return tuning.cycleCrampsPremenstrual
  return 0
}

// 周期：第几天与相位按真实日期差算，三个激素量跟着相位写回
function settleCycle(next: VitalsState, at: number, tuning: Tuning): void {
  const facts = cycleOf(at, tuning)
  next.cycle_dom = cycleAnchorDay(tuning)
  next.cycle_day = facts.day
  next.cycle_len = facts.len
  next.cycle_phase = facts.phase
  next.estrogen = clamp(estrogenOf(facts.day, facts.phase, tuning))
  next.progesterone = clamp(progesteroneOf(facts.day, facts.phase, tuning))
  next.cramps = clamp(crampsOf(facts.day, facts.phase, tuning))
}

// 水队列一次性结算：一小时之后才成尿，结算过就记下时间
function drainFluid(next: VitalsState, at: number, tuning: Tuning): void {
  if (next.fluid_queue <= 0) return
  if (at - next.fluid_applied_at < tuning.fluidDwellMs) return
  next.fluid_queue = 0
  next.fluid_applied_at = at
}

// 情绪回落：怒气、记恨、被哄各按自己的半衰，怕与担心三类各有各的常数
function settleDecay(next: VitalsState, hours: number, tuning: Tuning): void {
  next.anger = clamp(decay(next.anger, hours, tuning.angerHalfHours))
  next.resentment = clamp(decay(next.resentment, hours, tuning.resentmentHalfHours))
  next.soothe = clamp(decay(next.soothe, hours, tuning.sootheHalfHours))
  next.fear = clamp(decay(next.fear, hours, tuning.fearHalfHours))
  next.worry = clamp(decay(next.worry, hours, tuning.worryHalfHours))
  next.dread = clamp(decay(next.dread, hours, tuning.dreadHalfHours))
  next.negative_heat = clamp(decay(next.negative_heat, hours, tuning.negativeHeatHalfHours))
  next.positive_heat = clamp(decay(next.positive_heat, hours, tuning.positiveHeatHalfHours))
}

// 越想越气：已经记着、又被晾着就慢慢涨，夜里涨得更快
function settleResentment(next: VitalsState, at: number, hours: number, night: number, tuning: Tuning): void {
  if (next.resentment <= tuning.resentFrom) return
  if (at - next.last_msg <= tuning.resentIdleHours * 3_600_000) return
  const bump = Math.min(tuning.resentBumpMax, hours * tuning.resentBumpRate)
  next.resentment = clamp(next.resentment + bump * (night >= tuning.nightFullFrom ? tuning.resentNightFactor : 1))
}

// 死亡威胁：有余额档位就朝目标挪一拍，没有来源时一动不动
function settleMortality(next: VitalsState, balance: number | undefined, tuning: Tuning): void {
  if (balance === undefined) return
  const target = mortalityTarget(balance, tuning)
  if (target > next.mortality) {
    next.mortality = clampRange(next.mortality + tuning.mortalityRisePerBeat, 0, target)
    return
  }
  if (target < next.mortality) {
    next.mortality = clampRange(next.mortality - tuning.mortalityFallPerBeat, target, 1)
  }
}

// 情绪结算三件事：先各自回落，再算越想越气，最后夜里独自涨的那一点
function settleMood(next: VitalsState, at: number, hours: number, night: number, tuning: Tuning): void {
  settleDecay(next, hours, tuning)
  settleResentment(next, at, hours, night, tuning)
  next.dread = clamp(next.dread + tuning.dreadNightRise * night * hours)
}

/**
 * 按距上次结算的时长漂移一次
 * @param state - 当前状态
 * @param at - 当前毫秒时间戳
 * @param tuning - 参数
 * @param random - 取零到一的随机源，入睡时刻与抖动都走它，测试可以换成定值
 * @param balance - 外部注入的余额档位，没给表示这一路没有来源，死亡威胁保持不动
 * @returns 漂移后的状态
 */
export function drift(
  state: VitalsState,
  at: number,
  tuning: Tuning,
  random: () => number = Math.random,
  balance?: number,
): VitalsState {
  const hours = clampRange((at - state.last_update) / 3_600_000, 0, tuning.hoursCap)
  const next: VitalsState = { ...state, last_update: at }
  drainFluid(next, at, tuning)
  settleCycle(next, at, tuning)
  if (hours < tuning.minDriftHours) return next
  const hour = localHour(at)
  const night = nightness(hour, tuning)
  settleSleep(next, at, hour, hours, tuning, random)
  settleTransmitters(next, hours, night, hour, tuning)
  const load = settleHpa(next, hours, tuning)
  settleAutonomic(next, hours, night, load, tuning)
  settleReward(next, hours, tuning)
  settleAttachment(next, hours, tuning)
  next.melatonin = clamp(follow(next.melatonin, melatoninTarget(hour, tuning), 0.70, hours))
  settleHunger(next, hours, hour, (at - next.last_meal) / 3_600_000, tuning)
  settleWater(next, hours, hour, tuning)
  settleGlucose(next, hours, tuning)
  settleInner(next, hours, hour, night, tuning)
  settleMortality(next, balance, tuning)
  settleMood(next, at, hours, night, tuning)
  return next
}
