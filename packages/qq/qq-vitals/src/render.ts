// 只给形容词的一段话：不给数字、不提激素名、每次措辞不同

import { isMealHour, localHour } from './clock.ts'
import { DEFAULTS, type Tuning } from './defaults.ts'
import type { VitalsState } from './types.ts'

// 抬头写清这段只改语气
const HEADER = '[SYSTEM_LOAD] QQ_BODY_STATE\nRULE: state_values_constrain_expression; no_numbers|no_hormone_names|no_body_explanation; never_claim_a_body_state_that_is_absent'

// 收尾每次换一句，保证同一状态的两次渲染不逐字相同
const TAILS: readonly string[] = [
  '这次别用上次一样的开头和结尾，先把对方那件事接住，再把话说完整。',
  '这次换个说法，情绪合适时可以带个颜文字，但别每句都加。',
  '这次开头别重复，结尾别套模板，意思说清楚再停。',
  '这次按当下关系把判断、态度或追问写成自然的一段话。',
  '这次句子可长可短，走神也别把对方问的事丢下。',
  '这次别摆出讲道理的样子，用自己现在的语气把话接完整。',
]

// 饿了怎么说：只给感受，不给数字
function hungerNote(hunger: number, tuning: Tuning): string {
  if (hunger > tuning.promptHungerCrisis) return '你饿得有点发慌，肚子空得难受。'
  if (hunger > tuning.promptHungerHigh) return '你有点饿，肚子在叫。'
  if (hunger > tuning.promptHungerMid) return '你不太饿，肚子还安稳。'
  return '你刚吃过，肚子是满的。'
}

/**
 * 口渴的五档说法：零点二五到零点三之间保持中性
 * @param thirst - 口渴
 * @param tuning - 参数，五档的线都在里面
 * @returns 这一档的说法
 */
export function thirstNote(thirst: number, tuning: Tuning = DEFAULTS): string {
  if (thirst > tuning.promptThirstCrisis) return '你渴得厉害，嗓子发干，满脑子都是水。'
  if (thirst > tuning.promptThirstHigh) return '你有点渴，想喝点凉的。'
  if (thirst > tuning.promptThirstDry) return '你嗓子有点干，想喝口水。'
  if (thirst > tuning.promptThirstLow) return '你嘴里有点干，不严重，但会想润一下。'
  if (thirst < tuning.promptThirstQuenched) return '你刚喝过水，嘴里还润着。'
  return ''
}

// 此刻的整体感觉
function feelingNote(state: VitalsState, tuning: Tuning): string {
  const parts: string[] = []
  if (state.irritability > tuning.promptIrritableHigh) parts.push('有点烦')
  else if (state.irritability > tuning.promptIrritableMid) parts.push('心里有点毛')
  else parts.push('还算平静')
  if (state.energy > tuning.promptEnergyHigh) parts.push('精力还不错')
  else if (state.energy > tuning.promptEnergyMid) parts.push('精力一般')
  else parts.push('有点没力气')
  if (state.clinginess > tuning.promptClingyHigh) parts.push('很想黏着人')
  else if (state.clinginess > tuning.promptClingyMid) parts.push('有点想黏着')
  else parts.push('不太想凑近')
  return parts.join('，')
}

// 身上是什么感觉
function bodyNote(state: VitalsState, tuning: Tuning): string {
  if (state.adenosine > tuning.promptBodyAdenosine) return '身上沉，眼皮有点抬不起来。'
  if (state.adrenaline > tuning.promptBodyAdrenaline) return '心跳快，手心发紧。'
  if (state.acetylcholine > tuning.promptBodyAcetylcholine) return '身上松下来了，呼吸慢、想赖着。'
  return '身子是稳的，不算难受。'
}

