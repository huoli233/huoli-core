import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../scripts/accept.ts', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

function run(argv: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx', script, ...argv], { cwd: repoRoot, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('跨包那几行验收', () => {
  it('整张表跑完全过', () => {
    const ran = run([])

    expect(ran.status).toBe(0)
    expect(ran.stdout).toContain('未过 0 条')
    expect(ran.stdout).not.toContain('❌')
  })

  it('参数写错一律拒绝', () => {
    const ran = run(['--nope'])

    expect(ran.status).toBe(2)
    expect(ran.stderr).toContain('不认这个参数')
  })
})
