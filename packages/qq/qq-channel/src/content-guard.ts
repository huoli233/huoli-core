// 发出去之前先认一遍：本机路径、凭据、密钥这些原样进群就再也收不回来

/** 一类要拦的东西：叫什么、按什么找 */
export interface SecretRule {
  /** 是哪一类内容，拦下时写进原因 */
  label: string
  /** 找这个，要带 `g`，不带时按单次匹配补上 */
  pattern: RegExp
  /** 命中结果里这一组是要量长度的值，短于阈值就不算凭据 */
  valueGroup?: number
}

/** 内容闸的默认值表 */
export const CONTENT_GUARD_DEFAULTS = {
  /** 关掉就整条放行，只管内容，不管别的关卡 */
  enabled: true,
  /** 凭据值至少几个字符，太短的只是普通说法 */
  minSecretChars: 8,
  /** 额外要拦的规则，往后加，不替换默认那几条 */
  extraRules: [] as readonly SecretRule[],
}

/** 内容闸的参数 */
export type ContentGuardTuning = typeof CONTENT_GUARD_DEFAULTS

/** 默认规则集，也是唯一一份写法 */
export const CONTENT_GUARD_RULES: readonly SecretRule[] = [
  // 带盘符的本机路径，例如 C:\Users\某个人\...
  { label: '本机路径', pattern: /(?<![A-Za-z])[A-Za-z]:\\[^\s"'，。；;、）)】]*[^\s\\/"'，。；;、）)】]/gu },
  // 几个常见的绝对开头，例如 /home/...、/Users/...
  { label: '本机路径', pattern: /(?<![\w/])\/(?:home|users|root|etc|var|opt|usr|tmp|mnt|srv|private)\/[^\s"'，。；;、）)】]{2,}/giu },
  // Bearer 后面的那一串；值里得带数字或符号，纯英文单词不算凭据
  { label: '凭据', pattern: /\bBearer\s+((?=[-A-Za-z0-9._~+/=]*[-\d._~+/=])[-A-Za-z0-9._~+/=]{8,})/gu, valueGroup: 1 },
  // Authorization 后面直接跟值，不经过 Bearer 的写法
  { label: '凭据', pattern: /\bauthorization\b\s*[:=：]\s*["']?([-\w.~+/=]{8,})["']?/giu, valueGroup: 1 },
  // 这些字后面跟的值：token=xxx、apiKey: xxx、password：xxx，字留着，值要拦
  { label: '凭据', pattern: /\b(?:api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret|token|secret|password|passwd)\b\s*[:=：]\s*["']?([^\s"'，。；;、）)】]{2,})["']?/giu, valueGroup: 1 },
  // 形如 sk-xxxx 的密钥
  { label: '凭据', pattern: /\bsk-[A-Za-z0-9_-]{12,}/gu },
  // 私钥块的头一行
  { label: '私钥', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/gu },
  // 这类文件名本身就在说「这里头是凭据」
  { label: '敏感文件', pattern: /(?:^|[\s"'（(【[])(?:\.env|\.credentials|\.npmrc|\.netrc|id_rsa|id_ed25519)(?=$|[\s"'）)】\]，。；;：:,.])/giu },
]

// 规则集按参数摊开：默认那几条总在，配置给的往后加
function rulesOf(tuning: ContentGuardTuning): readonly SecretRule[] {
  if (tuning.extraRules.length === 0) return CONTENT_GUARD_RULES
  return [...CONTENT_GUARD_RULES, ...tuning.extraRules]
}

/**
 * 看一段话里有没有要拦下的那类内容。
 * @param text - 要发出去的话
 * @param tuning - 内容闸参数，不给就用默认值表
 * @returns 命中时给这一类的名字，没命中给 undefined
 */
export function secretKindOf(
  text: string,
  tuning: ContentGuardTuning = CONTENT_GUARD_DEFAULTS,
): string | undefined {
  if (!tuning.enabled) return undefined
  for (const rule of rulesOf(tuning)) {
    const pattern = rule.pattern.global ? rule.pattern : new RegExp(rule.pattern.source, `${rule.pattern.flags}g`)
    for (const found of text.matchAll(pattern)) {
      if (rule.valueGroup === undefined) return rule.label
      // 关键字后面的值太短时只是普通说法，不算凭据
      const value = found[rule.valueGroup] ?? ''
      if (value.length >= tuning.minSecretChars) return rule.label
    }
  }
  return undefined
}
