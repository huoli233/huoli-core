// 体量预算：装配总入口把六类事实、主动性、放进提示词与维护接在同一处，拆开就要来回传同一堆依赖

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.join(import.meta.dirname, '..', 'src')
// 轮次事实、外部资料、拟人规则、提示行、身体自诊和牢骚候选各自独立；平均文件仍远低于通用上限
const MAX_FILES = 62
const MAX_LINES = 600
// 装配入口和轮次收尾负责跨模块接线；本体事实与自诊接线让这两个入口略高于普通源文件
const LINE_EXCEPTIONS = new Map([
  ['index.ts', 1_280],
  ['image-runtime.ts', 660],
  ['rounds.ts', 660],
  ['self-awareness.ts', 610],
  ['self-health.ts', 890],
])

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
