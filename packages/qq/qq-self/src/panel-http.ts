// 只读面板出口：只绑回环地址的 HTTP 服务，只认三个 GET 路由，不写文件也不改状态

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { localDay } from './day.ts'
import type { PanelDayRow, PanelState, PanelVitals } from './types.ts'

// 出口只绑这个地址，别的网卡上连不进来
const LOOPBACK = '127.0.0.1'

// 页面每隔这么多秒自己刷一次
const REFRESH_SECONDS = 10

const HTML = 'text/html; charset=utf-8'
const JSON_TYPE = 'application/json; charset=utf-8'

// 页面上出现的每一段都要转义：她的原话里也可能有尖括号
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

// 一天压成一行：跳过的写原因，写过的把三行接起来
function dayText(row: PanelDayRow): string {
  const day = localDay(row.at)
  if (row.skipped) return `${day}：跳过`
  return `${day}：${row.lines.filter(line => line !== '').join(' / ')}`
}

// 样式内联，一页不拉任何外部资源
const STYLE = [
  'body{font:14px/1.7 system-ui,sans-serif;margin:24px;color:#222;background:#fafafa}',
  'h1{font-size:16px;margin:0 0 8px}',
  'h2{font-size:14px;margin:18px 0 4px}',
  'h3{font-size:13px;font-weight:600;margin:12px 0 4px;color:#555}',
  'pre{white-space:pre-wrap;margin:0;padding:12px;background:#fff;border:1px solid #ddd;border-radius:6px}',
  'p{margin:4px 0}',
  'ul{margin:0;padding-left:20px}',
  '.muted{color:#666}',
  '.bars{margin:0;padding:0;list-style:none;max-width:420px}',
  '.tank{display:flex;align-items:flex-end;gap:10px}',
  '.tank-well{display:flex;align-items:flex-end;width:28px;height:96px;background:#eef2f6;border:1px solid #c8d0d8;border-radius:4px;overflow:hidden}',
  '.tank-water{width:100%}',
  '.water-full{background:#1f6fb2}',
  '.water-half{background:#5b9bd5}',
  '.water-low{background:#a8cbe8}',
  '.tank-word{color:#444}',
  '.bar-row{display:grid;grid-template-columns:7em 1fr;align-items:center;gap:8px;margin:3px 0}',
  '.bar-name{font-size:12px;color:#444;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.bar-track{display:block;height:6px;background:#e6eaee;border-radius:3px;overflow:hidden}',
  '.bar-fill{display:block;height:100%;border-radius:3px}',
  '.body-bar .bar-track{height:4px}',
  '.body-bar .bar-fill{background:#7aa7c7}',
  '.emotion-bar .bar-fill{background:#b0736a}',
].join('')

