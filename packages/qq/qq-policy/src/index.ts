/**
 * Single decay and retention table for the chat agent. Every fading value in
 * the product reads its half-life, relax target, or clarity threshold here.
 *
 * @module @huoli/huoli-qq-policy
 */

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
