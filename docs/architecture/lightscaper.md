# Lightscaper application boundaries

Lightscaper is a separately built photo product in the same repository as
Soundscaper and Framescaper. The [Lightscaper roadmap](../../roadmap-lightscaper.md)
owns accepted feature scope and milestone gates. Registering the product does
not activate photo import, develop, export, raw decoding, or desktop services.
Each capability stays false until its maintained workflow and automated gate
exist.

The build selects one product before constructing the browser module graph.
Lightscaper has its own bootstrap and photo application; it does not instantiate
the audio editor controller, mixer, transport, or timeline. Product-specific
composition lives under `src/lightscaper/`, and presentation lives under
`src/common/editor/ui/lightscaper/`. New surfaces are opened from menus.
Controllers and persistence do not depend on presentation.

Keep Lightscaper as an independent product module here so shared storage,
imaging and Scape contracts can evolve with their consumers in one change.
Photo presentation remains product-owned within the common UI tree. Extract
npm workspace packages when dependencies or release versions need independent
management, or consumers need a stable shared API. Split repositories when
independent ownership, access or release governance requires it, with versioned
shared dependencies and compatibility testing. Repository layout does not change
browser-origin isolation.

## Catalog storage and history

A photo catalog has a Lightscaper-owned, versioned root plus separately
revisioned photo aggregates. The root describes folders, keywords, collection
definitions, and catalog identity; it does not embed every photo or develop
history. Each photo aggregate binds its immutable original identity to metadata
and named versions of a develop stack. Virtual folders and rename templates
affect catalog state, never the original bytes or user filesystem paths.

Queries use bounded pages over indexes. Editing one photo writes that photo's
aggregate and advances its own bounded history rather than snapshotting the whole catalog. Collection
membership and import publication must commit consistently with the photo count
and indexes. An interrupted import may retain completed photos, but may not
expose a reference to an unauthenticated or unpublished original. Disposal and
cancellation are idempotent; preview derivatives are disposable and do not own
original media lifetime.

The initial catalog-scale target is 100,000 photo references. Its deterministic
fixture, memory bounds, and import/query interaction budgets must be recorded
and exercised before the photo-library milestone closes. These contracts do not
promise unbounded in-memory catalogs or authorize raising existing product
startup, chunk, or storage ceilings.

### Planned durable catalog repository budgets

The catalog repository uses its own family-v1 IndexedDB database, without
changing the shared timeline database's schema. It reuses the shared request,
transaction-completion, and cursor-page primitives. Root documents, small
catalog state records, photo aggregates, metadata-only browse summaries, and
scoped membership indexes occupy separate object stores. A photo edit compares
its expected revision inside the write transaction; importing photos compares
the root revision and publishes aggregates, summaries, memberships, and the
new photo count together. A failed write or cancellation aborts that transaction.

| Contract | Initial bound |
| --- | --- |
| Serialized root or photo aggregate | 2 MiB each, as enforced by the v1 document contract |
| Browse summary | 4 KiB, containing neither original bytes nor develop state |
| Cursor page | 64 summaries; the existing shared cursor ceiling stays unchanged |
| Import publication transaction | At most 16 photos, 8 MiB of serialized photo documents, and 4,096 membership writes |
| Photo history | At most 100 historical snapshots plus the current photo, totaling at most 16 MiB of serialized snapshots; default capacity 20 |
| Qualification fixture | 100,000 photo references; queries must retain only the requested page and never read photo aggregates to populate browse summaries |

Each page closes its IndexedDB transaction before returning to its consumer.
Continuation keys belong to one catalog and query scope. Catalog revision
changes invalidate an in-progress root-bound enumeration instead of silently
combining different catalog definitions. Import authenticates original custody
through the shared media owner before opening a catalog publication transaction;
original bytes and disposable previews remain outside this metadata database.
The repository does not interpret virtual hierarchy IDs as filesystem paths.

The instrumented Node database verifies request failures, rollback, cancellation,
and page delivery bounds. It does not model browser transaction scheduling or
physical index cost, so concurrent compare-and-swap and catalog-scale query
timing also need actual browser IndexedDB evidence before the library gate closes.

### Per-photo command ownership

Undo and redo are local to one open photo command owner. The roadmap requires
deterministic history and interruption-safe authored state; it does not require
undo stacks to survive reopening or accompany Scape documents. Reopening starts
a fresh history from the durable photo aggregate. No history store or database
version change is needed for this session contract. Persisted recovery and
portable archives retain the latest authored state and first-class photo
versions; a future durable undo requirement must declare its schema and budgets
before adding storage.

