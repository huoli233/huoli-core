// 把 B站插件截好的高亮片段发成一张合并转发：一句说明 + 几张关键帧
// B站插件只写自己的 highlights 目录；这里只按 id 读那一份 manifest，不碰别的路径。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Context } from '@huoli/cordis'
import { defineTool } from '@huoli/huoli-tools'
import type { QqChannelSeam } from '@huoli/huoli-qq-channel'

/** 高亮片段的编号只认十六进制，别的一律不读 */
const ID_PATTERN = /^[a-f0-9]{16}$/iu
const MAX_TOTAL_BYTES = 6 * 1024 * 1024
const MAX_VIDEO_BYTES = 8 * 1024 * 1024

interface HighlightManifest {
  version?: number
  id?: string
  bvid?: string
  title?: string
  from?: number
  to?: number
  frames?: { file?: string; at?: number }[]
  clip?: string
  note?: string
}

function refuse(code: string, error: string, hint: string): never {
  throw new Error(`${code}: ${error}｜下一步: ${hint}`)
}

/** 高亮目录：和 B站插件共用 DSH_HOME */
function highlightsRoot(): string {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  return path.resolve(home, 'bili-eyes', 'highlights')
}

/**
 * 读一个高亮片段；只认 highlights 根目录下、编号合法的那个文件夹
 * @param id 片段编号
 * @returns 目录、manifest 与可读的关键帧
 */
function readHighlight(id: string): { dir: string; manifest: HighlightManifest; frames: { file: string; data: Buffer }[]; clip?: Buffer } {
  const root = highlightsRoot()
  const dir = path.resolve(root, id)
  if (!ID_PATTERN.test(id) || !dir.startsWith(`${root}${path.sep}`)) {
    refuse('highlight.bad_id', '片段编号不对', '从 bili_highlight 的返回里原样拿 id')
  }
  let manifest: HighlightManifest
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as HighlightManifest
  } catch {
    refuse('highlight.not_found', '找不到这个高亮片段', '重新用 bili_highlight 截一次，别自己拼路径')
  }
  const frames: { file: string; data: Buffer }[] = []
  let total = 0
  for (const frame of manifest.frames ?? []) {
    const file = typeof frame.file === 'string' ? frame.file : ''
    if (file === '' || file !== path.basename(file) || !/\.(?:jpe?g|png)$/iu.test(file)) continue
    try {
      const data = fs.readFileSync(path.join(dir, file))
      if (total + data.length > MAX_TOTAL_BYTES) break
      total += data.length
      frames.push({ file, data })
    } catch {
      // 少一帧不影响发文字，继续读后面的
    }
  }
  let clip: Buffer | undefined
  const clipFile = typeof manifest.clip === 'string' ? manifest.clip : ''
  if (clipFile !== '' && clipFile === path.basename(clipFile) && /\.mp4$/iu.test(clipFile)) {
    try {
      const data = fs.readFileSync(path.join(dir, clipFile))
      if (data.length <= MAX_VIDEO_BYTES) clip = data
    } catch {
      // 视频读不出来就只发帧
    }
  }
  return { dir, manifest, frames, ...clip === undefined ? {} : { clip } }
}

/**
 * 挂上 qq_send_highlight：把高亮片段发成合并转发
 * @param ctx 运行环境
 * @param options 通道与她自己显示的名字
 * @returns 撤下函数
 */
export function registerHighlightTool(
  ctx: Context,
  options: { channel: QqChannelSeam | undefined; selfName: string },
): () => void {
  const channel = options.channel
  if (channel === undefined) return () => {}
  return ctx.tools.register(defineTool({
    name: 'qq_send_highlight',
    description: '把 bili_highlight 截好的高亮片段发成一张合并转发：一句说明 + 关键帧，有短视频片段再补一条短视频。id 从 bili_highlight 的返回里原样拿；不要自己拼链接、路径或文件地址。只在真看到值得分享的片段时用。',
    parameters: {
      id: { type: 'string', required: true, description: 'bili_highlight 返回的片段编号' },
      note: { type: 'string', description: '发出去时配的一句话，可省略；省略就用截取时的备注' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = exec.agent?.id ?? ''
      if (!chatKey.startsWith('group:') && !chatKey.startsWith('private:')) {
        refuse('highlight.no_chat', '这次调用没有会话身份', '从 QQ 会话里调用')
      }
      const id = typeof args.id === 'string' ? args.id.trim() : ''
      if (id === '') refuse('highlight.no_id', '没给片段编号', '从 bili_highlight 的返回里拿 id')
      const { manifest, frames, clip } = readHighlight(id)
      const text = [typeof args.note === 'string' ? args.note.trim() : '', manifest.note ?? '']
        .find(value => value !== '') ?? manifest.title ?? '刚截的一小段'
      const segments = frames.map(frame => ({
        type: 'image',
        data: { file: `base64://${frame.data.toString('base64')}` },
      }))
      const name = options.selfName.trim() === '' ? '小鲸鱼' : options.selfName.trim()
      const nodes = [
        { name, content: text },
        ...segments.length === 0 ? [] : [{ name, content: segments }],
      ]
      const sent = await channel.channel.sendForward(nodes, chatKey)
      // 短视频单独发：合并转发里放视频不稳，帧和文字已经在卡里了
      let clipSent = false
      if (clip !== undefined) {
        const video = { type: 'video', data: { file: `base64://${clip.toString('base64')}` } }
        clipSent = (await channel.channel.send([video], chatKey)).ok
      }
      if (sent.ok) return { ok: true, id, frames: segments.length, clip: clipSent, messageId: sent.messageId ?? '' }
      // 合并转发发不出去时退回普通消息：文字先走，图片再走；不把整段失败说成成功
      const textSent = await channel.send(text, chatKey, true)
      if (!textSent.ok) refuse('highlight.send_failed', textSent.reason ?? '高亮片段没发出去', '换成 bili_look 的链接或文字概括')
      if (segments.length > 0) await channel.channel.send(segments, chatKey)
      return { ok: true, id, frames: segments.length, clip: clipSent, fallback: true }
    },
  }))
}
