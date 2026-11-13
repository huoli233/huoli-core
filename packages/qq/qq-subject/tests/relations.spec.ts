import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createRelationStore,
  relationLabel,
  relationWord,
  renderRelationFacts,
  stanceForNameHits,
} from '../src/relations.ts'

const tempDirs: string[] = []
const NOW = new Date(2026, 4, 10, 12, 0, 0).getTime()

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-relations-'))
  tempDirs.push(dir)
  return path.join(dir, 'relations.json')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('关系档案', () => {
  it('按用户编号分开保存，同名的人不会合并', () => {
    const store = createRelationStore({ file: tempFile(), now: () => NOW })

    store.observe({ personId: 'u1', name: '小鱼', chatKey: 'group:1', at: NOW })
    store.observe({ personId: 'u2', name: '小鱼', chatKey: 'group:1', at: NOW + 1 })

    expect(store.get('u1')?.displayName).toBe('小鱼')
    expect(store.get('u2')?.displayName).toBe('小鱼')
    expect(store.forChat('group:1').map(person => person.personId).sort()).toEqual(['u1', 'u2'])
  })

  it('昵称变化保留旧称呼，群和私聊都记在同一个用户下', () => {
    const store = createRelationStore({ file: tempFile(), now: () => NOW })

    store.observe({ personId: 'u1', name: '小鱼', chatKey: 'group:1', at: NOW })
    const person = store.observe({ personId: 'u1', name: '阿澈', chatKey: 'private:u1', at: NOW + 10 })

    expect(person.displayName).toBe('阿澈')
    expect(person.aliases).toEqual(['小鱼', '阿澈'])
    expect(person.chatKeys).toEqual(['group:1', 'private:u1'])
    expect(person.familiarity).toBeGreaterThan(0)
  })

  it('偏好称呼不改变用户编号', () => {
    const store = createRelationStore({ file: tempFile(), now: () => NOW })
    store.observe({ personId: 'u1', name: '小鱼', chatKey: 'private:u1', at: NOW })

    const person = store.setPreferredName('u1', '阿澈')

    expect(person.personId).toBe('u1')
    expect(relationLabel(person)).toBe('阿澈')
    expect(person.aliases).toContain('阿澈')
  })

  it('关系事件能记、能删、能读', () => {
    const store = createRelationStore({ file: tempFile(), now: () => NOW })
    store.observe({ personId: 'u1', name: '小鱼', chatKey: 'private:u1', at: NOW })

    const event = store.recordEvent({
      personId: 'u1',
      chatKey: 'private:u1',
      kind: 'promise',
      summary: '约好周末一起看电影',
      at: NOW + 20,
    })

    expect(store.events('u1', 5).some(item => item.id === event.id && item.kind === 'promise')).toBe(true)
    expect(store.removeEvent(event.id)).toBe(true)
    expect(store.events('u1', 5).map(item => item.id)).not.toContain(event.id)
  })

  it('冲突会降低好感与信任并抬高烦躁，修补会往回收', () => {
    const store = createRelationStore({ file: tempFile(), now: () => NOW })
    store.observe({ personId: 'u1', name: '小鱼', chatKey: 'private:u1', at: NOW })

    store.recordEvent({
      personId: 'u1', chatKey: 'private:u1', kind: 'conflict', summary: '因为一句话吵了起来', at: NOW + 1,
    })
    const conflicted = store.get('u1')
    expect(conflicted?.affection).toBeLessThan(0.5)
    expect(conflicted?.trust).toBeLessThan(0.5)
    expect(conflicted?.annoyance).toBeGreaterThan(0.05)

    store.recordEvent({
      personId: 'u1', chatKey: 'private:u1', kind: 'repair', summary: '把话说开后和好了', at: NOW + 2,
    })
    const repaired = store.get('u1')
    expect(repaired?.trust).toBeGreaterThan(conflicted?.trust ?? 0)
    expect(repaired?.annoyance).toBeLessThan(conflicted?.annoyance ?? 1)
  })

  it('一个人关系分数变化不会串到另一个人', () => {
    const store = createRelationStore({ file: tempFile(), now: () => NOW })
    store.observe({ personId: 'u1', name: '小鱼', chatKey: 'group:1', at: NOW })
    store.observe({ personId: 'u2', name: '阿澈', chatKey: 'group:1', at: NOW })

    store.recordEvent({
      personId: 'u1', chatKey: 'group:1', kind: 'shared', summary: '一起做完一件事', at: NOW + 1,
    })

    expect(store.get('u1')?.affection).toBeGreaterThan(0.5)
    expect(store.get('u2')?.affection).toBe(0.5)
  })

  it('有把握的一次好感和反感会单独写回，不用编成完整事件', () => {
    const store = createRelationStore({ file: tempFile(), now: () => NOW })
    store.observe({ personId: 'u1', name: '小鱼', chatKey: 'private:u1', at: NOW })

    store.feel({
      personId: 'u1',
      chatKey: 'private:u1',
      warmth: 0.8,
      trust: 0.5,
      irritation: -0.3,
      at: NOW + 1,
    })
    const warmer = store.get('u1')

    expect(warmer?.affection).toBeGreaterThan(0.5)
    expect(warmer?.trust).toBeGreaterThan(0.5)
    expect(warmer?.annoyance).toBeLessThan(0.05)

    store.feel({
      personId: 'u1',
      chatKey: 'private:u1',
      warmth: -1,
      trust: -0.8,
      irritation: 1,
      at: NOW + 2,
    })
    const colder = store.get('u1')

    expect(colder?.affection).toBeLessThan(warmer?.affection ?? 0)
    expect(colder?.trust).toBeLessThan(warmer?.trust ?? 0)
    expect(colder?.annoyance).toBeGreaterThan(warmer?.annoyance ?? 1)
  })

  it('长时间没有互动时向中性回落', () => {
    const store = createRelationStore({
      file: tempFile(),
      now: () => NOW,
      relationRegressMs: 60_000,
    })
    store.observe({ personId: 'u1', name: '小鱼', chatKey: 'private:u1', at: NOW })
    store.recordEvent({
      personId: 'u1', chatKey: 'private:u1', kind: 'conflict', summary: '争执了一次', at: NOW + 1,
    })
    const conflicted = store.get('u1')

    expect(store.maintain(NOW + 121_000)).toBe(1)
    const cooled = store.get('u1')

    expect(cooled?.affection).toBeGreaterThan(conflicted?.affection ?? 0)
    expect(cooled?.trust).toBeGreaterThan(conflicted?.trust ?? 0)
    expect(cooled?.annoyance).toBeLessThan(conflicted?.annoyance ?? 1)
  })

  it('同一个人反复用某个外号会被独立记住', () => {
    const store = createRelationStore({ file: tempFile(), now: () => NOW })

    store.recordNameCall('u1', 'private:u1', '臭肥鱼', NOW)
    store.recordNameCall('u1', 'private:u1', '臭肥鱼', NOW + 1)
    store.recordNameCall('u2', 'private:u2', '臭肥鱼', NOW + 2)

    expect(store.nameTags('u1', 'private:u1', NOW + 2)[0]).toMatchObject({
      label: '臭肥鱼',
      stance: 'tease',
    })
    expect(store.nameTags('u1', 'private:u1', NOW + 2)[0]?.effectiveHits).toBeCloseTo(2, 3)
    expect(store.nameTags('u2', 'private:u2', NOW + 2)[0]?.hits).toBe(1)
  })

  it('外号次数会随时间折半，过期后忘掉', () => {
    const store = createRelationStore({
      file: tempFile(),
      now: () => NOW,
      nicknameHalfLifeMs: 60_000,
      nicknameForgetMs: 120_000,
    })
    store.recordNameCall('u1', 'group:1', '臭肥鱼', NOW)

    const later = store.nameTags('u1', 'group:1', NOW + 60_000)
    expect(later[0]?.effectiveHits).toBeCloseTo(0.5, 3)
    expect(later[0]?.stance).toBe('resist')
    expect(store.nameTags('u1', 'group:1', NOW + 120_001)).toEqual([])
  })

  it('外号火候按次数分档，不靠写死词表', () => {
    expect(stanceForNameHits(0.2)).toBe('none')
    expect(stanceForNameHits(1)).toBe('resist')
    expect(stanceForNameHits(2)).toBe('tease')
    expect(stanceForNameHits(4)).toBe('cool')
  })

  it('临近纪念日能按天数和用户筛选', () => {
    const store = createRelationStore({ file: tempFile(), now: () => NOW })
    store.observe({ personId: 'u1', name: '小鱼', chatKey: 'private:u1', at: NOW })
    const anniversary = store.addAnniversary({
      personId: 'u1',
      chatKey: 'private:u1',
      label: '第一次一起看电影',
      month: 5,
      day: 15,
      at: NOW,
    })

    expect(store.upcoming({ at: NOW, personId: 'u1', days: 10 })).toMatchObject([{ id: anniversary.id }])
    expect(store.upcoming({ at: NOW, personId: 'u2', days: 10 })).toEqual([])
    expect(store.removeAnniversary(anniversary.id)).toBe(true)
  })

  it('不存在的日期不会写成纪念日', () => {
    const store = createRelationStore({ file: tempFile(), now: () => NOW })

    expect(() => store.addAnniversary({
      personId: 'u1',
      chatKey: 'private:u1',
      label: '不存在的日子',
      month: 2,
      day: 30,
    })).toThrow('relation.bad_date')
  })

  it('写盘以后能读回来，坏文件按空关系处理', () => {
    const file = tempFile()
    const first = createRelationStore({ file, now: () => NOW })
    first.observe({ personId: 'u1', name: '小鱼', chatKey: 'private:u1', at: NOW })
    first.setPreferredName('u1', '阿澈', NOW + 1)

    const reopened = createRelationStore({ file, now: () => NOW })
    expect(reopened.get('u1')?.preferredName).toBe('阿澈')

    fs.writeFileSync(file, '{坏文件')
    const recovered = createRelationStore({ file, now: () => NOW })
    expect(recovered.get('u1')?.displayName).toBe('小鱼')
  })

  it('普通连续发言只在内存累计，几秒内不每条重写整份关系', () => {
    const file = tempFile()
    let clock = NOW
    const store = createRelationStore({ file, now: () => clock })
    store.observe({ personId: 'u1', name: '小鱼', chatKey: 'private:u1', at: NOW })

    clock += 1_000
    store.observe({ personId: 'u1', name: '小鱼', chatKey: 'private:u1', at: NOW + 1_000 })
    const beforeFlush = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      people: Record<string, { messageCount: number }>
    }
    expect(beforeFlush.people.u1?.messageCount).toBe(1)

    clock += 5_000
    store.observe({ personId: 'u1', name: '小鱼', chatKey: 'private:u1', at: NOW + 6_000 })
    const afterFlush = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      people: Record<string, { messageCount: number }>
    }
    expect(afterFlush.people.u1?.messageCount).toBe(3)
  })

  it('有证据的情绪事实按会话和人保留，并随时间淡掉', () => {
    const store = createRelationStore({
      file: tempFile(),
      now: () => NOW,
      feelingHalfLifeMs: 60_000,
      feelingForgetMs: 120_000,
      feelingEvidenceFrom: 0.5,
    })
    const input = {
      personId: 'u1',
      chatKey: 'private:u1',
      target: 'robot',
      emotions: ['委屈'],
      valence: -0.6,
      relationalValence: -0.7,
      relationalConfidence: 0.8,
      arousal: 0.6,
      intensity: 0.8,
      confidence: 0.9,
      playfulness: 0.1,
      hostility: 0.2,
      correction: 0.1,
      irony: false,
      ironyUncertainty: 0.1,
      quotation: false,
      quotationUncertainty: 0.1,
      evidence: [{ messageId: 'm1', text: '你刚才没理我' }],
      explanation: '在追问刚才没接住的话',
      at: NOW,
    }

    const first = store.recordFeeling(input)
    expect(first?.hits).toBe(1)
    expect(store.recordFeeling({ ...input, at: NOW + 1 })?.hits).toBe(2)
    expect(store.feelings({ personId: 'u1', chatKey: 'private:u1', at: NOW + 1 })[0]?.evidence[0]?.text).toBe('你刚才没理我')
    expect(store.feelings({ personId: 'u2', chatKey: 'private:u1', at: NOW + 1 })).toEqual([])
    expect(store.feelings({ personId: 'u1', chatKey: 'private:u1', at: NOW + 121_000 })).toEqual([])
  })

  it('没有原话依据或不够有把握时不保存情绪事实', () => {
    const store = createRelationStore({ file: tempFile(), now: () => NOW, feelingEvidenceFrom: 0.6 })
    const input = {
      personId: 'u1',
      chatKey: 'private:u1',
      target: 'robot' as const,
      emotions: [],
      valence: -0.6,
      relationalValence: null,
      relationalConfidence: 0,
      arousal: 0,
      intensity: 0.7,
      confidence: 0.5,
      playfulness: 0,
      hostility: 0,
      correction: 0,
      irony: false,
      ironyUncertainty: 0,
      quotation: false,
      quotationUncertainty: 0,
      evidence: [],
      explanation: '',
      at: NOW,
    }

    expect(store.recordFeeling(input)).toBeUndefined()
    expect(store.recordFeeling({ ...input, confidence: 0.9, evidence: [{ messageId: '', text: '你又不理我' }] })?.hits).toBe(1)
  })

  it('提示词明确按编号认人，并带上称呼、阶段、事件和纪念日', () => {
    const store = createRelationStore({ file: tempFile(), now: () => NOW })
    const person = store.observe({ personId: 'u1', name: '小鱼', chatKey: 'private:u1', at: NOW })
    const event = store.recordEvent({
      personId: 'u1',
      chatKey: 'private:u1',
      kind: 'talk',
      summary: '聊过周末的安排',
      at: NOW,
    })
    const anniversary = store.addAnniversary({
      personId: 'u1',
      chatKey: 'private:u1',
      label: '认识一周年',
      month: 5,
      day: 15,
      at: NOW,
    })

    const text = renderRelationFacts(person, [event], [anniversary], NOW, 800)

    expect(relationWord(person)).toBe('刚认识')
    expect(text).toContain('用户编号 u1')
    expect(text).toContain('聊过周末的安排')
    expect(text).toContain('认识一周年')
    expect(text).toContain('不拿同名昵称猜成同一个人')
    expect(text).not.toContain('最近没有积着烦')
  })

  it('关系提示会把明显倾向写成感受，不报内部数字', () => {
    const store = createRelationStore({ file: tempFile(), now: () => NOW })
    store.observe({ personId: 'u1', name: '小鱼', chatKey: 'private:u1', at: NOW })
    store.recordEvent({
      personId: 'u1', chatKey: 'private:u1', kind: 'conflict', summary: '认真争执了一次', at: NOW + 1,
    })
    store.recordEvent({
      personId: 'u1', chatKey: 'private:u1', kind: 'conflict', summary: '又争执了一次', at: NOW + 2,
    })
    store.recordEvent({
      personId: 'u1', chatKey: 'private:u1', kind: 'conflict', summary: '还是没谈拢', at: NOW + 3,
    })
    store.recordEvent({
      personId: 'u1', chatKey: 'private:u1', kind: 'conflict', summary: '最后一次争执', at: NOW + 4,
    })
    const person = store.get('u1')
    if (person === undefined) throw new Error('关系没有写进去')

    const text = renderRelationFacts(person, store.events('u1'), [], NOW, 800)

    expect(text).toContain('还不敢完全信这个人')
    expect(text).toContain('最近对这个人有点烦')
    expect(text).not.toMatch(/affection|trust|annoyance|0\.\d/u)
  })

  it('关系提示会带上外号旧账和这次火候', () => {
    const store = createRelationStore({ file: tempFile(), now: () => NOW })
    store.observe({ personId: 'u1', name: '小鱼', chatKey: 'private:u1', at: NOW })
    store.recordNameCall('u1', 'private:u1', '臭肥鱼', NOW)
    store.recordNameCall('u1', 'private:u1', '臭肥鱼', NOW + 1)
    const person = store.get('u1')
    if (person === undefined) throw new Error('关系没有写进去')

    const text = renderRelationFacts(
      person,
      [],
      [],
      NOW + 1,
      800,
      store.nameTags('u1', 'private:u1', NOW + 1),
    )

    expect(text).toContain('外号旧账')
    expect(text).toContain('臭肥鱼')
    expect(text).toContain('顺着玩')
    expect(text).toContain('只对这个人')
  })

  it('最近一次外号优先展示，常用外号只作背景', () => {
    const store = createRelationStore({ file: tempFile(), now: () => NOW })
    store.observe({ personId: 'u1', name: '小鱼', chatKey: 'private:u1', at: NOW })
    for (let index = 0; index < 5; index += 1) {
      store.recordNameCall('u1', 'private:u1', '常用称呼', NOW + index)
    }
    store.recordNameCall('u1', 'private:u1', '刚出现的称呼', NOW + 10)
    const person = store.get('u1')
    if (person === undefined) throw new Error('关系没有写进去')

    const tags = store.nameTags('u1', 'private:u1', NOW + 10)
    const text = renderRelationFacts(person, [], [], NOW + 10, 800, tags)

    expect(tags[0]?.label).toBe('常用称呼')
    expect(text).toContain('最近一次记下的是「刚出现的称呼」')
    expect(text).toContain('明确说自己不是这个称呼')
    expect(text).toContain('平时更常叫我「常用称呼」')
  })

  it('关系提示只把仍有效的情绪旧印象写成背景，不报数值', () => {
    const file = tempFile()
    const store = createRelationStore({ file, now: () => NOW, feelingHalfLifeMs: 60_000, feelingForgetMs: 120_000 })
    const person = store.observe({ personId: 'u1', name: '小鱼', chatKey: 'private:u1', at: NOW })
    const feeling = store.recordFeeling({
      personId: 'u1',
      chatKey: 'private:u1',
      target: 'robot',
      emotions: ['委屈'],
      valence: -0.6,
      relationalValence: -0.7,
      relationalConfidence: 0.8,
      arousal: 0.6,
      intensity: 0.8,
      confidence: 0.9,
      playfulness: 0.1,
      hostility: 0.2,
      correction: 0.1,
      irony: false,
      ironyUncertainty: 0.1,
      quotation: false,
      quotationUncertainty: 0.1,
      evidence: [{ messageId: 'm1', text: '你刚才没理我' }],
      explanation: '在追问刚才没接住的话',
      at: NOW,
    })
    if (feeling === undefined) throw new Error('情绪事实没保存')

    const text = renderRelationFacts(person, [], [], NOW, 800, [], store.feelings({
      personId: 'u1',
      chatKey: 'private:u1',
      at: NOW,
      limit: 2,
    }))

    expect(text).toContain('和这个人打交道的旧印象')
    expect(text).toContain('你刚才没理我')
    expect(text).toContain('不要当面翻旧账')
    expect(text).not.toMatch(/0\.\d|confidence|valence/u)
    expect(renderRelationFacts(person, [], [], NOW + 121_000, 800, [], store.feelings({
      personId: 'u1',
      chatKey: 'private:u1',
      at: NOW + 121_000,
      limit: 2,
    }))).not.toContain('和这个人打交道的旧印象')
  })

  it('外号叫得再多也只给判断依据，不写死回法', () => {
    const store = createRelationStore({ file: tempFile(), now: () => NOW })
    store.observe({ personId: 'u1', name: '小鱼', chatKey: 'private:u1', at: NOW })
    for (let index = 0; index < 4; index += 1) {
      store.recordNameCall('u1', 'private:u1', '臭肥鱼', NOW + index)
    }
    const person = store.get('u1')
    if (person === undefined) throw new Error('关系没有写进去')

    const text = renderRelationFacts(
      person,
      [],
      [],
      NOW + 4,
      800,
      store.nameTags('u1', 'private:u1', NOW + 4),
    )

    expect(text).toContain('按当前关系和语境自然回应')
    expect(text).toContain('是否继续陪玩由你自己判断')
    expect(text).not.toContain('冷处理')
    expect(text).not.toContain('“嗯”“在”')
  })
})
