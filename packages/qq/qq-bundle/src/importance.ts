// 身体那两路事实按零到一写重要度，记忆这边按百分制存，换算只在这一处做

/** 零到一刻度换成百分制的那个倍数 */
const PERCENT = 100

/**
 * 把事实里的重要度换成记忆用的百分制
 * @param importance - 事实里的重要度，零到一
 * @returns 一到一百之间的整数，落在记忆条目的取值范围内
 */
export function memoryImportance(importance: number): number {
  return Math.min(PERCENT, Math.max(1, Math.round(importance * PERCENT)))
}
