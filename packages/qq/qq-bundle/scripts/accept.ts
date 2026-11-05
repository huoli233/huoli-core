// 跨包的那几行验收：条数受不受情绪影响、水罐是不是全蓝、补喝水补到哪

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { replyBudget } from '@huoli/huoli-qq-pacing'
import { panelPage, type PanelState } from '@huoli/huoli-qq-self'
import { createVitalsStore, emptyState, react, resolveTuning, WORDS_PRESET, type VitalsState } from '@huoli/huoli-qq-vitals'

// 验收表里那几行按口语判的那几条，显式把词表打开
const tuning = resolveTuning({ words: WORDS_PRESET })

/** 一条验收的结论 */
export interface AcceptRow {
  /** 表里那一行的名字 */
  name: string
  /** 过没过 */
  ok: boolean
  /** 没过的原因，过了给空串 */
  why: string
}

// 一条验收：判据自己给，过了就不留原因
function row(name: string, pass: boolean, why: string): AcceptRow {
  return { name, ok: pass, why: pass ? '' : why }
}

// 一份最小的只读出口内容，只要能画水罐
function pageOf(thirst: number): string {
  const state: PanelState = {
    panel: { body: '【自我】', generatedAt: '' },
    ledger: { drive: 0, agency: 0, recentAgency: 0 },
    days: [],
    health: '健康：',
    vitals: { thirst },
  }
  return panelPage(state)
}

// 补一杯水：写到临时文件里，不碰主目录
function drinkOnce(): VitalsState {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-accept-drink-'))
  try {
    const file = path.join(dir, 'vitals.json')
    const now = Date.now()
    const store = createVitalsStore({ file, tuning })
    store.write({ ...emptyState(tuning, now - 60_000), thirst: 0.58 })
    const next = react(store.read(), '喝水了', now, tuning)
    store.write(next)
    return createVitalsStore({ file, tuning }).read()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * 跑跨包那几行
 * @returns 每一条的结论
 */
export function runAccept(): AcceptRow[] {
  const rows: AcceptRow[] = []

  // 条数：被凶之后这一轮最多两句，平时的档位应该更高
  const angry = replyBudget({ tired: 0.2, annoyed: 0.9, energy: 0.5, clingy: 0.2, lonely: 0.2, anger: 0.6 })
  rows.push(row(
    '在被凶的状态下条数收到两句以内',
    angry <= 2,
    `条数上限 ${angry}`,
  ))

  // 水罐：三种水位都是蓝，旧的红/琥珀色一个都不许出现
  const pages = [0.1, 0.5, 0.9].map(pageOf)
  const blue = ['water-low', 'water-mid', 'water-high']
  const noOld = pages.every(page => !page.includes('#1f6fb2') && !page.includes('#5b9bd5') && !page.includes('#a8cbe8'))
  rows.push(row(
    '水罐三种水位都是蓝，没有旧的红琥珀色',
    noOld && pages.every(page => blue.some(name => page.includes(`tank-water ${name}`))),
    '有水位没用三档蓝，或仍带着旧色值',
  ))

  // 补喝水：一杯下去从 0.58 掉到 0.03 上下
  const after = drinkOnce().thirst
  rows.push(row(
    '补一杯水让口渴从 0.58 掉到 0.03 上下',
    Math.abs(after - 0.03) < 0.02,
    `补完是 ${after.toFixed(3)}`,
  ))

  return rows
}

// 打印一张验收表，全过返回零
export function printAccept(rows: readonly AcceptRow[], write: (text: string) => void): number {
  for (const entry of rows) {
    write(`${entry.ok ? '✅' : '❌'} ${entry.name}${entry.ok ? '' : `：${entry.why}`}`)
  }
  const failed = rows.filter(entry => !entry.ok).length
  write(`\n共 ${rows.length} 条，通过 ${rows.length - failed} 条，未过 ${failed} 条`)
  return failed === 0 ? 0 : 1
}

// 直接运行时才走命令行，被用例导入时什么都不做
const entry = process.argv[1]
if (entry !== undefined && pathToFileURL(entry).href === import.meta.url) {
  const argv = process.argv.slice(2)
  if (argv.length > 0) {
    process.stderr.write(`不认这个参数：${argv[0] ?? ''}\n`)
    process.exit(2)
  }
  process.exit(printAccept(runAccept(), text => process.stdout.write(`${text}\n`)))
}
