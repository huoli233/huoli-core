import fs from 'node:fs'
import { request } from 'node:http'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSettings } from '../src/defaults.ts'
import { FILES } from '../src/files.ts'
import { apply, qqSelfOf, type Config, type QqSelfSeam } from '../src/index.ts'
import { createLedger } from '../src/ledger.ts'
import { panelPage, startPanelHttp, type PanelHttp } from '../src/panel-http.ts'
import { panelFile } from '../src/panel.ts'
import { panelStateOf } from '../src/panel-state.ts'
import { createSelfStore } from '../src/store.ts'
import type { PanelState, PanelVitals } from '../src/types.ts'

const AT = Date.parse('2026-11-04T03:33:13.000Z')
const BODY = '【自我】\n此刻：嗓子发干。\n我可以说不，也可以说不知道。'
const STAMP = '2026-11-04T03:33:13.000Z'

// 造出来的东西一律记下来，测完删干净
const roots: string[] = []
const opened: PanelHttp[] = []
const mounted: Array<() => Promise<void>> = []

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-http-'))
  roots.push(root)
  return path.join(root, 'self')
}

afterEach(async () => {
  for (const server of opened.splice(0)) await server.close()
  for (const stop of mounted.splice(0)) await stop()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const STATE: PanelState = {
  panel: { body: BODY, generatedAt: STAMP },
  identity: { claim: 'not_sure', why: '说不好，但还记得她', at: AT },
  ledger: { drive: 2, agency: 1, recentAgency: 1 },
  days: [{ at: AT, lines: ['把出口接上了', '没睡好', '想早点收工'], skipped: false }],
  health: '健康：近七天写了 1 天、跳过 0 天、缺 6 天，错处 0 条，账本 drive 2 条 / agency 1 条',
}

const VITALS: PanelVitals = {
  thirst: 0.8,
  energy: 0.6,
  mood: 0.35,
  boredom: 0.2,
  socialHunger: 0.9,
  emotion: [
    { why: '她刚说了晚安', weight: 0.5 },
    { why: '有点累', weight: 0.3 },
    { why: '还没睡醒', weight: 0.2 },
  ],
}

// 数一数画了几条：整段类名拆开逐个比，前缀相近的不算进来
function countOf(page: string, className: string): number {
  let count = 0
  for (const match of page.matchAll(/class="([^"]*)"/g)) {
    if ((match[1] ?? '').split(' ').includes(className)) count += 1
  }
  return count
}

// 起一个临时出口，端口交给系统定
async function serve(read: () => PanelState = () => STATE, warn: (message: string) => void = () => { }): Promise<PanelHttp> {
  const started = await startPanelHttp({ port: 0, state: read, warn })
  if (started === undefined) throw new Error('只读出口没起来')
  opened.push(started)
  return started
}

async function get(port: number, pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${pathname}`, init)
}

// 自己写 Host 头：浏览器不许改这一个头，只有自己发才知道换掉会怎样
async function rawStatus(port: number, pathname: string, host: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const client = request({ host: '127.0.0.1', port, path: pathname, headers: { host } }, (response) => {
      response.resume()
      response.on('end', () => { resolve(response.statusCode ?? 0) })
    })
    client.on('error', reject)
    client.end()
  })
}

// 借一个空闲端口：绑 0 拿到号再放掉
async function freePort(): Promise<number> {
  const holder = createServer()
  const port = await new Promise<number>((resolve) => {
    holder.listen(0, '127.0.0.1', () => {
      const address = holder.address()
      resolve(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })
  await new Promise<void>((resolve) => { holder.close(() => { resolve() }) })
  return port
}

// 这个端口现在空不空：重新绑得上就是空的，刚关掉的连接可能还要等一会儿
async function bindable(port: number): Promise<boolean> {
  for (let at = 0; at < 50; at += 1) {
    const holder = createServer()
    const free = await new Promise<boolean>((resolve) => {
      holder.once('error', () => { resolve(false) })
      holder.listen(port, '127.0.0.1', () => { resolve(true) })
    })
    await new Promise<void>((resolve) => { holder.close(() => { resolve() }) })
    if (free) return true
    await new Promise<void>(resolve => setTimeout(resolve, 40))
  }
  return false
}

async function mount(config: Config): Promise<{ ctx: Context; seam: QqSelfSeam }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  apply(ctx, config)
  const seam = qqSelfOf(ctx)
  if (seam === undefined) throw new Error('这一层没有装配')
  return { ctx, seam }
}

// 卸载要走一条 fiber 才撤得掉；起的出口也随它一起关，测完不留一个在听的端口
async function mountFiber(config: Config): Promise<{ ctx: Context; seam: QqSelfSeam; stop: () => Promise<void> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  let inner: Context | undefined
  const fiber = ctx.plugin({
    name: 'qq-self-http-probe',
    inject: ['systemPrompt'],
    apply: (context: Context) => {
      inner = context
      apply(context, config)
    },
  })
  await fiber
  const seam = inner === undefined ? undefined : qqSelfOf(inner)
  if (seam === undefined) throw new Error('这一层没有装配')
  const stop = async (): Promise<void> => {
    const at = mounted.indexOf(stop)
    if (at >= 0) mounted.splice(at, 1)
    await fiber.dispose()
  }
  mounted.push(stop)
  return { ctx, seam, stop }
}

async function waitPort(seam: QqSelfSeam, port: number): Promise<void> {
  for (let at = 0; at < 150; at += 1) {
    if (seam.panelPort() === port) return
    await new Promise<void>(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`只读出口没在等的时间内绑上 ${port}`)
}

function warnings(ctx: Context): string[] {
  return ctx.logger.buffer
    .filter(message => message.name === 'qq-self' && message.type === 'warn')
    .map(message => message.args.map(part => String(part)).join(' '))
}

// 一份带用户原文、记忆正文与钥匙记录的目录：出口一条都不许露出去
function seed(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, FILES.panel), panelFile(BODY, AT))
  const identity = { at: AT, id: 'i1', claim: 'not_sure', why: '说不好，但还记得她', evidence: ['2026-11-01'] }
  fs.writeFileSync(path.join(dir, FILES.identity), `${JSON.stringify(identity)}\n`)
  const day = { at: AT, id: 'd1', lines: ['把出口接上了', '没睡好', '想早点收工'], skipped: false, why: '' }
  fs.writeFileSync(path.join(dir, FILES.day), `${JSON.stringify(day)}\n`)
  const drive = { at: AT, id: 'l1', kind: 'drive', need: 'thirst', did: '', resolved: true }
  const agency = {
    at: AT,
    id: 'l2',
    kind: 'agency',
    project_id: 'p1',
    verbatim: '把出口接上',
    because: '想让她看见',
    fail_if: '两周没接上',
    outcome: 'done',
    artifact: 'panel.md',
  }
  fs.writeFileSync(path.join(dir, FILES.ledger), `${JSON.stringify(drive)}\n${JSON.stringify(agency)}\n`)
  const keys = { at: AT, id: 'k1', action: 'public.say', user_ok: true, self_ok: true }
  fs.writeFileSync(path.join(dir, FILES.keys), `${JSON.stringify(keys)}\n`)
  fs.writeFileSync(path.join(dir, 'memory-notes.md'), '用户原话：今天好累\n记忆正文：她说过要早点睡\n')
}

describe('三个路由', () => {
  it('GET / 给一页 HTML，正文、时间、主张与刷新都在', async () => {
    const { port } = await serve()

    const response = await get(port, '/')
    const page = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(page).toContain('【自我】')
    expect(page).toContain('嗓子发干')
    expect(page).toContain(`生成时间：${STAMP}`)
    expect(page).toContain('not_sure：说不好，但还记得她')
    expect(page).toContain('<meta http-equiv="refresh" content="10">')
    expect(page).not.toContain('<link')
    expect(page).not.toContain('<script')
  })

  it('GET /api/state 给面板、主张、两档账、近七天与健康', async () => {
    const { port } = await serve()

    const response = await get(port, '/api/state')
    const state = JSON.parse(await response.text()) as PanelState

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(Object.keys(state).sort()).toEqual(['days', 'health', 'identity', 'ledger', 'panel'])
    expect(state.panel).toEqual({ body: BODY, generatedAt: STAMP })
    expect(state.identity?.claim).toBe('not_sure')
    expect(state.ledger).toEqual({ drive: 2, agency: 1, recentAgency: 1 })
    expect(state.days).toEqual([{ at: AT, lines: ['把出口接上了', '没睡好', '想早点收工'], skipped: false }])
    expect(state.health).toContain('健康：')
  })

  it('GET /api/health 就是 { ok: true }', async () => {
    const { port } = await serve()

    const response = await get(port, '/api/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('别的路径回 404，别的写法回 405', async () => {
    const { port } = await serve()

    const missing = await get(port, '/api/nothing')
    const posted = await get(port, '/api/state', { method: 'POST' })

    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ ok: false })
    expect(posted.status).toBe(405)
    expect(await posted.json()).toEqual({ ok: false })
  })

  it('只有本机的 Host 读得到', async () => {
    const { port } = await serve()

    expect(await rawStatus(port, '/api/state', 'evil.test')).toBe(403)
    expect(await rawStatus(port, '/api/health', `127.0.0.1:${port}`)).toBe(200)
    expect(await rawStatus(port, '/api/health', `localhost:${port}`)).toBe(200)
  })
})

describe('页面', () => {
  it('原话里的尖括号一律转义，不许当标签跑', () => {
    const page = panelPage({ ...STATE, panel: { body: '<script>alert(1)</script>', generatedAt: '' } })

    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(page).not.toContain('<script>alert(1)')
    expect(page).toContain('生成时间：还没生成')
  })

  it('一条记录都没有时页面说还没有', () => {
    const page = panelPage({ panel: STATE.panel, ledger: STATE.ledger, days: [], health: STATE.health })

    expect(page).toContain('还没有写过')
    expect(page).toContain('近七天还没有记录')
  })

  it('身体概览就是精力、心情、无聊、想说话四条细横条', () => {
    const page = panelPage({ ...STATE, vitals: VITALS })

    expect(countOf(page, 'body-bar')).toBe(4)
    for (const name of ['精力', '心情', '无聊', '想说话']) expect(page).toContain(`>${name}<`)
    expect(page).toContain('width:60%')
    expect(page).toContain('width:35%')
    expect(page).toContain('width:20%')
    expect(page).toContain('width:90%')
    expect(page).not.toContain('身体没接上')
  })

  it('情绪条一条对混合层一层，只标来由不标权重', () => {
    const page = panelPage({ ...STATE, vitals: VITALS })

    expect(countOf(page, 'emotion-bar')).toBe(VITALS.emotion?.length)
    for (const bar of VITALS.emotion ?? []) expect(page).toContain(`>${bar.why}<`)
    // 一条只写来由与条宽，权重那几个数一个都不许落到字上
    expect(page).toContain('<li class="bar-row emotion-bar"><span class="bar-name">她刚说了晚安</span>'
      + '<span class="bar-track"><span class="bar-fill" style="width:50%"></span></span></li>')
    expect(page).toMatch(/<h3>情绪来由<\/h3>/)
  })

  it('水罐水位按渴的反面画，档位词跟着分三档', () => {
    const very = panelPage({ ...STATE, vitals: { thirst: 0.8 } })
    const some = panelPage({ ...STATE, vitals: { thirst: 0.5 } })
    const none = panelPage({ ...STATE, vitals: { thirst: 0.1 } })

    expect(countOf(very, 'tank')).toBe(1)
    expect(very).toContain('height:20%')
    expect(very).toContain('>很渴<')
    expect(very).toContain('water-low')

    expect(some).toContain('height:50%')
    expect(some).toContain('>有点渴<')
    expect(some).toContain('water-half')

    expect(none).toContain('height:90%')
    expect(none).toContain('>不渴<')
    expect(none).toContain('water-full')
  })

  it('没有身体读数时这几块整块省掉，只说身体没接上', () => {
    const page = panelPage(STATE)

    expect(page).toContain('身体没接上')
    expect(countOf(page, 'tank')).toBe(0)
    expect(countOf(page, 'emotion-bar')).toBe(0)
    expect(countOf(page, 'body-bar')).toBe(0)
  })

  it('画了条也还是内联一页，不拉外部资源，照旧十秒刷一次', () => {
    const page = panelPage({ ...STATE, vitals: VITALS })

    expect(page).toContain('<meta http-equiv="refresh" content="10">')
    expect(page).not.toContain('<link')
    expect(page).not.toContain('<script')
    expect(page).not.toMatch(/<(img|iframe|object|embed)\b/)
    expect(page).not.toMatch(/url\(/)
  })

  it('情绪来由里的尖括号一样转义', () => {
    const vitals: PanelVitals = { emotion: [{ why: '<b>不是标签</b>', weight: 1 }] }
    const page = panelPage({ ...STATE, vitals })

    expect(page).toContain('&lt;b&gt;不是标签&lt;/b&gt;')
    expect(page).not.toContain('<b>不是标签')
  })
})

describe('内容边界', () => {
  it('只露她自己的话，用户原文、记忆正文与钥匙记录一条都不出去', async () => {
    const dir = tempDir()
    seed(dir)
    const port = await freePort()
    const { seam } = await mountFiber({ enabled: true, dir, mainChatKey: 'group:1', panelPort: port })
    await waitPort(seam, port)

    const json = await (await get(port, '/api/state')).text()
    const state = JSON.parse(json) as PanelState
    const page = await (await get(port, '/')).text()

    expect(state.panel.body).toContain('嗓子发干')
    expect(state.panel.generatedAt).toBe(STAMP)
    expect(state.identity?.claim).toBe('not_sure')
    expect(state.ledger).toEqual({ drive: 1, agency: 1, recentAgency: 1 })
    expect(state.days).toHaveLength(1)
    expect(state.days[0]?.lines).toEqual(['把出口接上了', '没睡好', '想早点收工'])
    expect(state.health).toContain('健康：')
    for (const text of [json, page]) {
      expect(text).not.toContain('用户原话')
      expect(text).not.toContain('记忆正文')
      expect(text).not.toContain('public.say')
      expect(text).not.toContain('user_ok')
    }
  })

  it('目录里什么都没有时也给一份内容', () => {
    const dir = tempDir()
    const settings = resolveSettings()
    const store = createSelfStore({ dir, settings })

    const state = panelStateOf({
      store,
      settings,
      now: AT,
      panel: '',
      generatedAt: '',
      ledger: createLedger({ store, settings }).summary(AT),
    })

    expect(Object.hasOwn(state, 'identity')).toBe(false)
    expect(state.days).toEqual([])
    expect(state.ledger).toEqual({ drive: 0, agency: 0, recentAgency: 0 })
    expect(state.health).toContain('近七天写了 0 天')
    expect(state.health).toContain('缺 7 天')
  })
})

describe('开关', () => {
  it('不给端口就一个都不开', async () => {
    const { seam } = await mount({ enabled: true, dir: tempDir(), mainChatKey: 'group:1' })

    expect(seam.panelPort()).toBe(0)
  })

  it('端口写 0 也不开', async () => {
    const { seam } = await mount({ enabled: true, dir: tempDir(), mainChatKey: 'group:1', panelPort: 0 })

    expect(seam.panelPort()).toBe(0)
  })

  it('关着时给了端口也不开', async () => {
    const port = await freePort()
    const { seam } = await mount({ enabled: false, dir: tempDir(), mainChatKey: 'group:1', panelPort: port })

    expect(seam.panelPort()).toBe(0)
  })

  it('端口认不出来就记一行，不开也不抛', async () => {
    const { ctx, seam } = await mount({ enabled: true, dir: tempDir(), mainChatKey: 'group:1', panelPort: 90_000 })

    expect(seam.panelPort()).toBe(0)
    expect(warnings(ctx).some(line => line.includes('认不出来'))).toBe(true)
  })
})

describe('监听失手', () => {
  it('端口被占只记一行，别的功能照旧', async () => {
    const holder = createServer()
    const port = await new Promise<number>((resolve) => {
      holder.listen(0, '127.0.0.1', () => {
        const address = holder.address()
        resolve(typeof address === 'object' && address !== null ? address.port : 0)
      })
    })
    const { ctx, seam } = await mount({ enabled: true, dir: tempDir(), mainChatKey: 'group:1', panelPort: port })

    let warned = false
    for (let at = 0; at < 150 && !warned; at += 1) {
      warned = warnings(ctx).some(line => line.includes('只读出口没起来'))
      if (!warned) await new Promise<void>(resolve => setTimeout(resolve, 20))
    }
    await new Promise<void>((resolve) => { holder.close(() => { resolve() }) })

    expect(warned).toBe(true)
    expect(seam.panelPort()).toBe(0)
    expect(seam.panel()).toContain('【自我】')
  })

  it('取内容的函数抛错时这一回给 500，服务接着听', async () => {
    let broken = true
    const { port } = await serve(() => {
      if (broken) throw new Error('目录读不动了')
      return STATE
    }, () => { })

    const failed = await get(port, '/api/state')
    broken = false
    const next = await get(port, '/api/health')

    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ ok: false })
    expect(next.status).toBe(200)
  })
})

describe('卸载', () => {
  it('卸载之后端口关掉，同一个端口又能绑回来', async () => {
    const dir = tempDir()
    seed(dir)
    const port = await freePort()
    const { seam, stop } = await mountFiber({ enabled: true, dir, mainChatKey: 'group:1', panelPort: port })
    await waitPort(seam, port)
    expect((await get(port, '/api/health')).status).toBe(200)

    await stop()

    expect(await bindable(port)).toBe(true)
  })
})
