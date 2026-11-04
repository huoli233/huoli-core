// 叙事五章：首次补一份骨架，之后只有显式调用才动它

import { FILES } from './files.ts'
import type { SelfStore } from './store.ts'
import type { SelfSettings, WriteOutcome } from './types.ts'

/** 五章标题，次序固定 */
export const NARRATIVE_CHAPTERS: readonly string[] = ['我是谁', '我做过什么', '我在意什么', '我答应过什么', '我还在学什么']

// 章节标题的前缀
const HEADING = '## '

// 这一章还没写时的占位
const BLANK = '（待写）'

// 超长就截断，字段本身不丢
function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}

/**
 * 五章骨架
 * @returns 五个标题加每章一行占位
 */
export function narrativeSkeleton(): string {
  const blocks = NARRATIVE_CHAPTERS.map(chapter => `${HEADING}${chapter}\n${BLANK}`)
  return `${blocks.join('\n\n')}\n`
}

/**
 * 读叙事
 * @param store - 目录读写口
 * @returns 全文，没有这份文件时为空串
 */
export function readNarrative(store: SelfStore): string {
  return store.readText(FILES.narrative) ?? ''
}

/**
 * 首次生成叙事骨架，已有那份就不动
 * @param store - 目录读写口
 * @returns 这次写没写
 */
export function seedNarrative(store: SelfStore): boolean {
  if (store.readText(FILES.narrative) !== undefined) return false
  store.writeText(FILES.narrative, narrativeSkeleton())
  return true
}

// 按章节标题切段，标题前的行不算任何一章
function sectionsOf(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>()
  let current: string[] | undefined
  for (const line of text.split('\n')) {
    if (line.startsWith(HEADING)) {
      current = []
      sections.set(line.slice(HEADING.length).trim(), current)
      continue
    }
    if (current === undefined) continue
    const trimmed = line.trim()
    if (trimmed !== '' && trimmed !== BLANK) current.push(trimmed)
  }
  return sections
}

// 按固定的五章次序拼回去，没写的章留占位
function renderSections(sections: Map<string, string[]>): string {
  const blocks = NARRATIVE_CHAPTERS.map((chapter) => {
    const body = sections.get(chapter) ?? []
    return `${HEADING}${chapter}\n${body.length === 0 ? BLANK : body.join('\n\n')}`
  })
  return `${blocks.join('\n\n')}\n`
}

/**
 * 换掉或续写一章
 * @param store - 目录读写口
 * @param settings - 参数表
 * @param chapter - 五章里的哪一章，写法要逐字相同
 * @param text - 换上的正文，一行一段
 * @param mode - 整章换掉还是接在后面，默认换掉
 * @returns 落没落盘
 */
export function updateNarrative(
  store: SelfStore,
  settings: SelfSettings,
  chapter: string,
  text: string,
  mode: 'replace' | 'append' = 'replace',
): WriteOutcome {
  if (!NARRATIVE_CHAPTERS.includes(chapter)) return { written: false, proposed: false, reason: 'unknown_chapter' }
  const paragraphs = text.split('\n').map(line => line.trim()).filter(line => line !== '')
  if (paragraphs.length === 0) return { written: false, proposed: false, reason: 'no_evidence' }
  const current = readNarrative(store)
  const sections = sectionsOf(current === '' ? narrativeSkeleton() : current)
  const kept = sections.get(chapter) ?? []
  const merged = (mode === 'append' ? [...kept, ...paragraphs] : paragraphs)
    .map(line => clip(line, settings.narrativeParaMaxChars))
    .slice(-settings.narrativeParasMax)
  sections.set(chapter, merged)
  store.writeText(FILES.narrative, renderSections(sections))
  return { written: true, proposed: false }
}
