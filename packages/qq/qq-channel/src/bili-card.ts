// B站视频卡：补封面并检查网关 Ark 是否可渲染。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const VIDEO_API = 'https://api.bilibili.com/x/web-interface/view'
const DEVICE_API = 'https://api.bilibili.com/x/frontend/finger/spi'

export interface PreviewLookupOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function bvidOf(value: string): string {
  return value.match(/(?:^|\/)(BV.{10})(?:[/?#]|$)/iu)?.[1] ?? ''
}

function biliHost(value: URL): boolean {
  return ['bilibili.com', 'www.bilibili.com', 'm.bilibili.com', 'b23.tv', 'bili2233.cn'].includes(value.hostname.toLowerCase())
}

function httpsUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return ''
  try {
    const url = new URL(value.trim())
    if (url.protocol === 'http:') url.protocol = 'https:'
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

async function fetchJson(url: string, fetchImpl: typeof fetch, timeoutMs: number, cookie = ''): Promise<Record<string, unknown> | undefined> {
  const response = await fetchImpl(url, {
    headers: {
      'user-agent': UA,
      referer: 'https://www.bilibili.com',
      ...cookie === '' ? {} : { cookie },
    },
    signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
  })
  if (!response.ok) return undefined
  const parsed: unknown = await response.json()
  return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined
}

async function finalVideoUrl(url: URL, fetchImpl: typeof fetch, timeoutMs: number): Promise<URL> {
  if (bvidOf(`${url.pathname}${url.search}`) !== '' || !['b23.tv', 'bili2233.cn'].includes(url.hostname.toLowerCase())) return url
  const response = await fetchImpl(url.toString(), {
    redirect: 'follow',
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
  })
  await response.body?.cancel().catch(() => {})
  return response.url === '' ? url : new URL(response.url)
}

/**
 * 查 B站视频封面；短链先跟随网页跳转，接口受风控时补设备标识重试一次。
 * @param address - 视频页或 b23 短链
 * @param options - 网络请求与超时
 * @returns HTTPS 封面地址；查不到时为空串
 */
export async function biliCardPreview(address: string, options: PreviewLookupOptions = {}): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 8000
  let page: URL
  try {
    page = new URL(address)
  } catch {
    return ''
  }
  if (!biliHost(page)) return ''

  let bvid = bvidOf(`${page.pathname}${page.search}`)
  if (bvid === '') {
    const finalUrl = await finalVideoUrl(page, fetchImpl, timeoutMs)
    bvid = bvidOf(`${finalUrl.pathname}${finalUrl.search}`)
  }
  if (bvid === '') return ''

  let cookie = ''
  try {
    const device = await fetchJson(DEVICE_API, fetchImpl, timeoutMs)
    const data = device?.data
    const buvid = data !== null && typeof data === 'object' ? (data as Record<string, unknown>).b_3 : undefined
    if (typeof buvid === 'string' && buvid !== '') cookie = `buvid3=${buvid}`
  } catch (error) {
    void error
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await fetchJson(`${VIDEO_API}?bvid=${encodeURIComponent(bvid)}`, fetchImpl, timeoutMs, cookie)
      const data = result?.data
      const preview = data !== null && typeof data === 'object'
        ? httpsUrl((data as Record<string, unknown>).pic)
        : ''
      if (preview !== '') return preview
    } catch (error) {
      if (attempt === 1) void error
    }
    if (attempt === 0 && cookie === '') {
      try {
        const device = await fetchJson(DEVICE_API, fetchImpl, timeoutMs)
        const data = device?.data
        const buvid = data !== null && typeof data === 'object' ? (data as Record<string, unknown>).b_3 : undefined
        if (typeof buvid === 'string' && buvid !== '') cookie = `buvid3=${buvid}`
      } catch (error) {
        void error
      }
    }
  }
  return ''
}

/**
 * 检查网关返回的 B站小程序 Ark 是否有客户端可渲染的预览。
 * @param card - 网关返回的 Ark
 * @returns 有 app、view、token 和 HTTPS 预览时为真
 */
export function hasRenderableBiliArk(card: unknown): boolean {
  if (card === null || typeof card !== 'object' || Array.isArray(card)) return false
  const top = card as Record<string, unknown>
  if (typeof top.app !== 'string' || top.app === '' || typeof top.view !== 'string' || top.view === '') return false
  const config = top.config
  if (config === null || typeof config !== 'object') return false
  const token = (config as Record<string, unknown>).token
  if (typeof token !== 'string' || token === '') return false
  const meta = top.meta
  if (meta === null || typeof meta !== 'object') return false
  const detail = (meta as Record<string, unknown>).detail_1
  if (detail === null || typeof detail !== 'object') return false
  return httpsUrl((detail as Record<string, unknown>).preview) !== ''
}
