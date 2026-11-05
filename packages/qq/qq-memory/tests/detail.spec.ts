import { afterEach, describe, expect, it } from 'vitest'
import type { ToolRunContext } from '@huoli/huoli-tools'
import { buildInjectBlock } from '../src/inject.ts'
import { recall } from '../src/recall.ts'
import { cleanupTempDirs, mount, tempFile } from './harness.ts'

const AT = new Date(2026, 10, 1, 12, 0).getTime()

function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

afterEach(cleanupTempDirs)

describe('两层放进', () => {
  it('长句只给开头一小段，后面带编号与看全文的提示', () => {
    const { seam } = mount({ file: tempFile() })
    const long = `爬山${'一路走的细节'.repeat(30)}`
    const item = seam.remember(long, 'group:1', { at: AT, importance: 60 })

    const hits = recall(seam.store, { query: '爬山', scope: 'group:1', now: AT })
    const block = buildInjectBlock(hits)

    expect(block).toContain(`（#${item.id}）`)
    expect(block).toContain('…')
    expect(block).toContain('qq_memory_detail')
    // 全文没有被整段塞进去
    expect(block).not.toContain(long)
  })

  it('看全文的工具把全文取回来', async () => {
    const { seam, tool } = mount({ file: tempFile() })
    const long = `爬山${'一路走的细节'.repeat(30)}`
    const item = seam.remember(long, 'group:1', { at: AT, importance: 60 })

    const result = await tool('qq_memory_detail').execute({ id: `#${item.id}` }, execOf('group:1')) as { text: string }

    expect(result.text).toBe(item.text)
  })

  it('编号取不到时拒绝，并说清下一步', async () => {
    const { tool } = mount({ file: tempFile() })

    await expect(tool('qq_memory_detail').execute({ id: 'nope' }, execOf('group:1')))
      .rejects.toThrow(/memory\.not_found/u)
  })

  it('私密记忆在群里取不到全文', async () => {
    const { seam, tool } = mount({ file: tempFile() })
    const item = seam.remember('偷偷做的事', 'group:1', { at: AT, importance: 60, layer: 'private' })

    await expect(tool('qq_memory_detail').execute({ id: item.id }, execOf('group:1')))
      .rejects.toThrow(/memory\.private/u)
  })
})
