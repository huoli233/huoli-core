// 面板只有四类内容：此刻、我在做、我想弄明白、可以说不

import type { PanelInput, SelfSettings } from './types.ts'

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
