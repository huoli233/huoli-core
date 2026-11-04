// 只读面板出口：只绑回环地址的 HTTP 服务，只认三个 GET 路由，不写文件也不改状态

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { localDay } from './day.ts'
import type { PanelDayRow, PanelState } from './types.ts'

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
  'pre{white-space:pre-wrap;margin:0;padding:12px;background:#fff;border:1px solid #ddd;border-radius:6px}',
  'p{margin:4px 0}',
  'ul{margin:0;padding-left:20px}',
  '.muted{color:#666}',
].join('')

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
