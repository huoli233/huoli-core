/** Explicit exceptions and Host packages for the published dependency policy. */

/** Packages treated as Client/Host packages without declaring `huoli.client`. */
const CLIENT_FACE_INCLUDE: readonly string[] = []

/** Packages exempted from automatic Client/Host treatment despite declaring `huoli.client`. */
const CLIENT_FACE_EXCLUDE: readonly string[] = [
  '@huoli/huoli-api-session-controller',
  '@huoli/huoli-api-workspace-controller',
]

/** Host-only packages whose peer relays are deliberately flattened. */
const HOST_DEPENDENCY_PACKAGES: readonly string[] = [
  '@huoli/huoli-llm',
  '@huoli/huoli-session',
]

/** Required Cordis services whose Host imports are type-only. */
const REQUIRED_SERVICE_PEERS = {
  '@huoli/huoli-api-terminal-controller': ['@huoli/huoli-subprocess'],
} as const satisfies Readonly<Record<string, readonly string[]>>

/** Development-only package relationships not represented by source imports. */
const CONFIGURATION_ONLY_DEV_DEPENDENCIES = {
  '@huoli/huoli-client-locale': ['@huoli/huoli-api-remotes'],
  '@huoli/huoli-client-ui-conversation': [
    '@huoli/huoli-api-remotes',
    '@huoli/huoli-client-ui-workspace',
  ],
  '@huoli/huoli-client-ui-model-selection': ['@huoli/huoli-client-ui-input-trigger'],
  '@huoli/huoli-client-ui-sidebar': ['@huoli/huoli-client-ui-workspace'],
  '@huoli/huoli-client-ui-subagent': ['@huoli/huoli-client-ui-input-trigger'],
  '@huoli/huoli-client-ui-theme': ['@huoli/huoli-api-remotes'],
  '@huoli/huoli-client-ui-tool': ['@huoli/huoli-api-remotes'],
} as const satisfies Readonly<Record<string, readonly string[]>>

/** Workspace packages whose complete runtime surface is safe across duplicate installations. */
const DUPLICATE_SAFE_PACKAGES: readonly string[] = [
  '@huoli/huoli-brand',
  '@huoli/huoli-lazy-require',
  '@huoli/huoli-typert-protocol',
  '@huoli/huoli-util-code-language',
  '@huoli/huoli-util-crypto',
  '@huoli/huoli-util-values',
]

/**
 * Runtime exports whose values remain valid when npm installs another package copy.
 * New entries are forbidden by default. Automated agents must not add an
 * exception; every addition requires explicit human review and a dedicated,
 * prominent heading in the pull request description.
 */
const SAFE_HOST_DEPENDENCY_EXPORTS = {
  '@huoli/huoli-atomic-write': ['withFileLock', 'writeFileAtomic'],
  '@huoli/huoli-computer-use/brand': ['ComputerUseProviderName'],
  '@huoli/huoli-credentials': ['credentialKey'],
  '@huoli/huoli-deque': ['Deque'],
  // The Liveshare wire codec and identity helpers are stateless functions over caller-owned values.
  '@huoli/huoli-experimental-liveshare-protocol': [
    'LIVESHARE_CAPABILITIES', 'LIVESHARE_PROTOCOL_VERSION', 'parseRelayFrame', 'parseShareAccessState',
    'parseTunnelWorkerCommand', 'parseTunnelWorkerEvent', 'rawText', 'sendFrame', 'unsupportedFrameRefusal',
    'viewerRequestFields', 'identityFromKey', 'identityKeyOf',
  ],
  '@huoli/huoli-llm': ['callConfigEquals'],
  '@huoli/huoli-session': ['SessionId'],
  '@huoli/huoli-session-format': ['sessionFormatLogFilename'],
  '@huoli/huoli-storage-domain': ['defineDomain'],
  '@huoli/huoli-timeout': ['MAX_TIMER_DELAY_MS'],
  '@huoli/schemastery': ['default'],
} as const satisfies HostDependencyExports

/** Runtime exports that require every consumer to resolve the provider's shared peer instance. */
const PEER_REQUIRED_HOST_EXPORTS = {
  // Profile settings must match the installed Node provider's configuration schema.
  '@huoli/huoli-ptc-runtime-node/configuration': ['resolvePersistentExecution'],
  // CUA checks UserQuestionError and preserves AttachmentError from image admission.
  '@huoli/huoli-attachment': ['admitEncodedImages'],
  '@huoli/huoli-user-questions': ['UserQuestionError'],
  // `instanceof` checks need the translator's own class instance.
  '@huoli/huoli-experimental-translator': ['TranslationError'],
  // Stateless; a safe classification would turn the forge panel's forge and worktree peers into dependencies.
  '@huoli/huoli-experimental-forge': ['changeRequestKey'],
  '@huoli/huoli-experimental-worktree': ['generatedWorktreeName'],
  // The forge panel matches ctx.fs failures with `instanceof FsError`.
  '@huoli/huoli-fs': ['FsError'],
  '@huoli/huoli-scope': ['carrierKeyOf', 'createScope', 'scopeOf', 'scopeTarget'],
  // appendPluginRecord writes through the Session class's private log; pluginRecordOf is stateless.
  '@huoli/huoli-session': ['SESSION_FORMAT_VERSION', 'appendPluginRecord', 'pluginRecordOf'],
  '@huoli/huoli-session-persistence': ['SessionPersistenceNotFoundError'],
  // Readers recognize a deadline's TimeoutReason only by `instanceof` against their own copy.
  '@huoli/huoli-timeout': ['deadline'],
} as const satisfies HostDependencyExports

/** Exact import specifier to reviewed runtime exports. */
type HostDependencyExports = Readonly<Record<string, readonly string[]>>

/** Complete configurable input to package dependency classification. */
export interface PackageDependencyPolicy {
  readonly clientFaceInclude: readonly string[]
  readonly clientFaceExclude: readonly string[]
  readonly hostPackages: readonly string[]
  readonly requiredServicePeers?: Readonly<Record<string, readonly string[]>>
  readonly configurationOnlyDevDependencies: Readonly<Record<string, readonly string[]>>
  readonly duplicateSafePackages?: readonly string[]
  readonly safeHostDependencyExports: HostDependencyExports
  readonly peerRequiredHostExports: HostDependencyExports
}

/** Repository dependency policy consumed by verification and benchmarking. */
export const PACKAGE_DEPENDENCY_POLICY: PackageDependencyPolicy = {
  clientFaceInclude: CLIENT_FACE_INCLUDE,
  clientFaceExclude: CLIENT_FACE_EXCLUDE,
  hostPackages: HOST_DEPENDENCY_PACKAGES,
  requiredServicePeers: REQUIRED_SERVICE_PEERS,
  configurationOnlyDevDependencies: CONFIGURATION_ONLY_DEV_DEPENDENCIES,
  duplicateSafePackages: DUPLICATE_SAFE_PACKAGES,
  safeHostDependencyExports: SAFE_HOST_DEPENDENCY_EXPORTS,
  peerRequiredHostExports: PEER_REQUIRED_HOST_EXPORTS,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a package manifest declares a dynamically loaded Client entry. */
export function hasClientDeclaration(dshField: unknown): boolean {
  return isRecord(dshField) && Object.hasOwn(dshField, 'client')
}
