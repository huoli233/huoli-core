// 面板只有四类内容：此刻、我在做、我想弄明白、可以说不

import { DEFAULTS } from './defaults.ts'
import type { PanelInput, PanelState, SelfSettings, VitalsPort } from './types.ts'

// 首行生成时间的写法，读与写共用同一处
const STAMP_PREFIX = '<!-- generated_at: '

// 压成一行，超过上限就整行不要
function oneLine(text: string | undefined, max: number): string {
  if (text === undefined) return ''
  const flat = text
    .split('\n')
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .join(' ')
  if (flat === '' || flat.length > max) return ''
  return flat
}

/**
 * 画一份面板
 * @param input - 四个来源，缺的那个省一行
 * @param settings - 参数表
 * @returns 不超过面板上限的正文，一行一件事
 */
export function renderPanel(input: PanelInput, settings: SelfSettings): string {
  const { labels } = settings
  const moment = oneLine(input.moment, settings.momentMaxChars)
  const project = oneLine(input.project, settings.projectMaxChars)
  const next = oneLine(input.next, settings.nextMaxChars)
  const question = oneLine(input.question, settings.questionMaxChars)
  const doing = project === ''
    ? ''
    : next === ''
      ? `${labels.doing}${project}`
      : `${labels.doing}${project}；${labels.next}${next}`
  const rows: ReadonlyArray<{ key: 'doing' | 'question' | 'moment'; text: string }> = [
    { key: 'moment', text: moment === '' ? '' : `${labels.moment}${moment}` },
    { key: 'doing', text: doing },
    { key: 'question', text: question === '' ? '' : `${labels.question}${question}` },
  ]
  // 超预算先删整行：我在做最占地方，再删想弄明白，最后删此刻
  const dropped = new Set<string>()
  const build = (): string => [
    labels.header,
    ...rows.filter(row => row.text !== '' && !dropped.has(row.key)).map(row => row.text),
    labels.refuse,
  ].join('\n')
  for (const key of ['doing', 'question', 'moment'] as const) {
    if (build().length <= settings.panelMaxChars) break
    dropped.add(key)
  }
  const body = build()
  return body.length <= settings.panelMaxChars ? body : body.slice(0, settings.panelMaxChars)
}

/**
 * 从面板文件里取回正文
 * @param text - 文件全文，首行是生成时间
 * @returns 正文，取不回来时为空串
 */
export function panelBody(text: string): string {
  const cut = text.indexOf('\n')
  if (cut < 0) return ''
  const rest = text.slice(cut + 1)
  return rest.endsWith('\n') ? rest.slice(0, -1) : rest
}

/**
 * 拼成一份面板文件
 * @param body - 面板正文
 * @param at - 生成时间
 * @returns 首行生成时间加正文
 */
export function panelFile(body: string, at: number): string {
  return `${STAMP_PREFIX}${new Date(at).toISOString()} -->\n${body}\n`
}

/**
 * 面板文件首行记的生成时间
 * @param text - 面板文件全文
 * @returns ISO 时间，首行没记时为空串
 */
export function panelStamp(text: string): string {
  const cut = text.indexOf('\n')
  const head = cut < 0 ? text : text.slice(0, cut)
  const mark = head.indexOf(STAMP_PREFIX)
  if (mark < 0) return ''
  const rest = head.slice(mark + STAMP_PREFIX.length)
  const end = rest.indexOf(' -->')
  return (end < 0 ? rest : rest.slice(0, end)).trim()
}

// 带内容的括号：里面的说明不是主体，整段去掉
const NOTES: readonly (readonly [string, string])[] = [['（', '）'], ['(', ')']]

// 只当分隔用的括号：只去符号，留下里面的字
const MARKS: readonly string[] = ['【', '】', '[', ']', '「', '」', '《', '》']

// 行首的编号，中英文两种写法
const NUMBERING = /^\s*(?:\d+[.、)．]|[一二三四五六七八九十]+[、.．])\s*/u

