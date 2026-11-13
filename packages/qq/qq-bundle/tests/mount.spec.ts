// 组合包要真的能挂进启动面：清单声明、patch 形状、插进基线后的条目都要对

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { applyEntryPatches, entryListSchema, type PatchOptions } from '@huoli/cordis-plugin-include'

type Entries = Parameters<typeof applyEntryPatches>[0]

// 一份最小的底子，够让 insert 与 override 两条改动都插得进去
const BASE: Entries = [{ id: 'system-prompt', name: '@huoli/huoli-system-prompt' }, { id: 'compaction-basic', name: '@huoli/huoli-compaction-basic' }]

// QQ 组件与本机语音识别行按 patch 顺序装配
const QQ_IDS = ['speech-to-text', 'speech-to-text-sensevoice', 'qq-attention', 'qq-subject', 'qq-memory', 'qq-pacing', 'qq-material', 'qq-proactive', 'qq-continuity', 'qq-channel', 'qq-vitals', 'qq-balance', 'qq-self', 'qq-bundle']

/** 读组合包自己的 patch，用装载器同一套 schema 解出来 */
function patchOf(root: string, declared: string): PatchOptions[] {
  const parsed = yaml.load(readFileSync(resolve(root, declared), 'utf8'), { schema: entryListSchema })
  expect(Array.isArray(parsed)).toBe(true)
  return parsed as PatchOptions[]
}

describe('组合包挂载', () => {
  it('清单声明的 patch 文件读得到，且顶层是数组', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      huoli?: { bundle?: { patch?: string | string[] } }
    }
    const declared = manifest.huoli?.bundle?.patch
    expect(declared).toBeDefined()
    const first = Array.isArray(declared) ? declared[0] : declared
    expect(typeof first).toBe('string')
    expect(patchOf(root, first as string).length).toBeGreaterThan(0)
  })

  it('挂上组合包后本机语音识别与 QQ 零件都在，装配行排在最后', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const patches = patchOf(root, 'qq.patch.yml')
    const rows = applyEntryPatches(BASE, patches, () => {})
    const ids = rows.map(row => row.id)
    for (const id of QQ_IDS) expect(ids).toContain(id)
    expect(ids.indexOf('qq-bundle')).toBeGreaterThan(ids.indexOf('qq-self'))
    const bundle = rows.find(row => row.id === 'qq-bundle')
    const speech = rows.find(row => row.id === 'speech-to-text')
    const sensevoice = rows.find(row => row.id === 'speech-to-text-sensevoice')
    const attention = rows.find(row => row.id === 'qq-attention')
    const channel = rows.find(row => row.id === 'qq-channel')
    const proactive = rows.find(row => row.id === 'qq-proactive')
    const vitals = rows.find(row => row.id === 'qq-vitals')
    const self = rows.find(row => row.id === 'qq-self')
    expect(bundle?.name).toBe('@huoli/huoli-qq-bundle')
    expect(speech?.config).toMatchObject({ defaultProvider: 'sensevoice-local', language: 'zh' })
    expect(sensevoice?.config).toMatchObject({ precision: 'int8', threads: 2, maxPending: 4 })
    expect(attention?.config).toHaveProperty('selfNames')
    expect(channel?.config).toMatchObject({
      replySingleMessage: false,
      replyPartMaxChars: 90,
      replyStripWrittenPunctuation: false,
    })
    expect(proactive?.config).toMatchObject({ enabled: true })
    expect(vitals?.config).toMatchObject({ tuning: { emotionToneEnabled: true } })
    expect(self?.config).toMatchObject({ enabled: true })
    expect(self?.config).toHaveProperty('panelPort')
    expect(bundle?.config).toMatchObject({
      visionProvider: 'relay-103',
      visionModel: 'gpt-6-luna',
      visionHighModel: 'gpt-6.1-terra',
      visionAlwaysUseConfiguredModel: true,
      visionBatchMaxBytes: 16777216,
      imageGenModel: 'gpt-image-2.5-sunburst',
      imageGenFallbackModel: 'gpt-image-2.5-flare',
      asrMode: 'local',
      asrEnabled: true,
      asrPrepareOnStart: true,
    })
  })

  it('压缩设置提前收敛长会话并限制摘要预算', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const rows = applyEntryPatches(BASE, patchOf(root, 'qq.patch.yml'), () => {})
    const compaction = rows.find(row => row.id === 'compaction-basic')
    expect(compaction?.config).toMatchObject({
      thresholdRatio: 0.08,
      retainTokens: 16384,
      headroomTokens: 8192,
      maxTokens: 2048,
    })
  })

  it('没把组合包列进 profile 时一条 QQ 行也没有', () => {
    const rows = applyEntryPatches(BASE, [], () => {})
    expect(rows.filter(row => (row.id ?? '').startsWith('qq-'))).toEqual([])
  })
})
