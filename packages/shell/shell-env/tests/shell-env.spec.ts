/**
 * Registry tests for `@huoli/huoli-shell-env`: built-in facts, contributor
 * ownership and validation, collection ordering, effect-scoped disposal, and
 * the explicit disposer contract.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@huoli/cordis'
import { ToolCallId } from '@huoli/huoli-llm'
import type { Agent } from '@huoli/huoli-agent'
import { SESSION_FORMAT_VERSION } from '@huoli/huoli-session'
import type { ToolExecution } from '@huoli/huoli-tools'
import { ShellEnvRegistry } from '@huoli/huoli-shell-env'
import * as BashEnvPlugin from '@huoli/huoli-shell-env'

const testToolSignal = new AbortController().signal

afterEach(() => vi.unstubAllEnvs())

function execution(sessionId?: string): ToolExecution {
  return {
    signal: testToolSignal,
    token: Symbol('bash-env-test') as ToolExecution['token'],
    callId: ToolCallId('bash-env-call'),
    rootCallId: ToolCallId('bash-env-call'),
    name: 'bash',
    arguments: { command: 'true' },
    ...(sessionId === undefined
      ? {}
      : {
        agent: {
          session: {
            header: { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 0, isSeeded: false },
          },
        } as unknown as Agent,
      }),
  }
}

describe('ShellEnvRegistry', () => {
  it('collects unconditional shell facts and the current agent session id', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { huoliHome: './test-huoli-home' })

    expect(registry.collect(execution())).toEqual({
      HUOLI_HOME: resolve('./test-huoli-home'),
      HUOLI_SHELL: '1',
    })
    expect(registry.collect(execution('session-a'))).toEqual({
      HUOLI_HOME: resolve('./test-huoli-home'),
      HUOLI_SESSION_ID: 'session-a',
      HUOLI_SHELL: '1',
    })
  })

  it('collects the launcher-provided profile name and directory when a profile context exists', () => {
    const ctx = new Context()
    ctx.provide('profileContext', {
      name: 'web', dir: '/profiles/web', patchPath: '/profiles/web/cordis.patch.yml', installAnchor: '/huoli/package.json',
      cwd: '/work', home: '/home', startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
    })
    const registry = new ShellEnvRegistry(ctx, { huoliHome: './test-huoli-home' })
    expect(registry.collect(execution())).toMatchObject({ HUOLI_PROFILE: 'web', HUOLI_PROFILE_DIR: '/profiles/web' })
    expect(() => registry.register({
      name: 'profile-claimer',
      variables: { HUOLI_PROFILE: { description: 'Reserved key.' } },
      resolve: () => ({}),
    })).toThrow(/reserved key "HUOLI_PROFILE"/)
  })

  it('resolves HUOLI_HOME from the ambient override or the user-home default', () => {
    vi.stubEnv('HUOLI_HOME', './ambient-huoli-home')
    const fromEnvironment = new ShellEnvRegistry(new Context())
    expect(fromEnvironment.collect(execution()).HUOLI_HOME).toBe(resolve('./ambient-huoli-home'))

    vi.stubEnv('HUOLI_HOME', undefined)
    const fromDefault = new ShellEnvRegistry(new Context())
    expect(fromDefault.collect(execution()).HUOLI_HOME).toBe(join(homedir(), '.huoli'))
  })

  it('collects declared contributor variables and omits unavailable values', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { huoliHome: './test-huoli-home' })
    registry.register({
      name: 'optional-session-fact',
      variables: {
        HUOLI_SESSION_OPTIONAL: { description: 'Optional session-scoped test fact.' },
      },
      resolve: exec => exec.agent === undefined ? {} : { HUOLI_SESSION_OPTIONAL: exec.agent.session.header.id },
    })
    registry.register({
      name: 'always-available-fact',
      variables: {
        HUOLI_ALWAYS_AVAILABLE: { description: 'Always-available test fact.' },
      },
      resolve: () => ({ HUOLI_ALWAYS_AVAILABLE: 'yes' }),
    })

    expect(registry.collect(execution())).not.toHaveProperty('HUOLI_SESSION_OPTIONAL')
    expect(registry.collect(execution()).HUOLI_ALWAYS_AVAILABLE).toBe('yes')
    expect(registry.collect(execution('session-b')).HUOLI_SESSION_OPTIONAL).toBe('session-b')
    expect(registry.list()).toEqual([
      {
        contributor: 'always-available-fact',
        description: 'Always-available test fact.',
        key: 'HUOLI_ALWAYS_AVAILABLE',
      },
      {
        contributor: 'optional-session-fact',
        description: 'Optional session-scoped test fact.',
        key: 'HUOLI_SESSION_OPTIONAL',
      },
    ])
  })

  it('rejects duplicate variable ownership at registration time', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { huoliHome: './test-huoli-home' })
    registry.register({
      name: 'first',
      variables: { HUOLI_SHARED: { description: 'First owner.' } },
      resolve: () => ({ HUOLI_SHARED: 'first' }),
    })

    expect(() => registry.register({
      name: 'second',
      variables: { HUOLI_SHARED: { description: 'Second owner.' } },
      resolve: () => ({ HUOLI_SHARED: 'second' }),
    })).toThrow(/HUOLI_SHARED.*first.*second|HUOLI_SHARED.*second.*first/)
  })

  it('rejects duplicate contributor names and malformed declarations', () => {
    const registry = new ShellEnvRegistry(new Context(), { huoliHome: './test-huoli-home' })
    registry.register({
      name: 'declared',
      variables: { HUOLI_DECLARED: { description: 'Declared fact.' } },
      resolve: () => ({}),
    })

    expect(() => registry.register({
      name: 'declared',
      variables: { HUOLI_ANOTHER: { description: 'Another fact.' } },
      resolve: () => ({}),
    })).toThrow(/already registered/)
    expect(() => registry.register({
      name: ' ',
      variables: { HUOLI_BLANK_NAME: { description: 'Blank owner.' } },
      resolve: () => ({}),
    })).toThrow(/name must be non-empty/)
    expect(() => registry.register({
      name: 'invalid-key',
      variables: { huoli_invalid: { description: 'Invalid key.' } } as unknown as Record<'HUOLI_INVALID', { description: string }>,
      resolve: () => ({}),
    })).toThrow(/invalid key/)
    expect(() => registry.register({
      name: 'reserved-key',
      variables: { HUOLI_HOME: { description: 'Reserved key.' } },
      resolve: () => ({}),
    })).toThrow(/reserved key/)
    expect(() => registry.register({
      name: 'blank-description',
      variables: { HUOLI_BLANK_DESCRIPTION: { description: ' ' } },
      resolve: () => ({}),
    })).toThrow(/must describe/)
  })

  it('rejects undeclared variables returned by a contributor', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { huoliHome: './test-huoli-home' })
    registry.register({
      name: 'drifted-provider',
      variables: { HUOLI_DECLARED: { description: 'Declared fact.' } },
      resolve: () => ({ HUOLI_UNDECLARED: 'bad' }),
    })

    expect(() => registry.collect(execution())).toThrow(/drifted-provider.*HUOLI_UNDECLARED/)
  })

  it('rejects non-string values returned by a contributor', () => {
    const registry = new ShellEnvRegistry(new Context(), { huoliHome: './test-huoli-home' })
    registry.register({
      name: 'wrong-value-type',
      variables: { HUOLI_STRING: { description: 'String fact.' } },
      resolve: () => ({ HUOLI_STRING: 42 }) as unknown as Record<'HUOLI_STRING', string>,
    })

    expect(() => registry.collect(execution())).toThrow(/wrong-value-type.*non-string.*HUOLI_STRING/)
  })

  it('removes an effect-scoped contributor when its plugin is disposed', async () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { huoliHome: './test-huoli-home' })
    const fiber = await ctx.plugin({
      inject: ['shellEnv'],
      apply(inner: Context) {
        inner.shellEnv.register({
          name: 'temporary',
          variables: { HUOLI_TEMPORARY: { description: 'Temporary fact.' } },
          resolve: () => ({ HUOLI_TEMPORARY: 'present' }),
        })
      },
    })

    expect(registry.collect(execution()).HUOLI_TEMPORARY).toBe('present')
    await fiber.dispose()
    expect(registry.collect(execution())).not.toHaveProperty('HUOLI_TEMPORARY')
  })

  it('returns an explicit contributor disposer', () => {
    const registry = new ShellEnvRegistry(new Context(), { huoliHome: './test-huoli-home' })
    const dispose = registry.register({
      name: 'explicit-disposal',
      variables: { HUOLI_EXPLICIT_DISPOSAL: { description: 'Explicitly disposed fact.' } },
      resolve: () => ({ HUOLI_EXPLICIT_DISPOSAL: 'present' }),
    })

    expect(registry.collect(execution()).HUOLI_EXPLICIT_DISPOSAL).toBe('present')
    dispose()
    expect(registry.collect(execution())).not.toHaveProperty('HUOLI_EXPLICIT_DISPOSAL')
  })

  it('the plugin registers the service with no contributors on load', async () => {
    const ctx = new Context()
    await ctx.plugin(BashEnvPlugin)
    expect(ctx.shellEnv).toBeInstanceOf(ShellEnvRegistry)
    expect(ctx.shellEnv.list()).toEqual([])
  })
})