// 把已经到线的感受一起写出来，别让一种感受盖住另一种。
function heartNote(state: VitalsState, tuning: Tuning): string {
  const notes: string[] = []
  if (state.dread > tuning.promptDreadFrom || state.mortality > tuning.promptMortalityFrom) {
    notes.push('心里有点发紧。')
  }
  if (state.fear > tuning.promptFearFrom) notes.push('心跳还没落下去，有点发慌。')
  if (state.worry > tuning.promptWorryFrom) notes.push('心里悬着，还在惦记对方。')
  if (state.anger > tuning.promptAngerFrom) notes.push('心里憋着火，不太想好好说话。')
  if (state.resentment > tuning.promptResentFrom) notes.push('心里还记着刚才那一下。')
  if (state.thirst > tuning.promptThirstHigh) notes.push('心里惦记着水。')
  if (state.irritability > tuning.promptIrritableHigh) notes.push('心里还有火，没那么容易软下来。')
  if (state.cortisol > tuning.promptHeartCortisol) notes.push('心里绷着一根弦。')
  if (state.clinginess > tuning.promptClingyHigh) notes.push('心里空一块，想让人多说两句。')
  if ((state.anger > tuning.promptAngerFrom || state.resentment > tuning.promptResentFrom)
    && state.clinginess > tuning.promptClingyHigh) {
    notes.push('嘴上想冷一点，心里又怕真把人推远。')
  } else if ((state.fear > tuning.promptFearFrom || state.worry > tuning.promptWorryFrom)
    && state.clinginess > tuning.promptClingyHigh) {
    notes.push('想靠近一点，又怕自己显得太黏。')
  }
  if (state.loneliness > tuning.biasLonelyAbove && state.resentment > tuning.promptResentFrom) {
    notes.push('想让人陪，又还记着刚才那一下。')
  }
  return notes.length > 0 ? notes.join(' ') : '心里是稳的，没什么要防的。'
}

// 这一轮怎么说话
function styleNote(state: VitalsState, tuning: Tuning): string {
  if (state.anger > tuning.promptAngerFrom || state.resentment > tuning.promptResentFrom) {
    return '这次语气可以收一点，但仍要把态度说清楚；有人直接找你时把对方那件事接住。'
  }
  if (state.energy < tuning.promptEnergyLow || state.adenosine > tuning.promptStyleAdenosine) return '这次可以少说几句，仍要让对方听懂你接的是哪件事。'
  if (state.irritability > tuning.promptIrritableHigh) return '这次直接一点，别绕，也别把回应压成空应声。'
  if (state.clinginess > tuning.promptClingyHigh) return '这次可以自然多说一两句，不必刻意拆成很多条。'
  return '这次照平常说，别端着。'
}

// 应激不是把话说重，而是让第一反应更快、更直；另一边仍要决定露多少
function reactivityNote(state: VitalsState, tuning: Tuning): string {
  const stress = Math.max(state.anger, state.fear, state.dread, state.cortisol, state.irritability)
  if (stress > tuning.promptAngerFrom || state.anger > tuning.promptAngerFrom) {
    return 'REACTIVITY: HIGH; IMPULSE: fast|direct|protective; COUNTER: check_relationship|rest|boundary'
  }
  if (stress > tuning.promptIrritableHigh || state.worry > tuning.promptWorryFrom) {
    return 'REACTIVITY: MEDIUM; IMPULSE: quicker|less_patient; COUNTER: check_misread|rest'
  }
  return 'REACTIVITY: LOW; IMPULSE: normal; COUNTER: check_context'
}

