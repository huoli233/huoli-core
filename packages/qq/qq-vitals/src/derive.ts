// 十个派生量加常用标签：派生量只算一次，别处只读

import { biasUnit, type Tuning } from './defaults.ts'
import { above, clamp, clampRange } from './math.ts'
import { deltaOf, propagate, type NetworkPass } from './network.ts'
import type { CyclePhase, VitalsState } from './types.ts'

// 相位命中其一就给一，其余给零
function phaseHit(state: VitalsState, phases: readonly CyclePhase[]): number {
  return phases.includes(state.cycle_phase) ? 1 : 0
}

// 皮质醇压精力这一条走图，关掉图按冻结的旧系数算，改边不动它
function cortisolToEnergy(s: VitalsState, net: NetworkPass | undefined): number {
  return net === undefined ? -0.14 * s.cortisol : deltaOf(net, 'energy')
}

// 精力：递质抬，皮质醇、褪黑素、口渴、睡眠压力、生病、痛经往下压
function energyOf(s: VitalsState, tuning: Tuning, net: NetworkPass | undefined): number {
  return clamp(
    0.20 + 0.50 * s.noradrenaline + 0.25 * s.adrenaline + 0.10 * s.dopamine + 0.08 * s.acetylcholine
    + cortisolToEnergy(s, net) - 0.45 * s.melatonin
    // 待迁：口渴带 0.40 阈值，图里只有线性边
    - 0.10 * above(s.thirst - 0.40) - 0.22 * above(s.adenosine - 0.45)
    - 0.20 * s.fever - 0.16 * s.cytokines - 0.15 * s.pain
    - tuning.energyCrampsPenalty * s.cramps
    - tuning.energyLutealPenalty * phaseHit(s, ['luteal', 'premenstrual']),
  )
}

// 好坏偏向：稳定、满足往上，压力、身体不适与经期前后往下
function valenceOf(s: VitalsState, tuning: Tuning): number {
  return clamp(
    0.12 + 0.30 * (s.dopamine - 0.5) + 0.22 * (s.serotonin - 0.65)
    - 0.28 * (s.cortisol - 0.2) + 0.12 * (s.endorphin - 0.4)
    - 0.10 * above(s.adrenaline - 0.2) - 0.05 * above(s.crh - 0.3)
    + 0.04 * (s.acetylcholine - 0.45)
    - 0.06 * above(s.thirst - 0.60)
    - 0.14 * s.fever - 0.10 * s.cytokines - 0.08 * s.pain
    - 0.18 * s.dread - 0.08 * s.worry - 0.15 * s.anger
    - tuning.valenceMenstrualPenalty * phaseHit(s, ['menstrual'])
    - tuning.valencePremenstrualPenalty * phaseHit(s, ['premenstrual'])
    + tuning.valenceFollicularGain * phaseHit(s, ['follicular']),
  )
}

// 皮质醇推易怒这一条走图，关掉图按冻结的旧系数算，改边不动它
function cortisolToIrritability(s: VitalsState, net: NetworkPass | undefined): number {
  return net === undefined ? 0.9 * s.cortisol : deltaOf(net, 'irritability')
}

// 易怒：压力、低血糖、渴、睡不够、疼、体温高、经期前后都往里加；皮质醇那条原来的 0.2 起点并进了常数
function irritabilityOf(s: VitalsState, tuning: Tuning, net: NetworkPass | undefined): number {
  return clamp(
    -0.10 + cortisolToIrritability(s, net) - 0.2 * (s.serotonin - 0.65)
    + 0.30 * above((0.35 - s.glucose) / 0.35)
    + 0.15 * above(s.vasopressin - 0.50)
    + 0.18 * above(s.adrenaline - 0.35)
    + 0.30 * above(s.thirst - 0.55)
    + 0.32 * above(s.adenosine - 0.55)
    + 0.45 * s.anger
    + 0.25 * s.pain
    + 0.20 * above(s.core_temp - 37.2)
    + tuning.irritabilityPremenstrualGain * phaseHit(s, ['premenstrual'])
    + tuning.irritabilityMenstrualGain * phaseHit(s, ['menstrual'])
    + tuning.irritabilityCrampsGain * s.cramps,
  )
}

