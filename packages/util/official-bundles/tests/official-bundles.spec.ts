/** Shipped profile templates, and the offline catalog that does not depend on installed provider packages or registry requests. */

import { describe, expect, it } from 'vitest'
import { OFFICIAL_ON_DEMAND_CATALOG, ON_DEMAND_BUNDLES, PROFILE_TEMPLATES } from '../src/index.ts'

describe('Official on-demand catalog', () => {
  it('offers native subagents and default-hidden Computer Use with offline metadata', () => {
    expect(ON_DEMAND_BUNDLES).toEqual(['@huoli/huoli-subagent-claude-code', '@huoli/huoli-subagent-codex', '@huoli/huoli-cua-bundle'])
    expect(OFFICIAL_ON_DEMAND_CATALOG.find(entry => entry.packageName === '@huoli/huoli-cua-bundle'))
      .toMatchObject({ platforms: ['darwin'], listedByDefault: false })
    expect(OFFICIAL_ON_DEMAND_CATALOG.map(entry => entry.packageName)).toEqual(ON_DEMAND_BUNDLES)
    for (const entry of OFFICIAL_ON_DEMAND_CATALOG) {
      expect(entry.meta.icon).toMatch(/^data:image\/svg\+xml;base64,/)
      for (const text of [entry.meta.title, entry.meta.description]) {
        if (typeof text === 'string') throw new Error('Official metadata requires both shipped languages')
        expect(text.en).toMatch(/\S/)
        expect(text.zh).toMatch(/\S/)
      }
      expect(entry).not.toHaveProperty('version')
    }
  })
})

describe('Shipped profile templates', () => {
  it('stack each mode bundle on base except the standalone minimal SDK', () => {
    expect(PROFILE_TEMPLATES).toEqual({
      acp: { bundles: ['@huoli/huoli-base', '@huoli/huoli-acp-app'] },
      web: { bundles: ['@huoli/huoli-base', '@huoli/huoli-web-app'] },
      headless: { bundles: ['@huoli/huoli-base', '@huoli/huoli-headless'] },
      sdk: { bundles: ['@huoli/huoli-base', '@huoli/huoli-sdk-app'] },
      'sdk-minimal': { bundles: ['@huoli/huoli-sdk-minimal'] },
    })
  })
})
