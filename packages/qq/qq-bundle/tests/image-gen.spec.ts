import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@huoli/cordis'
import type { QqChannelSeam } from '@huoli/huoli-qq-channel'
import { registerImageGenTool } from '../src/image-gen.ts'
import type { Config } from '../src/types.ts'

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-'))
}

function mount() {
  const tools = new Map<string, { execute: (args: Record<string, unknown>, exec: { agent: { id: string } }) => Promise<unknown> }>()
  const ctx = {
    tools: {
      register: (tool: {
        name: string
        execute: (args: Record<string, unknown>, exec: { agent: { id: string } }) => Promise<unknown>
      }) => {
        tools.set(tool.name, tool)
        return () => {}
      },
    },
  } as unknown as Context
  const send = vi.fn().mockResolvedValue({ ok: true, messageId: '42' })
  const channel = { channel: { send } } as unknown as QqChannelSeam
  return { tools, ctx, channel, send }
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('生图工具', () => {
  it('在主人私聊里生图并把图片段发出去', async () => {
    const dir = tempDir()
    dirs.push(dir)
    const credentials = path.join(dir, 'credentials.yaml')
    fs.writeFileSync(credentials, 'version: 1\nrefs:\n  TEST_IMG_KEY: test-key\n')
    const requests: [string, RequestInit][] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
      requests.push([url, init ?? {}])
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('fake-png').toString('base64') }] }))
    }
    const { tools, ctx, channel, send } = mount()
    const config = {
      home: dir,
      imageGenBaseURL: 'http://relay.test/v1',
      imageGenModel: 'gpt-image-2',
      imageGenKeyRef: 'TEST_IMG_KEY',
      imageGenCredentialFile: credentials,
      imageGenSize: '1024x1024',
      imageGenTimeoutMs: 10_000,
    } as Config
    registerImageGenTool(ctx, { channel, config, ownerQq: '555', fetchImpl })
    const tool = tools.get('qq_generate_image')
    if (tool === undefined) throw new Error('生图工具没挂上')

    const result = await tool.execute({ prompt: '画一只蓝色小鲸鱼' }, { agent: { id: 'private:555' } })

    expect(result).toMatchObject({ ok: true, model: 'gpt-image-2' })
    expect(requests).toHaveLength(1)
    const [url, init] = requests[0]!
    expect(url).toBe('http://relay.test/v1/images/generations')
    if (typeof init.body !== 'string') throw new Error('生图请求体不是 JSON 字符串')
    expect(JSON.parse(init.body)).toMatchObject({ model: 'gpt-image-2', prompt: '画一只蓝色小鲸鱼' })
    expect(send).toHaveBeenCalledTimes(1)
    const segments = (send.mock.calls[0] as unknown as [{ type: string; data: { file: string } }[], string])[0]
    expect(segments[0]?.type).toBe('image')
    expect(segments[0]?.data.file.startsWith('base64://')).toBe(true)
  })

  it('群里不接生图', async () => {
    const dir = tempDir()
    dirs.push(dir)
    const credentials = path.join(dir, 'credentials.yaml')
    fs.writeFileSync(credentials, 'version: 1\nrefs:\n  TEST_IMG_KEY: test-key\n')
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const { tools, ctx, channel } = mount()
    registerImageGenTool(ctx, {
      channel,
      ownerQq: '555',
      fetchImpl,
      config: {
        home: dir,
        imageGenBaseURL: 'http://relay.test/v1',
        imageGenKeyRef: 'TEST_IMG_KEY',
        imageGenCredentialFile: credentials,
      },
    })
    const tool = tools.get('qq_generate_image')
    if (tool === undefined) throw new Error('生图工具没挂上')

    await expect(tool.execute({ prompt: '画一只鲸鱼' }, { agent: { id: 'group:1' } }))
      .rejects.toThrow(/imagegen\.private_only/u)
  })

  it('主模型明确返回 HTTP 错误时改用配置的备用模型', async () => {
    const dir = tempDir()
    dirs.push(dir)
    const credentials = path.join(dir, 'credentials.yaml')
    fs.writeFileSync(credentials, 'version: 1\nrefs:\n  TEST_IMG_KEY: test-key\n')
    const requests: [string, RequestInit][] = []
    let requestCount = 0
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
      requests.push([url, init ?? {}])
      const response = requestCount++ === 0
        ? { error: { message: 'unavailable' } }
        : { data: [{ b64_json: Buffer.from('fake-png').toString('base64') }] }
      return new Response(JSON.stringify(response), { status: requestCount === 1 ? 503 : 200 })
    }
    const { tools, ctx, channel } = mount()
    registerImageGenTool(ctx, {
      channel,
      ownerQq: '555',
      fetchImpl,
      config: {
        home: dir,
        imageGenBaseURL: 'http://relay.test/v1',
        imageGenModel: 'gpt-image-2.5-sunburst',
        imageGenFallbackModel: 'gpt-image-2.5-flare',
        imageGenKeyRef: 'TEST_IMG_KEY',
        imageGenCredentialFile: credentials,
      },
    })
    const tool = tools.get('qq_generate_image')
    if (tool === undefined) throw new Error('生图工具没挂上')

    await expect(tool.execute({ prompt: '画一只鲸鱼' }, { agent: { id: 'private:555' } }))
      .resolves.toMatchObject({ ok: true, model: 'gpt-image-2.5-flare' })
    expect(requests).toHaveLength(2)
    const firstBody = requests[0]?.[1].body
    const secondBody = requests[1]?.[1].body
    if (typeof firstBody !== 'string' || typeof secondBody !== 'string') throw new Error('生图请求体不是 JSON 字符串')
    expect(JSON.parse(firstBody)).toMatchObject({ model: 'gpt-image-2.5-sunburst' })
    expect(JSON.parse(secondBody)).toMatchObject({ model: 'gpt-image-2.5-flare' })
  })
})