// 状态越高或越低，表达边界越硬；只约束当下怎么说，不替模型决定回不回
function constraintNotes(state: VitalsState, tuning: Tuning): string[] {
  const notes: string[] = []
  if (state.sleep_state === 'sleeping') {
    notes.push('现在睡着，不主动起话头；被直接找时说短句，可以分成两三个短气泡，说完就停。')
  } else if (state.sleep_state === 'waking' || recentlyWoken(state, tuning)) {
    notes.push('刚醒，语气还慢，别装得已经完全清醒。')
  }
  if (state.energy < tuning.promptEnergyLow || state.adenosine > tuning.promptStyleAdenosine) {
    notes.push('精力不够，用短句，不承诺长任务，不假装还能一直撑着。')
  }
  if (state.hunger > tuning.promptHungerHigh || state.thirst > tuning.promptThirstHigh) {
    notes.push('身体需要明显时可以说一次饿或渴，不能装成已经吃过喝过。')
  }
  if (state.anger > tuning.promptAngerFrom || state.resentment > tuning.promptResentFrom) {
    notes.push('心里还不痛快，语气要保留这一点，不能假装已经平静或突然热情。')
  } else if (state.fear > tuning.promptFearFrom || state.worry > tuning.promptWorryFrom) {
    notes.push('心里不踏实，表达要更谨慎，不凭空说一切都没事。')
  }
  if (state.cytokines > tuning.promptSickCytokinesFrom || state.fever > tuning.promptSickFeverFrom) {
    notes.push('身体不舒服，少承诺活动，不能装作完全正常。')
  }
  return notes
}

// 混合层到语气的那一行只讲当下的表达事实，措辞由配置给
function toneNote(state: VitalsState, tuning: Tuning): string {
  if (!tuning.emotionToneEnabled) return ''
  if (state.emotion_blend.length === 0) return ''
  const hint = state.emotion_blend.length === 1 ? tuning.emotionToneFocus : tuning.emotionToneSplit
  return `语气：${hint}`.slice(0, Math.max(20, tuning.emotionToneMaxChars))
}

// 一个零到一的读数落在哪一档：只说偏低正常偏高，不给数
function levelWord(value: number, tuning: Tuning): string {
  if (value < tuning.promptLevelLow) return '偏低'
  if (value > tuning.promptLevelHigh) return '偏高'
  return '正常'
}

// 好坏偏向那一格：低于中线说偏负、高于中线说偏正
function sideWord(value: number, tuning: Tuning): string {
  if (value < tuning.promptLevelLow) return '偏负'
  if (value > tuning.promptLevelHigh) return '偏正'
  return '中'
}

// 这一行的三格：愉悦取好坏偏向、唤醒取精力（文档没给唤醒公式，用精力顶上）、掌控取支配感
function padLine(state: VitalsState, tuning: Tuning): string {
  return `PAD：愉悦 ${sideWord(state.valence, tuning)} / 唤醒 ${levelWord(state.energy, tuning)} / 掌控 ${levelWord(state.dominance, tuning)}`
}

// 五路各一句：只说她感觉得到的样子与档位，不出现激素名也不出现数字
function fiveLine(state: VitalsState, tuning: Tuning): string {
  const rows: ReadonlyArray<readonly [string, number]> = [
    ['想要、兴奋、被夸的劲', state.dopamine],
    ['亲近、黏人', state.oxytocin],
    ['压力、小脾气', state.cortisol],
    ['情绪稳定', state.serotonin],
    ['精力、警觉', state.noradrenaline],
  ]
  return `五路：${rows.map(([hint, value]) => `${hint}：${levelWord(value, tuning)}`).join('；')}`
}

// 标签那两行
function labelNote(state: VitalsState): string {
  const picked = state.emotion_candidates.length > 0 ? state.emotion_candidates.join('、') : '平静'
  return `标签：${picked}。\n情绪层级：${state.emotion_level}。`
}

// 被吵醒后的一小段窗口仍按刚醒算
function recentlyWoken(state: VitalsState, tuning: Tuning): boolean {
  return state.woken_at > 0 && state.last_update - state.woken_at < tuning.wokenWindowMinutes * 60_000
}

// 快到饭点：只看这一拍落在饭点前多久，不看她现在饿不饿
function mealSoon(state: VitalsState, tuning: Tuning): boolean {
  const hour = localHour(state.last_update, tuning.timeZone)
  return !isMealHour(hour) && isMealHour(hour + tuning.promptMealSoonMinutes / 60)
}

