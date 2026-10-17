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

Shared IndexedDB joining waits for the native complete or abort event, including
when pending request errors bubble after cancellation. Handled request errors
can still commit; operation failures retain their exact primary error after
abort joins. This follows the [IndexedDB transaction lifecycle](https://www.w3.org/TR/IndexedDB/).

Selected-Session tests keep subscriber refusal separate from resource retirement.
The held-read controls forward a real cache body read before delaying its return:
Close refuses new work, retains its promise, and waits before closing the media
and catalog. A distinct opaque read failure remains available from Close. Reopen
checks the acknowledged cache pair, full photo document, original bytes and
custody without substituting a decoder or preview scheduler.

Native browser tests reach the current Session through its default initializer,
managed import and native preview decode. They observe actual sync-worker write
and close acknowledgments, each paired-record put, transaction completion and
replacement cleanup. Pre-commit cancellation leaves the pair absent; after
transaction completion the pair remains durable. Cleanup failure retention is
checked independently from subscriber cancellation. These boundaries qualify
the fresh default-library profile in Chromium and Firefox.

Restored-library tests export a real V5 backup, restore it through the current
restore owner, and open the current Session from its committed allocated pointer.
They interrupt native IndexedDB publication after the payload put, inventory put
and transaction completion. Both rows must be absent before commit and complete
after acknowledgment. Close waits for delivery of the actual settled store
outcome before releasing resources. Reopen either regenerates the missing pair
or reads its acknowledged Blob. The complete restored photo, original record,
private content token, custody and bytes stay unchanged, as do the donor's
catalog and media. These tests qualify those three allocated-profile boundaries
in Chromium and Firefox; they do not qualify WebKit or every restore boundary.
Default donor snapshots join their native worker checkpoint before closing the
temporary media reader, retaining checkpoint and owner-close failures together.

Fresh default libraries prefer OPFS. The current Session's initializer publishes
the default pointer, and its location reader selects the existing media anchor.
Restored libraries select their allocated media namespace and intentionally use
IndexedDB, matching the restore candidate's storage profile. Preview caches use
the selected media owner's storage profile. When an OPFS writer is unavailable,
paired publication stores a complete Blob in IndexedDB in the same transaction
as its scalar inventory row.

The existing IndexedDB Blob fallback can fail on the pinned WebKit engine.
Failure aborts both cache records and reports a per-preview persistence failure;
the prepared transient body remains usable. A derivative is never written as an
original to bypass that failure, and this packet does not qualify WebKit's
deferred full storage workflow.

The storage limit is not a JavaScript memory limit. Shared preparation owns at
most 96 MiB including its fixed source snapshot, output and Blob, while a borrowed
native frame can add 64 MiB. Retained-original decoding has its separately
documented 192 MiB JavaScript peak; decoder surfaces and retained Blob backing
are accounted separately. The one-active-job limit prevents multiplying those
working sets by the queue length.

Current library culling consumes the selected Session's preview scheduler.
Its opt-in [RAW camera preview](lightscaper-culling.md#current-raw-preview-source)
uses a separate recipe within the same cache limits. Current Develop reads the
authenticated Original through its separate native-depth reader. Shared storage
packaging does not change the assistance engine closure and requires no manual
**Update AI assets** run.
