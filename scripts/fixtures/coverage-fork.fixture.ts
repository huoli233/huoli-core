import { writeSync } from 'node:fs'
import { expect, it } from 'vitest'

declare global {
  /** Native process exit captured by this fixture's Node preload. */
  function __huoliCoverageFixtureExit(code: number): never
}

it('runs in the configured pool', () => {
  writeSync(2, `coverage-fixture-pid: ${process.pid}\n`)
  if (process.env.HUOLI_TEST_FORK_OUTCOME === 'exit') {
    globalThis.__huoliCoverageFixtureExit(23)
  }
  expect(2 + 2).toBe(4)
})