The owner admits authored metadata, culling attributes, virtual memberships,
develop state, and photo-version commands through the existing v1 validators.
Original identity and extracted import facts are read-only. The pure history
helpers prepare an immutable next state, while the repository owns the successful
persisted revision increment. Undo and redo restore authored state using the
current expected revision, so neither can roll the storage revision backward.
The owner publishes the prepared history only after the repository transaction
acknowledges success. A rejected save, stale revision, or cancellation before
commit leaves the prior history object intact. Once commit succeeds, its
acknowledgment is published even if cancellation arrives afterward.

| Command owner contract | Bound |
| --- | --- |
| Working set | One photo history, using the historical-entry and serialized-byte limits above |
| Pending operation | One save; overlapping commands fail busy instead of growing a queue |
| Prepared edit | One photo document, at most 2 MiB; retained history snapshots are immutable |
| Develop clipboard | One normalized develop-only packet, at most 2 MiB, without photo identity or original bytes |

Clipboard packets preserve shared effects, geometry and self-contained masks.
External raster/alpha mask inputs require an authenticated media adapter and are
refused by the initial portable clipboard admission. No settings are silently
dropped. Closing an owner cancels its pending operation and prevents new
commands without closing the shared catalog repository. None of these unused
domain modules activates a product capability or creates a user interface.

### Planned shared original custody budgets

Catalog originals stay in the existing shared media repository and its existing
Blob, chunk, or OPFS formats. Shared storage version 2 appends a nonunique
SHA-256 index and a compact catalog-original root store; migration neither
rewrites existing media nor promotes legacy claimed digests to verified facts.
A root pins the shared media asset key (`PhotoOriginal.storageKey`), independently
of the logical original source ID, plus the verified digest, content token, and
byte length. Originals remain original file bytes; oriented frame packs and
previews are separate derivatives. Root admission requires durable storage and
refuses the process-local fallback.

| Shared original custody contract | Bound |
| --- | --- |
| Serialized root | At most 2 KiB, containing scalar identity fields only |
| Retain, promote, or release transaction | At most 16 photo roots |
| Digest lookup and recovery page | At most 64 indexed rows; continuation advances over scanned rows, including refused legacy claims |
| Prune media cursor page | At most 64 delivered media rows; catalog-retained originals never enter the accumulated legacy candidate inventory |
| Recovery | Explicit indexed pages; no automatic expiry or whole-catalog snapshot |

Imports retain provisional roots before publishing the separate catalog
transaction. After catalog publication, the importer promotes roots in bounded
transactions. A crash at either boundary leaves a durable root protecting the
original; recovery coordinates with the import owner and settles or fences its
live publication before consulting catalog state and choosing promotion or
release. A catalog-absence check alone cannot authorize release across separate
databases. Release removes only the specified owner's roots and does not delete
media. Root changes update a scalar media retention hint atomically; deletion
still checks the authoritative source index in its own write transaction.
Direct deletion and pruning include the root store in the transaction that
removes media, so another repository instance cannot race root admission.
Whole shared-store clearing refuses while any catalog root exists, because the
separate catalog database must first relinquish its custody. Temporary payload
cleanup uses current indexed media references rather than gathering catalog
originals through `mediaAssets.getAll()`. These storage modules do not activate
Lightscaper capabilities or introduce a new pixel or body format. Custody reads
and writes join the existing media maintenance lifecycle before backend
admission; closing drains their settled transactions as well as body writers.

## Shared image evaluation

Pixel operations belong to the shared image engine and effect catalogs. A photo
workflow must not implement a private filter that Framescaper cannot author and
render. Pixel descriptors declare sample format, color primaries, transfer,
dimensions, and alpha interpretation independently of the currently admitted
processing profiles. Deep-color support widens admission rather than changing
the persisted schema. Preview and export evaluate the same versioned develop
stack; proxy resolution and declared output-only transformations are explicit.

## Product interchange

The [product-origin decision](../decisions/product-origins.md) and
[family-qualified compatibility contract](../policies/project-compatibility.md)
remain authoritative. A suffix does not grant another family's editable
authority. Photo handoff needs a destination-owned conversion and validation
path that preserves supported effects and reports omissions or refuses losses.
Cross-origin browser handoff transports authenticated media into the destination
store. The source catalog and original bytes remain unchanged. Zero-copy access
is not inferred from the products sharing a repository.

An initial empty photo shell does not register Scape or image file handlers,
share targets, or native services. Those install and platform capabilities are
added with the slice that implements their consumer.

### Photo record pack v1

