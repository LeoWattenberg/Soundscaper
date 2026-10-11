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

## Default-library interruption qualification

The default import Close tests select the ordinary library through the current
Session runtime, preserving its schema-1 pointer and null allocation. Originals
use the actual synchronous OPFS worker. Three writer cuts observe successful
open, write and close acknowledgements; close covers synchronous flush and
file-handle close in one worker turn. Twelve further cuts observe mutation
success and completed acknowledgement at the six managed-import phases above.

Writer acknowledgements are forwarded immediately. Only delivery of the fully
settled original-write outcome is held, after actual cancellation and file
cleanup have drained. The fixture independently inspects the physical path,
length and digest, alongside immutable media metadata, private tokens, full
Photos, summary/query rows, memberships, index revisions and custody. Completed
metadata publication can retain an unrooted immutable OPFS original; successful
Photo publication must retain that original through recovery. Existing Photos,
saved process-2 presets and disabled LUT resources stay exact throughout.

These cases qualify completed ownership boundaries under Session Close. They do
not qualify cancellation during unresolved native acquisition or abrupt process
death before media publication. Both remain separate from this bounded packet.

## Writer acquisition cancellation

A cancelled synchronous writer open stays owned until the worker reports its
actual result or error. Cancellation forwards immediately, and a late successful
open joins writer abort and any required path removal before rejecting. An error
response also joins path removal. A request deadline cannot end that cancelled
ownership while the worker remains alive; cleanup likewise waits for its actual
acknowledgement. The first caller reason stays exact after successful cleanup.
At the client boundary, failed cleanup retains that reason as the cause of a
distinct aggregate error.

Controlled Node Worker and filesystem ports connect the actual client and worker
runtime, including a default Session import and Close. They hold file and access
acquisition, settled result delivery, and asynchronous removal across task turns
and request deadlines. They do not establish native browser acquisition timing.
Worker failure or explicit client termination retires pending requests as a
failure and does not prove physical file removal. Abrupt process death before
media publication remains a separate recovery requirement.

## Admitted writer reclamation

Once a writer has opened, its abort owns the actual worker reclamation through
file removal. Once abort starts, subsequent calls share its promise, including
after failure. A broker deadline cannot settle that promise while cleanup is still
pending. If a cancelled close already removed the worker's writer identity, abort
joins the separate path-removal acknowledgement. Aborting a successfully closed
writer without an earlier abort remains a no-op and retains the original.

Controlled Node ports exercise the actual client, worker runtime and Session
lifetime. The checks hold cleanup beyond the broker deadline, retain actual
removal failures, and prove that Session resource cleanup waits
for admitted reclamation. They do not establish native browser timing or recover
files left by abrupt process death.
