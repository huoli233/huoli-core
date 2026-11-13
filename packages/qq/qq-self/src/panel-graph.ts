// 星海：把记忆文件与星链读成一张图，再画成一页

import fs from 'node:fs'
import path from 'node:path'

/** 图上的一个星点 */
export interface GraphNode {
  /** 编号 */
  id: string
  /** 正文，按上限截断 */
  text: string
  /** 类型：事件、印象、话题、想法、身体 */
  kind: string
  /** 重要度 0 到 100，决定半径 */
  importance: number
  /** 什么时候 */
  at: number
  /** 哪一层 */
  layer: string
  /** 相关的人 */
  who: string
  /** 话题标签 */
  tags: string[]
}

/** 图上的一条星链 */
export interface GraphEdge {
  /** 一端 */
  a: string
  /** 另一端 */
  b: string
  /** 强度 */
  weight: number
  /** 怎么连上的 */
  why: string
}

/** 一页图要的东西 */
export interface GraphPayload {
  /** 星点 */
  nodes: GraphNode[]
  /** 星链 */
  edges: GraphEdge[]
  /** 星云：标签到星点编号 */
  clusters: Record<string, string[]>
  /** 库里一共多少条，截断前 */
  total: number
}

/** 一页最多画多少点、文本留多少字 */
export const GRAPH_DEFAULTS = {
  /** 最多多少个点 */
  maxNodes: 300,
  /** 每个点正文留多少字 */
  textMax: 160,
  /** 每点最多连几条线 */
  maxNeighbors: 6,
}

// 认得出是一个对象
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// 截断，不切坏字
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/**
 * 把记忆文件读成一张图
 * @param memoryFile - 记忆文件名，紧挨着它读 edges.jsonl
 * @param limit - 最多几个点，不给用默认值
 * @param includePrivate - 私密星点也画出来，只在本机且明确要求时为真
 * @returns 图的数据
 */
export function buildGraph(memoryFile: string, limit?: number, includePrivate = false): GraphPayload {
  const maxNodes = Math.max(1, limit ?? GRAPH_DEFAULTS.maxNodes)
  const raw = readMemory(memoryFile)
  const total = raw.length
  // 私密星点默认不进图：这一层只在它自己的空间可见
  const visible = includePrivate ? raw : raw.filter(item => item.layer !== 'private' && item.secret !== true)
  const kept = visible
    .sort((left, right) => right.importance - left.importance || right.at - left.at)
    .slice(0, maxNodes)
  const ids = new Set(kept.map(item => item.id))
  const edges = readEdgeFile(edgeFileOf(memoryFile))
    .filter(edge => ids.has(edge.a) && ids.has(edge.b))
    .sort((left, right) => right.weight - left.weight)
    .slice(0, maxNodes * GRAPH_DEFAULTS.maxNeighbors)
  const clusters: Record<string, string[]> = {}
  for (const node of kept) {
    const key = node.tags[0] ?? '没归类'
    const bucket = clusters[key] ?? []
    bucket.push(node.id)
    clusters[key] = bucket
  }
  return { nodes: kept, edges, clusters, total }
}

// 记忆文件里那一条能画出来的信息
interface RawNode extends GraphNode {
  /** 这件事不想让人知道 */
  secret?: boolean
}

// 读记忆文件，坏文件当空库
function readMemory(file: string): RawNode[] {
  if (!fs.existsSync(file)) return []
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!isRecord(parsed) || !Array.isArray(parsed.items)) return []
    const out: RawNode[] = []
    for (const entry of parsed.items) {
      if (!isRecord(entry)) continue
      const id = typeof entry.id === 'string' ? entry.id : ''
      const text = typeof entry.text === 'string' ? entry.text : ''
      if (id === '' || text === '') continue
      const tags = Array.isArray(entry.metadata) ? [] : readTags(entry.metadata)
      out.push({
        id,
        text: clip(text, GRAPH_DEFAULTS.textMax),
        kind: typeof entry.kind === 'string' ? entry.kind : '事件',
        importance: typeof entry.importance === 'number' ? entry.importance : 0,
        at: typeof entry.at === 'number' ? entry.at : 0,
        layer: typeof entry.layer === 'string' ? entry.layer : 'episodic',
        who: typeof entry.personId === 'string' ? entry.personId : '',
        tags,
        ...entry.secret === true ? { secret: true } : {},
      })
    }
    return out
  } catch {
    // 读不出来就当空库，图给一页「还没有记忆」
    return []
  }
}

