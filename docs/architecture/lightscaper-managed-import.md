# Lightscaper managed photo import

This packet implements the L3 managed-original publication owner. It consumes
already admitted, serial photo preparation outcomes; it adds no user interface
or product capability. Shared still decoding remains the image authority.

| Contract | Budget |
| --- | --- |
| Selected gesture | Shared admission: at most 64 files, 64 MiB per original, 512 MiB total; admitted before reading by the preparation owner |
| Publication working set | One normalized photo and original Blob reference at a time; selected-byte hashing reads at most 4 MiB per slice |
| Original dedupe | SHA-256 index pages of at most 64 rows, with exact length and atomic root admission before reuse |
| Durable import intent | One active import per catalog, at most 1 KiB of scalar JSON; no photo aggregate or filename inventory |
| Original mutations | At most 16 roots per transaction; ordinary publication uses one |
| Recovery working set | One indexed page of at most 64 scalar roots; promotion/release groups of at most 16 |
| Completion receipt | At most 64 scalar outcomes; failure text at most 2,048 characters |

Import and recovery acquire the existing shared project lock with a distinct
Lightscaper namespace. An authoritative browser Web Lock is required for this
cross-database publication operation. A busy catalog or an unavailable lock
does not open originals or begin publication. Closing or losing the writer
cancels admitted work; cancellation preserves the durable intent and any roots
for recovery under a subsequent writer.

The owner records its scalar intent, acquires provisional original custody,
publishes the photo through the catalog's revisioned transaction, and promotes
the root. Original dedupe reuses file bytes only; each photo keeps its authored
metadata, versions, and logical original identity. A publication error is
reconciled against the actual durable photo's immutable original and extracted
facts before any root is released; later authored edits remain intact. The
selected Blob's digest is independently verified before lookup, including
dedupe hits. A preexisting photo identity refuses before media publication.
Recovery promotes roots whose photo references match and releases only roots
whose photo is absent. A conflicting reference refuses recovery and preserves
custody. Release never deletes media or another owner's root.

The intent is retired only after all its roots have settled. An interruption
may leave a valid partial import and a protected provisional original; reopening
under a new writer settles that state before another import begins. No cleanup
infers abandonment from elapsed time or from an unlocked catalog-absence read.

## Restored-library interruption qualification

The restored import Close tests export a real V5 backup, restore it through the
private restore owner, and open the committed allocated library with the current
Session runtime. The current import uses the ordinary shared browser decoder and
the selected library's preset and disabled LUT resources. The allocated profile
stores original Blobs in IndexedDB; its qualification does not claim an OPFS
original write. The unchanged default donor uses the ordinary native worker path.

Chromium and Firefox observe mutation success and completed acknowledgement at
each of the six durable phases: intent, original, provisional custody, Photo,
permanent custody and intent retirement. The fixture forwards actual requests
and cancellation. It holds only delivery of an already settled owner outcome
to verify that Close joins admitted work before closing selected resources.

The expected ledger follows each owner's cancellation contract. Journal and
original transactions can finish after cancellation, leaving a recoverable
intent or an immutable unrooted body. Catalog and custody transactions abort
when their active signal is cancelled before completion. An import whose final
intent retirement has completed can return its already known receipt. Reopening
through the actual Session retires recoverable intent, releases staged roots for
an absent Photo, and promotes custody for a published Photo. A second reopen
checks idempotence. Full retained Photos, private content tokens, original bytes,
presets, LUT bodies and the default donor are compared throughout.

The strict Node tests separately qualify selected owner outcome joining with a
scoped bitmap/canvas platform fixture. They do not qualify native decoding or
native transaction timing. These bounded interruption tests do not establish
the complete L3 exit criteria or WebKit support.
