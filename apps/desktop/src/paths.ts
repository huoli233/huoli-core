/** Filesystem ownership for the Electron-managed desktop installation. */

import { join } from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'

/** Stable desktop installation paths under the shared Harness home. */
export interface DesktopPaths {
  readonly profile: string
  readonly lock: string
}

/**
 * Resolve every Electron-owned path without changing the shared data roots.
 * @param huoliHome - Harness home shared with npm-installed huoli.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(huoliHome: string = resolveHuoliHome()): DesktopPaths {
  return {
    profile: join(huoliHome, 'profiles', 'desktop'),
    lock: join(huoliHome, 'profiles', 'desktop', 'lock'),
  }
}
