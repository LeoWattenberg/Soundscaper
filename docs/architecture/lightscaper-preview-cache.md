<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Photo preview cache ownership

This storage and scheduling budget is recorded before implementation. Previews
are original-free disposable bodies, produced by the shared pixel kernel. A
cache never owns catalog publication, original retention or import rollback.

| Boundary | Hard bound |
| --- | --- |
| Persisted photo preview bodies | 128 MiB and 1,024 entries |
| Closed identity manifest | 4 KiB, including the exact normalized plan; paired records also bind the output digest |
| Scalar inventory | Cursor pages of 64; probe at most 1,025 rows and refuse an oversized inventory |
| Publication | One replacement and at most 16 current-token evictions in one transaction |
| Explicit trim | At most 16 current-token pairs per call |
| Capacity retry | One trim and one publication retry; pressure permits a transient preview |
| Scheduler | At most 64 queued photo IDs and one active read/decode/prepare/cache job |
| Coalesced observers | At most 65 pending requests across queued and active jobs |
| Preview output | Thumbnail side at most 512 and 1 MiB; fit-screen side at most 2,048 and 16 MiB |
| Source | Side at most 8,192, 16,777,216 pixels and 64 MiB of RGBA |

The shared paired-body storage owner reuses the existing
`videoDerivatives` and `videoDerivativeCacheEntries` stores, including their
source and path indexes. Their historical names do not supply video authoring
identity. Photo entries have their own explicit kind, version and key namespace.
The existing video adapter retains its keys, recipes, timestamp semantics and
linked-original behavior while common paired publication and comparison are
extracted from its growth-frozen source file. No database migration or new body
format is needed.

`MediaRepository` privately composes the shared owner with the same guarded
database port, OPFS repository and media lifecycle. Work registers before any
asynchronous hashing or writing, registers pending paths and joins maintenance
and permanent close. The photo adapter obtains only a frozen cache port from
`PhotoMediaStoreV1.getPreviewCache()`. The six-method original media port remains
unchanged. No raw database, private content token or general derivative writer
escapes that composition.

The photo adapter validates its exact original binding, pixel descriptors,
tier, recipe, output length and SHA-256. Shared publication independently hashes
the body and reads the current trusted media original inside the same transaction
that writes both cache records. Its private content token fences replacement;
caller metadata cannot replace that token. Cached loads verify the paired
manifest, current original and body length/digest. Queued work retains IDs and
tiers only. It resolves the current photo, uses the callback-scoped retained
original frame factory, prepares an independent body and rechecks the current
original association before cache publication or delivery.

Inventory pages contain scalar disposal metadata, never payload Blobs. The
complete admitted inventory is bounded before the existing deterministic
oldest-first eviction planner runs. A 64-row prefix is not claimed to be the
global oldest inventory. There is no persistent totals ledger that could become
stale through existing media deletion or pruning. Trimming compares the exact
current cache token and manifest before deleting a paired entry. Cleanup checks
current path references before deleting a file and cannot delete originals,
staging roots or a replacement published by another owner.

Cancellation before commit removes only the operation's unpublished body.
Successful paired publication remains acknowledged when cancellation or cleanup
failure arrives after commit. A crash before manifest publication may leave a
disposable unreferenced OPFS file; bounded orphan cleanup can reclaim it. Cache
misses and pressure regenerate on demand without changing a photo document or
original custody. Store close refuses new admission, cancels and drains cache
work, then releases its existing resources.
Scheduler close joins its active work and preserves cleanup failures, including
diagnostics from a committed cache write whose observer was cancelled.

OPFS is preferred. The existing IndexedDB Blob fallback can fail on the pinned
WebKit engine. Failure aborts both cache records and reports a per-preview
persistence failure; the prepared transient body remains usable. A derivative
is never written as an original to bypass that failure, and this packet does
not qualify WebKit's deferred full storage workflow.

The storage limit is not a JavaScript memory limit. Shared preparation owns at
most 96 MiB including its fixed source snapshot, output and Blob, while a borrowed
native frame can add 64 MiB. Retained-original decoding has its separately
documented 192 MiB JavaScript peak; decoder surfaces and retained Blob backing
are accounted separately. The one-active-job limit prevents multiplying those
working sets by the queue length.

This packet has no user interface or capability activation. Root session/menu
composition owns later consumer wiring. Shared storage packaging does not change
the assistance engine closure and requires no manual **Update AI assets** run.
