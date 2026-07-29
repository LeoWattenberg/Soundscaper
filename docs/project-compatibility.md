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

Schema 9 is the current writable schema. Inputs from schemas 1 through 8 are
validated and migrated atomically to schema 9. Migration functions must be
pure: the input fixture is retained unchanged, and failure publishes neither a
partial project nor partial history.

Every new schema version must add fixtures for its immediate predecessor and
the oldest retained schema. Project state, history, clipboard state, `.scape`,
and both product profiles must agree on the same migration boundary.

## Project feature requirements

Schema 9 establishes the raw-project declaration and evaluation foundation. Its
root-level `featureRequirements` value is a bounded, normalized manifest with a
closed manifest version, canonical namespaced feature identifiers, unique
requirement IDs, closed bypass or rendered-fallback dispositions, and bounded
display strings. A rendered-fallback descriptor must reference an existing
project source of the declared audio or video kind and carry a canonical
lowercase SHA-256 string. That validates descriptor syntax and source identity;
it does not hash or authenticate the referenced media bytes.

Schemas 1 through 8 migrate to the canonical empty manifest rather than
inventing requirements. The pure evaluator compares a normalized manifest with
caller-declared known and available feature IDs and reports available,
unavailable, and unknown entries with effective native, bypassed, or
rendered-fallback dispositions. Unknown feature IDs remain declarative data and
cannot activate code. Malformed current-schema manifest state fails validation;
a newer outer project schema is instead cloned opaquely and returned read-only
before current-manifest normalization.

At the controller boundary, explicit stable broad capability IDs map one-to-one
to the maintained keys in each selected product profile. The controller snapshots that
profile at construction: only a strict `true` value makes a registered feature
available, a registered non-true value is unavailable, and an unregistered ID
is unknown. It evaluates exact schema 9 from the actual project history that
will be activated, before activation side effects. A report containing an
unavailable or unknown requirement makes the project intrinsically read-only.
When an existing same-ID tab wins, its stored read-only declaration also wins
over the ignored incoming document's flags.
The report is retained per tab, remains deeply frozen across session metadata
clones, and is exposed on the document snapshot. Future schemas produce no
feature report, and their `featureRequirements` value is not traversed.

The same selected product service now powers a programmatic current-format `.scape`
inspection report. The composition root snapshots the selected product
and injects its evaluator as provider-owned state, so caller options cannot
override it. After archive integrity and project-source validation, exact schema
9 fallback claims are bound by source ID, kind, and SHA-256 to their canonical
manifest asset before evaluation and any project collision lookup. The deeply
frozen `featureRequirementsCompatibility` report therefore follows descriptor
binding, but inspection does not read or hash asset bodies and performs no
import, persistence, or activation. Future project schemas return `null`, and
their `featureRequirements` value is not traversed. This report does not claim
body verification or activate rendered fallbacks, and it is not a third-party
activation gate.

The maintained normal no-collision open workflow now turns an incompatible
exact-schema-9 report into an explicit choice: **Open read-only** or **Cancel**.
If the imported ID also collides, the dialog presents the compatibility report
and the collision together with **Open as read-only copy** or **Cancel** as a
single decision. Compatible collisions offer the safe **Open as copy** or
**Cancel** choices. A future-schema `null` report does not enter this feature
decision. The low-level native-open API remains outside this maintained-UI rule
and retains its caller-supplied collision policy; third-party activation is
likewise not gated here.

The decision belongs to one replaceable request lifecycle from inspection
through user settlement. Cancel resolves before import, persistence, or
activation and late settlement after replacement, project switching, caller
abort, or disposal cannot open the archive. The localized dialog shows each
affected feature's bounded display name, stable feature ID, availability, and
declared disposition; it does not render the evaluator's fallback-use message
or claim that fallback bytes were verified. Incompatible decisions initially
focus Cancel, and Escape dismisses the dialog and restores focus.

Acceptance carries no trusted read-only flag into the importer. It maps the
accepted no-collision or combined choice to the existing copy policy, then the
controller evaluates the actual project history again before activation and
enforces its intrinsically read-only result. This second evaluation also keeps
same-ID session history authoritative and makes the UI decision a consent
boundary rather than a capability override.

Current-schema and current-format `.scape` preservation is now part of this
contract. A rendered-fallback descriptor makes its source an independent
retention root even when no timeline or Project Bin clip references it. Project
and history compaction therefore retain that source metadata, current-format
export includes its source asset with the full manifest, and reopen preserves
the normalized manifest and its evaluation semantics. When a copy import
rewrites colliding source identity, it rewrites the known fallback descriptor
reference through the same mapping while preserving the digest.

The maintained export plan snapshots the admitted project root and complete
source records before its first asynchronous asset operation, then serializes
those same source records and the same bounded normalized fallback manifest into
`project.json`. Project- and source-level `toJSON` hooks are rejected rather than
allowed to rewrite that admitted serialization. Export hashes the actual
canonical audio or video asset output and rejects a claim-to-descriptor mismatch
before writing the manifest or committing a destination. Inspection and import perform the same
claim-to-manifest descriptor binding before compatibility evaluation, collision
lookup, or transactional storage. Import additionally hashes each extracted
asset body against that descriptor before source or project publication. Thus
inspection remains metadata-only; descriptor binding there does not read or
hash the potentially reference-scale asset bodies.

This archive evidence is deliberately limited to schema 9 and `.scape` format
1. It does not establish arbitrary future-schema archive preservation,
post-open unavailable-feature placeholders or per-feature bypass controls,
or a general opaque native-state round trip. A raw or stored-project load does
not verify fallback bytes, and runtime use of fallback media is not implemented.
Those outcomes remain governed by the planned compatibility rows and roadmap
exit gate.

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
