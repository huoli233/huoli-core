// 原生插件迁移器：把上游身份的插件包就地改造成自有身份，供安装前或安装后使用
// 用法：node tools/compat/migrate-plugin.mjs --dir <插件包目录> [--apply]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dirIndex = args.indexOf('--dir');
if (dirIndex < 0) {
  console.error('缺少 --dir <插件包目录>');
  process.exit(2);
}
const ROOT = path.resolve(args[dirIndex + 1]);
const APPLY = args.includes('--apply');

const stats = { manifestFields: [], dependencies: 0, imports: 0, files: 0, warnings: [] };

// 清单字段改名：旧键存在且新键不存在时才搬
function migrateManifest(manifest) {
  for (const [from, to] of [['dsh', 'huoli']]) {
    if (manifest[from] !== undefined && manifest[to] === undefined) {
      manifest[to] = manifest[from];
      delete manifest[from];
      stats.manifestFields.push(from + ' → ' + to);
    }
  }
  const engines = manifest.engines;
  if (engines && typeof engines === 'object') {
    if (engines.dsh !== undefined && engines.huoli === undefined) {
      stats.warnings.push('engines.dsh 已改名为 engines.huoli，但两套版本语义是否等价未经验证，需人工确认范围');
      engines.huoli = engines.dsh;
      delete engines.dsh;
      stats.manifestFields.push('engines.dsh → engines.huoli');
    }
  }
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
    const deps = manifest[section];
    if (!deps || typeof deps !== 'object') continue;
    const next = {};
    for (const [name, range] of Object.entries(deps)) {
      const renamed = renamePackage(name);
      if (renamed !== name) stats.dependencies += 1;
      next[renamed] = range;
    }
    manifest[section] = next;
  }
  return migrateStrings(manifest);
}

// 清单里以包名开头的字符串同样要换，例如客户端注入声明的包名数组
function migrateStrings(node) {
  if (typeof node === 'string') {
    if (!node.startsWith('@deepseek-ai/')) return node;
    stats.dependencies += 1;
    return renamePackage(node);
  }
  if (Array.isArray(node)) return node.map(migrateStrings);
  if (node !== null && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) out[key] = migrateStrings(value);
    return out;
  }
  return node;
}

// 包名映射：包根换名，保留原样返回
function renamePackage(name) {
  if (name.startsWith('@deepseek-ai/dsh-')) return '@huoli/huoli-' + name.slice('@deepseek-ai/dsh-'.length);
  if (name === '@deepseek-ai/dsh') return '@huoli/huoli';
  if (name.startsWith('@deepseek-ai/')) return '@huoli/' + name.slice('@deepseek-ai/'.length);
  return name;
}

// 产物里的模块说明符改写：只改包根，保留子路径
function migrateSource(text) {
  return text
    .replace(/(['"])@deepseek-ai\/dsh-([\w.-]+)(\/[^'"]*)?\1/g, (m, q, pkg, rest) => {
      stats.imports += 1;
      return q + '@huoli/huoli-' + pkg + (rest ?? '') + q;
    })
    .replace(/(['"])@deepseek-ai\/dsh(\/[^'"]*)?\1/g, (m, q, rest) => {
      stats.imports += 1;
      return q + '@huoli/huoli' + (rest ?? '') + q;
    })
    .replace(/(['"])@deepseek-ai\/([\w.-]+)(\/[^'"]*)?\1/g, (m, q, pkg, rest) => {
      stats.imports += 1;
      return q + '@huoli/' + pkg + (rest ?? '') + q;
    });
}

const manifestPath = path.join(ROOT, 'package.json');
if (!fs.existsSync(manifestPath)) {
  console.error('不是插件包目录，缺少 package.json: ' + ROOT);
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const migrated = migrateManifest(manifest);
if (APPLY) fs.writeFileSync(manifestPath, JSON.stringify(migrated, null, 2) + '\n', 'utf8');

// 产物目录遍历：只处理 js 与 mjs
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!/\.(js|mjs|cjs)$/.test(entry.name)) continue;
    const text = fs.readFileSync(full, 'utf8');
    if (!text.includes('@deepseek-ai/')) continue;
    const next = migrateSource(text);
    if (next === text) continue;
    stats.files += 1;
    if (APPLY) fs.writeFileSync(full, next, 'utf8');
  }
}
walk(path.join(ROOT, 'lib'));

console.log((APPLY ? '已迁移' : '预演迁移') + ' ' + path.basename(ROOT));
console.log('清单字段: ' + (stats.manifestFields.join('、') || '无'));
console.log('依赖改名: ' + stats.dependencies + ' 条 · 源码说明符: ' + stats.imports + ' 处 · 文件: ' + stats.files);
for (const w of stats.warnings) console.log('注意: ' + w);
if (!APPLY) console.log('加 --apply 才写入');
