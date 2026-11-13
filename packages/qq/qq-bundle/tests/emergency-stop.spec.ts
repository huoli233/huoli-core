import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createEmergencyStop } from '../src/emergency-stop.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('急停文件', () => {
  it('打开后读得到原因，解除后恢复运行', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-emergency-'))
    dirs.push(dir)
    const file = path.join(dir, 'stop.json')
    const stop = createEmergencyStop(file)

    expect(stop.state()).toEqual({ active: false, at: 0, reason: '' })
    const stopped = stop.stop('人工停止')
    expect(stopped.active).toBe(true)
    expect(stopped.at).toBeGreaterThan(0)
    expect(stop.state()).toMatchObject({ active: true, reason: '人工停止' })
    expect(fs.statSync(file).mode & 0o777).toBeGreaterThan(0)

    expect(stop.resume()).toEqual({ active: false, at: 0, reason: '' })
    expect(stop.state().active).toBe(false)
  })
})
