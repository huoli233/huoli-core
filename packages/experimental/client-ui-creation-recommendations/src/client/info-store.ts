import { createSnapshotStore, type SnapshotStore } from '@huoli/huoli-client-store'

/** Remember the dismissed creation notice across sessions in this browser.
 * @returns a plugin-owned preference; unavailable storage only disables persistence.
 */
export function createCreationInfoStore(): SnapshotStore<boolean> {
  return createSnapshotStore(false, { persist: { name: 'huoli.creation-recommendations.info-dismissed' } })
}
