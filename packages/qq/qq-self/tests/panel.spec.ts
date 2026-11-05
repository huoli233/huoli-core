import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { Agent } from '@huoli/huoli-agent'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqSelfOf, type Config, type QqSelfSeam } from '../src/index.ts'
import { panelBody } from '../src/panel.ts'

const roots: string[] = []
const LABELS = ['【自我】', '此刻：', '我在做：', '我想弄明白：', '我可以说不']

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-'))
  roots.push(root)
  return path.join(root, 'self')
}

async function mount(config: Config): Promise<{ ctx: Context; seam: QqSelfSeam }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  // 这一层的行为用例不靠工具跑，给一个空的登记口就够
  ctx.provide('tools', { register: () => () => {} })
  apply(ctx, config)
  const seam = qqSelfOf(ctx)
  if (seam === undefined) throw new Error('这一层没有装配')
  return { ctx, seam }
}

async function panelOf(ctx: Context, id: string): Promise<string> {
  const assembly = await ctx.systemPrompt.assemble({ agent: { id } as Agent })
  return assembly.variables.qq_self_panel ?? ''
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('面板', () => {
  it('不超过三百字，只写此刻与那三句', async () => {
    const { seam } = await mount({ enabled: true, dir: tempDir(), mainChatKey: 'group:1' })
    seam.useVitals({ render: () => '嗓子发干，想喝水。' })
    seam.recordProject({ title: '把周报写成一句', next: '先列三条', failIf: '两周还没列完' }, Date.now())
    seam.recordQuestion('为什么夜里更想说话', Date.now())

    const text = seam.panel()

    expect(text.length).toBeLessThanOrEqual(300)
    const lines = text.split('\n')
    expect(lines[0]).toBe('【自我】')
    for (const line of lines) {
      expect(LABELS.some(label => line.startsWith(label))).toBe(true)
    }
    expect(text).not.toContain('你是')
    expect(text).not.toContain('说话简短')
    expect(text).toContain('为什么夜里更想说话')
    expect(text).toContain('先列三条')
  })

  it('此刻原样用身体给的那一句', async () => {
    const { seam } = await mount({ enabled: true, dir: tempDir(), mainChatKey: 'group:1' })
    seam.useVitals({ render: () => '身上沉，眼皮抬不起来。' })

    expect(seam.panel()).toBe('【自我】\n此刻：身上沉，眼皮抬不起来。\n我可以说不，也可以说不知道。')
  })

  it('没接身体就没此刻那一行', async () => {
    const { seam } = await mount({ enabled: true, dir: tempDir(), mainChatKey: 'group:1' })

    const text = seam.panel()

    expect(text).not.toContain('此刻：')
    expect(text).toContain('我可以说不')
  })

  it('身体那句太长就整行省掉', async () => {
    const { seam } = await mount({ enabled: true, dir: tempDir(), mainChatKey: 'group:1' })
    seam.useVitals({ render: () => '长'.repeat(200) })

    const text = seam.panel()

    expect(text).not.toContain('此刻：')
    expect(text.length).toBeLessThanOrEqual(300)
  })

  it('面板文件首行写生成时间，正文能原样读回', async () => {
    const dir = tempDir()
    const { seam } = await mount({ enabled: true, dir, mainChatKey: 'group:1' })

    const text = seam.panel()
    const raw = fs.readFileSync(path.join(dir, 'panel.md'), 'utf8')

    expect(raw.startsWith('<!-- generated_at: ')).toBe(true)
    expect(panelBody(raw)).toBe(text)
  })

  it('同一会话两轮逐字相同，文件不重写', async () => {
    const dir = tempDir()
    const { ctx } = await mount({ enabled: true, dir, mainChatKey: 'group:1' })

    const first = await panelOf(ctx, 'group:1')
    const before = fs.statSync(path.join(dir, 'panel.md')).mtimeMs
    const seventh = await panelOf(ctx, 'group:1')
    const after = fs.statSync(path.join(dir, 'panel.md')).mtimeMs

    expect(first).not.toBe('')
    expect(seventh).toBe(first)
    expect(after).toBe(before)
  })

  it('别的会话拿到空串', async () => {
    const { ctx } = await mount({ enabled: true, dir: tempDir(), mainChatKey: 'group:1' })

    expect(await panelOf(ctx, 'group:2')).toBe('')
    expect(await panelOf(ctx, 'private:9')).toBe('')
  })

  it('宪法八条，前三条带两把钥匙', async () => {
    const dir = tempDir()
    const { seam } = await mount({ enabled: true, dir, mainChatKey: 'group:1' })

    seam.panel()
    const lines = fs.readFileSync(path.join(dir, 'constitution.md'), 'utf8').trimEnd().split('\n')

    expect(lines).toHaveLength(8)
    expect(lines.slice(0, 3).every(line => line.endsWith('｜两把钥匙'))).toBe(true)
    expect(lines.slice(3).some(line => line.includes('两把钥匙'))).toBe(false)
  })

  it('装不下就先省整行，省到只剩标题与收尾', async () => {
    const { seam } = await mount({ enabled: true, dir: tempDir(), mainChatKey: 'group:1', settings: { panelMaxChars: 40 } })
    seam.useVitals({ render: () => '嗓子发干。' })
    seam.recordProject({ title: '把周报写成一句', next: '先列三条', failIf: '两周没动' }, Date.now())
    seam.recordQuestion('为什么夜里更想说话', Date.now())

    const text = seam.panel()

    expect(text.length).toBeLessThanOrEqual(40)
    expect(text.split('\n')).toEqual(['【自我】', '此刻：嗓子发干。', '我可以说不，也可以说不知道。'])
  })

  it('预算再小就连此刻也省掉', async () => {
    const { seam } = await mount({ enabled: true, dir: tempDir(), mainChatKey: 'group:1', settings: { panelMaxChars: 20 } })
    seam.useVitals({ render: () => '嗓子发干。' })

    expect(seam.panel().split('\n')).toEqual(['【自我】', '我可以说不，也可以说不知道。'])
  })

  it('预算比标题还小就截断', async () => {
    const { seam } = await mount({ enabled: true, dir: tempDir(), mainChatKey: 'group:1', settings: { panelMaxChars: 10 } })

    expect(seam.panel().length).toBeLessThanOrEqual(10)
  })

  it('身体那边抛错时这一段给空串，且不再重试', async () => {
    const { ctx, seam } = await mount({ enabled: true, dir: tempDir(), mainChatKey: 'group:1' })
    seam.useVitals({ render: () => { throw new Error('身体那边不给了') } })

    expect(await panelOf(ctx, 'group:1')).toBe('')
    expect(await panelOf(ctx, 'group:1')).toBe('')
  })

  it('项目没说下一步就只写我在做', async () => {
    const { seam } = await mount({ enabled: true, dir: tempDir(), mainChatKey: 'group:1' })
    seam.recordProject({ title: '把周报写成一句', next: '', failIf: '两周没动' }, Date.now())

    const lines = seam.panel().split('\n')

    expect(lines[1]).toBe('我在做：把周报写成一句')
  })

  it('换一个进程先用手上那份文件', async () => {
    const dir = tempDir()
    const first = await mount({ enabled: true, dir, mainChatKey: 'group:1' })
    const body = first.seam.panel()
    const before = fs.statSync(path.join(dir, 'panel.md')).mtimeMs

    const second = await mount({ enabled: true, dir, mainChatKey: 'group:1' })

    expect(second.seam.panel()).toBe(body)
    expect(fs.statSync(path.join(dir, 'panel.md')).mtimeMs).toBe(before)
  })

  it('面板正文取不回来时给空串，末尾没换行也认', () => {
    expect(panelBody('只有一行')).toBe('')
    expect(panelBody('<!-- generated_at: x -->\n正文')).toBe('正文')
    expect(panelBody('<!-- generated_at: x -->\n正文\n')).toBe('正文')
  })

  it('文件里的面板是空的就重做一份', async () => {
    const dir = tempDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'panel.md'), '<!-- generated_at: 2026-01-01T00:00:00.000Z -->\n\n')

    const { seam } = await mount({ enabled: true, dir, mainChatKey: 'group:1' })

    expect(seam.panel()).toContain('【自我】')
    expect(seam.panel()).toContain('我可以说不')
  })

  it('卸载之后这一层就取不到了', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    let inner: Context | undefined
    const fiber = ctx.plugin({
      name: 'qq-self-probe',
      inject: ['systemPrompt'],
      apply: (context: Context) => {
        inner = context
        apply(context, { enabled: true, dir: tempDir(), mainChatKey: 'group:1' })
      },
    })
    await fiber

    expect(inner === undefined ? undefined : qqSelfOf(inner)).toBeDefined()
    await fiber.dispose()
    expect(inner === undefined ? undefined : qqSelfOf(inner)).toBeUndefined()
  })
})

