// 只读目录就能画一份面板：面板与离线命令共用这一处路径

import { FILES } from './files.ts'
import { renderPanel } from './panel.ts'
import { toProject, toQuestion } from './rows.ts'
import type { SelfStore } from './store.ts'
import type { PanelInput, ProjectRow, QuestionRow, SelfSettings } from './types.ts'

/**
 * 最新的一个没结束的项目
 * @param store - 目录读写口
 * @returns 一条都没有时为空
 */
export function newestOpenProject(store: SelfStore): ProjectRow | undefined {
  let picked: ProjectRow | undefined
  for (const record of store.records(FILES.projects)) {
    const row = toProject(record)
    if (row === undefined || row.outcome !== 'open') continue
    if (picked === undefined || row.at > picked.at) picked = row
  }
  return picked
}

/**
 * 最新的一条想问的事
 * @param store - 目录读写口
 * @returns 一条都没有时为空
 */
export function newestQuestion(store: SelfStore): QuestionRow | undefined {
  let picked: QuestionRow | undefined
  for (const record of store.records(FILES.questions)) {
    const row = toQuestion(record)
    if (row === undefined) continue
    if (picked === undefined || row.at > picked.at) picked = row
  }
  return picked
}

/**
 * 按目录里现有的记录画一份面板，不写盘
 * @param store - 目录读写口
 * @param settings - 参数表
 * @param moment - 此刻那一句，不给就省掉这一行
 * @returns 面板正文
 */
export function panelFromStore(store: SelfStore, settings: SelfSettings, moment?: string): string {
  const project = newestOpenProject(store)
  const question = newestQuestion(store)
  const input: PanelInput = {
    ...moment === undefined || moment === '' ? {} : { moment },
    ...project === undefined ? {} : { project: project.title, next: project.next },
    ...question === undefined ? {} : { question: question.text },
  }
  return renderPanel(input, settings)
}

/** 生成一份面板要用的东西 */
export interface GeneratePanelOptions {
  /** 目录读写口 */
  store: SelfStore
  /** 参数表 */
  settings: SelfSettings
  /** 生成时刻 */
  at: number
  /** 此刻那一句，不给就省掉这一行 */
  moment?: string
}

/**
 * 生成一份面板写进目录，只写 panel.md 这一份文件
 * @param options - 目录、参数与时刻
 * @returns 写好的文件路径
 */
export function generatePanelFile(options: GeneratePanelOptions): string {
  const body = panelFromStore(options.store, options.settings, options.moment)
  options.store.writePanel(body, options.at)
  return options.store.pathOf(FILES.panel)
}
