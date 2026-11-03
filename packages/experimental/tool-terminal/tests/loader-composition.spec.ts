import { executeToolFixture } from '@huoli/huoli-tool-testkit'
import * as NativeToolExecutor from '@huoli/huoli-tool-executor-native'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { unsupportedModel, provideWorkingDirectoryFixture, unsupportedInbox } from '@huoli/huoli-agent-loop-testkit'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@huoli/cordis'
import Loader from '@huoli/cordis-plugin-loader'
import Include from '@huoli/cordis-plugin-include'
import { ToolCallId } from '@huoli/huoli-llm'
import { Session, SessionId } from '@huoli/huoli-session'
import AgentRegistry from '@huoli/huoli-agent'
import type { Agent } from '@huoli/huoli-agent'
import SystemPrompt from '@huoli/huoli-system-prompt'
import ToolRuntime from '@huoli/huoli-tools'
import TerminalSessionService from '@huoli/huoli-terminal'
import SandboxProvider from '@huoli/huoli-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@huoli/huoli-sandbox'
import SandboxPolicyService from '@huoli/huoli-sandbox-policy'
import SessionProjectionRegistry from '@huoli/huoli-session-projection'
import LocalSubprocessRuntime from '@huoli/huoli-subprocess-local'
import * as TerminalLocal from '@huoli/huoli-terminal-bash'
import * as ToolPty from '@huoli/huoli-tool-terminal'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

class PassthroughSandbox extends SandboxProvider {
  async confine(argv: readonly string[], _policy: SandboxPolicy): Promise<ConfinedArgv> {
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

async function agent(ctx: Context): Promise<Agent> {
  const scope = ctx.plugin(() => {})
  const id = SessionId('pty-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, model: unsupportedModel(),
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {}, steer: () => {}, inject: () => {}, cancel() {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.agents.register(value)
  return value
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const suite = process.platform === 'linux' || process.platform === 'darwin' ? describe : describe.skip

suite('terminal real Loader composition through cordis.yml', () => {
  it('boots cordis.yml and preserves shell state across real tool calls', async () => {
    root = await mkdtemp(join(tmpdir(), 'huoli-pty-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@huoli/huoli-agent'",
      "- name: '@huoli/huoli-system-prompt'",
      "- name: '@huoli/huoli-tools'",
      "- name: '@huoli/huoli-tool-executor-native'",
      "- name: '@huoli/huoli-terminal'",
      "- name: '@huoli/huoli-test-sandbox'",
      "- name: '@huoli/huoli-session-projection'",
      "- name: '@huoli/huoli-sandbox-policy'",
      '  config:',
      '    mode: danger-full-access',
      `    workspaceRoot: ${JSON.stringify(root)}`,
      "- name: '@huoli/huoli-subprocess-local'",
      "- name: '@huoli/huoli-terminal-bash'",
      '  config:',
      '    pollIntervalMs: 10',
      '    exactProbeAfterMs: 20',
      '    idleSilenceMs: 250',
      '    handoffGraceMs: 250',
      '    timeoutMs: 2000',
      '    disposeGraceMs: 500',
      "- name: '@huoli/huoli-tool-terminal'",
      '',
    ].join('\n'))

    context = new Context()

    provideWorkingDirectoryFixture(context)
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@huoli/huoli-agent', AgentRegistry],
      ['@huoli/huoli-system-prompt', SystemPrompt],
      ['@huoli/huoli-tools', ToolRuntime],
      ['@huoli/huoli-tool-executor-native', NativeToolExecutor],
      ['@huoli/huoli-terminal', TerminalSessionService],
      ['@huoli/huoli-test-sandbox', PassthroughSandbox],
      ['@huoli/huoli-session-projection', SessionProjectionRegistry],
      ['@huoli/huoli-sandbox-policy', SandboxPolicyService],
      ['@huoli/huoli-subprocess-local', LocalSubprocessRuntime],
      ['@huoli/huoli-terminal-bash', TerminalLocal],
      ['@huoli/huoli-tool-terminal', ToolPty],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const owner = await agent(context)
    const signal = new AbortController().signal
    const spawn = await executeToolFixture(context, {
      signal, callId: ToolCallId('spawn'), name: 'terminal_open', arguments: { type: 'shell', name: 'main', cwd: root }, agent: owner,
    })
    expect(resultText(spawn)).toContain('started terminal session pty-1 (main)')

    await executeToolFixture(context, {
      signal, callId: ToolCallId('state'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'export KEEP=loader; cd /' }, agent: owner,
    })
    const read = await executeToolFixture(context, {
      signal, callId: ToolCallId('read'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'printf "cwd=%s keep=%s\\n" "$PWD" "$KEEP"' }, agent: owner,
    })
    expect(resultText(read)).toContain('cwd=/ keep=loader')
    expect(context.terminals.list(owner)).toHaveLength(1)
  }, 15_000)
})
