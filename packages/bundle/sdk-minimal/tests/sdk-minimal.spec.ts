/** The standalone SDK-minimal bundle's complete declared Cordis tree. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@huoli/cordis-plugin-include'

function packageName(specifier: string): string {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!
}

describe('huoli-sdk-minimal bundle', () => {
  it('declares one standalone allowlisted tree with every row dependency', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      huoli?: { bundle?: { patch?: string } }
    }
    expect(manifest.huoli?.bundle?.patch).toBe('./cordis.patch.yml')
    const patches = yaml.load(
      readFileSync(resolve(root, manifest.huoli!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ insert?: Array<{ id?: string; inject?: string[]; name?: string; config?: Record<string, unknown>; disabled?: unknown }> }>
    expect(patches).toHaveLength(1)
    const rows = patches[0]?.insert ?? []
    expect(rows.map(row => [row.id, row.name])).toEqual([
      ['sdk-app-startup', '@huoli/huoli-sdk-app'],
      ['sdk-jsonrpc-server', '@huoli/huoli-sdk-jsonrpc-server'],
      ['deepseek-llm-api-extensions', '@huoli/huoli-deepseek-llm-api-extensions'],
      ['session-log-deepseek', '@huoli/huoli-session-log-deepseek'],
      ['plugin-package-inventory-deepseek', '@huoli/huoli-plugin-package-inventory-deepseek'],
      ['llm-deepseek', '@huoli/huoli-llm-deepseek-api-key'],
      ['sandbox', '@huoli/huoli-sandbox-local'],
      ['filesystem', '@huoli/huoli-fs-local'],
      ['attachment-local', '@huoli/huoli-attachment-local'],
      ['tool-fs', '@huoli/huoli-tool-fs'],
      ['working-directory', '@huoli/huoli-working-directory'],
      ['tool-working-directory', '@huoli/huoli-tool-working-directory'],
      ['session-projection', '@huoli/huoli-session-projection'],
      ['token-meter', '@huoli/huoli-token-meter'],
      ['compaction-basic', '@huoli/huoli-compaction-basic'],
      ['image-offload', '@huoli/huoli-compaction-image-offload'],
      ['sandbox-policy', '@huoli/huoli-sandbox-policy'],
      ['subprocess', '@huoli/huoli-subprocess-local'],
      ['pty', '@huoli/huoli-terminal'],
      ['terminal-bash', '@huoli/huoli-terminal-bash'],
      ['terminal-pwsh', '@huoli/huoli-terminal-bash'],
      ['timer', '@huoli/cordis-plugin-timer'],
      ['llm', '@huoli/huoli-llm'],
      ['session', '@huoli/huoli-session'],
      ['session-title', '@huoli/huoli-session-title'],
      ['system-prompt', '@huoli/huoli-system-prompt'],
      ['tools', '@huoli/huoli-tools'],
      ['tool-executor-native', '@huoli/huoli-tool-executor-native'],
      ['mcp-resources', '@huoli/huoli-mcp-resources'],
      ['agent', '@huoli/huoli-agent'],
      ['llm-retry', '@huoli/huoli-llm-retry'],
      ['jobs', '@huoli/huoli-jobs-local'],
      ['agent-loop', '@huoli/huoli-agent-loop'],
      ['persistent-bash', '@huoli/huoli-tool-bash-persistent'],
      ['persistent-pwsh', '@huoli/huoli-tool-pwsh-persistent'],
      ['sessions', '@huoli/huoli-session-persistence-jsonl'],
      ['session-checkpoint-policy', '@huoli/huoli-session-checkpoint-policy'],
    ])
    expect(rows.find(row => row.id === 'sdk-app-startup')?.config).toEqual({ profile: 'sdk-minimal' })
    expect(rows.find(row => row.id === 'sdk-jsonrpc-server')).toMatchObject({
      inject: ['sdkAppStartup', 'loader'],
      config: { maxTokensAsSuccess: false },
    })
    expect(rows.find(row => row.id === 'llm-deepseek')?.config).toEqual({
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      defaultContextWindow: { __jsExpr: 'Number(process.env.HUOLI_CONTEXT_WINDOW ?? 1000000)' },
      streamIdleTimeoutMs: 172800000,
    })
    expect(rows.find(row => row.id === 'system-prompt')?.config).toEqual({
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
      personaPrefix: { __jsExpr: "process.env.HUOLI_SYSTEM_PROMPT ?? 'You are a helpful software engineer assistant.'" },
    })
    expect(rows.find(row => row.id === 'agent-loop')?.config).toEqual({ agents: [] })
    expect(rows.find(row => row.id === 'tool-fs')?.config).toEqual({ read: false, readImage: true, write: false, edit: false })
    expect(rows.find(row => row.id === 'compaction-basic')?.config).toBeUndefined()
    expect(rows.find(row => row.id === 'terminal-bash')).toMatchObject({
      disabled: { __jsExpr: "process.platform === 'win32'" },
    })
    expect(rows.find(row => row.id === 'terminal-pwsh')).toMatchObject({
      disabled: { __jsExpr: "process.platform !== 'win32'" },
      config: { shellDialect: 'pwsh', timeoutMs: 300000 },
    })
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
      [...new Set(rows.map(row => row.name).filter((name): name is string => name !== undefined).map(packageName))].sort(),
    )
  })
})
