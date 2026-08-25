# Lightscaper milestone L3 plan: photo library

> Owning source for L3 sequencing, the catalog-read, derivative-tier,
> culling, smart-collection, and large-library-evidence decisions, their
> invariants, and the bounded work packets. The
> [Lightscaper roadmap](../roadmap-lightscaper.md#l3-photo-library) owns
> scope and status; the [quality budgets](quality-budgets.md), the
> capability inventory, and the milestone-2 closure inventory own theirs.
> Grounded against the repository on 2026-08-25 at commit `3d1e908c` with
> file:line verification. L3 depends on L1's registered product
> (lightscaper-1-plan.md), on every L2 schema — `PhotoCatalogV1`,
> `DevelopStackV1`, `PhotoMetadataReadV1`, `RenderSampleProfileV1`
> (lightscaper-2-plan.md) — and on the Framescaper V30 still work landing
> on `main`; L3's catalog-and-ingest core is what L4 waits on
> (roadmap-lightscaper.md:298-299, lightscaper-4-plan.md). Re-ground every
> citation at pickup — earlier milestones will have moved the tree.

## Goals and ordering principle

1. **Primary: no photo is lost, altered, or silently unreachable.** Originals
   stay digest-stable across import, edit, relink, and eviction
   (roadmap-lightscaper.md:291-292); the media repository already refuses an
   overwrite and records a verified SHA-256 before publication
   (`src/common/editor/storage/media-repository.ts:88,89-92`). Interrupting
   import or a preview build at any persistence boundary leaves a valid,
   recoverable catalog (roadmap-lightscaper.md:293-294); no catalog operation
   writes the user's filesystem (roadmap-lightscaper.md:95).
2. **Secondary: scale is a bounded-work property, not a hope.** Every browse,
   filter, search, cull, and maintenance path reads a bounded page and holds a
   bounded working set. The storage layer already pages metadata-only
   inventories in fresh 64-record transactions
   (`src/common/editor/storage/indexeddb-backend.ts:36,218-292`); L3 extends
   that discipline to the catalog and refuses whole-store reads.

Work is ordered by persistence risk, then scale risk: the pager and the ingest
pipeline land first because every later packet reads through the pager and
because L4 is blocked on the catalog-and-ingest core; derivative tiers land
second because the browse surfaces render them; browse, cull, and organize
then run parallel with metadata and maintenance; the fixture and its recorded
budgets close last, over code that already exists.

## What already exists (do not re-plan)

- **The media library is id-keyed, digest-recorded, and immutable by
  construction.** `writeAsset` refuses to overwrite an existing asset
  (`src/common/editor/storage/media-repository.ts:88`), digests the canonical
  blob first (`:89`), publishes to OPFS with an IndexedDB blob fallback
  (`:92-99`), rolls the payload back on a failed metadata write (`:112-115`),
  and grants unclaimed assets a 24-hour window (`:36,105`).
- **Disposable derivatives already have a content-addressed identity, an
  eviction planner, and a paged inventory.** A derivative is keyed by source
  id, the original's SHA-256, a timestamp, a type, and a recipe
  (`src/common/editor/storage/video-derivative-repository.ts:101`), retaining
  `originalSha256`, `recipeId`, `recipeVersion`, and `outputSha256`
  (`src/common/editor/storage/derivative-cache-entry.ts:43-50`).
  `planDerivativeCacheEviction` is pure and re-compares each candidate before
  deletion (`src/common/editor/storage/derivative-cache-policy.ts:22-26,59-67`),
  its limits taken as constructor options
  (`src/common/editor/storage/media-repository.ts:42-48`).
- **Capacity preflight and storage pressure are solved surfaces.** The `.scape`
  import preflight adds a fixed ten-percent headroom, refuses a
  known-insufficient estimate, and leaves an unavailable estimate advisory
  (`src/common/editor/scape-import-capacity.ts:44-70,73-103`); pressure is
  classified at 0.75 and 0.90 of quota with recorded cleanup actions
  (`src/common/editor/controller/storage-capacity-service.ts:202-231,306-312`).
- **Relink is a closed lifecycle with structural admission.** Linked originals
  refuse an unavailable or changed original
  (`src/common/editor/storage/linked-original-resolver.ts:120,209`), a
  replacement is admitted structurally without decoding or retaining samples
  (`src/common/editor/controller/audio-relink-probe.ts:25-47`), and startup
  reconciliation repairs durable locator references
  (`src/common/editor/storage/linked-original-startup-reconciliation-repository.ts:70,118-133`).
- **Commands, history, and the single commit boundary are fixed.**
  `applyEditorCommand` runs one mutation transaction and asserts the persisted
  result (`src/common/editor/commands.js:88-102`); the Project Bin owns a
  closed command list including `batch`
  (`src/common/editor/commands/project-source-bin.ts:9-29`); history clones
  whole projects on a 200-entry undo stack
  (`src/common/editor/history.js:4,32`).
- **A deterministic quality workload has a working shape.** The milestone-3
  long-form workload is an in-tree generator with a pinned seed, digest
  expectations, a manual collector, and a Node test over its metric derivation
  (`src/common/editor/quality/m3-longform-editorial-workload.ts:12-45`); the
  portable structural environment carries an eligibility list enforced by the
  verifier (`scripts/verify-quality-budget-result.mjs:53-59`).

## Verified gaps this plan closes (grounded 2026-08-25)

- **No catalog pager exists.** The only viewport projection in the tree
  linearly scans every clip against an overscan window per call
  (`src/common/editor/design-system-adapters/timeline.ts:63-64,69-74`), and the
  Project Bin renders every item unconditionally
  (`src/common/editor/ui/workspace/ProjectBinPanel.jsx:72,405`). Neither shape
  survives six figures of rows.
- **Retention maintenance materializes whole stores.** `cleanupTemporaryAssets`
  reads every media asset record, builds one path Set over assets plus every
  derivative, then iterates the entire flat OPFS directory
  (`src/common/editor/storage/retention-repository.ts:90,95-99`;
  `src/common/editor/storage/opfs-repository.ts:22,116-131,419-429`);
  `assetRecords()` is a bare `getAll()`
  (`src/common/editor/storage/media-repository.ts:207-213`).
- **Derivative eviction planning is O(all derivatives) in memory.**
  `readDerivativeCacheInventory` pages correctly but accumulates every page into
  one array (`src/common/editor/storage/derivative-cache-inventory.ts:52-60`),
  and `trimDerivatives` calls it twice per trim
  (`src/common/editor/storage/video-derivative-repository.ts:219,256`).
- **The only derivative scheduler is sequential and takes no `AbortSignal`**
  (`src/common/editor/controller/framescaper-capture-derivative-scheduler.ts:243-277`)
  while cancellation elsewhere uses named task scopes
  (`src/common/editor/controller/lifecycle.ts:150-183`).
- **`.scape` cannot carry a six-figure library as media.** The archive admits
  4,096 entries and a 256 MiB `project.json`
  (`src/common/editor/scape-archive-envelope.ts:18-23`); the export planner
  refuses past that (`src/common/editor/scape-export-plan.ts:123-127,248-250`).
- **No data filter exists.** `search.js` matches commands and content by alias
  with a 50-result cap (`src/common/editor/search.js:1,7`); no attribute or
  metadata predicate model exists. **And the IndexedDB upgrade path destroys
  every store:** any version bump above 8 deletes all object stores before
  recreating them (`src/common/editor/storage/indexeddb-backend.ts:32,80-84`).

## Decisions

### The catalog is read only through a bounded pager; L2 owns the storage unit

L2 owns the catalog persistence decision — the unit of storage, revision, and
history for six-figure photo counts (roadmap-lightscaper.md:228-232) — and L3
neither re-decides nor opens it. L3 owns the read side: one shared module,
`src/common/editor/photo-catalog-page.ts`, exposes cursor-keyed page reads over
whatever store L2 defines, built on `readCursorPage` and its 64-record ceiling
(`src/common/editor/storage/indexeddb-backend.ts:36,218-292`) and on the
boundary-then-page generator shape
(`src/common/editor/storage/derivative-cache-inventory.ts:25-50`). Every L3
surface consumes pages; none calls a store-wide `getAll()` or holds a row array
whose length is a function of library size.

The consequence for history is explicit: culling, rating, and organizing
commands mutate catalog rows, not a whole-library document, because whole
project clones on a 200-entry undo stack (`src/common/editor/history.js:4,32`)
cannot hold six figures of rows. The undoable view state — active collection,
sort order, filter expression, selection — is bounded and small.

### Preview tiers reuse the derivative repository, store name included

Thumbnail and fit-screen previews are ordinary disposable derivatives with new
`type` values on the existing repository
(`src/common/editor/storage/video-derivative-repository.ts:44-51,101`),
inheriting its content-addressed binding — original SHA-256, recipe id, recipe
version, output SHA-256
(`src/common/editor/storage/derivative-cache-entry.ts:43-50`) — so a stale
preview is a key miss rather than a wrong pixel. The store keeps the name
`videoDerivatives` (`src/common/editor/storage/derivative-cache-entry.ts:5`),
because a rename buys nothing and every rename is a schema identity change;
L2's 8-to-9 bump has already performed the one recorded wipe
(`src/common/editor/storage/README.md:29-31`), and L3 adds no second one. L3
does change the limits — the Lightscaper storage profile supplies its own
`cacheLimits` through the existing constructor option
(`src/common/editor/storage/media-repository.ts:42-48`) — and the planning path,
which becomes streaming so eviction never materializes the whole inventory
(`src/common/editor/storage/video-derivative-repository.ts:219,256`).

### The large-library fixture is synthetic and structural; timing is the L9 row

This is the milestone's hardest call, resolved here rather than deferred.

**The CI half, owned by L3.** `l3-synthetic-library-v1` is a deterministic
generator module, `src/common/editor/quality/l3-synthetic-library-workload.ts`,
following the m3 shape — pinned `generatorRevision`, pinned seed, expected
SHA-256 digests over the generated catalog and the operation plan
(`src/common/editor/quality/m3-longform-editorial-workload.ts:12-45`). It
generates 100,000 catalog rows over a small pinned pixel corpus — every row
references one of a few dozen generated 8-bit sRGB images by digest — so the
fixture is bytes-small, reproducible, and contains no real camera file. Its
thresholds are **structural counters only**: `count` and `bytes`, never `ms`,
`seconds`, `RTF`, or heap. They evaluate on `portable-node-structural-26.5.0` —
Linux x64, Node 26.5.0, `first-party-owned-structural-counters`
(`config/quality-budgets.json:357-377`) — whose `eligibleWorkloadIds` gains
`l3-synthetic-library-v1` and whose prose scope is rewritten in the same change,
and which already states ineligibility for elapsed time, heap, RSS, filesystem
durability, and operating-system behavior (`docs/quality-budgets.md:170-182`),
to which L3 adds no exception.

**The L9 half, already named.** Elapsed import, scroll, filter, and search
timing over real libraries, retained heap over soak, OPFS behavior at hundreds
of thousands of directory entries, and storage pressure on real devices belong
to the existing L9 real-library soak row (roadmap-lightscaper.md:503-505). L3
creates no new L9 row; it adds `l3-synthetic-library-v1` to that row's evidence.

The gate wording follows the split. "The large-library fixture meets its
recorded budgets in CI" (roadmap-lightscaper.md:290) is satisfied by
`tests/quality-budget-l3-synthetic-library-collector.test.ts`, which generates
the fixture, drives the real library modules over it, derives the metrics, and
asserts each threshold **read from `config/quality-budgets.json`** rather than
repeated as a literal — the recorded stale-pin lesson
(docs/milestone-6-plan.md:157-173). Ledger *qualification* is separate: the
qualified set is pinned to the five milestone-2 IDs
(`tests/quality-budget-m2-resource-contract.test.ts:8-15,86-88`) and accepted
cohorts must cover it exactly
(`scripts/audit-quality-result-cohorts.mjs:26-30`), so `l3-synthetic-library-v1`
lands `provisional` with the manual collector
`quality:collect:l3-synthetic-library`, promoted only by a reviewed no-retry
cohort.

### The grid window is a shared primitive with exactly one consumer

Windowing lives in `src/common/editor/ui/collection-window.ts`, because a
Lightscaper-private copy would be the second viewport projection in the tree and
the first is already load-bearing
(`src/common/editor/design-system-adapters/timeline.ts:55-110`). It is a pure
function from scroll offset, viewport size, row metrics, and total count to a
row range plus overscan, touching neither DOM nor storage. Migrating
`ProjectBinPanel` onto it is a recorded non-goal: the bin's item count is
bounded by the timeline and its render is `items.map` over that bounded set
(`src/common/editor/ui/workspace/ProjectBinPanel.jsx:72,405`).

### Culling is one command per keystroke, auto-advance included

A rating, flag, or label keystroke and the auto-advance it triggers commit as
one `batch` through the single commit boundary
(`src/common/editor/commands/project-source-bin.ts:10`;
`src/common/editor/commands.js:88-102`), so one undo reverses both the attribute
and the cursor move, and a rapid cull never interleaves a half-applied rating
with a moved selection. Culling writes catalog rows and selection, never the
media store, so a cull cannot alter a digest; rejecting sets a flag, not bytes.

### Smart-collection rules are validated data over a closed operator set

A rule is a versioned record with a closed field list and a closed operator set
— the discipline the delivery preset system already proved
(docs/milestone-6-plan.md:217-226). No expression language, no user-supplied
regular expression, bounded rule count and nesting depth, unknown fields
rejected rather than ignored. Evaluation is a pure predicate in
`src/common/editor/photo-smart-collection.ts` applied page by page, so a live
smart collection over 100,000 rows holds one page at a time.

### The catalog snapshot through `.scape` is state-only

Catalog snapshot and restore go through the `photo-catalog-shard` /
`photo-develop-shard` asset extension L2's WP-L2.5 registers
(lightscaper-2-plan.md); L3 adds the snapshot/restore surface and the
state-only (no media entries) scope, and owns no archive layout decision. A
snapshot writes catalog state — rows, folders, collections, rule definitions,
ratings, flags, labels, keywords, develop-stack references — with originals
recorded by digest and **no media entries**. Media-bearing `.scape` export stays
per-collection and entry-count bounded against the envelope
(`src/common/editor/scape-archive-envelope.ts:18-23`), because a six-figure
library cannot round-trip as media, and the Optional merge-on-import
(roadmap-lightscaper.md:281-282) consumes this state-only archive.

### Storage-dependent browser acceptance is Chromium and Firefox

The pinned Playwright WebKit build exposes no OPFS, no MediaRecorder, and no
IndexedDB Blob storage (roadmap.md:271-274) — the whole substrate of the photo
library. Every L3 browser spec that touches storage carries
`test.skip(browserName === 'webkit', …)` with the recorded deferral reason,
matching the existing convention
(`tests/browser/audio-editor-video-navigation.spec.js:23`), and the capability
inventory says Chromium and Firefox, never three engines. Keyboard specs that
never reach storage run on all three Playwright projects
(`playwright.config.mjs:32-36`).

### Rejected alternatives (recorded to prevent re-litigation)

| Alternative | Why rejected |
| --- | --- |
| Renaming `videoDerivatives` to a neutral store name | Every rename is a schema identity change and any version bump deletes every object store (`src/common/editor/storage/indexeddb-backend.ts:80-84`); L2 already spent the one recorded wipe and L3 buys nothing with a second. |
| The catalog as one project document with snapshot history | Whole-project clones on a 200-entry undo stack (`src/common/editor/history.js:4,32`) cannot hold six figures of rows; L2 owns the storage unit and L3 consumes it. |
| Elapsed-time budgets on the portable structural environment | That environment is explicitly ineligible for elapsed time (`docs/quality-budgets.md:177-182`) and the verifier refuses ineligible workloads (`scripts/verify-quality-budget-result.mjs:53-59`). |
| Real 100k-photo timing as an L3 exit gate | Every gate through L8 is CI- or script-provable without real devices (roadmap-lightscaper.md:42-49); the soak is already an L9 row (roadmap-lightscaper.md:503-505). |
| A second environment descriptor with the same fingerprint | One measurement class, one descriptor; a duplicate splits `first-party-owned-structural-counters` and makes cohort review ambiguous. |
| A user-authored regular expression in smart-collection rules | An unbounded pattern over six figures of rows is a denial-of-service surface; a closed operator set is expressive enough and provable. |
| A media-bearing `.scape` catalog snapshot | 4,096 entries and 256 MiB `project.json` (`src/common/editor/scape-archive-envelope.ts:18-23`) — the archive refuses it, so the feature would only fail later and less clearly. |
| An L3-private catalog archive layout | L2's WP-L2.5 owns the shard asset kinds and their ceilings; a second layout for one artifact is two incompatible readers. |

## Phase structure

| Phase | Mode | Content |
| --- | --- | --- |
| L3.0 | Serialized (one work stream) | Catalog pager, import pipeline with digest dedupe and interruption recovery, derivative preview tiers with bounded eviction |
| L3A | Parallel track (browse and organize) | Virtualized grid/filmstrip/loupe/compare/survey; ratings, flags, labels, stacks, sort, auto-advance culling; filter bar and live smart collections |
| L3B | Parallel track (metadata, maintenance, evidence) | Metadata panel, capture-time edit, batch rename, missing-media detection and relink, catalog snapshot; the synthetic large-library fixture and its recorded budgets |

L3A and L3B must not begin until every L3.0 acceptance check passes. L4 may
open on the L3.0 acceptance alone (roadmap-lightscaper.md:298-299).

## Work packets

Every L3 packet is decomposed here against the five fields (Outcome,
Invariants, Acceptance, Non-goals, Stop condition); no slice doc is owed at
pickup, and any packet that grows a slice doc names it here first.

### WP-L3.0 — Catalog pager and import pipeline

- **Outcome:** `src/common/editor/photo-catalog-page.ts` reading L2 catalog rows
  as cursor-keyed pages over `readCursorPage`
  (`src/common/editor/storage/indexeddb-backend.ts:218-292`) with the
  boundary-then-page generator shape of the derivative inventory; an import
  pipeline that retains originals through `writeAsset`
  (`src/common/editor/storage/media-repository.ts:77-117`), dedupes by recorded
  SHA-256 before publication, processes bounded batches, reports per-file
  failures without aborting the batch, applies rename templates and
  keyword/metadata presets during import, and preflights capacity through the
  requirement-plus-headroom shape; and interruption recovery reconciling
  half-written imports at open, following
  `src/common/editor/storage/linked-original-startup-reconciliation-repository.ts:118-133`.
  The apply-during-import preset slot is a list of preset references validated
  against a kind registry, so L4's develop presets join it without a schema
  change; L3 admits only keyword and metadata kinds
  (roadmap-lightscaper.md:264-265).
- **Invariants:** no L3 read path calls a store-wide `getAll()`; an import never
  overwrites an existing asset; a batch failure leaves no catalog row whose
  asset is absent and no asset whose row is absent; a rename template changes
  catalog metadata only.
- **Acceptance:** `npm test -- --shard=common` covers
  `tests/photo-catalog-page.test.ts` (page boundaries, cursor resumption,
  refusal of an unbounded read) and `tests/photo-import-pipeline.test.ts`
  (digest dedupe, per-file failure isolation, rename templates, preset
  application, capacity refusal), which also re-reads every imported original
  after the batch completes and asserts its SHA-256 equals the digest computed
  from the source bytes before publication, including for the interrupted-batch
  cases in `tests/photo-import-interruption.test.ts`; that suite aborts after
  asset write, after row write, and mid-batch, asserting the reopened catalog is
  valid with zero orphaned rows and zero orphaned assets outside the grace
  window (`src/common/editor/storage/media-repository.ts:36,105`).
- **Non-goals:** no browse surface; no derivative generation; no
  merge-on-import; no change to the L2 catalog schema or its storage unit.
- **Stop condition:** stop if the L2 catalog store cannot be paged by primary
  key — a read model needing a whole-store scan is an L2 storage-unit question,
  not an L3 workaround.

### WP-L3.1 — Derivative preview tiers and bounded eviction

- **Outcome:** thumbnail and fit-screen preview tiers as disposable derivatives
  on the existing repository
  (`src/common/editor/storage/video-derivative-repository.ts:44-51,101`), each
  bound to the original's digest plus a recipe id and version; a cancellable
  background batch builder owning a named task scope
  (`src/common/editor/controller/lifecycle.ts:150-183`) with a bounded
  concurrency ceiling, on-demand regeneration, and pressure-driven eviction
  wired to the existing capacity classifier; streaming eviction planning so
  `trimDerivatives` stops materializing the whole inventory twice
  (`src/common/editor/storage/video-derivative-repository.ts:219,256`); and a
  Lightscaper `cacheLimits` profile replacing the 4,096-entry default
  (`src/common/editor/storage/derivative-cache-policy.ts:22-26`).
- **Invariants:** a preview build never mutates the committed catalog document
  (the post-commit rule,
  `src/common/editor/controller/framescaper-capture-derivative-scheduler.ts:238-242`);
  cancelling a batch leaves no partially written derivative and no row pointing
  at one; eviction never removes an original; a derivative whose
  `originalSha256` no longer matches is never served.
- **Acceptance:** `tests/photo-derivative-tiers.test.ts` proves tier keys are
  content-addressed and a changed original misses rather than serving a stale
  preview; `tests/photo-derivative-batch-cancel.test.ts` aborts mid-batch at
  each boundary and asserts zero orphaned derivative payloads;
  `tests/photo-derivative-eviction-streaming.test.ts` asserts the planner's peak
  retained record count is bounded by the page size regardless of inventory size
  and re-digests every fixture original after a full eviction sweep
  (roadmap-lightscaper.md:291-292); the existing
  `tests/audio-editor-derivative-cache-*.test.ts` suites stay green.
- **Non-goals:** no develop rendering (L4 owns proxy develop); no new IndexedDB
  store, database version bump, or raw decode.
- **Stop condition:** stop if a preview tier would need a second store or a
  schema version bump — that deletes every existing library
  (`src/common/editor/storage/indexeddb-backend.ts:80-84`).

### WP-L3A.0 — Virtualized grid, filmstrip, loupe, compare, survey

- **Outcome:** `src/common/editor/ui/collection-window.ts`, a pure windowing
  function over scroll offset, row metrics, and total count with overscan
  modeled on `src/common/editor/design-system-adapters/timeline.ts:63-64`;
  grid, filmstrip, loupe, compare, and survey views in `src/lightscaper/`
  rendering only windowed rows and requesting only windowed preview tiers;
  library panels registered through the product profile and the central panel
  list (`src/common/editor/ui/workspace/workspace-panel-model.ts:15-32`), each
  menu-reached and off by default (AGENTS.md:8-11).
- **Invariants:** rendered row count is a function of viewport size, never of
  library size; scrolling issues bounded page and preview reads; every view is
  keyboard-operable and view switching preserves the focused photo.
- **Acceptance:** `tests/photo-collection-window.test.ts` asserts window and
  overscan bounds across scroll positions at a 100,000-row total under
  `npm test -- --shard=common`; `tests/lightscaper-library-views.test.ts`
  asserts focus preservation and windowed request counts under
  `npm test -- --shard=lightscaper` (`scripts/lib/node-test-shards.mjs:12`);
  `tests/browser/lightscaper-library-grid.spec.js` drives grid → filmstrip →
  loupe → compare → survey keyboard-only in Chromium and Firefox with the
  recorded WebKit skip.
- **Non-goals:** no `ProjectBinPanel` migration onto the window primitive; no
  develop surface; no drag-and-drop reordering.
- **Stop condition:** stop if any view needs the full row array to lay out — a
  layout that cannot be computed from counts and metrics is a design defect.

### WP-L3A.1 — Ratings, flags, labels, stacks, sort, auto-advance culling

- **Outcome:** ratings, pick/reject flags, and color labels as catalog-row
  commands; auto-advance culling where the attribute and the cursor move commit
  as one `batch` through `applyEditorCommand`
  (`src/common/editor/commands/project-source-bin.ts:10`;
  `src/common/editor/commands.js:88-102`); stacks with a collapsed
  representative; sort orders over capture time, file name, rating, and a
  digest-stable tiebreak; the culling key map registered through the existing
  shortcut runtime (`src/common/editor/ui/workspace-shortcuts.ts:54-72`) so user
  rebinding applies.
- **Invariants:** one keystroke is one undo step; no culling verb touches the
  media store; a reject flag never deletes bytes; sort is total and stable, so
  auto-advance cannot revisit or skip a photo; every verb has a keyboard path.
- **Acceptance:** `tests/photo-culling-commands.test.ts` proves one undo
  reverses attribute plus advance and that rapid sequences apply in order;
  `tests/photo-sort-stability.test.ts` proves total, stable ordering under equal
  keys; `tests/photo-original-immutability.test.ts` re-digests every fixture
  original after a full cull pass (roadmap-lightscaper.md:291-292);
  `tests/browser/lightscaper-culling-keyboard.spec.js` completes a keyboard-only
  cull in Chromium and Firefox.
- **Non-goals:** no develop presets applied during culling (L4); no face or
  subject grouping (the ML fence, roadmap-lightscaper.md:111-117).
- **Stop condition:** stop if auto-advance would need a second commit — two
  commits mean two undo steps and a user who cannot take back a keystroke.

### WP-L3A.2 — Filter bar and live smart collections

- **Outcome:** `src/common/editor/photo-filter-expression.ts`, a validated
  predicate record over text, attributes, and metadata columns with a closed
  operator set and rejected unknown fields;
  `src/common/editor/photo-smart-collection.ts`, the pure rule evaluator;
  collections and live smart collections evaluated page by page through the
  WP-L3.0 pager with membership derived on read; the filter bar bound to both.
  Text search is the same predicate path as attribute filtering, not a second
  engine.
- **Invariants:** rule evaluation is pure and allocation-bounded per page; no
  user-supplied pattern is compiled; an unknown operator or field is refused,
  not ignored; a smart collection stores its rule, never a membership list, and
  paged results agree with a direct scan of the same fixture.
- **Acceptance:** `tests/photo-filter-expression.test.ts` covers validate,
  reject-unknown, and future-version refusal;
  `tests/photo-smart-collection.test.ts` is a property test comparing paged
  evaluation against a direct scan over generated catalogs;
  `tests/photo-smart-collection-bounds.test.ts` asserts peak retained rows
  during a 100,000-row evaluation equals one page;
  `tests/browser/lightscaper-filter-bar.spec.js` drives filter entry and smart
  collection creation keyboard-only in Chromium and Firefox.
- **Non-goals:** no saved-search format; no natural-language query; no index
  build — paged evaluation is the contract.
- **Stop condition:** stop if any rule needs an expression evaluator or a
  compiled pattern — a security surface and a dependency review L3 does not own.

### WP-L3B.0 — Metadata panel, relink, batch rename, catalog snapshot

- **Outcome:** a metadata panel over `PhotoMetadataReadV1` with capture-time
  edit recorded as catalog state; batch rename over the WP-L3.0 template model
  applied through the pager; missing-media detection and bounded-scan relink
  through the existing lifecycle and its structural probe
  (`src/common/editor/storage/linked-original-resolver.ts:120,209`); state-only
  snapshot and restore through the WP-L2.5 `photo-catalog-shard` /
  `photo-develop-shard` asset kinds (lightscaper-2-plan.md); the Optional
  merge-on-import of a catalog `.scape` (roadmap-lightscaper.md:281-282), which
  lands only if its conflict rules are closed in this packet.
- **Invariants:** capture-time edit never rewrites the original; relink refuses
  a mismatch rather than rebinding; a snapshot records originals by digest and
  carries no media entries; restore never resurrects a row whose original is
  absent without marking it missing; merge never silently overwrites a row.
- **Acceptance:** `tests/photo-metadata-panel-model.test.ts` and
  `tests/photo-batch-rename.test.ts` cover the bounded application paths;
  `tests/photo-relink.test.ts` proves refusal on digest mismatch and success on
  match, re-digesting originals afterward;
  `tests/photo-catalog-snapshot.test.ts` round-trips a generated catalog through
  the WP-L2.5 shard planner with every shard digest verified, and exercises the
  shard-count ceiling refusal at the L2-recorded bound; when the Optional
  merge-on-import lands, `tests/photo-catalog-merge-on-import.test.ts`
  enumerates every conflict class — same digest/different row, same row
  id/different digest, missing original, colliding collection name, colliding
  keyword path — and asserts a deterministic recorded decision for each with no
  silent overwrite; if any class has no closed rule the merge does not ship, the
  test is not added, and the packet records it as unscheduled Optional;
  `tests/browser/lightscaper-relink.spec.js` drives detect → relink → verify in
  Chromium and Firefox.
- **Non-goals:** no metadata write to file (L5 owns `PhotoSidecarV1` and write);
  no reverse geocoding or map tiles (roadmap-lightscaper.md:89-90); no folder
  operation that touches a file on disk (roadmap-lightscaper.md:95); no archive
  layout decision — L2's WP-L2.5 owns the shard kinds and their ceilings.
- **Stop condition:** stop if merge-on-import cannot state a deterministic rule
  for every conflict class; it stays Optional and unshipped rather than merging
  by guess.

### WP-L3B.1 — Synthetic large-library fixture, budgets, exit evidence

- **Outcome:** `src/common/editor/quality/l3-synthetic-library-workload.ts`
  generating 100,000 deterministic catalog rows over a small pinned pixel corpus
  with a pinned `generatorRevision`, seed, and expected digests on the m3 shape;
  fixture and workload `l3-synthetic-library-v1` registered in
  `config/quality-budgets.json` with an honest `limitation` paragraph;
  `portable-node-structural-26.5.0` extended by one eligible workload id with
  its prose scope rewritten in the same change; the manual collector
  `scripts/collect-l3-synthetic-library-quality.mjs` and its
  `quality:collect:l3-synthetic-library` script; the Lightscaper
  `config/production-capabilities.json` block L1 created, extended with the L3
  `importFamilies`, `projectFeatures`, and `web-core` evidence paths, with
  `photoLibrary` flipped to `true` in the Lightscaper profile and its
  `projectFeatures` inventory row; the Lightscaper `web-enhanced` tier moved
  from `planned` to `available` with its own OPFS evidence paths, and the
  assertion L1 added to `tests/production-opfs-worker-policy.test.js` widened to
  admit Lightscaper as a third OPFS-boundary owner rather than as a product that
  must declare a non-`available` tier.
- **Invariants:** every threshold is a `count` or `bytes` structural counter —
  no `ms`, `seconds`, `RTF`, or heap metric enters this workload; the CI test
  reads thresholds from the config rather than repeating literals; the fixture
  contains no real camera file; the workload stays `provisional` until a
  reviewed no-retry cohort accepts it.
- **Acceptance:** `tests/quality-budget-l3-synthetic-library-collector.test.ts`
  generates the fixture, drives the WP-L3.0/L3.1/L3A modules over it, derives
  `library.catalogRowsReadPerScrollPage`, `library.maximumWindowedRows`,
  `library.maximumConcurrentPreviewBuilds`,
  `library.maximumRetainedDerivativeInventoryRecords`,
  `library.smartCollectionPeakRetainedRows`, `library.searchPeakRetainedRows`,
  `library.searchRowsScannedPerPage`, `library.importPartialCommits`,
  `library.orphanedRowsAfterInterrupt`, and
  `library.orphanedDerivativesAfterInterrupt`, and asserts each against the
  registered threshold; the two search counters come from driving the WP-L3A.2
  filter/text predicate over the fixture, which is the roadmap's recorded search
  budget (roadmap-lightscaper.md:278-280) — elapsed latency is the L9 row;
  `tests/quality-budget-l3-structural-metric-units.test.ts` fails if any
  `l3-synthetic-library-v1` threshold declares a timing or heap unit;
  `npm run audit:quality-results` passes and
  `tests/production-capability-inventory.test.js` pins the Lightscaper claims.
- **Non-goals:** no elapsed-time, heap, RSS, filesystem-durability, or
  real-device measurement — all of it is the L9 soak row — and no promotion
  into `qualification.qualifiedWorkloadIds`.
- **Stop condition:** stop if any exit-gate claim would need a timing number;
  the automated part closes here and the remainder is already an L9 row
  (roadmap-lightscaper.md:42-49).

## Quality-budget and evidence duties

- Fixture and workload `l3-synthetic-library-v1` register `status:
  "provisional"`, `environmentIds: ["portable-node-structural-26.5.0"]`, and an
  evidence list whose every path exists — the shape of
  `config/quality-budgets.json:1473-1486`. Its `limitation` paragraph states
  that the fixture proves bounded structural behavior over synthetic rows and a
  small pinned pixel corpus, and nothing about elapsed time, heap, real file
  sizes, real OPFS behavior at scale, browsers, or the operating system.
- Extending `portable-node-structural-26.5.0` is a reviewed budget change made
  in one commit that edits the descriptor's `eligibleWorkloadIds`
  (`config/quality-budgets.json:362-368`) and the paragraph describing its scope
  (`docs/quality-budgets.md:170-182`). Accepted milestone-2 cohorts are
  unaffected: cohort verification digests the historical budget file at each
  cohort's source revision (`scripts/audit-quality-result-cohorts.mjs:49-59`).
- Citing `roadmap-lightscaper.md#l3-photo-library` from
  `config/quality-budgets.json` triggers the recorded anchor-verification duty:
  `tests/roadmap-guidance.test.js:8-13,50-61` checks only `roadmap.md#` anchors
  today; extending it lands in the same change (roadmap-lightscaper.md:571-574).
- Correctness, interruption, immutability, and structural-bound suites run in
  ordinary CI through `npm run check`; the manual collector runs only for ledger
  evidence, no-retry (docs/quality-budgets.md:117-146).
- The Lightscaper `config/production-capabilities.json` block L1 created gains
  the L3 `importFamilies`, `projectFeatures`, and `web-core` evidence paths, the
  `photoLibrary` flip, and the `web-enhanced` move from `planned` to `available`
  in one change with the `tests/production-opfs-worker-policy.test.js` widening;
  the profile boolean and the inventory row move together because
  `tests/production-capability-inventory.test.js:33` deep-equals one against the
  other. The block names Chromium and Firefox, never WebKit
  (roadmap.md:271-274).

## Coordination rules

- L3.0 is one work stream. L3A and L3B open only after every L3.0 acceptance
  check passes and run file-disjoint: browse and organize surfaces to L3A,
  metadata, maintenance, and evidence to L3B.
- **A Node test's shard follows its basename as well as its imports**
  (`scripts/lib/node-test-shards.mjs:24-27,42-48`): a file whose basename
  carries a product name is owned by that shard, so the acceptance command and
  the filename are chosen together — L3's shared-module tests take `photo-*`
  names under `--shard=common`, and only tests reaching into `src/lightscaper/`
  carry the `lightscaper-` prefix and `--shard=lightscaper`.
- **Spine files — one owner per edit, rebase before push:**
  `config/quality-budgets.json`, `docs/quality-budgets.md`,
  `config/production-capabilities.json`, `src/common/products.js`,
  `config/maintainability-allowlist.json`, `src/lightscaper/product.js`,
  `tests/production-opfs-worker-policy.test.js`, `src/common/i18n/catalogs.js`,
  `scripts/lib/node-test-shards.mjs`, `.github/workflows/quality.yml`,
  `package.json`, and under `src/common/editor/`: the `ui/workspace/` panels
  `workspace-panel-model.ts`, `WorkspacePanelDock.jsx`, and
  `WorkspacePanelContent.jsx`, plus `storage/derivative-cache-policy.ts`,
  `storage/video-derivative-repository.ts`, and
  `storage/retention-repository.ts`.
- Schema revisions stay serialized product-wide, at most one in flight. L3
  authors no new persisted schema family — it consumes L2's — so schema pressure
  found here is escalated to L2 rather than absorbed.
- No L3 change bumps `EDITOR_STORAGE_DATABASE_VERSION`
  (`src/common/editor/storage/indexeddb-backend.ts:32`). A bump deletes every
  object store (`:80-84`) and is a separately reviewed decision with its own
  owner.
- Stage explicit paths and confirm `git diff --cached --name-only` before every
  commit; this tree is edited by many concurrent sessions, so local gate runs
  mix in other sessions' uncommitted work. `npm run check` stays green on every
  push, and a Lightscaper change that reddens the Framescaper or Soundscaper
  shard is reverted, not annotated.

## Known constraints this plan absorbs

- **Retention maintenance is unbounded in library size**
  (`src/common/editor/storage/retention-repository.ts:90,95-99`). WP-L3.1 makes
  the derivative side streaming; the asset side stays as it is for the other two
  products, and Lightscaper's maintenance path uses the pager instead.
- **L2 dependencies:** every schema L3 reads is L2's, and so is the catalog
  archive layout. If `PhotoCatalogV1` lands without a primary-key-ordered row
  store, WP-L3.0's stop condition fires and the question returns to L2
  (lightscaper-2-plan.md).
- **The Framescaper V30 still campaign** on `codex/milestone-8-images` owns
  still ingest and timeline-image modeling; L3 depends on it landing on `main`
  and never forks or preempts it (roadmap-lightscaper.md:57-61).
- **WebKit is deferred, not failing** (roadmap.md:271-274); every storage spec
  skips for that recorded reason.

## Watch items (not gates yet)

- Whether a pinned Playwright WebKit build gains OPFS and IndexedDB Blob
  storage; the moment it does, the L3 storage specs drop their skips and the
  capability claim widens (roadmap-lightscaper.md:286-289).
- Whether the derivative cache's 30-day `maximumAgeMs` default
  (`src/common/editor/storage/derivative-cache-policy.ts:25`) suits a library
  browsed rarely but expected to be fast when it is, and L4's proxy-develop
  budgets over the same preview tiers.

## Non-goals and fences

- No tethered capture, camera control, or capture schema of any kind
  (roadmap-lightscaper.md:103-106).
- No destructive raster editing: no brush strokes into pixels, no mutable raster
  layers, no per-stroke document (roadmap-lightscaper.md:107-110).
- No ML-dependent capability — no face recognition, subject grouping, or
  auto-tagging — under the milestone-7 rules (roadmap-lightscaper.md:111-117).
- No HEIC, HEVC, or other patent-encumbered codec before licensing and patent
  review (roadmap-lightscaper.md:118-119).
- No moving or renaming files on disk from catalog folder operations
  (roadmap-lightscaper.md:95), and no Adobe catalog or XMP develop-state
  compatibility claim (roadmap-lightscaper.md:91-92).
- No raw decode, wide-gamut output, or deeper-than-8-bit pixel path (L7 through
  L2's declared sample profile), and no metadata write to file (L5 owns
  `PhotoSidecarV1` and the write path).
- No new third-party dependency: none of these packets needs one; adding one
  requires a licensing-matrix row, a notices section, license text, and an
  audit pairing first.
- Every new surface is menu-reached and off by default (AGENTS.md:8-11).
