// 只把主张、项目、承诺镜像进记忆库：日常三行、问句、账本一律不进

import type { SelfStore } from './store.ts'
import type { MirrorKind, MirrorResult, SelfMirrorEntry, SelfMirrorPort } from './types.ts'

/** 能镜像的三份文件，按这个顺序处理 */
export const MIRROR_FILES: readonly { file: string; kind: MirrorKind }[] = [
  { file: 'claims.jsonl', kind: 'claim' },
  { file: 'projects.jsonl', kind: 'project' },
  { file: 'commitments.jsonl', kind: 'commitment' },
]

/** 镜像一次要用的东西 */
export interface MirrorInput {
  /** 目录读写口 */
  store: SelfStore
  /** 记忆库那一面 */
  port: SelfMirrorPort
  /** 现在的时间 */
  at: number
  /** 镜像落到哪个会话 */
  scope: string
  /** 一条给多少重要度 */
  importance: number
  /** 一条正文最多几个字 */
  maxChars: number
  /** 一条最多挂几个证据 */
  evidenceMax: number
}

// 取字符串，取不到给空串
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// 取时间，取不到给零
function stamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// 一行 JSON 转成对象，别的形状当坏行
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

// 本地日期，行里没有记忆编号时挂它当证据
function dateOf(at: number): string {
  const day = new Date(at)
  const pad = (value: number): string => value.toString().padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

// 一行正文：项目要把下一步与失败条件一并说清，另外两类本来就是一句话
function textOf(kind: MirrorKind, row: Record<string, unknown>): string {
  if (kind !== 'project') return str(row.text)
  const title = str(row.title)
  if (title === '') return ''
  const next = str(row.next)
  const failIf = str(row.fail_if)
  const parts = [`项目 ${title}`, next === '' ? '' : `下一步 ${next}`, failIf === '' ? '' : `失败条件 ${failIf}`]
  return parts.filter(part => part !== '').join('；')
}

// 证据：行里带记忆编号就用它们，没带就挂这一行的日期
function evidenceOf(row: Record<string, unknown>, at: number, max: number): string[] {
  const listed = Array.isArray(row.evidence)
    ? row.evidence.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []
  if (listed.length > 0) return listed.slice(0, max).map(item => item.trim())
  return at > 0 ? [dateOf(at)] : []
}

/**
 * 把还没镜过的条目写进记忆库
 * @param input - 目录、记忆库与这次的参数
 * @returns 这次写了多少条
 */
export function mirrorEntries(input: MirrorInput): MirrorResult {
  const mirrored = new Set(input.port.mirroredSelfIds())
  let written = 0
  let skipped = 0
  let overlong = 0
  for (const { file, kind } of MIRROR_FILES) {
    // 序号按记录在文件里的次序数，只追加的文件里它不会变
    input.store.lines(file).forEach((line, index) => {
      const selfId = `${file}#${index + 1}`
      if (mirrored.has(selfId)) {
        skipped += 1
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch (error) {
        // 半截的行跳过，别让它拖垮整批镜像
        void error
        return
      }
      const row = asRecord(parsed)
      if (row === undefined) return
      const text = textOf(kind, row)
      if (text === '') return
      const at = stamp(row.at) || input.at
      const evidence = evidenceOf(row, at, input.evidenceMax)
      if (evidence.length === 0) return
      if (text.length > input.maxChars) {
        overlong += 1
        return
      }
      const entry: SelfMirrorEntry = {
        text,
        chatKey: input.scope,
        selfId,
        selfKind: kind,
        evidence,
        importance: input.importance,
      }
      const kept = input.port.rememberSelf(entry, at)
      mirrored.add(selfId)
      if (kept.created) written += 1
      else skipped += 1
    })
  }
  return { written, skipped, overlong }
}
