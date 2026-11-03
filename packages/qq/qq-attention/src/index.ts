/**
 * Attention state machine for one chat. Five model-facing tools read facts and
 * append events; the channel bridge pushes inbound messages and the prompt
 * layer renders the state. Nothing here decides whether to speak.
 *
 * @module @huoli/huoli-qq-attention
 */

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import { createInbox, type QqInbox } from './inbox.ts'
import { createAttentionStore, type AttentionStore } from './store.ts'
import { collectSignals, type AttentionSignals, type SignalMessage } from './select.ts'
import { registerAttentionTools } from './tools.ts'

export type { InboxPush, InboxRead, InboxWait, QqInbox, QqMessage } from './inbox.ts'
export type { AttentionState, AttentionEvent, WakeTriggers } from './types.ts'
export { NOTE_MAX_CHARS } from './types.ts'
export type { AttentionStore, AttentionStoreOptions } from './store.ts'
export type { AttentionSignals, Candidate, CollectInput, SignalMessage } from './select.ts'
export { collectSignals } from './select.ts'
export { WAIT_MAX_MS, DEFAULT_READ_LIMIT, DEFAULT_QUIET_MS } from './tools.ts'

/** Runtime seams created for one application context. */
export interface QqAttentionSeam {
  /** Live inbound buffer the channel bridge pushes into. */
  readonly inbox: QqInbox
  /** Durable attention state. */
  readonly store: AttentionStore
  /** Collect attention facts for one chat. */
  signals(chatKey: string, overrides?: { fatigueLevel?: number; fatigueReason?: string }): AttentionSignals
}

/** Config accepted by this row. */
export interface Config {
  /** Absolute path of the state file; defaults under the working directory. */
  file?: string
  /** Bot display names and learned aliases used for name detection. */
  selfNames?: readonly string[]
}

const seams = new WeakMap<Context, QqAttentionSeam>()

/** Reach the attention seam of a running application; undefined before apply. */
export function qqAttentionOf(ctx: Context): QqAttentionSeam | undefined {
  return seams.get(ctx)
}

/** Cordis row name. */
export const name = 'qq-attention'

/** Services this row needs. */
export const inject = ['tools']

/** Messages the signal collector looks at. */
const SIGNAL_WINDOW = 40

/** Register the attention seam and its five tools. */
export function apply(ctx: Context, config: Config = {}): void {
  const file = config.file ?? path.join(process.cwd(), 'data', 'qq-attention.json')
  const inbox = createInbox()
  const store = createAttentionStore({ file })
  const selfNames = config.selfNames ?? []

  const toSignal = (message: { seq: number; senderId: string; senderName?: string; text: string; at: number }): SignalMessage => ({
    seq: message.seq,
    senderId: message.senderId,
    ...message.senderName !== undefined ? { senderName: message.senderName } : {},
    text: message.text,
    at: message.at,
  })

  const seam: QqAttentionSeam = {
    inbox,
    store,
    signals(chatKey, overrides = {}) {
      const messages = inbox.recent(chatKey, SIGNAL_WINDOW).map(toSignal)
      return collectSignals({
        chatKey,
        messages,
        selfNames,
        ...overrides.fatigueLevel !== undefined ? { fatigueLevel: overrides.fatigueLevel } : {},
        ...overrides.fatigueReason !== undefined ? { fatigueReason: overrides.fatigueReason } : {},
      })
    },
  }
  seams.set(ctx, seam)

  registerAttentionTools(ctx, {
    inbox,
    store,
    recentOf: (chatKey) => inbox.recent(chatKey, SIGNAL_WINDOW).map(toSignal),
    selfNames: () => selfNames,
  })

  // Flush the state file when this row unloads, so a graceful shutdown keeps
  // whatever the model last set.
  ctx.effect(() => () => {
    store.flush()
    seams.delete(ctx)
  })
}
