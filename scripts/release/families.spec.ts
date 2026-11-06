/** Release family discovery, publish order, tag naming, and the bump judgements. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { officialClientBuildEnvironment, writeClientBuildRecord } from '../client-build-environment.ts'
import { ON_DEMAND_BUNDLES } from '../../packages/util/official-bundles/src/bundles.ts'
import { releaseFamily, type ReleaseMember } from './families.ts'
import { compareVersions, nextVendorVersion, planShared, reachesPayload } from './bump.ts'

/**
 * A release member standing in for a manifest on disk.
 * @param directory - repository-relative package directory.
 * @param name - package name.
 * @param manifest - manifest fields the subject reads.
 * @returns The member.
 */
function member(directory: string, name: string, manifest: Record<string, unknown> = {}): ReleaseMember {
  return { directory, name, version: '0.0.1', manifest }
}

const roots: string[] = []

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function buildFixture(environment: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'huoli-release-build-'))
  roots.push(root)
  write(join(root, 'package.json'), `${JSON.stringify({ version: environment.HUOLI_CLIENT_VERSION ?? '0.0.1' })}\n`)
  write(join(root, 'apps/web/dist/index.html'), '<main></main>')
  write(join(root, 'packages/client/example/lib/client.js'), 'module.exports = {}\n')
  writeClientBuildRecord(root, environment)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('release families', () => {
  it('publishes all current experimental packages', () => {
    const members = releaseFamily('huoli').members(resolve(import.meta.dirname, '../..'))

    expect(members
      .filter(member => member.directory.startsWith('packages/experimental/'))
      .map(member => member.name)).toEqual([
      '@huoli/huoli-action-cards',
      '@huoli/huoli-experimental-agent-team-profile',
      '@huoli/huoli-experimental-agent-team',
      '@huoli/huoli-experimental-api-speech-to-text',
      '@huoli/huoli-experimental-auto-review',
      '@huoli/huoli-experimental-badge-skill-bundle',
      '@huoli/huoli-experimental-browser-use-chrome-devtools-mcp',
      '@huoli/huoli-experimental-browser-use-playwright-mcp',
      '@huoli/huoli-experimental-browser-use-runtime',
      '@huoli/huoli-experimental-browser-use-stagehand-native',
      '@huoli/huoli-experimental-claude-code-mods',
      '@huoli/huoli-client-ui-action-cards',
      '@huoli/huoli-experimental-client-ui-agent-team',
      '@huoli/huoli-experimental-client-ui-claude-code-mods',
      '@huoli/huoli-experimental-client-ui-cot-translation',
      '@huoli/huoli-client-ui-creation-recommendations',
      '@huoli/huoli-experimental-client-ui-forge',
      '@huoli/huoli-client-ui-plugin-recommendations',
      '@huoli/huoli-experimental-client-ui-stats',
      '@huoli/huoli-experimental-client-ui-voice-input',
      '@huoli/huoli-experimental-computer-use-cua-driver-mcp',
      '@huoli/huoli-experimental-computer-use-cua-driver-native',
      '@huoli/huoli-experimental-cot-translation-bundle',
      '@huoli/huoli-creation-recommendations',
      '@huoli/huoli-cua-bundle',
      '@huoli/huoli-experimental-cua-macos',
      '@huoli/huoli-cua',
      '@huoli/huoli-experimental-forge-bundle',
      '@huoli/huoli-experimental-forge-github',
      '@huoli/huoli-experimental-forge-session',
      '@huoli/huoli-experimental-forge',
      '@huoli/huoli-hook-protocol',
      '@huoli/huoli-hooks-claude-code',
      '@huoli/huoli-hooks-codex',
      '@huoli/huoli-experimental-inspector-profile',
      '@huoli/huoli-experimental-inspector',
      '@huoli/huoli-experimental-liveshare-protocol',
      '@huoli/huoli-experimental-liveshare',
      '@huoli/huoli-personalized-recommendations',
      '@huoli/huoli-experimental-plugin-market-bundle',
      '@huoli/huoli-plugin-recommendations',
      '@huoli/huoli-experimental-ptc-runtime-python',
      '@huoli/huoli-experimental-ralph-bundle',
      '@huoli/huoli-experimental-session-inspector',
      '@huoli/huoli-experimental-session-search',
      '@huoli/huoli-session-title-all-prompts-llm',
      '@huoli/huoli-experimental-session-titles-bundle',
      '@huoli/huoli-skill-badge',
      '@huoli/huoli-experimental-speech-to-text-sensevoice',
      '@huoli/huoli-experimental-speech-to-text',
      '@huoli/huoli-experimental-subagent-oar',
      '@huoli/huoli-experimental-terminal-bundle',
      '@huoli/huoli-experimental-tool-agent-team',
      '@huoli/huoli-tool-ralph',
      '@huoli/huoli-tool-session-query',
      '@huoli/huoli-experimental-tool-subagent-oar',
      '@huoli/huoli-tool-terminal',
      '@huoli/huoli-experimental-tool-worktree',
      '@huoli/huoli-experimental-translator',
      '@huoli/huoli-experimental-voice-input-bundle',
      '@huoli/huoli-webhook-github',
      '@huoli/huoli-webhook',
      '@huoli/huoli-experimental-webworker-packer',
      '@huoli/huoli-experimental-webworker-runtime',
      '@huoli/huoli-experimental-worktree',
    ])
  })

  it('excludes private applications from the publish set', () => {
    const root = mkdtempSync(join(tmpdir(), 'huoli-release-private-'))
    roots.push(root)
    write(join(root, 'apps/public/package.json'), '{"name":"@huoli/huoli-public","version":"0.0.1"}\n')
    write(join(root, 'apps/private/package.json'), '{"name":"@huoli/huoli-private","version":"0.0.1","private":true}\n')

    expect(releaseFamily('huoli').members(root).map(entry => entry.name)).toEqual(['@huoli/huoli-public'])
  })

  it('publishes unlisted experimental packages while retaining private exclusions', () => {
    const root = mkdtempSync(join(tmpdir(), 'huoli-release-experimental-'))
    roots.push(root)
    write(join(root, 'packages/experimental/prototype/package.json'), JSON.stringify({
      name: '@huoli/huoli-experimental-prototype',
      version: '0.0.1',
      publishConfig: { access: 'public' },
    }))
    write(join(root, 'packages/experimental/inspector/package.json'), JSON.stringify({
      name: '@huoli/huoli-experimental-inspector',
      version: '0.0.1',
      private: true,
    }))

    expect(releaseFamily('huoli').members(root).map(entry => entry.name)).toEqual([
      '@huoli/huoli-experimental-prototype',
    ])
  })

  it('bumps private huoli workspaces without adding release tags', () => {
    const root = mkdtempSync(join(tmpdir(), 'huoli-release-version-'))
    roots.push(root)
    write(join(root, 'package.json'), '{"version":"0.0.1"}\n')
    write(join(root, 'apps/plugin-market-generator/package.json'), '{"version":"0.0.1","private":true}\n')
    write(join(root, 'packages/experimental/prototype/package.json'), '{"version":"0.0.1","private":true}\n')
    write(join(root, 'packages/core/unselected/package.json'), '{"version":"0.0.1"}\n')

    const huoli = releaseFamily('huoli')
    const published = member('packages/core/published', '@huoli/huoli-published')
    const { planned } = planShared(huoli, root, [published], '0.0.2')

    expect(planned.map(entry => ({ path: entry.manifestPath, tag: entry.tag }))).toEqual([
      { path: 'package.json', tag: undefined },
      { path: 'packages/core/published/package.json', tag: 'huoli-v0.0.2' },
      { path: 'apps/plugin-market-generator/package.json', tag: undefined },
      { path: 'packages/experimental/prototype/package.json', tag: undefined },
    ])
  })

  it.each(['0.0.2-alpha.1', '0.0.2-canary.1', '0.0.2-rc.1'])(
    'accepts the explicit huoli prerelease version %s',
    (version) => {
      const root = mkdtempSync(join(tmpdir(), 'huoli-release-prerelease-'))
      roots.push(root)
      write(join(root, 'package.json'), '{"version":"0.0.1"}\n')

      const huoli = releaseFamily('huoli')
      const published = member('packages/core/published', '@huoli/huoli-published')
      const plan = planShared(huoli, root, [published], version)

      expect(plan.version).toBe(version)
      expect(plan.planned[1]?.tag).toBe(`huoli-v${version}`)
    },
  )

  it('names one tag for the whole huoli family and one per vendored package', () => {
    const huoli = releaseFamily('huoli')
    const vendor = releaseFamily('vendor')
    const cli = member('apps/cli', '@huoli/huoli')
    const cordis = { ...member('vendor/cordis', '@huoli/cordis'), version: '4.0.1' }

    expect(huoli.tagFor(cli)).toBe('huoli-v0.0.1')
    expect(vendor.tagFor(cordis)).toBe('vendor-cordis-v4.0.1')
    // The prefix is constructed, not recovered from a tag: a version with a
    // hyphen would defeat any suffix-stripping.
    expect(vendor.tagPrefixFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v')
    expect(vendor.tagFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v4.0.0-rc.7')
  })

  it('assigns alpha and canary dist-tags only to huoli releases', () => {
    const huoli = releaseFamily('huoli')
    const vendor = releaseFamily('vendor')

    expect(huoli.distTagForVersion('0.0.2-alpha.1')).toBe('alpha')
    expect(huoli.distTagForVersion('0.0.2-canary.1')).toBe('canary')
    expect(huoli.distTagForVersion('0.0.2-rc.1')).toBe('next')
    expect(huoli.distTagForVersion('0.0.2')).toBeUndefined()
    expect(vendor.distTagForVersion('4.0.1-alpha.1')).toBe('next')
    expect(vendor.distTagForVersion('4.0.1-canary.1')).toBe('next')
  })

  it('rejects a family whose members disagree on the shared version', () => {
    const huoli = releaseFamily('huoli')
    const members = [member('apps/cli', '@huoli/huoli'), { ...member('apps/web', '@huoli/huoli-web-frontend'), version: '0.0.2' }]

    expect(() => { huoli.verifyVersions(members) }).toThrow(/must share one version/)
    expect(() => { huoli.verifyVersions([members[0]!]) }).not.toThrow()
  })

  it('accepts independent vendored versions and rejects an unpublishable one', () => {
    const vendor = releaseFamily('vendor')
    const members = [
      { ...member('vendor/cordis', '@huoli/cordis'), version: '4.0.1' },
      { ...member('vendor/cosmokit', '@huoli/cosmokit'), version: '1.8.2' },
    ]

    expect(() => { vendor.verifyVersions(members) }).not.toThrow()
    expect(() => { vendor.verifyVersions([{ ...members[0]!, version: 'latest' }]) }).toThrow(/unpublishable version/)
  })

  it('requires a current official client build only for huoli artifacts', () => {
    const huoli = releaseFamily('huoli')
    const vendor = releaseFamily('vendor')
    const officialEnvironment = officialClientBuildEnvironment(resolve(import.meta.dirname, '../..'))
    vi.stubEnv('HUOLI_CLIENT_COMMIT_HASH', officialEnvironment.HUOLI_CLIENT_COMMIT_HASH)
    const official = buildFixture(officialEnvironment)
    const defaultBuild = buildFixture({})
    const missing = join(defaultBuild, 'missing')
    write(join(missing, 'package.json'), `${JSON.stringify({ version: officialEnvironment.HUOLI_CLIENT_VERSION })}\n`)

    expect(() => { huoli.verifyBuildArtifacts(official) }).not.toThrow()
    expect(() => { huoli.verifyBuildArtifacts(defaultBuild) }).toThrow(/HUOLI_CLIENT_TITLE/)
    expect(() => { huoli.verifyBuildArtifacts(missing) }).toThrow(/record.*missing/)
    expect(() => { vendor.verifyBuildArtifacts(missing) }).not.toThrow()

    write(join(official, 'packages/client/example/lib/client.js'), 'module.exports = { changed: true }\n')
    expect(() => { huoli.verifyBuildArtifacts(official) }).toThrow(/artifacts differ/)
  })

  it('publishes a dependency before its consumer, and orders ties by name', () => {
    const huoli = releaseFamily('huoli')
    const members = [
      member('packages/a/consumer', '@huoli/huoli-consumer', { dependencies: { '@huoli/huoli-library': 'workspace:^' } }),
      member('packages/a/library', '@huoli/huoli-library'),
      member('packages/a/zebra', '@huoli/huoli-zebra'),
    ]

    expect(huoli.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@huoli/huoli-library',
      '@huoli/huoli-consumer',
      '@huoli/huoli-zebra',
    ])
  })

  it('publishes on-demand catalog members before huoli without adding installed dependencies', () => {
    const huoli = member('apps/cli', '@huoli/huoli')
    const providers = ON_DEMAND_BUNDLES.map(name => member(`packages/subagent/${name}`, name))
    const plan = releaseFamily('huoli').publishOrder([huoli, ...providers])
    expect(plan.order.map(entry => entry.name)).toEqual([...ON_DEMAND_BUNDLES.toSorted(), huoli.name])
    expect(huoli.manifest).toEqual({})
    expect(plan.droppedPeerEdges).toEqual([])
  })

  it('rejects an advertised provider missing from the public release family', () => {
    expect(() => releaseFamily('huoli').publishOrder([member('apps/cli', '@huoli/huoli')]))
      .toThrow('Official catalog prerequisite')
  })

  it('keeps catalog prerequisites ahead of a huoli peer declaration', () => {
    const huoli = member('apps/cli', '@huoli/huoli')
    const providers = ON_DEMAND_BUNDLES.map(name => member(`packages/subagent/${name}`, name, {
      peerDependencies: { '@huoli/huoli': 'workspace:*' },
    }))
    const plan = releaseFamily('huoli').publishOrder([huoli, ...providers])
    expect(plan.order.map(entry => entry.name)).toEqual([...ON_DEMAND_BUNDLES.toSorted(), huoli.name])
    expect(plan.droppedPeerEdges).toEqual(ON_DEMAND_BUNDLES.toSorted().map(name => ({ consumer: name, peer: huoli.name })))
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'])(
    'requires exact packed HUOLI %s while preserving external ranges', (section) => {
      const pkg = member('packages/example/provider', '@huoli/huoli-provider')
      const family = releaseFamily('huoli')
      const manifest = { name: pkg.name, version: pkg.version, [section]: { '@huoli/huoli-tools': pkg.version, external: '^4.0.0' } }
      expect(() => { family.validatePackedManifest(pkg, manifest) }).not.toThrow()
      for (const range of ['workspace:*', '^0.0.1', '~0.0.1', '0.0.2', '*']) {
        expect(() => { family.validatePackedManifest(pkg, { ...manifest, [section]: { '@huoli/huoli-tools': range } }) })
          .toThrow(`packed ${section}.@huoli/huoli-tools must equal`)
      }
    },
  )

  it('checks packed identities and preserves independent vendor versions', () => {
    const pkg = member('vendor/example', '@huoli/example')
    const family = releaseFamily('vendor')
    expect(() => { family.validatePackedManifest(pkg, { name: pkg.name, version: pkg.version, dependencies: { '@huoli/huoli-tools': '^4.0.0' } }) })
      .not.toThrow()
    expect(() => { family.validatePackedManifest(pkg, { name: '@huoli/other', version: pkg.version }) }).toThrow('packed identity')
    expect(() => { family.validatePackedManifest(pkg, { name: pkg.name, version: '0.0.2' }) }).toThrow('packed identity')
  })

  it('reports a runtime dependency cycle instead of emitting an arbitrary order', () => {
    const huoli = releaseFamily('huoli')
    const members = [
      member('packages/a/left', '@huoli/huoli-left', { dependencies: { '@huoli/huoli-right': 'workspace:^' } }),
      member('packages/a/right', '@huoli/huoli-right', { dependencies: { '@huoli/huoli-left': 'workspace:^' } }),
    ]

    expect(() => { huoli.publishOrder(members) }).toThrow(/dependency cycle/)
  })

  it('publishes a peer before its consumer', () => {
    const huoli = releaseFamily('huoli')
    const members = [
      member('packages/a/consumer', '@huoli/huoli-consumer', { peerDependencies: { '@huoli/huoli-zebra': 'workspace:^' } }),
      member('packages/a/zebra', '@huoli/huoli-zebra'),
    ]

    // Name order alone would place the consumer first; the peer edge moves it.
    expect(huoli.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@huoli/huoli-zebra',
      '@huoli/huoli-consumer',
    ])
  })

  it('orders around a peer cycle rather than refusing to publish, and reports the edge it dropped', () => {
    const huoli = releaseFamily('huoli')
    const members = [
      member('packages/a/left', '@huoli/huoli-left', { peerDependencies: { '@huoli/huoli-right': 'workspace:^' } }),
      member('packages/a/right', '@huoli/huoli-right', { peerDependencies: { '@huoli/huoli-left': 'workspace:^' } }),
    ]

    // Sibling packages declare each other as peers, and npm treats an unmet peer
    // as a warning, so this pair has to publish rather than fail the release.
    const plan = huoli.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@huoli/huoli-right',
      '@huoli/huoli-left',
    ])
    // One of the two edges has to give, and which one it is belongs in the log.
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@huoli/huoli-right', peer: '@huoli/huoli-left' },
    ])
  })

  it('honours an install edge even when a peer cycle surrounds it', () => {
    const huoli = releaseFamily('huoli')
    const members = [
      member('packages/a/base', '@huoli/huoli-base', { peerDependencies: { '@huoli/huoli-consumer': 'workspace:^' } }),
      member('packages/a/consumer', '@huoli/huoli-consumer', {
        dependencies: { '@huoli/huoli-base': 'workspace:^' },
        peerDependencies: { '@huoli/huoli-base': 'workspace:^' },
      }),
    ]

    // The install edge is absolute: base publishes first, and the peer edge that
    // would reverse it is the one dropped.
    const plan = huoli.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@huoli/huoli-base',
      '@huoli/huoli-consumer',
    ])
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@huoli/huoli-base', peer: '@huoli/huoli-consumer' },
    ])
  })

  it('refuses an order that would publish a consumer before a dependency it installs', () => {
    const huoli = releaseFamily('huoli')
    const members = [
      member('packages/a/alpha', '@huoli/huoli-alpha', { peerDependencies: { '@huoli/huoli-bravo': 'workspace:^' } }),
      member('packages/a/bravo', '@huoli/huoli-bravo', { peerDependencies: { '@huoli/huoli-charlie': 'workspace:^' } }),
      member('packages/a/charlie', '@huoli/huoli-charlie', { dependencies: { '@huoli/huoli-alpha': 'workspace:^' } }),
    ]

    // A cycle of two peer edges closed by one install edge: dropping a peer edge
    // would order this, and the traversal drops the install edge instead. That
    // order would publish charlie before the alpha it installs, so it is refused
    // here rather than published.
    expect(() => { huoli.publishOrder(members) }).toThrow(/no publish order honours @huoli\/huoli-charlie -> @huoli\/huoli-alpha/)
  })

  it('ignores devDependencies when ordering', () => {
    const huoli = releaseFamily('huoli')
    const members = [
      member('packages/a/alpha', '@huoli/huoli-alpha', { devDependencies: { '@huoli/huoli-zebra': 'workspace:^' } }),
      member('packages/a/zebra', '@huoli/huoli-zebra'),
    ]

    // A dev dependency is absent from the published package, so it must not move
    // the consumer behind it.
    expect(huoli.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@huoli/huoli-alpha',
      '@huoli/huoli-zebra',
    ])
  })

  it('applies the harness payload policy to huoli and keeps upstream payloads for vendored packages', () => {
    const huoli = releaseFamily('huoli')
    const vendor = releaseFamily('vendor')
    const harness = member('packages/a/library', '@huoli/huoli-library')
    const vendored = member('vendor/cordis', '@huoli/cordis')

    expect(() => { huoli.validatePayload(harness, ['package/lib/index.js', 'package/src/index.ts']) })
      .toThrow(/publishes source file/)
    expect(() => { vendor.validatePayload(vendored, ['package/lib/index.js', 'package/src/index.ts']) }).not.toThrow()
    expect(() => { vendor.validatePayload(vendored, []) }).toThrow(/empty tarball/)
  })

  it('drives the installed entry only for the family that publishes one', () => {
    expect(releaseFamily('huoli').installedEntry).toEqual({ packageName: '@huoli/huoli', binPath: 'lib/bin.js' })
    expect(releaseFamily('vendor').installedEntry).toBeUndefined()
  })

  it('rejects an unknown family identifier', () => {
    expect(() => { releaseFamily('native') }).toThrow(/unknown release family/)
  })
})

