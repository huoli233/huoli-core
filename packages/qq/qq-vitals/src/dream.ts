// 入梦抽签与那一场梦的事实：本模块只产出事实，不写记忆、也不发动态

import { DEFAULTS, type Tuning } from './defaults.ts'
import type { DreamKind, DreamMood, VitalsState } from './types.ts'

/** 一场梦的事实，组合包以后拿它写记忆、发动态 */
export interface DreamFact {
  /** 入梦那一刻的毫秒时间戳 */
  at: number
  /** 这一场是美梦、噩梦还是平淡梦 */
  kind: DreamKind
  /** 梦里的地点，与上一场相同说明又梦到了同一个地方 */
  place: string
  /** 一句梦境文本，发布时原样用它，不加任何解释 */
  text: string
  /** 写记忆时用的重要度，0~1 标度，永远低于 0.7 */
  importance: number
  /** 只有美梦与噩梦为 true：一场梦只发布一次，平淡梦不可发布 */
  publishable: boolean
}

// 一个地点配三句话，抽到哪种梦就说这个地点那一句
interface DreamScript {
  place: string
  sweet: string
  nightmare: string
  plain: string
}

// 梦境素材：只在这里写一份，文案里不出现数字
const ROOFTOP: DreamScript = {
  place: '天台',
  sweet: '她站在天台上收被子，风把布面吹得鼓鼓的，楼下有人喊她回去吃饭。',
  nightmare: '天台那道门怎么也推不开，她拍到手疼，风一直往楼道里灌。',
  plain: '她在天台上收被子，麻绳勒得手有点疼，收完就下楼了。',
}

const CLASSROOM: DreamScript = {
  place: '旧教室',
  sweet: '她坐在旧教室最后一排，光落在课桌上，有人把一颗糖推到她手边。',
  nightmare: '旧教室的灯一排排灭下去，她找不到门，桌椅一直在往后挪。',
  plain: '她在旧教室里擦黑板，粉笔灰落了一袖子，擦完就走了。',
}

const SEASIDE: DreamScript = {
  place: '海边',
  sweet: '她光着脚走在海边，浪一遍遍漫过脚踝，有人替她把鞋拎着。',
  nightmare: '海边涨潮了，她往岸上跑，脚下的沙一直被水抽走。',
  plain: '她坐在海边看水，风有点凉，坐了一会儿就回去了。',
}

const PLACES: readonly DreamScript[] = [ROOFTOP, CLASSROOM, SEASIDE]

// 三档心情各两条概率：先看美梦，再看噩梦，剩下的都算平淡梦
function oddsOf(mood: DreamMood, tuning: Tuning): { sweet: number; nightmare: number } {
  if (mood === 'good') return { sweet: tuning.dreamSweetGood, nightmare: tuning.dreamNightmareGood }
  if (mood === 'bad') return { sweet: tuning.dreamSweetBad, nightmare: tuning.dreamNightmareBad }
  return { sweet: tuning.dreamSweetNormal, nightmare: tuning.dreamNightmareNormal }
}

// 按随机数取一个地点，越界的按最后一个算
function pickScript(random: () => number): DreamScript {
  const index = Math.max(0, Math.min(PLACES.length - 1, Math.floor(random() * PLACES.length)))
  return PLACES[index] ?? ROOFTOP
}

// 同一个地点按类型给一句，三种梦说的不是一回事
function textOf(script: DreamScript, kind: DreamKind): string {
  if (kind === 'sweet') return script.sweet
  if (kind === 'nightmare') return script.nightmare
  return script.plain
}

// 重要度：又梦到同一个地方压过类型本身，其余按这一场是什么梦算
function importanceOf(kind: DreamKind, repeat: boolean, tuning: Tuning): number {
  if (repeat) return tuning.dreamImportancePlace
  if (kind === 'sweet') return tuning.dreamImportanceSweet
  if (kind === 'nightmare') return tuning.dreamImportanceNightmare
  return tuning.dreamImportancePlain
}

/**
 * 入梦时的心情三档：好坏偏低或想哭偏重算差，好坏偏高且不难受算不错，其余算正常
 * @param state - 入梦时的状态，心情从派生量读
 * @param tuning - 参数，四条判据都在里面
 * @returns 心情档位
 */
export function dreamMoodOf(state: VitalsState, tuning: Tuning = DEFAULTS): DreamMood {
  if (state.valence < tuning.dreamMoodLowBelow || state.sadness > tuning.dreamMoodSadAbove) return 'bad'
  if (state.valence > tuning.dreamMoodGoodAbove && state.sadness < tuning.dreamMoodSadBelow) return 'good'
  return 'normal'
}

/**
 * 按心情三档抽这一场梦的类型，两条概率都进参数，抽签源可注入
 * @param mood - 入梦时的心情档位
 * @param random - 取零到一的随机源，默认 Math.random
 * @param tuning - 参数，六条概率在里面
 * @returns 这一场是什么梦
 */
export function drawDream(
  mood: DreamMood,
  random: () => number = Math.random,
  tuning: Tuning = DEFAULTS,
): DreamKind {
  const odds = oddsOf(mood, tuning)
  const roll = random()
  if (roll < odds.sweet) return 'sweet'
  if (roll < odds.sweet + odds.nightmare) return 'nightmare'
  return 'plain'
}

/**
 * 入梦：抽一个类型与一个地点记进状态，等写盘那一下才成事实
 * @param next - 就地改写的状态，心情从它读
 * @param at - 入梦那一刻的毫秒时间戳
 * @param random - 取零到一的随机源
 * @param tuning - 参数
 */
export function startDream(next: VitalsState, at: number, random: () => number, tuning: Tuning): void {
  const kind = drawDream(dreamMoodOf(next, tuning), random, tuning)
  const script = pickScript(random)
  next.dream_at = at
  next.dream_kind = kind
  next.dream_repeat = next.dream_place === script.place
  next.dream_place = script.place
}

/**
 * 这一场梦的事实：没入过梦、或者这一场已经产过时为 undefined
 * @param state - 当前状态，入梦那一刻的四个字段都从它读
 * @param tuning - 参数，重要度在里面
 * @returns 这一场梦的事实，已经产过时为 undefined
 */
export function dreamFactOf(state: VitalsState, tuning: Tuning = DEFAULTS): DreamFact | undefined {
  if (state.dream_at <= 0 || state.dream_kind === '') return undefined
  if (state.dream_applied_at === state.dream_at) return undefined
  const script = PLACES.find(entry => entry.place === state.dream_place) ?? ROOFTOP
  return {
    at: state.dream_at,
    kind: state.dream_kind,
    place: script.place,
    text: textOf(script, state.dream_kind),
    importance: importanceOf(state.dream_kind, state.dream_repeat, tuning),
    publishable: state.dream_kind !== 'plain',
  }
}
