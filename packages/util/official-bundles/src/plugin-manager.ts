/** The package names the plugin manager protects, hides, orders, or marks experimental. */

/**
 * Plugin packages the plugin manager refuses to disable or remove, because management itself needs them; a bundle that
 * contains one is read-only as well. Removing a name drops only this `management-required` refusal; the manager's own
 * entry, installation-carried bundles, and unaddressable rows stay protected by their own rules.
 */
export const PROTECTED_PLUGINS: ReadonlySet<string> = new Set([
  '@huoli/huoli-plugin-manager', '@huoli/cordis-plugin-loader',
  '@huoli/cordis-plugin-include', '@huoli/huoli-api-gateway',
  '@huoli/huoli-host-webserver', '@huoli/huoli-client-modules',
  '@huoli/huoli-client-ui-settings-plugin-inventory', '@huoli/huoli-client-ui-plugin-manager',
  '@huoli/huoli-host-plugin-inventory', '@huoli/huoli-typert-registry',
  '@huoli/huoli-api-remotes', '@huoli/huoli-api-remote-access',
  '@huoli/cordis-plugin-timer', '@huoli/huoli-client-connection',
  '@huoli/huoli-host-frontend-static', '@huoli/huoli-tools',
  '@huoli/huoli-hmr',
])

/**
 * Built-in profile bundles and persistent terminals, which have no plugin manager page.
 * Their Host availability and activation stay intact.
 */
export const HIDDEN_BUNDLES: ReadonlySet<string> = new Set([
  '@huoli/huoli-base',
  '@huoli/huoli-web-app',
  '@huoli/huoli-headless',
  '@huoli/huoli-sdk-app',
  '@huoli/huoli-acp-app',
  '@huoli/huoli-sdk-minimal',
  '@huoli/huoli-experimental-terminal-bundle',
])

/**
 * The optional bundles the plugin manager's main and More lists rank first, in this order. {@link MORE_BUNDLES}, not
 * this list, decides whether a bundle appears on the main list.
 */
export const EXTENSION_BUNDLES: readonly string[] = [
  '@huoli/huoli-experimental-agent-team-profile',
  '@huoli/huoli-experimental-voice-input-bundle',
  '@huoli/huoli-experimental-plugin-market-bundle',
  '@huoli/huoli-experimental-auto-review',
]

/**
 * The optional bundles the plugin manager's main list leaves out until the profile enables them; its More list,
 * which includes every eligible bundle, ranks them last in this order.
 */
export const MORE_BUNDLES: readonly string[] = [
  '@huoli/huoli-personalized-recommendations',
  '@huoli/huoli-experimental-inspector-profile',
  '@huoli/huoli-cua-bundle',
  '@huoli/huoli-experimental-tool-worktree',
  '@huoli/huoli-experimental-cot-translation-bundle',
  '@huoli/huoli-experimental-session-search',
  '@huoli/huoli-experimental-session-titles-bundle',
  '@huoli/huoli-experimental-badge-skill-bundle',
  '@huoli/huoli-experimental-ralph-bundle',
  '@huoli/huoli-subagent-codex',
  '@huoli/huoli-subagent-claude-code',
]

/** Official bundles the plugin manager marks with the Experimental badge. */
export const EXPERIMENTAL_BUNDLES: ReadonlySet<string> = new Set([
  '@huoli/huoli-personalized-recommendations',
  '@huoli/huoli-cua-bundle',
  '@huoli/huoli-experimental-agent-team-profile',
  '@huoli/huoli-experimental-voice-input-bundle',
  '@huoli/huoli-experimental-auto-review',
  '@huoli/huoli-experimental-inspector-profile',
  '@huoli/huoli-experimental-forge-bundle',
  '@huoli/huoli-experimental-tool-worktree',
  '@huoli/huoli-experimental-cot-translation-bundle',
  '@huoli/huoli-experimental-session-search',
  '@huoli/huoli-experimental-session-titles-bundle',
  '@huoli/huoli-experimental-badge-skill-bundle',
  '@huoli/huoli-experimental-ralph-bundle',
  '@huoli/huoli-experimental-plugin-market-bundle',
  '@huoli/huoli-experimental-liveshare',
])
