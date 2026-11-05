import { describe, expect, it } from 'vitest'
import { canModerate, GROUP_ROLES, parseGroupRole, roleOfMember } from '../src/group-role.ts'

describe('群身份只有一处判', () => {
  it('三个真档位都认', () => {
    for (const role of GROUP_ROLES) {
      expect(parseGroupRole(role)).toEqual({ role, known: true })
    }
  })

  it('大小写与空格都能吃', () => {
    expect(parseGroupRole('  ADMIN ')).toEqual({ role: 'admin', known: true })
  })

  it('查不到就是不知道，不压成普通成员', () => {
    expect(parseGroupRole('')).toEqual({ role: 'unknown', known: false })
    expect(parseGroupRole(null)).toEqual({ role: 'unknown', known: false })
    expect(parseGroupRole('管理员')).toEqual({ role: 'unknown', known: false })
  })

  it('空壳成员信息一律算不知道，哪怕里面写着 member', () => {
    const shell = { nickname: '', card: '', join_time: 0, role: 'member' }

    expect(roleOfMember(shell)).toEqual({ role: 'unknown', known: false })
  })

  it('真有人的信息才按档位判', () => {
    expect(roleOfMember({ nickname: '小鱼', join_time: 1700000000, role: 'admin' })).toEqual({ role: 'admin', known: true })
    expect(roleOfMember({ nickname: '小鱼', join_time: 1700000000, role: 'member' })).toEqual({ role: 'member', known: true })
  })

  it('不知道的时候不能说能管人', () => {
    expect(canModerate(roleOfMember({ role: 'member' }))).toBe(false)
    expect(canModerate({ role: 'unknown', known: false })).toBe(false)
    expect(canModerate({ role: 'owner', known: true })).toBe(true)
    expect(canModerate({ role: 'admin', known: true })).toBe(true)
    expect(canModerate({ role: 'member', known: true })).toBe(false)
  })
})
