import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertClientBuildEnvironment,
  clientBuildEnvironmentDefines,
  clientBuildProcessEnvironment,
  clientBuildValueDefines,
  officialClientBuildEnvironment,
  readClientBuildRecord,
  repositoryClientBuildEnvironment,
  repositoryCommitHash,
  repositoryGitDirty,
  repositoryVersion,
  resolveClientBuildEnvironment,
  writeClientBuildRecord,
} from './client-build-environment.ts'
import { clientBundle } from '../packages/client/tsdown.client.ts'

const root = resolve(import.meta.dirname, '..')
const PROBE_NAME = 'HUOLI_CLIENT_BUILD_TEST'
const COMMIT_HASH = '0123456789abcdef0123456789abcdef01234567'
const PROBE_KEY = `process.env.${PROBE_NAME}`
const originalProbe = process.env[PROBE_NAME]
const roots: string[] = []
const huoliBuildWorkflows = [
  'build-exe-for-python-sdk.yml',
  'ci.yml',
  'ci-python.yml',
  'ci-windows.yml',
  'e2e.yml',
  'release.yml',
  'release-publish.yml',
  'sandbox.yml',
]

afterEach(() => {
  if (originalProbe === undefined) Reflect.deleteProperty(process.env, PROBE_NAME)
  else process.env[PROBE_NAME] = originalProbe
  vi.resetModules()
  for (const fixtureRoot of roots.splice(0)) rmSync(fixtureRoot, { recursive: true, force: true })
})

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function buildFixture(environment: Record<string, string>): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'huoli-client-build-'))
  roots.push(fixtureRoot)
  write(join(fixtureRoot, 'apps/web/dist/index.html'), '<main></main>')
  write(join(fixtureRoot, 'packages/client/example/lib/client.js'), 'module.exports = {}\n')
  writeClientBuildRecord(fixtureRoot, environment)
  return fixtureRoot
}

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function repositoryFixture(version = '1.2.3-rc.4'): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'huoli-client-build-repository-'))
  roots.push(fixtureRoot)
  write(join(fixtureRoot, 'package.json'), `${JSON.stringify({ version })}\n`)
  write(join(fixtureRoot, 'tracked.txt'), 'committed\n')
  git(fixtureRoot, ['init'])
  git(fixtureRoot, ['config', 'user.name', 'HUOLI test'])
  git(fixtureRoot, ['config', 'user.email', 'huoli-test@example.invalid'])
  git(fixtureRoot, ['config', 'commit.gpgsign', 'false'])
  git(fixtureRoot, ['add', 'package.json', 'tracked.txt'])
  git(fixtureRoot, ['commit', '-m', 'fixture'])
  return fixtureRoot
}

