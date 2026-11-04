import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSettings } from '../src/defaults.ts'
import { createSelfStore, newId } from '../src/store.ts'

const roots: string[] = []

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-store-'))
  roots.push(root)
  return path.join(root, 'self')
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('目录读写', () => {
  it('目录还没建的时候什么都读不到', () => {
    const dir = tempDir()
    const store = createSelfStore({ dir, settings: resolveSettings() })

    expect(store.pathOf('ledger.jsonl')).toBe(path.join(dir, 'ledger.jsonl'))
    expect(store.exists()).toBe(false)
    expect(store.paused()).toBe(false)
    expect(store.lines('ledger.jsonl')).toEqual([])
    expect(store.records('ledger.jsonl')).toEqual([])
    expect(store.readText('panel.md')).toBeUndefined()
    expect(store.panel()).toBeUndefined()
    expect(store.fresh(Date.now())).toBe(false)
  })

  it('追加以后能读回来，坏行跳过', () => {
    const dir = tempDir()
    const store = createSelfStore({ dir, settings: resolveSettings() })

    store.append('ledger.jsonl', { at: 1, id: 'a', kind: 'drive' })
    fs.appendFileSync(path.join(dir, 'ledger.jsonl'), '这不是一行 JSON\n')
    fs.appendFileSync(path.join(dir, 'ledger.jsonl'), '123\n')
    fs.appendFileSync(path.join(dir, 'ledger.jsonl'), '[1,2]\n')
    fs.appendFileSync(path.join(dir, 'ledger.jsonl'), 'null\n')
    expect(store.lines('ledger.jsonl')).toHaveLength(5)
    expect(store.records('ledger.jsonl')).toEqual([{ at: 1, id: 'a', kind: 'drive' }])
  })

  it('覆盖写会自动建目录，以最后一份为准', () => {
    const dir = tempDir()
    const store = createSelfStore({ dir, settings: resolveSettings() })

    store.writeText('notes.md', 'A')
    store.writeText('notes.md', 'B')
    store.ensure()

    expect(store.exists()).toBe(true)
    expect(store.readText('notes.md')).toBe('B')
    expect(fs.existsSync(path.join(dir, `notes.md.${process.pid}.tmp`))).toBe(false)
  })

  it('面板按修改时间判新旧', () => {
    const dir = tempDir()
    const settings = resolveSettings()
    const store = createSelfStore({ dir, settings })
    const now = Date.now()

    store.writePanel('【自我】\n我可以说不，也可以说不知道。', now)
    const written = fs.statSync(path.join(dir, 'panel.md')).mtimeMs

    expect(store.fresh(written + 1_000)).toBe(true)
    expect(store.fresh(written + settings.panelMaxAgeMs + 1_000)).toBe(false)
    expect(store.panel()).toBe('【自我】\n我可以说不，也可以说不知道。')
    expect(fs.readFileSync(path.join(dir, 'panel.md'), 'utf8').startsWith('<!-- generated_at: ')).toBe(true)
  })

  it('宪法只补缺，不覆盖已有的那份', () => {
    const dir = tempDir()
    const store = createSelfStore({ dir, settings: resolveSettings() })

    store.seedConstitution()
    expect(store.readText('constitution.md')?.trimEnd().split('\n')).toHaveLength(8)

    store.writeText('constitution.md', '改过的那份\n')
    store.seedConstitution()

    expect(store.readText('constitution.md')).toBe('改过的那份\n')
  })

  it('写不进去就抛错，正本不动', () => {
    const dir = tempDir()
    const store = createSelfStore({ dir, settings: resolveSettings() })
    const target = path.join(dir, `constitution.md.${process.pid}.tmp`)
    fs.mkdirSync(target, { recursive: true })

    expect(() => { store.writeText('constitution.md', '写不进去') }).toThrow()
    expect(store.readText('constitution.md')).toBeUndefined()
  })

  it('id 是时刻的 36 进制加六位', () => {
    const at = 1_700_000_000_000
    const id = newId(at)

    expect(id.startsWith(at.toString(36))).toBe(true)
    expect(id.length).toBe(at.toString(36).length + 6)
    expect(id).toMatch(/^[0-9a-z]+$/)
  })
})