describe('vendored version baseline', () => {
  it('drops an upstream prerelease segment and increments the patch', () => {
    expect(nextVendorVersion('4.0.0-rc.7', undefined)).toBe('4.0.1')
    expect(nextVendorVersion('1.0.0-rc.5', undefined)).toBe('1.0.1')
    expect(nextVendorVersion('1.8.1', undefined)).toBe('1.8.2')
  })

  it('increments from the last published version when a re-sync restored a lower one', () => {
    // Upstream moved rc.7 -> rc.8 after this repository published 4.0.1;
    // incrementing the manifest alone would name 4.0.1 a second time.
    expect(nextVendorVersion('4.0.0-rc.8', '4.0.1')).toBe('4.0.2')
    expect(nextVendorVersion('4.1.0', '4.0.1')).toBe('4.1.1')
  })

  it('appends a rehearsal prerelease without consuming its release numbers', () => {
    // A rehearsal burns 4.0.1-rc.1 and leaves 4.0.1 free, so the stable release
    // that follows takes those same numbers instead of skipping to 4.0.2.
    expect(nextVendorVersion('4.0.0-rc.7', undefined, 'rc.1')).toBe('4.0.1-rc.1')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1-rc.1', 'rc.2')).toBe('4.0.1-rc.2')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1-rc.1')).toBe('4.0.1')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1')).toBe('4.0.2')
  })
})

