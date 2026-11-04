// 写入前的两道校验：来源只认五档，metadata 只收键为字符串的对象

import { MEMORY_SOURCES, type MemorySource } from './types.ts'

/**
 * 来源只认五档，别的一概拒写
 * @param value - 调用方给的值
 * @param fallback - 没给时用哪一档
 * @returns 合法的来源
 */
export function sourceOr(value: unknown, fallback: MemorySource): MemorySource {
  if (value === undefined) return fallback
  if (typeof value === 'string' && (MEMORY_SOURCES as readonly string[]).includes(value)) return value as MemorySource
  throw new Error(`memory.source_unknown: 来源只认 ${MEMORY_SOURCES.join('、')}｜下一步: 从这五档里挑一个`)
}

/**
 * metadata 必须是对象，键必须是非空字符串
 * @param value - 调用方给的值
 * @returns 合规的 metadata，没给时为 undefined
 */
export function metadataOr(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('memory.metadata_invalid: metadata 要是对象｜下一步: 传一个对象，或者干脆不传')
  }
  const bad = Reflect.ownKeys(value).find(key => typeof key !== 'string' || key.trim() === '')
  if (bad !== undefined) {
    throw new Error('memory.metadata_invalid: metadata 的键要是非空字符串｜下一步: 换个键名')
  }
  return value as Record<string, unknown>
}

/**
 * 重要度夹到 1 到 100 的整数
 * @param value - 想写的值
 * @param fallback - 没给时用哪个
 * @returns 夹好的整数
 */
export function clampImportance(value: number | undefined, fallback: number): number {
  const raw = value === undefined || !Number.isFinite(value) ? fallback : value
  return Math.min(100, Math.max(1, Math.round(raw)))
}
