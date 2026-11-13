import { describe, expect, it } from 'vitest'
import { attachmentsOf, chatKeyOf, hasWords, mentionsSelf, repliesToSelf, textOf, toGroupMute, toIncoming, toPoke, toRecall } from '../src/events.ts'

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
    expect(textOf([{ type: 'forward', data: { id: 'abc' } }])).toBe('[转发的聊天记录:abc]')
    expect(textOf([{ type: 'forward', data: { id: 'abc' } }, { type: 'text', data: { text: '看看' } }]))
      .toBe('[转发的聊天记录:abc]看看')
  })

  it('文件、语音、视频、卡片、表情包各有各的位置', () => {
    expect(textOf([{ type: 'file', data: { name: 'a.txt' } }])).toBe('[文件:a.txt]')
    expect(textOf([{ type: 'record', data: {} }])).toBe('[语音]')
    expect(textOf([{ type: 'video', data: {} }])).toBe('[视频]')
    expect(textOf([{ type: 'json', data: { data: '{}' } }])).toBe('[卡片]')
    expect(textOf([{ type: 'mface', data: {} }])).toBe('[表情]')
  })

  it('文件消息保留压缩包名字，内部地址不冒充文件名', () => {
    expect(textOf([
      { type: 'file', data: { name: '修复了ai不会拉屎的bug (1).zip' } },
      { type: 'file', data: { name: '月经插件-v1.4.0.zip' } },
      { type: 'file', data: { name: '拉屎插件DLC——搭伙与擦屁股.zip' } },
      { type: 'file', data: { file_name: '拉屎插件扩展（会憋不住）.zip' } },
      { type: 'file', data: { name: '拉屎插件——羞愧值扩展.zip' } },
      { type: 'file', data: { file: 'https://cdn.test/private-file' } },
      { type: 'file', data: { file: '0123456789abcdef0123456789abcdef' } },
    ])).toBe('[文件:修复了ai不会拉屎的bug (1).zip][文件:月经插件-v1.4.0.zip][文件:拉屎插件DLC——搭伙与擦屁股.zip][文件:拉屎插件扩展（会憋不住）.zip][文件:拉屎插件——羞愧值扩展.zip][文件][文件]')
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
    expect(hasWords('[图片][表情]')).toBe(true)
  })

  it('转发记录与文件算有内容，不然她看不见群里发生过什么', () => {
    expect(hasWords('[转发的聊天记录:abc]')).toBe(true)
    expect(hasWords('[文件]')).toBe(true)
    expect(hasWords('[图片][转发的聊天记录:abc]')).toBe(true)
  })

  it('图片、语音、视频和卡片都算有内容，别让群里分享的卡片被当成空消息', () => {
    expect(hasWords('[语音][视频]')).toBe(true)
    expect(hasWords('[卡片]')).toBe(true)
  })
})

