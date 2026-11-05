import { describe, expect, it } from 'vitest'
import { panelVitalsOf } from '../src/panel-vitals.ts'
import type { VitalsPort, VitalsReadout } from '../src/types.ts'

// 只做一件事的假身体：给多少就读多少
function portOf(readout: VitalsReadout): VitalsPort {
  return { render: () => '身体那一段', read: () => readout }
}

describe('把身体的读数翻成面板读数', () => {
  it('体温按原值交出去，其余按零到一收边界', () => {
    const kept = panelVitalsOf(portOf({
      thirst: 0.4,
      core_temp: 37.2,
      fever: 0.1,
      cytokines: 0.2,
      pain: 0.3,
      estrogen: 0.5,
      progesterone: 0.6,
    }))

    expect(kept).toEqual({ thirst: 0.4, temp: 37.2, fever: 0.1, immunity: 0.2, pain: 0.3, estrogen: 0.5, progesterone: 0.6 })
  })

  it('越界的零到一收回来，不会画出格子外面去', () => {
    const kept = panelVitalsOf(portOf({ fever: 4, pain: -2 }))

    expect(kept?.fever).toBe(1)
    expect(kept?.pain).toBe(0)
  })

  it('周期那三格照原样带出去', () => {
    const kept = panelVitalsOf(portOf({ cycle_day: 12, cycle_len: 30, cycle_phase: 'ovulation' }))

    expect(kept?.cycleDay).toBe(12)
    expect(kept?.cycleLen).toBe(30)
    expect(kept?.cyclePhase).toBe('ovulation')
  })

  it('身体给了分界就一并带出去，没给就不带', () => {
    const withBounds = panelVitalsOf({
      render: () => '一句话',
      read: () => ({ cycle_day: 12, cycle_len: 30 }),
      bounds: () => [5, 12, 15, 23],
    })
    const without = panelVitalsOf(portOf({ cycle_day: 12, cycle_len: 30 }))

    expect(withBounds?.cycleBounds).toEqual([5, 12, 15, 23])
    expect(without?.cycleBounds).toBeUndefined()
  })

  it('不是数的体温不要，缺的项整块省掉', () => {
    const kept = panelVitalsOf(portOf({ core_temp: Number.NaN }))

    expect(kept).toBeUndefined()
  })

  it('身体给了五组双条就一并带出去', () => {
    const kept = panelVitalsOf({
      render: () => '一句话',
      read: () => ({ thirst: 0.4 }),
      pairs: () => [{ name: '自主神经', a: '交感', av: 0.6, b: '副交感', bv: 0.3 }],
    })

    expect(kept?.pairs).toHaveLength(1)
    expect(kept?.pairs?.[0]?.a).toBe('交感')
  })

  it('端口不给读数时整块没有，不编一份出来', () => {
    expect(panelVitalsOf({ render: () => '只有一句话' })).toBeUndefined()
    expect(panelVitalsOf(undefined)).toBeUndefined()
  })
})
