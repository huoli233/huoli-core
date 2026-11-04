// 峰值判定：只给社交动态与记忆写回一份事实，不判该不该发

import { DEFAULTS, type Tuning } from './defaults.ts'
import type { VitalsState } from './types.ts'

/** 峰值的三种结论：幸福峰值、想哭低谷、都不是 */
export type PeakKind = 'happy' | 'sad' | null

/**
 * 判这一份状态落在峰值还是低谷
 * @param state - 当前状态
 * @param tuning - 参数，阈值全在里面
 * @returns happy 表示幸福峰值，sad 表示想哭低谷，null 表示都不是
 */
export function peakOf(state: VitalsState, tuning: Tuning = DEFAULTS): PeakKind {
  const happy = state.happiness >= tuning.peakHappinessFrom
    && state.dopamine >= tuning.peakDopamineFrom
    && state.oxytocin >= tuning.peakOxytocinFrom
    && state.serotonin >= tuning.peakSerotoninFrom
    && state.cortisol <= tuning.peakCortisolBelow
  if (happy) return 'happy'
  const sad = state.sadness >= tuning.troughSadnessFrom
    && state.serotonin <= tuning.troughSerotoninBelow
    && state.cortisol >= tuning.troughCortisolFrom
  return sad ? 'sad' : null
}
