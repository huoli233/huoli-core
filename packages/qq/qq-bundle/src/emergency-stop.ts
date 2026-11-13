// 全局急停：一个文件同时挡住入站、模型步骤和所有 QQ 外发

import fs from 'node:fs'
import path from 'node:path'

/** 急停现在的状态 */
export interface EmergencyStopState {
  /** 是否已经停下 */
  active: boolean
  /** 什么时候停的 */
  at: number
  /** 为什么停 */
  reason: string
}

/** 急停控制口 */
export interface EmergencyStop {
  /** 读当前状态 */
  state(): EmergencyStopState
  /** 打开急停 */
  stop(reason: string): EmergencyStopState
  /** 解除急停 */
  resume(): EmergencyStopState
}

const RUNNING: EmergencyStopState = { active: false, at: 0, reason: '' }

function readState(file: string): EmergencyStopState {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return RUNNING
    const row = parsed as Record<string, unknown>
    return {
      active: row.active === true,
      at: typeof row.at === 'number' && Number.isFinite(row.at) ? row.at : 0,
      reason: typeof row.reason === 'string' ? row.reason : '',
    }
  } catch {
    return RUNNING
  }
}

function writeState(file: string, state: EmergencyStopState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * 建一个文件控制的急停
 * @param file 状态文件
 * @returns 急停控制口
 */
export function createEmergencyStop(file: string): EmergencyStop {
  return {
    state() {
      return readState(file)
    },
    stop(reason) {
      const state = { active: true, at: Date.now(), reason }
      writeState(file, state)
      return state
    },
    resume() {
      try {
        fs.unlinkSync(file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      return RUNNING
    },
  }
}
