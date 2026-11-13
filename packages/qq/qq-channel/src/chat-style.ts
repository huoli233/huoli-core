// 聊天发送前收口：清掉 markdown 和链接，标点交给模型自己决定

// 只把连着重复的同类标点收成一个，不把整句标点删光
const REPEATED_WRITTEN_PUNCTUATION = /([，,、；;：:。])\1+/gu
// 只含英文数字的括号是引用来源，不是颜文字，整段去掉
const CITATION_PAREN = /[（(][A-Za-z0-9.\s/:_-]*[）)]/gu
// QQ 不认 markdown，链接只留文字
const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)\s]+)\)/gu
// 聊天里不贴裸链接，只留描述
const BARE_URL = /https?:\/\/[^\s，。；：、）)】」]+/gu
// 私聊里允许原样保留的 B站视频链接；群聊仍然一律不贴
const BILI_URL = /^https?:\/\/(?:www\.|m\.)?bilibili\.com\/video\/|^https?:\/\/b23\.tv\/|^https?:\/\/bili2233\.cn\//iu

// 中文之间的空格是模型替逗号留下的痕迹，收口时整段去掉；英文数字之间的空格保留
const CHINESE_GAP = /(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu

export interface ChatStyleOptions {
  /** 私聊场景：原样保留 B站视频链接，其它网址照旧剥掉 */
  keepBiliLinks?: boolean
  /** 兼容旧配置；现在只收敛连续重复标点，不再删除正常标点 */
  stripWrittenPunctuation?: boolean
}

/**
 * 收敛重复标点、markdown、链接与中文之间的空格，保留模型写出的单只标点。
 * @param text - 已经去掉旁白的正文
 * @param options - 私聊可以保留 B站视频链接，其余场景一律不贴
 * @returns 逐行保留的正文
 */
export function reduceChatPunctuation(text: string, options: ChatStyleOptions = {}): string {
  const keepBili = options.keepBiliLinks === true
  const lines = text.replace(/\r\n?/gu, '\n').split('\n')
  const kept: string[] = []
  for (const line of lines) {
    let trimmed = line.trim()
    if (trimmed === '') continue
    // 先剥链接，后面才能按普通聊天收标点；私聊把 B站链接换成占位符，免得被标点收口切坏
    const links: string[] = []
    if (keepBili) {
      trimmed = trimmed
        .replace(MARKDOWN_LINK, (_whole, label: string, url: string) => {
          if (!BILI_URL.test(url)) return label.trim()
          links.push(url)
          return label.trim() === '' ? `\u0000${links.length - 1}\u0000` : `${label.trim()} \u0000${links.length - 1}\u0000`
        })
        .replace(BARE_URL, (url: string) => {
          if (!BILI_URL.test(url)) return ''
          links.push(url)
          return `\u0000${links.length - 1}\u0000`
        })
    } else {
      trimmed = trimmed
        .replace(MARKDOWN_LINK, (_whole, label: string, url: string) => label.trim() === '' ? url : label.trim())
        .replace(BARE_URL, '')
    }
    trimmed = trimmed
      .replace(CITATION_PAREN, '')
      .replace(CHINESE_GAP, '')
      .replace(REPEATED_WRITTEN_PUNCTUATION, '$1')
      .replace(/\s{2,}/gu, ' ')
      .trim()
    void options.stripWrittenPunctuation
    if (keepBili) trimmed = trimmed.replace(/\u0000(\d+)\u0000/gu, (_whole, index: string) => links[Number(index)] ?? '')
    if (trimmed === '') continue
    kept.push(trimmed)
  }
  return kept.join('\n').trim()
}

/**
 * 判断一段正文是不是纯标点刷屏：单个标点算语气，三个以上才算刷屏。
 * @param text - 已经收口过的正文
 * @returns 是刷屏时返回真
 */
export function isPunctuationSpam(text: string): boolean {
  if (!/^[?？!！。…~～，,、；;：:\s]+$/u.test(text)) return false
  return Array.from(text).filter(char => /[?？!！。…~～，,、；;：:]/u.test(char)).length > 2
}
