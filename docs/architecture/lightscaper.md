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
