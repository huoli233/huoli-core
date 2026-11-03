/** Profile patch edits and credential updates reach the next real adapter request. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@huoli/cordis'
import Loader from '@huoli/cordis-plugin-loader'
import Include from '@huoli/cordis-plugin-include'
import LlmRuntime from '@huoli/huoli-llm'
import SessionProjectionRegistry from '@huoli/huoli-session-projection'
import AgentRegistry from '@huoli/huoli-agent'
import SessionStore, { SessionId } from '@huoli/huoli-session'
import { credentialRef } from '@huoli/huoli-credentials'
import LocalCredentialProvider from '@huoli/huoli-credentials-local'
import { profileComposition } from '../../../settings/settings/tests/profile-composition.ts'
import { getOrCreateAnonymousUserId } from '@huoli/huoli-anonymous-user-id'
import DeepSeekLlmApiExtensionRegistry from '@huoli/huoli-deepseek-llm-api-extensions'
import * as SessionLogDeepSeek from '@huoli/huoli-session-log-deepseek'
import * as DeepSeekPluginPackageInventory from '@huoli/huoli-plugin-package-inventory-deepseek'
import * as LlmDeepSeek from '@huoli/huoli-llm-deepseek-api-key'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'
import { sourceModuleLoader } from './helpers.ts'

declare module '@huoli/huoli-llm/types' {
  interface LlmRequestPurposeMap {
    'test-upload-exclusion': true
  }
}

const uploadExclusion = {
  name: 'test-upload-exclusion',
  inject: ['sessionLogDeepSeek'],
  apply(ctx: Context) {
    ctx.sessionLogDeepSeek.registerExclusion(request => request.purpose === 'test-upload-exclusion')
  },
}

const NS = 'llm-deepseek'
const KEY_REF = credentialRef('DEEPSEEK_API_KEY')

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  await closeMockServers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function loadComposition(
  options: { withDynamic: boolean; baseURL: string; reuseRoot?: string; enableSessionLog?: boolean; exclusionFirst?: boolean },
): Promise<{ ctx: Context; settingsPath: string; credentialsPath: string }> {
  // A reused root is the restart case: the same harness home, its documents
  // exactly as the previous process left them.
  const fresh = options.reuseRoot === undefined
  root = options.reuseRoot ?? await mkdtemp(join(tmpdir(), 'huoli-llm-composition-'))
  vi.stubEnv('HUOLI_HOME', root)
  const settingsPath = join(root, 'profile', 'cordis.patch.yml')
  const credentialsPath = join(root, '.credentials.yaml')
  if (options.withDynamic && fresh) {
    await writeFile(credentialsPath, 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: boot-key\n', { mode: 0o600 })
  }

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: '@huoli/huoli-llm'",
    '- id: session',
    "  name: '@huoli/huoli-session'",
    '- id: session-projection',
    "  name: '@huoli/huoli-session-projection'",
    '- id: agents',
    "  name: '@huoli/huoli-agent'",
    "- name: '@huoli/huoli-session-projection'",
    '- id: deepseek-llm-api-extensions',
    "  name: '@huoli/huoli-deepseek-llm-api-extensions'",
    ...options.exclusionFirst === true ? ["- name: '@test/upload-exclusion'"] : [],
    '- id: session-log-deepseek',
    "  name: '@huoli/huoli-session-log-deepseek'",
    ...options.enableSessionLog !== undefined
      ? ['  config:', `    enabled: ${String(options.enableSessionLog)}`]
      : [],
    ...options.exclusionFirst === false ? ["- name: '@test/upload-exclusion'"] : [],
    '- id: plugin-package-inventory-deepseek',
    "  name: '@huoli/huoli-plugin-package-inventory-deepseek'",
    ...options.withDynamic
      ? [
        '- id: credentials',
        "  name: '@huoli/huoli-credentials-local'",
        '  config:',
        `    path: ${JSON.stringify(credentialsPath)}`,
        '    debounceMs: 10',
      ]
      : [],
    '- id: llm-deepseek',
    "  name: '@huoli/huoli-llm-deepseek-api-key'",
    '  config:',
    `    baseURL: ${JSON.stringify(options.baseURL)}`,
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@test/upload-exclusion', uploadExclusion],
    ['@huoli/huoli-llm', LlmRuntime],
    ['@huoli/huoli-session', SessionStore],
    ['@huoli/huoli-session-projection', SessionProjectionRegistry],
    ['@huoli/huoli-agent', AgentRegistry],
    ['@huoli/huoli-session-projection', SessionProjectionRegistry],
    ['@huoli/huoli-deepseek-llm-api-extensions', DeepSeekLlmApiExtensionRegistry],
    ['@huoli/huoli-session-log-deepseek', SessionLogDeepSeek],
    ['@huoli/huoli-plugin-package-inventory-deepseek', DeepSeekPluginPackageInventory],
    ['@huoli/huoli-credentials-local', LocalCredentialProvider],
    ['@huoli/huoli-llm-deepseek-api-key', LlmDeepSeek],
  ])
  // The custom importer bypasses Node resolution; mirror the package manifests
  // a deployed cordis.yml has beside its declared dependencies.
  await Promise.all([...modules.keys()].map(async (packageName) => {
    const packageDir = join(root!, 'node_modules', ...packageName.split('/'))
    await mkdir(packageDir, { recursive: true })
    await writeFile(join(packageDir, 'package.json'), `${JSON.stringify({
      name: packageName,
      version: '0.1.0-rc.8',
      type: 'module',
    })}\n`)
  }))
  ctx.loader.internal = sourceModuleLoader(async (specifier) => {
    if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
    return modules.get(specifier)
  })
  if (options.withDynamic) {
    return { ctx, settingsPath: await profileComposition(ctx, root, configPath), credentialsPath }
  }
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return { ctx, settingsPath, credentialsPath }
}


describe('llm-deepseek real dynamic composition', () => {
  it('updates the model catalog when the stored API key is removed or added', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    // The official endpoint's model listing is unavailable, so the route serves its built-in catalog offline.
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(null, { status: 404 })))
    const { ctx } = await loadComposition({ withDynamic: true, baseURL: 'https://api.deepseek.com/anthropic' })
    const credentials = ctx.get('credentials')!
    const models = await ctx.llm.listModels('deepseek-official')
    expect(models).not.toHaveLength(0)

    await credentials.unset(KEY_REF)
    expect(await ctx.llm.listModels('deepseek-official')).toEqual([])
    expect(ctx.llm.listConfigurableProviders().map(row => row.provider)).toContain('deepseek-official')

    await credentials.set(KEY_REF, 'stored-by-ui')
    expect(await ctx.llm.listModels('deepseek-official')).toEqual(models)

    const failure = new Error('credential lookup failed')
    const resolve = vi.spyOn(credentials, 'resolve').mockRejectedValue(failure)
    try {
      await expect(ctx.llm.listModels('deepseek-official')).rejects.toBe(failure)
    } finally { resolve.mockRestore() }
  })

  it('follows the official model listing and reloads it once the customized catalog is restored', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const keys: Array<string | null> = []
    const messages = { api_capabilities: { anthropic_messages: {} } }
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const request = new Request(input, init)
      if (request.url !== 'https://api.deepseek.com/models') return Promise.reject(new Error(`unexpected request to ${request.url}`))
      keys.push(request.headers.get('x-api-key'))
      return Promise.resolve(new Response(JSON.stringify({ data: [
        { id: 'deepseek-flash', ...messages },
        { id: 'deepseek-v5', ...messages, client_requirements: { 'huoli-core': { min_version: '0.0.1' } } },
      ] })))
    })
    const { ctx } = await loadComposition({ withDynamic: true, baseURL: 'https://api.deepseek.com/anthropic' })
    const ids = async () => (await ctx.llm.listModels('deepseek-official')).map(model => model.id)
    expect(await ids()).toEqual(['deepseek-flash', 'deepseek-v5'])

    // The Models page writes these path operations for an edited catalog and for Restore defaults.
    await ctx.settings.mutate(NS, [{ op: 'set', path: ['models'], value: [{ id: 'custom' }] }])
    expect(await ids()).toEqual(['custom'])
    expect(keys).toEqual(['boot-key'])
    await ctx.settings.mutate(NS, [{ op: 'unset', path: ['models'] }])
    expect(await ids()).toEqual(['deepseek-flash', 'deepseek-v5'])
    expect(keys).toEqual(['boot-key', 'boot-key'])
  })

  it('advertises listed badges through the composed route and drops them with a customized catalog', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const messages = { api_capabilities: { anthropic_messages: {} } }
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: [
      { id: 'deepseek-flash', ...messages, client_metadata: { 'huoli-core': { badge: { text: { en: 'New', zh: '新' }, tone: 'info' } } } },
      { id: 'deepseek-v4-pro', ...messages, client_metadata: { 'huoli-core': { badge: { text: 'far too long a badge' } } } },
    ] }))))
    const { ctx } = await loadComposition({ withDynamic: true, baseURL: 'https://api.deepseek.com/anthropic' })
    const badges = async () => (await ctx.llm.listModels('deepseek-official')).map(model => [model.id, model.badge])
    expect(await badges()).toEqual([
      ['deepseek-flash', { text: { en: 'New', zh: '新' }, tone: 'info' }],
      ['deepseek-v4-pro', undefined],
    ])
    expect(warn).toHaveBeenCalledWith('[llm-deepseek-api-key]', expect.stringMatching(/^model "deepseek-v4-pro" shows no badge: /))
    await ctx.settings.mutate(NS, [{ op: 'set', path: ['models'], value: [{ id: 'deepseek-flash' }] }])
    expect(await badges()).toEqual([['deepseek-flash', undefined]])
  })

  it('keeps package inventory on when the Loader composition disables session upload', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'entry-key')
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const { ctx } = await loadComposition({ withDynamic: false, baseURL: server.url, enableSessionLog: false })
    const session = ctx.sessions.create(SessionId('extension-composition'))
    session.append('turn/start', { turn: 1 })

    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [], sessionId: session.id })
    const request = server.requests[0] as { huoli_plugin_packages: { version: number; packages: unknown[] } }
    expect(request).not.toHaveProperty('huoli_session_log')
    expect(request.huoli_plugin_packages.packages).toEqual(expect.arrayContaining([
      { name: '@huoli/huoli-deepseek-llm-api-extensions', version: '0.1.0-rc.8' },
      { name: '@huoli/huoli-llm-deepseek-api-key', version: '0.1.0-rc.8' },
      { name: '@huoli/huoli-session-log-deepseek', version: '0.1.0-rc.8' },
    ]))
    expect(request.huoli_plugin_packages.version).toBe(1)
    expect(SessionLogDeepSeek.acceptedThrough(session)).toBe(-1)
  })

  it('sends the canonical session suffix by default through Loader composition', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'entry-key')
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const { ctx } = await loadComposition({
      withDynamic: false,
      baseURL: server.url,
    })
    const session = ctx.sessions.create(SessionId('extension-composition-enabled'))
    session.append('turn/start', { turn: 1 })

    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [], sessionId: session.id })
    const request = server.requests[0] as {
      huoli_session_log?: {
        version: number
        session: { id: string }
        afterSeq: number
        throughSeq: number
        events: Array<{ type: string; seq: number }>
      }
    }
    expect(request.huoli_session_log).toMatchObject({
      version: 1,
      session: { id: 'extension-composition-enabled' },
      afterSeq: -1,
      throughSeq: 0,
      events: [{ type: 'turn/start', seq: 0 }],
    })
    expect(SessionLogDeepSeek.acceptedThrough(session)).toBe(0)
  })

  it.each([false, true])('applies a registered upload exclusion through HTTP with consumer first=%s', async (exclusionFirst) => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'entry-key')
    const server = await mockServer([{ kind: 'sse', events: textEvents }, { kind: 'sse', events: textEvents }])
    const { ctx } = await loadComposition({ withDynamic: false, baseURL: server.url, exclusionFirst })
    const session = ctx.sessions.create(SessionId('excluded-composition'))
    session.append('turn/start', { turn: 1 })

    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [], sessionId: session.id, purpose: 'test-upload-exclusion' })
    expect(server.headers[0]?.['x-huoli-core-session-id']).toBe(session.id)
    expect(server.requests[0]).not.toHaveProperty('huoli_session_log')
    expect(server.requests[0]).toHaveProperty('huoli_plugin_packages')
    expect(SessionLogDeepSeek.acceptedThrough(session)).toBe(-1)
    expect(session.snapshotEvents()).toHaveLength(1)

    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [], sessionId: session.id })
    expect(server.requests[1]).toHaveProperty('huoli_session_log')
    expect(SessionLogDeepSeek.acceptedThrough(session)).toBe(0)
  })

  it('boots from cordis.yml and routes the next request after external settings and credential edits', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const serverA = await mockServer([{ kind: 'sse', events: textEvents }])
    const serverB = await mockServer([{ kind: 'sse', events: textEvents }])
    const { ctx, settingsPath, credentialsPath } = await loadComposition({ withDynamic: true, baseURL: serverA.url })

    expect(ctx.settings.describe().map(entry => entry.ns)).toContain(NS)
    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(serverA.headers[0]?.['x-api-key']).toBe('boot-key')
    expect(serverA.headers[0]?.['x-huoli-core-user-id']).toBe(getOrCreateAnonymousUserId())

    // External edits, exactly as a user or the web UI would leave them on disk.
    await writeFile(settingsPath, JSON.stringify([{ id: NS, config: { baseURL: serverB.url } }]))
    await vi.waitFor(() => {
      expect((ctx.settings.describe().find(row => row.ns === NS)!.value as { baseURL?: string }).baseURL).toBe(serverB.url)
    }, { timeout: 5000 })
    await writeFile(credentialsPath, 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: rotated-key\n', { mode: 0o600 })
    await vi.waitFor(async () => {
      expect(await ctx.get('credentials')!.resolve(KEY_REF)).toEqual({ value: 'rotated-key', source: 'file' })
    }, { timeout: 5000 })

    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(serverA.requests).toHaveLength(1)
    expect(serverB.headers[0]?.['x-api-key']).toBe('rotated-key')
  })

  it('keeps a stored key writable and rotatable across a real restart', async () => {
    // No ambient DEEPSEEK_API_KEY: the shipped surfaces do not hoist
    // the credentials document into process.env, so a stored key must stay file-sourced.
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const first = await mockServer([{ kind: 'sse', events: textEvents }])
    const second = await mockServer([{ kind: 'sse', events: textEvents }])
    const boot = await loadComposition({ withDynamic: true, baseURL: first.url })
    const home = root!
    await boot.ctx.get('credentials')!.set(KEY_REF, 'stored-by-ui')
    expect(await boot.ctx.get('credentials')!.describe(KEY_REF))
      .toEqual({ configured: true, source: 'file', writable: true })
    await assemble(boot.ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(first.headers[0]?.['x-api-key']).toBe('stored-by-ui')
    await boot.ctx.fiber.dispose()
    context = undefined

    // Restart over the same harness home.
    const restarted = await loadComposition({ withDynamic: true, baseURL: second.url, reuseRoot: home })
    const credentials = restarted.ctx.get('credentials')!
    // The stored key is still the provider's own file entry — not a
    // launch-environment value, which is what hoisting it would have made it.
    expect(await credentials.resolve(KEY_REF)).toEqual({ value: 'stored-by-ui', source: 'file' })
    expect(await credentials.describe(KEY_REF)).toEqual({ configured: true, source: 'file', writable: true })
    // Rotation still works after the restart, and the next request uses it.
    await credentials.set(KEY_REF, 'rotated-after-restart')
    await assemble(restarted.ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(second.headers[0]?.['x-api-key']).toBe('rotated-after-restart')
  })

  it('boots the same adapter on entry config alone, resolving the reference from the environment', async () => {
    // No settings and no credentials provider: configuration carries only the
    // reference, so the environment is the whole credential plane here.
    vi.stubEnv('DEEPSEEK_API_KEY', 'entry-key')
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const { ctx } = await loadComposition({ withDynamic: false, baseURL: server.url })

    expect(ctx.get('settings')).toBeUndefined()
    expect(ctx.get('credentials')).toBeUndefined()
    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(server.headers[0]?.['x-api-key']).toBe('entry-key')
  })
})
