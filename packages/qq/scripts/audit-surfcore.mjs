#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const EXCLUDED = new Set(['.git', 'node_modules', 'dist', 'release'])
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'])
const TEXT_EXT = new Set(['.md', '.yml', '.yaml', '.json'])

function walk(root, current = root, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue
    const full = path.join(current, entry.name)
    if (entry.isDirectory()) walk(root, full, files)
    else files.push(full)
  }
  return files
}

function count(text, pattern) {
  return [...text.matchAll(pattern)].length
}

function moduleArea(relative) {
  const parts = relative.split(path.sep)
  if (parts[0] === 'src') return 'src'
  if (parts[0] === 'plugins' && parts[1] === 'surfcore') {
    return `plugin/${parts[2] ?? 'root'}`
  }
  if (parts[0] === 'scripts') return 'scripts'
  if (parts[0] === 'docs') return 'docs'
  if (parts[0] === 'dsh') return 'dsh'
  return parts[0] ?? 'root'
}

function mechanismTags(relative, text) {
  const lower = `${relative}\n${text.slice(0, 80_000)}`.toLowerCase()
  const tags = []
  const rules = {
    reply: /reply|wake|prompt|conversation/,
    attention: /wake|attention|trigger|purpose/,
    memory: /memory/,
    identity: /identity|persona|role/,
    safety: /allow|deny|guard|sensitive|acl|privacy|security/,
    token: /token|budget|ledger|billing/,
    media: /voice|sticker|image|media|video|audio/,
    bili: /bili/,
    pet: /pet/,
    mcp: /mcp/,
    console: /console|client|api/,
    scheduler: /schedule|timer|interval|night/,
    storage: /store|state|atomic|backup/,
  }
  for (const [tag, pattern] of Object.entries(rules)) {
    if (pattern.test(lower)) tags.push(tag)
  }
  return tags
}

