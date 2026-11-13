// 生图：走主人配的 OpenAI 兼容中转（默认 gpt-image-2），只在主人私聊里发。
// 凭证只在本进程读，不返回给模型，也不写进日志。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Context } from '@huoli/cordis'
import { defineTool } from '@huoli/huoli-tools'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import type { QqChannelSeam } from '@huoli/huoli-qq-channel'
import { BUNDLE_DEFAULTS } from './defaults.ts'
import type { Config } from './types.ts'

/** 一张生图请求要用的东西 */
export interface ImageGenOptions {
  channel: QqChannelSeam | undefined
  config: Config
  ownerQq: string
  /** 测试时可替换 */
  fetchImpl?: typeof fetch
}

function refuse(code: string, error: string, hint: string): never {
  throw new Error(`${code}: ${error}｜下一步: ${hint}`)
}

/**
 * 从凭证文件里取一个 ref 的值；环境变量优先，其次 ~/.huoli/.credentials.yaml 的 refs
 * @param ref - 凭证名
 * @param file - 凭证文件，留空用默认
 * @returns 凭证原文
 */
export function readCredentialRef(ref: string, file = ''): string {
  const fromEnv = process.env[ref]
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim()
  const target = file.trim() === '' ? path.join(os.homedir(), '.huoli', '.credentials.yaml') : file
  let text: string
  try {
    text = fs.readFileSync(target, 'utf8').replace(/^\uFEFF/u, '')
  } catch {
    refuse('imagegen.no_credentials', '找不到生图凭证文件', '在 profile 配 imageGenCredentialFile 或设置环境变量')
  }
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const hit = new RegExp(`^\\s*${escaped}\\s*:\\s*(.+?)\\s*$`, 'mu').exec(text)
  const value = hit?.[1]?.trim().replace(/^['"]|['"]$/gu, '') ?? ''
  if (value === '') refuse('imagegen.no_key', `凭证里没有 ${ref}`, '确认 refs 里有这个名字，或设置环境变量')
  return value
}

/**
 * 挂上 qq_generate_image：只在主人私聊里生图并发出去
 * @param ctx 运行环境
 * @param options 通道、配置与主人 QQ
 * @returns 撤下函数
 */
export function registerImageGenTool(ctx: Context, options: ImageGenOptions): () => void {
  const channel = options.channel
  if (channel === undefined) return () => {}
  const baseURL = (options.config.imageGenBaseURL ?? '').trim().replace(/\/+$/u, '')
  return ctx.tools.register(defineTool({
    name: 'qq_generate_image',
    description: '画一张图并发给主人（只在主人私聊）。prompt 写具体画面、风格、构图和氛围，不要写内务、路径或工具名。生图比较慢，一次只画一张；不是每轮都要画。',
    parameters: {
      prompt: { type: 'string', required: true, description: '画面描述，具体一点，最多 800 字' },
      size: { type: 'string', description: '尺寸，比如 1024x1024 / 1024x1536 / 1536x1024；不填用设置里的' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = exec.agent?.id ?? ''
      const owner = options.ownerQq.trim()
      if (owner === '' || chatKey !== `private:${owner}`) {
        refuse('imagegen.private_only', '生图只在主人私聊里用', '群里先发文字，别刷图')
      }
      if (baseURL === '') refuse('imagegen.off', '还没配生图接口', '在 profile 里填 imageGenBaseURL')
      const prompt = typeof args.prompt === 'string' ? args.prompt.replace(/\s+/gu, ' ').trim().slice(0, 800) : ''
      if (prompt === '') refuse('imagegen.no_prompt', '没写要画什么', '写清画面、风格和构图')
      const model = (options.config.imageGenModel ?? BUNDLE_DEFAULTS.imageGenModel).trim()
      const fallbackModel = (options.config.imageGenFallbackModel ?? BUNDLE_DEFAULTS.imageGenFallbackModel).trim()
      const size = typeof args.size === 'string' && /^\d{3,4}x\d{3,4}$/u.test(args.size.trim())
        ? args.size.trim()
        : (options.config.imageGenSize ?? '1024x1024')
      // 外观锚点：每次画都把发色、瞳色、尾巴、服装这些固定特征带上
      const anchor = (options.config.imageGenStyleAnchor ?? options.config.selfReferenceDescription ?? '').trim()
      const styledPrompt = anchor === '' || prompt.includes(anchor) ? prompt : `${anchor}。${prompt}`
      // 参考图：三视图/立绘存在才走 edits，不存在就老实文生图
      const references = (options.config.imageGenReferenceImages ?? [])
        .map(file => file.trim())
        .filter(file => file !== '' && fs.existsSync(file))
      const key = readCredentialRef(options.config.imageGenKeyRef ?? 'RELAY_103_KEY', options.config.imageGenCredentialFile ?? '')
      const timeout = Math.max(10_000, options.config.imageGenTimeoutMs ?? 180_000)
      const fetchImpl = options.fetchImpl ?? fetch
      let responseModel = model
      const call = async (url: string, init: RequestInit): Promise<Response> => {
        try {
          return await fetchImpl(url, init)
        } catch (error) {
          refuse('imagegen.network', `生图接口没连上：${String(error instanceof Error ? error.message : error)}`, '过一会儿再试，别连着重发')
        }
      }
      let response: Response
      if (references.length > 0) {
        const form = new FormData()
        form.append('model', model)
        form.append('prompt', styledPrompt)
        form.append('n', '1')
        form.append('size', size)
        for (const [index, file] of references.entries()) {
          form.append('image', new Blob([new Uint8Array(fs.readFileSync(file))]), `reference-${index}.png`)
        }
        response = await call(`${baseURL}/images/edits`, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}` },
          body: form,
          signal: AbortSignal.timeout(timeout),
        })
        // 中转不支持 edits 时退回文生图，别让整次画图卡死
        if (!response.ok) {
          response = await call(`${baseURL}/images/generations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify({ model, prompt: styledPrompt, n: 1, size }),
            signal: AbortSignal.timeout(timeout),
          })
        }
      } else {
        response = await call(`${baseURL}/images/generations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, prompt: styledPrompt, n: 1, size }),
          signal: AbortSignal.timeout(timeout),
        })
      }
      if (!response.ok && fallbackModel !== '' && fallbackModel !== model) {
        responseModel = fallbackModel
        response = await call(`${baseURL}/images/generations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({ model: fallbackModel, prompt: styledPrompt, n: 1, size }),
          signal: AbortSignal.timeout(timeout),
        })
      }
      const body = await response.json().catch(() => null) as {
        data?: { b64_json?: string; url?: string }[]
        error?: { message?: string }
      } | null
      if (!response.ok) {
        const why = body?.error?.message ?? `HTTP ${response.status}`
        refuse('imagegen.failed', `生图没成：${why}`, '换一句描述或过一会儿再试')
      }
      const first = body?.data?.[0]
      let bytes: Buffer
      if (typeof first?.b64_json === 'string' && first.b64_json !== '') {
        bytes = Buffer.from(first.b64_json, 'base64')
      } else if (typeof first?.url === 'string' && first.url !== '') {
        const image = await fetchImpl(first.url, { signal: AbortSignal.timeout(timeout) })
        if (!image.ok) refuse('imagegen.download', `图片下载失败 HTTP ${image.status}`, '让主人稍后再试')
        bytes = Buffer.from(await image.arrayBuffer())
      } else {
        refuse('imagegen.empty', '接口没返回图片', '换一句描述或换模型')
      }
      if (bytes.length > 12 * 1024 * 1024) refuse('imagegen.too_large', '图片超过 12MB', '换小一点的尺寸')
      const dir = path.join(resolveHuoliHome(options.config.home), 'data', 'imagegen')
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, `${Date.now()}.png`)
      fs.writeFileSync(file, bytes)
      const sent = await channel.channel.send([{
        type: 'image',
        data: { file: `base64://${bytes.toString('base64')}` },
      }], chatKey)
      if (!sent.ok) refuse(sent.code ?? 'imagegen.send_failed', sent.reason ?? '图画好了但没发出去', '等一下再发，别重画')
      return { ok: true, model: responseModel, size, bytes: bytes.length, messageId: sent.messageId ?? '' }
    },
  }))
}
