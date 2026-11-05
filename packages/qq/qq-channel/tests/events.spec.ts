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

  it('转发聊天记录留一个位置，不当成空消息', () => {
    expect(textOf([{ type: 'forward', data: { id: 'abc' } }])).toBe('[转发的聊天记录]')
    expect(textOf([{ type: 'forward', data: { id: 'abc' } }, { type: 'text', data: { text: '看看' } }]))
      .toBe('[转发的聊天记录]看看')
  })

  it('文件、语音、视频、卡片、表情包各有各的位置', () => {
    expect(textOf([{ type: 'file', data: { name: 'a.txt' } }])).toBe('[文件]')
    expect(textOf([{ type: 'record', data: {} }])).toBe('[语音]')
    expect(textOf([{ type: 'video', data: {} }])).toBe('[视频]')
    expect(textOf([{ type: 'json', data: { data: '{}' } }])).toBe('[卡片]')
    expect(textOf([{ type: 'mface', data: {} }])).toBe('[表情]')
  })

  it('认不出的段一律不编内容', () => {
    expect(textOf([{ type: 'shuffle', data: {} }])).toBe('')
    expect(textOf([{ type: 'text' }])).toBe('')
  })
})

describe('是不是一句话', () => {
  it('有字才算，只由位置拼出来的不算', () => {
    expect(hasWords('喝了水')).toBe(true)
    expect(hasWords('@小岸 你看这个[图片]')).toBe(true)
    expect(hasWords('[表情]')).toBe(false)
    expect(hasWords('[图片][表情]')).toBe(false)
  })

  it('转发记录与文件算有内容，不然她看不见群里发生过什么', () => {
    expect(hasWords('[转发的聊天记录]')).toBe(true)
    expect(hasWords('[文件]')).toBe(true)
    expect(hasWords('[图片][转发的聊天记录]')).toBe(true)
  })

  it('语音视频卡片仍然不算正文', () => {
    expect(hasWords('[语音][视频][卡片]')).toBe(false)
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

  it('回的是自己发过的编号才算回复自己', () => {
    expect(repliesToSelf([{ type: 'reply', data: { id: 'm-1' } }, { type: 'text', data: { text: '在吗' } }], '999', new Set(['m-1']))).toBe(true)
  })

  it('回复段只有号码没有编号时认不出来，不猜', () => {
    expect(repliesToSelf([{ type: 'reply', data: { user_id: '999' } }], '999', new Set(['m-1']))).toBe(false)
  })

  it('回的是别人的编号也不算', () => {
    expect(repliesToSelf([{ type: 'reply', data: { id: 'other' } }], '999', new Set(['m-1']))).toBe(false)
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