// 标签从 metadata 里取，取不到给空表
function readTags(metadata: unknown): string[] {
  if (!isRecord(metadata)) return []
  const tags = metadata.tags
  if (!Array.isArray(tags)) return []
  return tags.filter((tag): tag is string => typeof tag === 'string' && tag !== '')
}

// 星链文件与记忆文件同目录
function edgeFileOf(memoryFile: string): string {
  return path.join(path.dirname(memoryFile), 'edges.jsonl')
}

// 读星链，坏行跳过
function readEdgeFile(file: string): GraphEdge[] {
  if (!fs.existsSync(file)) return []
  const out: GraphEdge[] = []
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      const raw: unknown = JSON.parse(line)
      if (!isRecord(raw)) continue
      const a = typeof raw.a === 'string' ? raw.a : ''
      const b = typeof raw.b === 'string' ? raw.b : ''
      if (a === '' || b === '') continue
      out.push({
        a,
        b,
        weight: typeof raw.weight === 'number' ? raw.weight : 1,
        why: typeof raw.why === 'string' ? raw.why : 'sameTurn',
      })
    } catch {
      // 坏行跳过：一条写坏了不该让整份边读不出来
    }
  }
  return out
}

/**
 * 星海那一页
 * @param payload - 图的数据
 * @param style - 内联样式，由调用方给
 * @returns 一页 HTML
 */
export function graphPage(payload: GraphPayload, style: string): string {
  const data = JSON.stringify(payload).replaceAll('<', '\\u003c')
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>记忆星海</title>',
    `<style>${style}</style>`,
    '</head>',
    '<body class="sea">',
    '<canvas id="sea"></canvas>',
    '<div id="tip" class="tip"></div>',
    `<aside class="hud"><b>记忆星海</b><span id="count">${payload.nodes.length} / ${payload.total}</span></aside>`,
    '<div class="legend" id="legend"></div>',
    '<div class="timebar"><input id="time" type="range" min="0" max="1000" value="1000"><span id="when"></span></div>',
    '<div class="legend" id="legend"></div>',
    '<div class="timebar"><input id="time" type="range" min="0" max="1000" value="1000"><span id="when"></span></div>',
    '<div class="legend" id="legend"></div>',
    '<div class="timebar"><input id="time" type="range" min="0" max="1000" value="1000"><span id="when"></span></div>',
    '<div class="legend" id="legend"></div>',
    '<div class="timebar"><input id="time" type="range" min="0" max="1000" value="1000"><span id="when"></span></div>',
    `<script>const DATA=${data};</script>`,
    `<script>${SEA_SCRIPT}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

// 画星海：力导向、拖拽、缩放，全在这一段里，不引任何库
const SEA_SCRIPT = `
const canvas = document.getElementById('sea')
const tip = document.getElementById('tip')
const legend = document.getElementById('legend')
const slider = document.getElementById('time')
const when = document.getElementById('when')
const count = document.getElementById('count')
const ctx = canvas.getContext('2d')

let W = 0, H = 0, dpr = 1
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1)
  W = canvas.clientWidth; H = canvas.clientHeight
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
resize()
window.addEventListener('resize', resize)

// 三维取景：焦距越大画面越平，初始角度与距离由当前视图参数定
const FOCAL = 1100
const CAM_DEFAULT = { yaw: 0.45, pitch: -0.26, dist: 1020, panX: 0, panY: 0 }
const cam = Object.assign({}, CAM_DEFAULT)

// 星云配色：同一标签一色，二次元亮色
const PALETTE = ['#7ad7ff', '#ff9ad5', '#ffd479', '#b79bff', '#7dffcf', '#ff9d7a', '#9df0ff', '#f5a3ff']
const clusterNames = Object.keys(DATA.clusters)
const clusterColor = new Map()
clusterNames.forEach(function (name, i) { clusterColor.set(name, PALETTE[i % PALETTE.length]) })

