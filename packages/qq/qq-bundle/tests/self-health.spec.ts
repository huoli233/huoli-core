import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createSelfHealthRuntime,
  evaluateSelfHealth,
  renderSelfHealth,
  renderSelfHealthAlert,
  type SelfHealthFacts,
} from '../src/self-health.ts'

const NOW = 1_800_000_000_000
const MIN = 60_000
const thresholds = { healthyAt: 90, watchAt: 70, degradedAt: 40 }
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-health-'))
  dirs.push(dir)
  return dir
}

function facts(dir: string, rows: readonly unknown[] = []): SelfHealthFacts {
  const plugin = path.join(dir, 'plugin')
  fs.mkdirSync(plugin, { recursive: true })
  const timeline = path.join(dir, 'timeline.jsonl')
  fs.writeFileSync(timeline, rows.map(row => JSON.stringify(row)).join('\n'))
  return {
    now: NOW,
    services: [
      { name: 'system-prompt', ready: true },
      { name: 'llm', ready: true },
      { name: 'qq-channel', ready: true },
    ],
    plugins: [{ id: 'bili', dir: plugin, version: '1.0.0', enabled: true }],
    runtimeEntries: [{ id: 'bili', carrier: false, active: true, failed: false, disabled: false }],
    registeredTools: [
      'qq_send_message', 'qq_body_event', 'self_lesson', 'self_diary',
      'qq_body_doctor', 'read', 'edit', 'pwsh', 'plugin_manager',
    ],
    ownerTools: ['qq_body_doctor', 'read', 'edit', 'pwsh', 'plugin_manager'],
    timelineFile: timeline,
    dataRoot: dir,
    windowMs: 6 * 60 * MIN,
  }
}

describe('身体健康由真实探针合成', () => {
  it('核心、插件、工具、故障与数据目录都在时给满分', () => {
    const snapshot = evaluateSelfHealth(facts(tempDir()), thresholds)
    expect(snapshot.score).toBe(100)
    expect(snapshot.status).toBe('healthy')
    expect(snapshot.issues).toEqual([])
    expect(snapshot.probes.map(probe => probe.id)).toEqual(['core', 'model', 'plugins', 'tools', 'faults', 'storage'])
  })

  it('插件目录缺失与重复工具失败会降分，逻辑失败先报主人', () => {
    const dir = tempDir()
    const input = facts(dir, [
      { kind: 'tool_result', at: NOW - MIN, tool: 'bili_find', failed: true, code: 'bili.network' },
      { kind: 'tool_result', at: NOW - 2 * MIN, tool: 'bili_find', failed: true, code: 'bili.network' },
    ])
    input.plugins = [{ id: 'missing', dir: path.join(dir, 'gone'), version: '1', enabled: true }]
    const snapshot = evaluateSelfHealth(input, thresholds)
    expect(snapshot.score).toBeLessThan(100)
    expect(snapshot.status).toBe('critical')
    expect(snapshot.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'plugin.directory_missing', action: 'auto-repair' }),
      expect.objectContaining({ code: 'behavior.repeated_tool_failure', action: 'owner-report' }),
    ]))
    expect(snapshot.recentFailures).toBe(2)
  })

  it('预算和权限拒绝不算实现故障', () => {
    const snapshot = evaluateSelfHealth(facts(tempDir(), [
      { kind: 'tool_result', at: NOW - MIN, tool: 'qq_image_view', failed: true, code: 'media.low_energy' },
      { kind: 'tool_result', at: NOW - 2 * MIN, tool: 'qq_send_message', failed: true, code: 'outbound.quiet' },
      { kind: 'tool_result', at: NOW - 3 * MIN, tool: 'qq_declare_quiet', failed: true, code: 'quiet.private_needs_reply' },
    ]), thresholds)

    expect(snapshot.recentFailures).toBe(0)
    expect(snapshot.issues.filter(issue => issue.area === 'behavior')).toEqual([])
  })

  it('重启后不把上一次进程里已修复的工具失败继续算进当前健康', () => {
    const input = facts(tempDir(), [
      { kind: 'tool_result', at: NOW - 3 * MIN, tool: 'qq_send_message', failed: true, code: 'tool.failure' },
    ])
    input.baselineAt = NOW - MIN

    const snapshot = evaluateSelfHealth(input, thresholds)

    expect(snapshot.recentFailures).toBe(0)
    expect(snapshot.issues.filter(issue => issue.area === 'behavior')).toEqual([])
  })

  it('主人能看到分项与自主边界，群聊只看到汇总', () => {
    const snapshot = evaluateSelfHealth(facts(tempDir()), thresholds)
    const owner = renderSelfHealth(snapshot, true)
    const guest = renderSelfHealth(snapshot, false)
    expect(owner).toContain('DSH 核心、模型、压缩、插件、工具与 QQ 收发是同一个运行中的身体')
    expect(owner).toContain('PROBES: core=100')
    expect(owner).toContain('运行故障自己查、自己修')
    expect(owner).toContain('行为逻辑、人格、权限')
    expect(guest).toContain('STATUS: 100% healthy')
    expect(guest).not.toContain('PROBES:')
    expect(guest).not.toContain('qq_body_doctor')
  })

  it('叫醒内容区分可自动修的运行故障与需先报告的逻辑问题', () => {
    const text = renderSelfHealthAlert(
      evaluateSelfHealth(facts(tempDir()), thresholds),
      [{
        fingerprint: 'behavior:x',
        area: 'behavior',
        code: 'behavior.logic_bug',
        severity: 'degraded',
        summary: '同一判断连续出错',
        action: 'owner-report',
        at: NOW,
      }],
    )
    expect(text).toContain('运行故障')
    expect(text).toContain('行为逻辑')
    expect(text).toContain('必须先报告主人')
    expect(text).toContain('qq_body_doctor action=note')
  })
})

describe('自动体检的留存与提醒', () => {
  it('保存最新快照、写健康日记，同一问题只提醒一次', () => {
    const dir = tempDir()
    const stateFile = path.join(dir, 'health.json')
    const journalDir = path.join(dir, 'journal')
    const reports: string[][] = []
    const input = facts(dir)
    const runtime = createSelfHealthRuntime({
      intervalMs: 60_000,
      alertCooldownMs: 30 * MIN,
      startupDelayMs: 0,
      thresholds,
      stateFile,
      journalDir,
      facts: () => ({
        services: input.services,
        plugins: input.plugins,
        runtimeEntries: input.runtimeEntries,
        registeredTools: input.registeredTools,
        ownerTools: input.ownerTools,
        timelineFile: input.timelineFile,
        dataRoot: input.dataRoot,
        windowMs: input.windowMs,
      }),
    })
    runtime.useNotifier((_snapshot, issues) => { reports.push(issues.map(issue => issue.code)) })
    fs.appendFileSync(input.timelineFile, [
      { kind: 'tool_result', at: Date.now() - MIN, tool: 'bili_find', failed: true, code: 'bili.network' },
      { kind: 'tool_result', at: Date.now() - 2 * MIN, tool: 'bili_find', failed: true, code: 'bili.network' },
    ].map(row => JSON.stringify(row)).join('\n') + '\n')
    runtime.check()
    runtime.check()
    expect(reports.flat()).toContain('behavior.repeated_tool_failure')
    expect(reports).toHaveLength(1)
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf8'))).toMatchObject({ version: 1 })
    expect(runtime.history()).toContain('身体健康')
    runtime.note('重跑 bili_find 并补了超时')
    expect(runtime.history()).toContain('修复记录')
    runtime.close()
  })
})
