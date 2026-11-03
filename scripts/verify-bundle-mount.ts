// 检查每个组合包的清单与 patch 文件：形态不对的话内核对整包或整行静默跳过

import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { load } from 'js-yaml'
import { uniqueRepoFiles } from './repo-files.ts'

// 只有出现这些字段，非插入型 patch 才真的会覆盖到一行
const OVERRIDE_KEYS = ['config', 'disabled', 'group', 'inject', 'intercept', 'isolate']

// 语料下限：仓库里的组合包数量低于这个数，说明扫描范围被改窄了
const MINIMUM_BUNDLES = 20

/** 一条不合规记录 */
interface Violation {
  file: string
  message: string
}

// 读出组合包清单里的组合声明，新字段优先
function declarationOf(manifest: unknown): unknown {
  if (manifest === null || typeof manifest !== 'object') return undefined
  const fields = manifest as { huoli?: { bundle?: unknown }; dsh?: { bundle?: unknown } }
  return fields.huoli?.bundle ?? fields.dsh?.bundle
}

// 把声明展开成 patch 文件列表，形态不对就记一条
function patchFilesOf(bundle: unknown, file: string, violations: Violation[]): string[] {
  if (bundle === null || typeof bundle !== 'object' || Array.isArray(bundle)) {
    violations.push({ file, message: 'huoli.bundle 必须是对象 { patch: 路径 或 路径数组 }，数组和字符串都不算' })
    return []
  }
  const declared = (bundle as { patch?: unknown }).patch
  if (typeof declared === 'string' && declared !== '') return [declared]
  if (Array.isArray(declared) && declared.length > 0 && declared.every(entry => typeof entry === 'string' && entry !== '')) {
    return declared as string[]
  }
  violations.push({ file, message: 'huoli.bundle.patch 必须是文件路径或非空路径数组' })
  return []
}

// 校验一个 patch 文件里的每条记录
function checkPatchFile(root: string, relativePath: string, violations: Violation[]): void {
  const file = join(root, relativePath)
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    violations.push({ file: relativePath, message: 'patch 文件读不到' })
    return
  }

  // !!js 是装载器自己解析的标记，这里只查结构，先去掉再解析
  const stripped = text.replace(/!!js\s+/g, '')
  let parsed: unknown
  try {
    parsed = load(stripped)
  } catch (error) {
    violations.push({ file: relativePath, message: `YAML 解析失败：${(error as Error).message}` })
    return
  }
  if (!Array.isArray(parsed)) {
    violations.push({ file: relativePath, message: 'patch 文件顶层必须是数组' })
    return
  }

  for (const [index, entry] of parsed.entries()) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      violations.push({ file: relativePath, message: `第 ${index + 1} 条不是映射` })
      continue
    }
    const row = entry as Record<string, unknown>
    if (row.insert !== undefined) {
      if (!Array.isArray(row.insert) || row.insert.length === 0) {
        violations.push({ file: relativePath, message: `第 ${index + 1} 条的 insert 必须是非空数组` })
        continue
      }
      for (const inserted of row.insert) {
        if (inserted === null || typeof inserted !== 'object' || Array.isArray(inserted)) {
          violations.push({ file: relativePath, message: `第 ${index + 1} 条 insert 里有非映射项` })
          continue
        }
        const item = inserted as Record<string, unknown>
        if (typeof item.id !== 'string' || item.id === '') violations.push({ file: relativePath, message: `第 ${index + 1} 条 insert 缺 id` })
        if (typeof item.name !== 'string' || item.name === '') violations.push({ file: relativePath, message: `第 ${index + 1} 条 insert 缺 name` })
      }
      continue
    }
    if (typeof row.id !== 'string' || row.id === '') {
      violations.push({ file: relativePath, message: `第 ${index + 1} 条既没有 insert 也没有 id` })
      continue
    }
    const overrides = OVERRIDE_KEYS.filter(key => row[key] !== undefined)
    if (overrides.length === 0) {
      violations.push({ file: relativePath, message: `第 ${index + 1} 条只写了 id/name，不会命中任何已存在的行；要挂新插件请放进 insert` })
    }
  }
}

// 扫描全部组合包，返回不合规记录
export function findBundleMountViolations(root: string): Violation[] {
  const violations: Violation[] = []
  const manifests = uniqueRepoFiles(root, ['packages/*/*/package.json'])
  let bundles = 0

  for (const manifest of manifests) {
    const relativePath = relative(root, manifest.abs).split('\\').join('/')
    const bundle = declarationOf(JSON.parse(readFileSync(manifest.abs, 'utf8')))
    if (bundle === undefined) continue
    bundles += 1
    const directory = relativePath.slice(0, relativePath.lastIndexOf('/'))
    for (const patchFile of patchFilesOf(bundle, relativePath, violations)) {
      checkPatchFile(root, join(directory, patchFile).split('\\').join('/'), violations)
    }
  }

  if (bundles < MINIMUM_BUNDLES) {
    violations.push({ file: 'packages', message: `只扫到 ${bundles} 个组合包，低于下限 ${MINIMUM_BUNDLES}，扫描范围可能被改窄` })
  }
  return violations
}

// 命令行入口：打印不合规记录并决定退出码
const rootArgument = process.argv.indexOf('--root')
const scanRoot = rootArgument === -1 ? resolve(import.meta.dirname, '..') : resolve(process.argv[rootArgument + 1] ?? '.')
const found = findBundleMountViolations(scanRoot)
for (const violation of found) console.error(`${violation.file}: ${violation.message}`)
console.log(`verify-bundle-mount: ${found.length === 0 ? '通过' : `${found.length} 条不合规`}`)
process.exitCode = found.length === 0 ? 0 : 1