function audit(root) {
  const allFiles = walk(root)
  const codeFiles = allFiles.filter(file => CODE_EXT.has(path.extname(file)))
  const textFiles = allFiles.filter(file => TEXT_EXT.has(path.extname(file)))
  const sourceText = codeFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n')
  const inventory = []
  const areas = new Map()
  const mechanisms = new Map()
  const riskCalls = {
    synchronousIO: [],
    atomicsWait: [],
    processSpawn: [],
    network: [],
    timers: [],
    intervals: [],
    loops: [],
  }
  const routes = []
  const entrypoints = []

  for (const file of codeFiles) {
    const relative = path.relative(root, file)
    const text = fs.readFileSync(file, 'utf8')
    const lines = text.split('\n').length
    const area = moduleArea(relative)
    const row = {
      path: relative,
      area,
      lines,
      imports: count(text, /\bimport\s+(?:[^'"]+?\s+from\s+)?['"][^'"]+['"]/g),
      exports: count(text, /\bexport\s+(?:default\s+)?/g),
      functions: count(text, /\bfunction\s+[A-Za-z_$]/g) + count(text, /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g),
      classes: count(text, /\bclass\s+[A-Za-z_$]/g),
      syncIO: count(text, /\b(?:readFileSync|writeFileSync|appendFileSync|mkdirSync|readdirSync|statSync|existsSync)\s*\(/g),
      timers: count(text, /\bsetTimeout\s*\(/g),
      intervals: count(text, /\bsetInterval\s*\(/g),
      atomicsWait: count(text, /\bAtomics\.wait\s*\(/g),
      spawns: count(text, /\b(?:spawn|execFile|exec)\s*\(/g),
      mechanisms: mechanismTags(relative, text),
    }
    inventory.push(row)
    const summary = areas.get(area) ?? { files: 0, lines: 0, syncIO: 0, timers: 0, intervals: 0, spawns: 0 }
    summary.files += 1
    summary.lines += lines
    summary.syncIO += row.syncIO
    summary.timers += row.timers
    summary.intervals += row.intervals
    summary.spawns += row.spawns
    areas.set(area, summary)
    for (const tag of row.mechanisms) mechanisms.set(tag, (mechanisms.get(tag) ?? 0) + 1)

    for (const match of text.matchAll(/\b(readFileSync|writeFileSync|appendFileSync|readdirSync|statSync|existsSync)\s*\(/g)) {
      riskCalls.synchronousIO.push({ path: relative, line: text.slice(0, match.index).split('\n').length, call: match[1] })
    }
    for (const match of text.matchAll(/\bAtomics\.wait\s*\(/g)) {
      riskCalls.atomicsWait.push({ path: relative, line: text.slice(0, match.index).split('\n').length })
    }
    for (const match of text.matchAll(/\b(spawn|execFile|exec)\s*\(/g)) {
      riskCalls.processSpawn.push({ path: relative, line: text.slice(0, match.index).split('\n').length, call: match[1] })
    }
    for (const match of text.matchAll(/\b(fetch|https?\.request|https?\.get)\s*\(/g)) {
      riskCalls.network.push({ path: relative, line: text.slice(0, match.index).split('\n').length, call: match[1] })
    }
    for (const match of text.matchAll(/\bsetTimeout\s*\(/g)) {
      riskCalls.timers.push({ path: relative, line: text.slice(0, match.index).split('\n').length })
    }
    for (const match of text.matchAll(/\bsetInterval\s*\(/g)) {
      riskCalls.intervals.push({ path: relative, line: text.slice(0, match.index).split('\n').length })
    }
    for (const match of text.matchAll(/\bwhile\s*\(\s*(?:true|1)\s*\)|\bfor\s*\(\s*;\s*;\s*\)/g)) {
      riskCalls.loops.push({ path: relative, line: text.slice(0, match.index).split('\n').length })
    }
    for (const match of text.matchAll(/["']((?:\/[A-Za-z0-9_-]+){2,})["']/g)) {
      if (match[1].startsWith('/api/') || match[1].startsWith('/dsh-surfcore/')) {
        routes.push({ path: relative, line: text.slice(0, match.index).split('\n').length, route: match[1] })
      }
    }
    for (const match of text.matchAll(/\b(?:server\.)?(?:listen|createServer|on)\s*\(\s*['"]([^'"]+)['"]/g)) {
      entrypoints.push({ path: relative, line: text.slice(0, match.index).split('\n').length, name: match[1] })
    }
  }

  const testFiles = codeFiles.filter(file => /(?:^|[/\\])(?:test|tests|scripts)[/\\]|(?:^|[/\\])test[-.]/i.test(path.relative(root, file)))
  const largest = [...inventory].sort((left, right) => right.lines - left.lines).slice(0, 30)
  const stateWrites = [...sourceText.matchAll(/\b(writeJsonAtomic|writeTextAtomic|atomicWriteJson|writeFile|rename|copyFile)\s*\(/g)].length
  const security = {
    timingSafeEqual: count(sourceText, /\btimingSafeEqual\s*\(/g),
    hostChecks: count(sourceText, /\b(?:host|origin|hostname)\b/gi),
    tokenChecks: count(sourceText, /\b(?:token|agentToken|consoleToken|petToken)\b/gi),
    safeFetch: count(sourceText, /\bsafe-fetch|safeFetch|validatePublicUrl\b/gi),
  }

  return {
    root,
    codeFiles: codeFiles.length,
    textFiles: textFiles.length,
    testLikeFiles: testFiles.length,
    areas: Object.fromEntries([...areas.entries()].sort((left, right) => right[1].lines - left[1].lines)),
    mechanisms: Object.fromEntries([...mechanisms.entries()].sort((left, right) => right[1] - left[1])),
    riskCalls,
    routes: routes.length,
    entrypoints,
    stateWrites,
    security,
    largest,
    inventory,
  }
}

const root = process.argv[2]
const jsonPath = process.argv[3] ?? ''
const csvPath = process.argv[4] ?? ''
if (root === undefined) {
  console.error('usage: node audit-surfcore.mjs <root> [json-output]')
  process.exit(2)
}
const result = audit(path.resolve(root))
const output = `${JSON.stringify(result, null, 2)}\n`
if (jsonPath !== '') {
  fs.mkdirSync(path.dirname(path.resolve(jsonPath)), { recursive: true })
  fs.writeFileSync(path.resolve(jsonPath), output)
}
if (csvPath !== '') {
  const columns = [
    'path', 'area', 'lines', 'imports', 'exports', 'functions', 'classes',
    'syncIO', 'timers', 'intervals', 'atomicsWait', 'spawns', 'mechanisms',
  ]
  const escapeCsv = value => `"${String(value ?? '').replaceAll('"', '""')}"`
  const rows = [columns.join(',')]
  for (const row of result.inventory) {
    rows.push(columns.map(column => escapeCsv(Array.isArray(row[column]) ? row[column].join('|') : row[column])).join(','))
  }
  fs.mkdirSync(path.dirname(path.resolve(csvPath)), { recursive: true })
  fs.writeFileSync(path.resolve(csvPath), `${rows.join('\n')}\n`)
}
process.stdout.write(output)