// 黏人：亲近与舒服往上推
function clinginessOf(s: VitalsState): number {
  return clamp(0.2 + 0.75 * (s.oxytocin - 0.3) + 0.15 * (s.endorphin - 0.4))
}

// 孤独：亲近少、压力大、占有欲强都会更空，记着仇也算空
function lonelinessOf(s: VitalsState): number {
  return clamp(
    0.15 + 0.7 * (s.oxytocin - 0.35) + 0.2 * (s.cortisol - 0.2)
    + 0.15 * above(s.vasopressin - 0.40) - 0.10 * above(s.endorphin - 0.55)
    + 0.10 * s.resentment,
  )
}

// 掌控：想要多、稳定多就高，压力往下压，可以到负数
function dominanceOf(s: VitalsState): number {
  return clampRange(0.5 + 0.35 * (s.dopamine - 0.5) - 0.3 * (s.cortisol - 0.2) + 0.2 * (s.serotonin - 0.65), -1, 1)
}

// 幸福：想要、亲近、稳定、满足一起抬，压力与急性应激往下压，正面热度再补一点
function joyScore(s: VitalsState): number {
  return 0.32 * s.dopamine + 0.25 * s.oxytocin + 0.22 * s.serotonin + 0.16 * s.endorphin
    - 0.28 * s.cortisol - 0.15 * s.adrenaline + 0.10 * s.positive_heat
}

// 想哭：稳定少、压力大、亲近少都往下沉，负面热度再压一把
function sorrowScore(s: VitalsState): number {
  return 0.34 * (1 - s.serotonin) + 0.30 * s.cortisol + 0.18 * (1 - s.oxytocin)
    + 0.18 * s.negative_heat - 0.15 * s.endorphin
}

// 想开口：没力气、犯困、想有人陪、口渴、生病、睡不够各乘一条，命中就乘，不命中的算一
function biasFactors(s: VitalsState, tuning: Tuning): number[] {
  const wantsCompany = s.loneliness > tuning.biasLonelyAbove || s.clinginess > tuning.biasClingyAbove
  return [
    s.energy < tuning.biasLowEnergyBelow ? tuning.biasLowEnergy : 1,
    s.melatonin > tuning.biasSleepyAbove ? tuning.biasSleepy : 1,
    wantsCompany ? tuning.biasWantsCompany : 1,
    s.irritability > tuning.biasIrritableAbove ? tuning.biasIrritable : 1,
    s.thirst > tuning.biasThirstyAbove ? tuning.biasThirsty : 1,
    s.cytokines > tuning.biasSickAbove ? tuning.biasSick : 1,
    s.adenosine > tuning.biasExhaustedAbove ? tuning.biasExhausted : 1,
  ]
}

// 想开口的劲：倍率夹到上下限之间，再折成零到一的读数
function proactiveBiasOf(s: VitalsState, tuning: Tuning): number {
  const bias = biasFactors(s, tuning).reduce((product, factor) => product * factor, tuning.proactiveBiasStart)
  return biasUnit(clampRange(bias, tuning.biasMin, tuning.biasMax), tuning)
}

// 想发动态的劲：心里有火就缩，孤独就涨一点，最后夹到零到一；待迁：这两条是倍率不是加法，图里表达不了
function postWantOf(s: VitalsState, tuning: Tuning): number {
  const down = s.irritability > tuning.postDownAbove ? tuning.postDown : 1
  const up = s.loneliness > tuning.postWantsAbove ? tuning.postWants : 1
  return clamp(tuning.postStart * down * up)
}

