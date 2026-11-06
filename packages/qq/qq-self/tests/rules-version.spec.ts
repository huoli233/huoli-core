import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSelfStore } from '../src/store.ts'
import { resolveSettings } from '../src/defaults.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-rules-'))
  dirs.push(dir)
  return dir
}

function open(dir: string) {
  const store = createSelfStore({ dir, settings: resolveSettings({ versionsKeep: 3 }) })
  store.ensure()
  return store
}

describe('人格规矩的版本', () => {
  it('第一次存就留下一份，正本原样抄进去', () => {
    const root = tempDir()
    const rules = path.join(root, 'rules.md')
    fs.writeFileSync(rules, '第一条：别装\n')
    const store = open(path.join(root, 'self'))

    const saved = store.snapshotRules(rules, new Date(2026, 10, 6, 9, 0).getTime())

    expect(saved).toMatch(/^rules-/u)
    const kept = store.listVersions('rules')
    expect(kept).toHaveLength(1)
    expect(fs.readFileSync(path.join(store.dir, 'versions', kept[0]?.name ?? ''), 'utf8')).toBe('第一条：别装\n')
  })

  it('一字没改就不再存一版', () => {
    const root = tempDir()
    const rules = path.join(root, 'rules.md')
    fs.writeFileSync(rules, '第一条：别装\n')
    const store = open(path.join(root, 'self'))
    const at = new Date(2026, 10, 6, 9, 0).getTime()

    store.snapshotRules(rules, at)
    const again = store.snapshotRules(rules, at + 60_000)

    expect(again).toBeUndefined()
    expect(store.listVersions('rules')).toHaveLength(1)
  })

  it('改了就再存一版，旧的那份还在', () => {
    const root = tempDir()
    const rules = path.join(root, 'rules.md')
    const store = open(path.join(root, 'self'))
    const at = new Date(2026, 10, 6, 9, 0).getTime()

    fs.writeFileSync(rules, '旧的一条\n')
    store.snapshotRules(rules, at)
    fs.writeFileSync(rules, '新的一条\n')
    store.snapshotRules(rules, at + 60_000)

    expect(store.listVersions('rules')).toHaveLength(2)
  })

  it('份数按参数滚，超出的最旧的先删', () => {
    const root = tempDir()
    const rules = path.join(root, 'rules.md')
    const store = open(path.join(root, 'self'))
    let at = new Date(2026, 10, 6, 9, 0).getTime()

    for (const body of ['一', '二', '三', '四', '五']) {
      fs.writeFileSync(rules, `${body}\n`)
      store.snapshotRules(rules, at)
      at += 60_000
    }

    expect(store.listVersions('rules')).toHaveLength(3)
  })

  it('正本不在时什么也不做', () => {
    const root = tempDir()
    const store = open(path.join(root, 'self'))

    expect(store.snapshotRules(path.join(root, '没有这份.md'), Date.now())).toBeUndefined()
    expect(store.listVersions('rules')).toEqual([])
  })
})

describe('用旧版盖回去', () => {
  it('盖回去之后正本变成那一版，现场也留了一份', () => {
    const root = tempDir()
    const rules = path.join(root, 'rules.md')
    const store = open(path.join(root, 'self'))
    const at = new Date(2026, 10, 6, 9, 0).getTime()

    fs.writeFileSync(rules, '好的一条\n')
    store.snapshotRules(rules, at)
    const old = store.listVersions('rules')[0]?.name ?? ''
    fs.writeFileSync(rules, '改坏的一条\n')

    const outcome = store.restoreRules(rules, old)

    expect(outcome.ok).toBe(true)
    expect(outcome.restoredFrom).toBe(old)
    expect(outcome.savedCurrent).toBeDefined()
    expect(fs.readFileSync(rules, 'utf8')).toBe('好的一条\n')
    expect(store.listVersions('rules')).toHaveLength(2)
  })

  it('名字不是这个种类的就拒绝', () => {
    const root = tempDir()
    const rules = path.join(root, 'rules.md')
    fs.writeFileSync(rules, '一条\n')
    const store = open(path.join(root, 'self'))

    const outcome = store.restoreRules(rules, 'panel-20261106-0900.md')

    expect(outcome.ok).toBe(false)
    expect(outcome.code).toBe('versions.name_invalid')
    expect(outcome.hint).toBeTruthy()
  })

  it('找不到那一份就拒绝', () => {
    const root = tempDir()
    const rules = path.join(root, 'rules.md')
    fs.writeFileSync(rules, '一条\n')
    const store = open(path.join(root, 'self'))

    const outcome = store.restoreRules(rules, 'rules-20261106-0900.md')

    expect(outcome.ok).toBe(false)
    expect(outcome.code).toBe('versions.missing')
  })
})
