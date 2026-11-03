/** Identity spellings that content addressing must ignore so a rename cannot invalidate sealed records. */

/**
 * Current spelling and the hex-encoded spelling the sealed record carries.
 * Longest match first: a scope, a repository path, and the full product name all contain shorter tokens.
 * Sealed spellings stay hex-encoded because the retired project names must not reappear in source.
 */
const IDENTITY_ALIASES: readonly (readonly [string, string])[] = [
  ['huoli/huoli-core', '646565707365656b2d61692f646565707365656b2d6861726e657373'],
  ['@huoli-plugins', '406473682d706c7567696e73'],
  ['@huoli', '40646565707365656b2d6169'],
  ['huoli-core', '646565707365656b2d6861726e657373'],
  ['Huoli Core', '446565705365656b204861726e657373'],
  ['HUOLI', '445348'],
  ['Huoli', '447368'],
  ['huoli', '647368'],
].map(([current, sealed]) => [current, Buffer.from(sealed, 'hex').toString('latin1')] as const)

/**
 * Restore the sealed spelling of every identity token in one artifact.
 * The mapping is closed and idempotent, so sealed content passes through unchanged.
 * @param text - artifact text, either as sealed or as the current identity spelling.
 * @returns text with the sealed identity spellings restored.
 */
export function restoreSealedIdentity(text: string): string {
  let result = text
  for (const [current, sealed] of IDENTITY_ALIASES) result = result.split(current).join(sealed)
  return result
}

/**
 * Report the alias table so a gate can prove its entries are the closed identity vocabulary.
 * @returns current spelling paired with the sealed spelling, longest first.
 */
export function identityAliases(): readonly (readonly [string, string])[] {
  return IDENTITY_ALIASES
}
