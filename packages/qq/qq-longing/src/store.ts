// 状态文件独占一个写者，正式文件、备份和默认值三级回退

import fs from 'node:fs'
import path from 'node:path'
import { emptyLongingState, normalizeLongingState, type LongingState } from './model.ts'

/** 状态仓选项 */
export interface LongingStoreOptions {
  file: string
}

/** 状态仓 */
export interface LongingStore {
  read(): LongingState
  write(state: LongingState): void
}

function readFile(file: string): LongingState | undefined {
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
    if (text.trim() === '') return undefined
    const parsed = JSON.parse(text) as Partial<LongingState>
    return normalizeLongingState(parsed)
  } catch {
    return undefined
  }
}

function backupFile(file: string): string {
  return `${file}.bak`
}

/**
 * 建状态仓
 * @param options - 文件路径
 * @returns 状态读写口
 */
export function createLongingStore(options: LongingStoreOptions): LongingStore {
  return {
    read() {
      return readFile(options.file) ?? readFile(backupFile(options.file)) ?? emptyLongingState()
    },
    write(state) {
      const dir = path.dirname(options.file)
      fs.mkdirSync(dir, { recursive: true })
      const temporary = `${options.file}.${process.pid}.tmp`
      fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
      if (fs.existsSync(options.file)) {
        try {
          fs.copyFileSync(options.file, backupFile(options.file))
        } catch {
          // 备份失败不阻断正式状态落盘
        }
      }
      fs.renameSync(temporary, options.file)
    },
  }
}
