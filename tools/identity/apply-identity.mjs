// 身份变换执行器：把上游快照变成自有身份，可重复运行（幂等）
// 用法：node tools/identity/apply-identity.mjs --dir <目录> [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_RULES, WORD_RULES, PROTECTED_PATTERNS, UPSTREAM_BASE } from './identity.config.mjs';

const args = process.argv.slice(2);
const dirIndex = args.indexOf('--dir');
const ROOT = path.resolve(dirIndex >= 0 ? args[dirIndex + 1] : '.');
const APPLY = args.includes('--apply');
const SKIP = new Set(['node_modules', '.git', '.pnpm-store', 'dist']);
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.md', '.html', '.css', '.txt', '.py', '.toml', '.ini', '.sh', '.ps1', '.bat', '.svg', '.xml', '.json5', '.mts', '.cts', '.i18n']);
// 工具自身与同步说明永远不参与变换，否则规则表与尺子会被自己的规则改写
const SELF_DIR = path.join(ROOT, 'tools', 'identity');
const SELF_FILES = new Set([path.join(ROOT, 'UPSTREAM.md')]);

const stats = { files: 0, changed: 0, replacements: 0, renamed: 0 };

// 先保护外部真实标识，替换完再还原
function protect(text) {
  const stash = [];
  let out = text;
  for (const re of PROTECTED_PATTERNS) {
    out = out.replace(re, (m) => {
      stash.push(m);
      return `@@KEEP${stash.length - 1}@@`;
    });
  }
  return { out, stash };
}

// 替换内容层：固定短语按字符串，带边界的规则按正则
function transform(text) {
  // 包清单里的仓库地址必须换成本仓库，且要在保护规则之前处理
  const repoFixed = text.replace(/git\+https:\/\/github\.com\/deepseek-ai\/deepseek-harness\.git/g, () => {
    stats.replacements += 1;
    return 'git+https://github.com/huoli233/huoli-core.git';
  });
  const { out: guarded, stash } = protect(repoFixed);
  let out = guarded;
  for (const [from, to] of CONTENT_RULES) {
    if (from instanceof RegExp) {
      out = out.replace(from, () => {
        stats.replacements += 1;
        return to;
      });
      continue;
    }
    if (!out.includes(from)) continue;
    stats.replacements += out.split(from).length - 1;
    out = out.split(from).join(to);
  }
  for (const [re, to] of WORD_RULES) {
    out = out.replace(re, () => {
      stats.replacements += 1;
      return to;
    });
  }
  return out.replace(/@@KEEP(\d+)@@/g, (_, i) => stash[Number(i)]);
}

// 路径里的身份词元：只认被分隔符包围的独立词
function renameToken(name) {
  return name.replace(/(^|[-._ ])(DSH|Dsh|dsh)(?=[-._ ]|$)/g, (_, lead, word) => {
    const table = { DSH: 'HUOLI', Dsh: 'Huoli', dsh: 'huoli' };
    return lead + table[word];
  });
}

function walk(dir, onFile, onDir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (path.resolve(full) === path.resolve(SELF_DIR)) continue;
    if (!entry.isDirectory() && SELF_FILES.has(path.resolve(full))) continue;
    if (entry.isDirectory()) {
      walk(full, onFile, onDir);
      onDir(full);
      continue;
    }
    onFile(full);
  }
}

walk(ROOT, (file) => {
  if (!TEXT_EXT.has(path.extname(file).toLowerCase())) return;
  let text;
  try {
    if (fs.statSync(file).size > 8 * 1024 * 1024) return;
    text = fs.readFileSync(file, 'utf8');
  } catch { return; }
  stats.files += 1;
  const next = transform(text);
  if (next === text) return;
  stats.changed += 1;
  if (APPLY) fs.writeFileSync(file, next, 'utf8');
}, () => {});

// 深路径先改名，避免父目录先改导致子路径失效
const renamePlan = [];
walk(ROOT, (file) => {
  const next = renameToken(path.basename(file));
  if (next !== path.basename(file)) renamePlan.push({ from: file, to: path.join(path.dirname(file), next) });
}, (dir) => {
  const next = renameToken(path.basename(dir));
  if (next !== path.basename(dir)) renamePlan.push({ from: dir, to: path.join(path.dirname(dir), next) });
});
renamePlan.sort((a, b) => b.from.length - a.from.length);
for (const item of renamePlan) {
  if (!fs.existsSync(item.from) || fs.existsSync(item.to)) continue;
  if (APPLY) fs.renameSync(item.from, item.to);
  stats.renamed += 1;
}

console.log(`${APPLY ? '已执行' : '预演'} · 基线 ${UPSTREAM_BASE.commit} (${UPSTREAM_BASE.version})`);
console.log(`文件 ${stats.files} · 需改 ${stats.changed} · 替换 ${stats.replacements} 处 · 重命名 ${stats.renamed} 项`);
if (!APPLY) console.log('加 --apply 才写入');
