import fs from 'node:fs'
import { request } from 'node:http'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Script } from 'node:vm'
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

const AT = Date.now()
const BODY = '【自我】\n此刻：嗓子发干。\n我可以说不，也可以说不知道。'
const STAMP = new Date(AT).toISOString()

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
  // 这一层的行为用例不靠工具跑，给一个空的登记口就够
  ctx.provide('tools', { register: () => () => {} })
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
    expect(page).toContain('setInterval(tick,3000)')
    expect(page).toContain('/api/state')
    expect(page).not.toContain('<link')
    expect(page).not.toContain('<script src')
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

describe('面板急停', () => {
  it('能在本机页面停止和恢复全局运行', async () => {
    let state = { active: false, at: 0, reason: '' }
    const started = await startPanelHttp({
      port: 0,
      state: () => STATE,
      warn: () => {},
      control: {
        state: () => state,
        stop(reason) {
          state = { active: true, at: Date.now(), reason }
        },
        resume() {
          state = { active: false, at: 0, reason: '' }
        },
      },
    })
    if (started === undefined) throw new Error('面板没起来')
    opened.push(started)

    const page = await (await get(started.port, '/')).text()
    expect(page).toContain('运行控制')
    expect(page).toContain('id="emergency-stop"')
    const stopped = await (await get(started.port, '/api/emergency-stop?reason=面板急停', { method: 'POST' })).json() as typeof state
    expect(stopped).toMatchObject({ active: true, reason: '面板急停' })
    const resumed = await (await get(started.port, '/api/emergency-resume', { method: 'POST' })).json() as typeof state
    expect(resumed.active).toBe(false)
  })
})

describe('面板互动模式', () => {
  it('显示三种模式，切换后回写当前模式，乱填的值拒绝', async () => {
    let mode = 'autonomous'
    const options = [
      { value: 'probability', label: '概率闲聊' },
      { value: 'heartflow', label: '心流模式' },
      { value: 'autonomous', label: '完整拟人自主' },
    ] as const
    const started = await startPanelHttp({
      port: 0,
      state: () => STATE,
      warn: () => {},
      control: {
        state: () => ({ active: false, at: 0, reason: '' }),
        stop: () => {},
        resume: () => {},
        mode: {
          state: () => ({ mode, changedAt: 1 }),
          options,
          set(next) {
            if (!options.some(option => option.value === next)) throw new Error('bad mode')
            mode = next
          },
        },
      },
    })
    if (started === undefined) throw new Error('面板没起来')
    opened.push(started)

    const page = await (await get(started.port, '/')).text()
    expect(page).toContain('id="mode-select"')
    expect(page).toContain('完整拟人自主')
    const changed = await (await get(started.port, '/api/mode?value=heartflow', { method: 'POST' })).json() as { mode: string }
    expect(changed.mode).toBe('heartflow')
    expect((await get(started.port, '/api/mode?value=wrong', { method: 'POST' })).status).toBe(400)
  })

  it('面板先起来、模式控制后接上时仍能显示并切换', async () => {
    const port = await freePort()
    const { seam } = await mountFiber({ enabled: true, dir: tempDir(), mainChatKey: 'group:1', panelPort: port })
    await waitPort(seam, port)
    let mode = 'autonomous'
    seam.useModeControl({
      state: () => ({ mode, changedAt: 1 }),
      options: [
        { value: 'probability', label: '概率闲聊' },
        { value: 'heartflow', label: '心流模式' },
        { value: 'autonomous', label: '完整拟人自主' },
      ],
      set(next) {
        mode = next
      },
    })

    expect(await (await get(port, '/')).text()).toContain('id="mode-select"')
    const changed = await (await get(port, '/api/mode?value=heartflow', { method: 'POST' })).json() as { mode: string }
    expect(changed.mode).toBe('heartflow')
  })
})

