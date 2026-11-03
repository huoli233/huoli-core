#!/usr/bin/env node

import { Context } from '@huoli/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@huoli/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@huoli/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})