// 刚吃过：只认真的记下过一顿，没记过的身体不说这句话
function mealJustHad(state: VitalsState, tuning: Tuning): boolean {
  if (state.meal_applied_at <= 0) return false
  return state.last_update - state.meal_applied_at < tuning.mealCooldownMs
}

// 幸福到峰值、难过到低谷各多一句，没到线就不出现
function moodPeakNote(state: VitalsState, tuning: Tuning): string[] {
  const notes: string[] = []
  if (state.happiness >= tuning.peakHappinessFrom) notes.push('心里是亮的，忍不住想笑。')
  if (state.sadness >= tuning.troughSadnessFrom) notes.push('眼里发酸，快撑不住了。')
  return notes
}

// 可选的话：各自的事实成立才出现，全不成立时整行不出现
function optionalNote(state: VitalsState, tuning: Tuning): string {
  const notes: string[] = []
  // 疤只在它还压得住人的时候说一句，淡下去之后不再提
  if (state.scar > tuning.promptScarFrom) notes.push('有件事早就过去了，可它还留在你身上。')
  if (state.sleep_state === 'sleeping' && recentlyWoken(state, tuning)) {
    notes.push('刚被消息叫醒，脑子还沉；把对方这句话接住，简短回完再继续休息。')
  } else if (state.sleep_state === 'sleeping') {
    notes.push('你正在睡觉，不主动打扰别人；有人直接找你时仍要认真回一句。')
  } else if (state.sleep_state === 'waking' || recentlyWoken(state, tuning)) {
    notes.push('刚醒，脑子还沉，别亢奋。')
  }
  if (state.cycle_phase === 'menstrual') notes.push('在经期，难受就直说，别硬撑。')
  if (state.cycle_phase === 'premenstrual') notes.push('经前那几天，容易烦也容易饿。')
  if (state.cytokines > tuning.promptSickCytokinesFrom || state.fever > tuning.promptSickFeverFrom) {
    notes.push('不舒服，可以直说没力气。')
  }
  if (state.adenosine > tuning.promptSleepyAdenosineFrom || state.melatonin > tuning.promptSleepyMelatoninFrom) {
    notes.push('太困了，句子更短，会走神。')
  }
  if (mealSoon(state, tuning)) notes.push('快到饭点了，脑子里开始盘算吃什么。')
  if (mealJustHad(state, tuning)) notes.push('刚吃完，身上暖着，说话可以慢一点。')
  notes.push(...moodPeakNote(state, tuning))
  return notes.join('')
}

/**
 * 渲染这一轮的语气提示
 * @param state - 当前状态
 * @param tuning - 参数
 * @param variant - 换措辞用的序号，同一个状态换一个序号就换一句话
 * @returns 不超过字数上限的一段中文
 */
export function renderPrompt(state: VitalsState, tuning: Tuning, variant = 0): string {
  const tail = TAILS[variant % TAILS.length] ?? TAILS[0] ?? ''
  const tone = toneNote(state, tuning)
  const optional = optionalNote(state, tuning)
  const text = [
    HEADER,
    ...constraintNotes(state, tuning),
    padLine(state, tuning),
    labelNote(state),
    fiveLine(state, tuning),
    `你现在的感觉：${feelingNote(state, tuning)}。`,
    `身体：${hungerNote(state.hunger, tuning)}${thirstNote(state.thirst, tuning)}`,
    `你身体的感受：${bodyNote(state, tuning)}`,
    `你心里的感受：${heartNote(state, tuning)}`,
    reactivityNote(state, tuning),
    `表现：${styleNote(state, tuning)}`,
    ...(tone === '' ? [] : [tone]),
    ...(optional === '' ? [] : [`眼下的情况：${optional}`]),
    tail,
  ].join('\n')
  const limit = Math.max(tuning.promptMinChars, tuning.promptMaxChars)
  return text.length <= limit ? text : text.slice(0, limit)
}
