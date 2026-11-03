import { Context } from '@huoli/cordis'
import { onTestFinished } from 'vitest'
import SessionStore from '@huoli/huoli-session'
import FileSystem from '@huoli/huoli-fs-local'
import Subprocess from '@huoli/huoli-subprocess-local'
import Sandbox from '@huoli/huoli-sandbox-local'
import SandboxPolicy from '@huoli/huoli-sandbox-policy'
import SessionProjections from '@huoli/huoli-session-projection'
import type { SandboxMode } from '@huoli/huoli-sandbox'
import NodeRuntime from '../src/index.ts'
import type { Config } from '../src/index.ts'

export async function mountRuntime(ctx: Context, config: Config = {}, policy: { mode?: SandboxMode; workspaceRoot?: string } = {}) {
  onTestFinished(async () => { await ctx.fiber.dispose() })
  if (!ctx.get('sessions')) await ctx.plugin(SessionStore)
  if (!ctx.get('fs')) await ctx.plugin(FileSystem)
  if (!ctx.get('subprocess')) await ctx.plugin(Subprocess)
  if (!ctx.get('sandbox')) await ctx.plugin(Sandbox, {})
  if (!ctx.get('sessionProjections')) await ctx.plugin(SessionProjections)
  if (!ctx.get('sandboxPolicy')) await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', ...policy })
  const fiber = await ctx.plugin(NodeRuntime, config)
  return { runtime: ctx.ptcRuntime as NodeRuntime, fiber }
}
