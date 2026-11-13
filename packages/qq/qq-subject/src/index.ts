// 状态装配入口：把状态写成一段话，放进每轮提示词

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import '@huoli/huoli-system-prompt'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { createSubjectStore, type SubjectStore } from './store.ts'
import { renderSelfSnapshot, SNAPSHOT_DEFAULTS, type SnapshotInput } from './snapshot.ts'
import {
  createRelationStore,
  RELATION_DEFAULTS,
  renderRelationFacts,
  type RelationStore,
} from './relations.ts'
import { registerRelationTools } from './tools.ts'

export type { ChatState, GlobalState, SubjectState } from './state.ts'
export { emptyChat, emptySubject, familiarityWord, moodWord, tickGlobal } from './state.ts'
export type { SnapshotInput } from './snapshot.ts'
export { renderSelfSnapshot } from './snapshot.ts'
export type { SubjectStore, SubjectStoreOptions } from './store.ts'
export type {
  FeelingEvidence,
  FeelingFact,
  FeelingView,
  NameCallTag,
  NameTagStance,
  NameTagView,
  PersonObservation,
  PersonRelation,
  RelationAnniversary,
  RelationEvent,
  RelationEventKind,
  RelationState,
  RelationStore,
  RelationStoreOptions,
} from './relations.ts'
export {
  createRelationStore,
  RELATION_DEFAULTS,
  RELATION_EVENT_KINDS,
  relationLabel,
  relationWord,
  renderRelationFacts,
  stanceForNameHits,
} from './relations.ts'

/** 一个应用里的状态仓 */
export interface QqSubjectSeam {
  store: SubjectStore
  relations: RelationStore
  render(chatKey?: string, thoughts?: readonly string[]): string
  renderRelation(personId: string, chatKey: string, now?: number): string
  /** 碰到没见过的话题：把好奇心抬一点，抬到顶就夹住 */
  noteNovelty(at: number): void
}

/** 这一行接受的配置 */
export interface Config {
  /** 状态存哪，不填就用主目录下的 data */
  file?: string
  /** 覆盖主目录，不填按 HUOLI_HOME 定 */
  home?: string
  /** 一段状态最多写多少字 */
  maxChars?: number
  /** 每个群叫什么名字，写快照时用 */
  chatNames?: Record<string, string>
  /** 一次陌生话题把好奇心抬多少，默认零点一二 */
  curiosityNoveltyGain?: number
  /** 关系资料放哪 */
  relationFile?: string
  /** 每看到一次关系涨多少 */
  relationFamiliarityGain?: number
  /** 一次有把握的亲近或疏远让好感变多少 */
  relationFeelingAffectionGain?: number
  /** 一次有把握的信任变化让信任变多少 */
  relationFeelingTrustGain?: number
  /** 一次有把握的烦躁变化让烦躁变多少 */
  relationFeelingAnnoyanceGain?: number
  /** 情绪事实多久减半 */
  relationFeelingHalfLifeMs?: number
  /** 情绪事实多久忘掉 */
  relationFeelingForgetMs?: number
  /** 有证据的情绪判读至少多少把握才保存 */
  relationFeelingEvidenceFrom?: number
  /** 最多留几条情绪事实 */
  relationMaxFeelingFacts?: number
  /** 关系提示最多列几条仍有效的情绪事实 */
  relationFeelingPromptLimit?: number
  /** 外号次数按多久折半 */
  relationNicknameHalfLifeMs?: number
  /** 外号多久没再叫就忘掉 */
  relationNicknameForgetMs?: number
  /** 一个人最多记几个外号 */
  relationMaxNicknameTags?: number
  /** 一个人最多留几个别名 */
  relationMaxAliases?: number
  /** 最多留几条关系事件 */
  relationMaxEvents?: number
  /** 最多留几个纪念日 */
  relationMaxAnniversaries?: number
  /** 提前几天提示纪念日 */
  relationUpcomingDays?: number
  /** 关系提示最多多少字 */
  relationPromptMaxChars?: number
}

const seams = new WeakMap<Context, QqSubjectSeam>()

/**
 * 取状态仓，未装配时为 undefined
 * @param ctx - 运行环境
 * @returns 处理结果
 */
export function qqSubjectOf(ctx: Context): QqSubjectSeam | undefined {
  return seams.get(ctx.root) ?? seams.get(ctx)
}

/** 插件的行名 */
export const name = 'qq-subject'

/** 要用的内核接口 */
export const inject = ['systemPrompt', 'tools']

// 提示词里留的那个名字
const VARIABLE = 'qq_self'

