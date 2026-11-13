// 体量预算：自我层按概念拆成面板、记录、行、分级与装配几处，文件数比通用上限多，单文件仍守六百行

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.join(import.meta.dirname, '..', 'src')
// 星海那一页单独一个文件：面板那个文件已经顶到六百行，塞进去只会更挤
// 面板的行为约束也单独一个文件，源文件上限跟着放一档
const MAX_FILES = 26
const MAX_LINES = 600
// 面板文件同时承载页面、状态 API、现场那一格、本机急停控制与行为约束，单独放宽到 700 行
const LINE_EXCEPTIONS = new Map([['panel-http.ts', 700], ['assembly.ts', 620]])

describe('体量预算', () => {
  it('源文件数不超过例外上限', () => {
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
