/**
 * Test-only client roster of the assembled viewer page.
 *
 * A served viewer page is the owner's own Web shell with the owner's client plugins; this roster is the
 * subset the viewer page specs need: the wire plugin, the Gateway, remote access, the Session/Workspace controllers,
 * the menu service, presentation plugins, and the Liveshare `./client` face, which mounts the viewer surfaces when the
 * carrier names a share. Every row is the package's own `/client` face registered as a module-table
 * factory. It must be imported only after {@link prepareViewerRemoteFaces} answered the generated
 * `/remote` faces these plugins import.
 *
 * @module @huoli/huoli-experimental-liveshare/tests/viewer-page-roster
 */

import * as apiGateway from '@huoli/huoli-api-gateway/client'
import * as apiRemoteAccess from '@huoli/huoli-api-remote-access/client'
import * as apiRemotes from '@huoli/huoli-api-remotes/client'
import * as apiSessionController from '@huoli/huoli-api-session-controller/client'
import * as apiWorkspaceController from '@huoli/huoli-api-workspace-controller/client'
import * as clientConnection from '@huoli/huoli-client-connection/client'
import * as clientFileUpload from '@huoli/huoli-client-file-upload/client'
import * as clientLocale from '@huoli/huoli-client-locale/client'
import * as clientModules from '@huoli/huoli-client-modules/client'
import * as clientResources from '@huoli/huoli-client-resources/client'
import * as clientShortcuts from '@huoli/huoli-client-shortcuts/client'
import * as uiAttachment from '@huoli/huoli-client-ui-attachment/client'
import * as uiChat from '@huoli/huoli-client-ui-chat/client'
import * as uiContextMenu from '@huoli/huoli-client-ui-context-menu/client'
import * as uiConversation from '@huoli/huoli-client-ui-conversation/client'
import * as uiDeliverables from '@huoli/huoli-client-ui-deliverables/client'
import * as uiFileDrag from '@huoli/huoli-client-ui-file-drag/client'
import * as uiLayout from '@huoli/huoli-client-ui-layout/client'
import * as uiRenderer from '@huoli/huoli-client-ui-renderer/client'
import * as uiSession from '@huoli/huoli-client-ui-session/client'
import * as uiSettings from '@huoli/huoli-client-ui-settings/client'
import * as uiSidebar from '@huoli/huoli-client-ui-sidebar/client'
import * as uiSidebarRight from '@huoli/huoli-client-ui-sidebar-right/client'
import * as uiTheme from '@huoli/huoli-client-ui-theme/client'
import * as uiTool from '@huoli/huoli-client-ui-tool/client'
import * as uiTrajectory from '@huoli/huoli-client-ui-trajectory/client'
import * as uiWorkspace from '@huoli/huoli-client-ui-workspace/client'
import * as typertRegistry from '@huoli/huoli-typert-registry/client'
import * as liveshare from '../src/client/index.ts'

/** One module-table row: the entry id the Loader creates, and that plugin's client exports. */
export interface ViewerPageRosterRow {
  readonly id: string
  readonly exports: Readonly<Record<string, unknown>>
}

/** Entry id of the module-system bootstrap whose exports the facade hands to the module system. */
export const VIEWER_PAGE_BOOTSTRAP_ID = '@huoli/huoli-client-modules'

/** The viewer page roster; Cordis composes these entries by service injection, so order is irrelevant. */
export const VIEWER_PAGE_ROSTER: readonly ViewerPageRosterRow[] = [
  { id: '@huoli/huoli-typert-registry', exports: typertRegistry },
  { id: '@huoli/huoli-experimental-liveshare', exports: liveshare },
  { id: VIEWER_PAGE_BOOTSTRAP_ID, exports: clientModules },
  { id: '@huoli/huoli-client-connection', exports: clientConnection },
  { id: '@huoli/huoli-api-gateway', exports: apiGateway },
  { id: '@huoli/huoli-api-remote-access', exports: apiRemoteAccess },
  { id: '@huoli/huoli-api-remotes', exports: apiRemotes },
  { id: '@huoli/huoli-api-session-controller', exports: apiSessionController },
  { id: '@huoli/huoli-api-workspace-controller', exports: apiWorkspaceController },
  { id: '@huoli/huoli-client-file-upload', exports: clientFileUpload },
  { id: '@huoli/huoli-client-locale', exports: clientLocale },
  { id: '@huoli/huoli-client-resources', exports: clientResources },
  { id: '@huoli/huoli-client-shortcuts', exports: clientShortcuts },
  { id: '@huoli/huoli-client-ui-renderer', exports: uiRenderer },
  { id: '@huoli/huoli-client-ui-theme', exports: uiTheme },
  { id: '@huoli/huoli-client-ui-settings', exports: uiSettings },
  { id: '@huoli/huoli-client-ui-layout', exports: uiLayout },
  { id: '@huoli/huoli-client-ui-session', exports: uiSession },
  { id: '@huoli/huoli-client-ui-sidebar', exports: uiSidebar },
  { id: '@huoli/huoli-client-ui-conversation', exports: uiConversation },
  { id: '@huoli/huoli-client-ui-chat', exports: uiChat },
  { id: '@huoli/huoli-client-ui-context-menu', exports: uiContextMenu },
  { id: '@huoli/huoli-client-ui-tool', exports: uiTool },
  { id: '@huoli/huoli-client-ui-attachment', exports: uiAttachment },
  { id: '@huoli/huoli-client-ui-file-drag', exports: uiFileDrag },
  { id: '@huoli/huoli-client-ui-sidebar-right', exports: uiSidebarRight },
  { id: '@huoli/huoli-client-ui-trajectory', exports: uiTrajectory },
  { id: '@huoli/huoli-client-ui-deliverables', exports: uiDeliverables },
  { id: '@huoli/huoli-client-ui-workspace', exports: uiWorkspace },
]