describe('关着的时候', () => {
  it('不注入，也不建任何文件', async () => {
    const dir = tempDir()
    const { ctx, seam } = await mount({ enabled: false, dir, mainChatKey: 'group:1' })

    const assembly = await ctx.systemPrompt.assemble({ agent: { id: 'group:1' } as Agent })

    expect(assembly.sections.some(section => section.name === 'qq:self-layer')).toBe(false)
    expect(Object.hasOwn(assembly.variables, 'qq_self_panel')).toBe(false)
    expect(seam.panel()).toBe('')
    expect(seam.recordDrive('thirst', Date.now())).toEqual({ written: false, proposed: false, reason: 'disabled' })
    expect(seam.recordAgency('p1', '想把夜里那句话记下来', Date.now()))
      .toEqual({ written: false, proposed: false, reason: 'disabled' })
    expect(seam.recordProject({ title: '记一句话', next: '先写一句', failIf: '两周没动' }, Date.now()))
      .toEqual({ written: false, proposed: false, reason: 'disabled' })
    expect(seam.recordQuestion('为什么夜里更想说话', Date.now()))
      .toEqual({ written: false, proposed: false, reason: 'disabled' })
    expect(seam.recordCommitment({ text: '周末把歌单给她' }, Date.now()))
      .toEqual({ written: false, proposed: false, reason: 'disabled' })
    expect(seam.recordClaim({ text: '夜里她更想说话', confidence: 0.7, evidence: ['m1'] }, Date.now()))
      .toEqual({ written: false, proposed: false, reason: 'disabled' })
    expect(seam.requireKeys('money.spend', true, true)).toMatchObject({ allowed: true, proposed: false })
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('不给开关就是关着', async () => {
    const { ctx, seam } = await mount({ dir: tempDir(), mainChatKey: 'group:1' })

    const assembly = await ctx.systemPrompt.assemble({ agent: { id: 'group:1' } as Agent })

    expect(assembly.sections.some(section => section.name === 'qq:self-layer')).toBe(false)
    expect(seam.panel()).toBe('')
  })
})

describe('落在哪', () => {
  it('不给目录就落在数据根目录下的 data/qq-self', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-home-'))
    roots.push(root)

    const { seam } = await mount({ enabled: true, huoliHome: root, mainChatKey: 'group:1' })

    expect(seam.dir).toBe(path.join(root, 'data', 'qq-self'))
  })

  it('没配主会话就哪个会话都不给', async () => {
    const { ctx } = await mount({ enabled: true, dir: tempDir() })

    expect(await panelOf(ctx, 'group:1')).toBe('')
    expect(await panelOf(ctx, '')).toBe('')
  })
})
