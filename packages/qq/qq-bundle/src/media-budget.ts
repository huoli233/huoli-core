// 图片和视频的自动识别共用一份小时、每日与体力预算

import fs from 'node:fs'
import path from 'node:path'
import type { QqVitalsSeam } from '@huoli/huoli-qq-vitals'
import type { Config } from './types.ts'
import { BUNDLE_DEFAULTS } from './defaults.ts'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const KEEP_MS = 8 * DAY_MS

type MediaKind = 'image' | 'video'

interface MediaUse {
  at: number
  kind: MediaKind
  group: boolean
  count: number
  key?: string
}

interface StoredMediaBudget {
  version: 1
  uses: MediaUse[]
}

export interface MediaBudgetInput {
  kind: MediaKind
  at: number
  group: boolean
  /** 同一图片或视频只记一笔，便于预处理与视觉路由共用 */
  key?: string
}

export interface MediaBudgetDecision {
  ok: boolean
  code?: string
  reason?: string
  hourUsed: number
  hourMax: number
  dayUsed: number
  dayMax: number
  energy: number
}

export interface MediaCapacity {
  energy: number
  sleepState: string
  imageHourRemaining: number
  imageDayRemaining: number
  videoHourRemaining: number
  videoDayRemaining: number
  groupImageHourRemaining: number
  groupVideoHourRemaining: number
}

export interface MediaBudget {
  consume(input: MediaBudgetInput): MediaBudgetDecision
  capacity(at: number, group: boolean): MediaCapacity
  prompt(): string
  flush(): void
}

export interface MediaBudgetOptions {
  file: string
  config: Config
  vitals: QqVitalsSeam | undefined
  now?: () => number
}

function load(file: string): StoredMediaBudget {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (value === null || typeof value !== 'object') return { version: 1, uses: [] }
    const row = value as { version?: unknown; uses?: unknown }
    if (row.version !== 1 || !Array.isArray(row.uses)) return { version: 1, uses: [] }
    return {
      version: 1,
      uses: row.uses.filter((item): item is MediaUse => item !== null
        && typeof item === 'object'
        && typeof (item as Partial<MediaUse>).at === 'number'
        && typeof (item as Partial<MediaUse>).count === 'number'
        && ((item as Partial<MediaUse>).kind === 'image' || (item as Partial<MediaUse>).kind === 'video')),
    }
  } catch {
    return { version: 1, uses: [] }
  }
}

function save(file: string, state: StoredMediaBudget): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

function countOf(uses: readonly MediaUse[], input: MediaBudgetInput, since: number, groupOnly: boolean): number {
  return uses
    .filter(use => use.at > since && use.kind === input.kind && (!groupOnly || use.group))
    .reduce((sum, use) => sum + use.count, 0)
}

function maxOf(kind: MediaKind, group: boolean, config: Config): { hour: number; day: number } {
  if (kind === 'video') {
    return {
      hour: Math.max(1, Math.floor(group
        ? config.groupVideoRecognitionsPerHour ?? BUNDLE_DEFAULTS.groupVideoRecognitionsPerHour
        : config.videoRecognitionsPerHour ?? BUNDLE_DEFAULTS.videoRecognitionsPerHour)),
      day: Math.max(1, Math.floor(config.videoRecognitionsPerDay ?? BUNDLE_DEFAULTS.videoRecognitionsPerDay)),
    }
  }
  return {
    hour: Math.max(1, Math.floor(group
      ? config.groupImageRecognitionsPerHour ?? BUNDLE_DEFAULTS.groupImageRecognitionsPerHour
      : config.imageRecognitionsPerHour ?? BUNDLE_DEFAULTS.imageRecognitionsPerHour)),
    day: Math.max(1, Math.floor(config.imageRecognitionsPerDay ?? BUNDLE_DEFAULTS.imageRecognitionsPerDay)),
  }
}

function minEnergyOf(kind: MediaKind, config: Config): number {
  return Math.min(1, Math.max(0, kind === 'video'
    ? config.videoRecognitionMinEnergy ?? BUNDLE_DEFAULTS.videoRecognitionMinEnergy
    : config.imageRecognitionMinEnergy ?? BUNDLE_DEFAULTS.imageRecognitionMinEnergy))
}

/**
 * 建媒体识别预算。
 * @param options 文件、配置与身体读数
 * @returns 可查询、消耗和渲染事实的预算
 */
