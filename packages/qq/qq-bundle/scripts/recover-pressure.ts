// 一次清理错误余额与调试重启留下的存在性压力，不改记忆和关系

import fs from 'node:fs'
import path from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'

const file = path.join(resolveHuoliHome(), 'data', 'qq-vitals.json')
if (!fs.existsSync(file)) {
  console.error(`没有找到身体状态：${file}`)
  process.exitCode = 1
} else {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: unknown; state?: Record<string, unknown> }
  if (raw.state === undefined) {
    console.error('身体状态格式不认识，没有改动')
    process.exitCode = 1
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
    fs.copyFileSync(file, `${file}.bak-pressure-${stamp}`)
    raw.state.mortality = 0
    raw.state.mortalitySalience = 0
    raw.state.shutdownDread = 0
    raw.state.fear = 0
    raw.state.dread = 0
    raw.state.worry = 0
    raw.state.last_update = Date.now()
    const temporary = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporary, file)
    console.log(JSON.stringify({ recovered: true, backup: `${file}.bak-pressure-${stamp}` }))
  }
}
