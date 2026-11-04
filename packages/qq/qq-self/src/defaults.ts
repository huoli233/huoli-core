// 这一层的参数表：改参数只改这张表，Config.settings 能逐项覆盖

import path from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { DRIVE_NEEDS } from './rows.ts'
import type { PanelLabels, SelfSettings } from './types.ts'

// 面板的抬头，四处只认这四类内容
const LABELS: PanelLabels = {
  header: '【自我】',
  moment: '此刻：',
  doing: '我在做：',
  next: '下一步：',
  question: '我想弄明白：',
  refuse: '我可以说不，也可以说不知道。',
}

// 身份级动作：只有清单里的名字逐字出现，才谈得上两把钥匙
const IDENTITY_ACTIONS: readonly string[] = [
  'identity.constitution',
  'identity.narrative',
  'identity.relationship',
  'identity.level',
  'memory.delete',
  'money.spend',
  'public.say',
  'public.comment',
  'public.direct',
]

// 阶段的先后：比高低只看这张表的次序，认不出的写法按不到下限算
const STAGES: readonly string[] = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5a', 'P5b', 'P5c']

/** 默认值都在这张表里，改默认值只改这里 */
export const DEFAULTS: SelfSettings = {
  panelMaxChars: 300,
  panelMaxAgeMs: 24 * 60 * 60 * 1000,
  momentMaxChars: 120,
  projectMaxChars: 40,
  nextMaxChars: 40,
  questionMaxChars: 60,
  didMaxChars: 40,
  verbatimMaxChars: 60,
  claimMaxChars: 200,
  claimEvidenceMax: 3,
  commitmentMaxChars: 200,
  dayLines: 3,
  dayLineMaxChars: 60,
  errorMaxChars: 200,
  narrativeParaMaxChars: 150,
  narrativeParasMax: 3,
  openProjectMax: 2,
  questionPerWeekMax: 1,
  weekMs: 7 * 24 * 60 * 60 * 1000,
  auditFailedWindowMs: 14 * 24 * 60 * 60 * 1000,
  mirrorImportance: 80,
  mirrorMaxChars: 500,
  mirrorScope: 'self:layer',
  driveNeeds: DRIVE_NEEDS,
  identityActions: IDENTITY_ACTIONS,
  stage: 'P0',
  publicMinStage: 'P3',
  privateMinStage: 'P3',
  stages: STAGES,
  sectionName: 'qq:self-layer',
  variableName: 'qq_self_panel',
  sectionOrder: 360,
  labels: LABELS,
}

/** 数据根目录下这一层独占的目录名 */
export const DIR_NAME = 'qq-self'

/**
 * 把配置里的覆盖项并到默认值上
 * @param overrides - 想改的那几项
 * @returns 完整的参数表
 */
export function resolveSettings(overrides?: Partial<SelfSettings>): SelfSettings {
  if (overrides === undefined) return DEFAULTS
  return {
    ...DEFAULTS,
    ...overrides,
    labels: { ...DEFAULTS.labels, ...(overrides.labels ?? {}) },
  }
}

/** 定 SELF_DIR 用的两项 */
export interface SelfDirOptions {
  /** 直接给定整个目录，给了就不看数据根目录 */
  dir?: string | undefined
  /** 数据根目录，不给就用默认的家目录 */
  huoliHome?: string | undefined
}

/**
 * 定这一层独占的目录
 * @param options - 目录覆盖与数据根目录
 * @returns 目录绝对路径
 */
export function resolveSelfDir(options: SelfDirOptions = {}): string {
  if (options.dir !== undefined && options.dir !== '') return options.dir
  return path.join(resolveHuoliHome(options.huoliHome), 'data', DIR_NAME)
}
