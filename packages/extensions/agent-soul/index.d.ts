import type { Context } from '@huoli/cordis'

export const name: 'dsh-agent-soul'
export const inject: readonly ['tools']
export function apply(ctx: Context): void
