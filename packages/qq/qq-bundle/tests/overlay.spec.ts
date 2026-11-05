import fs from 'node:fs'
import path from 'node:path'
import { applyEntryPatches, entryListSchema, type PatchOptions } from '@huoli/cordis-plugin-include'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = path.join(import.meta.dirname, '..', '..', '..', '..')
const overlay = path.join(root, 'apps', 'web', 'overlays', 'qq-no-login.yml')
const webPatch = path.join(root, 'packages', 'bundle', 'web-app', 'cordis.patch.yml')

// 把一份 patch 读成条目补丁：与装载器同一套 schema
function patchesOf(file: string): PatchOptions[] {
  return load(fs.readFileSync(file, 'utf8'), { schema: entryListSchema }) as PatchOptions[]
}

// 底子：两行账号相关的入口，够让覆盖的那一层插得进去
const BASE = [
  { id: 'ui-settings-account', name: '@huoli/huoli-client-ui-settings-account' },
  { id: 'account-controller', name: '@huoli/huoli-api-account-controller' },
  { id: 'system-prompt', name: '@huoli/huoli-system-prompt' },
]

describe('关掉登录的覆盖层', () => {
  it('文件本身能读成补丁列表', () => {
    expect(patchesOf(overlay).length).toBeGreaterThan(0)
  })

  it('账号与登录那一行被真的关掉', () => {
    const rows = applyEntryPatches(BASE, patchesOf(overlay), () => {})

    const account = rows.find(row => row.id === 'ui-settings-account')
    const controller = rows.find(row => row.id === 'account-controller')
    expect(account?.disabled).toBe(true)
    expect(controller?.disabled).toBe(true)
  })

  it('别的行一个都不动', () => {
    const rows = applyEntryPatches(BASE, patchesOf(overlay), () => {})

    const other = rows.find(row => row.id === 'system-prompt')
    expect(other?.disabled).toBeUndefined()
    expect(rows).toHaveLength(BASE.length)
  })

  it('基线里没有这一行时只警告，不炸', () => {
    const warned: string[] = []
    const rows = applyEntryPatches([{ id: 'system-prompt', name: '@huoli/huoli-system-prompt' }], patchesOf(overlay), (message) => {
      warned.push(message)
    })

    expect(rows).toHaveLength(1)
    expect(warned.length).toBeGreaterThan(0)
  })

  it('覆盖层里的 id 在真实 web 装配里都存在', () => {
    const ids = new Set(patchesOf(webPatch).flatMap(patch => patch.insert ?? []).map(row => (row as { id?: string }).id))
    const mine = patchesOf(overlay).map(patch => patch.id)

    for (const id of mine) expect(ids.has(id), String(id)).toBe(true)
  })
})
