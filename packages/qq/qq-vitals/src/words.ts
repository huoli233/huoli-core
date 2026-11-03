// 口语词表：喝水要“饮品词 + 提示词”两条都命中

/** 饮品词 */
export const DRINK: readonly string[] = [
  '水', '温水', '热水', '冰水', '凉水', '奶茶', '饮料', '果汁', '汤',
  '茶', '咖啡', '可乐', '牛奶', '蜂蜜水', '汽水', '豆浆', '酸梅汤', '椰汁',
]

/** 喝水的口语提示词：少一条“喝水”，“喝水了”就认不出来 */
export const DRINK_HINTS: readonly string[] = [
  '给你倒', '倒给你', '递给你', '喝一口', '喝点', '喝点水', '喝了', '喂你喝',
  '端来', '拿去喝', '帮你倒', '接过去', '递来', '舀一勺', '倒水', '接给你',
  '喝水', '喝口水', '喝一口水', '喝了水', '去喝水', '自己喝', '喝完了',
  '灌水', '补水', '递给我', '给我倒', '倒杯', '一杯水', '润润嗓子', '喝吧', '给你水',
]

/** 被夸的词 */
export const PRAISE: readonly string[] = [
  '喜欢你', '爱你', '乖', '宝贝', '可爱', '想你', '贴心', '厉害', '棒', '谢谢', '亲亲', '抱抱',
]

/** 被凶的词 */
export const ANGER: readonly string[] = [
  '凶', '吼', '骂', '滚', '闭嘴', '烦死', '讨厌', '敷衍', '骗', '瞒', '说谎',
  '放鸽子', '爽约', '忘了', '迟到', '不理', '冷战', '别说了', '随便你', '懒得',
]

/**
 * 文本里有没有这些词
 * @param text - 用户这句话
 * @param words - 词表
 * @returns 命中则 true
 */
export function mentionsAny(text: string, words: readonly string[]): boolean {
  return words.some(word => text.includes(word))
}

/**
 * 这句话里最长的那个饮品名
 * @param text - 用户这句话
 * @returns 命中的饮品名，没命中给“水”
 */
export function drinkName(text: string): string {
  let hit = '水'
  for (const word of DRINK) {
    if (text.includes(word) && word.length > hit.length) hit = word
  }
  return hit
}

/**
 * 是不是在说喝水
 * @param text - 用户这句话
 * @returns 双条件都命中才是 true
 */
export function isDrink(text: string): boolean {
  return mentionsAny(text, DRINK) && mentionsAny(text, DRINK_HINTS)
}
