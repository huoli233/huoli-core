import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mirroredBy, mirroredSelfIds, selfIdOf } from '../src/index.ts'

// 单包 src 的文件预算，写死在这里才盯得住新增文件
const SRC_FILE_BUDGET = 12

describe('文件预算', () => {
  it('src 里的源文件数正好是十二个', () => {
    const dir = path.join(import.meta.dirname, '..', 'src')
    const files = fs.readdirSync(dir).filter(name => fs.statSync(path.join(dir, name)).isFile())

    expect(files).toHaveLength(SRC_FILE_BUDGET)
  })

  it('镜像那三个读取口子仍在包入口上', () => {
    expect(typeof selfIdOf).toBe('function')
    expect(typeof mirroredSelfIds).toBe('function')
    expect(typeof mirroredBy).toBe('function')
  })
})
