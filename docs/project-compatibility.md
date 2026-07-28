# Project compatibility contract

The versioned source of truth is
[`config/project-compatibility.json`](../config/project-compatibility.json).
Its statuses distinguish behavior enforced today from outcomes owned by later
roadmap milestones. A planned row is a release requirement, not permission to
discard state until that row is implemented.

## Core document versus `.scape`

The core project loader and the portable archive are separate compatibility
boundaries.

- A raw project object whose `schemaVersion` is newer than the maintained
  version is structured-cloned and returned read-only with reason
  `newer-schema`. It is not normalized through the current schema.
- That core behavior does not yet make an arbitrary future `.scape` archive
  lossless. The current archive importer walks known source and clip
  collections, may rewrite project/source identity on collisions, and restores
  media into current storage records. Future-archive read-only activation must
  avoid those mutations and preserve every unknown entry before it can be
  called compatible.
- A future `.scape` `formatVersion` is rejected before project persistence.
  Container-version support is never inferred from the inner project version.
- Current `.scape` round trips promise JSON-semantic project equality, not
  byte-for-byte `project.json` equality, ZIP entry ordering, timestamps, or JSON
  formatting.

Read-only means that commands, autosave, overwrite, and migration publication
must remain disabled. A future document may be inspected or exported unchanged
only through a path proven not to normalize it. “Save a copy” may not silently
turn an unknown schema into the current schema.

## Retained migrations

Schema 8 is the current writable schema. Inputs from schemas 1 through 7 are
validated and migrated atomically to schema 8. Migration functions must be
pure: the input fixture is retained unchanged, and failure publishes neither a
partial project nor partial history.

Every new schema version must add fixtures for its immediate predecessor and
the oldest retained schema. Project state, history, clipboard state, `.scape`,
and both product profiles must agree on the same migration boundary.

## Opaque state

Opaque preservation is type-specific.

- Unknown JSON-compatible fields from schema 1 are collected under
  `opaqueExtensions.legacyV1`. Maintained JSON-compatible
  `opaqueExtensions` survive migration and current-schema `.scape` reopen
  semantically unchanged.
- A newer raw core document is structured-cloned, so typed arrays can remain
  typed arrays inside that in-memory read-only result.
- Binary opaque native/effect state is not yet lossless through `.scape` because
  plain JSON serialization turns typed arrays into ordinary keyed objects. The
  required milestone 2 codec must use an explicit tag, bounded byte length, and
  canonical base64 or equivalent representation; decode must reject malformed,
  oversized, or duplicate payloads.

Unknown fields and unavailable features must never be interpreted as executable
code. Preservation does not imply activation.

## Freeze and proxy fallback

Unavailable capabilities follow this order once their owning milestones land:

1. retain the editable source and opaque feature state unchanged;
2. show a named unavailable-feature placeholder and an explicit bypass state;
3. use a digest-linked frozen render or reproducible proxy when one exists;
4. keep relink/unfreeze information with the project; and
5. report every omission or fallback during interchange and delivery.

Video proxy relationships are owned by milestone 3. Audio freeze, unfreeze,
commit, and rendered fallback state are owned by milestone 4. The absence of
those document models today must not be hidden behind a compatibility claim.

## Schema retirement

Schema migrations are not removed automatically because of age, file count, or
maintenance cost. The minimum readable version remains 1 until a separate
versioned policy change proves every condition in the machine-readable matrix:

- an offline upgrader handles the retiring schema without an account or network;
- the oldest retained fixture reaches the current schema and reopens at every
  required gate;
- at least two stable release cycles carried a published deprecation notice;
- compatibility documentation identifies the first unsupported release; and
- no state representable by the retired schema lacks a lossless current form.

The retirement change must preserve archived fixtures and the upgrader after
the in-product migration is removed. Telemetry is neither required nor used to
justify removal.

## Change control

The compatibility matrix test checks the source schema constants, archive
format, retained migration list, evidence paths, fallback ownership, and
fail-closed forward behavior. A code change that strengthens or weakens one of
these guarantees updates the matrix, this document, fixtures, and the roadmap
status in the same atomic change.
