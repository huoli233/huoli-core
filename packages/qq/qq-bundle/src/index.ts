// 把各个零件装到一起：规则、每天该做的事、收消息往哪放

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@huoli/cordis'
import '@huoli/huoli-system-prompt'
import '@huoli/huoli-agent'
import { qqAttentionOf } from '@huoli/huoli-qq-attention'
import { qqMemoryOf } from '@huoli/huoli-qq-memory'
import { hasWords, qqChannelOf, type IncomingMessage } from '@huoli/huoli-qq-channel'
import { replyBudget, type ReplyFacts } from '@huoli/huoli-qq-pacing'
import { qqSubjectOf } from '@huoli/huoli-qq-subject'
import { qqVitalsOf, type QqVitalsSeam, type VitalsState } from '@huoli/huoli-qq-vitals'

/** 这一行接受的配置 */
export interface Config {
  /** 说话规矩那个文件放哪 */
  rulesFile?: string
  /** 每天几点整理记忆 */
  dailySweepHour?: number
  /** 一轮最多走几步 */
  maxSteps?: number
}

/** 插件的行名 */
export const name = 'qq-bundle'

/** 要用的内核接口 */
export const inject = ['systemPrompt']

// 去重表只留最近这么多条，跑久了也不会一直涨
const SEEN_MAX = 256

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

// 条数上限看的事实：都从身体那唯一一份状态里取，不在这里另算
function replyFactsOf(state: VitalsState): ReplyFacts {
  return {
    tired: state.adenosine,
    annoyed: state.irritability,
    energy: state.energy,
    clingy: state.clinginess,
    lonely: state.loneliness,
  }
}

// 身体没接上时按中性的身体算，上限照样是一个数
const NEUTRAL_FACTS: ReplyFacts = { tired: 0.5, annoyed: 0.5, energy: 0.5, clingy: 0.5, lonely: 0.5 }

// 这一段只说这一轮最多几句，不说该不该回
function budgetLine(vitals: QqVitalsSeam | undefined): string {
  const facts = vitals === undefined ? NEUTRAL_FACTS : replyFactsOf(vitals.read())
  return `【这一轮的条数】这一轮最多说 ${replyBudget(facts)} 条，说完就停，不追问，也不凑满。`
}

/**
 * 把零件装到一起
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const rules = readRules(config.rulesFile ?? defaultRulesPath())

  // 规则放在提示词靠后的位置，压住前面那些通用话术
  ctx.systemPrompt.section({
    name: 'qq:rules',
    order: 500,
    text: rules,
  })

  // 身体先说话，条数紧跟着：这一轮最多几句排在身体之后、规矩之前
  const vitals = qqVitalsOf(ctx)
  ctx.systemPrompt.section({
    name: 'qq:reply-budget',
    order: 350,
    text: () => budgetLine(vitals),
  })

  // 每轮最多走几步：走太多就是在空转，停掉比继续烧钱好
  const maxSteps = Math.max(1, config.maxSteps ?? 40)
  ctx.on('agent/pre-step', async (payload, next) => {
    if (payload.step > maxSteps) return { kind: 'reject' as const }
    return next()
  })

  // 收消息：先记进身体，再放进注意力收件箱，顺便把当前会话记成活跃的那个
  const attention = qqAttentionOf(ctx)
  const subject = qqSubjectOf(ctx)
  const channel = qqChannelOf(ctx)
  if (channel !== undefined) {
    // 同一条消息只认一次：按会话加编号留住最近这一段
    const seen: string[] = []
    const seenKeys = new Set<string>()
    const firstTime = (message: IncomingMessage): boolean => {
      if (message.messageId === '') return true
      const key = `${message.chatKey}:${message.messageId}`
      if (seenKeys.has(key)) return false
      seenKeys.add(key)
      seen.push(key)
      if (seen.length > SEEN_MAX) {
        const oldest = seen.shift()
        if (oldest !== undefined) seenKeys.delete(oldest)
      }
      return true
    }

    const offIncoming = channel.onIncoming((message) => {
      if (!firstTime(message)) return
      if (hasWords(message.text)) vitals?.react(message.text, message.at)
      attention?.inbox.push(message.chatKey, {
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        at: message.at,
      })
      subject?.store.setActive(message.chatKey)
    })
    const offPoke = channel.onPoke((poke) => {
      attention?.inbox.push(poke.chatKey, {
        senderId: poke.userId,
        senderName: poke.userId,
        text: '戳了戳我',
        at: poke.at,
      })
      subject?.store.setActive(poke.chatKey)
    })
    ctx.effect(() => () => {
      offIncoming()
      offPoke()
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
  idle.unref()
  ctx.effect(() => () => {
    clearInterval(idle)
  })
}
