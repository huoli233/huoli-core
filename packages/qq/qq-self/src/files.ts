// 目录里的文件名：读写都从这里取，别处不许再写字面量

/** SELF_DIR 下的文件，一份文件只放一类事实 */
export const FILES = {
  /** 宪法八条 */
  constitution: 'constitution.md',
  /** 面板与首行的生成时间 */
  panel: 'panel.md',
  /** 叙事五章 */
  narrative: 'narrative.md',
  /** 停手开关 */
  pause: 'PAUSE',
  /** 想弄明白的事 */
  questions: 'questions.jsonl',
  /** 她相信的事 */
  claims: 'claims.jsonl',
  /** 判断错的地方与改法 */
  errors: 'errors.jsonl',
  /** 项目，暂停期间的提议也记在这里 */
  projects: 'projects.jsonl',
  /** 答应过的事 */
  commitments: 'commitments.jsonl',
  /** drive 与 agency 两档账 */
  ledger: 'ledger.jsonl',
  /** 每天三行 */
  day: 'day.jsonl',
  /** 两把钥匙的留痕 */
  keys: 'keys.jsonl',
  /** 阶段推进的留痕 */
  stage: 'stage.jsonl',
} as const
