import { describe, expect, it } from 'vitest'
import { redactedOf, redactSecrets } from '../src/redact.ts'

describe('凭证抹掉', () => {
  it('sk- 开头的那串换成星号', () => {
    expect(redactSecrets('我的 key 是 sk-abcdefghijklmnopqrstuvwx 别告诉别人'))
      .toBe('我的 key 是 sk-*** 别告诉别人')
  })

  it('Bearer 后面的那串也换掉', () => {
    expect(redactSecrets('请求头里带 Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6')).toContain('Bearer ***')
  })

  it('带标签的凭证连值一起换掉，标签留着', () => {
    expect(redactSecrets('token: abcdef123456')).toBe('token: ***')
    expect(redactSecrets('password=admin12345')).toBe('password: ***')
    expect(redactSecrets('api_key：sk-verylongvalue123456')).toBe('api_key: ***')
    expect(redactSecrets('cookie: session=abcdefgh')).toBe('cookie: ***')
  })
})

describe('长号码抹掉', () => {
  it('手机号十一位', () => {
    expect(redactSecrets('他手机 13812345678 你打一下')).toBe('他手机 *** 你打一下')
  })

  it('身份证十八位', () => {
    expect(redactSecrets('身份证 110101199003071234 记住了')).toBe('身份证 *** 记住了')
  })

  it('银行卡十六到十九位', () => {
    expect(redactSecrets('卡号 6222021234567890')).toBe('卡号 ***')
  })
})

describe('不该动的东西不动', () => {
  it('普通聊天原样返回', () => {
    const text = '今天有点累，周三一起去爬山吧，晚上吃米饭'
    expect(redactSecrets(text)).toBe(text)
  })

  it('短的当数字不当号码', () => {
    expect(redactSecrets('考了 95 分，2026 年')).toBe('考了 95 分，2026 年')
  })

  it('数字夹在文字里不算', () => {
    expect(redactSecrets('第 3 次了')).toBe('第 3 次了')
  })

  it('没东西要抹时 redactedOf 不给结果', () => {
    expect(redactedOf('今天有点累')).toBeUndefined()
    expect(redactedOf('token: abcdef123456')).toBe('token: ***')
  })
})
