import { describe, expect, it } from 'vitest'
import { COMPACT_REPLY_MIND_PARAMETER, finalTextOf, hideAccountInText, isBareReply, REPLY_MIND_PARAMETER, replyMindOf } from '../src/final-text.ts'

describe('最终正文', () => {
  it('主人账号绝不会进入最终消息', () => {
    expect(hideAccountInText('主人是 123456，别再说号码', '123456')).toBe('主人是 主人，别再说号码')
    expect(hideAccountInText('普通正文', '')).toBe('普通正文')
  })
  it('整段只有括号旁白时不发', () => {
    expect(finalTextOf('（不理。）')).toBe('')
    expect(finalTextOf('(先缓一下)\n【等会儿再说】')).toBe('')
  })

  it('旁白和正文混在一起时只留正文', () => {
    expect(finalTextOf('（先看了眼消息）\n我还在，你说。')).toBe('我还在，你说。')
    expect(finalTextOf('（笑）好啊')).toBe('好啊')
  })

  it('颜文字不当旁白删掉', () => {
    expect(finalTextOf('（≧▽≦）')).toBe('（≧▽≦）')
    expect(finalTextOf('(｡•́︿•̀｡)')).toBe('(｡•́︿•̀｡)')
    expect(finalTextOf('（≧▽≦）好啊')).toBe('（≧▽≦）好啊')
    expect(finalTextOf('先缓一下 (＞﹏＜)')).toBe('先缓一下 (＞﹏＜)')
  })

  it('状态行和内心行不混进正文', () => {
    expect(finalTextOf('内心：其实有点生气\n正文：没有不理你')).toBe('没有不理你')
    expect(finalTextOf('发送状态：已发送\n等我一下')).toBe('等我一下')
  })

  it('标点是模型的选择，写不写都原样保留', () => {
    expect(finalTextOf('我还在，你说。')).toBe('我还在，你说。')
    expect(finalTextOf('真的吗？？？')).toBe('真的吗？？')
    expect(finalTextOf('就这？')).toBe('就这？')
    expect(finalTextOf('真的假的！！！')).toBe('真的假的！！')
    expect(finalTextOf('等等……')).toBe('等等……')
    expect(finalTextOf('好')).toBe('好')
    expect(finalTextOf('？？？')).toBe('？？？')
  })

  it('单独问号仍算一条回复，但发不发由下游判断', () => {
    expect(finalTextOf('？')).toBe('？')
    expect(finalTextOf('？\n你真的不理我了？')).toBe('？\n你真的不理我了？')
    expect(finalTextOf('！！！')).toBe('！！！')
  })

  it('没打完的拼音算一条真实回复，不被空应声拦掉', () => {
    expect(isBareReply('wo xian qu')).toBe(false)
    expect(isBareReply('pe')).toBe(false)
    expect(isBareReply('嗯')).toBe(true)
  })

  it('模型写成多行时逐行保留，交给分段发送', () => {
    expect(finalTextOf('第一句。\n第二句，补充。')).toBe('第一句。\n第二句，补充。')
    expect(finalTextOf('啊\n等下\n好')).toBe('啊\n等下\n好')
  })

  it('网址和代码里的标点不动', () => {
    expect(finalTextOf('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(finalTextOf('`foo()`')).toBe('`foo()`')
  })

  it('普通聊天里的标点原样保留', () => {
    expect(finalTextOf('唔，我大概 07:04 醒。')).toBe('唔，我大概 07:04 醒。')
  })
})

describe('本轮想法', () => {
  it('发送工具只带紧凑说明，不重复完整字段表', () => {
    const serialized = JSON.stringify(COMPACT_REPLY_MIND_PARAMETER)

    expect(serialized.length).toBeLessThan(1200)
    expect(COMPACT_REPLY_MIND_PARAMETER.description).toContain('evidence')
    expect(COMPACT_REPLY_MIND_PARAMETER.additionalProperties).toBe(true)
  })

  it('高把握情绪证据必须来自当前说话人的原话', () => {
    expect(REPLY_MIND_PARAMETER.properties.affect.properties.evidence.description)
      .toContain('当前说话人最近消息中逐字摘短句')
    expect(REPLY_MIND_PARAMETER.properties.affect.properties.evidence.description)
      .toContain('不要改写或编造')
  })

  it('可以把这一轮判成休息而不是继续开口', () => {
    expect(replyMindOf({
      move: 'rest',
      impulse: '还想接一句',
      counter: '身体已经很困，继续说会更累',
      choice: '收住，先休息',
    })?.move).toBe('rest')
  })

  it('读到为什么开口和下一步', () => {
    expect(replyMindOf({
      move: 'reply',
      reason: '对方在私聊里等我回话',
      focus: '那句为什么不理人',
      tone: '有点别扭但没真生气',
      target: 'robot',
      reading: '在问我为什么不理，不是转述',
      impulse: '想说她一直不理人',
      counter: '她可能只是在等我先解释',
      choice: '先接住问题，不把话说重',
      inner: '不想显得太黏，可也不想让她等',
      next: '下次先接住她问的那一句',
    })).toMatchObject({
      move: 'reply',
      reason: '对方在私聊里等我回话',
      focus: '那句为什么不理人',
      target: 'robot',
      reading: '在问我为什么不理，不是转述',
      impulse: '想说她一直不理人',
      counter: '她可能只是在等我先解释',
      choice: '先接住问题，不把话说重',
      inner: '不想显得太黏，可也不想让她等',
    })
  })

  it('空对象当没填', () => {
    expect(replyMindOf({})).toBeUndefined()
    expect(replyMindOf('不是对象')).toBeUndefined()
  })

  it('新开口理由也能读出来', () => {
    expect(replyMindOf({ move: 'short_ack', inner: '懒得展开' })?.move).toBe('short_ack')
    expect(replyMindOf({ move: 'cold_open', inner: '想自己起句话' })?.move).toBe('cold_open')
    expect(replyMindOf({ move: 'defend', inner: '先把人护住' })?.move).toBe('defend')
  })

  it('能留下对方这句话的目标、强弱和玩笑成分', () => {
    expect(replyMindOf({
      affect: {
        target: 'robot',
        emotions: ['委屈', '嘴硬'],
        valence: -0.4,
        relationalValence: 0.2,
        arousal: 0.7,
        intensity: 0.6,
        confidence: 0.8,
        playfulness: 0.9,
        hostility: 0.1,
        correction: 0.2,
        relationalConfidence: 0.9,
        irony: true,
        ironyUncertainty: 0.2,
        quotation: false,
        quotationUncertainty: 0.8,
        evidence: [{ messageId: 'm1', text: '你又没回我' }],
        explanation: '这句在追问刚才没接住的话',
      },
    })?.affect).toEqual({
      target: 'robot',
      emotions: ['委屈', '嘴硬'],
      valence: -0.4,
      relationalValence: 0.2,
      arousal: 0.7,
      intensity: 0.6,
      confidence: 0.8,
      playfulness: 0.9,
      hostility: 0.1,
      correction: 0.2,
      relationalConfidence: 0.9,
      irony: true,
      ironyUncertainty: 0.2,
      quotation: false,
      quotationUncertainty: 0.8,
      evidence: [{ messageId: 'm1', text: '你又没回我' }],
      explanation: '这句在追问刚才没接住的话',
    })
  })

  it('判读过界的数会夹回正常范围', () => {
    expect(replyMindOf({
      affect: {
        target: 'other',
        emotions: ['一', '二', '三', '四', '五', '六'],
        valence: -4,
        arousal: 3,
        confidence: 2,
        hostility: -1,
        ironyUncertainty: 4,
        quotationUncertainty: -2,
        relationalConfidence: 3,
      },
    })?.affect).toMatchObject({
      target: 'other',
      emotions: ['一', '二', '三', '四', '五'],
      valence: -1,
      arousal: 1,
      confidence: 1,
      hostility: 0,
      ironyUncertainty: 1,
      quotationUncertainty: 0,
      relationalConfidence: 1,
    })
  })

  it('能留下证据、自检、目的、话题和把握程度', () => {
    const mind = replyMindOf({
      goal: '先把误会接住',
      topic: '刚才没回消息',
      confidence: 0.7,
      review: '像自己，也答到了真正问的事',
      reflect: '刚才有点急着解释',
      waitMs: 3000,
      interrupt: '他还没说完，先不抢',
      cancel: '不再追问刚才那个话题',
      settle: '先让自己缓一下',
      affect: { evidence: [{ messageId: 'm2', text: '你是不是又不理我' }], explanation: '这是追问' },
    })

    expect(mind).toMatchObject({
      goal: '先把误会接住',
      topic: '刚才没回消息',
      confidence: 0.7,
      review: '像自己，也答到了真正问的事',
      reflect: '刚才有点急着解释',
      waitMs: 3000,
      interrupt: '他还没说完，先不抢',
      cancel: '不再追问刚才那个话题',
      settle: '先让自己缓一下',
    })
    expect(mind?.affect?.evidence).toEqual([{ messageId: 'm2', text: '你是不是又不理我' }])
    expect(mind?.affect?.explanation).toBe('这是追问')
  })
})
