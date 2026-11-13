import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const oldRoot = 'E:/QQ-agent-six-mode-dev-20261012/src'
const currentRoot = 'E:/HuoLiFish/huoli-core/packages/qq'
const output = path.join(currentRoot, 'docs/qq-agent-prompt-audit.json')
const textExtensions = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.java', '.md', '.json', '.yaml', '.yml', '.xml', '.properties', '.txt'])
const promptContext = /prompt|instruction|system|persona|identity|roletext|rules|description/i
const promptText = /你是|你的角色|请根据|回复要求|请判断|必须|不要|不能|只输出|只返回|内部思考|心里|人设|规划|心流|回复|回答|图片|表情包|主动开口|群聊|私聊/
const rows = []
const files = []
const parsedFiles = []
const unparsedFiles = []

if (!fs.existsSync(oldRoot)) throw new Error(`旧版源码目录不存在：${oldRoot}`)

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) files.push(full)
  }
}

function nodeName(node) {
  const name = node.name ?? node.key
  if (!name) return ''
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  return ''
}

function groupFor(text, context) {
  const value = `${context} ${text}`.toLowerCase()
  if (/vision|image|图片|视频|表情包/.test(value)) return '媒体理解'
  if (/planner|plan|decision|mind|心流|规划|判断/.test(value)) return '思考与决策'
  if (/persona|identity|role|人设|角色|关系/.test(value)) return '人设与关系'
  if (/attention|addressee|wake|准入|唤醒|注意力/.test(value)) return '注意与唤醒'
  if (/proactive|heartbeat|主动|插话|无聊/.test(value)) return '主动行为'
  if (/reply|rewrite|split|response|回复|回答/.test(value)) return '回复表达'
  if (/memory|summary|diary|记忆|摘要|日记/.test(value)) return '记忆整理'
  if (/tool|description|工具/.test(value)) return '工具说明'
  return '其他提示文本'
}

function addRow(file, start, end, text, context, confidence, sourceType) {
  const value = String(text).trim()
  if (value.length < 8) return
  const modelText = promptText.test(value) && value.length >= 16
  const contextualText = promptContext.test(context) && value.length >= 12 && /[A-Za-z\u4e00-\u9fff]/.test(value)
  if (!modelText && !contextualText) return
  rows.push({
    file: path.relative(oldRoot, file).replace(/\\/g, '/'),
    line: start,
    endLine: end,
    group: groupFor(value, context),
    context,
    confidence,
    candidateReason: contextualText ? '提示词相关名称或字段' : '提示词文字关键词',
    sourceType,
    text: value,
  })
}

function scanJs(file, source) {
  const kind = /\.tsx?$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const seen = new Set()
  function visit(node) {
    const isTemplate = ts.isTemplateExpression(node)
    const isString = ts.isStringLiteralLike(node)
    if (isTemplate || isString) {
      const contextParts = []
      let parent = node.parent
      while (parent && contextParts.length < 8) {
        if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isVariableDeclaration(parent)) {
          const name = nodeName(parent)
          if (name) contextParts.push(name)
        }
        parent = parent.parent
      }
      const context = contextParts.reverse().join('.')
      const pos = node.getStart(tree)
      if (!seen.has(pos)) {
        seen.add(pos)
        const start = tree.getLineAndCharacterOfPosition(pos).line + 1
        const end = tree.getLineAndCharacterOfPosition(node.end).line + 1
        addRow(file, start, end, isTemplate ? node.getText(tree) : node.text, context, '高：JavaScript/TypeScript 语法树', '代码字符串')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
}

function scanJava(file, source) {
  const lines = source.split(/\r?\n/)
  const literal = /"""[\s\S]*?"""|"(?:\\.|[^"\\])*"/g
  let match
  while ((match = literal.exec(source))) {
    const start = source.slice(0, match.index).split(/\r?\n/).length
    const end = start + (match[0].match(/\n/g)?.length ?? 0)
    const context = lines.slice(Math.max(0, start - 5), Math.min(lines.length, end + 2)).join(' ')
    addRow(file, start, end, match[0], context, '中：Java 字符串与相邻代码行', 'Java 字符串')
  }
}

