// 补一杯水：按生产那份写回公式补一次，先备份再原子写，一个数都不自己定

import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { createVitalsStore, react, resolveTuning } from '../src/index.ts'

/** 补写要看的三件事 */
export interface DrinkOptions {
  /** 状态文件，不给就取主目录下的 data/qq-vitals.json */
  file?: string
  /** 补在哪一刻，不给取系统时间 */
  now?: number
  /** 心跳明显还在跑时也照补，默认不补 */
  force?: boolean
}

/** 补写的结果 */
export interface DrinkReport {
  /** 补上了没有 */
  ok: boolean
  /** 没补上的码 */
  code?: string
  /** 一句可读原因 */
  reason?: string
  /** 下一步提示 */
  hint?: string
  /** 补之前的渴 */
  before?: number
  /** 补之后的渴 */
  after?: number
}

// 状态文件刚被写过就说明心跳还在跑，这时候补的会被覆盖
const JUST_WRITTEN_SECONDS = 180

/**
 * 补一杯水
 * @param options - 状态文件、补写时刻与是否强行补
 * @returns 补上了没有、渴从多少到多少
 */
export function runDrink(options: DrinkOptions = {}): DrinkReport {
  const tuning = resolveTuning()
  const file = options.file ?? `${resolveHuoliHome()}/data/qq-vitals.json`
  const now = options.now ?? Date.now()
  const age = (now - fs.statSync(file).mtimeMs) / 1000
  if (age < JUST_WRITTEN_SECONDS && options.force !== true) {
    return {
      ok: false,
      code: 'drink.still_running',
      reason: `状态文件 ${Math.round(age)} 秒前才写过，心跳多半还在跑`,
      hint: '先停掉生命状态那一行再补，否则六十秒后会被心跳覆盖',
    }
  }
  const store = createVitalsStore({ file, tuning })
  const state = store.read()
  const before = state.thirst
  // 写回公式只有生产的 react 一份，这里不另写一遍
  const next = react(state, '喝水了', now, tuning)
  if (next.last_drink === state.last_drink) {
    return {
      ok: false,
      code: 'drink.recent',
      reason: '最近已经记过喝水，不重复补',
      hint: '等冷却过了再补；一直补不上就先跑体检看渴是不是真的高',
    }
  }
  store.write(next)
  return { ok: true, before, after: next.thirst }
}

// 打印一份结果，补上了返回零
export function printDrink(result: DrinkReport, write: (text: string) => void): number {
  if (!result.ok) {
    write(`${result.code ?? 'drink.failed'}: ${result.reason ?? '没补上'}｜下一步: ${result.hint ?? '先跑体检'}`)
    return 1
  }
  write(`补水完成：渴 ${(result.before ?? 0).toFixed(4)} → ${(result.after ?? 0).toFixed(4)}`)
  return 0
}

// 直接运行时才走命令行，被用例导入时什么都不做
const entry = process.argv[1]
if (entry !== undefined && pathToFileURL(entry).href === import.meta.url) {
  const argv = process.argv.slice(2)
  const options: DrinkOptions = {}
  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at]
    const value = argv[at + 1]
    if (flag === '--file' && value !== undefined) {
      options.file = value
      at += 1
    } else if (flag === '--force') {
      options.force = true
    } else {
      process.stderr.write(`不认这个参数：${flag ?? ''}\n`)
      process.exit(2)
    }
  }
  process.exit(printDrink(runDrink(options), text => process.stdout.write(`${text}\n`)))
}
