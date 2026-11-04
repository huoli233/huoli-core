import { describe, expect, it } from 'vitest'
import { ACTION_KINDS, DEFAULTS, judgeComment, judgePostLevel, judgePrivate, POST_LEVELS, stageAllows } from '../src/index.ts'

describe('动态的级别', () => {
  const TOPICS = ['日常', '吃喝']

  it('例行那一级话题在清单里就放行，不要钥匙', () => {
    const decision = judgePostLevel({ level: 'routine', topic: '吃喝', topics: TOPICS, userOk: false, selfOk: false })

    expect(decision.ok).toBe(true)
  })

  it('例行动态没报话题就拒，码是 post.topic_required', () => {
    const decision = judgePostLevel({ level: 'routine', topics: TOPICS, userOk: false, selfOk: false })

    expect(decision.ok).toBe(false)
    expect(decision.code).toBe('post.topic_required')
    expect(decision.reason).toBeTruthy()
  })

  it('例行话题不在清单里就拒，码是 post.not_routine', () => {
    const decision = judgePostLevel({ level: 'routine', topic: '工作', topics: TOPICS, userOk: false, selfOk: false })

    expect(decision.code).toBe('post.not_routine')
    expect(decision.reason).toBeTruthy()
  })

  it('还没到能发的级别就拒，并给出码与原因', () => {
    const decision = judgePostLevel({ level: 'none', userOk: true, selfOk: true })

    expect(decision.ok).toBe(false)
    expect(decision.code).toBe('post.level')
    expect(decision.reason).toBeTruthy()
  })

  it('两张级别之外的写法一样拒', () => {
    expect(judgePostLevel({ level: 'identity', userOk: true, selfOk: true }).code).toBe('post.level')
    expect(POST_LEVELS).toEqual(['routine', 'public'])
  })
})

describe('公开那一级的钥匙', () => {
  it('两把都在才放行', () => {
    expect(judgePostLevel({ level: 'public', userOk: true, selfOk: true }).ok).toBe(true)
  })

  it('只有用户那把就拒，码是 post.needs_keys', () => {
    const decision = judgePostLevel({ level: 'public', userOk: true, selfOk: false })

    expect(decision.ok).toBe(false)
    expect(decision.code).toBe('post.needs_keys')
    expect(decision.reason).toBeTruthy()
  })

  it('只有她自己那把也拒', () => {
    const decision = judgePostLevel({ level: 'public', userOk: false, selfOk: true })

    expect(decision.code).toBe('post.needs_keys')
  })

  it('清单里没有这个名字也算没有钥匙', () => {
    const decision = judgePostLevel({ level: 'public', userOk: true, selfOk: true, actions: [] })

    expect(decision.code).toBe('post.needs_keys')
  })
})

describe('三类动作', () => {
  it('只有动态、评论、私信三类', () => {
    expect(ACTION_KINDS).toEqual(['post', 'comment', 'private'])
  })
})

describe('评论', () => {
  const TOPICS = ['日常', '吃喝']

  it('两把钥匙都在、话题在清单里就放行', () => {
    const decision = judgeComment({ topic: '吃喝', topics: TOPICS, userOk: true, selfOk: true })

    expect(decision.ok).toBe(true)
  })

  it('缺一把钥匙就拒，码是 comment.needs_keys', () => {
    const decision = judgeComment({ topic: '吃喝', topics: TOPICS, userOk: true, selfOk: false })

    expect(decision.ok).toBe(false)
    expect(decision.code).toBe('comment.needs_keys')
    expect(decision.reason).toBeTruthy()
  })

  it('没报话题就拒，码是 comment.topic_required', () => {
    const decision = judgeComment({ topics: TOPICS, userOk: true, selfOk: true })

    expect(decision.code).toBe('comment.topic_required')
    expect(decision.reason).toBeTruthy()
  })

  it('话题不在清单里就拒，码是 comment.topic_not_allowed', () => {
    const decision = judgeComment({ topic: '工作', topics: TOPICS, userOk: true, selfOk: true })

    expect(decision.code).toBe('comment.topic_not_allowed')
    expect(decision.reason).toBeTruthy()
  })

  it('清单换掉之后按新清单判', () => {
    expect(judgeComment({ topic: '工作', topics: ['工作'], userOk: true, selfOk: true }).ok).toBe(true)
  })
})

describe('私信', () => {
  const PEERS = ['u-1']

  it('P3 起、对面在名单里、两把钥匙都在就放行', () => {
    const decision = judgePrivate({ peer: 'u-1', allowPeers: PEERS, userOk: true, selfOk: true, stage: 'P3' })

    expect(decision.ok).toBe(true)
  })

  it('P0 到 P2 一律拒，两把钥匙都在也拒', () => {
    for (const stage of ['P0', 'P1', 'P2']) {
      const decision = judgePrivate({ peer: 'u-1', allowPeers: PEERS, userOk: true, selfOk: true, stage })

      expect(decision.ok).toBe(false)
      expect(decision.code).toBe('private.stage_blocked')
      expect(decision.reason).toBeTruthy()
    }
  })

  it('不报阶段就按默认值表里那一档判，默认拒', () => {
    const decision = judgePrivate({ peer: 'u-1', allowPeers: PEERS, userOk: true, selfOk: true })

    expect(decision.code).toBe('private.stage_blocked')
    expect(DEFAULTS.stage).toBe('P0')
    expect(DEFAULTS.privateMinStage).toBe('P3')
  })

  it('认不出的阶段按不到下限算', () => {
    const decision = judgePrivate({ peer: 'u-1', allowPeers: PEERS, userOk: true, selfOk: true, stage: 'P9' })

    expect(decision.code).toBe('private.stage_blocked')
  })

  it('名单外的人就拒，码是 private.peer_not_allowed', () => {
    const decision = judgePrivate({ peer: 'u-2', allowPeers: PEERS, userOk: true, selfOk: true, stage: 'P3' })

    expect(decision.code).toBe('private.peer_not_allowed')
    expect(decision.reason).toBeTruthy()
  })

  it('没写对象就拒，码是 private.peer_required', () => {
    const decision = judgePrivate({ allowPeers: PEERS, userOk: true, selfOk: true, stage: 'P3' })

    expect(decision.code).toBe('private.peer_required')
  })

  it('缺一把钥匙就拒，码是 private.needs_keys', () => {
    const decision = judgePrivate({ peer: 'u-1', allowPeers: PEERS, userOk: false, selfOk: true, stage: 'P3' })

    expect(decision.code).toBe('private.needs_keys')
    expect(decision.reason).toBeTruthy()
  })

  it('下限可以由参数抬到更后面的阶段', () => {
    const decision = judgePrivate({ peer: 'u-1', allowPeers: PEERS, userOk: true, selfOk: true, stage: 'P3', minStage: 'P4' })

    expect(decision.code).toBe('private.stage_blocked')
  })
})

describe('阶段先后', () => {
  it('按默认值表的次序比高低', () => {
    expect(stageAllows('P3', 'P3')).toBe(true)
    expect(stageAllows('P5a', 'P3')).toBe(true)
    expect(stageAllows('P2', 'P3')).toBe(false)
  })

  it('认不出的写法一律当成不到', () => {
    expect(stageAllows('P?', 'P3')).toBe(false)
    expect(stageAllows('P3', 'P?')).toBe(false)
  })
})
