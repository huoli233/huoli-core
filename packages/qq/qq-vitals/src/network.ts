// 神经网：字段之间的互相影响写成加权有向图，边表与权重全在参数表里

import type { Tuning } from './defaults.ts'
import { clamp } from './math.ts'
import type { NetworkEdge, NetworkField, VitalsState } from './types.ts'

/** 一次传播的结果 */
export interface NetworkPass {
  /** 被边指到的字段的下一拍目标值，已夹到 0~1 */
  readonly targets: ReadonlyMap<NetworkField, number>
  /** 每个字段这一拍收到的净影响，负数是往下压 */
  readonly deltas: ReadonlyMap<NetworkField, number>
}

/** 没有边时的结果：一张空表，字段都按原值走 */
const EMPTY_PASS: NetworkPass = { targets: new Map(), deltas: new Map() }

// 一条边这一拍给出的影响：方向定正负，单拍不超过 cap
function influenceOf(edge: NetworkEdge, source: number): number {
  const magnitude = Math.min(Math.abs(edge.weight * source), edge.cap)
  return edge.mode === 'push' ? magnitude : -magnitude
}

/**
 * 按边表把影响叠加到下一拍的目标值上
 * @param state - 这一拍的字段值，边的源头从这里读
 * @param tuning - 参数，边表取 `networkEdges`
 * @param steps - 传播几轮，默认一轮，多轮时上一轮的目标值就是下一轮的源头
 * @returns 目标值与净影响，两者只含被边指到的字段
 */
export function propagate(state: VitalsState, tuning: Tuning, steps = 1): NetworkPass {
  if (tuning.networkEdges.length === 0 || steps < 1) return EMPTY_PASS
  const targets = new Map<NetworkField, number>()
  const deltas = new Map<NetworkField, number>()
  // 这一轮看到的字段值：被指到过的取上一轮结果，其余取原值
  const current = (field: NetworkField): number => targets.get(field) ?? state[field]
  for (let step = 0; step < steps; step += 1) {
    const added = new Map<NetworkField, number>()
    for (const edge of tuning.networkEdges) {
      const influence = influenceOf(edge, current(edge.from))
      added.set(edge.to, (added.get(edge.to) ?? 0) + influence)
      deltas.set(edge.to, (deltas.get(edge.to) ?? 0) + influence)
    }
    // 一轮只夹一次：同一目标收到多条边时先加总，再夹到零到一
    for (const [field, influence] of added) targets.set(field, clamp(current(field) + influence))
  }
  return { targets, deltas }
}

/**
 * 取某个字段这一拍收到的净影响
 * @param pass - 传播结果
 * @param field - 字段名
 * @returns 净影响，没被边指到时为零
 */
export function deltaOf(pass: NetworkPass, field: NetworkField): number {
  return pass.deltas.get(field) ?? 0
}

/**
 * 当前边表的抄本，供排障与文档用，不进提示词
 * @param tuning - 参数
 * @returns 边表抄本，改它不影响参数
 */
export function describeNetwork(tuning: Tuning): readonly NetworkEdge[] {
  return tuning.networkEdges.map(edge => ({ ...edge }))
}
