import { executeToolFixture } from '@huoli/huoli-tool-testkit'
import { fileURLToPath } from 'node:url'
import { agentEvents, type Agent } from '@huoli/huoli-agent'
import { ToolCallId } from '@huoli/huoli-llm'
import { boot, loadOverlayPatches } from '@huoli/huoli-app-boot'
import { SessionId } from '@huoli/huoli-session'
import type {} from '@huoli/huoli-skill'
import type {} from '@huoli/huoli-tools'
import { unsupportedModel, unsupportedInbox } from '@huoli/huoli-agent-loop-testkit'

const overlayPath = process.argv[2]
if (overlayPath === undefined) throw new Error('huoli-badge snapshot requires an overlay path')
const rootConfigPath = fileURLToPath(new URL('../../../../../packages/bundle/base/tests/fixtures/root.cordis.yml', import.meta.url))
const basePatchPath = fileURLToPath(new URL('../../../../../packages/bundle/base/cordis.patch.yml', import.meta.url))
// The fixture owns the optional provider; the base bundle has no dependency on it.
const overlays = loadOverlayPatches('huoli-badge-snapshot', overlayPath).map(patch => patch.insert === undefined ? patch : {
  ...patch,
  insert: patch.insert.map(row => row.name === '@huoli/huoli-skill-badge'
    ? { ...row, name: import.meta.resolve('@huoli/huoli-skill-badge') }
    : row),
})
const ctx = await boot('huoli-badge-snapshot', rootConfigPath, [
  ...loadOverlayPatches('huoli-badge-snapshot', basePatchPath),
  ...overlays,
])

try {
  const agentId = SessionId('huoli-badge-snapshot')
  const session = ctx.sessions.create(agentId, { meta: { cwd: process.cwd() } })
  const agent: Agent = {
    ctx,
    id: agentId,
    options: {},
    session,
    model: unsupportedModel(),
    inbox: unsupportedInbox(),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('huoli-badge snapshot must receive the catalog at the step boundary') },
    cancel: () => {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { modelSelection: { provider: 'mock', model: 'mock' }, messages: [], turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
  const catalog = decision.kind === 'enter'
    ? decision.messages.find(message => message.role === 'user'
      && message.source.kind === 'skill-catalog')?.content
    : undefined
  const summary = (await ctx.skills.list()).find(skill => skill.name === 'huoli-badge')
  const result = await executeToolFixture(ctx, {
    callId: ToolCallId('huoli-badge-snapshot'),
    name: 'skill',
    arguments: { name: 'huoli-badge' },
    signal: new AbortController().signal,
  })
  process.stdout.write(`${JSON.stringify({ catalog: catalog ?? null, summary: summary ?? null, result })}\n`)
} finally {
  await ctx.fiber.dispose()
}
