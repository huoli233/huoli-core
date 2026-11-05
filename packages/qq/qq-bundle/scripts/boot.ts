// 按组合包的 patch 顺序把零件挂进一个真实运行环境，打印起来的是什么

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import * as attention from '@huoli/huoli-qq-attention'
import * as channel from '@huoli/huoli-qq-channel'
import * as continuity from '@huoli/huoli-qq-continuity'
import * as material from '@huoli/huoli-qq-material'
import * as memory from '@huoli/huoli-qq-memory'
import * as pacing from '@huoli/huoli-qq-pacing'
import * as proactive from '@huoli/huoli-qq-proactive'
import * as self from '@huoli/huoli-qq-self'
import * as subject from '@huoli/huoli-qq-subject'
import * as vitals from '@huoli/huoli-qq-vitals'
import { apply as applyBundle, qqBundleOf } from '../src/index.ts'

/** 一行结果：这个零件起来没有、它的接缝取不取得到 */
export interface BootRow {
  /** patch 里的 id */
  id: string
  /** 装上了没有 */
  mounted: boolean
  /** 接缝取不取得到 */
  seam: boolean
}

// 从 patch 里读每个零件的 enabled，没写的按开
function switches(): Map<string, boolean> {
  const text = fs.readFileSync(new URL('../qq.patch.yml', import.meta.url), 'utf8')
  const out = new Map<string, boolean>()
  let current = ''
  for (const line of text.split('\n')) {
    const id = /^\s*-\s*id:\s*(\S+)/.exec(line)
    if (id !== null) {
      current = id[1] ?? ''
      out.set(current, true)
      continue
    }
    const off = /enabled:\s*false/.test(line)
    if (off && current !== '') out.set(current, false)
  }
  return out
}

/**
 * 挂一遍并报告
 * @returns 每个零件一行
 */
export async function boot(): Promise<{ rows: BootRow[]; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-boot-'))
  const ctx = new Context()
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})

  const flag = switches()
  const parts = [
    ['qq-attention', attention, 'qqAttentionOf'],
    ['qq-subject', subject, 'qqSubjectOf'],
    ['qq-memory', memory, 'qqMemoryOf'],
    ['qq-pacing', pacing, 'qqPacingOf'],
    ['qq-material', material, 'qqMaterialOf'],
    ['qq-proactive', proactive, 'qqProactiveOf'],
    ['qq-continuity', continuity, 'qqContinuityOf'],
    ['qq-channel', channel, 'qqChannelOf'],
    ['qq-vitals', vitals, 'qqVitalsOf'],
    ['qq-self', self, 'qqSelfOf'],
  ] as const

  const rows: BootRow[] = []
  for (const [id, pkg, pick] of parts) {
    const on = flag.get(id) ?? true
    try {
      // 每一行按自己的默认配置挂：目录都落在临时目录里，不碰主目录
      const apply = (pkg as { apply?: (c: Context, cfg?: Record<string, unknown>) => void }).apply
      if (typeof apply !== 'function') {
        rows.push({ id, mounted: false, seam: false })
        continue
      }
      const config: Record<string, unknown> = { huoliHome: dir }
      if (id === 'qq-self') config.enabled = on
      if (id === 'qq-proactive') config.enabled = on
      apply(ctx, config)
      const picker = (pkg as Record<string, unknown>)[pick] as ((c: Context) => unknown) | undefined
      const mounted = picker !== undefined && picker(ctx) !== undefined
      rows.push({ id, mounted, seam: mounted })
    } catch (error) {
      rows.push({ id, mounted: false, seam: false })
      process.stderr.write(`${id} 没起来：${String(error)}\n`)
    }
  }

  // 最后一行是装配：它自己不产出接缝，用 decisions 检查它活没活
  try {
    applyBundle(ctx, { maxSteps: 5, home: dir, decisionsFile: path.join(dir, 'decisions.jsonl'), dailySweepAt: '00:20' })
    rows.push({ id: 'qq-bundle', mounted: qqBundleOf(ctx) !== undefined, seam: qqBundleOf(ctx) !== undefined })
  } catch (error) {
    rows.push({ id: 'qq-bundle', mounted: false, seam: false })
    process.stderr.write(`qq-bundle 没起来：${String(error)}\n`)
  }
  return { rows, dir }
}

const entry = process.argv[1]
if (entry !== undefined && entry.endsWith('boot.ts')) {
  const { rows, dir } = await boot()
  for (const row of rows) {
    process.stdout.write(`${row.mounted ? '起来了' : '没起来'}  ${row.id}${row.seam ? '（接缝可取）' : ''}\n`)
  }
  const up = rows.filter(row => row.mounted).length
  process.stdout.write(`\n共 ${rows.length} 行，起来 ${up} 行，临时目录 ${dir}\n`)
  process.exit(up === rows.length ? 0 : 1)
}
