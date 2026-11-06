// 这一轮说到第几条收口：只认配置给的条数上限，不替她判断该不该说

/**
 * 说满预算就收口，别再往下发
 * @param budget - 这一轮最多几条，配置给的数
 * @returns 给定已经发了几条，回答要不要停
 */
export function stopNowOf(budget: number): (sent: number) => boolean {
  const cap = Math.max(1, Math.floor(budget))
  return sent => sent >= cap
}
