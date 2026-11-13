// B站自己逛完、又没有门卫时留下的推荐：QQ 这边只在主人私聊里看一眼，用一次就标记已读。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 一条留给 QQ 的 B 站推荐 */
export interface BiliShare {
  at: number
  bvid: string
  title: string
  url: string
  why: string
  up: string
  note: string
}

function dshHome(): string {
  const fromEnv = process.env.DSH_HOME
  return typeof fromEnv === 'string' && fromEnv.trim() !== '' ? fromEnv.trim() : path.join(os.homedir(), '.dsh')
}

/**
 * 取一条还没读过的推荐，并立刻标记已读；没有/过期/读过了都返回 undefined
 * @param file - 推荐文件，留空按 DSH_HOME 找
 * @returns 推荐事实
 */
export function claimBiliShare(file = ''): BiliShare | undefined {
  const target = file.trim() !== '' ? file.trim() : path.join(dshHome(), 'bili-eyes', 'pending-share.json')
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/u, ''))
    if (parsed === null || typeof parsed !== 'object') return undefined
    const row = parsed as Record<string, unknown>
    const at = typeof row.at === 'number' ? row.at : 0
    if (at <= 0 || Date.now() - at > 24 * 60 * 60_000) return undefined
    if (typeof row.seenAt === 'number') return undefined
    const bvid = typeof row.bvid === 'string' ? row.bvid : ''
    const title = typeof row.title === 'string' ? row.title : ''
    if (bvid === '' || title === '') return undefined
    // 先标记已读再返回：同一条不反复塞进提示词
    fs.writeFileSync(target, `${JSON.stringify({ ...row, seenAt: Date.now() }, null, 1)}\n`)
    return {
      at,
      bvid,
      title,
      url: typeof row.url === 'string' && row.url !== '' ? row.url : `https://www.bilibili.com/video/${bvid}`,
      why: typeof row.why === 'string' ? row.why : '',
      up: typeof row.up === 'string' ? row.up : '',
      note: typeof row.note === 'string' ? row.note : '',
    }
  } catch {
    return undefined
  }
}

/**
 * 把推荐写成给模型看的事实；只给事实和选择，不命令她一定要发
 * @param share - 推荐
 * @returns 提示词那一段
 */
export function biliShareLine(share: BiliShare): string {
  return [
    '[DATA] BILI_SHARE',
    `视频：${share.title}`,
    `BV：${share.bvid}`,
    `链接：${share.url}`,
    ...share.up === '' ? [] : [`UP：${share.up}`],
    ...share.why === '' ? [] : [`她当时的想法：${share.why}`],
    ...share.note === '' ? [] : [`她看到的：${share.note}`],
    'RULE: 这是她自己逛到、想给主人看的东西；想分享就优先用 qq_send_card，也可以 qq_send_message，不想分享就跳过。只说自己真看到的，不贴整段摘要，也不重复推荐。',
  ].join('\n')
}
