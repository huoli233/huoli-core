// 素材装配入口：把现场摊开、把惦记的事记下来

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import { collectMaterial, renderMaterial, type CollectInput, type Material } from './collect.ts'
import { createThoughtStore, type ThoughtStore } from './thought.ts'
import { registerMaterialTools } from './tools.ts'

export type { Addressee, CollectInput, Material, Motive, Situation, Thought, Topic } from './collect.ts'
export { collectMaterial, renderMaterial, THOUGHT_TTL_MS } from './collect.ts'
export type { ThoughtStore, ThoughtStoreOptions } from './thought.ts'

/** 一个应用里的素材仓 */
export interface QqMaterialSeam {
  thoughts: ThoughtStore
  gather(input: Omit<CollectInput, 'now'>): Material
  render(material: Material): string
}

/** 这一行接受的配置 */
export interface Config {
  /** 惦记的事存哪 */
  thoughtsFile?: string
}

const seams = new WeakMap<Context, QqMaterialSeam>()

/**
 * 取素材仓，未装配时为 undefined
 * @param ctx - 运行环境
 * @returns 处理结果
 */
export function qqMaterialOf(ctx: Context): QqMaterialSeam | undefined {
  return seams.get(ctx)
}

/** 插件的行名 */
export const name = 'qq-material'

/** 要用的内核接口 */
export const inject = ['tools']

/**
 * 装配素材与两个念头工具
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const file = config.thoughtsFile ?? path.join(process.cwd(), 'data', 'qq-thoughts.json')
  const thoughts = createThoughtStore({ file })

  const seam: QqMaterialSeam = {
    thoughts,
    gather(input) {
      const material = collectMaterial({ ...input, now: Date.now() })
      const live = thoughts.live(input.chatKey)
      return { ...material, thoughts: live }
    },
    render(material) {
      return renderMaterial(material)
    },
  }
  seams.set(ctx, seam)

  registerMaterialTools(ctx, { thoughts })

  // 卸载时落一次盘
  ctx.effect(() => () => {
    thoughts.flush()
    seams.delete(ctx)
  })
}
