// 每轮身份、成员、能力与安静事实：装配入口只管接线，文本在这里生成

import type { Context } from '@huoli/cordis'
import type { QqChannelSeam } from '@huoli/huoli-qq-channel'
import type { QqSubjectSeam } from '@huoli/huoli-qq-subject'
import { capabilityLine, identityLine, memberLine } from './lines.ts'
import type { Config } from './types.ts'
import type { SelfQuiet } from './self-quiet.ts'

/** 拼每轮身份事实要用的东西 */
export interface IdentityPromptDeps {
  config: Config
  channel: QqChannelSeam | undefined
  subject: QqSubjectSeam | undefined
  quiet: SelfQuiet
  selfName: string
  creatorTitle: string
  /** 这一轮真正暴露给模型的工具名，按会话和当前发送者算 */
  visibleTools(chatKey?: string, agent?: object): readonly string[]
  activeChatKey(context: { agent?: { id?: string } }): string
}

/**
 * 把名字、QQ 号、创造者、成员名册、能力清单与安静状态挂成系统提示段。
 * @param ctx 运行环境
 * @param deps 配置、通道、关系仓与安静状态
 */
export function registerIdentityPrompts(ctx: Context, deps: IdentityPromptDeps): void {
  ctx.systemPrompt.section({
    name: 'qq:identity',
    order: 11,
    text: (context) => {
      const chatKey = deps.activeChatKey(context)
      const ownerId = (deps.config.creatorQq ?? '').trim()
      const owner = ownerId === '' ? undefined : deps.subject?.relations.get(ownerId)
      const ownerName = owner?.preferredName || owner?.displayName || deps.config.creatorTitle || deps.creatorTitle
      return [
        identityLine(
          deps.channel?.selfId ?? '',
          deps.selfName,
          ownerId,
          ownerName,
          chatKey,
          deps.config.ownerAddress ?? '',
        ),
        memberLine((deps.subject?.relations.forChat(chatKey) ?? []).map(person => ({
          id: person.personId === ownerId ? '' : person.personId,
          name: person.preferredName || person.displayName || '',
        }))),
        capabilityLine(deps.visibleTools(chatKey, context.agent), ownerId !== '' && chatKey === `private:${ownerId}`),
      ].filter(line => line !== '').join('\n\n')
    },
  })
  ctx.systemPrompt.section({
    name: 'qq:self-quiet',
    order: 508,
    text: () => deps.quiet.facts(),
  })
}
