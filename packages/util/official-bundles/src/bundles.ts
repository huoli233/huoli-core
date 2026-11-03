/** The bundle package names the huoli installation selects, offers, installs on demand, or retires. */

/** Installation-owned defaults used when a shipped profile is first opened. */
export interface ProfileTemplate {
  /** Ordered bundle layer list. */
  bundles: readonly string[]
}

/** The shipped profile templates auto-initialized on first use, by name. */
export const PROFILE_TEMPLATES: Record<string, ProfileTemplate> = {
  acp: {
    bundles: ['@huoli/huoli-base', '@huoli/huoli-acp-app'],
  },
  web: {
    bundles: ['@huoli/huoli-base', '@huoli/huoli-web-app'],
  },
  headless: {
    bundles: ['@huoli/huoli-base', '@huoli/huoli-headless'],
  },
  sdk: {
    bundles: ['@huoli/huoli-base', '@huoli/huoli-sdk-app'],
  },
  'sdk-minimal': {
    bundles: ['@huoli/huoli-sdk-minimal'],
  },
}

/**
 * Installation-owned bundle tuples that an earlier release wrote into a shipped profile; app-boot replaces an exact
 * match with the {@link PROFILE_TEMPLATES} entry of the same name and leaves every other list untouched.
 */
export const INSTALLATION_OWNED_PROFILE_TUPLES: Readonly<Record<string, readonly string[]>> = {
  headless: ['@huoli/huoli-base', '@huoli/huoli-web-app', '@huoli/huoli-headless'],
}

/** Bundles an earlier release shipped and the installation no longer carries; app-boot removes them from profiles. */
export const RETIRED_BUNDLES: ReadonlySet<string> = new Set([
  // The Web composition mounts Schedule itself
  // ([upgrade guide](../../../../docs/upgrade-guide/v0.2.0-rc.2/schedule-bundle-retired/guide.md)).
  '@huoli/huoli-experimental-schedule-bundle',
])

/** The bundle list a `huoli plugin` init uses for a name with no shipped template. */
export const DEFAULT_PROFILE_BUNDLES: readonly string[] = ['@huoli/huoli-base']

/**
 * The bundles the huoli installation ships for a person to switch on: each a
 * runtime dependency of the installation that declares `huoli.bundle.patch`,
 * an `icon`, and `./locale/*.json` display metadata, selected by no shipped
 * template, and offered switched off by the plugin manager except persistent
 * terminals, which have no page switch
 * ([rationale](../../../../.agents/notes/implemented/process/2026-09-15-shipped-optional-bundles.md),
 * [admission](../../../../.agents/notes/implemented/architecture/2026-09-21-experimental-capabilities-as-optional-bundles.md)).
 */
export const OPTIONAL_BUNDLES: readonly string[] = [
  '@huoli/huoli-personalized-recommendations',
  '@huoli/huoli-experimental-session-search',
  '@huoli/huoli-experimental-ralph-bundle',
  '@huoli/huoli-experimental-terminal-bundle',
  '@huoli/huoli-experimental-badge-skill-bundle',
  '@huoli/huoli-experimental-session-titles-bundle',
  '@huoli/huoli-experimental-agent-team-profile',
  '@huoli/huoli-experimental-voice-input-bundle',
  '@huoli/huoli-experimental-cot-translation-bundle',
  '@huoli/huoli-experimental-auto-review',
  '@huoli/huoli-experimental-inspector-profile',
  '@huoli/huoli-experimental-liveshare',
  '@huoli/huoli-experimental-plugin-market-bundle',
  '@huoli/huoli-experimental-tool-worktree',
  '@huoli/huoli-experimental-forge-bundle',
]

/** Public HUOLI release members available through the ordinary on-demand bundle installer. */
export const ON_DEMAND_BUNDLES: readonly string[] = [
  '@huoli/huoli-subagent-claude-code',
  '@huoli/huoli-subagent-codex',
  '@huoli/huoli-cua-bundle',
]
