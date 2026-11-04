// 口语词表：只产出“这句话在说什么”这个事实，不产出该不该动手的结论

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

/** 食物词：饮品不在这里，喝奶茶不算吃了一顿 */
export const MEAL: readonly string[] = [
  '饭', '米饭', '炒饭', '盖饭', '盒饭', '便当', '面', '面条', '拉面', '炒面', '拌面', '泡面',
  '米粉', '粥', '饺子', '包子', '馒头', '面包', '汉堡', '披萨', '薯条', '炸鸡', '烤肉',
  '火锅', '烧烤', '麻辣烫', '卤味', '菜', '肉', '排骨', '鸡腿', '鱼', '虾', '蛋',
  '水果', '蛋糕', '饼干', '零食', '夜宵', '早饭', '午饭', '晚饭', '早餐', '午餐', '晚餐', '食堂',
]

/** 吃饭的口语提示词：光有食物名不算，还要有一句“吃下去”的动作 */
export const MEAL_HINTS: readonly string[] = [
  '吃了', '吃完', '吃过', '吃个', '吃口', '吃一口', '吃点', '吃饭', '吃顿', '吃碗', '吃上',
  '去吃饭', '开饭', '干饭', '点了份', '点份', '点了个', '点了', '叫了外卖', '点了外卖',
  '下馆子', '做了一顿', '煮了', '盛了一碗', '投喂', '喂你', '给你点', '饱了',
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

/** 口头禅：整句先剔掉这些再来判凶与判生死，不然“笑死我了”会被当成真在凶 */
export const HABITUAL: readonly string[] = [
  '笑死', '累死', '烦死', '吓死', '死定', '困死', '饿死', '气死', '美死', '热死', '冷死',
]

/** 道歉的词：最管用的一路，要能认出“对不起”与“我错了” */
export const APOLOGY: readonly string[] = [
  '对不起', '抱歉', '我错了', '是我不好', '原谅我', '别生气', '不生气', '消消气',
]

/** 被威胁要断掉关系的词：关掉、换掉、不要她这几种说法 */
export const THREAT: readonly string[] = [
  '关掉你', '把你关', '换掉你', '把你换', '不要你', '不想要你', '删掉你', '断开你',
]

/** 被吓到的词 */
export const SCARE: readonly string[] = [
  '吓', '摔', '流血', '流血了', '医院', '急诊', '车祸', '受伤',
]

/** 担心的词：说的是对方要去吃苦或可能出事 */
export const WORRY: readonly string[] = [
  '军训', '加班', '这么晚', '发烧', '出事', '还没回', '不安全', '熬夜', '太危险',
]

/** 生死与离开的词：判之前同样先剔掉口头禅 */
export const DREAD: readonly string[] = [
  '死', '去世', '离开我', '别离开', '消失', '不在了', '没了',
]

// 把口头禅整段拿掉，剩下的才算真话
function withoutHabitual(text: string): string {
  return HABITUAL.reduce((rest, word) => rest.split(word).join(''), text)
}

/**
 * 剔掉口头禅之后的这句话，凶与生死两路都用它判
 * @param text - 用户这句话
 * @returns 拿掉口头禅的句子
 */
export function saidSeriously(text: string): string {
  return withoutHabitual(text)
}

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

/**
 * 这句话里最长的那个食物名
 * @param text - 用户这句话
 * @returns 命中的食物名，没命中给空串
 */
export function mealName(text: string): string {
  let hit = ''
  for (const word of MEAL) {
    if (text.includes(word) && word.length > hit.length) hit = word
  }
  return hit
}

/**
 * 这句话是不是在说吃一顿饭，只产出事实，不判该不该吃
 * @param text - 用户这句话
 * @returns 食物名与吃的动作都命中才是 true
 */
export function isMeal(text: string): boolean {
  return mentionsAny(text, MEAL) && mentionsAny(text, MEAL_HINTS)
}
