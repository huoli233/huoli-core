import { describe, expect, it } from 'vitest'
import type { NpmPackageLock, RegistryIndex } from './benchmark-npm-resolution.ts'
import {
  assertDualDshInstallLayout,
  assertResolutionWorkBudget,
  buildDualDshRegistry,
  MAX_RESOLUTION_WORK_UNITS,
} from './verify-npm-install-layout.ts'

function validLayout(): NpmPackageLock {
  return {
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { '@huoli/huoli': '0.2.0', 'huoli-previous': 'npm:@huoli/huoli@0.1.0' } },
      'node_modules/@huoli/cordis': { version: '4.0.1' },
      'node_modules/@huoli/huoli': {
        version: '0.2.0',
        dependencies: { '@huoli/huoli-child': '^0.2.0' },
        peerDependencies: { '@huoli/cordis': '^4.0.1' },
      },
      'node_modules/@huoli/huoli-child': {
        version: '0.2.0',
        dependencies: { '@huoli/huoli-leaf': '^0.2.0' },
      },
      'node_modules/@huoli/huoli-leaf': { version: '0.2.0' },
      'node_modules/huoli-previous': {
        name: '@huoli/huoli',
        version: '0.1.0',
        dependencies: { '@huoli/huoli-child': '^0.1.0' },
        peerDependencies: { '@huoli/cordis': '^4.0.1' },
      },
      'node_modules/huoli-previous/node_modules/@huoli/huoli-child': {
        version: '0.1.0',
        dependencies: { '@huoli/huoli-leaf': '^0.1.0' },
      },
      'node_modules/huoli-previous/node_modules/@huoli/huoli-leaf': { version: '0.1.0' },
    },
  }
}

describe('npm install layout verifier', () => {
  it('creates two incompatible versions of every HUOLI package', () => {
    const index: RegistryIndex = new Map([
      ['@huoli/huoli', new Map([['0.1.1-rc.2', {
        name: '@huoli/huoli',
        version: '0.1.1-rc.2',
        dependencies: { '@huoli/huoli-child': '^0.1.1-rc.2' },
        peerDependencies: { '@huoli/cordis': '^4.0.1' },
      }]])],
      ['@huoli/huoli-child', new Map([['0.1.1-rc.2', {
        name: '@huoli/huoli-child',
        version: '0.1.1-rc.2',
      }]])],
      ['@huoli/cordis', new Map([['4.0.1', {
        name: '@huoli/cordis',
        version: '4.0.1',
      }]])],
    ])

    const dual = buildDualDshRegistry(index, '0.1.1-rc.2')

    expect([...dual.get('@huoli/huoli')?.keys() ?? []]).toEqual(['0.1.0', '0.2.0'])
    expect(dual.get('@huoli/huoli')?.get('0.1.0')).toMatchObject({
      version: '0.1.0',
      dependencies: { '@huoli/huoli-child': '^0.1.0' },
      peerDependencies: { '@huoli/cordis': '^4.0.1' },
    })
    expect(dual.get('@huoli/huoli')?.get('0.2.0')).toMatchObject({
      version: '0.2.0',
      dependencies: { '@huoli/huoli-child': '^0.2.0' },
    })
    expect(dual.get('@huoli/cordis')).toBe(index.get('@huoli/cordis'))
  })

  it('accepts isolated HUOLI releases with one shared Cordis installation', () => {
    expect(assertDualDshInstallLayout(validLayout())).toEqual({
      dshPackagesPerVersion: 3,
      checkedDshEdges: 4,
    })
  })

  it.each([
    ['react', 'node_modules/react'],
    ['react-dom', 'node_modules/react-dom'],
    ['react', 'node_modules/huoli-previous/node_modules/react'],
    ['react-dom', 'node_modules/huoli-previous/node_modules/react-dom'],
  ])('rejects browser runtime %s installed at %s in the HUOLI-only consumer', (name, path) => {
    const layout = validLayout()
    const packages = { ...layout.packages, [path]: { version: '18.3.1' } }
    expect(() => assertDualDshInstallLayout({ ...layout, packages })).toThrow(
      `${path}: ${name} is a browser build input`,
    )
  })

  it('rejects an internal edge that crosses release versions', () => {
    const layout = validLayout()
    const packages = { ...layout.packages }
    Reflect.deleteProperty(packages, 'node_modules/huoli-previous/node_modules/@huoli/huoli-leaf')

    expect(() => assertDualDshInstallLayout({ ...layout, packages })).toThrow(
      'node_modules/huoli-previous/node_modules/@huoli/huoli-child: dependencies '
      + '@huoli/huoli-leaf resolves to node_modules/@huoli/huoli-leaf@0.2.0, expected 0.1.0',
    )
  })

  it('rejects a second Cordis installation', () => {
    const layout = validLayout()
    const packages = {
      ...layout.packages,
      'node_modules/huoli-previous/node_modules/@huoli/cordis': { version: '4.0.1' },
    }

    expect(() => assertDualDshInstallLayout({ ...layout, packages })).toThrow(
      'expected one shared @huoli/cordis',
    )
  })
})

describe('resolution work budget', () => {
  it.each([
    [277, 2524, 699_148],
    [316, 2780, 878_480],
    [316, 2786, 880_376],
    [317, 2786, 883_162],
    [320, 2836, 907_520],
  ])('accepts the measured dual-release graph with %i packages and %i edges', (packages, edges, units) => {
    expect(assertResolutionWorkBudget({ dshPackagesPerVersion: packages, checkedDshEdges: edges }))
      .toBe(units)
  })

  it('accepts a graph exactly at the budget and rejects one internal edge above it', () => {
    const packages = 320
    const edgesAtBudget = Math.floor(MAX_RESOLUTION_WORK_UNITS / packages)

    expect(packages * edgesAtBudget).toBe(MAX_RESOLUTION_WORK_UNITS)
    expect(assertResolutionWorkBudget({ dshPackagesPerVersion: packages, checkedDshEdges: edgesAtBudget }))
      .toBe(MAX_RESOLUTION_WORK_UNITS)
    expect(() => assertResolutionWorkBudget({
      dshPackagesPerVersion: packages,
      checkedDshEdges: edgesAtBudget + 1,
    })).toThrow(`= ${String(MAX_RESOLUTION_WORK_UNITS + packages)} unit(s), budget ${String(MAX_RESOLUTION_WORK_UNITS)} unit(s)`)
  })

  it('accepts the headroom and rejects a runaway graph with its own measured counts', () => {
    expect(assertResolutionWorkBudget({ dshPackagesPerVersion: 350, checkedDshEdges: 3200 }))
      .toBe(1_120_000)
    expect(() => assertResolutionWorkBudget({ dshPackagesPerVersion: 400, checkedDshEdges: 3000 }))
      .toThrow(`400 package(s) per release x 3000 internal edge(s) = 1200000 unit(s), budget ${String(MAX_RESOLUTION_WORK_UNITS)} unit(s)`)
  })
})