describe('version precedence', () => {
  it('orders alpha, canary, and release-candidate versions by semver precedence', () => {
    expect(compareVersions('4.0.1-alpha.1', '4.0.1-canary.1')).toBeLessThan(0)
    expect(compareVersions('4.0.1-canary.1', '4.0.1-rc.1')).toBeLessThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1')).toBeLessThan(0)
  })

  it('ranks a release above the prerelease it follows', () => {
    // git --sort=v:refname disagrees, placing 4.0.1-rc.1 above 4.0.1, which is
    // why the newest published version is chosen here rather than by git.
    expect(compareVersions('4.0.1', '4.0.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1')).toBeLessThan(0)
  })

  it('compares numeric prerelease fields numerically', () => {
    expect(compareVersions('4.0.1-rc.10', '4.0.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.2', '4.0.1-rc.10')).toBeLessThan(0)
  })

  it('ranks a numeric field below an alphanumeric one, and a shorter list below a longer', () => {
    expect(compareVersions('4.0.1-1', '4.0.1-alpha')).toBeLessThan(0)
    expect(compareVersions('4.0.1-rc', '4.0.1-rc.1')).toBeLessThan(0)
    expect(compareVersions('4.0.2', '4.0.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1-rc.1')).toBe(0)
  })
})

describe('payload change judgement', () => {
  const sourceShipping = member('vendor/cosmokit', '@huoli/cosmokit', {
    files: ['lib/index.js', 'lib/types/**/*.d.ts', 'src'],
  })
  const buildOutputOnly = member('vendor/cordis', '@huoli/cordis', {
    files: ['lib/index.js', 'lib/types/**/*.d.ts', 'bin.js'],
  })

  it('counts the manifest and the files npm always publishes', () => {
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/package.json')).toBe(true)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/README.md')).toBe(true)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/src/index.ts')).toBe(true)
  })

  it('counts build inputs for a package whose payload is build output', () => {
    // cordis publishes lib/ only, and lib/ is not tracked: without this, a real
    // source change reads as "nothing changed" and the next publish fails on a
    // version whose bytes moved.
    expect(reachesPayload(buildOutputOnly, 'vendor/cordis/src/context.ts')).toBe(true)
    expect(reachesPayload(buildOutputOnly, 'vendor/cordis/tsconfig.json')).toBe(true)
  })

  it('ignores paths no tarball carries', () => {
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/tests/unit.spec.ts')).toBe(false)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/CHANGELOG.md')).toBe(false)
    // The README pattern is deliberately loose: over-reporting a change costs one
    // unnecessary patch bump, while under-reporting fails the next publish on a
    // version whose bytes moved.
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/README.i18n.yaml')).toBe(true)
    expect(reachesPayload(member('packages/a/library', '@huoli/huoli-library', { files: ['lib/index.js'] }),
      'packages/a/library/tests/library.spec.ts')).toBe(false)
  })
})
