import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { Agent } from '@huoli/huoli-agent'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as applyBundle } from '../src/index.ts'
import { briefingLine, readBriefings } from '../src/facts.ts'

const GROUP = 'group:1'
const PRIVATE = 'private:9'
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-briefing-'))
  tempDirs.push(dir)
  return dir
}

function briefingIn(dir: string, table: Record<string, string> | undefined): { file: string; ledger: string } {
  const file = path.join(dir, 'qq-briefing.json')
  if (table !== undefined) fs.writeFileSync(file, JSON.stringify(table))
  return { file, ledger: path.join(dir, 'qq-briefing-sent.json') }
}

// 装配只需要提示词那一路，环境说明按当前会话键取
async function mount(
  dir: string,
  files: { file: string; ledger: string },
  patch: Record<string, unknown> = {},
): Promise<Context> {
  const ctx = new Context()
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})
  applyBundle(ctx, {
    maxSteps: 5,
    dailySweepAt: '04:00',
    modeFile: path.join(dir, 'mode.json'),
    decisionsFile: path.join(dir, 'decisions.jsonl'),
    timelineFile: path.join(dir, 'timeline.jsonl'),
    emergencyStopFile: path.join(dir, 'stop.json'),
    livenessFile: path.join(dir, 'liveness.json'),
    briefingFile: files.file,
    briefingLedgerFile: files.ledger,
    ...patch,
  })
  return ctx
}

async function briefingText(ctx: Context, chatKey: string): Promise<string> {
  const assembly = await ctx.systemPrompt.assemble({ agent: { id: chatKey } as Agent })
  return assembly.sections.find(section => section.name === 'qq:briefing')?.text ?? ''
}

describe('环境说明那张表', () => {
  it('一个会话一段，读不动或写坏的当没配', () => {
    const dir = tempDir()
    const files = briefingIn(dir, { [GROUP]: '  读书群，气氛松  ', [PRIVATE]: '' })
    fs.writeFileSync(path.join(dir, 'bad.json'), '不是 json')

    expect(readBriefings(files.file)).toEqual({ [GROUP]: '读书群，气氛松' })
    expect(readBriefings(path.join(dir, 'bad.json'))).toEqual({})
    expect(readBriefings(path.join(dir, '没有这份.json'))).toEqual({})
  })

  it('这句话只讲第一次进这个会话', () => {
    expect(briefingLine('这个群只在晚上热闹')).toContain('第一次进这个会话')
    expect(briefingLine('这个群只在晚上热闹')).toContain('这个群只在晚上热闹')
  })
})

describe('第一次进某个会话时的环境说明', () => {
  it('第一次唤醒时出现', async () => {
    const dir = tempDir()
    const ctx = await mount(dir, briefingIn(dir, { [GROUP]: '读书群，气氛松，晚上才热闹' }))

    const text = await briefingText(ctx, GROUP)

    expect(text).toContain('第一次进这个会话')
    expect(text).toContain('读书群，气氛松，晚上才热闹')
  })

  it('第二次就不再出现，同一个进程里只给一遍', async () => {
    const dir = tempDir()
    const ctx = await mount(dir, briefingIn(dir, { [GROUP]: '读书群，气氛松' }))
    expect(await briefingText(ctx, GROUP)).toContain('读书群')

    expect(await briefingText(ctx, GROUP)).toBe('')
  })

  it('别的会话各给各的，互不影响', async () => {
    const dir = tempDir()
    const ctx = await mount(dir, briefingIn(dir, { [GROUP]: '群里人多，说话快', [PRIVATE]: '私聊这位是熟人' }))

    expect(await briefingText(ctx, GROUP)).toContain('群里人多')
    expect(await briefingText(ctx, GROUP)).toBe('')
    expect(await briefingText(ctx, PRIVATE)).toContain('私聊这位是熟人')
    expect(await briefingText(ctx, PRIVATE)).toBe('')
  })

  it('没有这份文件、或表里没有这个会话时都不出现，也不报错', async () => {
    const missing = tempDir()
    const noFile = await mount(missing, briefingIn(missing, undefined))
    expect(await briefingText(noFile, GROUP)).toBe('')

    const partial = tempDir()
    const onlyOther = await mount(partial, briefingIn(partial, { [PRIVATE]: '私聊这位是熟人' }))
    expect(await briefingText(onlyOther, GROUP)).toBe('')
  })

  it('关掉开关就整段不挂', async () => {
    const dir = tempDir()
    const ctx = await mount(dir, briefingIn(dir, { [GROUP]: '读书群，气氛松' }), { briefingEnabled: false })

    const assembly = await ctx.systemPrompt.assemble({ agent: { id: GROUP } as Agent })

    expect(assembly.sections.map(section => section.name)).not.toContain('qq:briefing')
  })

  it('落盘之后重新装配也不再给', async () => {
    const dir = tempDir()
    const files = briefingIn(dir, { [GROUP]: '读书群，气氛松' })
    const first = await mount(dir, files)
    expect(await briefingText(first, GROUP)).toContain('读书群')
    expect(JSON.parse(fs.readFileSync(files.ledger, 'utf8')) as Record<string, number>).toHaveProperty(GROUP)

    const again = await mount(dir, files)

    expect(await briefingText(again, GROUP)).toBe('')
  })
})
