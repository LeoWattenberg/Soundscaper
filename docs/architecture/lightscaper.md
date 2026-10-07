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
aggregate and its history rather than snapshotting the whole catalog. Collection
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
| Photo history | At most 100 snapshots and 16 MiB of serialized snapshots per photo; default capacity 20 |
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
