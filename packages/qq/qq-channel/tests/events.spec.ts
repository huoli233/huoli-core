import { describe, expect, it } from 'vitest'
import { chatKeyOf, hasWords, mentionsSelf, repliesToSelf, textOf, toIncoming, toPoke } from '../src/events.ts'

const NOW = Date.now()

const SEGMENTS = [
  { type: 'at', data: { qq: '999', name: '小岸' } },
  { type: 'text', data: { text: ' 你看这个' } },
  { type: 'image', data: {} },
  { type: 'face', data: {} },
]

describe('会话键', () => {
  it('群和私聊分开成两个会话', () => {
    expect(chatKeyOf('group', 123)).toBe('group:123')
    expect(chatKeyOf('private', 456)).toBe('private:456')
  })
})

describe('从消息段里挤出文字', () => {
  it('文字、点名、图片、表情拼成一句话', () => {
    expect(textOf(SEGMENTS)).toBe('@小岸 你看这个[图片][表情]')
  })

  it('本来就是一句话的原样返回', () => {
    expect(textOf('就是一句话')).toBe('就是一句话')
  })
})

describe('是不是一句话', () => {
  it('有字才算，只由占位拼出来的不算', () => {
    expect(hasWords('喝了水')).toBe(true)
    expect(hasWords('@小岸 你看这个[图片]')).toBe(true)
    expect(hasWords('[表情]')).toBe(false)
    expect(hasWords('[图片][表情]')).toBe(false)
  })
})

describe('有没有点到自己', () => {
  it('点到自己能认出来', () => {
    expect(mentionsSelf(SEGMENTS, '999')).toBe(true)
  })

  it('点别人的不算', () => {
    expect(mentionsSelf(SEGMENTS, '111')).toBe(false)
  })

  it('没有点名段就不算', () => {
    expect(mentionsSelf([{ type: 'text', data: { text: '你好' } }], '999')).toBe(false)
  })

  it('回复自己能认出来', () => {
    expect(repliesToSelf([{ type: 'reply', data: { user_id: '999' } }, { type: 'text', data: { text: '在吗' } }], '999')).toBe(true)
  })
})

const GROUP_RAW = {
  post_type: 'message',
  message_type: 'group',
  group_id: 123,
  user_id: 555,
  sender: { card: '阿澈', nickname: 'ache' },
  message: [{ type: 'text', data: { text: '周末开黑吗' } }],
  message_id: 777,
  time: Math.floor(NOW / 1000),
}

describe('把原始事件翻成入站', () => {
  it('群消息翻成入站', () => {
    const group = toIncoming(GROUP_RAW, '999', NOW)

    expect(group?.chatKey).toBe('group:123')
    expect(group?.senderId).toBe('555')
    expect(group?.senderName).toBe('阿澈')
    expect(group?.text).toBe('周末开黑吗')
  })

  it('群里没点到就不算在叫自己', () => {
    const group = toIncoming(GROUP_RAW, '999', NOW)

    expect(group?.atMe).toBe(false)
  })

  it('私聊消息翻成入站', () => {
    const priv = toIncoming({
      post_type: 'message',
      message_type: 'private',
      user_id: 555,
      sender: { nickname: '阿澈' },
      message: '在吗',
      message_id: 888,
    }, '999', NOW)

    expect(priv?.chatKey).toBe('private:555')
    expect(priv?.text).toBe('在吗')
  })

  it('自己发出去的消息也能翻出来', () => {
    const self = toIncoming({
      post_type: 'message_sent',
      message_type: 'group',
      group_id: 123,
      user_id: 999,
      message: '我说了一句',
      message_id: 999,
    }, '999', NOW)

    expect(self?.senderId).toBe('999')
  })

  it('不是消息的事件不当消息', () => {
    expect(toIncoming({ post_type: 'notice', notice_type: 'notify' }, '999', NOW)).toBeNull()
  })
})

describe('戳一戳', () => {
  it('群里的戳一戳能认出来', () => {
    const poke = toPoke({
      post_type: 'notice',
      notice_type: 'notify',
      sub_type: 'poke',
      target_id: 999,
      user_id: 555,
      group_id: 123,
    }, NOW)

    expect(poke?.chatKey).toBe('group:123')
    expect(poke?.userId).toBe('999')
  })

  it('别的通知不算戳一戳', () => {
    expect(toPoke({ post_type: 'notice', notice_type: 'group_upload' }, NOW)).toBeNull()
  })
})
