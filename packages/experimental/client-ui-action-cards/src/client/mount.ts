/** Register the card frame, the tool row, their copy and the body registry. */
import type { Context } from '@huoli/cordis'
import type { SessionId } from '@huoli/huoli-session/types'
import type {} from '@huoli/huoli-api-remotes/client'
import type {} from '@huoli/huoli-client-locale/client'
import type {} from '@huoli/huoli-client-ui-session/client'
import type {} from '@huoli/huoli-client-ui-renderer/client'
import type {} from '@huoli/huoli-client-ui-tool/client'
import type {} from '@huoli/huoli-action-cards/remote'
import type { TypertRemoteContribution } from '@huoli/huoli-typert-protocol'
import { ActionCardTail, type TailInjected } from './Card.tsx'
import { ProposeRow } from './ProposeRow.tsx'
import { ActionCardRegistry } from './registry.ts'
import { de, en, es, fr, ja, pt, ru, zh, type ActionCardKey } from './locales.ts'

declare module '@huoli/huoli-client-ui-slots' {
  interface LocaleNamespaceMap { actionCards: ActionCardKey }
}

declare module '@huoli/cordis' {
  interface Context {
    /** Card bodies by action kind; kinds register theirs inside their own `ctx.effect`. */
    actionCards: ActionCardRegistry
  }
}

/** Registries available before this plugin mounts its Remote. */
export const inject = ['slots', 'locale', 'remote']

/**
 * Provide the body registry, then mount the Remote and the UI for the same plugin lifetime.
 * @param ctx - Client plugin context.
 * @param contribution - Generated Remote descriptors supplied by the built entry.
 * @returns disposer removing the UI before the Remote contribution.
 */
export async function mountActionCards(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  // Built at the plugin's top level: kinds register into it from their own apply.
  const registry = new ActionCardRegistry(ctx)
  ctx.reflect.provide('actionCards', registry)
  const unmount = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.actionCards'], (inner) => { registerUi(inner, registry) })
  try { await ui } catch (error) { await ui.dispose(); await unmount(); throw error }
  return async () => { await ui.dispose(); await unmount() }
}

function registerUi(ctx: Context, registry: ActionCardRegistry): void {
  ctx.effect(() => ctx.locale.register('actionCards', { en, zh, ja, es, fr, de, ru, pt }), 'action-cards: locale')
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail', id: '@huoli/huoli-client-ui-action-cards', locale: 'actionCards',
    inject: (sessionId: SessionId): TailInjected => ({
      sessionId,
      hooks: { bodies: registry.source },
      bind: locale => ctx.locale.bind(locale),
      act: async (callId, verb, payload) => {
        const result = await ctx.remote.actionCards.act(sessionId, callId, verb, payload)
        return result.ok ? result.value : undefined
      },
    }),
  }, ActionCardTail))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'propose_action', locale: 'actionCards' }, ProposeRow,
  ))
}