function scanStructured(file, source) {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.json') {
    let data
    try { data = JSON.parse(source) } catch { return }
    function visit(value, keyPath = []) {
      if (typeof value === 'string') addRow(file, 1, 1, value, keyPath.join('.'), '中：结构化字段名称', '配置文本')
      else if (Array.isArray(value)) value.forEach((item, index) => visit(item, [...keyPath, String(index)]))
      else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => visit(item, [...keyPath, key]))
    }
    visit(data)
    return
  }
  if (ext === '.md') {
    const lines = source.split(/\r?\n/)
    for (let index = 0; index < lines.length; index++) {
      if (promptText.test(lines[index]) || promptContext.test(lines[index])) addRow(file, index + 1, index + 1, lines[index], lines.slice(Math.max(0, index - 2), index + 1).join(' '), '中：文档行规则', '文档文本')
    }
  }
}

walk(oldRoot)
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  const ext = path.extname(file).toLowerCase()
  if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'].includes(ext)) {
    scanJs(file, source)
    parsedFiles.push(file)
  } else if (ext === '.java') {
    scanJava(file, source)
    parsedFiles.push(file)
  } else if (['.json', '.md'].includes(ext)) {
    scanStructured(file, source)
    parsedFiles.push(file)
  } else {
    unparsedFiles.push(file)
  }
}

rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
const currentPromptFiles = [
  'qq-bundle/prompts/rules.md',
  'qq-bundle/src/index.ts',
  'qq-bundle/src/rounds.ts',
  'qq-bundle/src/runtime.ts',
  'qq-bundle/src/decisions.ts',
  'qq-bundle/src/proactive-tools.ts',
  'qq-bundle/src/body-tools.ts',
  'qq-bundle/src/vision.ts',
  'qq-bundle/src/weblinks.ts',
  'qq-self/src/assembly.ts',
  'qq-vitals/src/render.ts',
  'qq-memory/src/recall.ts',
]
const result = {
  scannedAt: new Date().toISOString(),
  oldRoot,
  currentRoot,
  scope: '旧版 src 下的文本源码文件清单；JS/TS 用 TypeScript 语法树提取字符串，Java 用字符串规则提取，JSON 与 Markdown 按字段或行提取。',
  limitations: [
    '这里列出的是提示词候选，不代表每一条都会送进模型；静态扫描不能还原运行时拼接后的完整消息，也不能确认条件分支是否实际执行。',
    '提示词名称或字段中的短模板现在会纳入候选，但没有明显提示词名称或关键词的动态片段仍可能漏掉。',
    'Java 字符串的归类依赖附近代码行，置信度低于 JS/TS 语法树提取。',
    '本次未解析 XML 等格式；未解析文件会在 unparsedFiles 列出。二进制文件、压缩包、运行时数据库、外部配置和未纳入 src 的资源不在扫描范围。',
    '扫描到提示词不等于当前项目已移植；当前项目还需按运行时装配链逐项核验。',
  ],
  enumeratedFiles: files.length,
  parsedFiles: parsedFiles.length,
  unparsedFiles: unparsedFiles.map(file => path.relative(oldRoot, file).replace(/\\/g, '/')),
  scannedFiles: files.length,
  scannedByExtension: Object.fromEntries([...new Set(files.map(file => path.extname(file).toLowerCase()))].sort().map(ext => [ext, files.filter(file => path.extname(file).toLowerCase() === ext).length])),
  promptTextCount: rows.length,
  groupCounts: Object.fromEntries([...new Set(rows.map(row => row.group))].sort().map(group => [group, rows.filter(row => row.group === group).length])),
  currentPromptFiles: currentPromptFiles.map(file => ({ file, exists: fs.existsSync(path.join(currentRoot, file)) })),
  rows,
}

fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ output, scannedFiles: result.scannedFiles, promptTextCount: result.promptTextCount, groupCounts: result.groupCounts }, null, 2)}\n`)
