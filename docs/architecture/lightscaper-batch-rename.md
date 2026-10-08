# Lightscaper bounded batch rename

This L3 packet plans and applies authored display filenames through the existing
photo command owner. It changes `metadata.fileName`; retained original names,
storage keys, bytes, extracted facts, develop versions and filesystem paths
remain under their existing owners. No photo, database or Scape schema changes.

## Admission and ordering

The transient v1 request binds an actual catalog ID and an ordered selection of
1–64 distinct photo IDs, each with the expected photo revision and current
display filename. Composition reads those scalar snapshots serially when the
user opens the menu workflow. The helper allocates no resource and opens no
database, media body, writer lease or photo owner.

The non-null rename recipe reuses import's exact `{stem}`, `{sequence}` and
`{extension}` grammar, case and Unicode preservation, last-dot extension rule,
1–16 padding and safe-integer sequence. Every selected-slot expansion completes
before any edit. A later missing or conflicting photo consumes its original
sequence position; remaining entries are never renumbered. Display-name
duplicates are allowed because photo identity does not depend on the filename.

Closed own-data records, dense bounded arrays, explicit v1 identity and the
existing stable-ID/name/revision validators reject accessors, extra fields,
future versions and duplicate photo identities. Plans contain only scalar
bindings and the normalized recipe. Re-admission rederives every output name;
an output, index or source binding cannot be substituted independently.

## Resources and stop condition

| Resource | Bound |
| --- | --- |
| Ordered selection, plan and acknowledgments | 64 scalar entries each |
| Template, current name and output name | 256 UTF-16 code units each |
| Entire UTF-8 JSON plan | 256 KiB |
| Plan admission serialized-equivalent copies | 1 MiB, excluding engine overhead |
| Borrowed current photo | Existing 2 MiB document bound; one at a time |
| Borrowed owner history | Existing 16 MiB aggregate bound, default 20 entries |
| Existing command path plus scalar helper | Conservative 64 MiB serialized-equivalent allowance; no original/pixel buffers |

The maximal fixture uses all 64 slots, 128-character IDs, maximal revisions and
256 lone-surrogate code units in both source names and outputs. JSON's six-byte
escapes are included. Its complete measured UTF-8 plan must fit 256 KiB; source
admission and adversarial tests must pass before integration. Stop rather than
raise these bounds if the full fixture or existing command/history path fails.
The allowance describes owned value copies, not browser heap/RSS or GC timing.
The qualified complete 64-slot fixture occupies 212,749 bytes, leaving 49,395
bytes below the plan ceiling.

## Publication, cancellation and history

An item operation borrows the session's current live, idle `PhotoCommandOwnerV1`.
Composition refreshes that owner under the catalog writer lease before access;
this helper does not grant authority to a closed or stale resource. It checks
native cancellation before owner access, validates the current document and
compares catalog ID, photo ID, revision and exact current display name. A
changed name executes one ordinary `set-metadata` command. A no-op returns an
unchanged acknowledgment without a command, save or history entry.

Successful execution returns a scalar acknowledgment containing its selected
index, photo ID, previous display name, current display name and durable
revision. There is no cancellation check after the durable command returns:
late abort retains the acknowledged edit and its normal per-photo history.
Failures leave that owner's history unchanged under the existing CAS contract.

Composition owns one serial loop under the existing session/catalog writer
lease. It records each acknowledgment before checking cancellation or yielding
to a real browser task; ordinary per-photo conflicts/failures can be reported
while later selected entries continue. Cancellation stops remaining work and
preserves known acknowledgments. The helper does not make the batch atomic.

Current session composition releases the previous selected owner's history
when switching photos. This packet proves undo/redo in each borrowed owner's
normal history and preserves scalar names/revisions for a later bounded batch
undo design; it does not claim retention of 64 histories or whole-batch undo.
Menu/UI integration and native workflows belong to the following composition
packet. Single-photo capture-time edits already use the existing authored
capture timestamp with an optional unknown offset; they need no schema change.
