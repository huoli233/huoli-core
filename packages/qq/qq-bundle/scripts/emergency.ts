// 本机急停命令：停止、恢复或查看当前状态

import path from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { BUNDLE_DEFAULTS } from '../src/defaults.ts'
import { createEmergencyStop } from '../src/emergency-stop.ts'

const action = process.argv[2] ?? 'status'
const reason = process.argv.slice(3).join(' ').trim() || '人工急停'
const file = path.join(resolveHuoliHome(), BUNDLE_DEFAULTS.emergencyStopFile)
const control = createEmergencyStop(file)

if (action === 'stop') {
  const state = control.stop(reason)
  console.log(JSON.stringify(state))
} else if (action === 'resume') {
  control.resume()
  console.log(JSON.stringify(control.state()))
} else if (action === 'status') {
  console.log(JSON.stringify(control.state()))
} else {
  console.error('用法：emergency.ts stop [原因] | resume | status')
  process.exitCode = 2
}
