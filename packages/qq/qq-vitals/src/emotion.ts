// 混合层：入选的标签各带一份归一权重、一句来由与自己那条半衰期，只给面板与排障读

import type { Tuning } from './defaults.ts'
import { above } from './math.ts'
import type { EmotionBlend, VitalsState } from './types.ts'

// 来由只认这些字段：漏写一条短语就编译不过
type CauseField =
  | 'dopamine' | 'oxytocin' | 'serotonin' | 'endorphin' | 'positive_heat' | 'acetylcholine' | 'leptin'
  | 'adrenaline' | 'noradrenaline' | 'vasopressin' | 'cortisol' | 'clinginess' | 'negative_heat'
  | 'crh' | 'acth' | 'irritability' | 'ghrelin' | 'melatonin' | 'fear' | 'worry' | 'dread'
  | 'anger' | 'resentment' | 'thirst' | 'angiotensin' | 'cytokines' | 'fever' | 'adenosine'
  | 'pain' | 'cramps' | 'progesterone'

// 一条证据：标签打分里抬起它的那个字段，与那一项的权重
type CauseTerm = readonly [CauseField, number]

// 每个标签的证据就是 src/derive.ts 里那几条打分式里抬分的项：改那边的权重时这边一起改
const CAUSES: Readonly<Record<string, readonly CauseTerm[]>> = {
  幸福: [['dopamine', 0.32], ['oxytocin', 0.25], ['serotonin', 0.22], ['endorphin', 0.16], ['positive_heat', 0.10]],
  开心: [['dopamine', 0.34], ['oxytocin', 0.18], ['serotonin', 0.18], ['endorphin', 0.12]],
  安心: [['acetylcholine', 0.35], ['endorphin', 0.28], ['oxytocin', 0.22], ['serotonin', 0.18]],
  满足: [['endorphin', 0.32], ['acetylcholine', 0.24], ['oxytocin', 0.20], ['leptin', 0.18]],
  心动: [['dopamine', 0.30], ['adrenaline', 0.22], ['oxytocin', 0.20], ['serotonin', 0.13]],
  兴奋: [['dopamine', 0.34], ['adrenaline', 0.28], ['noradrenaline', 0.18]],
  害羞: [['oxytocin', 0.22], ['adrenaline', 0.15]],
  吃醋: [['vasopressin', 0.55], ['oxytocin', 0.25], ['cortisol', 0.20], ['clinginess', 0.15]],
  委屈: [['cortisol', 0.30], ['negative_heat', 0.16]],
  低落: [['cortisol', 0.26]],
  焦虑: [['crh', 0.30], ['acth', 0.28], ['adrenaline', 0.22], ['cortisol', 0.18]],
  惊慌: [['adrenaline', 0.38], ['crh', 0.28], ['acth', 0.18], ['noradrenaline', 0.16]],
  恼火: [['adrenaline', 0.30], ['cortisol', 0.28], ['vasopressin', 0.12]],
  饿怒: [['ghrelin', 0.42], ['irritability', 0.24]],
  困倦: [['melatonin', 0.50], ['acetylcholine', 0.28]],
  想哭: [['cortisol', 0.30], ['negative_heat', 0.18]],
  害怕: [['fear', 0.85], ['adrenaline', 0.18], ['noradrenaline', 0.05]],
  担心: [['worry', 0.80], ['cortisol', 0.14], ['acth', 0.10], ['oxytocin', 0.08]],
  恐惧: [['dread', 0.85], ['cortisol', 0.18], ['vasopressin', 0.12]],
  生气: [['anger', 0.95], ['adrenaline', 0.10]],
  冷战: [['resentment', 0.75]],
  渴: [['thirst', 0.85], ['angiotensin', 0.10]],
  生病: [['cytokines', 0.80], ['fever', 0.30]],
  累坏: [['adenosine', 0.60], ['pain', 0.25]],
  经期: [['cramps', 0.75]],
  经前: [['progesterone', 0.20]],
}

// 一句来由：这个字段在这条标签的打分里抬了分，就说它抬在哪儿
const CAUSE_WHY: Readonly<Record<CauseField, string>> = {
  dopamine: '想要的东西还在眼前',
  oxytocin: '离人很近',
  serotonin: '心里是稳的',
  endorphin: '身上舒服',
  positive_heat: '刚被夸过，还暖着',
  acetylcholine: '身上松下来了',
  leptin: '肚子里是满的',
  adrenaline: '心跳还快着',
  noradrenaline: '人还提着',
  vasopressin: '想把人看住',
  cortisol: '一直绷着',
  clinginess: '很想黏着人',
  negative_heat: '憋着的那股气还没散',
  crh: '压力那一路没停',
  acth: '压力一层层压下来',
  irritability: '心里毛躁',
  ghrelin: '胃里空得叫',
  melatonin: '困意上来了',
  fear: '刚才那一下还在',
  worry: '心悬着放不下来',
  dread: '怕有什么会不见',
  anger: '有股火还没消',
  resentment: '那件事还记着',
  thirst: '嗓子发干',
  angiotensin: '嘴里干得厉害',
  cytokines: '身子在生病',
  fever: '身上发烫',
  adenosine: '睡意压着',
  pain: '身上疼',
  cramps: '小腹坠着',
  progesterone: '身上的周期走到这一段',
}

