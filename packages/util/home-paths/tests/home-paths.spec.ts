import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENTS_HOME_DIR_NAME,
  DEFAULT_AGENTS_HOME_DISPLAY,
  DEFAULT_HUOLI_HOME_DISPLAY,
  HUOLI_HOME_DIR_NAME,
  agentsHomeDisplay,
  canonicalizeWatchPath,
  defaultAgentsHome,
  defaultDshHome,
  dshCachePath,
  dshHomeDisplay,
  dshHomePath,
  expandHomePath,
  resolveAgentsHome,
  resolveDshHome,
} from '@huoli/huoli-home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('huoli path helpers', () => {
  it('owns the shared default HUOLI home directory name', () => {
    expect(HUOLI_HOME_DIR_NAME).toBe('.huoli')
    expect(DEFAULT_HUOLI_HOME_DISPLAY).toBe('~/.huoli')
    expect(defaultDshHome()).toBe(join(homedir(), '.huoli'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.huoli')).toBe(join(homedir(), '.huoli'))
    expect(expandHomePath('~\\.huoli')).toBe(join(homedir(), '.huoli'))
    expect(expandHomePath('/tmp/.huoli')).toBe('/tmp/.huoli')
    expect(expandHomePath('~other/.huoli')).toBe('~other/.huoli')
  })

  it('resolves explicit path before HUOLI_HOME and the default', () => {
    const envHome = join(homedir(), 'env-huoli')

    expect(resolveDshHome('/tmp/explicit-huoli', { HUOLI_HOME: '~/env-huoli' })).toBe(resolve('/tmp/explicit-huoli'))
    expect(resolveDshHome(undefined, { HUOLI_HOME: '~/env-huoli' })).toBe(envHome)
    expect(resolveDshHome(undefined, {})).toBe(defaultDshHome())
  })

  it('treats an empty or whitespace-only HUOLI_HOME as unset', () => {
    expect(resolveDshHome(undefined, { HUOLI_HOME: '' })).toBe(defaultDshHome())
    expect(resolveDshHome(undefined, { HUOLI_HOME: '   ' })).toBe(defaultDshHome())
  })

  it('joins child segments onto the resolved HUOLI_HOME', () => {
    vi.stubEnv('HUOLI_HOME', '~/env-huoli')
    expect(dshHomePath()).toBe(join(homedir(), 'env-huoli'))
    expect(dshHomePath('storages', 'cache')).toBe(join(homedir(), 'env-huoli', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(dshHomeDisplay(resolve(defaultDshHome()))).toBe('~/.huoli')
    expect(dshHomeDisplay('/some/other/root')).toBe('$HUOLI_HOME')
  })

  it('owns the shared default agents home directory name', () => {
    expect(AGENTS_HOME_DIR_NAME).toBe('.agents')
    expect(DEFAULT_AGENTS_HOME_DISPLAY).toBe('~/.agents')
    expect(defaultAgentsHome()).toBe(join(homedir(), '.agents'))
  })

  it('resolves an explicit agents home before HUOLI_AGENTS_HOME and the default', () => {
    const envHome = join(homedir(), 'env-agents')

    expect(resolveAgentsHome('/tmp/explicit-agents', { HUOLI_AGENTS_HOME: '~/env-agents' })).toBe(resolve('/tmp/explicit-agents'))
    expect(resolveAgentsHome(undefined, { HUOLI_AGENTS_HOME: '~/env-agents' })).toBe(envHome)
    expect(resolveAgentsHome(undefined, {})).toBe(defaultAgentsHome())
  })

  it('treats an empty or whitespace-only HUOLI_AGENTS_HOME as unset', () => {
    expect(resolveAgentsHome(undefined, { HUOLI_AGENTS_HOME: '' })).toBe(defaultAgentsHome())
    expect(resolveAgentsHome(undefined, { HUOLI_AGENTS_HOME: '   ' })).toBe(defaultAgentsHome())
  })

  it('labels a resolved agents home by whether it is the default root', () => {
    expect(agentsHomeDisplay(resolve(defaultAgentsHome()))).toBe('~/.agents')
    expect(agentsHomeDisplay('/some/other/root')).toBe('$HUOLI_AGENTS_HOME')
  })

  it.each([
    [undefined, join(homedir(), '.huoli')],
    ['', join(homedir(), '.huoli')],
    ['   ', join(homedir(), '.huoli')],
    ['~/env-huoli', join(homedir(), 'env-huoli')],
    ['./relative-huoli', resolve('./relative-huoli')],
  ] as const)('resolves cache paths with HUOLI_HOME=%j', (home, expectedHome) => {
    vi.stubEnv('HUOLI_HOME', home)
    try {
      expect(dshCachePath()).toBe(join(expectedHome, 'cache'))
      expect(dshCachePath('models', 'index.json')).toBe(join(expectedHome, 'cache', 'models', 'index.json'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('resolves configured cache homes before the environment', () => {
    vi.stubEnv('HUOLI_HOME', '~/env-huoli')
    try {
      expect(dshCachePath({ dshHome: '~/explicit-huoli' })).toBe(join(homedir(), 'explicit-huoli', 'cache'))
      expect(dshCachePath({ dshHome: './explicit-huoli' }, 'attachments', 'request-images'))
        .toBe(resolve('./explicit-huoli/cache/attachments/request-images'))
      expect(dshCachePath({}, 'attachments')).toBe(join(homedir(), 'env-huoli', 'cache', 'attachments'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'huoli-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(alias)).resolves.toBe(await realpath(target))
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
