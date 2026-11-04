import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSettings } from '../src/defaults.ts'
import { generatePanelFile } from '../src/generate.ts'
import { apply, qqSelfOf, type QqSelfSeam } from '../src/index.ts'
import { updateNarrative, seedNarrative } from '../src/narrative.ts'
import { createSelfStore, type SelfStore } from '../src/store.ts'
import type { SelfSettings } from '../src/types.ts'

const roots: string[] = []

// 演练的起点时刻，落在整分钟上，版本名的时间戳好对
const AT = Date.UTC(2026, 10, 4, 2, 30)
const MINUTE = 60_000

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-versions-'))
  roots.push(root)
  return path.join(root, 'self')
}

function openStore(dir: string, overrides?: Partial<SelfSettings>): SelfStore {
  return createSelfStore({ dir, settings: resolveSettings(overrides) })
}

async function mount(dir: string, settings?: Partial<SelfSettings>, enabled = true): Promise<QqSelfSeam> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  apply(ctx, { enabled, dir, mainChatKey: 'group:1', ...(settings === undefined ? {} : { settings }) })
  const seam = qqSelfOf(ctx)
  if (seam === undefined) throw new Error('这一层没有装配')
  return seam
}

function read(dir: string, name: string): string {
  return fs.readFileSync(path.join(dir, name), 'utf8')
}

function write(dir: string, name: string, text: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), text)
}

function keptText(dir: string, name: string): string {
  return fs.readFileSync(path.join(dir, 'versions', name), 'utf8')
}

