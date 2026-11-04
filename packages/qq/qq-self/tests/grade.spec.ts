import { describe, expect, it } from 'vitest'
import { judgePostLevel, POST_LEVELS } from '../src/index.ts'

describe('动态的级别', () => {
  it('例行那一级直接放行，不要钥匙', () => {
    const decision = judgePostLevel({ level: 'routine', userOk: false, selfOk: false })

    expect(decision.ok).toBe(true)
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
