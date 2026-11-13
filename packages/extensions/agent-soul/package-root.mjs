import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))

/** The package directory for both source execution and the bundled lib/index.js entry. */
export const packageRoot = basename(moduleDirectory) === 'lib'
  ? dirname(moduleDirectory)
  : moduleDirectory
