# Agent Note: Identity-independent content addressing for sealed records

Status: implemented

English | [中文](2026-11-04-identity-independent-digests.zh.md)

## Problem

Several gates decide whether a record is trustworthy by re-deriving a hash from content: persistence schema digests and node keys, the frozen Agent Note archive manifest, its bilingual sidecar blob hashes, and the finalization checkpoints that lock accepted persistence acknowledgements. Each of those hash materials carried the project's identity twice over: as a versioned domain prefix, and as identity tokens inside the content itself (persisted event literals such as the session-title LLM tag, and archived prose naming packages and environment variables). Renaming the project therefore invalidated every recorded digest at once. The persisted types did not change; only their spelling did. Four `doc-sync` gates went red — `verify-persistence-changes`, `verify-persistence-releases`, `verify-persistence-formats`, and `verify-archived-agent-notes` — reporting `key does not match its subgraph digest`, `schema digest mismatch`, and `sealed content hash changed` for records that no reviewer wanted to touch.

The obvious repairs are all worse than the defect. Re-hashing the frozen corpus would destroy exactly the property the seals exist for, and `docs/persistence-changes/**` and `.agents/notes/archived/**` are frozen history that no later change may rewrite. Bumping a format version would claim a durable-format transition that did not happen. Skipping the gates, or whitelisting the paths that currently fail, would stop them from biting on the next real change — the failure the seals are there to catch.

## Decision

Content addressing is identity-independent for every sealed record. One closed vocabulary — [`scripts/identity-vocabulary.ts`](../../../../scripts/identity-vocabulary.ts) — lists the current spelling of each identity token against the spelling the seals already contain, and `restoreSealedIdentity` rewrites an artifact into its sealed spelling. The recorded spellings are hex-encoded, so no retired project name reappears in source, and the mapping is idempotent: sealed content passes through unchanged.

The sealed spelling is applied wherever a hash is compared against a record:

- [`schemaDigest`](../../../../scripts/persistence-schema-model.ts) hashes the versioned domain and the canonical graph after restoring identity spellings, so a schema's fingerprint survives a rename and stays equal to the digests recorded in `docs/persistence-changes/**`, `historical-formats/v*.schema.json`, and `releases/*.schema.json`.
- Canonical node numbering is derived from restored signatures too, because a fingerprint names nodes by position inside the minimized graph; without this, a renamed literal reorders otherwise-identical graphs and changes every ancestor digest.
- The archive manifest seal, the bilingual sidecar Git blob hashes, and the finalization checkpoint record digest compare restored content, so the frozen corpus validates as committed.

New records are written by the same functions. The identity vocabulary stays closed: adding a spelling is a reviewed gate change, not an automatic consequence of editing a package name.

## What a fingerprint still distinguishes

Every difference that is not an identity token changes the digest: property presence and optionality, union membership, literals, tuple cardinality, index signatures, source-compatibility policies, and canonical structure. [`persistence-schema-model.spec.ts`](../../../../scripts/persistence-schema-model.spec.ts) pins the primitive fingerprint that the committed history records, proves that the same structure fingerprints identically across the two spellings of a persisted literal, and proves that a literal differing beyond the identity token still changes it. [`archived-agent-notes.spec.ts`](../../../../scripts/archived-agent-notes.spec.ts) proves a renamed triplet still satisfies a seal recorded over the sealed text, and that one added sentence in the same file reports `sealed content hash changed`.

## Alternatives considered

**Verify history against both the current and the predecessor domain.** This was the first attempt: accept a recorded digest when it matches either domain prefix. It cannot validate the corpus. Eight committed schema snapshots also carry a renamed literal inside their content (`dsh-session-title-llm` became `huoli-session-title-llm` in a persisted event payload), so their node keys disagree with content under both domain prefixes, and the domain prefix is itself an identity token rather than an independent knob. Dual-domain verification would have needed a second, undocumented mechanism for the content half.

**Re-seal the frozen corpus.** Regenerating `manifest.json`, the sidecars, and the schema snapshots would make all four gates green in one commit. It also erases the append-only evidence that no archived note changed after archival, and it rewrites history that reviewers cite. The archive contract in [the Agent Note rules](../../README.md) forbids it, and the persistence history has the same freeze.

**Declare a new format version.** A version bump would let new domain-prefixed digests coexist with old ones without rewriting either, but the recorded transition would assert a durable-format change that never happened, and every later reader would have to consult a rename table to interpret two versions of the same type vocabulary.

**Skip the affected artifacts with a documented reason.** Downgrading `verify-archived-agent-notes` to a skippable gate was the fallback if no faithful comparison existed. It would have left 2,778 frozen artifacts — every archived Agent Note — without tamper evidence until the archive was re-sealed, so it was rejected once the restored-spelling comparison reproduced all of them.

## Consequences

A rename no longer invalidates recorded digests, seals, sidecar hashes, or finalization checkpoints: the four gates pass against the corpus as committed, and `verify-archived-agent-notes` checks all 2,778 frozen artifacts again. A reviewer can still detect a content edit to an archived note or a persistence type change, because only identity tokens are normalized away.

The cost is that two persisted literals differing solely by identity spelling fingerprint identically. That is the intended reading — a rename of the product is not a change to the durable format — but it does mean the vocabulary table is the only place where that judgment is made, so an addition to it needs the same review as any widening of a gate.

Nothing in frozen history was rewritten: `docs/persistence-changes/**` and `.agents/notes/archived/**` are byte-identical to their committed revisions. The current generated artifacts were regenerated once from the generator, because their digests are a current-state projection rather than a record: `docs/persistence-schema.json`, `docs/persistence-catalog.md`, `docs/persistence-catalog.zh.md`, and its sidecar. Verification ran `verify-persistence-changes`, `verify-persistence-releases`, `verify-persistence-formats`, `verify-archived-agent-notes`, and the `scripts` unit specs.
