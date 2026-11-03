import { Context } from '@huoli/cordis'
import Sandbox from '@huoli/huoli-sandbox-local'
import SandboxPolicy from '@huoli/huoli-sandbox-policy'
import SessionProjections from '@huoli/huoli-session-projection'
import { onTestFinished } from 'vitest'
import type { SandboxMode } from '@huoli/huoli-sandbox'

/** Mount the Python runtime's policy and confinement providers with owned teardown. */
export async function createRuntimeContext(policy: { mode?: SandboxMode; workspaceRoot?: string } = {}): Promise<Context> {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(Sandbox, {})
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', ...policy })
  return ctx
}