// 把成对括号连同里面的说明一起剥掉，配不上对的括号只去符号
function stripNotes(text: string): string {
  let kept = text
  for (const [open, close] of NOTES) {
    let from = kept.indexOf(open)
    while (from >= 0) {
      const to = kept.indexOf(close, from + 1)
      const cut = to < 0 ? from + 1 : to + 1
      kept = `${kept.slice(0, from)}${kept.slice(cut)}`
      from = kept.indexOf(open)
    }
  }
  return kept
}

// 去掉分隔用的括号符号
function stripMarks(text: string): string {
  return MARKS.reduce((kept, mark) => kept.split(mark).join(''), text)
}

/**
 * 把一段多行文本压成一句
 * @param text - 身体给的多行文本
 * @param max - 压完最多几个字，不给就取参数表
 * @returns 一句主体，一行都没有时为空串
 */
export function compressMoment(text: string, max: number = DEFAULTS.momentMaxChars): string {
  const first = text.split('\n').find(line => line.trim() !== '') ?? ''
  const bare = stripMarks(stripNotes(first)).replace(NUMBERING, '').replace(/\s+/gu, ' ').trim()
  const limit = Math.max(0, max)
  return bare.length <= limit ? bare : bare.slice(0, limit)
}

/** 接下身体时要用的参数 */
export interface MomentOptions {
  /** 一句最多几个字，不给就取参数表 */
  max?: number
}

/**
 * 给面板接上身体的只读入口，每次取都现压一句
 * @param port - 身体那一面
 * @param options - 压句参数
 * @returns 返回一句的端口；身体给得出展示读数时照样原样转出去
 */
export function momentPort(port: VitalsPort, options: MomentOptions = {}): VitalsPort {
  const max = options.max ?? DEFAULTS.momentMaxChars
  const read = port.read?.bind(port)
  const bounds = port.bounds?.bind(port)
  const pairs = port.pairs?.bind(port)
  const kept: VitalsPort = {
    render() {
      return compressMoment(port.render(), max)
    },
  }
  if (read !== undefined) kept.read = () => read()
  // 周期分界原样转出去：面板画彩弧要用，压句不影响它
  if (bounds !== undefined) kept.bounds = () => bounds()
  // 五组双条只画不压句，原样转出去
  if (pairs !== undefined) kept.pairs = () => pairs()
  return kept
}

/**
 * 页面上出现的每一段都要转义：她的原话里也可能有尖括号
 * @param text - 要转义的那段
 * @returns 转义后的那段
 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * 条宽只认零到一：越界的值收回来，条不会画出格子外面去
 * @param value - 零到一的比例
 * @returns 带百分号的宽度
 */
export function percent(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`
}

/**
 * 简短版整页：别的实例只读这一屏，不画任何画布，也不带轮询
 * @param state - 只读出口的内容
 * @param style - 内联样式，由调用方给
 * @returns 一页极简的 HTML
 */
export function briefShell(state: PanelState, style: string): string {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>自我面板·简版</title>',
    `<style>${style}</style>`,
    '</head>',
    '<body>',
    '<div class="wrap"><div class="right">',
    briefBody(state),
    '</div></div>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

/**
 * 简短版：只给别的实例看的那一屏，不画任何画布，也不带轮询
 * @param state - 只读出口的内容
 * @returns 一页极简的正文片段，外壳由调用方套
 */
export function briefBody(state: PanelState): string {
  const vitals = state.vitals
  const line = vitals === undefined
    ? '身体没接上'
    : [
      `口渴 ${percent(vitals.thirst ?? 0)}`,
      `精力 ${percent(vitals.energy ?? 0)}`,
      `想说话 ${percent(vitals.socialHunger ?? 0)}`,
    ].join(' · ')
  return [
    '<div class="card span-12"><h3>我·此刻</h3>',
    `<pre class="panel">${escapeHtml(state.panel.body === '' ? '还没生成' : state.panel.body)}</pre>`,
    `<p class="num">${escapeHtml(line)}</p>`,
    `<p class="muted">${escapeHtml(state.health)}</p>`,
    '</div>',
  ].join('\n')
}