describe('消息里的附件', () => {
  it('按顺序留下图片、视频、语音和文件的可下载地址', () => {
    expect(attachmentsOf([
      { type: 'image', data: { url: 'https://a.test/a.png', name: 'a.png', mime_type: 'image/png' } },
      { type: 'video', data: { file: 'https://a.test/b.mp4' } },
      { type: 'record', data: { url: 'https://a.test/c.amr' } },
      { type: 'file', data: { url: 'https://a.test/d.pdf', name: '说明.pdf' } },
    ])).toEqual([
      { kind: 'image', url: 'https://a.test/a.png', name: 'a.png', mediaType: 'image/png' },
      { kind: 'video', url: 'https://a.test/b.mp4', name: 'https://a.test/b.mp4', mediaType: '' },
      { kind: 'record', url: 'https://a.test/c.amr', name: '', mediaType: '' },
      { kind: 'file', url: 'https://a.test/d.pdf', name: '说明.pdf', mediaType: '' },
    ])
  })

  it('只按 QQ 消息段的结构标记保留表情包身份', () => {
    expect(attachmentsOf([
      { type: 'image', data: { url: 'https://a.test/a.gif', name: 'a.gif' } },
      { type: 'image', data: { url: 'https://a.test/b.png', is_sticker: true } },
      { type: 'mface', data: { url: 'https://a.test/c.png', emoji_id: 'face-1' } },
      { type: 'mface', data: { emoji_id: 'face-2' } },
    ])).toEqual([
      { kind: 'image', url: 'https://a.test/a.gif', name: 'a.gif', mediaType: '' },
      { kind: 'image', url: 'https://a.test/b.png', name: '', mediaType: '', sticker: true },
      { kind: 'image', url: 'https://a.test/c.png', name: '', mediaType: '', sticker: true },
    ])
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

  it('图片消息也带出附件并算作有内容', () => {
    const image = toIncoming({
      post_type: 'message',
      message_type: 'private',
      user_id: 555,
      sender: { nickname: '阿澈' },
      message: [{ type: 'image', data: { url: 'https://a.test/a.png' } }],
      message_id: 889,
    }, '999', NOW)

    expect(image?.attachments).toEqual([{ kind: 'image', url: 'https://a.test/a.png', name: '', mediaType: '' }])
    expect(image?.text).toBe('[图片]')
    expect(image === null ? false : hasWords(image.text)).toBe(true)
  })

  it('把真实正文与图片占位符分开保留', () => {
    const received = toIncoming({
      post_type: 'message',
      message_type: 'group',
      group_id: 123,
      user_id: 555,
      sender: { nickname: '阿澈' },
      message: [
        { type: 'text', data: { text: '这个报错怎么处理' } },
        { type: 'image', data: { url: 'https://a.test/error.png' } },
      ],
      message_id: 890,
    }, '999', NOW)

    expect(received?.text).toBe('这个报错怎么处理[图片]')
    expect(received?.bodyText).toBe('这个报错怎么处理')
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

  it('无法确认消息类型时不猜成私聊', () => {
    expect(toIncoming({ post_type: 'message', message_type: 'other', user_id: 555, message: '你好' }, '999', NOW)).toBeNull()
    expect(toIncoming({ post_type: 'message', user_id: 555, message: '你好' }, '999', NOW)).toBeNull()
  })
})

describe('戳一戳', () => {
  it('群里 notify 加 poke 的写法能认出来', () => {
    const poke = toPoke({
      post_type: 'notice',
      notice_type: 'notify',
      sub_type: 'poke',
      target_id: 999,
      user_id: 555,
      group_id: 123,
    }, NOW, '999')

    expect(poke?.chatKey).toBe('group:123')
    expect(poke?.userId).toBe('555')
  })

  it('notice_type 直接写 poke 的写法也能认出来', () => {
    const poke = toPoke({
      post_type: 'notice',
      notice_type: 'poke',
      target_id: 999,
      user_id: 555,
      group_id: 123,
    }, NOW, '999')

    expect(poke?.chatKey).toBe('group:123')
    expect(poke?.userId).toBe('555')
  })

  it('两个编号写反时认出对方', () => {
    const poke = toPoke({
      post_type: 'notice',
      notice_type: 'notify',
      sub_type: 'poke',
      target_id: 555,
      user_id: 999,
      group_id: 123,
    }, NOW, '999')

    expect(poke?.chatKey).toBe('group:123')
    expect(poke?.userId).toBe('555')
  })

  it('缺 target_id 但 user_id 是自己也认出来', () => {
    const poke = toPoke({
      post_type: 'notice',
      notice_type: 'poke',
      user_id: 999,
      group_id: 123,
    }, NOW, '999')

    expect(poke?.chatKey).toBe('group:123')
  })

  it('没填自己的号就不核对被戳的人', () => {
    const poke = toPoke({
      post_type: 'notice',
      notice_type: 'notify',
      sub_type: 'poke',
      target_id: 777,
      user_id: 555,
    }, NOW)

    expect(poke?.chatKey).toBe('private:555')
    expect(poke?.userId).toBe('555')
  })

  it('被戳的不是自己就丢掉', () => {
    expect(toPoke({
      post_type: 'notice',
      notice_type: 'notify',
      sub_type: 'poke',
      target_id: 777,
      user_id: 555,
      group_id: 123,
    }, NOW, '999')).toBeNull()
  })

  it('别的通知不算戳一戳', () => {
    expect(toPoke({ post_type: 'notice', notice_type: 'group_upload' }, NOW, '999')).toBeNull()
    expect(toPoke({ post_type: 'notice', notice_type: 'notify', sub_type: 'other', target_id: 999 }, NOW, '999')).toBeNull()
    expect(toPoke({ post_type: 'message', notice_type: 'poke', target_id: 999, user_id: 555 }, NOW, '999')).toBeNull()
  })
})

describe('撤回通知', () => {
  it('群里撤回保留原发送者与实际操作者', () => {
    expect(toRecall({
      post_type: 'notice', notice_type: 'group_recall', group_id: 123,
      user_id: 555, operator_id: 777, message_id: 901,
    }, '999', NOW)).toEqual({
      chatKey: 'group:123',
      senderId: '555',
      operatorId: '777',
      messageId: '901',
      at: NOW,
      selfMessage: false,
      bySelf: false,
    })
  })

  it('私聊撤回和机器人自己撤回能分开', () => {
    expect(toRecall({
      post_type: 'notice', notice_type: 'friend_recall', user_id: 555, message_id: 902,
    }, '999', NOW)).toMatchObject({ chatKey: 'private:555', bySelf: false })
    expect(toRecall({
      post_type: 'notice', notice_type: 'group_recall', group_id: 123,
      user_id: 999, operator_id: 999, message_id: 903,
    }, '999', NOW)).toMatchObject({ chatKey: 'group:123', selfMessage: true, bySelf: true })
  })

  it('缺群号或不是撤回的通知不猜', () => {
    expect(toRecall({ post_type: 'notice', notice_type: 'group_recall', message_id: 904 }, '999', NOW)).toBeNull()
    expect(toRecall({ post_type: 'notice', notice_type: 'group_upload', group_id: 123 }, '999', NOW)).toBeNull()
  })
})

describe('群禁言', () => {
  it('只认机器人自己被禁言，并按秒算到解除时刻', () => {
    const mute = toGroupMute({
      post_type: 'notice',
      notice_type: 'group_ban',
      sub_type: 'ban',
      group_id: 123,
      user_id: 999,
      operator_id: 555,
      duration: 90,
    }, '999', NOW)

    expect(mute).toMatchObject({ chatKey: 'group:123', muted: true, until: NOW + 90_000, operatorId: '555' })
  })

  it('别人被禁言不影响机器人', () => {
    expect(toGroupMute({
      post_type: 'notice', notice_type: 'group_ban', sub_type: 'ban', group_id: 123, user_id: 555, duration: 90,
    }, '999', NOW)).toBeNull()
  })

  it('解除禁言是一条解除事实', () => {
    expect(toGroupMute({
      post_type: 'notice', notice_type: 'group_ban', sub_type: 'lift_ban', group_id: 123, user_id: 999,
    }, '999', NOW)).toMatchObject({ chatKey: 'group:123', muted: false, until: NOW })
  })
})
