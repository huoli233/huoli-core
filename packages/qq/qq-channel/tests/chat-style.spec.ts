import { describe, expect, it } from 'vitest'
import { reduceChatPunctuation } from '../src/chat-style.ts'

describe('聊天收口：链接', () => {
  const video = 'https://www.bilibili.com/video/BV1wtW46GEkT'

  it('群聊里裸链接整段剥掉，只留描述', () => {
    expect(reduceChatPunctuation(`这个好看 ${video} 你看看`)).toBe('这个好看你看看')
    expect(reduceChatPunctuation('推荐 https://b23.tv/abc123')).toBe('推荐')
  })

  it('私聊里 B站视频链接原样保留', () => {
    expect(reduceChatPunctuation(`这个好看 ${video} 你看看`, { keepBiliLinks: true }))
      .toBe(`这个好看 ${video} 你看看`)
    expect(reduceChatPunctuation('推荐 https://b23.tv/abc123', { keepBiliLinks: true }))
      .toBe('推荐 https://b23.tv/abc123')
  })

  it('私聊里 markdown 链接只留描述和地址，别的网址照样剥掉', () => {
    expect(reduceChatPunctuation(`[这个视频](${video})`, { keepBiliLinks: true }))
      .toBe(`这个视频 ${video}`)
    expect(reduceChatPunctuation(`看看 https://example.com/a 和 ${video}`, { keepBiliLinks: true }))
      .toBe(`看看和 ${video}`)
  })

  it('默认保留标点：模型想写逗号句号就让它写', () => {
    expect(reduceChatPunctuation(`这个，好看 ${video}`, { keepBiliLinks: true }))
      .toBe(`这个，好看 ${video}`)
  })

  it('旧配置也只收敛重复标点，不把正常标点删光', () => {
    expect(reduceChatPunctuation(`这个，好看 ${video}`, { keepBiliLinks: true, stripWrittenPunctuation: true }))
      .toBe(`这个，好看 ${video}`)
  })

  it('连续重复的同类标点只留一个', () => {
    expect(reduceChatPunctuation('真的吗，，这个，，，我不信。。')).toBe('真的吗，这个，我不信。')
  })
})
