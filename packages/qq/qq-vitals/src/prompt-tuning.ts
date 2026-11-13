// 提示词那一段的阈值：只决定这一轮怎么说，不参与状态怎么算

/** 提示词那一组的参数，与其它参数一起看全文进 Tuning */
export interface PromptTuning {
  /** 每轮身体提示词的字数上限，默认 780，超出就截断且至少保留 60 字 */
  promptMaxChars: number
  /** 提示词截断时至少留几个字，默认 60 */
  promptMinChars: number
  /** 饿到这条线说「饿得发慌」，0~1 标度，默认 0.75 */
  promptHungerCrisis: number
  /** 饿到这条线说「有点饿」，0~1 标度，默认 0.55 */
  promptHungerHigh: number
  /** 饿到这条线说「不太饿」，0~1 标度，默认 0.35 */
  promptHungerMid: number
  /** 渴到这条线说「渴得厉害」，0~1 标度，默认 0.82 */
  promptThirstCrisis: number
  /** 渴到这条线说「有点渴」，0~1 标度，默认 0.62 */
  promptThirstHigh: number
  /** 渴到这条线说「嗓子有点干」，0~1 标度，默认 0.45 */
  promptThirstDry: number
  /** 渴到这条线说「嘴里有点干」，0~1 标度，默认 0.30 */
  promptThirstLow: number
  /** 低于这条线说「刚喝过水」，0~1 标度，默认 0.25 */
  promptThirstQuenched: number
  /** 易怒高于这条线说「有点烦」，0~1 标度，默认 0.55 */
  promptIrritableHigh: number
  /** 易怒高于这条线说「心里有点毛」，0~1 标度，默认 0.35 */
  promptIrritableMid: number
  /** 精力高于这条线说「精力还不错」，0~1 标度，默认 0.60 */
  promptEnergyHigh: number
  /** 精力高于这条线说「精力一般」，0~1 标度，默认 0.40 */
  promptEnergyMid: number
  /** 精力低于这条线这一轮句子更短，0~1 标度，默认 0.35 */
  promptEnergyLow: number
  /** 黏人高于这条线说「很想黏着人」，0~1 标度，默认 0.60 */
  promptClingyHigh: number
  /** 黏人高于这条线说「有点想黏着」，0~1 标度，默认 0.40 */
  promptClingyMid: number
  /** 睡眠压力高于这条线说「身上沉」，0~1 标度，默认 0.60 */
  promptBodyAdenosine: number
  /** 肾上腺素高于这条线说「心跳快」，0~1 标度，默认 0.50 */
  promptBodyAdrenaline: number
  /** 乙酰胆碱高于这条线说「身上松下来了」，0~1 标度，默认 0.55 */
  promptBodyAcetylcholine: number
  /** 皮质醇高于这条线说「心里绷着一根弦」，0~1 标度，默认 0.60 */
  promptHeartCortisol: number
  /** 睡眠压力高于这条线这一轮句子更短，0~1 标度，默认 0.65 */
  promptStyleAdenosine: number
  /** 零到一的读数低于这条线说「偏低」，0~1 标度，默认 0.35 */
  promptLevelLow: number
  /** 零到一的读数高于这条线说「偏高」，0~1 标度，默认 0.65 */
  promptLevelHigh: number
}

/** 提示词那一段的默认值，全仓只此一处 */
export const PROMPT_TUNING: PromptTuning = {
  // 底稿和情绪/应激段一起给足空间，可选段全成立时仍由保险丝截断
  promptMaxChars: 780,
  promptMinChars: 60,
  promptHungerCrisis: 0.75,
  promptHungerHigh: 0.55,
  promptHungerMid: 0.35,
  promptThirstCrisis: 0.82,
  promptThirstHigh: 0.62,
  promptThirstDry: 0.45,
  promptThirstLow: 0.30,
  promptThirstQuenched: 0.25,
  promptIrritableHigh: 0.55,
  promptIrritableMid: 0.35,
  promptEnergyHigh: 0.60,
  promptEnergyMid: 0.40,
  promptEnergyLow: 0.35,
  promptClingyHigh: 0.60,
  promptClingyMid: 0.40,
  promptBodyAdenosine: 0.60,
  promptBodyAdrenaline: 0.50,
  promptBodyAcetylcholine: 0.55,
  promptHeartCortisol: 0.60,
  promptStyleAdenosine: 0.65,
  promptLevelLow: 0.35,
  promptLevelHigh: 0.65,
}