The standalone catalog pack codec groups photo documents and original bytes so
a large catalog can later use bounded Scape asset entries. It is not yet wired
to ZIP import/export or catalog publication. A pack starts with the eight ASCII
bytes `LSCPACK1`. Each following record has a little-endian unsigned 32-bit JSON
byte length, an unsigned 64-bit original byte length, canonical UTF-8 photo
document JSON, and the exact original bytes. There is no padding, preview data,
compression, or pixel conversion inside the pack. An empty pack has only its
version header; unsupported versions are refused.

| Codec contract | Hard bound |
| --- | --- |
| Records in one pack | 4,096 unique photo IDs, all from one catalog |
| Total pack bytes | 512 MiB, including headers, documents, and originals |
| Photo document | The existing 2 MiB v1 document limit |
| Input or output chunk | 4 MiB; only fixed, intrinsic byte views are admitted |

Callers may tighten these bounds. The decoder retains one source chunk and one
document byte buffer, then streams each original to its consumer. It verifies
the declared original length and SHA-256 digest before the record completes.
Cancellation, truncation, corrupt metadata, duplicate IDs, mixed catalogs, or a
consumer that does not drain an original fail the read and close its iterator.
Consumers must stage their media and catalog writes provisionally, roll back on
failure, and publish only after the entire pack and enclosing Scape manifest
have been authenticated. Existing Scape entry-count and total-byte ceilings
remain unchanged.

### Catalog archive integration budgets

The v1 catalog archive document wraps one catalog root and compact pack
descriptors, rather than embedding photo aggregates in `project.json`. Its own
JSON limit is 4 MiB, within the existing Scape document and structural ceilings.
There are at most 4,094 packs, leaving the two reserved Scape entries within the
existing 4,096-entry limit. Pack boundaries follow both the 4,096-record and
512 MiB pack limits; export retains one lookahead photo, never a whole pack of
photo documents. Cross-pack photo identity checks retain only IDs, bounded by
16 MiB of ASCII identifier bytes. This admits the 100,000-photo qualification
target even with maximum-length IDs. Larger identity inventories are refused
explicitly until a durable identity ledger replaces that in-memory check.

Non-streaming export keeps the shared 512 MiB final-Blob budget. Streaming
export and import keep the Scape 64 GiB expanded-byte ceiling. Import stages
catalog rows and originals, verifies every pack and original digest, closes the
archive reader, and only then publishes the staged catalog. Failure or
cancellation before publication rolls back the stage. Framescaper and
Soundscaper classify this registered family as read-only foreign state and can
preserve its complete archive unchanged; registration grants neither editor
photo authoring authority.

### Library stack contract

Library stacks group distinct photos. They are independent from a photo's
develop versions and from collection membership. Stack records use a separate
closed protocol with `schemaVersion: 1`, `kind: photo-stack`, catalog and stack
IDs, a monotonic record revision, ordered photo IDs and a cover photo ID.
Existing family-v1 root and photo documents remain closed and unchanged.
Each stack contains two through 1,024 unique photos from one catalog, its cover
belongs to that membership, and serialized records are at most 256 KiB.
Menu commands capture at most 64 selected IDs; archive admission can carry
larger previously authored stacks within the same record limit.

Catalog database version 3 adds stack records, unique reverse membership,
an independent unique forward-membership index and scalar stack state.
The private stored wrapper includes the exact ordered scoped member keys;
its multiEntry index protects exclusivity even if a reverse row is missing.
A canonical stack document remains at most 256 KiB, and the complete stored
wrapper with at most 1,024 scoped keys is at most 512 KiB. Validation retains
one document and projection plus bounded serialized text and UTF-8 encoding
for measuring that record. Migration from versions 1 and 2 creates stores and indexes
without scanning or rewriting photos. One transaction compares the expected
stack and catalog revisions, verifies member existence and exclusive stack
membership, writes the record and reverse rows, and advances catalog/index and
stack-state revisions. A stack edit never changes photo revisions, originals,
extracted metadata or custody roots. Dissolving removes grouping only; its
empty stack state remains persisted so revisions cannot return to zero.
Cancellation before commit aborts every write; a committed acknowledgement
remains durable when cancellation arrives afterward.

Stack reads and annotations are explicit indexed pages of at most 64 records.
Reordering or changing the cover uses one admitted stack, never a whole catalog
snapshot. Continuations bind their catalog, query, stack-state and photo-index
revisions. Cross-instance conflicts require refresh instead of silently
overwriting membership. The persisted document, its forward projection and
its reverse index must agree;
corrupt or ambiguous membership is refused rather than repaired during a read.

