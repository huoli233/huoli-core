// 清掉 QQ 的运行现场，保留下人格文件和本地技能

import fs from 'node:fs'
import path from 'node:path'

const runtimeNames = [
  'attachments',
  'edges.jsonl',
  'qq-actions.json',
  'qq-attention.json',
  'qq-balance.json',
  'qq-balance-prices.json',
  'qq-continuity.json',
  'qq-decisions.jsonl',
  'qq-emergency-stop.json',
  'qq-farewell.json',
  'qq-group-history.jsonl',
  'qq-images.json',
  'qq-liveness.json',
  'qq-liveness.json.bak',
  'qq-maintenance.log',
  'qq-memory-health.log',
  'qq-memory-ledger.json',
  'qq-memory-queue.json',
  'qq-memory.json',
  'qq-memory.json.bak',
  'qq-mode.json',
  'qq-mutes.json',
  'qq-pacing.json',
  'qq-private-poll.jsonl',
  'qq-proactive.json',
  'qq-proactive.json.bak',
  'qq-relations.json',
  'qq-relations.json.bak',
  'qq-sayings.json',
  'qq-sent.json',
  'qq-slang.json',
  'qq-sticker-usage.json',
  'qq-stickers.json',
  'qq-subject.json',
  'qq-thoughts.json',
  'qq-timeline.jsonl',
  'qq-vitals.json',
  'qq-vitals.json.bak',
  'qq-voices.json',
  'session-query.sqlite',
  'session-query.sqlite-shm',
  'session-query.sqlite-wal',
  'sessions',
  'spill',
  'storages',
  'vectors',
] as const

const runtimePrefixes = ['qq-liveness.json', 'qq-memory-queue.json', 'qq-sent.json'] as const

const root = path.resolve(process.cwd())
const dataDir = path.join(root, 'data')
if (path.basename(root) !== 'huoli-core') {
  throw new Error(`拒绝重置：根目录必须是 huoli-core，收到 ${root}`)
}
const packageFile = path.join(root, 'package.json')
if (!fs.existsSync(packageFile)) {
  throw new Error(`拒绝重置：${root} 不像项目根目录`)
}
const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8')) as { name?: unknown }
if (packageJson.name !== '@huoli/huoli-root') throw new Error(`拒绝重置：${root} 不是 Huoli 项目根目录`)
if (!process.argv.includes('--yes')) {
  throw new Error('这会删除 QQ 运行数据。确认后加 --yes 再执行。')
}

const removed: string[] = []
for (const name of runtimeNames) {
  const target = path.join(dataDir, name)
  if (!target.startsWith(`${dataDir}${path.sep}`)) throw new Error(`拒绝删除目录外的路径：${target}`)
  if (!fs.existsSync(target)) continue
  fs.rmSync(target, { recursive: true, force: true })
  removed.push(name)
}
for (const name of fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : []) {
  if (!runtimePrefixes.some(prefix => name.startsWith(`${prefix}.`))) continue
  const target = path.join(dataDir, name)
  if (!target.startsWith(`${dataDir}${path.sep}`)) throw new Error(`拒绝删除目录外的路径：${target}`)
  fs.rmSync(target, { recursive: true, force: true })
  removed.push(name)
}

process.stdout.write(`reset_runtime_data root=${root} removed=${removed.length}\n`)
for (const name of removed) process.stdout.write(`removed ${name}\n`)
