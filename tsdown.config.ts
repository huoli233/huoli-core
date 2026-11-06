import { globSync } from 'node:fs'
import { defineConfig } from 'tsdown'
import { decoratorPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'
import { workspacePackageGlobs } from './scripts/workspace-package-globs.ts'

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.HUOLI_BUILD_FACE must be host or client, received ${String(value)}`)
}

/**
 * 平时那趟打包用宿主类型编译出来的 js；客户端那趟只挑声明了浏览器产物的包，各自出加载入口和浏览器文件。
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.HUOLI_BUILD_FACE)
  const packages = workspacePackageGlobs(globSync(['vendor/*/package.json', 'packages/*/*/package.json'], { cwd: import.meta.dirname }))
  return {
    workspace: [...packages, 'apps/cli'],
    entry: client ? '' : ['lib/types/{index,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [decoratorPlugin()],
  }
})
