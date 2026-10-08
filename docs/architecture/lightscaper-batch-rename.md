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

## Session composition and inverse undo

The scalar session port captures 1–64 selected IDs in their supplied order under
the existing catalog lease. It reads one photo at a time and returns only the
catalog ID, photo ID, revision and display filename. The synchronous pure plan
method expands every name before any writer acquisition. Apply and undo admit
the complete transported plan or inverse, then use one session mutation for the
entire serial loop. An overlapping writer is refused synchronously; no batch is
queued. Each completed item yields to a real task before the next owner is read.

Receipts contain at most 64 scalar outcomes. Ordinary conflicts and write
failures keep their selected indexes and let later slots continue. A finished
receipt means every slot produced an acknowledged or failed outcome; it does
not mean every rename succeeded. Cancellation or an operational interruption
stops remaining work and retains every known durable acknowledgment. Close
cancels and joins the active operation before releasing the owner or storage.
An abort after the final acknowledged item does not erase a completed batch.
An independent lease cleanup failure still returns an interrupted receipt and
its diagnostic, including when that final acknowledgment also causes an abort.

Only changed durable acknowledgments create inverse entries. Each binds the
catalog, original selected index, photo ID, acknowledged revision, exact current
name and previous display name. Undo restores one filename through that photo's
ordinary metadata command only if its current revision and name still match.
Successful entries are removed; failed and unattempted inverse entries keep
their original fences for a later explicit retry. No-op renames need no inverse.
Undo is a compensating, revision-fenced edit, with no whole-batch transaction or
automatic overwrite of later changes. It creates ordinary per-photo history.

Session composition retains one command owner and its existing bounded history,
never 64 heavy histories. Extra scalar bounds are 256 KiB each for a selection
snapshot and inverse, 1 MiB for the complete UTF-8 JSON receipt, and 8 MiB for
serialized-equivalent scalar admission/assembly copies. The worst-case receipt
test uses 64 names at 256 lone-surrogate units, 128-unit IDs, maximal revisions
and 1,536-unit error details. The existing 64 MiB command-path allowance and
one 2 MiB photo bound remain; no original or pixel buffer is read or retained.
Stop rather than raise these bounds if their maximal fixtures fail.

Every error detail, including the interruption message, is best-effort own-data
text capped at 1,536 code units. Accessor messages are ignored and a throwing
descriptor trap receives a constant fallback; reporting cannot veto an ACK.
The cap accounts for JSON's worst-case six-byte escapes and leaves room for a
complete inverse on a failed undo. The fully escaped 64-failure undo receipt,
all 64 inverse fences and maximal interruption message occupies 1,022,550
UTF-8 bytes, leaving 26,026 bytes below 1 MiB. Its rename-only counterpart is
811,097 bytes. The maximal complete inverse is 211,459 bytes; the scalar
selection is 110,832 bytes. A second
capacity test qualifies a 64-success receipt with its complete inverse and
maximal acknowledged revisions. These tests include JSON escaping rather than
estimating bytes from JavaScript string lengths.

The worst-case bound includes every failed item and inverse entry. Replacing a
failure with a durable restore removes both its escaped error and its inverse
entry, so mixed success/failure receipts cannot exceed the all-failed bound.
Forward successes create an inverse but carry no error detail, and the full
64-success case is also qualified. Final receipt validation therefore retains
every admitted name, revision, ACK and remaining inverse without increasing the
ceiling or throwing after a durable edit because of ordinary error detail.

Menu/UI integration and native batch workflows remain a later composition
packet. Single-photo capture-time edits already use the existing authored
capture timestamp with an optional unknown offset; they need no schema change.
