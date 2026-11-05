import { describe, expect, it } from 'vitest'
import { panelPage } from '../src/panel-http.ts'
import type { PanelState } from '../src/types.ts'

const STATE: PanelState = {
  panel: { body: '【自我】\n她在。', generatedAt: '2026-11-05T09:00:00.000Z' },
  ledger: { drive: 3, agency: 2, recentAgency: 1 },
  days: [],
  health: '健康：一切正常',
  vitals: { thirst: 0.4, energy: 0.6, socialHunger: 0.2 },
}

describe('简版面板', () => {
  it('只出此刻那一段，三样读数都在', () => {
    const page = panelPage(STATE, { brief: true })

    expect(page).toContain('我·此刻')
    expect(page).toContain('口渴 40%')
    expect(page).toContain('精力 60%')
    expect(page).toContain('想说话 20%')
    expect(page).toContain('健康：一切正常')
  })

  it('不画任何画布，也不带轮询脚本', () => {
    const page = panelPage(STATE, { brief: true })

    expect(page).not.toContain('<canvas')
    expect(page).not.toContain('<script')
    expect(page).not.toContain('setInterval')
  })

  it('身体没接上时只说这一句，不留空壳', () => {
    const withoutBody: PanelState = { ...STATE }
    delete (withoutBody as { vitals?: unknown }).vitals
    const page = panelPage(withoutBody, { brief: true })

    expect(page).toContain('身体没接上')
  })

  it('完整版还是原来那一屏', () => {
    const page = panelPage(STATE)

    expect(page).toContain('<script')
    expect(page).toContain('健康')
  })
})
