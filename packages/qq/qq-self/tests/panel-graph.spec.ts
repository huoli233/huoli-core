import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildGraph, graphAnswer, graphPage } from '../src/panel-graph.ts'

const dirs: string[] = []

function seeded(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-graph-'))
  dirs.push(dir)
  const file = path.join(dir, 'qq-memory.json')
  const items = [
    { id: 'm1', text: '他说周末要开黑', kind: '事件', importance: 80, at: 1, layer: 'episodic', scope: 'group:1', metadata: { tags: ['游戏'] } },
    { id: 'm2', text: '开黑要用麦', kind: '事件', importance: 60, at: 2, layer: 'episodic', scope: 'group:1', metadata: { tags: ['游戏'] } },
    { id: 'm3', text: '偷偷给自己做了点事', kind: '事件', importance: 90, at: 3, layer: 'private', scope: 'private:1' },
  ]
  fs.writeFileSync(file, JSON.stringify({ version: 1, lastMaintainedDay: '', items }))
  fs.writeFileSync(path.join(dir, 'edges.jsonl'), `${JSON.stringify({ a: 'm1', b: 'm2', weight: 4, why: 'sameTurn', at: 1 })}\n`)
  return file
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('星海的数据', () => {
  it('默认不把私密星点画进来', () => {
    const graph = buildGraph(seeded())

    expect(graph.nodes.map(node => node.id)).toEqual(['m1', 'm2'])
    expect(graph.total).toBe(3)
  })

  it('明确要求时才画私密星点', () => {
    const graph = buildGraph(seeded(), 300, true)

    expect(graph.nodes.map(node => node.id)).toContain('m3')
  })

  it('两条都画出来时才有星链', () => {
    const graph = buildGraph(seeded())

    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]?.why).toBe('sameTurn')
  })

  it('按标签分成星云', () => {
    const graph = buildGraph(seeded())

    expect(graph.clusters['游戏']).toEqual(['m1', 'm2'])
  })

  it('文件不在时给空图，不炸', () => {
    const graph = buildGraph(path.join(os.tmpdir(), '没有这个文件.json'))

    expect(graph).toEqual({ nodes: [], edges: [], clusters: {}, total: 0 })
  })
})

describe('星海那几路接口', () => {
  const search = new URLSearchParams()

  it('/graph 给一页 HTML', () => {
    const answer = graphAnswer('/graph', search, seeded())

    expect(answer?.type).toContain('text/html')
    expect(answer?.body).toContain('记忆星海')
  })

  it('/api/graph 给 JSON', () => {
    const answer = graphAnswer('/api/graph', search, seeded())

    expect(answer?.type).toContain('application/json')
    const payload = JSON.parse(answer?.body ?? '{}') as { nodes: unknown[] }
    expect(payload.nodes).toHaveLength(2)
  })

  it('/api/graph/node/:id 取单个星点', () => {
    const answer = graphAnswer('/api/graph/node/m1', search, seeded())

    const payload = JSON.parse(answer?.body ?? '{}') as { node: { id: string } }

    expect(payload.node.id).toBe('m1')
  })

  it('取不到时给码，不给空对象', () => {
    const answer = graphAnswer('/api/graph/node/没有', search, seeded())

    const payload = JSON.parse(answer?.body ?? '{}') as { code: string }

    expect(payload.code).toBe('graph.not_found')
  })

  it('别的路径不归它管', () => {
    expect(graphAnswer('/api/state', search, seeded())).toBeUndefined()
  })

  it('空库时页面写「还没有记忆」', () => {
    const empty = graphPage({ nodes: [], edges: [], clusters: {}, total: 0 }, 'body{margin:0}')

    expect(empty).toContain('还没有记忆')
  })
})
