/**
 * Choice lists the share dialog's create form and stored-share edit panel both present.
 *
 * @module @huoli/huoli-experimental-liveshare/src/client/share-options
 */

import type { SegmentedControlOption } from '@huoli/huoli-client-ui-primitives'
import type { PropsLocale } from '@huoli/huoli-client-ui-slots'
import type { NS } from './locales.ts'
import { SESSION_MODES, type ViewerSessionMode } from './viewer-capabilities.ts'

/** Translate seat the dialog's choice lists read their labels through. */
type Translate = PropsLocale<typeof NS>['t']

/**
 * The two session modes, in the order the host stores and reports them.
 * @param t - Localized copy.
 * @returns One option per session mode.
 */
export function sessionModeOptions(t: Translate): readonly SegmentedControlOption<ViewerSessionMode>[] {
  return SESSION_MODES.map(mode => ({
    value: mode,
    label: t(`dialog.sessionMode.${mode}` as const),
  }))
}