describe('client build environment', () => {
  it('requires an exact public environment for a named artifact profile', () => {
    const expected = {
      HUOLI_CLIENT_BUILD_PROFILE: 'official',
      HUOLI_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      HUOLI_CLIENT_TITLE: 'Huoli Core',
      HUOLI_CLIENT_VERSION: '1.2.3',
    } as const

    expect(() => { assertClientBuildEnvironment({ PATH: '/bin', ...expected }, expected) }).not.toThrow()
    expect(() => { assertClientBuildEnvironment({}, expected) }).toThrow(/HUOLI_CLIENT_TITLE/)
    expect(() => { assertClientBuildEnvironment({ HUOLI_CLIENT_TITLE: 'Other' }, expected) }).toThrow(/HUOLI_CLIENT_TITLE/)
    expect(() => {
      assertClientBuildEnvironment({ ...expected, HUOLI_CLIENT_UNDECLARED: 'value' }, expected)
    }).toThrow(/HUOLI_CLIENT_UNDECLARED/)
  })

  it('inherits public values by default and isolates an explicit official profile', () => {
    const parent = {
      PATH: '/bin',
      HUOLI_BUILD_CLIENT_PROFILE: 'official',
      HUOLI_CLIENT_BUILD_PROFILE: 'local',
      HUOLI_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      HUOLI_CLIENT_GIT_DIRTY: 'true',
      HUOLI_CLIENT_TITLE: 'Local title',
      HUOLI_CLIENT_VERSION: '1.2.3',
      HUOLI_CLIENT_EXTRA: 'local-extra',
    }

    expect(resolveClientBuildEnvironment({ HUOLI_CLIENT_TITLE: 'Local title' })).toEqual({
      HUOLI_CLIENT_TITLE: 'Local title',
    })
    expect(resolveClientBuildEnvironment(parent)).toEqual({
      HUOLI_CLIENT_BUILD_PROFILE: 'official',
      HUOLI_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      HUOLI_CLIENT_TITLE: 'Huoli Core',
      HUOLI_CLIENT_VERSION: '1.2.3',
    })
    expect(() => {
      resolveClientBuildEnvironment({ HUOLI_BUILD_CLIENT_PROFILE: 'official' })
    }).toThrow(/HUOLI_CLIENT_COMMIT_HASH/)
    expect(() => {
      resolveClientBuildEnvironment({
        HUOLI_BUILD_CLIENT_PROFILE: 'official',
        HUOLI_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      })
    }).toThrow(/HUOLI_CLIENT_VERSION/)
    expect(() => { resolveClientBuildEnvironment({}, 'unknown') }).toThrow(/unknown client build profile/)
    expect(clientBuildProcessEnvironment(parent, {
      HUOLI_CLIENT_BUILD_PROFILE: 'official',
      HUOLI_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      HUOLI_CLIENT_TITLE: 'Huoli Core',
      HUOLI_CLIENT_VERSION: '1.2.3',
    })).toEqual({
      PATH: '/bin',
      HUOLI_CLIENT_BUILD_PROFILE: 'official',
      HUOLI_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      HUOLI_CLIENT_TITLE: 'Huoli Core',
      HUOLI_CLIENT_VERSION: '1.2.3',
    })
    expect(repositoryCommitHash('/unused', { HUOLI_CLIENT_COMMIT_HASH: COMMIT_HASH })).toBe(COMMIT_HASH.slice(0, 7))
  })

  it.each([undefined, 'true', 'false'])('isolates local branding while retaining repository metadata (dirty=%s)', (dirty) => {
    const parent = {
      HUOLI_BUILD_CLIENT_PROFILE: 'official',
      HUOLI_CLIENT_BUILD_PROFILE: 'official',
      HUOLI_CLIENT_TITLE: 'Huoli Core',
      HUOLI_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      HUOLI_CLIENT_VERSION: '1.2.3',
      HUOLI_CLIENT_GIT_DIRTY: dirty,
      HUOLI_CLIENT_EXTRA: 'inherited',
    }
    const local = resolveClientBuildEnvironment(parent, 'local')
    expect(local).toEqual({
      HUOLI_CLIENT_BUILD_PROFILE: 'local',
      HUOLI_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      HUOLI_CLIENT_VERSION: '1.2.3',
      ...(dirty === 'true' ? { HUOLI_CLIENT_GIT_DIRTY: 'true' } : {}),
    })
    expect(clientBuildProcessEnvironment(parent, local)).toEqual(local)
    expect(resolveClientBuildEnvironment({ ...parent, HUOLI_BUILD_CLIENT_PROFILE: 'local' })).toEqual(local)
    expect(resolveClientBuildEnvironment({ ...parent, ...local }, 'official')).toEqual({
      HUOLI_CLIENT_BUILD_PROFILE: 'official',
      HUOLI_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      HUOLI_CLIENT_TITLE: 'Huoli Core',
      HUOLI_CLIENT_VERSION: '1.2.3',
    })
  })

  it('requires source metadata for an explicit local build', () => {
    expect(() => { resolveClientBuildEnvironment({}, 'local') }).toThrow(/HUOLI_CLIENT_COMMIT_HASH/)
    expect(() => {
      resolveClientBuildEnvironment({ HUOLI_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7) }, 'local')
    }).toThrow(/HUOLI_CLIENT_VERSION/)
  })

  it('owns repository version, commit, and dirty metadata for complete builds', () => {
    const fixtureRoot = repositoryFixture()
    const commit = git(fixtureRoot, ['rev-parse', '--short=7', 'HEAD'])

    expect(repositoryVersion(fixtureRoot)).toBe('1.2.3-rc.4')
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)
    expect(repositoryClientBuildEnvironment(fixtureRoot, {
      HUOLI_CLIENT_COMMIT_HASH: COMMIT_HASH,
      HUOLI_CLIENT_EXTRA: 'preserved',
      HUOLI_CLIENT_GIT_DIRTY: 'true',
      HUOLI_CLIENT_VERSION: 'spoofed',
    })).toEqual({
      HUOLI_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      HUOLI_CLIENT_EXTRA: 'preserved',
      HUOLI_CLIENT_VERSION: '1.2.3-rc.4',
    })
    expect(officialClientBuildEnvironment(fixtureRoot)).toEqual({
      HUOLI_CLIENT_BUILD_PROFILE: 'official',
      HUOLI_CLIENT_COMMIT_HASH: commit,
      HUOLI_CLIENT_TITLE: 'Huoli Core',
      HUOLI_CLIENT_VERSION: '1.2.3-rc.4',
    })

    write(join(fixtureRoot, '.gitignore'), 'ignored.txt\n')
    git(fixtureRoot, ['add', '.gitignore'])
    git(fixtureRoot, ['commit', '-m', 'ignore fixture'])
    write(join(fixtureRoot, 'ignored.txt'), 'ignored\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)
    rmSync(join(fixtureRoot, 'ignored.txt'))

    write(join(fixtureRoot, 'tracked.txt'), 'unstaged\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(true)
    write(join(fixtureRoot, 'tracked.txt'), 'committed\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)

    write(join(fixtureRoot, 'tracked.txt'), 'staged\n')
    git(fixtureRoot, ['add', 'tracked.txt'])
    expect(repositoryGitDirty(fixtureRoot)).toBe(true)
    git(fixtureRoot, ['commit', '-m', 'staged fixture'])
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)

    write(join(fixtureRoot, 'untracked.txt'), 'untracked\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(true)
    expect(repositoryClientBuildEnvironment(fixtureRoot, {
      HUOLI_CLIENT_COMMIT_HASH: COMMIT_HASH,
    })).toEqual({
      HUOLI_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      HUOLI_CLIENT_GIT_DIRTY: 'true',
      HUOLI_CLIENT_VERSION: '1.2.3-rc.4',
    })

    rmSync(join(fixtureRoot, 'untracked.txt'))
    const submoduleSource = repositoryFixture('9.8.7')
    git(fixtureRoot, ['-c', 'protocol.file.allow=always', 'submodule', 'add', submoduleSource, 'submodule'])
    git(fixtureRoot, ['commit', '-am', 'submodule fixture'])
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)
    write(join(fixtureRoot, 'submodule/tracked.txt'), 'modified submodule\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(true)
  })

  it('omits dirty metadata when repository metadata is unavailable', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'huoli-client-build-no-git-'))
    roots.push(fixtureRoot)
    write(join(fixtureRoot, 'package.json'), '{"version":"2.0.0"}\n')

    expect(repositoryGitDirty(fixtureRoot)).toBeUndefined()
    expect(repositoryClientBuildEnvironment(fixtureRoot, {
      HUOLI_CLIENT_COMMIT_HASH: COMMIT_HASH,
      HUOLI_CLIENT_GIT_DIRTY: 'true',
    })).toEqual({
      HUOLI_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      HUOLI_CLIENT_VERSION: '2.0.0',
    })
  })

  it('defines only public client values over a non-enumerable fallback', () => {
    const environment = {
      PATH: '/bin',
      HUOLI_TEST_API_KEY: 'secret',
      HUOLI_CLIENT_VARIANT: 'quoted "value"',
      HUOLI_CLIENT_EMPTY: '',
      HUOLI_CLIENT_UNSET: undefined,
    }
    const values = {
      'process.env.HUOLI_CLIENT_EMPTY': '""',
      'process.env.HUOLI_CLIENT_VARIANT': '"quoted \\"value\\""',
    }
    expect(clientBuildEnvironmentDefines(environment)).toEqual({ 'process.env': '{}', ...values })
    // Node faces keep their runtime `process.env` and fix only the public values.
    expect(clientBuildValueDefines(environment)).toEqual(values)
  })

  it('feeds the same build-process value to dynamic tsdown bundles, their Node faces, and the Vite shell', async () => {
    process.env[PROBE_NAME] = 'shared-value'

    const configs = clientBundle(join(import.meta.dirname, '../packages/client/ui-sidebar'), [
      'lib/types/index.js',
    ])({ env: { HUOLI_BUILD_FACE: 'client' } })
    if (!Array.isArray(configs)) throw new TypeError('client bundle config must be an array')
    const dynamic = configs.find(config => config.name === '@huoli/huoli-client-ui-sidebar/client')
    expect(dynamic?.define).toMatchObject({
      'process.env': '{}',
      [PROBE_KEY]: '"shared-value"',
    })
    const node = configs.find(config => config.name === '@huoli/huoli-client-ui-sidebar')
    expect(node?.define).toMatchObject({ [PROBE_KEY]: '"shared-value"' })
    expect(node?.define).not.toHaveProperty(['process.env'])
  })

  it('binds the recorded environment to a complete set of client artifacts', () => {
    const officialEnvironment = {
      HUOLI_CLIENT_BUILD_PROFILE: 'official',
      HUOLI_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      HUOLI_CLIENT_TITLE: 'Huoli Core',
      HUOLI_CLIENT_VERSION: '1.2.3',
    }
    const official = buildFixture(officialEnvironment)
    const defaultBuild = buildFixture({})

    expect(readClientBuildRecord(official, officialEnvironment).environment).toEqual(officialEnvironment)
    expect(() => { readClientBuildRecord(defaultBuild, officialEnvironment) }).toThrow(/HUOLI_CLIENT_/)
    expect(() => { readClientBuildRecord(join(defaultBuild, 'missing')) }).toThrow(/record.*missing/)

    write(join(official, 'apps/web/dist/index.html'), '<main>changed</main>')
    expect(() => { readClientBuildRecord(official) }).toThrow(/artifacts differ/)

    const chunked = buildFixture(officialEnvironment)
    write(join(chunked, 'packages/client/example/lib/client.pdf.js'), 'module.exports = {}\n')
    expect(() => { readClientBuildRecord(chunked) }).toThrow(/artifacts differ/)

    const dual = buildFixture(officialEnvironment)
    write(join(dual, 'packages/client/example/lib/client.node.js'), 'export const node = true\n')
    write(join(dual, 'packages/client/example/lib/client.node.helper.js'), 'export const helper = true\n')
    expect(() => { readClientBuildRecord(dual) }).not.toThrow()
    write(join(dual, 'packages/client/example/lib/client.browser.js'), 'module.exports = { browser: true }\n')
    expect(() => { readClientBuildRecord(dual) }).toThrow(/artifacts differ/)
  })

  it('keeps public client values out of workflow-wide environments', () => {
    for (const name of huoliBuildWorkflows) {
      const path = `.github/workflows/${name}`
      const document: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
      if (typeof document !== 'object' || document === null || Array.isArray(document)) {
        throw new TypeError(`${path} must contain a workflow object`)
      }
      expect(JSON.stringify(document), path).not.toContain('HUOLI_CLIENT_')
    }
  })
})
