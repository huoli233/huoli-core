// 两个判断：这一轮该不该开口，开口之后什么时候闭嘴

/** 该不该开口的结论 */
export type SpeakVerdict =
  | { speak: true; why: 'addressed' | 'private' | 'cold' }
  | { speak: false; why: 'silenced' | 'cooldown' | 'crowded' | 'notAddressed' | 'tired' }

/** 什么时候闭嘴的结论 */
export type StopVerdict =
  | { stop: true; why: 'silenced' | 'budget' | 'ignored' | 'tense' }
  | { stop: false }

/** 判一次要看的现场 */
export interface SpeakFacts {
  /** 有没有人直接对着她说话 */
  directed: { at: boolean; poke: boolean; isPrivate: boolean; replyToBot: boolean }
  /** 有没有点名 */
  named: boolean
  /** 场面：几个人、上一条隔了多久、每分钟多少条 */
  ambient: { humanCount: number; lastHumanAgeMs: number | null; speakingRate: number }
  /** 累到什么程度 */
  fatigueLevel: number
  /** 她上次开口离现在多久，没说过给 null */
  sinceSelfSpokeMs: number | null
  /** 对方是不是明确要她别说话 */
  silenced: boolean
}

/** 判闭嘴要看的现场 */
export interface StopFacts {
  /** 这一轮已经说了几条 */
  spoken: number
  /** 这一轮上限 */
  budget: number
  /** 连着几条没人接她 */
  ignoredStreak: number
  /** 场面有多紧，零到一 */
  tension: number
  /** 对方是不是明确要她别说话 */
  silenced: boolean
}

/** 这两个判断的门槛，全部可配 */
export interface InterjectTuning {
  /** 她说过一句之后多久内不再主动开口 */
  cooldownMs: number
  /** 每分钟到多少条就算场面太密 */
  crowdedRate: number
  /** 累到这条线就不开口 */
  tiredAt: number
  /** 冷场多久她可以自己开一句 */
  coldAfterMs: number
  /** 连着几条没人接就停 */
  ignoredAfter: number
  /** 场面紧到这条线就停 */
  tenseAt: number
}

/** 插话那组默认值 */
export const INTERJECT_DEFAULTS: InterjectTuning = {
  // 说过一句之后一分钟内不主动再开
  cooldownMs: 60_000,
  // 一分钟六条以上算密，让给别人
  crowdedRate: 6,
  // 累到七成就不主动开口
  tiredAt: 0.7,
  // 冷场十分钟她可以开一句
  coldAfterMs: 10 * 60_000,
  // 连着两条没人接就停
  ignoredAfter: 2,
  // 场面紧到七成先停
  tenseAt: 0.7,
}

/**
 * 这一轮该不该开口
 * @param facts - 现场
 * @param tuning - 门槛
 * @returns 结论与理由
 */
export function shouldSpeak(facts: SpeakFacts, tuning: InterjectTuning = INTERJECT_DEFAULTS): SpeakVerdict {
  // 人家明确要她别说，那就不说，别的条件一概不看
  if (facts.silenced) return { speak: false, why: 'silenced' }
  if (facts.directed.isPrivate) return { speak: true, why: 'private' }
  if (facts.directed.at || facts.directed.poke || facts.directed.replyToBot) return { speak: true, why: 'addressed' }
  if (facts.fatigueLevel >= tuning.tiredAt) return { speak: false, why: 'tired' }
  if (facts.sinceSelfSpokeMs !== null && facts.sinceSelfSpokeMs < tuning.cooldownMs) {
    return { speak: false, why: 'cooldown' }
  }
  // 点名但没直接对着她说：算搭话的门槛，仍受冷却与场面约束
  if (facts.named) return { speak: true, why: 'addressed' }
  if (facts.ambient.speakingRate >= tuning.crowdedRate) return { speak: false, why: 'crowded' }
  if (facts.ambient.lastHumanAgeMs !== null && facts.ambient.lastHumanAgeMs >= tuning.coldAfterMs) {
    return { speak: true, why: 'cold' }
  }
  return { speak: false, why: 'notAddressed' }
}

/**
 * 开口之后什么时候闭嘴
 * @param facts - 这一轮说到哪了
 * @param tuning - 门槛
 * @returns 结论与理由
 */
export function shouldStop(facts: StopFacts, tuning: InterjectTuning = INTERJECT_DEFAULTS): StopVerdict {
  if (facts.silenced) return { stop: true, why: 'silenced' }
  if (facts.spoken >= facts.budget) return { stop: true, why: 'budget' }
  if (facts.ignoredStreak >= tuning.ignoredAfter) return { stop: true, why: 'ignored' }
  if (facts.tension >= tuning.tenseAt) return { stop: true, why: 'tense' }
  return { stop: false }
}
