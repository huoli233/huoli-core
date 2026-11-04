// SELF_DIR 的读写：事件流只追加，单值内容先写临时文件再改名

import fs from 'node:fs'
import path from 'node:path'
import { renderConstitution } from './constitution.ts'
import { panelBody, panelFile } from './panel.ts'
import type { SelfSettings } from './types.ts'

// 目录里这几个文件名，别处按同样的名字找
const CONSTITUTION = 'constitution.md'
const PANEL = 'panel.md'
const PAUSE = 'PAUSE'

/**
 * 造一个 id
 * @param at - 发生的时刻
 * @returns 时刻的 36 进制加 6 位随机
 */
export function newId(at: number): string {
  const tail = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  return `${at.toString(36)}${tail}`
}

// 读一个文件，读不动就当不存在
function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  } catch (error) {
    // 不在、没权限、读一半坏了都算没有
    void error
    return undefined
  }
}

// 原子写：先写同目录的临时文件，再改名顶上
function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(temporary, text, { mode: 0o600 })
    fs.renameSync(temporary, file)
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true })
    } catch (cleanup) {
      // 临时文件删不掉也留着，正本没被动过
      void cleanup
    }
    throw error
  }
}

// 一行一条 JSON，不是对象的行直接跳过
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** 存盘要用的东西 */
export interface SelfStoreOptions {
  /** 自我层独占的那个目录 */
  dir: string
  /** 参数表 */
  settings: SelfSettings
}

/** 这一层目录的读写口 */
export interface SelfStore {
  /** 目录绝对路径 */
  readonly dir: string
  /** 目录里某个文件的路径 */
  pathOf(name: string): string
  /** 把目录建出来 */
  ensure(): void
  /** 目录在不在 */
  exists(): boolean
  /** 停手开关在不在 */
  paused(): boolean
  /** 某个事件流的非空行 */
  lines(name: string): string[]
  /** 某个事件流的对象行，坏行跳过 */
  records(name: string): Record<string, unknown>[]
  /** 往事件流尾部追加一行 */
  append(name: string, row: object): void
  /** 读一份单值文件 */
  readText(name: string): string | undefined
  /** 覆盖一份单值文件 */
  writeText(name: string, text: string): void
  /** 面板正文，没有时为空 */
  panel(): string | undefined
  /** 面板还在复用窗口内 */
  fresh(now: number): boolean
  /** 写一份新面板 */
  writePanel(body: string, at: number): void
  /** 宪法缺了就补一份，已有就不动 */
  seedConstitution(): void
}

/**
 * 建一个目录读写口
 * @param options - 目录与参数
 * @returns 读写口
 */
export function createSelfStore(options: SelfStoreOptions): SelfStore {
  const { dir, settings } = options
  const pathOf = (name: string): string => path.join(dir, name)

  return {
    dir,
    pathOf,
    ensure() {
      fs.mkdirSync(dir, { recursive: true })
    },
    exists() {
      return fs.existsSync(dir)
    },
    paused() {
      return fs.existsSync(pathOf(PAUSE))
    },
    lines(name) {
      const text = readText(pathOf(name))
      if (text === undefined) return []
      return text.split('\n').filter(line => line.trim().length > 0)
    },
    records(name) {
      const rows: Record<string, unknown>[] = []
      for (const line of this.lines(name)) {
        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch (error) {
          // 半截的行跳过，别让它拖垮整份账
          void error
          continue
        }
        const record = asRecord(parsed)
        if (record !== undefined) rows.push(record)
      }
      return rows
    },
    append(name, row) {
      fs.mkdirSync(dir, { recursive: true })
      fs.appendFileSync(pathOf(name), `${JSON.stringify(row)}\n`)
    },
    readText(name) {
      return readText(pathOf(name))
    },
    writeText(name, text) {
      writeAtomic(pathOf(name), text)
    },
    panel() {
      const text = readText(pathOf(PANEL))
      return text === undefined ? undefined : panelBody(text)
    },
    fresh(now) {
      try {
        const stat = fs.statSync(pathOf(PANEL))
        return stat.size > 0 && now - stat.mtimeMs < settings.panelMaxAgeMs
      } catch (error) {
        // 没这份面板就是要重做一份
        void error
        return false
      }
    },
    writePanel(body, at) {
      writeAtomic(pathOf(PANEL), panelFile(body, at))
    },
    seedConstitution() {
      if (fs.existsSync(pathOf(CONSTITUTION))) return
      writeAtomic(pathOf(CONSTITUTION), renderConstitution())
    },
  }
}
