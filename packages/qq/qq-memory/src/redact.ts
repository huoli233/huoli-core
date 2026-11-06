// 写进记忆之前先抹掉凭证与长号码：这些东西进去一次就再也删不干净

/** 一条要抹的规则：找什么、换成什么；`$1` 表示留住第一组括号里的东西 */
interface Rule {
  /** 找这个 */
  pattern: RegExp
  /** 换成这个 */
  replacement: string
}

const RULES: readonly Rule[] = [
  // 形如 sk-xxxx 的密钥
  { pattern: /\bsk-[A-Za-z0-9_-]{12,}/gu, replacement: 'sk-***' },
  // Bearer 后面的那一串
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gu, replacement: 'Bearer ***' },
  // 这些字后面跟的值：token: xxx、password=xxx、api_key：xxx，字留着值换掉
  { pattern: /\b(token|password|passwd|secret|api[-_]?key|cookie|authorization)\b\s*[:=：]\s*["']?[^\s"',，。；;]{6,}["']?/giu, replacement: '$1: ***' },
  // 手机号：十一位，头一位是一
  { pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/gu, replacement: '***' },
  // 身份证：十七位加一位校验位
  { pattern: /(?<!\d)\d{17}[\dXx](?!\d)/gu, replacement: '***' },
  // 银行卡：十六到十九位连着
  { pattern: /(?<!\d)\d{16,19}(?!\d)/gu, replacement: '***' },
]

/**
 * 把一段话里的凭证与长号码抹掉
 * @param text 原来那句话
 * @returns 抹过之后的话，本来就没东西要抹时原样返回
 */
export function redactSecrets(text: string): string {
  let result = text
  for (const rule of RULES) result = result.replace(rule.pattern, rule.replacement)
  return result
}

/**
 * 这句话里有没有东西要被抹掉
 * @param text 要查的话
 * @returns 有就给抹过的那句，没有就是 undefined
 */
export function redactedOf(text: string): string | undefined {
  const cleaned = redactSecrets(text)
  return cleaned === text ? undefined : cleaned
}