// 只生成一份面板，正文固定，内容差别全靠首行的生成时间
function paintPanel(store: SelfStore, settings: SelfSettings, at: number, body?: string): string {
  if (body !== undefined) {
    store.writePanel(body, at)
    return body
  }
  generatePanelFile({ store, settings, at })
  return read(store.dir, 'panel.md')
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('版本存档', () => {
  it('面板重写前留一份带时间戳的旧版，列表按时间倒序', () => {
    const dir = tempDir()
    const settings = resolveSettings()
    const store = openStore(dir)

    paintPanel(store, settings, AT)
    const first = read(dir, 'panel.md')
    paintPanel(store, settings, AT + MINUTE)
    paintPanel(store, settings, AT + 2 * MINUTE)

    const entries = store.listVersions('panel')
    expect(entries).toHaveLength(2)
    expect(entries[0]?.name).toMatch(/^panel-\d{8}-\d{4}(?:-\d+)?\.md$/)
    expect(entries.every(entry => entry.kind === 'panel')).toBe(true)
    expect(entries[0]?.at).toBe(AT + 2 * MINUTE)
    expect(entries[1]?.at).toBe(AT + MINUTE)
    expect(entries[0]?.at).toBeGreaterThan(entries[1]?.at ?? 0)
    expect(entries[1]?.bytes).toBe(Buffer.byteLength(first))
    expect(keptText(dir, entries[1]?.name ?? '')).toBe(first)
  })

  it('叙事重写前留一份带时间戳的旧版', () => {
    const dir = tempDir()
    const settings = resolveSettings()
    const store = openStore(dir)

    seedNarrative(store, 1_000)
    const skeleton = read(dir, 'narrative.md')
    updateNarrative(store, settings, '我是谁', '我叫她别硬撑', 2_000)

    const entries = store.listVersions('narrative')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toMatch(/^narrative-\d{8}-\d{4}(?:-\d+)?\.md$/)
    expect(entries[0]?.kind).toBe('narrative')
    expect(keptText(dir, entries[0]?.name ?? '')).toBe(skeleton)
  })

  it('还没重写过就一份版本都没有，目录也不建', () => {
    const dir = tempDir()
    const settings = resolveSettings()
    const store = openStore(dir)

    paintPanel(store, settings, AT)

    expect(store.listVersions('panel')).toEqual([])
    expect(store.listVersions('narrative')).toEqual([])
    expect(fs.existsSync(path.join(dir, 'versions'))).toBe(false)
  })

  it('版本份数进默认值表', () => {
    expect(resolveSettings().versionsKeep).toBe(20)
  })
})

describe('改坏再回滚演练', () => {
  it('面板被截断：回滚后逐字恢复，坏内容也留成一份版本', () => {
    const dir = tempDir()
    const settings = resolveSettings()
    const store = openStore(dir)

    paintPanel(store, settings, AT)
    const good = read(dir, 'panel.md')
    paintPanel(store, settings, AT + MINUTE)
    const current = read(dir, 'panel.md')
    const broken = current.slice(0, 12)
    write(dir, 'panel.md', broken)

    const entries = store.listVersions('panel')
    expect(entries).toHaveLength(1)
    const rolled = store.rollback('panel', entries[0]?.name ?? '')

    expect(rolled.ok).toBe(true)
    expect(rolled.restoredFrom).toBe(entries[0]?.name)
    expect(rolled.savedCurrent).toBeDefined()
    expect(read(dir, 'panel.md')).toBe(good)
    expect(store.verifyAfterRollback('panel', entries[0]?.name ?? '')).toEqual({ same: true, line: 0 })

    const after = store.listVersions('panel')
    expect(after).toHaveLength(2)
    expect(after[0]?.name).toBe(rolled.savedCurrent)
    expect(keptText(dir, rolled.savedCurrent ?? '')).toBe(broken)
  })

  it('面板被改字：核对先指出首处不同行号，回滚后逐字相同', () => {
    const dir = tempDir()
    const settings = resolveSettings()
    const store = openStore(dir)
    const good = '【自我】\n此刻：今天有点累\n我可以说不，也可以说不知道。\n'

    write(dir, 'panel.md', good)
    paintPanel(store, settings, AT)
    write(dir, 'panel.md', good.replace('今天有点累', '今天很糟糕'))
    const [entry] = store.listVersions('panel')

    expect(store.verifyAfterRollback('panel', entry?.name ?? '')).toEqual({ same: false, line: 2 })
    store.rollback('panel', entry?.name ?? '')

    expect(read(dir, 'panel.md')).toBe(good)
    expect(store.verifyAfterRollback('panel', entry?.name ?? '')).toEqual({ same: true, line: 0 })
  })

  it('面板被清空：回滚照旧恢复，空版本本身不许再回滚', () => {
    const dir = tempDir()
    const settings = resolveSettings()
    const store = openStore(dir)

    paintPanel(store, settings, AT)
    const good = read(dir, 'panel.md')
    paintPanel(store, settings, AT + MINUTE)
    write(dir, 'panel.md', '')

    const [entry] = store.listVersions('panel')
    const rolled = store.rollback('panel', entry?.name ?? '')

    expect(rolled.ok).toBe(true)
    expect(read(dir, 'panel.md')).toBe(good)
    const emptyOne = store.listVersions('panel')[0]
    expect(emptyOne?.name).toBe(rolled.savedCurrent)
    expect(emptyOne?.bytes).toBe(0)
    expect(store.rollback('panel', emptyOne?.name ?? '')).toEqual({
      ok: false,
      code: 'versions.empty',
      reason: `${emptyOne?.name} 是空的，拿它回滚等于把正文清掉`,
      hint: '换一份有正文的版本',
    })
    expect(read(dir, 'panel.md')).toBe(good)
  })

  it('叙事被改坏：回滚只动叙事，面板不动', () => {
    const dir = tempDir()
    const settings = resolveSettings()
    const store = openStore(dir)

    paintPanel(store, settings, AT)
    const panel = read(dir, 'panel.md')
    seedNarrative(store, 1_000)
    updateNarrative(store, settings, '我是谁', '我叫她别硬撑', 2_000)
    const narrative = read(dir, 'narrative.md')
    updateNarrative(store, settings, '我在意什么', '我在意她有没有睡够', 3_000)
    const entries = store.listVersions('narrative')
    expect(entries).toHaveLength(2)
    const target = entries[0]?.name ?? ''

    write(dir, 'narrative.md', '整篇都坏了\n')
    const rolled = store.rollback('narrative', target)

    expect(rolled.ok).toBe(true)
    expect(read(dir, 'narrative.md')).toBe(narrative)
    expect(store.verifyAfterRollback('narrative', target)).toEqual({ same: true, line: 0 })
    expect(read(dir, 'panel.md')).toBe(panel)
    expect(keptText(dir, rolled.savedCurrent ?? '')).toBe('整篇都坏了\n')
  })

  it('滚动保留只留 versionsKeep 份，最旧的先删', () => {
    const dir = tempDir()
    const store = openStore(dir, { versionsKeep: 3 })
    const snapshots: string[] = []

    for (let round = 0; round < 6; round += 1) {
      store.writePanel(`【自我】\n第 ${round} 版`, AT + round * MINUTE)
      if (round < 5) snapshots.push(read(dir, 'panel.md'))
    }

    const entries = store.listVersions('panel')
    expect(entries).toHaveLength(3)
    expect(entries.map(entry => entry.at)).toEqual([AT + 5 * MINUTE, AT + 4 * MINUTE, AT + 3 * MINUTE])
    expect(entries.map(entry => keptText(dir, entry.name))).toEqual([
      snapshots[4] ?? '',
      snapshots[3] ?? '',
      snapshots[2] ?? '',
    ])
  })
})

describe('回滚的拒绝与接线', () => {
  it('别的种类的名字、不存在的版本、带路径的名字都拒，正本不动', () => {
    const dir = tempDir()
    const settings = resolveSettings()
    const store = openStore(dir)

    seedNarrative(store, AT - MINUTE)
    updateNarrative(store, settings, '我是谁', '我叫她别硬撑', AT - MINUTE / 2)
    paintPanel(store, settings, AT)
    paintPanel(store, settings, AT + MINUTE)
    const current = read(dir, 'panel.md')
    const narrativeName = store.listVersions('narrative')[0]?.name ?? ''

    expect(store.rollback('panel', narrativeName)).toMatchObject({ ok: false, code: 'versions.name_invalid' })
    expect(store.rollback('panel', 'panel-20261104-1830.md')).toMatchObject({ ok: false, code: 'versions.missing' })
    expect(store.rollback('panel', `../${narrativeName}`)).toMatchObject({ ok: false, code: 'versions.name_invalid' })
    expect(store.verifyAfterRollback('panel', 'panel-20261104-1830.md')).toEqual({
      same: false,
      line: 0,
      code: 'versions.missing',
    })
    expect(read(dir, 'panel.md')).toBe(current)
    expect(store.listVersions('narrative')).toHaveLength(1)
  })

  it('这一层关着时回滚不落盘', async () => {
    const dir = tempDir()
    const settings = resolveSettings()
    const store = openStore(dir)

    seedNarrative(store, AT - MINUTE)
    updateNarrative(store, settings, '我是谁', '我叫她别硬撑', AT - MINUTE / 2)
    const name = store.listVersions('narrative')[0]?.name ?? ''
    const current = read(dir, 'narrative.md')
    const seam = await mount(dir, undefined, false)

    expect(seam.listVersions('narrative')).toHaveLength(1)
    expect(seam.rollback('narrative', name)).toMatchObject({ ok: false, code: 'versions.disabled' })
    expect(read(dir, 'narrative.md')).toBe(current)
  })

  it('装配层能列版本、回滚并核对', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    expect(seam.seedNarrative()).toEqual({ written: true, proposed: false })
    seam.updateNarrative('我是谁', '我叫她别硬撑')
    const kept = seam.narrative()
    seam.updateNarrative('我在意什么', '我在意她有没有睡够')

    const entries = seam.listVersions('narrative')
    expect(entries).toHaveLength(2)
    const rolled = seam.rollback('narrative', entries[0]?.name ?? '')

    expect(rolled).toMatchObject({ ok: true, restoredFrom: entries[0]?.name })
    expect(seam.narrative()).toBe(kept)
    expect(seam.verifyAfterRollback('narrative', entries[0]?.name ?? '').same).toBe(true)
  })
})
