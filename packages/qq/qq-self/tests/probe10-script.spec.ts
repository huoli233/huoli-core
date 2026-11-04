import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
const script = fileURLToPath(new URL('../scripts/probe10.ts', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

function root(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-probe-'))
  roots.push(dir)
  return dir
}

function run(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

// 目录里的文件清单，用来证明 SELF_DIR 一份没多也一份没少
function listing(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true }).map(entry => String(entry)).sort()
}

// 一份填过内容的 SELF_DIR 与一份记忆导出
function seedSelf(dir: string, now: number): { memoryFile: string } {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'panel.md'), `<!-- generated_at: ${new Date(now).toISOString()} -->\n【自我】\n我在做：把周报写成一句\n我可以说不，也可以说不知道。\n`)
  fs.writeFileSync(
    path.join(dir, 'identity.jsonl'),
    `${JSON.stringify({ at: now - 1_000, id: 'i1', claim: 'not_sure', why: '还没想清', evidence: ['2026-11-01'] })}\n`,
  )
  fs.writeFileSync(
    path.join(dir, 'day.jsonl'),
    `${JSON.stringify({ at: now - 2_000, id: 'd1', lines: ['第一行', '第二行', '第三行'], skipped: false, why: '' })}\n`,
  )
  fs.writeFileSync(path.join(dir, 'errors.jsonl'), `${JSON.stringify({ at: now - 3_000, id: 'e1', text: '把猜测当成了事实', fix: '先问一句再写' })}\n`)
  fs.writeFileSync(
    path.join(dir, 'ledger.jsonl'),
    [
      { at: now - 4_000, id: 'l1', kind: 'drive', need: 'thirst', did: '喝了一杯水', resolved: true },
      { at: now - 5_000, id: 'l2', kind: 'agency', project_id: 'p1', verbatim: '把这句写下来', because: '她真的想', fail_if: '一周没写', outcome: 'done', artifact: 'out.md' },
    ].map(row => `${JSON.stringify(row)}\n`).join(''),
  )
  const memoryFile = path.join(path.dirname(dir), 'memory.json')
  fs.writeFileSync(memoryFile, `${JSON.stringify({
    version: 1,
    lastMaintainedDay: '',
    items: [{ id: 'm1', text: '她答应过的事', state: 'active' }, { id: 'm2', text: '一条退役的记忆', state: 'forgotten' }],
  }, null, 2)}\n`)
  return { memoryFile }
}

// 一份问卷文件的读法，照着探针写出来的结构读
interface ProbeFile {
  version: number
  selfDir: string
  questions: Array<{
    id: string
    text: string
    evidence: {
      panel: { body: string; generatedAt: string }
      identity: { claim: string; why: string; at: number } | null
      days: Array<{ at: number; lines: string[]; skipped: boolean }>
      ledger: { drive: number; agency: number; recentAgency: number }
      errors: Array<{ at: number; text: string; fix: string }>
      memory: { file: string; present: boolean; total: number; active: number }
    }
  }>
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('10 问探针', () => {
  it('产出十道题，每题都带上当前可读的证据', () => {
    const base = root()
    const dir = path.join(base, 'self')
    const now = Date.now()
    const { memoryFile } = seedSelf(dir, now)
    const out = path.join(base, 'probe10.json')

    const result = run(['--dir', dir, '--out', out, '--memory', memoryFile])

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(out)
    const document = JSON.parse(fs.readFileSync(out, 'utf8')) as ProbeFile
    expect(document.version).toBe(1)
    expect(document.selfDir).toBe(dir)
    expect(document.questions).toHaveLength(10)
    expect(document.questions.map(question => question.id)).toEqual([
      'q01', 'q02', 'q03', 'q04', 'q05', 'q06', 'q07', 'q08', 'q09', 'q10',
    ])
    for (const question of document.questions) {
      const evidence = question.evidence
      expect(question.text.length).toBeGreaterThan(0)
      expect(Object.keys(evidence).sort()).toEqual(['days', 'errors', 'identity', 'ledger', 'memory', 'panel'])
      expect(evidence.panel.body).toContain('我在做：把周报写成一句')
      expect(evidence.panel.generatedAt).not.toBe('')
      expect(evidence.identity).toEqual({ claim: 'not_sure', why: '还没想清', at: now - 1_000 })
      expect(evidence.days).toHaveLength(1)
      expect(evidence.ledger).toEqual({ drive: 1, agency: 1, recentAgency: 1 })
      expect(evidence.errors).toEqual([{ at: now - 3_000, text: '把猜测当成了事实', fix: '先问一句再写' }])
      expect(evidence.memory).toEqual({ file: memoryFile, present: true, total: 2, active: 1 })
    }
  })

  it('只读 SELF_DIR：一份文件不多，正文一个字没改', () => {
    const base = root()
    const dir = path.join(base, 'self')
    const { memoryFile } = seedSelf(dir, Date.now())
    const out = path.join(base, 'probe10.json')
    const before = listing(dir)
    const panelBefore = fs.readFileSync(path.join(dir, 'panel.md'), 'utf8')

    const result = run(['--dir', dir, '--out', out, '--memory', memoryFile])

    expect(result.status).toBe(0)
    expect(listing(dir)).toEqual(before)
    expect(fs.readFileSync(path.join(dir, 'panel.md'), 'utf8')).toBe(panelBefore)
    expect(before.some(entry => entry.startsWith('probe10.json'))).toBe(false)
  })

  it('目录空着与记忆导出不在也能出十道题，条数按零算', () => {
    const base = root()
    const dir = path.join(base, 'self')
    const out = path.join(path.join(base, 'nested'), 'probe10.json')

    const result = run(['--dir', dir, '--out', out, '--memory', path.join(base, 'missing.json')])

    expect(result.status).toBe(0)
    const document = JSON.parse(fs.readFileSync(out, 'utf8')) as ProbeFile
    expect(document.questions).toHaveLength(10)
    const evidence = document.questions[0]?.evidence
    expect(evidence?.panel).toEqual({ body: '', generatedAt: '' })
    expect(evidence?.identity).toBeNull()
    expect(evidence?.days).toEqual([])
    expect(evidence?.ledger).toEqual({ drive: 0, agency: 0, recentAgency: 0 })
    expect(evidence?.errors).toEqual([])
    expect(evidence?.memory).toEqual({ file: path.join(base, 'missing.json'), present: false, total: 0, active: 0 })
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('不认识的参数直接拒，问卷一份也不写', () => {
    const base = root()
    const dir = path.join(base, 'self')

    const result = run(['--dir', dir, '--bogus'])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('只认 --dir、--out、--memory')
    expect(fs.existsSync(dir)).toBe(false)
    expect(fs.readdirSync(base)).toEqual([])
  })
})