// 二十六个标签，每个都是多系统加权
function labelScores(s: VitalsState, tuning: Tuning): Map<string, number> {
  const scores = new Map<string, number>()
  scores.set('幸福', joyScore(s))
  scores.set('开心', 0.34 * s.dopamine + 0.18 * s.oxytocin + 0.18 * s.serotonin + 0.12 * s.endorphin
    - 0.16 * s.cortisol - 0.10 * s.adrenaline)
  scores.set('安心', 0.35 * s.acetylcholine + 0.28 * s.endorphin + 0.22 * s.oxytocin + 0.18 * s.serotonin
    - 0.28 * s.cortisol - 0.18 * s.adrenaline)
  scores.set('满足', 0.32 * s.endorphin + 0.24 * s.acetylcholine + 0.20 * s.oxytocin + 0.18 * s.leptin
    - 0.20 * s.cortisol)
  scores.set('心动', 0.30 * s.dopamine + 0.22 * s.adrenaline + 0.20 * s.oxytocin + 0.13 * s.serotonin
    - 0.12 * s.cortisol)
  scores.set('兴奋', 0.34 * s.dopamine + 0.28 * s.adrenaline + 0.18 * s.noradrenaline - 0.12 * s.cortisol)
  scores.set('害羞', 0.32 * (1 - s.dominance) + 0.22 * s.oxytocin + 0.15 * s.adrenaline + 0.10 * (1 - s.dopamine))
  scores.set('吃醋', 0.55 * above(s.vasopressin - 0.45) + 0.25 * s.oxytocin + 0.20 * s.cortisol
    - 0.15 * s.serotonin + 0.15 * s.clinginess)
  scores.set('委屈', 0.30 * above(s.cortisol - 0.30) + 0.25 * (1 - s.dominance) + 0.18 * (1 - s.oxytocin)
    + 0.16 * s.negative_heat - 0.10 * s.dopamine)
  scores.set('低落', 0.32 * (1 - s.serotonin) + 0.26 * s.cortisol + 0.18 * (1 - s.oxytocin) - 0.18 * s.dopamine)
  scores.set('焦虑', 0.30 * s.crh + 0.28 * s.acth + 0.22 * s.adrenaline + 0.18 * s.cortisol
    + 0.18 * (1 - s.serotonin) - 0.12 * s.acetylcholine)
  scores.set('惊慌', 0.38 * s.adrenaline + 0.28 * s.crh + 0.18 * s.acth + 0.16 * s.noradrenaline
    - 0.15 * s.acetylcholine)
  scores.set('恼火', 0.30 * s.adrenaline + 0.28 * s.cortisol + 0.24 * (1 - s.serotonin)
    + 0.12 * above(s.vasopressin - 0.50) - 0.12 * s.acetylcholine)
  scores.set('饿怒', 0.42 * above(s.ghrelin - 0.45) + 0.38 * above((0.42 - s.glucose) / 0.42)
    + 0.24 * s.irritability - 0.10 * s.acetylcholine)
  scores.set('困倦', 0.50 * s.melatonin + 0.28 * s.acetylcholine + 0.20 * (1 - s.energy) - 0.15 * s.adrenaline)
  scores.set('想哭', sorrowScore(s))
  scores.set('害怕', 0.85 * s.fear + 0.18 * s.adrenaline + 0.10 * (1 - s.serotonin) + 0.05 * s.noradrenaline)
  scores.set('担心', 0.80 * s.worry + 0.14 * s.cortisol + 0.10 * s.acth + 0.08 * s.oxytocin
    - 0.08 * s.acetylcholine)
  scores.set('恐惧', 0.85 * s.dread + 0.18 * (s.cortisol - 0.20) + 0.12 * above(s.vasopressin - 0.40)
    - 0.06 * s.serotonin)
  scores.set('生气', 0.95 * s.anger + 0.10 * s.adrenaline)
  scores.set('冷战', 0.75 * s.resentment - 0.35 * s.anger)
  scores.set('渴', 0.85 * above(s.thirst - 0.25) + 0.10 * s.angiotensin)
  scores.set('生病', 0.80 * s.cytokines + 0.30 * s.fever)
  scores.set('累坏', 0.60 * above(s.adenosine - 0.45) + 0.25 * s.pain - 0.10 * s.endorphin)
  scores.set('经期', 0.75 * s.cramps + 0.30 * phaseHit(s, ['menstrual']))
  scores.set('经前', 0.60 * phaseHit(s, ['premenstrual']) + 0.20 * s.progesterone)
  suppress(scores, s, tuning)
  return scores
}

