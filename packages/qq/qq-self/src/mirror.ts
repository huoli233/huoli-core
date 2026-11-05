// 只把主张、项目、承诺镜像进记忆库：日常三行、问句、记录表一律不进

import { FILES } from './files.ts'
import type { SelfStore } from './store.ts'
import type { MirrorKind, MirrorResult, SelfMirrorEntry, SelfMirrorPort } from './types.ts'

/** 能镜像的三份文件，按这个顺序处理 */
export const MIRROR_FILES: readonly { file: string; kind: MirrorKind }[] = [
  { file: FILES.claims, kind: 'claim' },
  { file: FILES.projects, kind: 'project' },
  { file: FILES.commitments, kind: 'commitment' },
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

// 拆句优先在这几个标点后面断开，断不了就按字数硬切
const BREAKS: readonly string[] = ['。', '；', '！', '？', '\n', '，', '、']

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

// 两位补零
function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}

// 本地日期，行里没有记忆编号时挂它当证据
function dateOf(at: number): string {
  const day = new Date(at)
  return `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`
}

// 日期只查格式：年月日都得落在真实的日子上
function isDate(token: string): boolean {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token)
  if (matched === null) return false
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  const at = new Date(year, month - 1, day)
  return at.getFullYear() === year && at.getMonth() === month - 1 && at.getDate() === day
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

// 一行正文超过上限就拆成几段，每段不超过上限，尽量在标点处断开
function splitText(text: string, max: number): string[] {
  const limit = Math.max(1, max)
  const kept = text.trim()
  if (kept === '') return []
  if (kept.length <= limit) return [kept]
  const parts: string[] = []
  let rest = kept
  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    let cut = -1
    for (const mark of BREAKS) cut = Math.max(cut, window.lastIndexOf(mark))
    // 断点太靠前会让每段都只剩几个字，宁可按上限切
    const end = cut >= Math.floor(limit / 2) ? cut + 1 : limit
    const head = rest.slice(0, end).trim()
    if (head !== '') parts.push(head)
    rest = rest.slice(end).trim()
  }
  if (rest !== '') parts.push(rest)
  return parts
}

// 行里带的证据原样取出来，去掉空串
function listedEvidence(row: Record<string, unknown>): string[] {
  if (!Array.isArray(row.evidence)) return []
  const listed: string[] = []
  for (const item of row.evidence) {
    if (typeof item !== 'string') continue
    const token = item.trim()
    if (token !== '') listed.push(token)
  }
  return listed
}

// 证据回查：记忆编号必须真的在库，日期只查格式；行里给了却一条都查不到时不再拿日期顶上，那等于替它编证据
function evidenceOf(listed: readonly string[], at: number, max: number, known: ReadonlySet<string>): string[] {
  const checked = listed.filter(token => isDate(token) || known.has(token))
  if (checked.length > 0) return checked.slice(0, max)
  if (listed.length > 0) return []
  return at > 0 ? [dateOf(at)] : []
}

// 拆开的条目在来源键后面接序号，查重只认序号之前的那一段
function baseSelfId(selfId: string): string {
  return selfId.replace(/-\d+$/, '')
}

/**
 * 把还没镜过的条目写进记忆库
 * @param input - 目录、记忆库与这次的参数
 * @returns 这次写了多少条、拆开几行、跳过几条
 */
export function mirrorEntries(input: MirrorInput): MirrorResult {
  const known = new Set(input.port.memoryIds())
  const mirrored: Set<string> = new Set(input.port.mirroredSelfIds().map(baseSelfId))
  let written = 0
  let skipped = 0
  let split = 0
  let unverified = 0
  for (const { file, kind } of MIRROR_FILES) {
    // 序号按记录在文件里的次序数，只追加的文件里它不会变
    input.store.lines(file).forEach((line, index) => {
      const selfId = `${file}#${index + 1}`
      if (mirrored.has(baseSelfId(selfId))) {
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
      // 暂停期间写的提议只算想做，不进记忆库当既有事实
      if (row.proposed === true) return
      const text = textOf(kind, row)
      if (text === '') return
      const at = stamp(row.at) || input.at
      const evidence = evidenceOf(listedEvidence(row), at, input.evidenceMax, known)
      if (evidence.length === 0) {
        unverified += 1
        return
      }
      const chunks = splitText(text, input.maxChars)
      if (chunks.length === 0) return
      if (chunks.length > 1) split += 1
      // 拆开的几条共用同一份证据与同一个来源键，序号接在来源键后面
      chunks.forEach((chunk, order) => {
        const entry: SelfMirrorEntry = {
          text: chunk,
          chatKey: input.scope,
          selfId: chunks.length === 1 ? selfId : `${selfId}-${order + 1}`,
          selfKind: kind,
          evidence,
          importance: input.importance,
        }
        const kept = input.port.rememberSelf(entry, at)
        if (kept.created) written += 1
        else skipped += 1
      })
      mirrored.add(selfId)
    })
  }
  return { written, skipped, split, unverified }
}
