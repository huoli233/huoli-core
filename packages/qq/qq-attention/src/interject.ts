// 插话事实只交给模型判断，不在代码里决定该不该说

/** 该不该开口的结论保留给调用方解释，不替模型下结论 */
export type SpeakVerdict =
  | { speak: true; why: 'addressed' | 'private' | 'cold' }
  | { speak: false; why: 'silenced' | 'cooldown' | 'crowded' | 'notAddressed' | 'tired' }

/** 什么时候闭嘴的结论保留给调用方解释，不替模型下结论 */
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
  ambient: { humanCount: number; speakerCount: number; lastHumanAgeMs: number | null; speakingRate: number }
  /** 累到什么程度 */
  fatigueLevel: number
  /** 她上次开口离现在多久，没说过给 null */
  sinceSelfSpokeMs: number | null
  /** 当前自适应话痨度，零到一；没给按中间值 */
  talkativeness?: number
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

/** 观察窗口只由配置给 */
export interface InterjectTuning {
  /** 看多久内的消息 */
  activeWindowMs: number
}

/** 插话那组默认值 */
export const INTERJECT_DEFAULTS: InterjectTuning = {
  activeWindowMs: 10 * 60_000,
}

/**
 * 把现场写成一行可观察事实
 * @param facts - 现场
 * @returns 只陈述事实的一段中文
 */
export function renderSpeakFacts(facts: SpeakFacts): string {
  const parts = [
    facts.directed.isPrivate ? '这是一对一的对话' : '',
    facts.directed.at ? '这几条在叫你' : '',
    facts.directed.poke ? '有人在戳你' : '',
    facts.directed.replyToBot ? '有人在回你刚说过的话' : '',
    facts.named ? '文本里出现名字' : '',
    facts.ambient.humanCount > 0 ? `最近一段有 ${facts.ambient.humanCount} 条真人发言，来自 ${facts.ambient.speakerCount} 个人` : '',
    facts.ambient.lastHumanAgeMs === null ? '' : `上一条真人发言是 ${Math.round(facts.ambient.lastHumanAgeMs / 60_000)} 分钟前`,
    `现场每分钟约 ${Math.round(facts.ambient.speakingRate)} 条消息`,
    `身体累的程度是 ${Math.round(facts.fatigueLevel * 100)} 分`,
    facts.sinceSelfSpokeMs === null ? '你还没在这里成功发过言' : `你上次成功发言是 ${Math.round(facts.sinceSelfSpokeMs / 60_000)} 分钟前`,
    `你最近的说话倾向是 ${Math.round((facts.talkativeness ?? 0.5) * 100)} 分`,
    facts.silenced ? '对方明确表示要安静' : '',
  ].filter(part => part !== '')
  return `【插话现场】\n${parts.join('\n')}\nRULE: decide_with_scene_and_own_judgment`
}

/**
 * 把这一轮说到哪了写成一行可观察事实
 * @param facts - 这一轮说到哪了
 * @returns 只陈述事实的一段中文
 */
export function renderStopFacts(facts: StopFacts): string {
  const parts = [
    `这一轮已经说了 ${facts.spoken} 条，上限是 ${facts.budget} 条`,
    `连着 ${facts.ignoredStreak} 条没等到人接`,
    `场面紧的程度是 ${Math.round(facts.tension * 100)} 分`,
    facts.silenced ? '对方明确表示要安静' : '',
  ].filter(part => part !== '')
  return `【收尾现场】\n${parts.join('\n')}\nRULE: decide_with_scene_and_own_judgment`
}
