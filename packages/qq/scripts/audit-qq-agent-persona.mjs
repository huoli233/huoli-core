import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const oldRoot = process.argv[2] ?? 'E:/QQ-agent-six-mode-dev-20261012/src'
const here = path.dirname(fileURLToPath(import.meta.url))
const docs = path.join(here, '..', 'docs')
const rulesFile = path.join(here, '..', 'qq-bundle', 'prompts', 'persona-rules.md')
const reportFile = path.join(docs, 'qq-agent-persona-audit.json')

const groups = [
  {
    name: '两边声音',
    files: ['behavior/decision/counter-thinking.js', 'conversation/orchestrator.js'],
    hints: ['别只附和', '反对', '不同角度', '反例', 'counter', '纯附和'],
  },
  {
    name: '规划与开口理由',
    files: ['conversation/planner-prompt.js', 'behavior/decision/motive-map.js'],
    hints: ['innerThought', 'RESPOND', 'OBSERVE', 'WAIT', '开口理由', '动机', 'motive', 'inner'],
  },
  {
    name: '情绪与语气',
    files: ['conversation/planner-prompt.js', 'behavior/identity/tone-rotation.js', 'conversation/prompt.js'],
    hints: ['affect', 'valence', 'arousal', 'playfulness', 'hostility', '口吻', '情绪', '性格外显', '口是心非'],
  },
  {
    name: '发送前自检',
    files: ['conversation/draft-review.js', 'conversation/reply-rewriter.js'],
    hints: ['这像你说的吗', '客服', '错误前提', '没把握', '改写', 'revise', 'draft'],
  },
  {
    name: '关系与自我保护',
    files: ['behavior/identity/persona-tags.js', 'behavior/identity/relationship-prompt.js', 'conversation/prompt.js'],
    hints: ['关系', '熟悉', '边界', '只对他', '称呼', '不服从', '玩笑'],
  },
  {
    name: '主动与自我复盘',
    files: ['conversation/orchestrator.js', 'conversation/prompt.js', 'runtime/online-planner.js'],
    hints: ['主动', '无聊', '吐槽', '留空间', '复盘', '自言', '安静'],
  },
]

function collect(file) {
  const source = fs.readFileSync(file, 'utf8')
  const rows = []
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const text = line.trim()
    if (text.length < 14 || text.startsWith('//') || text.startsWith('import ')) continue
    if (!/['"`]/.test(text)) continue
    if (!/[\p{Script=Han}]/u.test(text) && !/prompt|affect|motive|draft|inner|revise|counter/i.test(text)) continue
    rows.push({ file: path.relative(oldRoot, file).replaceAll('\\', '/'), line: index + 1, text: text.slice(0, 600) })
  }
  return rows
}

const rows = []
for (const group of groups) {
  for (const name of group.files) {
    const file = path.join(oldRoot, name)
    if (!fs.existsSync(file)) continue
    const candidates = collect(file).filter(row => group.hints.some(hint => row.text.toLowerCase().includes(hint.toLowerCase())))
    for (const row of candidates) rows.push({ ...row, group: group.name })
  }
}

const rules = fs.readFileSync(rulesFile, 'utf8')
const topics = [...rules.matchAll(/^##\s+(.+)$/gmu)].map(match => match[1]?.trim() ?? '')
const coverage = groups.map(group => ({
  name: group.name,
  rows: rows.filter(row => row.group === group.name).length,
  ruleSection: topics.find(topic => topic.includes(group.name) || group.name.includes(topic)) ?? '',
}))
const report = {
  scannedAt: new Date().toISOString(),
  oldRoot,
  ruleFile: path.relative(path.join(here, '..'), rulesFile).replaceAll('\\', '/'),
  purpose: '旧版拟人规划提示与当前单轮规则对照；候选来自指定源码行，不等同于旧版运行时完整拼装。',
  groups: coverage,
  rows,
}
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ rows: rows.length, groups: coverage, reportFile }, null, 2))
