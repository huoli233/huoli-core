// 按小时漂移：递质往基线回，口渴这类存量直接累积

import type { Tuning } from './defaults.ts'
import {
  cycleAnchorDay, cycleOf, inNapWindow, inSleepWindow, isDaytime, isMealHour, isQuietHour, localHour,
  localPoint, melatoninTarget, nightness, nightWakeAt, noradrenalineBaseline,
} from './clock.ts'
import { above, clamp, clampRange, decay, follow } from './math.ts'
import type { CyclePhase, VitalsState } from './types.ts'

// 递质回基线：皮质醇不在这里，它只由 HPA 轴管
function settleTransmitters(next: VitalsState, hours: number, night: number, hour: number): void {
  const halfLife = night >= 0.6 ? 0.45 : 0.75
  const naBase = noradrenalineBaseline(hour)
  next.dopamine = clamp(follow(next.dopamine, 0.50 - 0.16 * night, halfLife, hours))
  next.oxytocin = clamp(follow(next.oxytocin, 0.45 + 0.04 * night, halfLife, hours))
  next.serotonin = clamp(follow(next.serotonin, 0.65 - 0.12 * night, halfLife, hours))
  next.noradrenaline = clamp(follow(next.noradrenaline, naBase - 0.10 * night, halfLife, hours))
}

// HPA 轴：慢，被催产素缓冲；返回这一轮的负荷，交感也用它
function settleHpa(next: VitalsState, hours: number): number {
  const lowGlucose = above((0.62 - next.glucose) / 0.62)
  const highHunger = above((next.hunger - 0.50) / 0.50)
  const load = clamp(0.55 * next.cortisol + 0.25 * lowGlucose + 0.20 * highHunger)
  const feedback = 1 - 0.70 * clamp((next.cortisol - 0.55) / 0.45)
  next.crh = clamp(follow(next.crh, clamp(load * feedback), 0.15, hours))
  next.acth = clamp(follow(next.acth, next.crh, 0.45, hours))
  const buffer = 1 - 0.35 * clamp((next.oxytocin - 0.40) / 0.60)
  next.cortisol = clamp(follow(next.cortisol, clamp(0.15 + 0.80 * next.acth) * buffer, 1.20, hours))
  return load
}

// 交感与副交感
function settleAutonomic(next: VitalsState, hours: number, night: number, load: number): void {
  next.adrenaline = clamp(follow(next.adrenaline, clamp(0.05 + 0.85 * load), 0.06, hours))
  const paraTarget = clamp(0.22 + 0.35 * (1 - next.adrenaline) + 0.22 * next.leptin + 0.18 * night)
  next.acetylcholine = clamp(follow(next.acetylcholine, paraTarget, 0.55, hours))
}

// 奖赏双系统
function settleReward(next: VitalsState, hours: number): void {
  const want = clamp(0.70 * next.dopamine + 0.30 * next.oxytocin - 0.25 * next.cortisol)
  next.endorphin = clamp(follow(next.endorphin, clamp(0.20 + 0.65 * want), 0.80, hours))
}

// 依恋：渴了更想抓住人
function settleAttachment(next: VitalsState, hours: number): void {
  const target = clamp(0.16 + 0.58 * next.clinginess + 0.35 * next.cortisol + 0.25 * above(next.osmolality - 0.40))
  next.vasopressin = clamp(follow(next.vasopressin, target, 1.5, hours))
}

// 胃排空加三餐节律
function settleHunger(next: VitalsState, hours: number, hour: number, meal: number): void {
  let rate = 0.055
  if (meal < 1.5) rate *= 0.35
  else if (meal < 3.0) rate *= 0.70
  else if (meal > 6.0) rate *= 1.15
  if (isMealHour(hour)) rate *= 1.30
  rate *= Math.max(0.25, 1 - 0.75 * next.hunger)
  if (isQuietHour(hour)) rate *= 0.25
  next.hunger = clamp(next.hunger + hours * rate)
}

