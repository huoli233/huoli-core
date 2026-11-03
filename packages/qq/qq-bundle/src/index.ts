// 把各个零件装到一起：规则、每天该做的事、收消息往哪放

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@huoli/cordis'
import '@huoli/huoli-system-prompt'
import '@huoli/huoli-agent'
import { qqAttentionOf } from '@huoli/huoli-qq-attention'
import { qqMemoryOf } from '@huoli/huoli-qq-memory'
import { qqChannelOf } from '@huoli/huoli-qq-channel'
import { qqSubjectOf } from '@huoli/huoli-qq-subject'

// 这一行接受的配置
export interface Config {
  /** 说话规矩那个文件放哪 */
  rulesFile?: string
  /** 每天几点整理记忆 */
  dailySweepHour?: number
  /** 一轮最多走几步 */
  maxSteps?: number
}

// 插件的行名
export const name = 'qq-bundle'

// 要用的内核接口
export const inject = ['systemPrompt']

// 规则文件的位置
function defaultRulesPath(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    return path.join(here, '..', 'prompts', 'rules.md')
  } catch {
    return path.join(process.cwd(), 'prompts', 'rules.md')
  }
}

// 读规则，读不到就用一句兜底
function readRules(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    return '你是群里的一个人，说话简短，说完就停。'
  }
}

// 把零件装到一起
export function apply(ctx: Context, config: Config = {}): void {
  const rules = readRules(config.rulesFile ?? defaultRulesPath())

  // 规则放在提示词靠后的位置，压住前面那些通用话术
  ctx.systemPrompt.section({
    name: 'qq:rules',
    order: 500,
    text: rules,
  })

  // 每轮最多走几步：走太多就是在空转，停掉比继续烧钱好
  const maxSteps = Math.max(1, config.maxSteps ?? 40)
  ctx.on('agent/pre-step', async (payload, next) => {
    if (payload.step > maxSteps) return { kind: 'reject' as const }
    return next()
  })

  // 收消息：放进注意力收件箱，顺便把当前会话记成活跃的那个
  const attention = qqAttentionOf(ctx)
  const subject = qqSubjectOf(ctx)
  const channel = qqChannelOf(ctx)
  if (channel !== undefined && attention !== undefined) {
    channel.onIncoming((message) => {
      attention.inbox.push(message.chatKey, {
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        at: message.at,
      })
      subject?.store.setActive(message.chatKey)
    })
    channel.onPoke((poke) => {
      attention.inbox.push(poke.chatKey, {
        senderId: poke.userId,
        senderName: poke.userId,
        text: '戳了戳我',
        at: poke.at,
      })
      subject?.store.setActive(poke.chatKey)
    })
  }

  // 每天一次：把记忆往上挪一层、该淡的淡一档
  const memory = qqMemoryOf(ctx)
  const hour = Math.max(0, Math.min(23, config.dailySweepHour ?? 4))
  const idle = setInterval(() => {
    if (new Date().getHours() !== hour) return
    memory?.promote()
    memory?.sweep()
  }, 60 * 60_000)
  idle.unref?.()
  ctx.effect(() => () => {
    clearInterval(idle)
  })
}
