import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as applyBundle, BUNDLE_DEFAULTS, type Config } from '../src/index.ts'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-sweep-'))
  tempDirs.push(dir)
  return dir
}

interface Mounted {
  logs: string[]
}

// 只看装配期那一段日志：整理时刻写坏时应该留一行
async function mount(config: Config): Promise<Mounted> {
  const dir = tempDir()
  const ctx = new Context()
  const logs: string[] = []
  ctx.logger.exporter({ levels: { default: 3 }, export: ({ args }) => { logs.push(String(args[0])) } })
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})
  applyBundle(ctx, { maxSteps: 5, decisionsFile: path.join(dir, 'decisions.jsonl'), ...config })
  return { logs }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('每天整理的时刻', () => {
  it('按规范默认在零点二十', () => {
    expect(BUNDLE_DEFAULTS.dailySweepAt).toBe('00:20')
  })


  it('正常写法不记日志', async () => {
    const { logs } = await mount({ dailySweepAt: '03:15' })

    expect(logs.filter(line => line.includes('整理时刻'))).toHaveLength(0)
  })

  it('写坏了记一行，并按默认那一档算', async () => {
    const { logs } = await mount({ dailySweepAt: '25:99' })

    expect(logs.filter(line => line.includes('整理时刻')).length).toBeGreaterThan(0)
  })

  it('少给一半也认不出来，同样记一行', async () => {
    const { logs } = await mount({ dailySweepAt: '3' })

    expect(logs.filter(line => line.includes('整理时刻')).length).toBeGreaterThan(0)
  })
})
