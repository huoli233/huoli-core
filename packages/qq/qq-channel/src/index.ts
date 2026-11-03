// 接 QQ 的装配入口：连上、把消息放进收件箱、把要发的送出去

import type { Context } from '@huoli/cordis'
import { qqPacingOf, splitSpeech } from '@huoli/huoli-qq-pacing'
import { createWsChannel, type WsChannel } from './ws.ts'
import { toIncoming, toPoke, type ChannelStatus, type IncomingMessage, type IncomingPoke } from './events.ts'
import { registerChannelTools } from './tools.ts'

export type { ChannelStatus, IncomingMessage, IncomingPoke, Outgoing, SentResult } from './events.ts'
export { chatKeyOf, mentionsSelf, repliesToSelf, textOf, toIncoming, toPoke } from './events.ts'
export type { WsChannel, WsHandlers, WsOptions } from './ws.ts'
export { createWsChannel } from './ws.ts'

// 别处要往收件箱塞消息、要发东西，都从这儿拿
export interface QqChannelSeam {
  channel: WsChannel
  status(): ChannelStatus
  onIncoming(handler: (message: IncomingMessage) => void): void
  onPoke(handler: (poke: IncomingPoke) => void): void
}

// 这一行接受的配置
export interface Config {
  url: string
  selfId: string
  accessToken?: string
  reconnectMs?: number
}

const seams = new WeakMap<Context, QqChannelSeam>()

// 取通道，未装配时为 undefined
export function qqChannelOf(ctx: Context): QqChannelSeam | undefined {
  return seams.get(ctx)
}

// 插件的行名
export const name = 'qq-channel'

// 要用的内核接口
export const inject = ['tools']

// 装配通道与发送工具
export function apply(ctx: Context, config: Config): void {
  const incoming: Array<(message: IncomingMessage) => void> = []
  const pokes: Array<(poke: IncomingPoke) => void> = []

  const channel = createWsChannel(
    {
      url: config.url,
      selfId: config.selfId,
      ...config.accessToken !== undefined ? { accessToken: config.accessToken } : {},
      ...config.reconnectMs !== undefined ? { reconnectMs: config.reconnectMs } : {},
    },
    {
      onMessage(raw) {
        const now = Date.now()
        const message = toIncoming(raw, config.selfId, now)
        if (message !== null && message.text !== '') {
          for (const handler of incoming) handler(message)
          return
        }
        const poke = toPoke(raw, now)
        if (poke !== null) for (const handler of pokes) handler(poke)
      },
      onStatus() {
        // 状态变化给控制台看，这里不额外做事
      },
      log(message) {
        void message
      },
    },
  )

  const seam: QqChannelSeam = {
    channel,
    status() {
      return channel.status()
    },
    onIncoming(handler) {
      incoming.push(handler)
    },
    onPoke(handler) {
      pokes.push(handler)
    },
  }
  seams.set(ctx, seam)

  // 拆句直接用说话规矩里的纯函数，不依赖它有没有先装好
  const pacing = qqPacingOf?.(ctx)

  registerChannelTools(ctx, {
    status: () => channel.status(),
    send: (text, chatKey) => channel.send(text, chatKey),
    react: (messageId, emoji) => channel.react(messageId, emoji),
    split: (text) => splitSpeech(text),
    spend: (text) => {
      pacing?.spend(text)
    },
    allow: (text) => {
      const verdict = pacing?.allow(text)
      return verdict !== undefined ? verdict : { ok: true }
    },
  })

  channel.start()

  // 卸载时断开
  ctx.effect(() => () => {
    channel.stop()
    seams.delete(ctx)
  })
}
