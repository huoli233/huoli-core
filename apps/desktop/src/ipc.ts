import type { DesktopFileActions } from '@huoli/huoli-client-ui-file-actions/types'
/** Typed preload operations exposed only by the Electron shell. */

import type { DesktopKeyboardApi, DesktopShortcutsApi } from '@huoli/huoli-client-shortcuts/protocol'
import type { IpcMainInvokeEvent } from 'electron'
import type { DesktopBrowserBridge } from '@huoli/huoli-client-ui-sidebar-browser/types'
import type { DesktopFileDrag } from '@huoli/huoli-util-file-drag'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  fileSave: 'huoli-desktop:file-save',
  clipboardImageRead: 'huoli-desktop:clipboard-image-read',
  shortcutsInput: 'huoli-desktop:shortcuts-input',
  shortcutsCloseWindow: 'huoli-desktop:shortcuts-close-window',
  shortcutsGet: 'huoli-desktop:shortcuts-get',
  shortcutsEdit: 'huoli-desktop:shortcuts-edit',
  shortcutsChanged: 'huoli-desktop:shortcuts-changed',
  shortcutsRecording: 'huoli-desktop:shortcuts-recording',
  boot: 'huoli-desktop:boot',
  enterWorkspace: 'huoli-desktop:enter-workspace',
  onboardingActive: 'huoli-desktop:onboarding-active',
  onboardingApiKey: 'huoli-desktop:onboarding-api-key',
  bootFailed: 'huoli-desktop:boot-failed',
  browserAcquire: 'huoli-desktop:browser-acquire',
  browserRelease: 'huoli-desktop:browser-release',
  browserOpenRequested: 'huoli-desktop:browser-open-requested',
  directoryPick: 'huoli-desktop:directory-pick',
  fileDragPrepare: 'huoli-desktop:file-drag-prepare',
  fileDragCancel: 'huoli-desktop:file-drag-cancel',
  fileDragStart: 'huoli-desktop:file-drag-start',
  fileDragRelease: 'huoli-desktop:file-drag-release',
  deviceInfo: 'huoli-desktop:device-info',
  localeBootstrap: 'huoli-desktop:locale-bootstrap',
  localeChanged: 'huoli-desktop:locale-changed',
  updatesStatus: 'huoli-desktop:updates-status',
  updatesOpen: 'huoli-desktop:updates-open',
  updatesPresentation: 'huoli-desktop:updates-presentation',
  nativeThemeSet: 'huoli-desktop:native-theme-set',
  windowFullscreen: 'huoli-desktop:window-fullscreen',
  windowsAppearance: 'huoli-desktop:windows-appearance',
  windowsMenu: 'huoli-desktop:windows-menu',
} as const

/** Desktop release update state rendered by desktop-owned UI. */
export type DesktopUpdatePreparationFailureKind = 'stop-failed' | 'tasks-changed' | 'tasks-unavailable' | 'fullscreen-timeout'

export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
  /** Main-owned diagnostics without subprocess output or credentials; hidden until expanded. */
  readonly technicalDetails?: string
  readonly percent?: number
  readonly failedOperation?: 'check' | 'download' | 'install'
  /** Main-owned preparation cause; UI wording is selected by the active locale. */
  readonly preparationFailure?: DesktopUpdatePreparationFailureKind
}

/** Classified failure copy selected by the Web locale without exposing raw updater diagnostics. */
export type DesktopUpdateFailureKind =
  | 'check'
  | 'check-network'
  | 'download'
  | 'download-network'
  | 'install'
  | 'install-network'
  | 'stop-failed'
  | 'tasks-changed'
  | 'tasks-unavailable'
  | 'fullscreen-timeout'

/** Semantic status content; actions open main-process confirmation dialogs only. */
export interface DesktopUpdatePresentation {
  readonly phase: DesktopUpdateState['phase']
  readonly version?: string
  readonly percent?: number
  readonly failure?: DesktopUpdateFailureKind
}

/** Product documents cannot supply update versions, package URLs, or installation authorization. */
export interface HuoliDesktopProductApi {
  readonly fileActions: DesktopFileActions
  readonly protocolVersion: 1
  readonly browser: DesktopBrowserBridge
  readonly fileDrag: DesktopFileDrag
  readonly keyboard: DesktopKeyboardApi
  readonly shortcuts: DesktopShortcutsApi
  /**
   * Local machine description for the feedback questionnaire.
   * @returns `name=value` fields separated by `; `, with no hostname, user name, or serial number.
   */
  deviceInfo(): Promise<string>
  readonly updates: {
    status(): Promise<DesktopUpdatePresentation>
    open(): Promise<void>
    subscribe(listener: (state: DesktopUpdatePresentation) => void): () => void
  }
}

/** Scheme of Desktop-owned application documents. */
export const SCHEME = 'huoli-app'

/**
 * Reject IPC outside the allowed Desktop document origins.
 * @param event - IPC caller whose frame URL supplies the origin.
 * @param hostnames - Desktop document hosts allowed for this operation.
 */
export function assertDesktopSender(event: IpcMainInvokeEvent, hostnames: readonly string[]): void {
  const senderFrame = event.senderFrame
  if (senderFrame === null) throw new Error('huoli desktop: rejected IPC without a sender frame')
  const url = new URL(senderFrame.url)
  if (url.protocol !== `${SCHEME}:` || !hostnames.includes(url.hostname)) {
    throw new Error('huoli desktop: rejected IPC from an unowned renderer')
  }
}
