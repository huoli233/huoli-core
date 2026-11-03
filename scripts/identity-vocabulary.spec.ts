import { describe, expect, it } from 'vitest'
import { identityAliases, restoreSealedIdentity } from './identity-vocabulary.ts'

describe('sealed identity vocabulary', () => {
  it('restores every recorded spelling to the sealed one', () => {
    for (const [current, sealed] of identityAliases()) {
      expect(current).not.toBe(sealed)
      expect(restoreSealedIdentity(`a ${current} b`)).toBe(`a ${sealed} b`)
    }
  })

  it('is idempotent and leaves unrelated text untouched', () => {
    const text = identityAliases().map(([current]) => current).join(' ')
    const once = restoreSealedIdentity(text)
    expect(restoreSealedIdentity(once)).toBe(once)
    expect(restoreSealedIdentity('packages/util/brand/README.md')).toBe('packages/util/brand/README.md')
  })

  it('leaves no current spelling behind in restored text', () => {
    const restored = restoreSealedIdentity(identityAliases().map(([current]) => current).join(' '))
    for (const [current] of identityAliases()) expect(restored).not.toContain(current)
  })
})
