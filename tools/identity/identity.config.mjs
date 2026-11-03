// 身份变换的唯一参数表：上游标识 → 自有标识，外加不许动的外部真实标识
// 这张表本身就是关键词表，所以只允许活在工具目录里，不许进业务代码
// 本目录被执行器整体排除，否则规则会被自己的规则改写

export const UPSTREAM_BASE = {
  commit: 'ce7073d5',
  version: '0.2.2-alpha.2',
  remote: 'deepseek-ai/deepseek-harness'
};

// 外部真实标识：按完整模式保护，避免 URL 里的后缀被替换成死链
export const PROTECTED_PATTERNS = [
  /deepseek-(?:chat|reasoner|coder|v\d[\w.-]*|r\d[\w.-]*)/g,
  /api\.deepseek\.com/g,
  /platform\.deepseek\.com/g,
  /github\.com\/deepseek-ai\/[\w./#-]+/g,
  /deepseek-harness\.github\.io/g,
  /@deepseek-ai\/libreoffice-kit[\w-]*/g,
  /["']deepseek["']/g
];

// 内容替换：顺序即优先级；正则项带边界，纯字符串项是固定短语
export const CONTENT_RULES = [
  ['@deepseek-ai/dsh-', '@huoli/huoli-'],
  ['@deepseek-ai/dsh', '@huoli/huoli'],
  ['@deepseek-ai/', '@huoli/'],
  ['DeepSeek Harness', 'Huoli Core'],
  ['deepseek-harness', 'huoli-core'],
  ['deepseek-ai', 'huoli'],
  ['DSH_', 'HUOLI_'],
  // 目录与路径形态的 .dsh；后面跟字母的（...dshLaunch、x.dshBin）交给词素规则
  [/\.dsh(?![A-Za-z0-9])/g, '.huoli']
];

// 词素级替换：camelCase、PascalCase、snake 里的 dsh 也要换，普通单词（spreadsheet）不动
export const WORD_RULES = [
  [/Dsh(?![a-z])/g, 'Huoli'],
  [/\bDSH(?![a-z])/g, 'HUOLI'],
  [/(?<![A-Za-z0-9])dsh(?![a-z0-9])/g, 'huoli']
];
