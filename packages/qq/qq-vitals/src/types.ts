// 这一包管的那份身体状态：字段名给面板和提示词共用

/** 初始值与漂移都要用到的数值字段，除体温外都是 0~1 */
export interface Baseline {
  dopamine: number
  oxytocin: number
  cortisol: number
  serotonin: number
  noradrenaline: number
  crh: number
  acth: number
  adrenaline: number
  acetylcholine: number
  endorphin: number
  vasopressin: number
  melatonin: number
  ghrelin: number
  leptin: number
  glucose: number
  insulin: number
  glucagon: number
  hunger: number
  thirst: number
  osmolality: number
  blood_volume: number
  angiotensin: number
  fluid_queue: number
  adenosine: number
  core_temp: number
  fever: number
  cytokines: number
  pain: number
}

/** 最近一次尝到或喝到的东西 */
export interface TasteRecord {
  name: string
  desc: string
  feel: string
  preference: number
  emotion_label: string
  source: string
}

/** 唯一事实来源：别的包只读它，不另算一套 */
export interface VitalsState extends Baseline {
  energy: number
  valence: number
  irritability: number
  clinginess: number
  loneliness: number
  dominance: number
  emotion_level: string
  emotion_candidates: string[]
  last_update: number
  last_msg: number
  last_meal: number
  last_drink: number
  last_drink_at: number
  last_taste_at: number
  drink_mem_at: number
  fluid_applied_at: number
  praise_applied_at: number
  anger_applied_at: number
  last_drink_name: string
  last_taste: TasteRecord | null
  last_user_text: string
}
