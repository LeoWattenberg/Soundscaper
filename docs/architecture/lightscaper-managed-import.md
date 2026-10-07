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
