// 三类公共动作的参数与形状：动态、公开评论、私信各一套冷却与额度，互不共用

import type { ActionKind } from '@huoli/huoli-qq-self'

export type { ActionKind } from '@huoli/huoli-qq-self'

/** 一类动作自己那套关卡参数 */
export interface ActionTuning {
  /** 同一类动作两次之间至少隔多久 */
  coolDownMs: number
  /** 同一段正文隔多久才许再做一次同类动作 */
  repeatWindowMs: number
  /** 一天最多几次 */
  dailyMax: number
  /** 指纹表最多留几条 */
  fingerprintMax: number
  /** 做之前要不要先过一次确认，这是安全不变量，不随配置改 */
  confirmRequired: boolean
}

/** 三类动作各一套参数，互不共用 */
export type ActionTunings = Readonly<Record<ActionKind, ActionTuning>>

// 公共动作的三十分钟：冷却、同文去重与待确认项的有效期用同一套数字
const PUBLIC_WINDOW_MS = 30 * 60_000

/** 三类动作的默认值表 */
export const ACTION_DEFAULTS: ActionTunings = {
  post: { coolDownMs: PUBLIC_WINDOW_MS, repeatWindowMs: PUBLIC_WINDOW_MS, dailyMax: 3, fingerprintMax: 64, confirmRequired: false },
  comment: { coolDownMs: PUBLIC_WINDOW_MS, repeatWindowMs: PUBLIC_WINDOW_MS, dailyMax: 3, fingerprintMax: 64, confirmRequired: true },
  private: { coolDownMs: PUBLIC_WINDOW_MS, repeatWindowMs: PUBLIC_WINDOW_MS, dailyMax: 3, fingerprintMax: 64, confirmRequired: true },
}

/** 要过一次确认才发得出去的那几类动作，清单只从默认值表里取 */
export const CONFIRM_KINDS: readonly ActionKind[] = (Object.keys(ACTION_DEFAULTS) as ActionKind[])
  .filter(kind => ACTION_DEFAULTS[kind].confirmRequired)

/** 一次确认的默认值表 */
export const CONFIRM_DEFAULTS = {
  /** 待确认项放多久没人点头就失效 */
  ttlMs: PUBLIC_WINDOW_MS,
} as const

/** 参数表之外那几项默认值：预授权话题与私信允许名单 */
export const POLICY_DEFAULTS = {
  /** 命中才算例行、才许公开评论的那些话题类别 */
  routineTopics: ['日常', '吃喝'] as readonly string[],
  /** 允许私信的对象，空表示谁都不行 */
  allowPeers: [] as readonly string[],
}

/** 做一次动作要看的事实 */
export interface ActionFacts {
  /** 做在哪个会话上，私信就是对方的会话键 */
  chatKey: string
  /** 动态报上来的级别：none、routine、public */
  level?: string
  /** 话题类别，报了才查预授权清单 */
  topic?: string
  /** 私信写给谁 */
  peer?: string
  /** 用户那把钥匙 */
  userOk?: boolean
  /** 她自己那把钥匙 */
  selfOk?: boolean
}

/** 通道回来的投递结果 */
export interface ActionDelivery {
  /** 送出去了没有 */
  ok: boolean
  /** 送出去之后的编号 */
  messageId?: string
  /** 没送出去的码 */
  code?: string
  /** 没送出去的原因 */
  reason?: string
}

/** 一次动作的结果，拒绝时只有码、原因与下次时刻 */
export interface ActionResult {
  /** 做成了没有 */
  ok: boolean
  /** 拒绝的码，形如 comment.needs_confirm */
  code?: string
  /** 一句可读原因 */
  reason?: string
  /** 下一步提示 */
  hint?: string
  /** 下次可以再试的时刻 */
  retryAt?: number
  /** 做成的时刻 */
  at?: number
  /** 通道回来那一路的结果 */
  delivery?: ActionDelivery
  /** 待确认项的编号，只有要确认的那一步给 */
  confirmId?: string
  /** 待确认项到什么时候失效 */
  expiresAt?: number
}

/** 三类动作与一次确认共用的入口 */
export interface ActionGate {
  /**
   * 做一次动作
   * @param kind - 三类动作之一
   * @param text - 正文，不写就不做
   * @param facts - 会话、级别、话题、对象与两把钥匙
   * @returns 做成的时刻与投递结果，没做就带码
   */
  publish(kind: ActionKind, text: string, facts: ActionFacts): Promise<ActionResult>
  /**
   * 把一段正文放进待确认队列
   * @param kind - 三类动作之一
   * @param text - 正文，同一类动作下同一段正文只进队列一次
   * @param at - 提出确认的时刻
   * @returns 编号与失效时刻，进不了队列就带码
   */
  requestConfirm(kind: ActionKind, text: string, at: number): ActionResult
  /**
   * 点头放行一条待确认的正文
   * @param confirmId - 待确认项的编号
   * @param at - 点头的时刻
   * @returns 放行了没有，过期的带码
   */
  confirm(confirmId: string, at: number): ActionResult
  /**
   * 丢掉一条待确认的正文
   * @param confirmId - 待确认项的编号
   * @returns 丢掉了没有
   */
  reject(confirmId: string): ActionResult
}
