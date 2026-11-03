import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqPacingOf, type Config, type QqPacingSeam } from '../src/index.ts'

const tempDirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-pacing-'))
  tempDirs.push(dir)
  return path.join(dir, 'pacing.json')
}

function mount(file: string, config: Config = {}): QqPacingSeam {
  const ctx = new Context()
  apply(ctx, { file, ...config })
  const seam = qqPacingOf(ctx)
  if (seam === undefined) throw new Error('说话规矩没有装配')
  return seam
}

const LONG = '今天下午看了个片子。里面有个镜头特别像我们楼下。' + '然后我就想起上次说的那件事。'.repeat(20)

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('一段话怎么拆', () => {
  it('长话拆成多条', () => {
    const seam = mount(tempFile(), { maxParts: 8, maxCharsPerPart: 500 })

    const planned = seam.plan(LONG)

    expect(planned.parts.length).toBeGreaterThan(1)
    expect(planned.parts.length).toBeLessThanOrEqual(8)
  })

  it('拆开的每条不超过五百字', () => {
    const seam = mount(tempFile(), { maxParts: 8, maxCharsPerPart: 500 })

    const planned = seam.plan(LONG)

    expect(planned.parts.every(part => part.length <= 500)).toBe(true)
  })

  it('拆开的条与条之间留出停顿', () => {
    const seam = mount(tempFile(), { maxParts: 8, maxCharsPerPart: 500 })

    const planned = seam.plan(LONG)

    expect(planned.gapsMs).toHaveLength(planned.parts.length - 1)
    expect(planned.gapsMs.every(gap => gap >= 800)).toBe(true)
  })

  it('短话不拆', () => {
    const seam = mount(tempFile())

    const planned = seam.plan('在的')

    expect(planned.parts).toHaveLength(1)
    expect(planned.gapsMs).toHaveLength(0)
  })
})

describe('还能不能说', () => {
  it('一开始能发', () => {
    const seam = mount(tempFile())

    expect(seam.allow('第一句话').ok).toBe(true)
  })

  it('同一句话刚说过就发不出去', () => {
    const seam = mount(tempFile())
    seam.spend('这句刚说过')

    const repeated = seam.allow('这句刚说过')

    expect(repeated.ok).toBe(false)
    expect(repeated.code).toBe('pacing.repeated')
  })

  it('说过一句就记一笔', () => {
    const seam = mount(tempFile())
    seam.spend('这句刚说过')

    const used = seam.used()

    expect(used.dayCount).toBeGreaterThanOrEqual(1)
    expect(used.hourCount).toBeGreaterThanOrEqual(1)
  })

  it('一小时的额度用满就发不出去', () => {
    const seam = mount(tempFile())
    seam.spend('这句刚说过')
    for (let at = 0; at < 70; at += 1) seam.spend(`第 ${at} 句测试内容`)

    const full = seam.allow('再来一句')

    expect(full.ok).toBe(false)
    expect(full.code === 'pacing.hour_full' || full.code === 'pacing.day_full').toBe(true)
  })

  it('新一轮开始时只清本轮的计数，小时额度还在', () => {
    const seam = mount(tempFile())
    seam.spend('这句刚说过')
    const before = seam.used()

    seam.resetTurn()

    expect(seam.used().hourCount).toBe(before.hourCount)
    expect(seam.used().dayCount).toBe(before.dayCount)
  })
})

describe('关掉再开', () => {
  it('今天说了多少还记得', () => {
    const file = tempFile()
    const before = mount(file)
    before.spend('这句刚说过')
    const used = before.used()

    expect(mount(file).used().dayCount).toBe(used.dayCount)
  })
})