// 反向压制：不压的话永远是“幸福、安心”，怕、担心、火气、缺水、生病各自压低对面；待迁：这些是乘数，图里只有加分
function suppress(scores: Map<string, number>, s: VitalsState, tuning: Tuning): void {
  const scale = (name: string, factor: number): void => {
    const current = scores.get(name)
    if (current !== undefined) scores.set(name, current * factor)
  }
  const boost = (name: string, amount: number): void => {
    const current = scores.get(name)
    if (current !== undefined) scores.set(name, current + amount)
  }
  if (s.fear > tuning.suppressFearFrom) {
    scale('安心', tuning.suppressFearCalm)
    scale('幸福', tuning.suppressFearJoy)
  }
  if (s.worry > tuning.suppressWorryFrom) {
    scale('安心', 1 - tuning.suppressWorryCalm * s.worry)
    scale('开心', 1 - tuning.suppressWorryHappy * s.worry)
    scale('幸福', 1 - tuning.suppressWorryJoy * s.worry)
  }
  if (s.dread > tuning.suppressDreadFrom) {
    scale('安心', tuning.suppressDreadCalm)
    scale('幸福', tuning.suppressDreadJoy)
  }
  if (s.anger > tuning.suppressAngerFrom) {
    scale('安心', 1 - tuning.suppressAngerCalm * s.anger)
    scale('满足', 1 - tuning.suppressAngerContent * s.anger)
  }
  if (s.thirst > tuning.suppressThirstFrom) {
    scale('安心', 1 - tuning.suppressThirstCalm * s.thirst)
    scale('满足', 1 - tuning.suppressThirstContent * s.thirst)
  }
  if (s.cytokines > tuning.suppressSickCytokinesFrom || s.fever > tuning.suppressSickFeverFrom) {
    scale('安心', tuning.suppressSickCalm)
    scale('幸福', tuning.suppressSickJoy)
  }
  if (s.mortality > tuning.suppressMortalityFrom) {
    boost('恐惧', tuning.suppressMortalityDread * s.mortality)
    boost('害怕', tuning.suppressMortalityFear * s.mortality)
    scale('安心', 1 - tuning.suppressMortalityCalm * s.mortality)
    scale('幸福', 1 - tuning.suppressMortalityJoy * s.mortality)
  }
  if (s.mortalitySalience > tuning.suppressSalienceFrom) {
    scale('安心', 1 - tuning.suppressSalienceCalm * s.mortalitySalience)
    scale('满足', 1 - tuning.suppressSalienceContent * s.mortalitySalience)
  }
}

/**
 * 算派生量与标签，写回状态
 * @param state - 当前状态
 * @param tuning - 参数
 * @returns 带派生量的状态
 */
export function derive(state: VitalsState, tuning: Tuning): VitalsState {
  const next: VitalsState = { ...state }
  const net = tuning.networkEnabled ? propagate(state, tuning, tuning.networkSteps) : undefined
  // 怕关掉这件事给存在性恐惧与惊吓托个底：只往上托，托到多少由系数定，封顶仍是一
  next.dread = clamp(Math.max(next.dread, tuning.shutdownToDread * state.shutdownDread))
  next.fear = clamp(Math.max(next.fear, tuning.shutdownToFear * state.shutdownDread))
  next.energy = energyOf(state, tuning, net)
  next.valence = valenceOf(state, tuning)
  next.irritability = irritabilityOf(state, tuning, net)
  next.clinginess = clinginessOf(state)
  next.loneliness = lonelinessOf(state)
  next.dominance = dominanceOf(state)
  next.happiness = clamp(joyScore(state))
  next.sadness = clamp(sorrowScore(state))
  next.proactive_bias = proactiveBiasOf(next, tuning)
  next.post_want = postWantOf(next, tuning)
  const ranked = [...labelScores(next, tuning)]
    .filter(entry => entry[1] > tuning.labelThreshold)
    .sort((left, right) => right[1] - left[1])
    .slice(0, Math.max(1, tuning.labelCount))
    .map(entry => entry[0])
  next.emotion_candidates = ranked
  next.emotion_level = ranked[0] ?? '平静'
  return next
}