/** 一条来由：抬分的字段与读得懂的那句话 */
interface Cause {
  /** 这一项落在哪个字段上 */
  field: CauseField
  /** 这个字段在标签打分里抬分的那句话 */
  why: string
}

/**
 * 一条标签的来由：取它打分里贡献最大的那一项，字段与权重都来自那条打分式
 * @param key - 标签名
 * @param state - 当前状态
 * @returns 字段与一句话，标签没有证据表时为 undefined
 */
function causeOf(key: string, state: VitalsState): Cause | undefined {
  const terms = CAUSES[key]
  if (terms === undefined) return undefined
  let best: CauseField | undefined
  let bestScore = 0
  for (const [field, weight] of terms) {
    const score = weight * above(state[field])
    if (score > bestScore) {
      bestScore = score
      best = field
    }
  }
  return best === undefined ? undefined : { field: best, why: CAUSE_WHY[best] }
}

// 半衰期只从标签压的那个量上来：别的字段没有自己那条半衰，回落交给漂移
function halfMinutesOf(field: CauseField, tuning: Tuning): number {
  switch (field) {
    case 'anger': return Math.round(tuning.angerHalfHours * 60)
    case 'resentment': return Math.round(tuning.resentmentHalfHours * 60)
    case 'fear': return Math.round(tuning.fearHalfHours * 60)
    case 'worry': return Math.round(tuning.worryHalfHours * 60)
    case 'dread': return Math.round(tuning.dreadHalfHours * 60)
    case 'negative_heat': return Math.round(tuning.negativeHeatHalfHours * 60)
    case 'positive_heat': return Math.round(tuning.positiveHeatHalfHours * 60)
    default: return 0
  }
}

// 一条混合层：权重归一到一之前先照分数分，来由与半衰期跟着这条标签走
function entryOf(key: string, weight: number, state: VitalsState, tuning: Tuning): EmotionBlend {
  const cause = causeOf(key, state)
  if (cause === undefined) return { key, weight, half_min: 0, why: '' }
  return { key, weight, half_min: halfMinutesOf(cause.field, tuning), why: cause.why }
}

// 一句人读的说明：先是头一条的来由，再说是哪几路掺在一起
function mixWhy(blend: readonly EmotionBlend[]): string {
  const first = blend[0]
  if (first === undefined) return ''
  const rest = blend.slice(1).map(entry => entry.key)
  const mixed = rest.length === 0 ? first.key : `${first.key}里带一点${rest.join('，还有点')}`
  return first.why === '' ? mixed : `${first.why}，${mixed}`
}

/** 混合层与它那句说明 */
export interface EmotionMix {
  /** 按分数从高到低的几条，权重加起来是一 */
  blend: EmotionBlend[]
  /** 读得懂的一句，没有混合层时为空串 */
  why: string
}

/**
 * 算混合层：只读状态，不写回任何字段，也不重复扣生理值
 * @param picked - 这一轮的候选标签与分数，按分数从高到低
 * @param state - 算这批分数用的那份状态
 * @param tuning - 参数
 * @returns 混合层与那句说明
 */
export function mixOf(picked: readonly (readonly [string, number])[], state: VitalsState, tuning: Tuning): EmotionMix {
  const top = picked.slice(0, Math.max(1, tuning.emotionBlendCount))
  const total = top.reduce((sum, [, score]) => sum + above(score), 0)
  if (total <= 0) return { blend: [], why: '' }
  const entries = top.map(([key, score]) => entryOf(key, above(score) / total, state, tuning))
  // 头一条一定留着：都挤掉时面板上还剩一路，它的权重也一定大于零，再归一不会除以零
  const kept = entries.filter((entry, index) => index === 0 || entry.weight >= tuning.emotionBlendWeightFrom)
  const keptTotal = kept.reduce((sum, entry) => sum + entry.weight, 0)
  const blend = kept.map(entry => ({ ...entry, weight: entry.weight / keptTotal }))
  return { blend, why: mixWhy(blend) }
}
