import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { apply, qqMemoryOf, type QqMemorySeam } from '../src/index.ts'
import type { Tuning } from '../src/defaults.ts'

// 工具体只读会话编号，其余执行字段由内核在真实调用时注入
export function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

export interface Mounted {
  ctx: Context
  seam: QqMemorySeam
  tool: (name: string) => ToolDefinition
}

export interface MountOptions {
  file: string
  ledgerFile?: string
  healthLogFile?: string
  tuning?: Partial<Tuning>
}

const tempDirs: string[] = []

// 造一个用完就删的临时目录
export function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-memory-'))
  tempDirs.push(dir)
  return dir
}

// 删掉本次造过的临时目录
export function cleanupTempDirs(): void {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
}

// 临时目录里的一个记忆文件
export function tempFile(): string {
  return path.join(tempDir(), 'memory.json')
}

// 跟记忆文件放一起的账本
export function ledgerBeside(file: string): string {
  return path.join(path.dirname(file), 'qq-memory-ledger.json')
}

// 跟记忆文件放一起的健康日志
export function healthLogBeside(file: string): string {
  return path.join(path.dirname(file), 'qq-memory-health.log')
}

export function mount(options: MountOptions): Mounted {
  const ctx = new Context()
  const registered = new Map<string, ToolDefinition>()
  ctx.accessor('tools', {
    get: () => ({
      register: (definition: ToolDefinition) => {
        registered.set(definition.name, definition)
        return () => {}
      },
    }),
  })
  apply(ctx, {
    file: options.file,
    ledgerFile: options.ledgerFile ?? ledgerBeside(options.file),
    // 日志总是落在临时目录里，用例不会写到真实的 data 下
    healthLogFile: options.healthLogFile ?? healthLogBeside(options.file),
    ...options.tuning !== undefined ? { tuning: options.tuning } : {},
  })
  const seam = qqMemoryOf(ctx)
  if (seam === undefined) throw new Error('记忆没有装配')
  const tool = (name: string): ToolDefinition => {
    const found = registered.get(name)
    if (found === undefined) throw new Error(`没有注册工具 ${name}`)
    return found
  }
  return { ctx, seam, tool }
}

export async function call<T>(tool: ToolDefinition, args: Record<string, unknown>, exec: ToolRunContext): Promise<T> {
  return await tool.execute(args, exec) as T
}
