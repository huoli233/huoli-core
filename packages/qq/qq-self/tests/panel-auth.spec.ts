import { request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { PANEL_COOKIE, panelPage, startPanelHttp, type PanelHttp } from '../src/panel-http.ts'
import type { PanelState } from '../src/types.ts'

const STATE: PanelState = {
  panel: { body: '【自我】\n她在。', generatedAt: '2026-11-05T09:00:00.000Z' },
  ledger: { drive: 3, agency: 2, recentAgency: 1 },
  days: [],
  health: '健康：一切正常',
  vitals: { thirst: 0.4, energy: 0.6 },
}

const started: PanelHttp[] = []

// 起一个只在本机的出口，端口交给系统挑
async function serve(token?: string): Promise<number> {
  const panel = await startPanelHttp({
    port: 0,
    state: () => STATE,
    ...token === undefined ? {} : { token },
    warn: () => {},
  })
  if (panel === undefined) throw new Error('出口没起来')
  started.push(panel)
  return panel.port
}

interface Answer {
  status: number
  cookie: string
  body: string
}

// 发一个本机请求，带上自定义的 Cookie 头
function get(port: number, path: string, cookie = ''): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: 'GET', headers: cookie === '' ? {} : { cookie } },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const raw = response.headers['set-cookie']
          resolve({
            status: response.statusCode ?? 0,
            cookie: Array.isArray(raw) ? raw.join(';') : raw ?? '',
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

afterEach(async () => {
  for (const panel of started.splice(0)) await panel.close()
})

describe('面板口令', () => {
  it('没配口令时本机直接能看', async () => {
    const port = await serve()

    expect((await get(port, '/')).status).toBe(200)
    expect((await get(port, '/api/state')).status).toBe(200)
  })

  it('配了口令又没带就是 403，两路都挡住', async () => {
    const port = await serve('看我的')

    expect((await get(port, '/')).status).toBe(403)
    expect((await get(port, '/api/state')).status).toBe(403)
  })

  it('健康十问不带数据，仍然放行', async () => {
    const port = await serve('看我的')

    const answer = await get(port, '/api/health')

    expect(answer.status).toBe(200)
    expect(answer.body).toContain('true')
  })

  it('参数里带对了就放行，并顺手记一块饼干', async () => {
    const port = await serve('看我的')

    const answer = await get(port, `/api/state?token=${encodeURIComponent('看我的')}`)

    expect(answer.status).toBe(200)
    expect(answer.cookie).toContain(`${PANEL_COOKIE}=`)
    expect(answer.cookie).toContain('HttpOnly')
    expect(answer.cookie).toContain('SameSite=Strict')
  })

  it('只带饼干也认，不用每次拼参数', async () => {
    const port = await serve('看我的')

    const answer = await get(port, '/', `${PANEL_COOKIE}=${encodeURIComponent('看我的')}`)

    expect(answer.status).toBe(200)
    expect(answer.body).toContain('【自我】')
  })

  it('口令不对照样 403', async () => {
    const port = await serve('看我的')

    expect((await get(port, `/?token=${encodeURIComponent('猜的')}`)).status).toBe(403)
    expect((await get(port, '/', `${PANEL_COOKIE}=${encodeURIComponent('猜的')}`)).status).toBe(403)
  })
})

describe('面板动效', () => {
  it('页面里有减少动效的判断与帧率上限', () => {
    const page = panelPage(STATE)

    expect(page).toContain('prefers-reduced-motion')
    // 30fps 的帧间隔：1000/30 取整成 33 毫秒
    expect(page).toContain('FRAME_MS=33')
  })
})
