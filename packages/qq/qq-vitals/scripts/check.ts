// 生理状态体检：新鲜度、范围、体温、睡眠；只读，一个字节都不写

import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import type { VitalsState } from '../src/types.ts'

/** 体检用到的三个入参 */
export interface CheckOptions {
  /** 状态文件，不给就取主目录下的 data/qq-vitals.json */
  file?: string
  /** 面板地址，给了就核对面板与状态是不是一致 */
  panel?: string
  /** 现在几点，不给取系统时间 */
  now?: number
}

/** 体检的结论 */
export interface CheckReport {
  /** 状态文件的位置 */
  file: string
  /** 状态多少秒没更新 */
  ageSeconds: number
  /** 越界或异常的字段 */
  problems: readonly string[]
  /** 不算问题但值得看一眼的 */
  notes: readonly string[]
  /** 一行摘要 */
  line: string
}

// 文档要求逐个夹在零到一的字段
const UNIT_FIELDS: readonly (keyof VitalsState)[] = [
  'dopamine', 'oxytocin', 'cortisol', 'serotonin', 'noradrenaline', 'crh', 'acth', 'adrenaline',
  'acetylcholine', 'endorphin', 'vasopressin', 'melatonin', 'ghrelin', 'leptin', 'glucose', 'insulin',
  'glucagon', 'hunger', 'thirst', 'osmolality', 'blood_volume', 'angiotensin', 'fluid_queue', 'adenosine',
  'fever', 'cytokines', 'pain', 'anger', 'resentment', 'fear', 'worry', 'dread', 'mortality',
]

// 状态超过这么久没更新就当成心跳停了
const STALE_SECONDS = 180

// 午睡超过这么久算异常
const NAP_MAX_SECONDS = 2 * 3600

// 未来时刻允许的时钟误差
const CLOCK_SLACK_SECONDS = 60

// 面板与状态两个数的允许差
const PANEL_TOLERANCE = 0.02

// 面板那一份读数：读不到或对不上都算一项问题，不静默跳过
async function panelProblem(panel: string, state: VitalsState): Promise<string | undefined> {
  try {
    const response = await fetch(panel, { headers: { accept: 'application/json' } })
    if (!response.ok) return `面板回 ${response.status}`
    const body = await response.json() as { vitals?: { thirst?: number; energy?: number } }
    const thirst = body.vitals?.thirst
    const energy = body.vitals?.energy
    if (thirst === undefined || energy === undefined) return '面板没有带出身体读数'
    if (Math.abs(thirst - state.thirst) > PANEL_TOLERANCE) return `面板 thirst ${thirst} 与状态 ${state.thirst} 对不上`
    if (Math.abs(energy - state.energy) > PANEL_TOLERANCE) return `面板 energy ${energy} 与状态 ${state.energy} 对不上`
    return undefined
  } catch (error) {
    return `面板读不到：${String(error)}`
  }
}

// 读状态文件；文件是带版本戳的包装，读不出来就抛，调用方按失败处理
function readState(file: string): VitalsState {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: number; state?: VitalsState }
  if (parsed.state === undefined) throw new Error(`${file} 不是生命状态文件`)
  return parsed.state
}

// 数值字段是不是落在零到一
function outOfRange(value: unknown): boolean {
  const number = typeof value === 'number' ? value : Number(value ?? 0)
  return !Number.isFinite(number) || number < -1e-6 || number > 1.000001
}

/**
 * 体检一次
 * @param options - 状态文件、面板地址与当前时刻
 * @returns 结论，含问题清单与一行摘要
 */
export async function runCheck(options: CheckOptions = {}): Promise<CheckReport> {
  const file = options.file ?? `${resolveHuoliHome()}/data/qq-vitals.json`
  const now = options.now ?? Date.now()
  const ageSeconds = Math.round((now - fs.statSync(file).mtimeMs) / 1000)
  const state = readState(file)
  const problems: string[] = []
  const notes: string[] = []

  if (ageSeconds > STALE_SECONDS) problems.push(`状态 ${ageSeconds} 秒没更新（心跳停了？）`)
  for (const field of UNIT_FIELDS) {
    if (outOfRange(state[field])) problems.push(`${String(field)}=${String(state[field])} 越界`)
  }
  const temp = Number(state.core_temp ?? 0)
  if (!(temp >= 34 && temp <= 42)) problems.push(`体温 ${temp.toFixed(2)} 异常`)
  if (state.last_drink > now + CLOCK_SLACK_SECONDS * 1000) problems.push('last_drink 在未来')
  if (state.last_update > now + CLOCK_SLACK_SECONDS * 1000) problems.push('last_update 在未来')
  if (state.thirst > 0.55 && state.last_drink_name !== '') {
    notes.push('口渴仍高但有喝水记录，确认是不是冷却挡掉了那一次')
  }
  if (state.asleep) {
    if (state.wake_after <= now) problems.push('睡着但 wake_after 已过期')
    else if (state.sleep_kind === 'nap' && (state.wake_after - now) / 1000 > NAP_MAX_SECONDS) {
      problems.push('午睡超过两小时')
    }
  }
  if (options.panel !== undefined) {
    const problem = await panelProblem(options.panel, state)
    if (problem !== undefined) problems.push(problem)
  }
  const line = `状态 ${ageSeconds} 秒前更新 | 情绪=${String(state.emotion_level ?? '')}`
    + ` | 饥饿 ${Number(state.hunger ?? 0).toFixed(2)} | 口渴 ${Number(state.thirst ?? 0).toFixed(2)}`
    + ` | 水队列 ${Number(state.fluid_queue ?? 0).toFixed(2)} | 体温 ${temp.toFixed(1)}`

  return { file, ageSeconds, problems, notes, line }
}

// 打印一份结论，全对时返回零
export function printCheck(result: CheckReport, write: (text: string) => void): number {
  write(result.line)
  for (const note of result.notes) write(`提示：${note}`)
  if (result.problems.length === 0) {
    write('✅ 正常')
    return 0
  }
  write(`⚠ 问题：\n  - ${result.problems.join('\n  - ')}`)
  return 1
}

// 直接运行时才走命令行，被用例导入时什么都不做
const entry = process.argv[1]
if (entry !== undefined && pathToFileURL(entry).href === import.meta.url) {
  const argv = process.argv.slice(2)
  const options: CheckOptions = {}
  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at]
    const value = argv[at + 1]
    if (flag === '--file' && value !== undefined) {
      options.file = value
      at += 1
    } else if (flag === '--panel' && value !== undefined) {
      options.panel = value
      at += 1
    } else {
      process.stderr.write(`不认这个参数：${flag ?? ''}\n`)
      process.exit(2)
    }
  }
  void runCheck(options).then((result) => {
    process.exit(printCheck(result, text => process.stdout.write(`${text}\n`)))
  })
}
