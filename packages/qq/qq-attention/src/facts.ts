// 注意力事实只写进提示词，不替模型决定要不要行动

import type { AttentionSignals } from './select.ts'
import type { WakeTriggers } from './types.ts'

/** 当前唤醒偏好，缺项按没设过处理 */
export interface WakePreference {
  wakeMode?: 'infinite' | 'timed'
  wakeUntil?: number | null
  triggers?: WakeTriggers
}

/** 我现在的情绪档位，只当事实说给模型，不改候选次序也不改打分 */
export interface AttentionEmotion {
  /** 档位：峰值、偏高、轻微或平静 */
  tier: 'peak' | 'high' | 'mild' | 'calm'
  /** 中文说法，例如「有点上火」 */
  label: string
}

/** 渲染一段事实要用的东西 */
export interface AttentionFactsInput {
  signals: AttentionSignals
  wake?: WakePreference
  talkativeness?: number
  lastSelfSpokeAt?: number
  selfTalkStreak?: number
  /** 此刻的情绪档位，没接上身体或关掉这一路时为空 */
  emotion?: AttentionEmotion
  now?: number
}

/** 档位换成一句程度词，平静时不加 */
const EMOTION_TIER_WORDS: Readonly<Record<AttentionEmotion['tier'], string>> = {
  peak: '很重',
  high: '偏重',
  mild: '刚起头',
  calm: '',
}

/** 唤醒条件里认的布尔开关 */
type BooleanTriggerKey = 'atMention' | 'nameMention' | 'question' | 'poke' | 'anyMessage'

// 唤醒开关的中文说法，只换称呼不下结论
const TRIGGER_LABELS: ReadonlyArray<{ key: BooleanTriggerKey; label: string }> = [
  { key: 'atMention', label: '被直接点到' },
  { key: 'nameMention', label: '被叫到名字' },
  { key: 'question', label: '有人提问' },
  { key: 'poke', label: '被戳一下' },
  { key: 'anyMessage', label: '任意一条消息' },
]

// 上次发言过了多久，按粗档说；秒数每轮都变会让提示词前缀失效、缓存全打不中
function spokenAgoWord(ageMs: number): string {
  if (ageMs < 120_000) return '刚刚'
  if (ageMs < 1_200_000) return '十几分钟前'
  if (ageMs < 3_600_000) return '半小时前'
  if (ageMs < 10_800_000) return '一两个小时前'
  return '很久以前'
}

// 唤醒偏好换成事实句，没设过的项一句都不补
function wakeLines(wake: WakePreference | undefined, now: number | undefined): string[] {
  if (wake === undefined) return []
  const lines: string[] = []
  if (wake.wakeMode === 'timed' && wake.wakeUntil !== undefined && wake.wakeUntil !== null) {
    const until = new Date(wake.wakeUntil).toLocaleString('zh-CN', { hour12: false })
    const passed = now === undefined ? '' : wake.wakeUntil <= now ? '，那个时刻已经过了' : '，那个时刻还没到'
    lines.push(`你设了睡到 ${until}${passed}`)
  }
  const triggers = wake.triggers
  if (triggers !== undefined) {
    if (triggers.anyMessage === true) {
      lines.push(wake.wakeMode === 'timed' ? '休息结束后所有新消息都会叫醒你' : '所有新消息都会叫醒你')
    } else if (wake.wakeMode === 'infinite') {
      lines.push('你设了持续监听，但不是每条消息都叫醒')
    }
    const chosen = TRIGGER_LABELS.filter(row => row.key !== 'anyMessage' && triggers[row.key] === true).map(row => row.label)
    if (triggers.speakerIds !== undefined && triggers.speakerIds.length > 0) chosen.push('指定的人发言')
    if (chosen.length > 0) lines.push(`${triggers.anyMessage === true ? '另外' : '你设了只在这几种情况醒'}：${chosen.join('、')}`)
  }
  return lines
}

/**
 * 把注意力事实与当前唤醒偏好写成一段中文提示词事实
 * @param input - 采集到的事实、唤醒偏好与当前时间
 * @returns 只陈述事实的一段中文，不给是否行动的结论
 */
export function renderAttentionFacts(input: AttentionFactsInput): string {
  const signals = input.signals
  const lines: string[] = []
  if (signals.directed.at) lines.push('这几条在叫你')
  if (signals.directed.poke) lines.push('有人在戳你')
  if (signals.directed.replyToBot) lines.push('有人在回你刚说过的话')
  if (signals.directed.isPrivate) lines.push('这是一对一的对话')
  for (const item of signals.addressee.evidence) lines.push(item)
  if (signals.addressee.recentCount > 1) lines.push(`最近一段有 ${signals.addressee.recentCount} 条在叫你`)
  if (signals.ambient.humanCount > 0) {
    lines.push(signals.ambient.speakerCount > 1
      ? `最近一段有 ${signals.ambient.humanCount} 条真人发言，来自 ${signals.ambient.speakerCount} 个人`
      : `最近一段有 ${signals.ambient.humanCount} 条真人发言`)
    if (signals.ambient.speakerCount >= 3) lines.push('好几个人在并行接话')
    if (signals.ambient.speakingRate >= 6) lines.push('群里消息刷得很快')
    if (signals.novelty.repeated) lines.push('最近三条内容重复')
    if (signals.novelty.newTopic) lines.push('话题刚换过')
  }
  if (signals.fun.signals.length > 0) lines.push(`现场还有：${signals.fun.signals.join('、')}`)
  if (signals.fatigue.reason !== '') lines.push(`身体读数：${signals.fatigue.reason}`)
  if (input.emotion !== undefined && input.emotion.label !== '') {
    const degree = EMOTION_TIER_WORDS[input.emotion.tier]
    lines.push(`你现在的情绪：${input.emotion.label}${degree === '' ? '' : `（${degree}）`}`)
  }
  if (input.talkativeness !== undefined) {
    if (input.talkativeness < 0.35) {
      lines.push('你最近处在收着说的阶段；能一句说清就不展开，普通群聊没人直接找你时先旁听')
    } else if (input.talkativeness > 0.7) {
      lines.push('你最近说话偏活跃；这只是倾向，不代表这一轮必须开口')
    } else {
      lines.push('你最近的说话倾向是平常')
    }
  }
  if ((input.lastSelfSpokeAt ?? 0) > 0) {
    const ageMs = Math.max(0, (input.now ?? Date.now()) - (input.lastSelfSpokeAt ?? 0))
    lines.push(`你上次在这里成功发言是${spokenAgoWord(ageMs)}`)
  }
  if ((input.selfTalkStreak ?? 0) >= 2) {
    lines.push(signals.directed.isPrivate
      ? `你刚在私聊里连发了 ${input.selfTalkStreak} 个气泡；下一条只回当前这句话，别再追加一轮`
      : `你刚在群里连发了 ${input.selfTalkStreak} 个气泡；先停一轮，等人接或直接叫你`)
  }
  if (!signals.directed.at && !signals.directed.replyToBot && !signals.directed.poke
    && signals.ambient.speakerCount >= 2) {
    lines.push('其他人在并行聊天；没人直接对你时默认先读完，不把普通陈述先当成攻击')
  }
  if (!signals.directed.isPrivate && signals.ambient.speakingRate >= 6) {
    lines.push('现场刷得快；没有直接点到你时别抢每一句，挑真正要接的一条')
  }
  lines.push(...wakeLines(input.wake, input.now))
  return lines.join('\n')
}
