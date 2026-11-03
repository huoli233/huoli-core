/**
 * The worker's process shim: the layout-derived environment and the Node 22
 * `getBuiltinModule` face, which must answer the loader's module proxies for
 * builtin ids and undefined for everything else — never an image resolution.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { installProcessGlobal } from '../../src/node/globals/process.ts'
import { setActiveModuleLoader, WorkerModuleLoader } from '../../src/module-system/module-loader.ts'
import { MemoryVfs } from '../../src/storage/memory.ts'
import { spawnSync } from '../../src/node/builtin_modules/implemented/child_process.ts'

const realProcess = globalThis.process

afterEach(() => {
  ;(globalThis as { process: unknown }).process = realProcess
})

describe('process shim', () => {
  it('supplies the Node global alias in a worker-like environment', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'global')
    try {
      Reflect.deleteProperty(globalThis, 'global')
      const shim = installProcessGlobal({ cwd: '/huoli', env: {} })
      expect(globalThis.global).toBe(globalThis)
      expect(globalThis.global.process).toBe(shim)
    } finally {
      if (original === undefined) Reflect.deleteProperty(globalThis, 'global')
      else Object.defineProperty(globalThis, 'global', original)
    }
  })

  it('publishes cwd, env, and the Node release its internal modules follow', () => {
    const shim = installProcessGlobal({ cwd: '/huoli', env: { HUOLI_HOME: '/huoli/home' } })
    expect(shim.cwd()).toBe('/huoli')
    expect(shim.env.HUOLI_HOME).toBe('/huoli/home')
    expect(shim.title).toBe('huoli-webworker')
    // The vendored Loader reaches Node internals from Node 22 on; execArgv carries no --expose-internals.
    expect(shim.versions.node).toBe('24.18.0')
    expect(shim.execArgv).toEqual([])
  })

  it('exposes an executable identity without enabling Node programs', () => {
    const shim = installProcessGlobal({ cwd: '/huoli', env: {} })
    expect(shim.execPath).toBe('/huoli/bin/node')
    // No entry script: consumers that read argv[1] as the main module find none.
    expect(shim.argv).toEqual([shim.execPath])
    expect(spawnSync(shim.execPath, ['--eval', 'throw new Error("must not execute")']).error?.code).toBe('ENOENT')
  })

  it('answers getBuiltinModule from the module proxies and undefined otherwise', () => {
    const fs = { marker: 'fs-proxy' }
    // The table holds factories, and a builtin must keep one identity across
    // requires (`instanceof`, `Buffer.isBuffer`), so this one answers with the
    // same object every time.
    const factory = (): unknown => fs
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/huoli')
    const loader = new WorkerModuleLoader({
      vfs,
      root: '/huoli',
      staticModules: { 'node:fs': factory, 'fs': factory },
    })
    setActiveModuleLoader(loader)
    const shim = installProcessGlobal({ cwd: '/huoli', env: {} })
    // The shim calls the factory: a caller receives the module, never the thunk.
    expect(shim.getBuiltinModule('fs')).toBe(fs)
    expect(shim.getBuiltinModule('node:fs')).toBe(fs)
    expect(shim.getBuiltinModule('no-such-builtin')).toBeUndefined()
  })
})
