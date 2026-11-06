import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { Context } from '@huoli/cordis'
import { amountOf, apply, readBalance } from '../src/index.ts'

const servers: Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    server.close()
  }
})

// 假余额接口：说什么就回什么
async function fakeBalance(status: number, body: unknown): Promise<{ baseURL: string; seen: string[] }> {
  const seen: string[] = []
  const server = createServer((request, response) => {
    seen.push(`${request.method ?? ''} ${request.url ?? ''} ${String(request.headers.authorization)}`)
    request.resume()
    request.on('end', () => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('假服务没起来')
  return { baseURL: `http://127.0.0.1:${String(address.port)}`, seen }
}

describe('从回来的东西里挑数字', () => {
  it('只有一条货币时就是它', () => {
    expect(amountOf({ balance_infos: [{ currency: 'CNY', total_balance: '12.5' }] })).toBe(12.5)
  })

  it('指定货币只认那一条', () => {
    const parsed = {
      balance_infos: [
        { currency: 'CNY', total_balance: '8' },
        { currency: 'USD', total_balance: '2' },
      ],
    }
    expect(amountOf(parsed, 'USD')).toBe(2)
    expect(amountOf(parsed, 'CNY')).toBe(8)
  })

  it('不指定货币就把能读的加起来', () => {
    const parsed = {
      balance_infos: [
        { currency: 'CNY', total_balance: '8' },
        { currency: 'USD', total_balance: 2 },
      ],
    }
    expect(amountOf(parsed)).toBe(10)
  })

  it('读不成数字的条目跳过，一条都不成就是没有', () => {
    expect(amountOf({ balance_infos: [{ currency: 'CNY', total_balance: '不是数' }] })).toBeUndefined()
    expect(amountOf({})).toBeUndefined()
    expect(amountOf({ balance_infos: [] })).toBeUndefined()
  })
})

describe('去接口读一次', () => {
  it('读得到就给出数字，请求带上 key', async () => {
    const { baseURL, seen } = await fakeBalance(200, {
      balance_infos: [{ currency: 'CNY', total_balance: '3.2' }],
    })

    const amount = await readBalance({ baseURL, key: 'test-key', timeoutMs: 5_000 })

    expect(amount).toBe(3.2)
    expect(seen[0]).toContain('/user/balance')
    expect(seen[0]).toContain('Bearer test-key')
  })

  it('接口报错就抛，不编一个数出来', async () => {
    const { baseURL } = await fakeBalance(401, { error: 'bad key' })

    await expect(readBalance({ baseURL, key: 'test-key', timeoutMs: 5_000 })).rejects.toThrow(/回 401/u)
  })

  it('回来的一堆里没有数字也算错', async () => {
    const { baseURL } = await fakeBalance(200, { balance_infos: [{ currency: 'CNY' }] })

    await expect(readBalance({ baseURL, key: 'test-key', timeoutMs: 5_000 })).rejects.toThrow(/没有可用的数字/u)
  })
})

describe('装进运行环境', () => {
  it('没配 key 只记一行，不抛也不去连', async () => {
    const ctx = new Context()

    apply(ctx, {})
    await Promise.resolve()

    const warnings = ctx.logger.buffer.filter(entry => entry.type === 'warn')
    expect(warnings.some(entry => String(entry.args[0]).includes('没配 key'))).toBe(true)
  })

  it('卸载时把定时器停掉，进程不被拖着', async () => {
    vi.useFakeTimers()
    const { baseURL } = await fakeBalance(200, { balance_infos: [{ currency: 'CNY', total_balance: '1' }] })
    const root = new Context()
    // 挂成真插件再卸，effect 才会跟着走
    const fiber = await root.plugin({ name: 'qq-balance', apply: (ctx: Context) => { apply(ctx, { baseURL, apiKey: 'test-key', refreshMs: 60_000 }) } })
    const mounted = vi.getTimerCount()
    await fiber.dispose()
    const after = vi.getTimerCount()
    vi.useRealTimers()

    expect(mounted).toBeGreaterThan(0)
    expect(after).toBe(0)
  })
})
