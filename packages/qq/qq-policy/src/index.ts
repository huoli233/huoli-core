/** 衰减与保留度的统一出口 */

export {
  HALF_LIFE_MS,
  TAU_MS,
  clamp01,
  decay,
  relaxToBaseline,
  type HalfLifeKind,
  type TauKind,
} from './decay.ts'

export {
  RETENTION,
  CLARITY_ORDER,
  CLARITY_THRESHOLDS,
  initialImportance,
  retention,
  clarityFor,
  stepClarity,
  type Clarity,
  type MemoryRecord,
  type ImportanceInput,
} from './retention.ts'
