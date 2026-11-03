/**
 * Virtual root of the worker host's in-memory filesystem. Kept
 * in one module so the process shim, the path/os shims, and the VFS image
 * collector cannot drift apart.
 */

/** Virtual filesystem root; `process.cwd()` and every absolute path start here. */
export const HUOLI_ROOT = '/huoli'

/** `$HUOLI_HOME`: durable-state directory inside the image. */
export const HUOLI_HOME = `${HUOLI_ROOT}/home`

/** Flat, symlink-free package tree resolved by the worker module loader. */
export const HUOLI_NODE_MODULES = `${HUOLI_ROOT}/node_modules`

/** Image configuration directory: the VFS manifest and the shipped agent presets. */
export const HUOLI_CONFIG = `${HUOLI_ROOT}/config`

/** Default (empty) workspace directory. */
export const HUOLI_WORKSPACE = `${HUOLI_ROOT}/workspace`

/** Temporary directory reported by `os.tmpdir()`. */
export const HUOLI_TMP = `${HUOLI_ROOT}/tmp`
