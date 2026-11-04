// 体量预算：这个包按 dev-spec 的包级例外放到二十个文件，单文件仍守六百行

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.join(import.meta.dirname, '..', 'src')
// 生命状态把状态机、结算与事实源各放一处，拆分后文件数超过通用上限，这个例外写在开发规范里
const MAX_FILES = 20
const MAX_LINES = 600

describe('体量预算', () => {
  it('源文件数不超过例外上限', () => {
    const files = fs.readdirSync(SRC).filter(name => name.endsWith('.ts'))
    expect(files.length).toBeLessThanOrEqual(MAX_FILES)
  })

  it('每个源文件不超过六百行', () => {
    const files = fs.readdirSync(SRC).filter(name => name.endsWith('.ts'))
    const over = files
      .map(name => ({ name, lines: fs.readFileSync(path.join(SRC, name), 'utf8').split('\n').length }))
      .filter(entry => entry.lines > MAX_LINES)
    expect(over).toEqual([])
  })
})
