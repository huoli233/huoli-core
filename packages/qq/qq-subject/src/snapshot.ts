// 把状态写成一段话，只在这里写，提示词里看到的就是这段

import { familiarityWord, moodWord, type ChatState, type GlobalState } from './state.ts'

/** 写快照要的东西 */
export interface SnapshotInput {
  global: GlobalState
  chat?: ChatState
  chatName?: string
  thoughts?: readonly string[]
  maxChars?: number
}

// 百分比写法
function pct(value: number): string {
  const safe = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  return `${Math.round(safe * 100)}%`
}

/**
 * 把状态写成一小段话，超长就截断
 * @param input - 传进来的东西
 * @returns 拼好的话
 */
export function renderSelfSnapshot(input: SnapshotInput): string {
  const limit = Math.max(60, input.maxChars ?? 300)
  const global = input.global
  const lines: string[] = [
    `【此刻的我】心情 ${moodWord(global.mood)}（${pct(global.mood)}）｜精力 ${pct(global.energy)}`
      + `｜无聊 ${pct(global.boredom)}｜想说话 ${pct(global.socialHunger)}`,
  ]

  if (global.sleepPressure > 0.7) lines.push('这会儿有点困，回话会短。')
  else if (global.energy < 0.3) lines.push('有点提不起劲。')

  if (input.chat !== undefined) {
    const name = input.chatName !== undefined && input.chatName !== '' ? input.chatName : '对方'
    lines.push(`对 ${name}：${familiarityWord(input.chat.familiarity)}（熟悉度 ${pct(input.chat.familiarity)}）`)
  }

  const thoughts = input.thoughts ?? []
  if (thoughts.length > 0) {
    const first = String(thoughts[0] ?? '').trim()
    if (first !== '') lines.push(`心里还惦记着：${first}`)
  }

  const text = lines.join('\n')
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}