describe('面板角色与 QQ 诊断', () => {
  it('能选角色、按会话绑定、查关系和时间线', async () => {
    let activeId = 'gentle'
    let bound = ''
    const started = await startPanelHttp({
      port: 0,
      state: () => STATE,
      warn: () => {},
      control: {
        state: () => ({ active: false, at: 0, reason: '' }),
        stop: () => {},
        resume: () => {},
        personas: {
          list: () => [{ id: 'gentle', name: '温和角色' }, { id: 'lively', name: '活泼角色' }],
          activeId: () => activeId,
          setActive(id) {
            activeId = id
          },
          bind(chatKey, id) {
            bound = `${chatKey}:${id}`
          },
        },
        qq: {
          relation: personId => ({ found: true, personId }),
          timeline: (traceId, limit) => [{ traceId, kind: 'inbound_received', limit }],
        },
      },
    })
    if (started === undefined) throw new Error('面板没起来')
    opened.push(started)

    const page = await (await get(started.port, '/')).text()
    expect(page).toContain('id="persona-select"')
    expect(page).toContain('id="relation-query"')
    expect(page).toContain('id="trace-query"')
    const changed = await (await get(started.port, '/api/persona-active?value=lively', { method: 'POST' })).json() as {
      ok: boolean
      activeId: string
    }
    expect(changed).toMatchObject({ ok: true, activeId: 'lively' })
    expect(activeId).toBe('lively')
    await get(started.port, '/api/persona-bind?chatKey=group%3A1&value=lively', { method: 'POST' })
    expect(bound).toBe('group:1:lively')
    expect(await (await get(started.port, '/api/relation?personId=u1&chatKey=group%3A1')).json())
      .toMatchObject({ found: true, personId: 'u1' })
    expect(await (await get(started.port, '/api/timeline?traceId=group%3A1%23msg-2&limit=5')).json())
      .toMatchObject([{ traceId: 'group:1#msg-2', limit: 5 }])
  })
})

