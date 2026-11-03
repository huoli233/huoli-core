/** Shared names for the desktop Platform bridge. */
/** Private desktop channels; the Platform renderer receives bootstrap and locale updates. */
export const PLATFORM_IPC = {
  bootstrap: 'huoli-platform:bootstrap',
  localeChanged: 'huoli-platform:locale-changed',
  open: 'huoli-platform:open',
  bounds: 'huoli-platform:bounds',
  close: 'huoli-platform:close',
} as const

/** Resolved Platform language; Desktop resolves the system preference before sending it. */
export type PlatformLocale = 'en_US' | 'zh_CN'
