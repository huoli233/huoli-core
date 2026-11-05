// 按规范第 12 章那张验收表逐条跑一遍：全部在内存里算，不碰真实状态

import { pathToFileURL } from 'node:url'
import { derive, drift, emptyState, react, renderPrompt, resolveTuning, type VitalsState } from '../src/index.ts'

const tuning = resolveTuning()
const HOUR = 3_600_000

/** 一条验收的结论 */
export interface AcceptRow {
  /** 表里那一行的名字 */
  name: string
  /** 过没过 */
  ok: boolean
  /** 没过的原因，过了给空串 */
  why: string
}

// 造一份干净状态：时间从某个整点开始，后面的场景都按小时推
function fresh(at: number, overrides: Partial<VitalsState> = {}): VitalsState {
  return { ...emptyState(tuning, at), ...overrides }
}

// 说一句话：写回之后还要算一次派生量，标签与主动劲都在那一步才更新
function hit(state: VitalsState, text: string, at: number): VitalsState {
  return derive(react(state, text, at, tuning), tuning)
}

// 推进若干小时：只结算，不发生互动
function later(state: VitalsState, hours: number): VitalsState {
  return drift(state, state.last_update + hours * HOUR, tuning, () => 0.5)
}

// 结算到某一刻并把派生量一起算出来：标签与派生量只有这一步之后才是新的
function settle(state: VitalsState, at: number): VitalsState {
  return derive(drift(state, at, tuning, () => 0.5), tuning)
}

// 一条验收：判据自己给，过了就不留原因
function row(name: string, pass: boolean, why: string): AcceptRow {
  return { name, ok: pass, why: pass ? '' : why }
}

/**
 * 按第 12 章那张表跑一遍
 * @returns 每一条的结论
 */
