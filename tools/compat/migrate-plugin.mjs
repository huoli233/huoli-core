// 兼容入口：迁移能力已挪到项目内加载器，这里保留旧命令行用法
// 用法：node tools/compat/migrate-plugin.mjs --dir <插件包目录> [--apply]
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const project = path.resolve(here, '..', '..', '..')
const cli = path.join(project, 'loader', 'bin', 'huoli-loader.mjs')
const dirIndex = process.argv.indexOf('--dir')
if (dirIndex < 0) {
  console.error('缺少 --dir <插件包目录>')
  process.exit(2)
}
const dir = process.argv[dirIndex + 1]
const args = ['migrate', path.relative(project, path.resolve(dir)), ...process.argv.includes('--apply') ? ['--apply'] : []]
const run = spawnSync(process.execPath, [cli, ...args], { cwd: project, stdio: 'inherit' })
process.exit(run.status ?? 1)