Portable grouping requires an explicit Lightscaper catalog archive version 2.
It keeps Scape envelope version 1 and unchanged photo-pack/root/photo v1 data,
adding streamed stack packs with authenticated bytes and counts. Importing a
v1 archive produces an empty-stack catalog. V1 readers refuse the successor;
only the Lightscaper owner admits its new version, without changing the shared
timeline schema version or giving another product photo authoring authority.
Import verifies all member references and exclusive assignments in provisional
staging, closes every reader, then publishes photos and stacks together.
Truncation, tampering, missing members, cancellation or reader cleanup failure
roll back the complete unpublished stage. Existing archive entry, expanded-byte
and final-Blob ceilings remain unchanged.

Create, reorder, choose cover, dissolve and collapse/expand are reached through
menus. The ordinary grid stays expanded until the user opts into collapsing.
Collapsed paging chooses one globally eligible representative per stack: its
cover when that cover matches the active query, otherwise the first matching
member in the requested global order. Members can cross page boundaries; local
page deduplication is insufficient. Member probes and candidate steps are
bounded and resumable, and stale revisions retire the continuation. A storage
and archive packet is foundation work until the actual menu and pager workflow
qualifies, including filter changes, reopen and unchanged original digests.

Each collapsed query step performs at most 64 combined stack-audit keys, global
candidates and point-query-row probes, with indexed scalar membership checks
for those photo rows. Before publishing any photos, a key-only count audit
authenticates the grouping state's record count through explicit bounded pages;
it never calls the native whole-index count operation.
It retains the output page, one admitted stack and bounded current query rows;
it never accumulates a catalog-wide membership set. A winning representative,
including an eligible cover, is emitted only after every declared member's
query-row existence and forward/reverse binding have been authenticated.
Large stacks can return empty nonterminal steps carrying one member position
inside a continuation of at most 4 KiB. The consumer yields between those
steps and joins canceled reads before releasing its Session resources.
Each continuation includes an HMAC-SHA256 signature over its canonical scalar
progress, issued with one 32-byte secret per database connection. Changing a
member position or audit count invalidates the signature. Opening another
connection retires that progress; a new Session reads its first page afresh.

The opted-in stack dialog retains one captured stack and one draft, at most
64 scalar member names for its explicit page, and one durable acknowledgement.
Those four packets total at most 1 MiB serialized; a 2 MiB presentation allowance
covers bounded transient copies in addition to the existing library page.
Reordering and cover selection preserve the full admitted order while requesting
only the displayed page's names. A known durable write whose refresh fails
retains its acknowledgement and pauses further edits until a fresh read succeeds.

### Effective metadata query contract

Catalog query version 2 adds a closed predicate over the 19 effective metadata
columns. Text supports literal contains, equals and starts-with; numeric ranges
have inclusive endpoints; time ranges include their start and exclude their end.
Presence distinguishes unknown values from known empty text. Capture time uses
the recorded local clock, and modified time uses UTC. An unknown capture offset
does not imply UTC. Raw EXIF and IPTC alternatives remain immutable import facts
and do not replace the authored effective values used by these predicates.

The existing View-menu search, filter and sort dialog opens the metadata form.
It edits up to 16 conjunctive conditions. A nested or larger admitted predicate
survives unrelated text or sort changes until the user explicitly replaces it.
The product supplies its predicate registry lazily; common presentation imports
no product domain at runtime. Broad text search retains its version-1 field
universe. Persisted version-1 smart collections and catalog archives are
unchanged; this query protocol does not widen their closed schemas.

Database version 4 adds disposable version-2 query rows and build states without
reading or rewriting existing photo documents. Each row contains every effective
metadata value once, bounded by 1 MiB, while browse summaries retain their 4 KiB
limit. Publication updates the photo and both derived index generations in one
transaction. A legal photo that exceeds the old 512 KiB row profile makes that
legacy index unready without truncating metadata; an explicit bounded legacy
rebuild can recover after the photo returns to that profile.

Rebuilding version 2 persists at most 16 photos per step, with source documents
and derived rows sharing the existing 8 MiB serialized byte budget. Queries
compile all hierarchy references before scanning, retain bounded current rows
and at most 64 scalar summaries, and never read photo aggregates or originals
to populate a page. The catalog name, count and revision context come from that
same transaction. Continuations bind the query and catalog/index revisions;
collapsed pages also bind stack state and the issuing connection's signature.
Ordinary and collapsed reads evaluate the same metadata predicate. Cancellation
joins pending reads, and neither a late result nor a terminal page with mismatched
incoming revisions can publish through the session port.