function clusterOf(n) { return (n.tags && n.tags[0]) || '没归类' }

// 稳定的伪随机：同一个 id 每次布局都一样，不抖
function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h >>> 0
}
function rand(str) { return (hash(str) % 100000) / 100000 }

// 布局：每个星云占球面上一个方向，簇内的点在小球壳里散开，靠 z 拉开前后
const nodes = DATA.nodes.map(function (n) {
  return {
    id: n.id, text: n.text, kind: n.kind, at: n.at,
    cluster: clusterOf(n),
    color: clusterColor.get(clusterOf(n)) || '#9ad0ff',
    importance: n.importance,
    x: 0, y: 0, z: 0, phase: 0, r: 1,
  }
})

const centers = new Map()
const total = Math.max(1, clusterNames.length)
clusterNames.forEach(function (name, index) {
  const y = total === 1 ? 0 : 1 - (index / (total - 1)) * 2
  const ring = Math.sqrt(Math.max(0, 1 - y * y))
  const phi = index * Math.PI * (3 - Math.sqrt(5)) + rand(name) * 0.6
  const radius = 230 + rand(name + 'r') * 190
  centers.set(name, {
    x: Math.cos(phi) * ring * radius,
    y: y * radius * 0.82,
    z: Math.sin(phi) * ring * radius,
  })
})

nodes.forEach(function (n) {
  const center = centers.get(n.cluster) || { x: 0, y: 0, z: 0 }
  const a = rand(n.id + 'a') * Math.PI * 2
  const b = Math.acos(2 * rand(n.id + 'b') - 1)
  const rr = 16 + Math.pow(rand(n.id + 'r'), 0.65) * 120
  n.x = center.x + Math.sin(b) * Math.cos(a) * rr
  n.y = center.y + Math.cos(b) * rr * 0.72
  n.z = center.z + Math.sin(b) * Math.sin(a) * rr
  n.phase = rand(n.id + 'p') * Math.PI * 2
  n.r = 1.6 + Math.min(4.2, (n.importance / 100) * 5)
})

const index = new Map(nodes.map(function (n) { return [n.id, n] }))
const edges = DATA.edges
  .map(function (e) { return { a: index.get(e.a), b: index.get(e.b), w: e.weight } })
  .filter(function (e) { return e.a && e.b })

if (clusterNames.length > 0) {
  legend.innerHTML = clusterNames.slice(0, 10).map(function (name) {
    return '<i style="background:' + clusterColor.get(name) + '"></i>' + name
  }).join('')
}

// 时间滑块：只显示这个时刻之前的记忆，之后的沉下去变暗
const times = DATA.nodes.map(function (n) { return n.at }).filter(function (t) { return t > 0 })
const oldest = times.length ? Math.min.apply(null, times) : 0
const newest = times.length ? Math.max.apply(null, times) : 1
let cutoff = newest
slider.value = '1000'
function labelOf(t) {
  if (t <= 0) return ''
  const d = new Date(t)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function syncCutoff() {
  const ratio = Number(slider.value) / 1000
  cutoff = oldest + (newest - oldest) * ratio
  const alive = nodes.filter(function (n) { return n.at <= cutoff })
  when.textContent = labelOf(cutoff) + ' · ' + alive.length + ' 颗'
  count.textContent = alive.length + ' / ' + (DATA.total || nodes.length)
}
syncCutoff()
slider.addEventListener('input', syncCutoff)

// 把三维点画到屏幕上：先按 yaw/pitch 转，再按距离做透视，远的更小更淡
function project(n, t) {
  const drift = 6
  const wx = n.x + cam.panX + Math.sin(t / 3200 + n.phase) * drift
  const wy = n.y + cam.panY + Math.cos(t / 4100 + n.phase) * drift
  const wz = n.z + Math.sin(t / 2700 + n.phase * 1.3) * drift
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw)
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch)
  const x1 = wx * cy - wz * sy
  const z1 = wx * sy + wz * cy
  const y1 = wy * cp - z1 * sp
  const z2 = wy * sp + z1 * cp
  const depth = cam.dist + z2
  const f = FOCAL / Math.max(140, depth)
  return { x: W / 2 + x1 * f, y: H / 2 + y1 * f, f: f, depth: depth }
}

