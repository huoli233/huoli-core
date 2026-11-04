// 把身体那几行压成面板能用的一句：取第一行主体，去掉括号与编号，超长截断

import { DEFAULTS } from './defaults.ts'
import type { VitalsPort } from './types.ts'

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
 * @returns 返回一句的端口，面板照旧原样用
 */
export function momentPort(port: VitalsPort, options: MomentOptions = {}): VitalsPort {
  const max = options.max ?? DEFAULTS.momentMaxChars
  return {
    render() {
      return compressMoment(port.render(), max)
    },
  }
}
