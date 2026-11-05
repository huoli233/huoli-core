import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createVitalsStore, emptyState, resolveTuning, type VitalsState } from '../src/index.ts'

const tuning = resolveTuning()
const roots: string[] = []
const checkScript = fileURLToPath(new URL('../scripts/check.ts', import.meta.url))
const drinkScript = fileURLToPath(new URL('../scripts/drink.ts', import.meta.url))
const acceptScript = fileURLToPath(new URL('../scripts/accept.ts', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

function tempState(overrides: Partial<VitalsState> = {}, at = Date.now()): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-script-'))
  roots.push(dir)
  const file = path.join(dir, 'vitals.json')
  createVitalsStore({ file, tuning }).write({ ...emptyState(tuning, at), ...overrides })
  return file
}

// 把文件的修改时间往前推，模拟心跳停了多久
function ageFile(file: string, seconds: number): void {
  const at = new Date(Date.now() - seconds * 1000)
  fs.utimesSync(file, at, at)
}

interface Ran {
  status: number | null
  stdout: string
  stderr: string
}

function run(script: string, argv: readonly string[]): Ran {
  const result = spawnSync(process.execPath, ['--import', 'tsx', script, ...argv], { cwd: repoRoot, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

// 要一边起假面板一边跑脚本，只能异步等：spawnSync 会把事件循环堵住，假面板回不了话
function runAsync(script: string, argv: readonly string[]): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script, ...argv], { cwd: repoRoot })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('close', (status) => { resolve({ status, stdout, stderr }) })
  })
}

// 一个只回 /api/state 的假面板
async function serve(body: unknown): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}/api/state`,
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve() }) }),
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('体检脚本', () => {
  it('刚写过的心跳、字段都在范围内时全绿', () => {
    const ran = run(checkScript, ['--file', tempState()])

    expect(ran.status).toBe(0)
    expect(ran.stdout).toContain('✅ 正常')
  })

  it('状态太久没更新就报心跳停了并退出 1', () => {
    const file = tempState()
    ageFile(file, 600)

    const ran = run(checkScript, ['--file', file])

    expect(ran.status).toBe(1)
    expect(ran.stdout).toContain('没更新')
  })

  it('字段越界要报出来', () => {
    const ran = run(checkScript, ['--file', tempState({ thirst: 1.5 })])

    expect(ran.stdout).toContain('thirst=1.5 越界')
  })

  it('摘要那行带渴、饿、水队列与体温', () => {
    const ran = run(checkScript, ['--file', tempState({ thirst: 0.5, hunger: 0.4 })])

    expect(ran.stdout).toContain('口渴 0.50')
    expect(ran.stdout).toContain('饥饿 0.40')
    expect(ran.stdout).toContain('体温')
  })

  it('参数写错一律拒绝', () => {
    const ran = run(checkScript, ['--nope'])

    expect(ran.status).toBe(2)
    expect(ran.stderr).toContain('不认这个参数')
  })

  it('给了面板地址且读数对得上，照样全绿', async () => {
    const file = tempState({ thirst: 0.6, energy: 0.5 })
    const panel = await serve({ vitals: { thirst: 0.6, energy: 0.5 } })

    const ran = await runAsync(checkScript, ['--file', file, '--panel', panel.url])
    await panel.close()

    expect(ran.status).toBe(0)
    expect(ran.stdout).toContain('✅ 正常')
  })

  it('面板与状态对不上就报出来，不静默放过', async () => {
    const file = tempState({ thirst: 0.6 })
    const panel = await serve({ vitals: { thirst: 0.9, energy: 0.5 } })

    const ran = await runAsync(checkScript, ['--file', file, '--panel', panel.url])
    await panel.close()

    expect(ran.status).toBe(1)
    expect(ran.stdout).toContain('对不上')
  })

  it('面板没带身体读数也算一项问题', async () => {
    const file = tempState()
    const panel = await serve({ panel: { body: '只有文字账' } })

    const ran = await runAsync(checkScript, ['--file', file, '--panel', panel.url])
    await panel.close()

    expect(ran.status).toBe(1)
    expect(ran.stdout).toContain('没有带出身体读数')
  })
})

describe('第 12 章验收', () => {
  it('整张表跑完全过，一条不剩', () => {
    const ran = run(acceptScript, [])

    expect(ran.status).toBe(0)
    expect(ran.stdout).toContain('未过 0 条')
    expect(ran.stdout).not.toContain('❌')
  })

  it('参数写错一律拒绝', () => {
    const ran = run(acceptScript, ['--nope'])

    expect(ran.status).toBe(2)
  })
})

describe('补喝水脚本', () => {
  it('心跳还在跑时拒绝补，并说清为什么', () => {
    const ran = run(drinkScript, ['--file', tempState({ thirst: 0.6 })])

    expect(ran.status).toBe(1)
    expect(ran.stdout).toContain('drink.still_running')
  })

  it('心跳停了就能补上，渴按生产那条公式掉下去', () => {
    const file = tempState({ thirst: 0.58 })
    ageFile(file, 600)

    const ran = run(drinkScript, ['--file', file])

    expect(ran.status).toBe(0)
    expect(ran.stdout).toContain('补水完成')
    const after = createVitalsStore({ file, tuning }).read().thirst
    expect(after).toBeCloseTo(Math.max(0, 0.58 - tuning.drinkThirstDrop), 6)
  })

  it('刚补过就不再补第二杯', () => {
    const file = tempState({ thirst: 0.58 })
    ageFile(file, 600)
    expect(run(drinkScript, ['--file', file]).status).toBe(0)

    // 第二杯走 --force 才能到冷却那一关，否则先被心跳守卫拦下
    const again = run(drinkScript, ['--file', file, '--force'])

    expect(again.status).toBe(1)
    expect(again.stdout).toContain('drink.recent')
  })

  it('硬要补的时候心跳在跑也照补', () => {
    const ran = run(drinkScript, ['--file', tempState({ thirst: 0.9 }), '--force'])

    expect(ran.status).toBe(0)
  })
})