export function runAccept(): AcceptRow[] {
  const start = new Date(2026, 10, 3, 10, 0, 0).getTime()
  const clean = fresh(start)
  const rows: AcceptRow[] = []

  // 夸奖：多巴胺、催产素都往上
  const praised = hit(clean, '乖，抱抱你', start)
  rows.push(row(
    '夸奖让多巴胺与催产素上升',
    praised.dopamine > clean.dopamine && praised.oxytocin > clean.oxytocin,
    `多巴胺 ${praised.dopamine.toFixed(3)} / 催产素 ${praised.oxytocin.toFixed(3)} 没有都往上`,
  ))

  // 凶：皮质醇往上
  const scolded = hit(clean, '你真讨厌，闭嘴', start)
  rows.push(row(
    '被凶让皮质醇上升',
    scolded.cortisol > clean.cortisol,
    `皮质醇 ${scolded.cortisol.toFixed(3)} 没有往上`,
  ))

  // 生气：连着被凶几句之后标签里出现「生气」——一句骂不出口，得让它积累
  let hurt = clean
  for (let at = 0; at < 3; at += 1) hurt = hit(hurt, '你真讨厌，闭嘴', start + at * 120_000)
  rows.push(row(
    '连着被凶之后标签里出现生气',
    hurt.emotion_candidates.includes('生气'),
    `标签是 ${hurt.emotion_candidates.join('、') || '（空）'}，愤怒 ${hurt.anger.toFixed(3)}`,
  ))

  // 饿：八小时不喂，饥饿过 0.5
  const hungry = later(clean, 8)
  rows.push(row(
    '八小时不喂饥饿过 0.5',
    hungry.hunger > 0.5,
    `饥饿只有 ${hungry.hunger.toFixed(3)}`,
  ))

  // 投喂：写回让饥饿往下掉
  const fed = hit(clean, '给你点了饭，快吃', start)
  rows.push(row(
    '投喂让饥饿下降',
    fed.hunger < clean.hunger,
    `饥饿 ${fed.hunger.toFixed(3)} 没有下降`,
  ))

  // 口渴：八小时不喝过 0.55；喝一次掉 0.55
  const thirsty = later(clean, 8)
  rows.push(row(
    '八小时不喝口渴过 0.55',
    thirsty.thirst > 0.55,
    `口渴只有 ${thirsty.thirst.toFixed(3)}`,
  ))
  const drank = hit({ ...thirsty, last_drink: 0 }, '喝水了', thirsty.last_update + 1000)
  rows.push(row(
    '喝一次水口渴掉 0.55',
    Math.abs((thirsty.thirst - drank.thirst) - tuning.drinkThirstDrop) < 0.01,
    `实际掉了 ${(thirsty.thirst - drank.thirst).toFixed(3)}`,
  ))

  // 口渴提示：0.58 时提示词里要有那句，不再沉默
  const note = renderPrompt(fresh(start, { thirst: 0.58 }), tuning)
  rows.push(row(
    '口渴 0.58 时提示词说嗓子有点干',
    note.includes('嗓子有点干'),
    '提示词里没有那句',
  ))

  // 喝水口语：三种说法都要认
  const spoken: readonly string[] = ['喝水了', '我去喝水', '递给我一杯水']
  const each = spoken.map(text => hit({ ...thirsty, last_drink: 0 }, text, thirsty.last_update + 1000))
  rows.push(row(
    '三种喝水口语都认得',
    each.every(state => state.last_drink > thirsty.last_drink),
    '有说法没被认出来',
  ))

  // 喝水冷却：三分钟里第二杯不减
  const first = hit({ ...thirsty, last_drink: 0 }, '喝水了', thirsty.last_update + 1000)
  const second = hit(first, '喝水了', first.last_drink + 60_000)
  rows.push(row(
    '三分钟里第二杯不记账',
    Math.abs(second.thirst - first.thirst) < 1e-9,
    `第二杯把口渴从 ${first.thirst.toFixed(3)} 改成了 ${second.thirst.toFixed(3)}`,
  ))

  // 注入检查：提示词里真能看到这一段
  rows.push(row(
    '提示词里有神经状态那一段',
    note.includes('【你现在的神经状态'),
    '提示词里没有抬头那一段',
  ))

  // 血糖：吃一顿往上走
  const ate = hit(clean, '吃了碗面', start)
  rows.push(row(
    '吃一顿让血糖上升',
    ate.glucose > clean.glucose,
    `血糖 ${ate.glucose.toFixed(3)} 没有上升`,
  ))

  // 睡眠：夜里睡眠压力过线就该睡着；判定读的是结算前的腺苷，所以先把它喂到线上
  const night = drift(
    fresh(new Date(2026, 10, 3, 23, 0, 0).getTime(), { adenosine: 0.62 }),
    new Date(2026, 10, 3, 23, 30, 0).getTime(),
    tuning,
  )
  rows.push(row(
    '夜里睡眠压力过线就睡着',
    night.asleep,
    `睡眠状态是 ${night.sleep_state}`,
  ))

  // 冷战：凶完不理十二小时，记恨涨到 0.5 以上（按小时结算，真实是每分钟一拍）
  let cold = clean
  for (let at = 0; at < 3; at += 1) cold = hit(cold, '你真讨厌，闭嘴', start + at * 120_000)
  for (let hour = 0; hour < 12; hour += 1) cold = settle(cold, cold.last_update + HOUR)
  rows.push(row(
    '凶完不理十二小时记恨过 0.5',
    cold.resentment > 0.5,
    `记恨只有 ${cold.resentment.toFixed(3)}`,
  ))

  // 哄好：一句道歉让愤怒与记恨都往下
  let angry = clean
  for (let at = 0; at < 3; at += 1) angry = hit(angry, '你真讨厌，闭嘴', start + at * 120_000)
  const soothed = hit(angry, '对不起，是我不好', start + 300_000)
  rows.push(row(
    '道歉让愤怒与记恨都降下来',
    soothed.anger < angry.anger && soothed.resentment <= angry.resentment,
    `愤怒 ${angry.anger.toFixed(3)}→${soothed.anger.toFixed(3)}，记恨 ${angry.resentment.toFixed(3)}→${soothed.resentment.toFixed(3)}`,
  ))

  // 经期：开经那天精力降、易怒升，标签里出现「经期」
  const period = settle(fresh(new Date(2026, 10, 5, 8, 0, 0).getTime()), new Date(2026, 10, 5, 9, 0, 0).getTime())
  const plain = settle(fresh(new Date(2026, 10, 20, 8, 0, 0).getTime()), new Date(2026, 10, 20, 9, 0, 0).getTime())
  rows.push(row(
    '经期精力降、易怒升、标签出现经期',
    period.cycle_phase === 'menstrual'
      && period.energy < plain.energy
      && period.irritability > plain.irritability
      && period.emotion_candidates.includes('经期'),
    `phase ${period.cycle_phase}，精力 ${period.energy.toFixed(3)} vs ${plain.energy.toFixed(3)}，`
      + `易怒 ${period.irritability.toFixed(3)} vs ${plain.irritability.toFixed(3)}，标签 ${period.emotion_candidates.join('、')}`,
  ))

  // 午睡：十三点睡眠压力过线就睡一觉，类型是午睡
  const nap = settle(
    fresh(new Date(2026, 10, 3, 12, 30, 0).getTime(), { adenosine: 0.75 }),
    new Date(2026, 10, 3, 13, 10, 0).getTime(),
  )
  rows.push(row(
    '十三点睡眠压力过线就午睡',
    nap.asleep && nap.sleep_kind === 'nap',
    `状态 ${nap.sleep_state}，类型 ${nap.sleep_kind}`,
  ))

  return rows
}

// 打印一张验收表，全过返回零
export function printAccept(rows: readonly AcceptRow[], write: (text: string) => void): number {
  for (const entry of rows) {
    write(`${entry.ok ? '✅' : '❌'} ${entry.name}${entry.ok ? '' : `：${entry.why}`}`)
  }
  const failed = rows.filter(entry => !entry.ok).length
  write(`\n共 ${rows.length} 条，通过 ${rows.length - failed} 条，未过 ${failed} 条`)
  return failed === 0 ? 0 : 1
}

// 直接运行时才走命令行，被用例导入时什么都不做
const entry = process.argv[1]
if (entry !== undefined && pathToFileURL(entry).href === import.meta.url) {
  const argv = process.argv.slice(2)
  if (argv.length > 0) {
    process.stderr.write(`不认这个参数：${argv[0] ?? ''}\n`)
    process.exit(2)
  }
  process.exit(printAccept(runAccept(), text => process.stdout.write(`${text}\n`)))
}
