import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openSelfLessonStore } from '../src/self-lesson.ts'

const tempFile = (): string => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'self-lesson-')), 'lessons.db')
const stores: ReturnType<typeof openSelfLessonStore>[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})

describe('自学记录', () => {
  it('同一个对象.方面 新记录取代旧记录，只留一条 active', () => {
    const store = openSelfLessonStore(tempFile())
    stores.push(store)
    const old = store.note({ object: 'B站', aspect: '记忆写法', oneLine: '先写一句话', detail: '旧细节', why: '旧理由' }, 100)
    const fresh = store.note({ object: 'B站', aspect: '记忆写法', oneLine: '一句话 + 细节 + 为什么', detail: '新细节', why: '新理由' }, 200)

    const list = store.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe(fresh.id)
    expect(list[0]?.oneLine).toBe('一句话 + 细节 + 为什么')
    expect(store.query('记忆')).toHaveLength(1)
    expect(store.query('旧细节')).toHaveLength(0)
    expect(store.drop(old.id)).toBe(false)
    expect(store.drop(fresh.id)).toBe(true)
    expect(store.list()).toHaveLength(0)
  })

  it('两个字的查询也能走 LIKE 找到', () => {
    const store = openSelfLessonStore(tempFile())
    stores.push(store)
    store.note({ object: '插件', aspect: '安装', oneLine: '先看来源和权限', detail: '不要直接执行' })
    expect(store.query('插件')[0]?.oneLine).toBe('先看来源和权限')
  })

  it('改法提案只记录，不自动应用；verify 必填', () => {
    const store = openSelfLessonStore(tempFile())
    stores.push(store)
    const proposal = store.propose({
      target: 'prompt',
      change: '把「旧事默认不提」写进规则',
      verify: '看下一次 private 提示词里有没有这一行',
      risk: '改坏了就回滚 rules.md 上一版',
    })
    expect(store.proposals()).toHaveLength(1)
    expect(store.proposals()[0]?.status).toBe('proposed')
    expect(store.dropProposal(proposal.id)).toBe(true)
    expect(store.proposals()).toHaveLength(0)
    expect(() => store.propose({ target: 'plugin', change: '装一个插件', verify: '' })).toThrow(/verify/u)
  })
})
