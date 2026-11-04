// 社交动态分级：只判该落在哪一级，发不发、怎么发不在这把刀里

/** 分级要看的事实，全部由调用方给出，这一包不猜 */
export interface PostFacts {
  /** 例行：到了平常会记一笔的时段 */
  routine: boolean
  /** 高峰：情绪到了峰值或低谷 */
  peak: boolean
  /** 第一把钥匙：本人答应过可以公开 */
  consent: boolean
  /** 第二把钥匙：这一趟明确要求公开 */
  requested: boolean
}

/** 分级结果 */
export interface PostDecision {
  /** 这一趟落在哪一级，默认 none */
  level: 'public' | 'routine' | 'none'
  /** 为什么是这一级，一句话 */
  reason: string
}

/**
 * 判一个动态该落在哪一级：默认不发，例行要例行与高峰同时成立，公开要两把钥匙
 * @param facts - 例行、高峰与两把钥匙
 * @returns 分级与一句理由
 */
export function postLevel(facts: PostFacts): PostDecision {
  if (facts.peak && facts.consent && facts.requested) {
    return { level: 'public', reason: '高峰成立，两把钥匙都在，可以公开' }
  }
  if (facts.routine && facts.peak) {
    return { level: 'routine', reason: '例行与高峰同时成立，只记一笔例行' }
  }
  return { level: 'none', reason: '没有同时成立的事实，这一趟不发' }
}
