// 注意力事实只写进提示词，不替模型决定要不要行动

import type { AttentionSignals } from './select.ts'
import type { WakeTriggers } from './types.ts'

/** 当前唤醒偏好，缺项按没设过处理 */
export interface WakePreference {
  wakeMode?: 'infinite' | 'timed'
  wakeUntil?: number | null
  triggers?: WakeTriggers
}

/** 渲染一段事实要用的东西 */
export interface AttentionFactsInput {
  signals: AttentionSignals
  wake?: WakePreference
  now?: number
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

// 唤醒偏好换成事实句，没设过的项一句都不补
function wakeLines(wake: WakePreference | undefined, now: number | undefined): string[] {
  if (wake === undefined) return []
  const lines: string[] = []
  if (wake.wakeMode === 'infinite') lines.push('你设了每条消息都醒')
  if (wake.wakeMode === 'timed' && wake.wakeUntil !== undefined && wake.wakeUntil !== null) {
    const until = new Date(wake.wakeUntil).toLocaleString('zh-CN', { hour12: false })
    const passed = now === undefined ? '' : wake.wakeUntil <= now ? '，那个时刻已经过了' : '，那个时刻还没到'
    lines.push(`你设了睡到 ${until}${passed}`)
  }
  const triggers = wake.triggers
  if (triggers !== undefined) {
    const chosen = TRIGGER_LABELS.filter(row => triggers[row.key] === true).map(row => row.label)
    if (triggers.speakerIds !== undefined && triggers.speakerIds.length > 0) chosen.push('指定的人发言')
    if (chosen.length > 0) lines.push(`你设了只在这几种情况醒：${chosen.join('、')}`)
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
  if (signals.ambient.humanCount > 0) {
    lines.push(`最近一段有 ${signals.ambient.humanCount} 条真人发言`)
    if (signals.novelty.repeated) lines.push('最近三条内容重复')
    if (signals.novelty.newTopic) lines.push('话题刚换过')
  }
  if (signals.fun.signals.length > 0) lines.push(`现场还有：${signals.fun.signals.join('、')}`)
  if (signals.fatigue.reason !== '') lines.push(`身体读数：${signals.fatigue.reason}`)
  lines.push(...wakeLines(input.wake, input.now))
  return lines.join('\n')
}
