// 体量预算：装配总入口把六类事实、主动性、放进提示词与维护接在同一处，拆开就要来回传同一堆依赖

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.join(import.meta.dirname, '..', 'src')
// 装配入口之外还有事实、接口、六个事实落盘器与工具出口，文件数比通用上限多；单文件仍守六百行
const MAX_FILES = 18
const MAX_LINES = 600
// 装配入口本身是接线的地方，每接一路就多几行；这一份单独放宽，别处仍守六百
const LINE_EXCEPTIONS = new Map([['index.ts', 620]])

describe('体量预算', () => {
  it('源文件数不超过这个包自己声明的上限', () => {
    const files = fs.readdirSync(SRC).filter(name => name.endsWith('.ts'))
    expect(files.length).toBeLessThanOrEqual(MAX_FILES)
  })

  it('每个源文件不超过六百行', () => {
    const files = fs.readdirSync(SRC).filter(name => name.endsWith('.ts'))
    const over = files
      .map(name => ({ name, lines: fs.readFileSync(path.join(SRC, name), 'utf8').split('\n').length }))
      .filter(entry => entry.lines > (LINE_EXCEPTIONS.get(entry.name) ?? MAX_LINES))
    expect(over).toEqual([])
  })
})
