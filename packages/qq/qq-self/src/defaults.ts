// 这一层的参数表：改参数只改这张表，Config.settings 能逐项覆盖

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
  openProjectMax: 2,
  questionPerWeekMax: 1,
  weekMs: 7 * 24 * 60 * 60 * 1000,
  driveNeeds: DRIVE_NEEDS,
  identityActions: IDENTITY_ACTIONS,
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
