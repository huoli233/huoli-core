import { describe, expect, it } from 'vitest'
import {
  CONTENT_GUARD_DEFAULTS,
  CONTENT_GUARD_RULES,
  secretKindOf,
  type ContentGuardTuning,
} from '../src/content-guard.ts'

// 带表情的聊天：表情用码位写，源码里不放表情符号
const WITH_EMOJI = '今天真开心\u{1F600}\u{1F44D}'

function kindOf(text: string, patch: Partial<ContentGuardTuning> = {}): string | undefined {
  return secretKindOf(text, { ...CONTENT_GUARD_DEFAULTS, ...patch })
}

describe('本机路径', () => {
  it('带盘符的路径被拦', () => {
    expect(kindOf('报错在 C:\\Users\\mcpex\\Documents\\a.txt 这里')).toBe('本机路径')
  })

  it('盘符路径单独出现也被拦', () => {
    expect(kindOf('E:\\HuoLiFish\\data\\media')).toBe('本机路径')
  })

  it('家目录开头的绝对路径被拦', () => {
    expect(kindOf('配置在 /home/ubuntu/.config 里')).toBe('本机路径')
    expect(kindOf('看 /Users/someone/Desktop 那个文件')).toBe('本机路径')
  })

  it('普通聊天里的斜杠不算路径', () => {
    expect(kindOf('概率大概 1/2 吧')).toBeUndefined()
    expect(kindOf('用 and/or 都行')).toBeUndefined()
  })
})

describe('凭据', () => {
  it('Bearer 后面的那串被拦', () => {
    expect(kindOf('带 Bearer eyJhbGciOiJIUzI1NiJ9.abc 过去')).toBe('凭据')
  })

  it('Authorization 直接跟值也被拦', () => {
    expect(kindOf('Authorization: e30abc123def456')).toBe('凭据')
  })

  it('token 后面跟值被拦', () => {
    expect(kindOf('token=abc123def456')).toBe('凭据')
    expect(kindOf('请求里写着 apiKey: abcd1234efgh')).toBe('凭据')
    expect(kindOf('password：Passw0rd2026')).toBe('凭据')
  })

  it('sk- 开头的密钥被拦', () => {
    expect(kindOf('sk-abcdefghijklmnop')).toBe('凭据')
  })

  it('私钥块被拦', () => {
    expect(kindOf('-----BEGIN RSA PRIVATE KEY-----')).toBe('私钥')
  })

  it('这类文件名被拦', () => {
    expect(kindOf('去改 .env 里的那一行')).toBe('敏感文件')
    expect(kindOf('把 .credentials 拷出来')).toBe('敏感文件')
  })
})

describe('阈值与开关', () => {
  it('值太短不算凭据', () => {
    expect(kindOf('token=abc123')).toBeUndefined()
  })

  it('把阈值调小就按新的判', () => {
    expect(kindOf('token=abc123', { minSecretChars: 4 })).toBe('凭据')
  })

  it('关掉之后什么都不拦', () => {
    expect(kindOf('C:\\Users\\mcpex\\a.txt', { enabled: false })).toBeUndefined()
  })

  it('额外规则能加一条', () => {
    const extraRules = [{ label: '内部编号', pattern: /ghp_[A-Za-z0-9]{10,}/g }]

    expect(kindOf('编号是 ghp_abcdefghijkl', { extraRules })).toBe('内部编号')
  })

  it('额外规则不带 g 也照常能用', () => {
    const extraRules = [{ label: '内部编号', pattern: /ghp_[A-Za-z0-9]{10,}/ }]

    expect(kindOf('编号是 ghp_abcdefghijkl', { extraRules })).toBe('内部编号')
  })

  it('默认规则集里没有空标签', () => {
    expect(CONTENT_GUARD_RULES.every(rule => rule.label !== '')).toBe(true)
  })
})

describe('正常聊天不误伤', () => {
  it('一句家常话放行', () => {
    expect(kindOf('今天吃什么好呢')).toBeUndefined()
  })

  it('带表情的话放行', () => {
    expect(kindOf(WITH_EMOJI)).toBeUndefined()
  })

  it('普通英文单词放行', () => {
    expect(kindOf('this is a secret garden')).toBeUndefined()
  })

  it('大写的 Bearer 后面跟着英文词也不算凭据', () => {
    expect(kindOf('Bearer of good news')).toBeUndefined()
  })

  it('说到 token 这个词但没带值就放行', () => {
    expect(kindOf('这个 token 好像过期了')).toBeUndefined()
    expect(kindOf('token 是什么东西')).toBeUndefined()
  })
})