let hovered = null

function frame(t) {
  ctx.clearRect(0, 0, W, H)
  const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.8)
  bg.addColorStop(0, '#170c2b'); bg.addColorStop(1, '#05040c')
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)

  const pos = new Map()
  for (const n of nodes) pos.set(n.id, project(n, t))

  // 先画远处的线，后画近处的点：这样才遮得住
  const sortedEdges = edges.slice().sort(function (l, r) {
    return (pos.get(l.a.id).depth + pos.get(l.b.id).depth) - (pos.get(r.a.id).depth + pos.get(r.b.id).depth)
  })
  for (const e of sortedEdges) {
    const pa = pos.get(e.a.id), pb = pos.get(e.b.id)
    const live = e.a.at <= cutoff && e.b.at <= cutoff
    const near = Math.min(pa.f, pb.f)
    ctx.strokeStyle = live
      ? 'rgba(150,190,255,' + Math.min(0.5, (0.04 + e.w * 0.03) * Math.min(1.6, near * 1.6)) + ')'
      : 'rgba(120,140,190,0.05)'
    ctx.lineWidth = Math.max(0.3, Math.min(2.2, e.w * 0.22 * near))
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke()
  }

  const sorted = nodes.slice().sort(function (l, r) {
    return pos.get(r.id).depth - pos.get(l.id).depth
  })
  for (const n of sorted) {
    const p = pos.get(n.id)
    const dim = n.at > cutoff
    const depthFade = Math.min(1, Math.max(0.18, p.f * 1.35))
    ctx.globalAlpha = dim ? 0.07 : depthFade
    const rad = Math.max(0.9, n.r * p.f * 2.5)
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad * 3.6)
    glow.addColorStop(0, n.color); glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow
    ctx.beginPath(); ctx.arc(p.x, p.y, rad * 3.6, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = n.color
    ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 1
  }

  if (hovered !== null && hovered.at <= cutoff) {
    const p = pos.get(hovered.id)
    ctx.fillStyle = 'rgba(255,255,255,0.94)'
    ctx.font = '12px system-ui, sans-serif'
    ctx.fillText(hovered.text.slice(0, 46), p.x + 10, p.y - 10)
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// 交互：拖动转视角，滚轮推拉，右键或按住 shift 平移
let dragging = false, panning = false, lastX = 0, lastY = 0
canvas.addEventListener('contextmenu', function (event) { event.preventDefault() })
canvas.addEventListener('mousedown', function (event) {
  if (event.button === 2 || event.shiftKey) { panning = true } else { dragging = true }
  lastX = event.offsetX; lastY = event.offsetY
})
window.addEventListener('mouseup', function () { dragging = false; panning = false })
canvas.addEventListener('mousemove', function (event) {
  const dx = event.offsetX - lastX, dy = event.offsetY - lastY
  if (dragging) {
    cam.yaw += dx * 0.006
    cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch + dy * 0.005))
    lastX = event.offsetX; lastY = event.offsetY
  } else if (panning) {
    cam.panX += dx * 1.4; cam.panY += dy * 1.4
    lastX = event.offsetX; lastY = event.offsetY
  } else {
    hovered = null
    let best = 1e9
    for (const n of nodes) {
      const p = project(n, performance.now())
      const d = Math.sqrt((p.x - event.offsetX) ** 2 + (p.y - event.offsetY) ** 2)
      if (d < 16 && d < best) { best = d; hovered = n }
    }
  }
})
canvas.addEventListener('wheel', function (event) {
  event.preventDefault()
  cam.dist = Math.max(320, Math.min(4200, cam.dist * (event.deltaY > 0 ? 1.08 : 0.92)))
}, { passive: false })

