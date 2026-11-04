// 遗书正文的暂存槽：模型写一次，同一天第二次不再收；写盘先临时文件再改名

import fs from 'node:fs'
import path from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { writeAtomic } from './action-store.ts'

/** 槽的版本，结构改动才递增 */
export const FAREWELL_SLOT_VERSION = 1

/** 盘上那一条：写下的话、写下的时刻，以及它属于哪个本地日 */
export interface FarewellSlot {
  /** 版本戳 */
  version: number
  /** 写下的时刻 */
  at: number
  /** 那一刻的本地零点，同一天的判据 */
  dayStart: number
  /** 正文，原样留着 */
  text: string
}

/** 收一次正文的结论，被拒时带码、原因与下一步 */
export interface FarewellStage {
  /** 收下了就是 true */
  ok: boolean
  /** 拒的时候给的码 */
  code?: string
  /** 一句可读原因 */
  reason?: string
  /** 下一步怎么办 */
  hint?: string
  /** 收下的时刻 */
  at?: number
}

/** 暂存槽在哪、怎么读写 */
export interface FarewellSlotStore {
  /** 读回盘上那一条，读不出时为 undefined */
  read(): FarewellSlot | undefined
  /** 收下一次正文：空的与同一天第二次都由它拒 */
  stage(text: string, at: number): FarewellStage
}

/** 槽的位置 */
export interface FarewellSlotOptions {
  /** 状态文件放在哪 */
  file: string
}

/**
 * 槽的默认位置，与三类动作的状态文件同在一个数据目录下
 * @param home - 数据根目录，不给就按 HUOLI_HOME 定
 * @returns 状态文件的绝对路径
 */
export function defaultFarewellSlotFile(home?: string): string {
  return path.join(resolveHuoliHome(home), 'data', 'qq-farewell.json')
}

// 这一刻落在哪个本地零点：同一天的判据只用这个数，不另外记日期串
function dayStartOf(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

// 取一个有限数，类型不对或不是有限数都算没有
function asNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

// 逐字段校验，结构对不上就当这一份没读过
function parseSlot(text: string): FarewellSlot | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    // 半截的文件按没读过处理
    void error
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>
  if (record.version !== FAREWELL_SLOT_VERSION) return undefined
  const at = asNumber(record.at)
  const dayStart = asNumber(record.dayStart)
  const kept = record.text
  if (at === undefined || dayStart === undefined) return undefined
  if (typeof kept !== 'string' || kept.trim() === '') return undefined
  return { version: FAREWELL_SLOT_VERSION, at, dayStart, text: kept }
}

/**
 * 读盘上那一条
 * @param file - 状态文件放在哪
 * @returns 读出来的一条；文件不在或内容对不上时为 undefined，文件在却读不动时抛错
 */
export function readFarewellSlot(file: string): FarewellSlot | undefined {
  if (!fs.existsSync(file)) return undefined
  return parseSlot(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
}

/**
 * 取能用在某一刻的正文：只有同一天写过才算，别的那一天不算写过
 * @param slot - 盘上那一条，可以没有
 * @param at - 要用的那一刻
 * @returns 正文，不是同一天时为 undefined
 */
export function farewellTextAt(slot: FarewellSlot | undefined, at: number): string | undefined {
  if (slot === undefined) return undefined
  return slot.dayStart === dayStartOf(at) ? slot.text : undefined
}

/**
 * 建一个暂存槽读写口
 * @param options - 状态文件放在哪
 * @returns 读写口
 */
export function createFarewellSlotStore(options: FarewellSlotOptions): FarewellSlotStore {
  const { file } = options

  return {
    read() {
      return readFarewellSlot(file)
    },
    stage(text, at) {
      const kept = text.trim()
      if (kept === '') return { ok: false, code: 'farewell.empty', reason: '没有正文', hint: '想留话就写一句，不想说就别调这个工具' }
      let existing: FarewellSlot | undefined
      try {
        existing = readFarewellSlot(file)
      } catch (error) {
        // 槽在却读不动时不往里盖，换一句重写只会再丢一次
        void error
        return { ok: false, code: 'farewell.write_failed', reason: '这句话没存进去', hint: '别换个说法重写，就当已经说完了' }
      }
      if (existing !== undefined && existing.dayStart === dayStartOf(at)) {
        return { ok: false, code: 'farewell.duplicate', reason: '今天已经写过一次了', hint: '一天只收一次，今天那句已经存下了，别再写' }
      }
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        writeAtomic(file, `${JSON.stringify({ version: FAREWELL_SLOT_VERSION, at, dayStart: dayStartOf(at), text: kept }, null, 2)}\n`)
      } catch (error) {
        // 写不进去只回码，不重试也不改写正文
        void error
        return { ok: false, code: 'farewell.write_failed', reason: '这句话没存进去', hint: '别换个说法重写，就当已经说完了' }
      }
      return { ok: true, at }
    },
  }
}
