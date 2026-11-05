import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { edgesFileOf, edgesOfPoint, linkPoints, linkTogether, neighboursOf, pairOf, readEdges } from '../src/edges.ts'

const dirs: string[] = []

function tempEdges(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-edges-'))
  dirs.push(dir)
  return path.join(dir, 'edges.jsonl')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('星链', () => {
  it('两点规范化：谁在前都一样', () => {
    expect(pairOf('b', 'a')).toEqual(['a', 'b'])
    expect(pairOf('a', 'b')).toEqual(['a', 'b'])
  })

  it('边文件放在记忆文件旁边', () => {
    expect(edgesFileOf('/data/memories.jsonl')).toContain('edges.jsonl')
  })

  it('连一条就有了，重复连只加权重不新增', () => {
    const file = tempEdges()

    linkPoints(file, 'm2', 'm1', 'sameTurn', 100)
    const again = linkPoints(file, 'm1', 'm2', 'sameTurn', 200)

    expect(readEdges(file)).toHaveLength(1)
    expect(again.weight).toBe(2)
    expect(again.at).toBe(200)
  })

  it('权重到顶就不再涨', () => {
    const file = tempEdges()
    for (let i = 0; i < 40; i += 1) linkPoints(file, 'm1', 'm2', 'sameTurn', i)

    expect(readEdges(file)[0]?.weight).toBe(20)
  })

  it('一个点连出去的边按权重排，邻居取得到', () => {
    const file = tempEdges()
    linkPoints(file, 'm1', 'm2', 'sameTurn', 1)
    linkPoints(file, 'm1', 'm3', 'sameTurn', 2)
    linkPoints(file, 'm1', 'm3', 'sameTurn', 3)

    expect(edgesOfPoint(file, 'm1')).toHaveLength(2)
    expect(neighboursOf(file, 'm1')).toEqual(['m3', 'm2'])
  })

  it('同一轮写进来的几条两两相连', () => {
    const file = tempEdges()

    const made = linkTogether(file, ['a', 'b', 'c'], 'sameTurn', 10)

    expect(made).toBe(3)
    expect(readEdges(file)).toHaveLength(3)
  })

  it('坏行跳过，不影响别的边', () => {
    const file = tempEdges()
    linkPoints(file, 'm1', 'm2', 'sameTurn', 1)
    fs.appendFileSync(file, '{不是 json}\n')

    expect(readEdges(file)).toHaveLength(1)
  })

  it('空文件读出来是空表', () => {
    expect(readEdges(tempEdges())).toEqual([])
  })
})