export function createMediaBudget(options: MediaBudgetOptions): MediaBudget {
  const now = options.now ?? (() => Date.now())
  const state = load(options.file)

  const prune = (at: number): void => {
    state.uses = state.uses.filter(use => use.at > at - KEEP_MS)
  }

  const capacity = (at: number, group: boolean): MediaCapacity => {
    prune(at)
    const body = options.vitals?.read()
    const image = maxOf('image', group, options.config)
    const video = maxOf('video', group, options.config)
    const imageInput: MediaBudgetInput = { kind: 'image', at, group }
    const videoInput: MediaBudgetInput = { kind: 'video', at, group }
    const imageHour = countOf(state.uses, imageInput, at - HOUR_MS, group)
    const imageDay = countOf(state.uses, imageInput, at - DAY_MS, false)
    const videoHour = countOf(state.uses, videoInput, at - HOUR_MS, group)
    const videoDay = countOf(state.uses, videoInput, at - DAY_MS, false)
    const groupImageMax = configNumber(
      options.config.groupImageRecognitionsPerHour,
      BUNDLE_DEFAULTS.groupImageRecognitionsPerHour,
    )
    const groupVideoMax = configNumber(
      options.config.groupVideoRecognitionsPerHour,
      BUNDLE_DEFAULTS.groupVideoRecognitionsPerHour,
    )
    return {
      energy: body?.energy ?? 0,
      sleepState: body?.sleep_state ?? 'unknown',
      imageHourRemaining: Math.max(0, image.hour - imageHour),
      imageDayRemaining: Math.max(0, image.day - imageDay),
      videoHourRemaining: Math.max(0, video.hour - videoHour),
      videoDayRemaining: Math.max(0, video.day - videoDay),
      groupImageHourRemaining: Math.max(0, groupImageMax - countOf(state.uses, imageInput, at - HOUR_MS, true)),
      groupVideoHourRemaining: Math.max(0, groupVideoMax - countOf(state.uses, videoInput, at - HOUR_MS, true)),
    }
  }

  return {
    consume(input) {
      const body = options.vitals?.read()
      const energy = body?.energy ?? 0
      const limits = maxOf(input.kind, input.group, options.config)
      const hourUsed = countOf(state.uses, input, input.at - HOUR_MS, input.group)
      const dayUsed = countOf(state.uses, input, input.at - DAY_MS, false)
      const base = { hourUsed, hourMax: limits.hour, dayUsed, dayMax: limits.day, energy }
      if (input.key !== undefined && state.uses.some(use => use.kind === input.kind && use.key === input.key)) {
        return { ...base, ok: true }
      }
      if (body?.sleep_state === 'sleeping') {
        return { ...base, ok: false, code: 'media.body_resting', reason: '身体正在睡觉，自动媒体识别先缓存' }
      }
      if (energy < minEnergyOf(input.kind, options.config)) {
        return { ...base, ok: false, code: 'media.low_energy', reason: '当前精力低于自动媒体识别门槛' }
      }
      if (hourUsed >= limits.hour) {
        return { ...base, ok: false, code: 'media.hour_full', reason: '这一小时的自动媒体识别次数已经用完' }
      }
      if (dayUsed >= limits.day) {
        return { ...base, ok: false, code: 'media.day_full', reason: '今天的自动媒体识别次数已经用完' }
      }
      prune(input.at)
      state.uses.push({
        at: input.at,
        kind: input.kind,
        group: input.group,
        count: 1,
        ...input.key === undefined ? {} : { key: input.key },
      })
      save(options.file, state)
      return { ...base, ok: true, hourUsed: hourUsed + 1, dayUsed: dayUsed + 1 }
    },
    capacity,
    prompt() {
      const at = now()
      const body = options.vitals?.read()
      const privateCapacity = capacity(at, false)
      const groupCapacity = capacity(at, true)
      return [
        '[DATA] QQ_MEDIA_CAPACITY',
        `ENERGY: ${(body?.energy ?? 0).toFixed(2)}`,
        `SLEEP_STATE: ${body?.sleep_state ?? 'unknown'}`,
        `IMAGE_REMAINING: private_hour=${privateCapacity.imageHourRemaining} private_day=${privateCapacity.imageDayRemaining} group_hour=${groupCapacity.groupImageHourRemaining}`,
        `VIDEO_REMAINING: private_hour=${privateCapacity.videoHourRemaining} private_day=${privateCapacity.videoDayRemaining} group_hour=${groupCapacity.groupVideoHourRemaining}`,
        'RULE: media_budget_limits_automatic_vision_and_video_analysis; cached_media_can_be_requested_explicitly; low_energy_is_not_permission_to_ignore_a_direct_private_message',
      ].join('\n')
    },
    flush() {
      prune(now())
      save(options.file, state)
    },
  }
}

function configNumber(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.floor(value ?? fallback))
}
