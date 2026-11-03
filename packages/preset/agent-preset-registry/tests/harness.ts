import * as NativeToolExecutor from '@huoli/huoli-tool-executor-native'
import { Context } from '@huoli/cordis'
import Loader from '@huoli/cordis-plugin-loader'
import Group from '@huoli/cordis-plugin-group'
import LlmRuntime from '@huoli/huoli-llm'
import SessionStore, { SessionId } from '@huoli/huoli-session'
import SessionProjectionRegistry from '@huoli/huoli-session-projection'
import SystemPrompt from '@huoli/huoli-system-prompt'
import ToolRuntime from '@huoli/huoli-tools'
import AgentRegistry from '@huoli/huoli-agent'
import AgentLoop from '@huoli/huoli-agent-loop'
import AgentPresets, { type PresetDefinition } from '../src/index.ts'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

/** Loader-backed registry entries by harness context, for tests that edit live fields. */
export const liveRegistries = new WeakMap<Context, Awaited<ReturnType<typeof liveConfig>>>()

export const plugin = (name: string): string => new URL(`./fixtures/plugins/${name}.js`, import.meta.url).href
export const contribution = (tool: string): PresetDefinition => ({ id: tool, plugins: [{ name: plugin('contribute'), config: { tool } }] })
export async function harness(options: { live?: boolean } = {}): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = new URL('./fixtures/', import.meta.url).href
  await ctx.plugin(Loader)
  ctx.loader.builtins.group = Group
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (options.live) liveRegistries.set(ctx, await liveConfig(ctx, AgentPresets, { default: 'standard' }))
  else await ctx.plugin(AgentPresets, { default: 'standard' })
  return ctx
}
export async function declare(ctx: Context, config: PresetDefinition) {
  return await ctx.plugin({
    inject: ['agentPresets'],
    async* apply(child: Context) { yield await child.agentPresets.register(config) },
  })
}
export async function agentOn(ctx: Context, id: string, presetId?: string) {
  const handle = await ctx.agents.create({
    sessionId: SessionId(id),
    setup: async (agentCtx: Context) => { await ctx.agentPresets.mount(agentCtx, presetId) },
  })
  return handle.agent
}

export async function currentKey(ctx: Context, id?: string) {
  await using lease = await ctx.agentPresets.acquireScope(id)
  return lease.key
}
