import type { UserConfig } from 'tsdown'
import { defineConfig } from 'tsdown'

/** Bundle the source-first DSH host half into the package's standard lib entry. */
export default defineConfig(({ env }) => {
  if (env?.HUOLI_BUILD_FACE === 'client') return { entry: '' } satisfies UserConfig
  return {
    entry: ['index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  } satisfies UserConfig
})
