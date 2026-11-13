import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import { AttachmentId, type ImageAttachmentRef } from '@huoli/huoli-attachment'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImageArchive } from '../src/image-archive.ts'
import { registerImageTools } from '../src/image-tools.ts'

const dirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-image-tools-'))
  dirs.push(dir)
  return path.join(dir, 'images.json')
}

function image(): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId('sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
    mediaType: 'image/png',
    bytes: 10,
    width: 10,
    height: 10,
  }
}

function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('旧图片工具', () => {
  it('能列出哈希并按下一次问题重看', async () => {
    const ctx = new Context()
    const tools = new Map<string, ToolDefinition>()
    ctx.accessor('tools', {
      get: () => ({
        register: (tool: ToolDefinition) => {
          tools.set(tool.name, tool)
          return () => { tools.delete(tool.name) }
        },
      }),
    })
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const record = archive.record({
      chatKey: 'group:1', messageId: '1', senderId: 'u1', senderName: '甲', at: Date.now(), image: image(), weight: 50,
    })
    const viewer = vi.fn(async () => '图里有两个人')
    const dispose = registerImageTools(ctx, { archive, viewer, listMax: 20 })

    const list = tools.get('qq_image_list')
    const view = tools.get('qq_image_view')
    const annotate = tools.get('qq_image_annotate')
    if (list === undefined || view === undefined || annotate === undefined) throw new Error('图片工具没挂上')
    const listed = await list.execute({ limit: 5 }, execOf('group:1')) as { items: Array<{ imageId: string }> }
    const viewed = await view.execute({
      image_id: record.imageId,
      question: '图里有几个人',
      deep: true,
    }, execOf('group:1')) as { text: string }

    expect(listed.items[0]?.imageId).toBe(record.imageId)
    expect(viewed.text).toBe('图里有两个人')
    expect(viewer).toHaveBeenCalledWith(image(), { focus: '图里有几个人', deep: true })
    await annotate.execute({
      image_id: record.imageId,
      tags: ['合照', '两个人'],
      emotion: '开心',
      intensity: 0.7,
      use_when: '一起玩的时候',
    }, execOf('group:1'))
    const listedAgain = await list.execute({ limit: 5 }, execOf('group:1')) as {
      items: Array<{ semanticTags: string[]; emotion: string; useWhen: string }>
    }
    expect(listedAgain.items[0]).toMatchObject({
      semanticTags: ['合照', '两个人'],
      emotion: '开心',
      useWhen: '一起玩的时候',
    })
    dispose()
    expect(tools.size).toBe(0)
  })
})