if (DATA.nodes.length === 0) {
  tip.textContent = '还没有记忆'
  tip.style.display = 'block'
}
`

/**
 * 面板上星海那几路要的回应
 * @param pathname - 请求路径
 * @param search - 查询参数
 * @param memoryFile - 记忆文件
 * @returns 命中就给类型与正文，不是这几路就给 undefined
 */
export function graphAnswer(
  pathname: string,
  search: URLSearchParams,
  memoryFile: string,
): { type: string; body: string } | undefined {
  if (pathname === '/graph') {
    const limit = Number(search.get('limit') ?? GRAPH_DEFAULTS.maxNodes)
    const includePrivate = search.get('includePrivate') === '1'
    return { type: 'text/html; charset=utf-8', body: graphPage(buildGraph(memoryFile, limit, includePrivate), graphStyle()) }
  }
  if (pathname === '/api/graph') {
    const limit = Number(search.get('limit') ?? GRAPH_DEFAULTS.maxNodes)
    const includePrivate = search.get('includePrivate') === '1'
    return { type: 'application/json; charset=utf-8', body: JSON.stringify(buildGraph(memoryFile, limit, includePrivate)) }
  }
  if (pathname.startsWith('/api/graph/node/')) {
    const id = decodeURIComponent(pathname.slice('/api/graph/node/'.length))
    const found = buildGraph(memoryFile, GRAPH_DEFAULTS.maxNodes, true).nodes.find(node => node.id === id)
    if (found === undefined) return { type: 'application/json; charset=utf-8', body: '{"ok":false,"code":"graph.not_found"}' }
    return { type: 'application/json; charset=utf-8', body: JSON.stringify({ ok: true, node: found }) }
  }
  return undefined
}

/**
 * 星海页用到的样式：只给星海那一页，别的页不受影响
 * @returns 一段 CSS
 */
export function graphStyle(): string {
  return [
    'html,body{margin:0;height:100%;background:#07060f;color:#dfe6ff;font:14px/1.5 system-ui,sans-serif}',
    '.sea{overflow:hidden}',
    '#sea{display:block;width:100vw;height:100vh}',
    '.hud{position:fixed;left:16px;top:14px;display:flex;gap:10px;align-items:baseline;opacity:.85}',
    '.hud span{color:#8fa3c8;font-size:12px}',
    '.tip{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);color:#8fa3c8;display:none}',
    '.legend{position:fixed;left:16px;top:74px;display:flex;flex-wrap:wrap;gap:8px 12px;max-width:46vw;font-size:12px;color:#b9c6e6;opacity:.85}',
    '.legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle}',
    '.timebar{position:fixed;left:16px;right:16px;bottom:16px;display:flex;gap:12px;align-items:center}',
    '.timebar input{flex:1;accent-color:#7ad7ff}',
    '.timebar span{color:#8fa3c8;font-size:12px;min-width:120px;text-align:right}',
    '.legend{position:fixed;left:16px;top:74px;display:flex;flex-wrap:wrap;gap:8px 12px;max-width:46vw;font-size:12px;color:#b9c6e6;opacity:.85}',
    '.legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle}',
    '.timebar{position:fixed;left:16px;right:16px;bottom:16px;display:flex;gap:12px;align-items:center}',
    '.timebar input{flex:1;accent-color:#7ad7ff}',
    '.timebar span{color:#8fa3c8;font-size:12px;min-width:120px;text-align:right}',
    '.legend{position:fixed;left:16px;top:74px;display:flex;flex-wrap:wrap;gap:8px 12px;max-width:46vw;font-size:12px;color:#b9c6e6;opacity:.85}',
    '.legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle}',
    '.timebar{position:fixed;left:16px;right:16px;bottom:16px;display:flex;gap:12px;align-items:center}',
    '.timebar input{flex:1;accent-color:#7ad7ff}',
    '.timebar span{color:#8fa3c8;font-size:12px;min-width:120px;text-align:right}',
    '.legend{position:fixed;left:16px;top:44px;display:flex;flex-wrap:wrap;gap:8px 12px;max-width:46vw;font-size:12px;color:#b9c6e6;opacity:.85}',
    '.legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle}',
    '.timebar{position:fixed;left:16px;right:16px;bottom:16px;display:flex;gap:12px;align-items:center}',
    '.timebar input{flex:1;accent-color:#7ad7ff}',
    '.timebar span{color:#8fa3c8;font-size:12px;min-width:120px;text-align:right}',
  ].join('')
}