// 条宽只认零到一：越界的值收回来，条不会画出格子外面去
function percent(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`
}

// 渴分三档，每档一个中文词与一档蓝色：水越多档位越深
function thirstTier(thirst: number): { word: string; shade: string } {
  if (thirst < 1 / 3) return { word: '不渴', shade: 'water-full' }
  if (thirst < 2 / 3) return { word: '有点渴', shade: 'water-half' }
  return { word: '很渴', shade: 'water-low' }
}

// 水罐：水位按渴的反面画，旁边的词只说在哪个档
function waterTank(vitals: PanelVitals): string[] {
  const thirst = vitals.thirst
  if (thirst === undefined) return []
  const tier = thirstTier(thirst)
  return [
    '<h3>水罐</h3>',
    '<div class="tank">',
    `<div class="tank-well"><div class="tank-water ${tier.shade}" style="height:${percent(1 - thirst)}"></div></div>`,
    `<span class="tank-word">${tier.word}</span>`,
    '</div>',
  ]
}

// 情绪条：一层一条，条宽只由权重定，字只写来由
function emotionBars(vitals: PanelVitals): string[] {
  const bars = vitals.emotion
  if (bars === undefined || bars.length === 0) return []
  const rows = bars.map(bar => [
    '<li class="bar-row emotion-bar">',
    `<span class="bar-name">${escapeHtml(bar.why)}</span>`,
    `<span class="bar-track"><span class="bar-fill" style="width:${percent(bar.weight)}"></span></span>`,
    '</li>',
  ].join(''))
  return ['<h3>情绪来由</h3>', `<ul class="bars">${rows.join('')}</ul>`]
}

// 身体概览：四个读数一个一条细横条，缺哪条就不画哪条
function bodyOverview(vitals: PanelVitals): string[] {
  const figures: ReadonlyArray<readonly [string, number | undefined]> = [
    ['精力', vitals.energy],
    ['心情', vitals.mood],
    ['无聊', vitals.boredom],
    ['想说话', vitals.socialHunger],
  ]
  const rows = figures
    .filter((row): row is readonly [string, number] => row[1] !== undefined)
    .map(([name, value]) => [
      '<li class="bar-row body-bar">',
      `<span class="bar-name">${name}</span>`,
      `<span class="bar-track"><span class="bar-fill" style="width:${percent(value)}"></span></span>`,
      '</li>',
    ].join(''))
  if (rows.length === 0) return []
  return ['<h3>身体概览</h3>', `<ul class="bars">${rows.join('')}</ul>`]
}

// 身体那一块：没有读数时整块换成一句没接上，不留空壳
function bodyBlocks(vitals: PanelVitals | undefined): string[] {
  const blocks = vitals === undefined
    ? []
    : [...waterTank(vitals), ...emotionBars(vitals), ...bodyOverview(vitals)]
  return blocks.length === 0 ? ['<p class="muted">身体没接上</p>'] : blocks
}

/**
 * 那一页极简的 HTML
 * @param state - 只读出口的内容
 * @returns 内联样式、没有外部资源的一页，每 10 秒自己刷一次
 */
export function panelPage(state: PanelState): string {
  const identity = state.identity === undefined
    ? '还没有写过'
    : `${state.identity.claim}：${state.identity.why}`
  const days = state.days.length === 0
    ? '<li class="muted">近七天还没有记录</li>'
    : state.days.map(row => `<li>${escapeHtml(dayText(row))}</li>`).join('')
  const generatedAt = state.panel.generatedAt === '' ? '还没生成' : state.panel.generatedAt
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="refresh" content="${REFRESH_SECONDS}">`,
    '<title>自我面板</title>',
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    '<h1>自我面板</h1>',
    `<p class="muted">生成时间：${escapeHtml(generatedAt)}</p>`,
    `<pre>${escapeHtml(state.panel.body)}</pre>`,
    '<h2>身份主张</h2>',
    `<p>${escapeHtml(identity)}</p>`,
    '<h2>身体</h2>',
    ...bodyBlocks(state.vitals),
    '<h2>最近七天</h2>',
    `<ul>${days}</ul>`,
    `<p class="muted">${escapeHtml(state.health)}</p>`,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

// 三种路由的回法都只有状态码、类型与整段正文
function send(response: ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  response.end(body)
}

/** 起出口要用的东西 */
export interface PanelHttpOptions {
  /** 绑哪个端口，只绑回环地址 */
  port: number
  /** 每次请求现算一份内容，算的时候不写盘 */
  state(now: number): PanelState
  /** 起不来时把这一句交给调用方记一行 */
  warn(message: string): void
}

/** 一个已经在听的出口 */
export interface PanelHttp {
  /** 实际绑上的端口 */
  readonly port: number
  /** 关掉服务，关完这个端口就空出来了 */
  close(): Promise<void>
}

// 关的时候连还挂着的连接一起断：这一页没有要等的东西
function shutdown(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve()
      return
    }
    server.close(() => { resolve() })
    server.closeAllConnections()
  })
}

// 只认本机写的 Host：别的域名解析到回环地址也读不到，防域名重绑
function localHost(host: string | undefined): boolean {
  if (host === undefined) return false
  const name = host.split(':')[0] ?? ''
  return name === '127.0.0.1' || name === 'localhost'
}

// 一个请求怎么回：只认本机与 GET 的三个路由，别的一律给码，不碰任何状态
function answer(request: IncomingMessage, response: ServerResponse, options: PanelHttpOptions): void {
  if (!localHost(request.headers.host)) {
    send(response, 403, JSON_TYPE, '{"ok":false}\n')
    return
  }
  if (request.method !== 'GET') {
    send(response, 405, JSON_TYPE, '{"ok":false}\n')
    return
  }
  const path = new URL(request.url ?? '/', `http://${LOOPBACK}`).pathname
  if (path === '/') {
    send(response, 200, HTML, panelPage(options.state(Date.now())))
    return
  }
  if (path === '/api/state') {
    send(response, 200, JSON_TYPE, `${JSON.stringify(options.state(Date.now()))}\n`)
    return
  }
  if (path === '/api/health') {
    send(response, 200, JSON_TYPE, '{"ok":true}\n')
    return
  }
  send(response, 404, JSON_TYPE, '{"ok":false}\n')
}

/**
 * 起一个只读出口
 * @param options - 端口、取内容的函数与记日志的出口
 * @returns 已经在听的出口；端口被占或监听失手时为 undefined，只记一行
 */
export function startPanelHttp(options: PanelHttpOptions): Promise<PanelHttp | undefined> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      try {
        answer(request, response, options)
      } catch (error) {
        // 算这一次的内容失手只回 500，服务本身接着听
        options.warn(`只读出口这一次没算出来：${String(error)}`)
        if (!response.headersSent) send(response, 500, JSON_TYPE, '{"ok":false}\n')
      }
    })
    server.on('error', (error: Error) => {
      // 端口被占或别的监听失手：只记一行，降级为不监听，别的功能照旧
      options.warn(`只读出口没起来：端口 ${options.port} ${error.message}`)
      resolve(undefined)
    })
    server.listen(options.port, LOOPBACK, () => {
      const address = server.address()
      const bound = typeof address === 'object' && address !== null ? address.port : options.port
      resolve({ port: bound, close: () => shutdown(server) })
    })
  })
}
