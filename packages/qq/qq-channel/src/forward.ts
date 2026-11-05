// 合并转发：把几段正文装成一条带节点的消息，动作名与参数都在这里定

/** 一条合并转发里的节点：显示的名字与这一段正文 */
export interface ForwardNode {
  /** 显示在转发卡片里的名字 */
  name: string
  /** 这一段正文 */
  content: string
}

/** 一次合并转发请求：动作名与它要带的参数 */
export interface ForwardCall {
  /** 发出去的动作名 */
  action: string
  /** 随动作一起带的参数 */
  params: Record<string, unknown>
}

/**
 * 把几段正文装成一次合并转发请求，群与私聊各走各的动作
 * @param nodes - 要发的节点，正文为空的会被丢掉
 * @param chatKey - 会话键，决定发给群还是发给个人
 * @param selfId - 机器人自己的号，节点里当发言者
 * @returns 动作名与参数；一段都不剩时给 undefined
 */
export function forwardCallOf(
  nodes: readonly ForwardNode[],
  chatKey: string,
  selfId: string,
): ForwardCall | undefined {
  const kept = nodes.filter(node => node.content.trim() !== '')
  if (kept.length === 0) return undefined
  const messages = kept.map(node => ({
    type: 'node',
    data: { name: node.name, uin: Number(selfId) || 0, content: node.content },
  }))
  if (chatKey.startsWith('group:')) {
    return { action: 'send_group_forward_msg', params: { group_id: Number(chatKey.slice('group:'.length)), messages } }
  }
  return { action: 'send_private_forward_msg', params: { user_id: Number(chatKey.slice('private:'.length)), messages } }
}