// 水循环：口渴是累积量，不许写成向目标平滑
function settleWater(next: VitalsState, hours: number, hour: number, tuning: Tuning): void {
  let activity = 1.0
  activity += 0.25 * above(next.noradrenaline - 0.50)
  activity += 0.15 * above(next.adrenaline - 0.25)
  let loss = 0.070 * hours * (isQuietHour(hour) ? 0.30 : 1.0) * activity
  loss *= clampRange(tuning.metabolicRate, 0.75, 1.7)
  next.osmolality = clamp(next.osmolality + loss * 0.55)
  next.blood_volume = clamp(next.blood_volume - loss * 0.40)
  const angiotensinTarget = clamp(0.10 + 0.85 * above((0.85 - next.blood_volume) / 0.45))
  next.angiotensin = clamp(follow(next.angiotensin, angiotensinTarget, 0.70, hours))
  next.thirst = clamp(next.thirst + loss * 0.60 + 0.05 * above(next.angiotensin - 0.35))
}

// 血糖双向调节：只升不降会一路不回落
function settleGlucose(next: VitalsState, hours: number): void {
  const insulinTarget = clamp(0.08 + 0.95 * above((next.glucose - 0.62) / 0.30))
  next.insulin = clamp(follow(next.insulin, insulinTarget, 0.35, hours))
  const glucagonTarget = clamp(0.08 + 0.95 * above((0.60 - next.glucose) / 0.30))
  next.glucagon = clamp(follow(next.glucagon, glucagonTarget, 0.55, hours))
  const span = Math.min(1.0, hours)
  const rise = 0.010 + 0.03 * above(next.hunger - 0.60) + 0.10 * next.glucagon - 0.28 * next.insulin
  next.glucose = clamp(next.glucose + rise * span)
}

// 睡眠压力、体温、免疫、疼痛
function settleInner(next: VitalsState, hours: number, hour: number, night: number, tuning: Tuning): void {
  next.adenosine = clamp(next.adenosine + adenosineStep(next, hours, hour, tuning))
  next.cytokines = clamp(decay(next.cytokines, hours, 36))
  next.fever = clamp(follow(next.fever, clamp(next.cytokines * 0.85), 1.0, hours))
  next.core_temp = Math.round((36.55 - 0.30 * night + 1.60 * next.fever) * 100) / 100
  next.pain = clamp(decay(next.pain, Math.min(24, hours), 0.5))
}

// 醒着继续累积，睡着按睡的速率回血；午睡回得更快
function adenosineStep(next: VitalsState, hours: number, hour: number, tuning: Tuning): number {
  if (next.sleep_state === 'sleeping') {
    const drop = next.sleep_kind === 'nap' ? tuning.napAdenosineDrop : tuning.sleepAdenosineDrop
    return -drop * hours
  }
  return (isQuietHour(hour) ? 0.020 : 0.042) * hours
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

/**
 * 按距上次结算的时长漂移一次
 * @param state - 当前状态
 * @param at - 当前毫秒时间戳
 * @param tuning - 参数
 * @param random - 取零到一的随机源，入睡时刻与抖动都走它，测试可以换成定值
 * @returns 漂移后的状态
 */
export function drift(state: VitalsState, at: number, tuning: Tuning, random: () => number = Math.random): VitalsState {
  const hours = clampRange((at - state.last_update) / 3_600_000, 0, tuning.hoursCap)
  const next: VitalsState = { ...state, last_update: at }
  drainFluid(next, at, tuning)
  settleCycle(next, at, tuning)
  if (hours < tuning.minDriftHours) return next
  const hour = localHour(at)
  const night = nightness(hour, tuning)
  settleSleep(next, at, hour, hours, tuning, random)
  settleTransmitters(next, hours, night, hour)
  const load = settleHpa(next, hours)
  settleAutonomic(next, hours, night, load)
  settleReward(next, hours)
  settleAttachment(next, hours)
  next.melatonin = clamp(follow(next.melatonin, melatoninTarget(hour, tuning), 0.70, hours))
  settleHunger(next, hours, hour, (at - next.last_meal) / 3_600_000)
  settleWater(next, hours, hour, tuning)
  settleGlucose(next, hours)
  settleInner(next, hours, hour, night, tuning)
  return next
}
