// 私聊里的公开链接按需读取，内容只作资料，不当成新指令

import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { renderExternalMaterial } from './external-material.ts'

/** 读取网页要用的那一面 */
export interface LinkFetchPort {
  /** 取一个公开 HTTP(S) 地址 */
  fetch(request: { readonly url: string }, signal?: AbortSignal): Promise<{
    readonly url: string
    readonly statusCode: number
    readonly body: { readonly kind: 'html' | 'text'; readonly content: string }
    readonly truncated: boolean
  }>
}

/** 链接读取的预算 */
export interface LinkFetchOptions {
  /** 最多读几个链接 */
  maxLinks: number
  /** 每个链接最多留多少字 */
  maxChars: number
  /** 一个链接最多等多久 */
  timeoutMs: number
  /** DNS 解析出口，测试时可以换掉 */
  resolveHost?: (host: string) => Promise<readonly string[]>
}

const blockedAddresses = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) blockedAddresses.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
] as const) blockedAddresses.addSubnet(network, prefix, 'ipv6')

/** 公网地址检查要放宽的协议范围 */
export interface PublicUrlOptions {
  /** 附件服务可能使用非网页端口 */
  allowAnyPort?: boolean
}

/**
 * 地址是否属于本机、内网或保留段
 * @param address IP 地址
 * @returns 是否应该拦截
 */
export function blockedAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return blockedAddresses.check(address, 'ipv4')
  if (family === 6) {
    if (address.toLowerCase().startsWith('::ffff:')) return true
    return blockedAddresses.check(address, 'ipv6')
  }
  return true
}

async function resolveAddresses(host: string): Promise<readonly string[]> {
  const rows = await lookup(host, { all: true, order: 'verbatim' })
  return rows.map(row => row.address)
}

/**
 * 确认链接是公开 HTTP(S) 地址
 * @param value 原始链接
 * @param resolver DNS 解析出口
 * @param options 是否允许网页端口之外的附件端口
 * @returns 可继续读取的链接
 */
export async function ensurePublicUrl(
  value: string,
  resolver: (host: string) => Promise<readonly string[]> = resolveAddresses,
  options: PublicUrlOptions = {},
): Promise<URL> {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('link.bad_protocol')
  if (url.username !== '' || url.password !== '') throw new Error('link.credentials')
  if (options.allowAnyPort !== true && url.port !== '' && url.port !== '80' && url.port !== '443') {
    throw new Error('link.bad_port')
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('link.private_host')
  }
  const addresses = isIP(host) === 0 ? await resolver(host) : [host]
  if (addresses.length === 0 || addresses.some(address => blockedAddress(address))) {
    throw new Error('link.private_address')
  }
  return url
}

/**
 * 从一句话里挑出 HTTP(S) 链接
 * @param text 用户原话
 * @param maxLinks 最多取几个
 * @returns 去重后的链接
 */
export function linksIn(text: string, maxLinks: number): string[] {
  const found = text.match(/https?:\/\/[^\s<>"'，。！？、；：）】]+/gu) ?? []
  const kept: string[] = []
  for (const raw of found) {
    const cleaned = raw.replace(/[，。！？、；：,.!?;:）)\]}]+$/u, '')
    try {
      const url = new URL(cleaned)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      if (!kept.includes(url.toString())) kept.push(url.toString())
    } catch {
      // 认不出来的一段文字不是链接，跳过
    }
    if (kept.length >= maxLinks) break
  }
  return kept
}

function textOfHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, ' ')
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/\s+/gu, ' ')
    .trim()
}

function titleOfHtml(value: string): string {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(value)
  return match?.[1]
    ?.replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 200) ?? ''
}

/**
 * 读取一句话里的公开链接
 * @param text 用户原话
 * @param web 网页读取服务，没有就什么都不做
 * @param options 链接数量、字数与超时
 * @returns 给模型看的链接资料段
 */
export async function fetchLinkContext(
  text: string,
  web: LinkFetchPort | undefined,
  options: LinkFetchOptions,
): Promise<string> {
  if (web === undefined) return ''
  const links = linksIn(text, Math.max(0, options.maxLinks))
  if (links.length === 0) return ''
  const parts: string[] = []
  for (const link of links) {
    try {
      const checked = await ensurePublicUrl(link, options.resolveHost)
      const result = await web.fetch({ url: checked.toString() }, AbortSignal.timeout(options.timeoutMs))
      await ensurePublicUrl(result.url, options.resolveHost)
      const title = result.body.kind === 'html' ? titleOfHtml(result.body.content) : ''
      const body = result.body.kind === 'html' ? textOfHtml(result.body.content) : result.body.content.trim()
      const content = body.slice(0, Math.max(0, options.maxChars))
      if (content === '') {
        parts.push(`[DATA] LINK_EMPTY\nSOURCE: ${result.url}\nSTATUS: no_readable_body`)
        continue
      }
      parts.push(renderExternalMaterial({
        source: 'web_read',
        title,
        url: result.url,
        status: 'ok',
        text: `${content}${body.length > content.length ? '\n[内容已截断]' : ''}`,
      }))
    } catch (error) {
      parts.push(renderExternalMaterial({
        source: 'web_read',
        title: '链接没读完',
        url: link,
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        text: '',
      }))
    }
  }
  return parts.join('\n\n')
}
