/**
 * The identity, timestamp, link, mutation, and durability-sink guarantees
 * MemoryVfs owes its consumers, asserted directly rather than through the
 * `node:fs` bridge.
 *
 * `huoli-fs-local` builds a version token from `dev:ino:size:mtimeNs:ctimeNs` and
 * refuses a write whose token moved since it read. Two properties carry that:
 * `ino` identifies the entry at a path, and `mtimeMs` moves on every write. The
 * timestamp cases freeze the clock, because these writes are in memory and two
 * revisions routinely land in the same millisecond — a real-clock test passes
 * whether or not the strict increment exists.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryVfs } from '../../src/storage/memory.ts'
import type { VfsBigIntStats, VfsMutation, VfsMutationSink, VfsStats } from '../../src/storage/types.ts'

const identity = (vfs: MemoryVfs, path: string): bigint =>
  (vfs.statSync(path, { bigint: true }) as VfsBigIntStats).ino

const linkCount = (vfs: MemoryVfs, path: string): bigint =>
  (vfs.statSync(path, { bigint: true }) as VfsBigIntStats).nlink

const modified = (vfs: MemoryVfs, path: string): number => (vfs.statSync(path) as VfsStats).mtimeMs

afterEach(() => { vi.restoreAllMocks() })

describe('entry identity', () => {
  it('distinguishes paths and holds each identity across repeated stats', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/huoli/one.txt', 'one')
    vfs.seed('/huoli/two.txt', 'two')
    const first = identity(vfs, '/huoli/one.txt')
    expect(identity(vfs, '/huoli/two.txt')).not.toBe(first)
    expect(identity(vfs, '/huoli/one.txt')).toBe(first)
  })

  it('forgets the identities under a directory removed as a subtree', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/huoli/skills/git/SKILL.md', '# git\n')
    const before = identity(vfs, '/huoli/skills/git/SKILL.md')
    vfs.rmSync('/huoli/skills', { recursive: true })
    vfs.seed('/huoli/skills/git/SKILL.md', '# git rebuilt\n')
    expect(identity(vfs, '/huoli/skills/git/SKILL.md')).not.toBe(before)
  })

  it('moves the source identity when a file replaces another path', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/huoli/from.txt', 'moved')
    vfs.seed('/huoli/to.txt', 'replaced')
    const [source, destination] = [identity(vfs, '/huoli/from.txt'), identity(vfs, '/huoli/to.txt')]
    vfs.renameSync('/huoli/from.txt', '/huoli/to.txt')
    const renamed = identity(vfs, '/huoli/to.txt')
    expect(vfs.readFileSync('/huoli/to.txt', 'utf8')).toBe('moved')
    expect([renamed === source, renamed === destination]).toEqual([true, false])
  })
})

describe('modification time', () => {
  it('hydrates explicit metadata without confusing timestamps with permission bits', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/huoli/restored', 'value', { mode: 0o600, mtimeMs: 1_600_000_000_000 })
    vfs.seedDirectory('/huoli/restored-directory', { mode: 0o700, mtimeMs: 1_600_000_000_001 })
    const stats = vfs.statSync('/huoli/restored') as VfsStats
    const directory = vfs.statSync('/huoli/restored-directory') as VfsStats
    expect([stats.mode & 0o777, stats.mtimeMs]).toEqual([0o600, 1_600_000_000_000])
    expect([directory.mode & 0o777, directory.mtimeMs]).toEqual([0o700, 1_600_000_000_001])
  })

  it('advances on every write even while the clock stands still', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const vfs = new MemoryVfs()
    vfs.seed('/huoli/log.jsonl', 'first\n')
    const seeded = modified(vfs, '/huoli/log.jsonl')
    vfs.writeFileSync('/huoli/log.jsonl', 'second\n')
    const written = modified(vfs, '/huoli/log.jsonl')
    vfs.appendFileSync('/huoli/log.jsonl', 'third\n')
    const appended = modified(vfs, '/huoli/log.jsonl')
    vfs.truncateSync('/huoli/log.jsonl', 6)
    const truncated = modified(vfs, '/huoli/log.jsonl')
    expect([written > seeded, appended > written, truncated > appended]).toEqual([true, true, true])
    // One millisecond per revision: the increment is the minimum that separates
    // two tokens, not a coarser bump that would skew a real timestamp.
    expect(truncated - seeded).toBe(3)
  })

  it('takes the clock once the clock has passed the entry', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const vfs = new MemoryVfs()
    vfs.seed('/huoli/log.jsonl', 'first\n')
    clock.mockReturnValue(1_700_000_005_000)
    vfs.writeFileSync('/huoli/log.jsonl', 'second\n')
    expect(modified(vfs, '/huoli/log.jsonl')).toBe(1_700_000_005_000)
  })

  it('extends truncation with zero bytes', async () => {
    const vfs = new MemoryVfs()
    vfs.seed('/huoli/file', new Uint8Array([1, 2]))
    vfs.truncateSync('/huoli/file', 5)
    expect([...vfs.readFileSync('/huoli/file') as Uint8Array]).toEqual([1, 2, 0, 0, 0])
    const handle = vfs.open('/huoli/file', 'r+')
    await handle.truncate(7)
    expect([...vfs.readFileSync('/huoli/file') as Uint8Array]).toEqual([1, 2, 0, 0, 0, 0, 0])
  })

  it('advances a directory only when its immediate entry set changes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/huoli/workspace')
    const empty = modified(vfs, '/huoli/workspace')
    vfs.writeFileSync('/huoli/workspace/file.txt', 'one')
    const created = modified(vfs, '/huoli/workspace')
    vfs.writeFileSync('/huoli/workspace/file.txt', 'two')
    const rewritten = modified(vfs, '/huoli/workspace')
    vfs.rmSync('/huoli/workspace/file.txt')
    const removed = modified(vfs, '/huoli/workspace')
    expect([created > empty, rewritten === created, removed > rewritten]).toEqual([true, true, true])
  })
})

describe('mutation publication', () => {
  it('publishes only committed runtime changes and keeps image seeding silent', () => {
    const vfs = new MemoryVfs()
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })
    vfs.seed('/huoli/seeded.txt', 'seeded')
    expect(mutations).toEqual([])
    vfs.writeFileSync('/huoli/seeded.txt', 'changed')
    vfs.mkdirSync('/huoli/created')
    vfs.chmodSync('/huoli/created', 0o700)
    vfs.renameSync('/huoli/seeded.txt', '/huoli/renamed.txt')
    vfs.rmSync('/huoli/created', { recursive: true })
    expect(mutations.map(mutation => ({
      kind: mutation.kind,
      path: mutation.path,
      ...mutation.kind === 'write' ? { entryChanged: mutation.entryChanged } : {},
      ...mutation.kind === 'chmod' ? { mode: mutation.mode } : {},
    }))).toEqual([
      { kind: 'write', path: '/huoli/seeded.txt', entryChanged: false },
      { kind: 'mkdir', path: '/huoli/created' },
      { kind: 'chmod', path: '/huoli/created', mode: 0o700 },
      { kind: 'remove', path: '/huoli/seeded.txt' },
      { kind: 'write', path: '/huoli/renamed.txt', entryChanged: true },
      { kind: 'remove', path: '/huoli/created' },
    ])
    const renamed = mutations[4]
    expect(renamed?.kind === 'write' && new TextDecoder().decode(renamed.bytes)).toBe('changed')
    expect(() => { vfs.writeFileSync('/missing/file', 'no') }).toThrow(/ENOENT/)
    expect(mutations).toHaveLength(6)
  })

  it('contains a faulty observer and lets disposal stop later notifications', () => {
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/huoli')
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = vfs.subscribe(() => { throw new Error('observer failed') })
    const seen: string[] = []
    const second = vfs.subscribe((mutation) => { seen.push(mutation.path) })
    vfs.writeFileSync('/huoli/one', '1')
    first()
    second()
    vfs.writeFileSync('/huoli/two', '2')
    expect(seen).toEqual(['/huoli/one'])
    expect(reported).toHaveBeenCalledOnce()
  })

  it('feeds the same complete mutations to a durable sink and live subscribers', async () => {
    const recorded: VfsMutation[] = []
    let flushes = 0
    const sink: VfsMutationSink = {
      record: (mutation) => { recorded.push(mutation) },
      flush: async () => { flushes += 1 },
    }
    const vfs = new MemoryVfs({ sink })
    vfs.seedDirectory('/huoli')
    const observed: VfsMutation[] = []
    vfs.subscribe((mutation) => { observed.push(mutation) })
    vfs.writeFileSync('/huoli/log', 'a')
    vfs.appendFileSync('/huoli/log', 'bc')
    await vfs.flush()
    expect(observed).toEqual(recorded)
    expect(observed[0]).toBe(recorded[0])
    expect(recorded[0]).toMatchObject({ kind: 'write', path: '/huoli/log', mode: 0o644, entryChanged: true })
    expect(recorded[1]).toMatchObject({ kind: 'write', path: '/huoli/log', mode: 0o644, entryChanged: false, appendedFrom: 1 })
    expect(recorded[1]?.kind === 'write' && new TextDecoder().decode(recorded[1].bytes)).toBe('abc')
    expect(flushes).toBe(1)
  })

  it('publishes descriptor writes at the file identity current path', () => {
    const mutations: VfsMutation[] = []
    const vfs = new MemoryVfs()
    vfs.seed('/huoli/source', 'old')
    const descriptor = vfs.openFileSync('/huoli/source', 'r+')
    vfs.subscribe((mutation) => { mutations.push(mutation) })
    vfs.renameSync('/huoli/source', '/huoli/destination')
    mutations.length = 0
    descriptor.write(0, new TextEncoder().encode('new'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/huoli/destination'])
    expect(vfs.readFileSync('/huoli/destination', 'utf8')).toBe('new')
    vfs.unlinkSync('/huoli/destination')
    mutations.length = 0
    descriptor.write(0, new TextEncoder().encode('detached'))
    expect(mutations).toEqual([])
    expect(new TextDecoder().decode(descriptor.read(0, descriptor.stat().size))).toBe('detached')
  })

  it('reports the path identity through a BigInt file handle stat', async () => {
    const vfs = new MemoryVfs()
    vfs.seed('/huoli/session.lock', '')
    const handle = vfs.open('/huoli/session.lock', 'w')
    const held = await handle.stat({ bigint: true }) as VfsBigIntStats
    const current = vfs.statSync('/huoli/session.lock', { bigint: true }) as VfsBigIntStats

    expect([held.dev, held.ino]).toEqual([current.dev, current.ino])
    await handle.chmod(0o600)
    expect((vfs.statSync('/huoli/session.lock') as VfsStats).mode & 0o777).toBe(0o600)
    await handle.close()
  })

  it('decomposes a directory rename into replayable destination state', () => {
    const recorded: VfsMutation[] = []
    const vfs = new MemoryVfs({
      sink: { record: (mutation) => { recorded.push(mutation) }, flush: () => Promise.resolve() },
    })
    vfs.seedDirectory('/huoli/staging/nested', { mode: 0o700 })
    vfs.seed('/huoli/staging/nested/file', 'value', { mode: 0o600 })
    vfs.renameSync('/huoli/staging', '/huoli/published')

    expect(recorded.map(mutation => [mutation.kind, mutation.path])).toEqual([
      ['remove', '/huoli/staging'],
      ['mkdir', '/huoli/published'],
      ['mkdir', '/huoli/published/nested'],
      ['write', '/huoli/published/nested/file'],
    ])
    expect(recorded[3]).toMatchObject({ kind: 'write', mode: 0o600, entryChanged: true })
    expect(recorded[3]?.kind === 'write' && new TextDecoder().decode(recorded[3].bytes)).toBe('value')
  })
})

describe('directory rename', () => {
  it('rejects file, non-empty directory, and missing-parent destinations before mutation', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/huoli/source/nested/file', 'source')
    vfs.seed('/huoli/file', 'destination')
    vfs.seed('/huoli/non-empty/child', 'destination')
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })

    expect(() => { vfs.renameSync('/huoli/source', '/huoli/file') })
      .toThrow(expect.objectContaining({ code: 'ENOTDIR' }))
    expect(() => { vfs.renameSync('/huoli/source', '/huoli/non-empty') })
      .toThrow(expect.objectContaining({ code: 'ENOTEMPTY' }))
    expect(() => { vfs.renameSync('/huoli/source', '/missing/destination') })
      .toThrow(expect.objectContaining({ code: 'ENOENT' }))

    expect(vfs.readFileSync('/huoli/source/nested/file', 'utf8')).toBe('source')
    expect(vfs.readFileSync('/huoli/file', 'utf8')).toBe('destination')
    expect(vfs.readFileSync('/huoli/non-empty/child', 'utf8')).toBe('destination')
    expect(mutations).toEqual([])
  })

  it('replaces an empty directory with the source subtree', () => {
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/huoli/source/nested', { mode: 0o700 })
    vfs.seed('/huoli/source/nested/file', 'source')
    vfs.seedDirectory('/huoli/destination', { mode: 0o711 })

    vfs.renameSync('/huoli/source', '/huoli/destination')

    expect(vfs.existsSync('/huoli/source')).toBe(false)
    expect(vfs.readFileSync('/huoli/destination/nested/file', 'utf8')).toBe('source')
    expect((vfs.statSync('/huoli/destination') as VfsStats).mode & 0o777).toBe(0o755)
    expect((vfs.statSync('/huoli/destination/nested') as VfsStats).mode & 0o777).toBe(0o700)
  })
})

describe('hard links', () => {
  it('shares identity, bytes, and mode until one name is removed', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/huoli/session.jsonl', 'committed\n')
    vfs.linkSync('/huoli/session.jsonl', '/huoli/session-latest.jsonl')
    vfs.linkSync('/huoli/session-latest.jsonl', '/huoli/session-archive.jsonl')
    expect(identity(vfs, '/huoli/session-latest.jsonl')).toBe(identity(vfs, '/huoli/session.jsonl'))
    expect(linkCount(vfs, '/huoli/session.jsonl')).toBe(3n)
    expect(vfs.readFileSync('/huoli/session-latest.jsonl', 'utf8')).toBe('committed\n')
    const changedPaths: string[] = []
    vfs.subscribe((mutation) => { changedPaths.push(mutation.path) })
    vfs.appendFileSync('/huoli/session.jsonl', 'appended\n')
    expect(changedPaths).toEqual([
      '/huoli/session.jsonl',
      '/huoli/session-latest.jsonl',
      '/huoli/session-archive.jsonl',
    ])
    expect(vfs.readFileSync('/huoli/session.jsonl', 'utf8')).toBe('committed\nappended\n')
    expect(vfs.readFileSync('/huoli/session-latest.jsonl', 'utf8')).toBe('committed\nappended\n')
    vfs.chmodSync('/huoli/session-latest.jsonl', 0o600)
    expect((vfs.statSync('/huoli/session.jsonl') as VfsStats).mode & 0o777).toBe(0o600)
    vfs.unlinkSync('/huoli/session-latest.jsonl')
    expect(linkCount(vfs, '/huoli/session.jsonl')).toBe(2n)
    vfs.unlinkSync('/huoli/session-archive.jsonl')
    expect(linkCount(vfs, '/huoli/session.jsonl')).toBe(1n)
    expect(vfs.readFileSync('/huoli/session.jsonl', 'utf8')).toBe('committed\nappended\n')
  })

  it('treats rename between names of the same node as a no-op', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/huoli/source', 'value')
    vfs.linkSync('/huoli/source', '/huoli/alias')
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })

    vfs.renameSync('/huoli/source', '/huoli/alias')

    expect(vfs.readFileSync('/huoli/source', 'utf8')).toBe('value')
    expect(vfs.readFileSync('/huoli/alias', 'utf8')).toBe('value')
    expect(linkCount(vfs, '/huoli/source')).toBe(2n)
    expect(mutations).toEqual([])
  })

  it('retargets linked names through file replacement and directory moves', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/huoli/replacement', 'replacement')
    vfs.seed('/huoli/target', 'old')
    vfs.linkSync('/huoli/target', '/huoli/target-alias')
    const replaced = vfs.openFileSync('/huoli/target', 'r+')
    vfs.renameSync('/huoli/replacement', '/huoli/target')
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })

    replaced.write(0, new TextEncoder().encode('changed'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/huoli/target-alias'])
    expect(vfs.readFileSync('/huoli/target', 'utf8')).toBe('replacement')
    expect(vfs.readFileSync('/huoli/target-alias', 'utf8')).toBe('changed')
    expect(linkCount(vfs, '/huoli/target-alias')).toBe(1n)

    vfs.seed('/huoli/tree/file', 'tree')
    vfs.linkSync('/huoli/tree/file', '/huoli/outside')
    const moved = vfs.openFileSync('/huoli/tree/file', 'r+')
    vfs.renameSync('/huoli/tree', '/huoli/moved')
    mutations.length = 0
    moved.write(0, new TextEncoder().encode('moved'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/huoli/outside', '/huoli/moved/file'])
    expect(linkCount(vfs, '/huoli/moved/file')).toBe(2n)

    vfs.rmSync('/huoli/moved', { recursive: true })
    mutations.length = 0
    moved.write(0, new TextEncoder().encode('kept!'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/huoli/outside'])
    expect(vfs.readFileSync('/huoli/outside', 'utf8')).toBe('kept!')
    expect(linkCount(vfs, '/huoli/outside')).toBe(1n)
  })

  it('rejects renaming a file over an existing directory', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/huoli/file', 'value')
    vfs.seedDirectory('/huoli/directory')
    expect(() => { vfs.renameSync('/huoli/file', '/huoli/directory') }).toThrow(expect.objectContaining({ code: 'EISDIR' }))
    expect(vfs.readFileSync('/huoli/file', 'utf8')).toBe('value')
    expect(vfs.statSync('/huoli/directory').isDirectory()).toBe(true)
  })
})
