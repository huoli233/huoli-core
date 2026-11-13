// 写入前的两道校验：来源只认五档，metadata 只收键为字符串的对象

import { MEMORY_SOURCES, type MemoryItem, type MemoryLayer, type MemorySource } from './types.ts'

/** 私密写入落库前解析出的用户范围 */
export interface PrivateCoordinates {
  scope: string
  personId: string
  originScope?: string
}

/** 校验私密写入并解析安全范围
 * @param chatKey - 写入发生的会话
 * @param layer - 目标记忆层
 * @param secret - 是否明确标为私密
 * @param givenPersonId - 调用方给的用户编号
 * @returns 私密写入坐标；普通记忆返回 undefined
 */
export function privateCoordinatesOf(
  chatKey: string,
  layer: MemoryLayer,
  secret: boolean | undefined,
  givenPersonId?: string,
): PrivateCoordinates | undefined {
  if (layer !== 'private' && secret !== true) return undefined
  if (layer !== 'private') {
    throw new Error('memory.secret_layer: 不想让人知道的事要放 private 那一层｜下一步: 把 layer 填 private')
  }
  if (secret !== true) {
    throw new Error('memory.private_secret_required: private 那一层必须把 secret 填 true｜下一步: 明确标记这条私密记忆')
  }
  const chatPersonId = chatKey.startsWith('private:') ? chatKey.slice('private:'.length).trim() : ''
  const personId = givenPersonId?.trim() || chatPersonId
  if (personId === '') {
    throw new Error('memory.private_person_required: 私密记忆要能对应到一个用户｜下一步: 在私聊里记，或在群聊里给出 personId')
  }
  if (chatPersonId !== '' && personId !== chatPersonId) {
    throw new Error('memory.private_person_mismatch: 私密记忆的用户编号要和当前私聊对象一致｜下一步: 使用当前私聊对象的 personId')
  }
  return {
    scope: `private:${personId}`,
    personId,
    ...chatPersonId === '' ? { originScope: chatKey } : {},
  }
}

/** 拒绝没有用户私聊范围的私密记忆
 * @param item - 即将保存的记忆
 * @returns 不返回值；不符合约束时抛出错误
 */
export function assertPrivateMemoryItem(item: MemoryItem): void {
  if (item.layer !== 'private' && item.secret !== true) return
  if (item.layer !== 'private') {
    throw new Error('memory.secret_layer: 不想让人知道的事要放 private 那一层｜下一步: 把 layer 填 private')
  }
  if (item.secret !== true) {
    throw new Error('memory.private_secret_required: private 那一层必须把 secret 填 true｜下一步: 明确标记这条私密记忆')
  }
  const personId = item.personId?.trim() ?? ''
  if (personId === '') {
    throw new Error('memory.private_person_required: 私密记忆要能对应到一个用户｜下一步: 提供 personId')
  }
  if (personId !== item.personId) {
    throw new Error('memory.private_person_invalid: personId 前后不能带空白｜下一步: 提供不带首尾空白的用户编号')
  }
  if (item.scope !== `private:${personId}`) {
    throw new Error('memory.private_scope: 私密记忆只能存进对应用户的私聊范围｜下一步: 使用 private:<personId> 作为 scope')
  }
}

/**
 * 层名只认四个合法值，别的值给 undefined 由调用方回落到默认
 * @param value - 调用方给的值
 * @returns 合法的层，认不出时是 undefined
 */
export function layerOr(value: unknown): MemoryLayer | undefined {
  const body = typeof value === 'string' ? value.trim() : ''
  if (body === 'ephemeral' || body === 'episodic' || body === 'semantic' || body === 'private') return body
  return undefined
}

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

/** 重要度刻度的下限，与记忆规范同一把尺 */
export const IMPORTANCE_MIN = 1

/** 重要度刻度的上限，与记忆规范同一把尺 */
export const IMPORTANCE_MAX = 100

/**
 * 重要度夹到 1 到 100 的整数
 * @param value - 想写的值
 * @param fallback - 没给时用哪个
 * @returns 夹好的整数
 */
export function clampImportance(value: number | undefined, fallback: number): number {
  const raw = value === undefined || !Number.isFinite(value) ? fallback : value
  return Math.min(IMPORTANCE_MAX, Math.max(IMPORTANCE_MIN, Math.round(raw)))
}
