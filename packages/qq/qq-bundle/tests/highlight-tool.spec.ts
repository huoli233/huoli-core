import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@huoli/cordis'
import type { QqChannelSeam } from '@huoli/huoli-qq-channel'
import { registerHighlightTool } from '../src/highlight-tool.ts'

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qq-highlight-'))
}

type TestTool = {
  execute: (args: Record<string, unknown>, exec: { agent: { id: string } }) => Promise<unknown>
}

function mount() {
  const tools = new Map<string, TestTool>()
  const ctx = {
    tools: {
      register: (tool: TestTool & { name: string }) => {
        tools.set(tool.name, tool)
        return () => {}
      },
    },
  } as unknown as Context
  const sendForward = vi.fn().mockResolvedValue({ ok: true, messageId: '9' })
  const send = vi.fn().mockResolvedValue({ ok: true })
  const channel = {
    channel: { sendForward, send },
    send,
    selfInfo: () => ({ nickname: '小鲸鱼' }),
  } as unknown as QqChannelSeam
  registerHighlightTool(ctx, { channel, selfName: '小鲸鱼' })
  return { tool: tools.get('qq_send_highlight'), sendForward }
}

const OLD = process.env.DSH_HOME

afterEach(() => {
  if (OLD === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = OLD
})

describe('高亮片段合并转发', () => {
  it('按编号读 manifest，把文字和图片段装进合并转发', async () => {
    const home = tempDir()
    process.env.DSH_HOME = home
    const id = 'abcdef1234567890'
    const dir = path.join(home, 'bili-eyes', 'highlights', id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'frame-1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      version: 1,
      id,
      bvid: 'BV1xx411c7mD',
      title: '测试视频',
      from: 1,
      to: 4,
      frames: [{ file: 'frame-1.jpg', at: 2 }],
      note: '这里很有意思',
    }))
    const { tool, sendForward } = mount()
    if (tool === undefined) throw new Error('高亮工具没挂上')

    const result = await tool.execute({ id }, { agent: { id: 'group:1' } })

    expect(result).toMatchObject({ ok: true, id, frames: 1 })
    expect(sendForward).toHaveBeenCalledTimes(1)
    const [nodes, chatKey] = sendForward.mock.calls[0] as unknown as [{ content: unknown }[], string]
    expect(chatKey).toBe('group:1')
    expect(nodes[0]?.content).toBe('这里很有意思')
    const images = nodes[1]?.content as { type: string; data: { file: string } }[]
    expect(images).toHaveLength(1)
    expect(images[0]?.type).toBe('image')
    expect(images[0]?.data.file.startsWith('base64://')).toBe(true)
  })

  it('编号不合法就不读盘', async () => {
    process.env.DSH_HOME = tempDir()
    const { tool } = mount()
    if (tool === undefined) throw new Error('高亮工具没挂上')
    await expect(tool.execute({ id: '../manifest' }, { agent: { id: 'group:1' } }))
      .rejects.toThrow(/highlight\.bad_id/u)
  })
})
