// 离线扫描旧 QQ Agent 的决策、规划、提示词与当前 DSH 落点

import fs from 'node:fs'
import path from 'node:path'

const oldRoot = 'E:/QQ-agent-six-mode-dev-20261012/src'
const currentRoot = 'E:/HuoLiFish/huoli-core/packages/qq'
const dirs = ['behavior/decision', 'conversation', 'prompt', 'runtime', 'memory', 'behavior/identity', 'behavior/feedback']
const files = []

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.isFile() && /\.(js|ts)$/.test(entry.name)) files.push(full)
  }
}

for (const dir of dirs) {
  const full = path.join(oldRoot, dir)
  if (fs.existsSync(full)) walk(full)
}

const groups = {
  planner: ['online-planner', 'planner-prompt', 'inner-model', 'deep-state'],
  admission: ['admission-pipeline', 'worth-replying', 'reply-likelihood', 'speak-system-one', 'speak-ladder', 'dynamic-budget', 'speech-budget'],
  initiative: ['proactive-', 'heartbeat-decider', 'chat-pulse', 'cold', 'ambient'],
  attention: ['addressee', 'attention-budget', 'situation-brief', 'semantic-addressee', 'conversation-thread', 'intent-competition'],
  reply: ['draft-review', 'reply-rewriter', 'reply-splitter', 'reply-rescue', 'counter-thinking', 'self-repetition'],
  persona: ['persona', 'unified', 'style', 'relationship-prompt', 'creator-prompt'],
  scheduler: ['scheduler', 'dispatch', 'queue', 'clock', 'policy'],
  reflection: ['reflection', 'self-review', 'auto-review', 'proactive-self-review'],
}

const rows = files.map((file) => {
  const rel = path.relative(oldRoot, file).replace(/\\/g, '/')
  const name = path.basename(file)
  const group = Object.entries(groups).find(([, keys]) => keys.some(key => name.includes(key) || rel.includes(key)))?.[0] ?? 'other'
  const text = fs.readFileSync(file, 'utf8')
  return {
    file: rel,
    group,
    lines: text.split(/\r?\n/).length,
    chars: text.length,
    exports: [...text.matchAll(/export\s+(?:async\s+function|function|const|class)\s+([\w$]+)/g)].map(match => match[1]),
    hasPrompt: /prompt|instructions|innerThought|mind|system/i.test(text),
    hasDecision: /action|decision|verdict|allow|should|judge|speak|worth|wait|observe/i.test(text),
  }
})

const current = [
  'qq-bundle/src/index.ts',
  'qq-bundle/src/rounds.ts',
  'qq-bundle/src/runtime.ts',
  'qq-bundle/src/proactive-tools.ts',
  'qq-bundle/prompts/rules.md',
  'qq-channel/src/final-text.ts',
  'qq-channel/src/tools.ts',
  'qq-attention/src/wake-policy.ts',
  'qq-material/src/collect.ts',
  'qq-self/src/assembly.ts',
  'qq-self/src/tools.ts',
  'qq-vitals/src/render.ts',
  'qq-memory/src/index.ts',
  'docs/三份实施单落地对照.md',
]

const result = {
  scannedAt: new Date().toISOString(),
  oldRoot,
  currentRoot,
  oldFiles: rows.length,
  groupCounts: Object.fromEntries(Object.keys(groups).map(key => [key, rows.filter(row => row.group === key).length])),
  modelVisibleContracts: {
    mind: ['move', 'reason', 'focus', 'tone', 'inner', 'next'],
    text: '只写真正发给对方的正文',
    autonomousNudge: '完整自主安静群聊或最近活跃私聊给模型一次自己开口机会',
    privateReply: '私聊必须实际发出一条正文',
    noSecondLoop: '不额外请求规划模型，不复制旧发送器',
  },
  currentFiles: current.map(file => ({ file, exists: fs.existsSync(path.join(currentRoot, file)) })),
  rows,
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
