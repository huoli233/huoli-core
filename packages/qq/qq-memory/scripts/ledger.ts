// 记录表命令行：建记录表、补记录、核对；对不上或参数不对都非零退出

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defaultLedgerFile,
  LEDGER_SCHEMA_VERSION,
  runLedger,
  type LedgerAction,
  type LedgerReport,
} from '../src/ledger.ts'
import { defaultMemoryFile, MEMORY_SCHEMA_VERSION } from '../src/store.ts'
import { assertSupportedVersion, readMemory } from './read.ts'

/** 命令行认的三件事 */
const ACTIONS: readonly LedgerAction[] = ['init', 'sync', 'verify']

/** 交给命令行的两个出口，用例可以换成收集数组 */
export interface CliIo {
  /** 正常输出 */
  out(text: string): void
  /** 失败输出 */
  err(text: string): void
}

/** 跑一次要用的三样东西 */
export interface CliArgs {
  /** 做哪一件 */
  action: LedgerAction
  /** 记录表文件 */
  file: string
  /** 记忆文件，核对时从它读条目 */
  memoryFile: string
}

/** 解析参数的结果 */
export type ParsedCli = { kind: 'run'; args: CliArgs } | { kind: 'error'; message: string }

/** 命令行用法 */
const USAGE = [
  '用法: ledger.ts (--init | --sync | --verify) [--file <账本>] [--memory <记忆>] [--home <主目录>]',
  '  --init    给现有全部记忆重建一本账',
  '  --sync    只补还没入账的编号，老记录一个字不覆盖',
  '  --verify  对一次账，对不上就非零退出并列出差异',
  '  --file    账本文件，默认 <主目录>/data/qq-memory-ledger.json',
  '  --memory  记忆文件，默认 <主目录>/data/qq-memory.json',
  '  --home    覆盖主目录，默认按 HUOLI_HOME 定',
].join('\n')

// 参数里认得出的一件动作
function actionOf(flag: string): LedgerAction | undefined {
  const name = flag.slice(2)
  return (ACTIONS as readonly string[]).includes(name) ? name as LedgerAction : undefined
}

// 取下一个参数当值，缺了就给一句能照着改的错
function valueOf(argv: readonly string[], at: number): string | undefined {
  const value = argv[at + 1]
  if (value === undefined || value.startsWith('--')) return undefined
  if (value.trim() === '') return undefined
  return value
}

/**
 * 把命令行参数拆成一次要跑的事
 * @param argv - 去掉 node 与脚本名之后的参数
 * @returns 拆好的事，或者一句错
 */
export function parseArgs(argv: readonly string[]): ParsedCli {
  let action: LedgerAction | undefined
  let filePath: string | undefined
  let memoryPath: string | undefined
  let home: string | undefined
  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at] ?? ''
    const named = actionOf(flag)
    if (named !== undefined) {
      if (action !== undefined) return { kind: 'error', message: `一次只做一件：${action} 与 ${named} 不能一起给` }
      action = named
      continue
    }
    if (flag === '--file' || flag === '--memory' || flag === '--home') {
      const value = valueOf(argv, at)
      if (value === undefined) return { kind: 'error', message: `${flag} 后面要跟一个路径` }
      if (flag === '--file') filePath = value
      else if (flag === '--memory') memoryPath = value
      else home = value
      at += 1
      continue
    }
    return { kind: 'error', message: `不认识的参数 ${flag}` }
  }
  if (action === undefined) return { kind: 'error', message: '要么 --init，要么 --sync，要么 --verify' }
  return {
    kind: 'run',
    args: {
      action,
      file: filePath ?? defaultLedgerFile(home),
      memoryFile: memoryPath ?? defaultMemoryFile(home),
    },
  }
}

/**
 * 核对差异写成一行一条，丢了、被改、还没进记录表、已退役各占一处
 * @param report - 核对结果
 * @returns 差异行，一条都没有时只有退役那一条
 */
export function reportLines(report: LedgerReport): string[] {
  const lines: string[] = []
  if (report.lost.length > 0) lines.push(`丢了 ${report.lost.length} 条：${report.lost.join('、')}`)
  if (report.changed.length > 0) {
    const detail = report.changed.map(one => `${one.id}（${one.expectedLen}→${one.actualLen} 字）`).join('、')
    lines.push(`正文被改 ${report.changed.length} 条：${detail}`)
  }
  if (report.unrecorded.length > 0) lines.push(`还没入账 ${report.unrecorded.length} 条：${report.unrecorded.join('、')}`)
  lines.push(`已退役 ${report.retired} 条`)
  return lines
}

// 记录表读不出来、还没建过、对不上各说一句
function explain(action: LedgerAction, report: LedgerReport, file: string, io: CliIo): number {
  if (report.read === 'broken') {
    io.err(`账本读不出来：${file}｜下一步: 修好这个文件或换 --file，本次没有改动它`)
    return 1
  }
  if (report.read === 'absent') {
    io.err(`账本还没建过：${file}｜下一步: 先跑 --init`)
    return 1
  }
  if (report.ok) {
    io.out(`账本对得上，${report.held} 条，其中已退役 ${report.retired} 条`)
    return 0
  }
  io.err(`账本对不上（${action}）：`)
  for (const line of reportLines(report)) io.err(`  ${line}`)
  return 1
}

// 默认两个出口就是控制台
const consoleIo: CliIo = {
  out(text) {
    console.log(text)
  },
  err(text) {
    console.error(text)
  },
}

/**
 * 跑一次记录表命令行
 * @param argv - 去掉 node 与脚本名之后的参数
 * @param io - 两个出口，默认走控制台
 * @returns 退出码，成功 0，对不上或失败 1
 */
export function runCli(argv: readonly string[], io: CliIo = consoleIo): number {
  if (argv.length === 0) {
    io.err('缺一件要做的事')
    io.out(USAGE)
    return 1
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    io.out(USAGE)
    return 0
  }
  const parsed = parseArgs(argv)
  if (parsed.kind === 'error') {
    io.err(parsed.message)
    io.out(USAGE)
    return 1
  }
  const { action, file, memoryFile } = parsed.args
  try {
    const memory = readMemory(memoryFile)
    if (memory.state === 'broken') {
      io.err(`记忆文件读不出来：${memoryFile}｜下一步: 修好这个文件或换 --memory，本次没有写任何文件`)
      return 1
    }
    // 版本比本包新就停在写之前，两处都判一遍
    assertSupportedVersion(memoryFile, 'version', MEMORY_SCHEMA_VERSION, '记忆文件')
    assertSupportedVersion(file, 'schemaVersion', LEDGER_SCHEMA_VERSION, '账本')
    const result = runLedger(action, { file, items: memory.items })
    const code = explain(action, result.report, file, io)
    // 核对成功只说那一句，建记录表与补记录再交代落了多少条
    if (code === 0 && action !== 'verify') io.out(`${action} 完成：新记 ${result.added.length} 条，账本共 ${result.entries} 条`)
    return code
  } catch (failure) {
    io.err(failure instanceof Error ? failure.message : String(failure))
    return 1
  }
}

// 直接跑这个文件才进命令行，被用例导入时什么都不做
const invoked = process.argv[1]
if (invoked !== undefined && path.resolve(invoked) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli(process.argv.slice(2))
}
