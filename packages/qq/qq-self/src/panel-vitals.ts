// 面板画条要用的那几个数：只给身体递进来的读数取名字、收边界，不另算一套

import type { PanelEmotionBar, PanelVitals, VitalsPort, VitalsReadout } from './types.ts'

// 收进零到一：不是有限数就当这一项没有，宁可整块省掉也不画一条假的
function unit(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(1, Math.max(0, value))
}

// 混合层每一条只留来由与权重，来由为空也留着，条数要与混合层对得上
function barsOf(readout: VitalsReadout): PanelEmotionBar[] | undefined {
  const blend = readout.emotion_blend
  if (blend === undefined || blend.length === 0) return undefined
  return blend.map(line => ({ why: line.why, weight: unit(line.weight) ?? 0 }))
}

// 体温这类绝对值：是这个数就给，体温画曲线时按 (t−36)/3 归一，这里只交原值
function temperature(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

// 天数这类计数：有限且不小于零才算有
function count(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.floor(value)
}

/**
 * 把身体那一面翻成面板画条要用的读数
 * @param port - 身体那一面，没接上时为 undefined
 * @returns 只带得出数的项；没有端口、端口不给读数或一项都取不出时不给
 */
export function panelVitalsOf(port: VitalsPort | undefined): PanelVitals | undefined {
  if (port === undefined || port.read === undefined) return undefined
  const readout = port.read()
  const thirst = unit(readout.thirst)
  const energy = unit(readout.energy)
  // 心情、无聊、想说话、累是面板上的叫法，取的还是身体算好的那几个算出来的量
  const mood = unit(readout.valence)
  const boredom = unit(readout.loneliness)
  const socialHunger = unit(readout.proactive_bias)
  const hunger = unit(readout.hunger)
  const anger = unit(readout.anger)
  const resentment = unit(readout.resentment)
  const tired = unit(readout.adenosine)
  const cycleDay = count(readout.cycle_day)
  const cycleLen = count(readout.cycle_len)
  const cyclePhase = typeof readout.cycle_phase === 'string' && readout.cycle_phase !== '' ? readout.cycle_phase : undefined
  const cycleBounds = port.bounds?.()
  const pairs = port.pairs?.()
  const temp = temperature(readout.core_temp)
  const fever = unit(readout.fever)
  const immunity = unit(readout.cytokines)
  const pain = unit(readout.pain)
  const estrogen = unit(readout.estrogen)
  const progesterone = unit(readout.progesterone)
  const emotion = barsOf(readout)
  const numbers = [
    thirst, energy, mood, boredom, socialHunger, hunger, anger, resentment, tired,
    fever, immunity, pain, estrogen, progesterone,
  ]
  if (numbers.every(value => value === undefined) && emotion === undefined && cycleDay === undefined
    && (pairs === undefined || pairs.length === 0)) return undefined
  return {
    ...thirst === undefined ? {} : { thirst },
    ...energy === undefined ? {} : { energy },
    ...mood === undefined ? {} : { mood },
    ...boredom === undefined ? {} : { boredom },
    ...socialHunger === undefined ? {} : { socialHunger },
    ...hunger === undefined ? {} : { hunger },
    ...anger === undefined ? {} : { anger },
    ...resentment === undefined ? {} : { resentment },
    ...tired === undefined ? {} : { tired },
    ...cycleDay === undefined ? {} : { cycleDay },
    ...cycleLen === undefined ? {} : { cycleLen },
    ...cyclePhase === undefined ? {} : { cyclePhase },
    ...cycleBounds === undefined || cycleBounds.length === 0 ? {} : { cycleBounds },
    ...temp === undefined ? {} : { temp },
    ...fever === undefined ? {} : { fever },
    ...immunity === undefined ? {} : { immunity },
    ...pain === undefined ? {} : { pain },
    ...estrogen === undefined ? {} : { estrogen },
    ...progesterone === undefined ? {} : { progesterone },
    ...emotion === undefined ? {} : { emotion },
    ...pairs === undefined || pairs.length === 0 ? {} : { pairs },
  }
}
