import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, DEFAULTS, judgeComment, judgePostLevel, qqSelfOf, type Config, type QqSelfSeam } from '../src/index.ts'

const roots: string[] = []
const TOPICS = ['日常', '吃喝']

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-stage-'))
  roots.push(root)
  return path.join(root, 'self')
}

async function mount(config: Config = {}): Promise<{ dir: string; seam: QqSelfSeam }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  const dir = config.dir ?? tempDir()
  apply(ctx, { enabled: true, ...config, dir })
  const seam = qqSelfOf(ctx)
  if (seam === undefined) throw new Error('这一层没有装配')
  return { dir, seam }
}

// 留痕文件里的每一行，文件不在就当没推进过
function traceOf(dir: string): Array<Record<string, unknown>> {
  const file = path.join(dir, 'stage.jsonl')
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('阶段从哪读', () => {
  it('没推进过就按默认值表那一档，留痕文件还不存在', async () => {
    const { dir, seam } = await mount()

    expect(seam.stage()).toBe(DEFAULTS.stage)
    expect(DEFAULTS.stage).toBe('P0')
    expect(traceOf(dir)).toHaveLength(0)
  })

  it('推进过就跟着留痕走，重装一个新实例也读得回来', async () => {
    const { dir, seam } = await mount()
    seam.advanceStage('P1', '面板写稳了', 1_000)

    const again = await mount({ dir })

    expect(again.seam.stage()).toBe('P1')
  })
})

describe('按顺序推进', () => {
  it('P0 到 P3 一档一档推过去都成，每推一次留一条痕', async () => {
    const { dir, seam } = await mount()

    const first = seam.advanceStage('P1', '基线访谈做完了', 1_000)
    const second = seam.advanceStage('P2', '面板连着三天没变', 2_000)
    seam.approveStageAdvance(true, true, 2_500)
    const third = seam.advanceStage('P3', '面板报错计数为 0', 3_000)

    expect(first).toMatchObject({ ok: true, stage: 'P1', at: 1_000 })
    expect(second).toMatchObject({ ok: true, stage: 'P2' })
    expect(third).toMatchObject({ ok: true, stage: 'P3' })
    expect(seam.stage()).toBe('P3')
    expect(traceOf(dir)).toEqual([
      expect.objectContaining({ from: 'P0', to: 'P1', reason: '基线访谈做完了', at: 1_000 }),
      expect.objectContaining({ from: 'P1', to: 'P2', reason: '面板连着三天没变', at: 2_000 }),
      expect.objectContaining({ from: 'P2', to: 'P3', reason: '面板报错计数为 0', at: 3_000 }),
    ])
  })

  it('跳级被拒，码是 stage.skip，盘上不留这一条', async () => {
    const { dir, seam } = await mount()

    const decision = seam.advanceStage('P2', '想一次推两档', 1_000)

    expect(decision.ok).toBe(false)
    expect(decision.code).toBe('stage.skip')
    expect(decision.reason).toContain('P1')
    expect(decision.hint).toBeTruthy()
    expect(decision.stage).toBe('P0')
    expect(traceOf(dir)).toHaveLength(0)
  })

  it('后退被拒，码是 stage.back', async () => {
    const { seam } = await mount()
    seam.advanceStage('P1', '先推一档', 1_000)
    seam.advanceStage('P2', '再推一档', 2_000)

    const decision = seam.advanceStage('P1', '想退回去', 3_000)

    expect(decision.ok).toBe(false)
    expect(decision.code).toBe('stage.back')
    expect(decision.reason).toBeTruthy()
    expect(seam.stage()).toBe('P2')
  })

  it('停在原地被拒，码是 stage.same', async () => {
    const { seam } = await mount()

    const decision = seam.advanceStage('P0', '原地不动', 1_000)

    expect(decision.code).toBe('stage.same')
    expect(decision.ok).toBe(false)
  })

  it('认不出的阶段名被拒，码是 stage.unknown', async () => {
    const { seam } = await mount()

    const decision = seam.advanceStage('P9', '写错了一档', 1_000)

    expect(decision.code).toBe('stage.unknown')
    expect(decision.reason).toBeTruthy()
    expect(decision.hint).toBeTruthy()
  })

  it('没写为什么被拒，码是 stage.reason_required', async () => {
    const { dir, seam } = await mount()

    const decision = seam.advanceStage('P1', '   ', 1_000)

    expect(decision.code).toBe('stage.reason_required')
    expect(traceOf(dir)).toHaveLength(0)
  })

  it('最后一档再往前推就没有下一档，跳级同样拒', async () => {
    const { seam } = await mount()
    seam.approveStageAdvance(true, true, 900)
    for (const stage of ['P1', 'P2', 'P3', 'P4', 'P5a']) seam.advanceStage(stage, '一档一档推', 1_000)

    const decision = seam.advanceStage('P5c', '想直接到最后一档', 2_000)

    expect(decision.code).toBe('stage.skip')
    expect(seam.stage()).toBe('P5a')
  })

  it('这一层关着时推进不落盘，码是 stage.disabled', async () => {
    const { dir, seam } = await mount({ enabled: false })

    const decision = seam.advanceStage('P1', '关着也想推', 1_000)

    expect(decision.code).toBe('stage.disabled')
    expect(seam.stage()).toBe('P0')
    expect(fs.existsSync(dir)).toBe(false)
  })
})

describe('推进之后同一个动作从拒变可', () => {
  it('P0 时动态与评论都被阶段拦下，推到 P3 之后走到下一个闸门', async () => {
    const { seam } = await mount()
    const routine = { level: 'routine', topic: '吃喝', topics: TOPICS, userOk: true, selfOk: true, stage: seam.stage() }

    expect(judgePostLevel(routine).code).toBe('post.stage_blocked')
    expect(judgeComment({ topic: '吃喝', topics: TOPICS, userOk: true, selfOk: true, stage: seam.stage() }).code).toBe('comment.stage_blocked')

    seam.approveStageAdvance(true, true, 900)
    for (const stage of ['P1', 'P2', 'P3']) seam.advanceStage(stage, '照退出条件往前推', 1_000)

    expect(judgePostLevel({ ...routine, stage: seam.stage() }).ok).toBe(true)
    expect(judgePostLevel({ ...routine, stage: seam.stage(), level: 'none' }).code).toBe('post.level')
    expect(judgeComment({ topics: TOPICS, userOk: true, selfOk: true, stage: seam.stage() }).code).toBe('comment.topic_required')
  })
})

describe('阶段下限', () => {
  it('公开与私信都默认从 P3 起，阶段默认 P0', () => {
    expect(DEFAULTS.publicMinStage).toBe('P3')
    expect(DEFAULTS.privateMinStage).toBe('P3')
    expect(DEFAULTS.stage).toBe('P0')
  })

  it('下限可以抬到更后面的阶段，P3 也放不出去', () => {
    const decision = judgePostLevel({ level: 'routine', topic: '吃喝', topics: TOPICS, userOk: true, selfOk: true, stage: 'P3', minStage: 'P4' })

    expect(decision.code).toBe('post.stage_blocked')
  })

  it('原因里写着现在处在哪一档、要等到哪一档', () => {
    const decision = judgePostLevel({ level: 'routine', topic: '吃喝', topics: TOPICS, userOk: true, selfOk: true, stage: 'P1', minStage: 'P3' })

    expect(decision.reason).toContain('P1')
    expect(decision.reason).toContain('P3')
    expect(decision.reason).toContain('只读')
    expect(decision.hint).toBeTruthy()
  })
})
