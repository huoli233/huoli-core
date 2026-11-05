// 群身份只在这里判：查不到就是查不到，绝不把它当成普通成员

/** 三个真正认识的档位 */
export const GROUP_ROLES = ['owner', 'admin', 'member'] as const

/** 认出来的档位，外加一个「不知道」 */
export type GroupRole = (typeof GROUP_ROLES)[number] | 'unknown'

/** 一次判定的结果：档位与「这次到底知道不知道」 */
export interface RoleRead {
  /** 判出来的档位 */
  role: GroupRole
  /** 是不是真知道：空壳与怪字符串都算不知道 */
  known: boolean
}

/**
 * 判一个档位字符串
 * @param raw - 对方给的档位，可能是空、可能是怪字符串
 * @returns 档位与知道不知道
 */
export function parseGroupRole(raw: unknown): RoleRead {
  // 只认字符串：别的类型一律当没给，免得把对象串成 [object Object] 再当真
  const text = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if ((GROUP_ROLES as readonly string[]).includes(text)) return { role: text as GroupRole, known: true }
  return { role: 'unknown', known: false }
}

/**
 * 判一次成员查询的结果
 * @param info - 查询回来的成员信息，可能是空壳
 * @returns 档位与知道不知道
 */
export function roleOfMember(info: unknown): RoleRead {
  if (info === null || info === undefined || typeof info !== 'object') return { role: 'unknown', known: false }
  const record = info as { role?: unknown; nickname?: unknown; card?: unknown; join_time?: unknown }
  // 空壳：三样都空、入群时间还是零，说明这次根本没查到人，档位里写什么都不能信
  const nickname = typeof record.nickname === 'string' ? record.nickname.trim() : ''
  const card = typeof record.card === 'string' ? record.card.trim() : ''
  const joined = typeof record.join_time === 'number' ? record.join_time : 0
  if (nickname === '' && card === '' && joined === 0) return { role: 'unknown', known: false }
  return parseGroupRole(record.role)
}

/**
 * 她在这个群里能不能管人
 * @param read - 上一次判定的结果
 * @returns 只有明确是群主或管理员才算能
 */
export function canModerate(read: RoleRead): boolean {
  if (!read.known) return false
  return read.role === 'owner' || read.role === 'admin'
}
