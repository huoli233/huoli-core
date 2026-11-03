/** Injected terminal commands and keyed observable state. */
import type { WebTerminalId } from '@huoli/huoli-api-terminal-controller/types'
import type { TerminalView, TerminalViewState } from '@huoli/huoli-api-terminal-controller/client'
import type { HostObservable } from '@huoli/huoli-client-ui-slots'
import type { ThemeSnapshot } from '@huoli/huoli-client-ui-theme/client'

/** The terminal's React-free model is resolved by sidebar occurrence. */
export interface TerminalInjected {
  /** @param key - sidebar occurrence key. @returns its terminal commands. */
  readonly view: (key: string) => TerminalView
  readonly keyedHooks: { readonly terminal: (key: string) => HostObservable<TerminalViewState> }
}


/** The terminal screen follows the resolved application theme through a framework hook. */
export interface TerminalBodyInjected extends TerminalInjected {
  readonly hooks: { readonly theme: HostObservable<ThemeSnapshot> }
}

declare module '@huoli/huoli-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** An existing Host terminal selected from the Session terminal list. */
    terminal: { terminalId: WebTerminalId } | { shellPath: string }
  }
}