describe('页面', () => {
  it('窄屏下内容列可收缩，不保留固定的宽条最小值', () => {
    const page = panelPage({ ...STATE, vitals: VITALS })

    expect(page).toContain('@media (max-width:520px)')
    expect(page).toContain('grid-template-columns:5.5em minmax(0,1fr)')
    expect(page).toContain('canvas{max-width:100%}')
  })

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

  it('水罐水位按渴的反面画，颜色按水位分三档', () => {
    const very = panelPage({ ...STATE, vitals: { thirst: 0.8 } })
    const some = panelPage({ ...STATE, vitals: { thirst: 0.6 } })
    const none = panelPage({ ...STATE, vitals: { thirst: 0.1 } })

    expect(countOf(very, 'tank')).toBe(1)
    expect(very).toContain('height:20%')
    expect(very).toContain('>很渴<')
    expect(very).toContain('water-low')

    expect(some).toContain('height:40%')
    expect(some).toContain('water-mid')

    expect(none).toContain('height:90%')
    expect(none).toContain('>不渴<')
    expect(none).toContain('water-high')
  })

  it('水罐只用三种蓝，颜色只由水位决定，与渴的档位词无关', () => {
    // 同一档蓝色的两次渲染之间颜色词不跟着渴的措辞变；只看水罐元素上的类
    const lowWater = panelPage({ ...STATE, vitals: { thirst: 0.9 } })
    const alsoLowWater = panelPage({ ...STATE, vitals: { thirst: 0.8 } })

    expect(lowWater).toContain('tank-water water-low')
    expect(alsoLowWater).toContain('tank-water water-low')
    expect(lowWater).not.toContain('tank-water water-mid')
    expect(lowWater).not.toContain('tank-water water-high')
  })

  it('水罐、体内环境、周期盘各有画布，属性带的是这一刻的数', () => {
    const page = panelPage({
      ...STATE,
      vitals: {
        thirst: 0.5, tired: 0.4, temp: 36.8, fever: 0, immunity: 0.2, pain: 0.1, estrogen: 0.3,
        cycleDay: 12, cycleLen: 30, cyclePhase: 'ovulation', cycleBounds: [5, 12, 15, 23],
      },
    })

    expect(page).toContain('canvas class="water"')
    expect(page).toContain('data-thirst="0.5"')
    expect(page).toContain('data-keys="tired,temp,fever,immunity,pain,estrogen"')
    expect(page).toContain('data-phase="ovulation"')
    expect(page).toContain('data-bounds="5,12,15,23"')
    expect(page).toContain('体内环境')
    expect(page).toContain('睡眠压力')
  })

  it('体内环境只画拿得到的那几条，缺的不位置', () => {
    const page = panelPage({ ...STATE, vitals: { thirst: 0.5, temp: 36.8, pain: 0.1 } })

    expect(page).toContain('data-keys="temp,pain"')
  })

  it('五组双条画成两条并排的横条，名字与读数都在', () => {
    const page = panelPage({
      ...STATE,
      vitals: { thirst: 0.5, pairs: [{ name: '自主神经', a: '交感', av: 0.6, b: '副交感', bv: 0.3 }] },
    })

    expect(page).toContain('神经-体液')
    expect(page).toContain('交感')
    expect(page).toContain('副交感')
    expect(page).toContain('width:60%')
    expect(page).toContain('width:30%')
  })

  it('五组双条另有一张粒子画布，两边读数都带出去', () => {
    const page = panelPage({
      ...STATE,
      vitals: {
        thirst: 0.5,
        pairs: [
          { name: '自主神经', a: '交感', av: 0.6, b: '副交感', bv: 0.3 },
          { name: '奖赏', a: '想要', av: 0.2, b: '满足', bv: 0.8 },
        ],
      },
    })

    expect(page).toContain('canvas class="particles"')
    expect(page).toContain('流向')
    expect(page).toContain('&quot;av&quot;:0.6')
    expect(page).toContain('&quot;bv&quot;:0.8')
  })

  it('没有双条就没有粒子画布，不留空画布', () => {
    const page = panelPage({ ...STATE, vitals: { thirst: 0.5 } })

    expect(page).not.toContain('canvas class="particles"')
  })

  it('没有身体读数时这几块整块省掉，只说身体没接上', () => {
    const page = panelPage(STATE)

    expect(page).toContain('身体没接上')
    expect(countOf(page, 'tank')).toBe(0)
    expect(countOf(page, 'emotion-bar')).toBe(0)
    expect(countOf(page, 'body-bar')).toBe(0)
  })

  it('画布是页内脚本画的，不拉任何外部资源，三秒自己去取一次', () => {
    const page = panelPage({ ...STATE, vitals: VITALS })

    // 脚本必须是内联的：只允许页内脚本，外链一个都不许
    expect(page).toContain('setInterval(tick,3000)')
    expect(page).not.toContain('<script src')
    expect(page).not.toContain('<link')
    expect(page).not.toMatch(/<(img|iframe|object|embed)\b/)
    expect(page).not.toMatch(/url\(/)
  })

  it('页内脚本不会把她的原话当代码执行：尖括号先转义', () => {
    const vitals: PanelVitals = { thirst: 0.5, emotion: [{ why: '</script><b>x</b>', weight: 1 }] }
    const page = panelPage({ ...STATE, vitals })

    expect(page).not.toContain('</script><b>x</b>')
    expect(page).toContain('&lt;/script&gt;')
  })

  it('页内脚本每一段都能解析，语法错不留给浏览器', () => {
    const page = panelPage({ ...STATE, vitals: VITALS })
    const blocks = [...page.matchAll(/<script>([\s\S]*?)<\/script>/gu)].map(match => match[1] ?? '')

    expect(blocks.length).toBeGreaterThan(0)
    // 只编译不执行：过了这一关说明语法没坏，浏览器那边不会白屏
    for (const code of blocks) expect(() => new Script(code)).not.toThrow()
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

  it('接上身体之后 /api/state 真的带出身体读数', async () => {
    const dir = tempDir()
    seed(dir)
    const port = await freePort()
    const { seam } = await mountFiber({ enabled: true, dir, mainChatKey: 'group:1', panelPort: port })
    await waitPort(seam, port)
    seam.useVitals({
      render: () => '嗓子发干。',
      read: () => ({ thirst: 0.7, energy: 0.3, valence: 0.4, loneliness: 0.2, proactive_bias: 0.6 }),
    })

    const state = JSON.parse(await (await get(port, '/api/state')).text()) as PanelState

    expect(state.vitals).toEqual({ thirst: 0.7, energy: 0.3, mood: 0.4, boredom: 0.2, socialHunger: 0.6 })
  })

  it('没接上身体时整块省掉，不给一份假的读数', async () => {
    const dir = tempDir()
    seed(dir)
    const port = await freePort()
    const { seam } = await mountFiber({ enabled: true, dir, mainChatKey: 'group:1', panelPort: port })
    await waitPort(seam, port)

    const state = JSON.parse(await (await get(port, '/api/state')).text()) as PanelState

    expect(state.vitals).toBeUndefined()
  })

  it('目录里什么都没有时也给一份内容', () => {
    const dir = tempDir()
    const settings = resolveSettings()
    const store = createSelfStore({ dir, settings })

    const base = {
      store,
      settings,
      now: AT,
      panel: '',
      generatedAt: '',
      ledger: createLedger({ store, settings }).summary(AT),
    }
    const state = panelStateOf(base)

    expect(Object.hasOwn(state, 'identity')).toBe(false)
    expect(state.days).toEqual([])
    expect(state.ledger).toEqual({ drive: 0, agency: 0, recentAgency: 0 })
    expect(state.health).toContain('近七天写了 0 天')
    expect(state.health).toContain('缺 7 天')
  })

  it('本机 /api/state 会显示 ASR Provider 与准备阶段', async () => {
    const dir = tempDir()
    seed(dir)
    const port = await freePort()
    const { seam } = await mountFiber({ enabled: true, dir, mainChatKey: 'group:1', panelPort: port })
    await waitPort(seam, port)
    seam.useQqPanel({
      relation: () => ({ found: false }),
      timeline: () => undefined,
      asrStatus: () => ({ transport: 'managed', providerId: 'sensevoice-local', phase: 'unprepared' }),
    })

    const state = JSON.parse(await (await get(port, '/api/state')).text()) as PanelState

    expect(state.asr).toEqual({ transport: 'managed', providerId: 'sensevoice-local', phase: 'unprepared' })
  })
})

describe('现场那一格', () => {
  // 一份时间线：先收到一条私聊，接着模型在第 2 步写着，中途主动开口被挡了一次
  function timelineOf(rows: readonly Record<string, unknown>[]): string {
    return `${rows.map(row => JSON.stringify(row)).join('\n')}\n`
  }

  function stateWithTimeline(file: string): PanelState {
    const dir = tempDir()
    const settings = resolveSettings()
    const store = createSelfStore({ dir, settings })
    return panelStateOf({
      store,
      settings,
      now: AT,
      panel: '',
      generatedAt: '',
      ledger: createLedger({ store, settings }).summary(AT),
      timelineFile: file,
    })
  }

  it('从时间线末尾算出正在写、刚收到与叫醒判断', () => {
    const dir = tempDir()
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'qq-timeline.jsonl')
    fs.writeFileSync(file, timelineOf([
      { kind: 'inbound_received', at: AT, chatKey: 'private:555' },
      { kind: 'followup_queued', at: AT + 1, chatKey: 'private:555', traceId: 't1' },
      { kind: 'model_step', at: AT + 2, chatKey: 'private:555', traceId: 't1', step: 2 },
      { kind: 'wake_skipped', at: AT + 3, chatKey: 'group:1', reason: 'timed_rest' },
      { kind: 'model_reply', at: AT + 4, chatKey: 'private:555', traceId: 't1', hasText: true },
      { kind: 'turn_finished', at: AT + 5, chatKey: 'group:1', traceId: 't2', outcome: 'completed' },
    ]))

    const live = stateWithTimeline(file).live

    expect(live).toMatchObject({
      typing: { chatKey: 'private:555', since: AT + 1, step: 2 },
      inbound: { chatKey: 'private:555', at: AT, count: 1 },
      proactive: { blocked: true, reason: 'timed_rest', at: AT + 3 },
    })
  })

  it('面板现场只显示主人称呼，不带主人账号', () => {
    const dir = tempDir()
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'qq-timeline.jsonl')
    fs.writeFileSync(file, timelineOf([
      { kind: 'inbound_received', at: AT, chatKey: 'private:777' },
      { kind: 'model_step', at: AT + 1, chatKey: 'private:777', traceId: 'owner-trace', step: 1 },
    ]))
    const before = process.env.QQ_CREATOR_ID
    process.env.QQ_CREATOR_ID = '777'
    try {
      const live = stateWithTimeline(file).live
      expect(live?.inbound?.chatKey).toBe('主人私聊')
      expect(live?.typing?.chatKey).toBe('主人私聊')
      expect(JSON.stringify(live)).not.toContain('777')
    } finally {
      if (before === undefined) delete process.env.QQ_CREATOR_ID
      else process.env.QQ_CREATOR_ID = before
    }
  })

  it('一轮收尾之后就不再算在写', () => {
    const dir = tempDir()
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'qq-timeline.jsonl')
    fs.writeFileSync(file, timelineOf([
      { kind: 'followup_request', at: AT, chatKey: 'private:555', traceId: 't1' },
      { kind: 'model_step', at: AT + 1, chatKey: 'private:555', traceId: 't1', step: 2 },
      { kind: 'turn_finished', at: AT + 2, chatKey: 'private:555', traceId: 't1', outcome: 'completed' },
    ]))

    const live = stateWithTimeline(file).live

    expect(live?.typing).toBeUndefined()
    expect(live?.proactive).toMatchObject({ blocked: false, reason: 'followup_request' })
  })

  it('时间线读不到时只留时刻，不给这一格时整块省掉', () => {
    const dir = tempDir()
    const settings = resolveSettings()
    const store = createSelfStore({ dir, settings })
    const base = {
      store,
      settings,
      now: AT,
      panel: '',
      generatedAt: '',
      ledger: createLedger({ store, settings }).summary(AT),
    }

    expect(Object.hasOwn(panelStateOf(base), 'live')).toBe(false)
    expect(Object.hasOwn(panelStateOf({ ...base, timelineFile: path.join(dir, 'qq-timeline.jsonl') }), 'live')).toBe(true)
    expect(panelStateOf({ ...base, timelineFile: path.join(dir, 'qq-timeline.jsonl') }).live).toEqual({ at: AT })
  })

  it('页面与 /api/state 都带出现场那一格', async () => {
    const dir = tempDir()
    seed(dir)
    const data = path.join(dir, 'data')
    fs.mkdirSync(data, { recursive: true })
    fs.writeFileSync(path.join(data, 'qq-timeline.jsonl'), timelineOf([
      { kind: 'merge_flushed', at: AT, chatKey: 'group:1', count: 2 },
      { kind: 'followup_request', at: AT + 1, chatKey: 'group:1', traceId: 't1' },
      { kind: 'model_step', at: AT + 2, chatKey: 'group:1', traceId: 't1', step: 3 },
    ]))
    const port = await freePort()
    const { seam } = await mountFiber({
      enabled: true,
      dir,
      mainChatKey: 'group:1',
      panelPort: port,
      memoryFile: path.join(data, 'qq-memory.json'),
    })
    await waitPort(seam, port)

    const state = JSON.parse(await (await get(port, '/api/state')).text()) as PanelState
    const page = await (await get(port, '/')).text()

    expect(state.live).toMatchObject({
      typing: { chatKey: 'group:1', step: 3 },
      inbound: { chatKey: 'group:1', count: 2 },
    })
    expect(page).toContain('<h3>现场</h3>')
    expect(page).toContain('live-line')
    expect(page).toContain('正在写 group:1 第 3 步')
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
