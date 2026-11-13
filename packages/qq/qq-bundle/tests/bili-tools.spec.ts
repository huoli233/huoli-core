// 群里丢了 B站链接，这些工具必须真在那一轮的工具表里，否则她只能看着链接干瞪眼
import { describe, expect, it } from 'vitest'
import { chatToolAllowed } from '../src/tool-whitelist.ts'

const BILI = ['bili_find', 'bili_look', 'bili_look_zoom', 'bili_comments', 'bili_feed', 'bili_surf', 'bili_inbox'] as const

describe('群里刷站与看视频的工具', () => {
  it('群聊里七个都在，不然丢了链接也看不起来', () => {
    const missing = BILI.filter(name => !chatToolAllowed(name, 'autonomous', 'group:1', []))
    expect(missing).toEqual([])
  })

  it('私聊里七个也都在', () => {
    const missing = BILI.filter(name => !chatToolAllowed(name, 'autonomous', 'private:1', []))
    expect(missing).toEqual([])
  })

  it('换成别的互动模式也照样放行', () => {
    for (const mode of ['probability', 'heartflow'] as const) {
      const missing = BILI.filter(name => !chatToolAllowed(name, mode, 'group:1', []))
      expect(missing).toEqual([])
    }
  })
})
