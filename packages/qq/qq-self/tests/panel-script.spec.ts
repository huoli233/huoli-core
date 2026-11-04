import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { panelBody } from '../src/panel.ts'

const roots: string[] = []
const script = fileURLToPath(new URL('../scripts/panel.ts', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-script-'))
  roots.push(root)
  return path.join(root, 'self')
}

function run(dir: string, extra: readonly string[] = []): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx', script, '--dir', dir, ...extra], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

// 目录里的文件清单，用来证明只多了面板那一份
function listing(dir: string): string[] {
  return fs.readdirSync(dir).sort()
}

const AT = new Date(2026, 10, 3, 21, 0).getTime()

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('离线生成面板', () => {
  it('一条命令生成 panel.md 并打印路径', () => {
    const dir = tempDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'projects.jsonl'),
      `${JSON.stringify({ at: AT, id: 'p1', title: '把周报写成一句', next: '先列三条', fail_if: '两周没动', outcome: 'open' })}\n`,
    )

    const result = run(dir)

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(path.join(dir, 'panel.md'))
    const raw = fs.readFileSync(path.join(dir, 'panel.md'), 'utf8')
    expect(raw.startsWith('<!-- generated_at: ')).toBe(true)
    expect(panelBody(raw)).toContain('我在做：把周报写成一句')
    expect(panelBody(raw)).toContain('下一步：先列三条')
    expect(panelBody(raw)).toContain('我可以说不')
  })

  it('只写面板，状态文件一个字都不动', () => {
    const dir = tempDir()
    fs.mkdirSync(dir, { recursive: true })
    const projects = `${JSON.stringify({ at: AT, id: 'p1', title: '把周报写成一句', next: '先列三条', fail_if: '两周没动', outcome: 'open' })}\n`
    fs.writeFileSync(path.join(dir, 'projects.jsonl'), projects)
    const before = listing(dir)

    const result = run(dir)

    expect(result.status).toBe(0)
    expect(listing(dir)).toEqual([...before, 'panel.md'].sort())
    expect(fs.readFileSync(path.join(dir, 'projects.jsonl'), 'utf8')).toBe(projects)
  })

  it('目录空着也能生成一份只有标题与收尾的面板', () => {
    const dir = tempDir()

    const result = run(dir)

    expect(result.status).toBe(0)
    expect(panelBody(fs.readFileSync(path.join(dir, 'panel.md'), 'utf8')))
      .toBe('【自我】\n我可以说不，也可以说不知道。')
  })

  it('第二条命令换掉旧面板，生成时间跟着换', () => {
    const dir = tempDir()

    run(dir)
    const first = fs.readFileSync(path.join(dir, 'panel.md'), 'utf8')
    run(dir)
    const second = fs.readFileSync(path.join(dir, 'panel.md'), 'utf8')

    expect(first.startsWith('<!-- generated_at: ')).toBe(true)
    expect(second.startsWith('<!-- generated_at: ')).toBe(true)
    expect(fs.readdirSync(dir).sort()).toEqual(['panel.md', 'versions'])
    const kept = fs.readdirSync(path.join(dir, 'versions'))
    expect(kept).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, 'versions', kept[0] ?? ''), 'utf8')).toBe(first)
  })

  it('不认识的参数直接拒，一份文件也不写', () => {
    const dir = tempDir()
    fs.mkdirSync(dir, { recursive: true })

    const result = spawnSync(process.execPath, ['--import', 'tsx', script, '--bogus'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('只认 --dir')
    expect(listing(dir)).toEqual([])
  })
})
