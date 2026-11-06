import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { resolveTuning } from '../src/defaults.ts'
import { createEmbedder } from '../src/embed.ts'
import { recall } from '../src/recall.ts'
import { cleanupTempDirs, mount, tempFile } from './harness.ts'

const NOW = new Date(2026, 10, 1, 12, 0).getTime()

const servers: Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    server.close()
  }
  cleanupTempDirs()
})

// 假嵌入服务：按句子有几个字给它一条固定方向的向量，够验协议与失败路径
async function fakeService(handler: (body: { model?: string; input?: string[] }) => { status?: number; body?: unknown }) {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: string; input?: string[] }
      const { status = 200, body } = handler(parsed)
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body ?? {}))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('假服务没起来')
  return `http://127.0.0.1:${String(address.port)}/v1`
}

describe('嵌入服务', () => {
  it('把几句话换成同样多、同样宽的向量', async () => {
    const baseURL = await fakeService(({ input }) => ({
      body: { data: (input ?? []).map((text, index) => ({ embedding: [text.length, index, 1] })) },
    }))
    const embedder = createEmbedder({ baseURL, model: 'fake', apiKey: 'test-key' })

    const vectors = await embedder.embed(['今天有点累', '周三爬山'])

    expect(vectors).toEqual([[5, 0, 1], [4, 1, 1]])
  })

  it('服务报错就抛出来，不悄悄给一条空向量', async () => {
    const baseURL = await fakeService(() => ({ status: 402, body: { code: 30001, message: '余额不足' } }))
    const embedder = createEmbedder({ baseURL, model: 'fake', apiKey: 'test-key' })

    await expect(embedder.embed(['一句话'])).rejects.toThrow(/嵌入服务回 402/u)
  })

  it('条数对不上也算错', async () => {
    const baseURL = await fakeService(() => ({ body: { data: [] } }))
    const embedder = createEmbedder({ baseURL, model: 'fake', apiKey: 'test-key' })

    await expect(embedder.embed(['一句', '两句'])).rejects.toThrow(/条数对不上/u)
  })

  it('没配 key 直接拒绝，不去打服务', async () => {
    const embedder = createEmbedder({ baseURL: 'http://127.0.0.1:1/v1', model: 'fake' })

    await expect(embedder.embed(['一句话'])).rejects.toThrow(/没配 key/u)
  })
})

describe('向量分给回想用', () => {
  it('关键词一条都没命中时，向量高的那条也能被想起来', () => {
    const { seam } = mount({ file: tempFile() })
    const tired = seam.remember('今天有点累，想早点睡', 'group:1', { at: NOW, importance: 40 })
    const climb = seam.remember('周三一起去爬山吧', 'group:1', { at: NOW, importance: 40 })

    // 关键词「累死我了」在两条里都找不到字面片段，只有向量能分出来
    const keywordOnly = recall(seam.store, { query: '累死我了', scope: 'group:1', now: NOW })
    expect(keywordOnly).toEqual([])

    const withVectors = recall(seam.store, {
      query: '累死我了',
      scope: 'group:1',
      now: NOW,
      tuning: resolveTuning(),
      vectorSims: new Map([[tired.id, 0.82], [climb.id, 0.51]]),
    })

    expect(withVectors.map(hit => hit.id)).toEqual([tired.id])
    expect(withVectors[0]?.reasons.vectorSim).toBeCloseTo(0.82)
  })

  it('给了向量分就不再本地现算，没有分的条目按零算', () => {
    const { seam } = mount({ file: tempFile() })
    const one = seam.remember('周三一起去爬山吧', 'group:1', { at: NOW, importance: 40 })
    const two = seam.remember('今天有点累', 'group:1', { at: NOW, importance: 40 })

    const hits = recall(seam.store, {
      query: '爬山',
      scope: 'group:1',
      now: NOW,
      vectorSims: new Map([[one.id, 0.9]]),
    })

    expect(hits.map(hit => hit.id)).toEqual([one.id])
    expect(hits[0]?.reasons.vectorSim).toBeCloseTo(0.9)
    expect(hits.some(hit => hit.id === two.id)).toBe(false)
  })
})
