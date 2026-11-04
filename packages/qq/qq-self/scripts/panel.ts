// 离线生成面板：只读 SELF_DIR 里的状态文件，写一份 panel.md，不注入也不改状态

import process from 'node:process'
import { resolveSelfDir, resolveSettings } from '../src/defaults.ts'
import { generatePanelFile } from '../src/generate.ts'
import { createSelfStore } from '../src/store.ts'

// 只认 --dir 一个参数，别的写法一律拒
function dirFrom(argv: readonly string[]): string | undefined {
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at] ?? ''
    if (arg === '--dir') {
      const value = argv[at + 1] ?? ''
      if (value === '') throw new Error('--dir 后面要给一个目录')
      return value
    }
    if (arg.startsWith('--dir=')) return arg.slice('--dir='.length)
    throw new Error(`认不出 ${arg}，这里只认 --dir`)
  }
  return undefined
}

try {
  const settings = resolveSettings()
  const store = createSelfStore({ dir: resolveSelfDir({ dir: dirFrom(process.argv.slice(2)) }), settings })
  const file = generatePanelFile({ store, settings, at: Date.now() })
  process.stdout.write(`${file}\n`)
} catch (error) {
  const why = error instanceof Error ? error.message : String(error)
  process.stderr.write(`面板没生成出来：${why}\n`)
  process.exitCode = 1
}