/**
 * 装配状态与提示词那一段
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const file = config.file ?? path.join(resolveHuoliHome(config.home), 'data', 'qq-subject.json')
  const maxChars = Math.max(SNAPSHOT_DEFAULTS.minChars, config.maxChars ?? SNAPSHOT_DEFAULTS.maxChars)
  const chatNames = config.chatNames ?? {}
  const store = createSubjectStore({ file })
  const curiosityGain = config.curiosityNoveltyGain ?? 0.12
  const relationFile = config.relationFile ?? path.join(path.dirname(file), 'qq-relations.json')
  const relations = createRelationStore({
    file: relationFile,
    familiarityGain: config.relationFamiliarityGain ?? RELATION_DEFAULTS.familiarityGain,
    feelingAffectionGain: config.relationFeelingAffectionGain ?? RELATION_DEFAULTS.feelingAffectionGain,
    feelingTrustGain: config.relationFeelingTrustGain ?? RELATION_DEFAULTS.feelingTrustGain,
    feelingAnnoyanceGain: config.relationFeelingAnnoyanceGain ?? RELATION_DEFAULTS.feelingAnnoyanceGain,
    feelingHalfLifeMs: config.relationFeelingHalfLifeMs ?? RELATION_DEFAULTS.feelingHalfLifeMs,
    feelingForgetMs: config.relationFeelingForgetMs ?? RELATION_DEFAULTS.feelingForgetMs,
    feelingEvidenceFrom: config.relationFeelingEvidenceFrom ?? RELATION_DEFAULTS.feelingEvidenceFrom,
    maxFeelingFacts: config.relationMaxFeelingFacts ?? RELATION_DEFAULTS.maxFeelingFacts,
    nicknameHalfLifeMs: config.relationNicknameHalfLifeMs ?? RELATION_DEFAULTS.nicknameHalfLifeMs,
    nicknameForgetMs: config.relationNicknameForgetMs ?? RELATION_DEFAULTS.nicknameForgetMs,
    maxNicknameTags: config.relationMaxNicknameTags ?? RELATION_DEFAULTS.maxNicknameTags,
    maxAliases: config.relationMaxAliases ?? RELATION_DEFAULTS.maxAliases,
    maxEvents: config.relationMaxEvents ?? RELATION_DEFAULTS.maxEvents,
    maxAnniversaries: config.relationMaxAnniversaries ?? RELATION_DEFAULTS.maxAnniversaries,
  })
  ctx.effect(() => registerRelationTools(ctx, relations))

  const seam: QqSubjectSeam = {
    store,
    relations,
    // 陌生话题抬一点好奇心：这是它唯一的上升来源，衰减由策略那一层管
    noteNovelty() {
      store.changeGlobal('curiosity', curiosityGain)
    },
    render(chatKey, thoughts) {
      const state = store.read()
      const key = chatKey ?? state.lastActive
      const input: SnapshotInput = {
        global: state.global,
        ...key !== '' ? { chat: store.forChat(key) } : {},
        ...key !== '' && chatNames[key] !== undefined ? { chatName: chatNames[key] } : {},
        ...thoughts !== undefined ? { thoughts } : {},
        maxChars,
      }
      return renderSelfSnapshot(input)
    },
    renderRelation(personId, chatKey, at = Date.now()) {
      const person = relations.get(personId)
      if (person === undefined) return ''
      return renderRelationFacts(
        person,
        relations.events(personId, 5),
        relations.upcoming({ at, personId, days: config.relationUpcomingDays ?? RELATION_DEFAULTS.upcomingDays, limit: 3 }),
        at,
        config.relationPromptMaxChars ?? RELATION_DEFAULTS.promptMaxChars,
        relations.nameTags(personId, chatKey, at),
        relations.feelings({ personId, chatKey, at, limit: config.relationFeelingPromptLimit ?? 2 }),
      )
    },
  }
  seams.set(ctx.root, seam)

  ctx.systemPrompt.section({
    name: 'qq:self',
    order: 320,
    text: `【此刻的我】{{${VARIABLE}}}`,
  })

  ctx.systemPrompt.variable(VARIABLE, () => {
    const state = store.read()
    if (state.lastActive === '') return '还没有聊过天。'
    const input: SnapshotInput = {
      global: state.global,
      chat: store.forChat(state.lastActive),
      ...chatNames[state.lastActive] !== undefined ? { chatName: chatNames[state.lastActive] } : {},
      maxChars,
    }
    const text = renderSelfSnapshot(input)
    return text.startsWith('【此刻的我】') ? text.slice('【此刻的我】'.length).trim() : text
  })

  const flushTimer = setInterval(() => {
    store.flush()
    relations.flush()
  }, 15_000)
  flushTimer.unref()

  // 卸载时把状态写一次盘
  ctx.effect(() => () => {
    clearInterval(flushTimer)
    store.flush()
    relations.flush()
    seams.delete(ctx.root)
  })
}
