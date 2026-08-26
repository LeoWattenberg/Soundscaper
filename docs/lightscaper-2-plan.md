# Lightscaper milestone L2 plan: catalog and develop-state contracts

> Owning source for L2 sequencing, the catalog-persistence, develop-stack,
> pixel-interchange, and metadata-read decisions, their invariants, and the
> bounded work packets. The
> [Lightscaper roadmap](../roadmap-lightscaper.md#l2-catalog-and-develop-state-contracts)
> owns scope and status; the
> [project-compatibility contract](project-compatibility.md), the
> [licensing policy](production-licensing-policy.md), and the
> [quality budgets](quality-budgets.md) own theirs. Grounded against the
> repository on 2026-08-25 at commit `3d1e908c` with file:line verification. L2
> depends on L1 (lightscaper-1-plan.md) for the registered third product, its
> shard, and its architecture rules, and on the Framescaper V30 still-image
> campaign landing on `main`; it forks neither, and L3 (lightscaper-3-plan.md)
> through L7 consume the schemas fixed here. Re-ground every citation at pickup
> — earlier milestones will have moved the tree.

## Goals and ordering principle

1. **Primary: users must not lose photographs or work.** Originals stay
   immutable and digest-stable, develop state lives beside the original and is
   removable to yield the original byte-identically, a catalog survives
   interruption at every persistence boundary, and an old `processVersion` keeps
   rendering identically instead of migrating silently.
2. **Secondary: one schema-family shape, extended — not a second project
   machinery.** Every artifact L2 defines follows the Framescaper V24/V27 module
   set: a validation module owning the version constant and the interface, a thin
   creation/clone facade, a migration module refusing older documents, a commands
   module with a closed discriminant union, a history module, and four profiles.
   Nothing invents a parallel validator, archive, or command protocol.

Work is ordered by irreversibility: the pixel-buffer contract and the catalog
persistence substrate land first, because the storage-database version bump is a
one-shot cross-product event every later schema binds to.

## What already exists (do not re-plan)

- **A complete schema-family template.** Framescaper V24 is eleven small
  modules: `src/framescaper/editor-project-v24-validation.ts:29` owns the version
  constant, `:31-40` the interface, `:43` validation;
  `editor-project-v24.ts:53` creates and `:45` declares the reimport error;
  `editor-project-v24-migration.ts:19` refuses anything below 24;
  `editor-project-v24-commands.ts:38-41` is the closed command union and `:49-50`
  borrows the traversal budget; `editor-project-v24-history.ts:25-30` is the
  history record; four profile modules run from
  `editor-project-feature-capability-profile-v24.ts:14-23` to
  `editor-project-runtime-profile-v24.ts:8-19`; the `.scape` binding is one
  50-line adapter, `editor-scape-native-v24.ts:17-49`. Numbers come from one
  serialized namespace, `src/common/editor/project-schema-version.ts`, where 17
  to 32 except 18 are claimed on `main`: 30 is the Soundscaper assistance-asset
  generation, 31 is selected Framescaper capture, and 32 is the Framescaper
  timeline-image generation. That image generation was authored as V30 on
  `codex/milestone-8-images` and had to be renumbered when it merged, because
  Soundscaper had claimed 30 meanwhile and a number identifies exactly one
  product. Take the next free number, and take it when you land, not when you
  start.
- **A shared command protocol and one commit boundary.**
  `src/common/editor/commands/protocol.ts:31` is the authoritative discriminant
  list, `registry.ts` and `domain-registry.ts` enforce exactly-one-domain
  ownership, `runtime-registry.ts:31-49` composes the handler maps exhaustively,
  and `src/common/editor/commands.js:88-102` owns the single project commit,
  gated on an exact shared schema version (`:89-91`); handlers mutate only their
  draft (`commands/README.md:31-32`). Undo is snapshot-based: `history.js:4` sets
  `AUDIO_EDITOR_HISTORY_LIMIT = 200`, `:20` clones the whole project into
  `present`, `:27-34` pushes the previous one onto the undo stack.
- **A domain-split storage layer.** `storage/README.md:7-23` lists the
  repositories; `indexeddb-backend.ts:32` pins the database version at 8 and
  `:85-89` creates `projects`/`revisions`/`settings`/`analysis`;
  `project-repository.ts:86-93` keeps revisions at the `revisionLimit` the facade
  defaults to 20 (`storage.js:34`); `readCursorPage` (`:218-237`) pages cursors
  at 64 records (`:36`); digests take 4 MiB slices
  (`storage/media-content-digest.ts:15`).
- **A `.scape` archive with a documented extension seam.**
  `scape-archive-envelope.ts:18-23` pins `maximumEntryCount: 4_096`, 32 MiB
  manifest, 256 MiB project, 64 GiB expansion; `:43-59` is the asset descriptor
  with a mandatory `sha256`; `:299-300` refuses any entry no descriptor claims;
  `:255-268` admits additional asset kinds.
  `scape-project-asset-extension.ts:33-46` is the six-method extension interface,
  and `scape-export-destination.ts:11` streams in 4 MiB chunks.
- **A compatibility contract a new schema owes.**
  `docs/project-compatibility.md:22-40` separates the core loader from the
  archive: a newer `schemaVersion` reads structured-cloned and read-only, a
  future `formatVersion` is rejected before persistence.
  `config/project-compatibility.json:4-8` pins the shared version at 17;
  `tests/project-compatibility-policy.test.js:12-16` binds each rule id.
- **An undeclared 8-bit pixel interchange under a fail-closed color model.** The
  one interchange buffer type is `{ width, height, pixels: Uint8Array }`
  (`video-mask-matte-rgba-v13.ts:9-13`, re-exported at
  `unified-exact-render-visual-materializer-v13.ts:17`) with literal
  `width * height * 4` allocations (`:81`, `:195`;
  `unified-exact-render-finishing-consumers-v13.ts:48-52, 281`), while
  `video-color-management-v27.ts:30-32` declares the primaries, transfer, and
  matrix vocabularies — `display-p3`, `bt2020`, `pq`, `hlg` among them — and
  `:385-408` refuses wide-gamut or HDR interpretations fail-closed, as
  `native-media-image-sequence-rgba8-admission.ts:10-20` does by named code.
- **Shared effects, masks, and geometry.** Twelve effect ids at
  `video-effects.js:29-100` with FFmpeg serialization at `:240`; seven mask node
  kinds at `video-mask-matte-v24.ts:40, 50, 57, 64, 70, 77, 83`; normalized crop,
  transform, opacity, blend, and compositing order at
  `video-clip-composition.ts:87-94`.
- **Capability, requirement, and budget registers.**
  `project-feature-capabilities.ts:3-55` is the closed id map,
  `project-feature-requirements.ts:47-57` the manifest schema and limits, and
  `tests/production-capability-inventory.test.js:25, 38` binds inventory product
  keys to `PRODUCT_IDS` and demands evidence paths that exist.
  `config/quality-budgets.json:357-377` describes the only `qualificationEligible`
  environment, `portable-node-structural-26.5.0`, whose `eligibleWorkloadIds`
  list (`:362-368`) is closed; the no-retry collector rule is at
  `docs/quality-budgets.md:419-429` and the writer at
  `scripts/quality-budget-evidence.mjs:39`.

## Verified gaps this plan closes (grounded 2026-08-25)

- **No catalog unit of storage exists.** Every persisted document is one whole
  project row plus bounded revisions (`project-repository.ts:86-93`), every undo
  is a whole-project clone (`history.js:4, 20`), and nothing stores six figures.
- **Four independent ceilings refuse a single-document catalog.** A minified
  photo row carrying the fields the roadmap names measures 882 bytes and 28 JSON
  nodes, so 100 000 photos is ~88 MB and ~2.8 million nodes: 28× the
  `maximumTraversalNodes: 100_000` budget (`scape-project-document.ts:38`,
  borrowed by `project-validation-budget.ts:13`), past the 256 MiB publication
  ceiling within two saves (`project-publication-admission.ts:8`), 17.6 GB across
  the undo stack, and 1.76 GB across 20 retained revisions — the four ceilings
  the rejected alternatives table records. It breaks at ~3 571 photos.
- **No depth or gamut declaration exists on any buffer.** Sample format,
  primaries, and transfer are implicit in the `Uint8Array` type itself, so
  widening depth today is a type change in every consumer, not a new profile.
- **No EXIF, IPTC, or XMP reader exists anywhere.** A case-insensitive search for
  those three words across `src/` returns zero hits on `main` and zero on
  `codex/milestone-8-images`; no dependency parses image metadata, and `saxes` is
  a dev-only XML tokenizer. **No process-version concept exists** either:
  `grep -rn processVersion src/` returns nothing, and `sampleFormat` is already
  an audio PCM term (`project-media-validation.ts:72`,
  `desktop-codec-provider-catalog.ts:37`).
- **The storage database has no photo stores**, and adding them bumps a constant
  that wipes every product's stores on next open
  (`indexeddb-backend.ts:32, 73-84`). No catalog-scale budget is registered:
  `config/quality-budgets.json` holds 23 fixtures and 22 workloads, none a photo
  library, and `portable-node-structural-26.5.0` admits five workload ids
  (`:362-368`).

## Decisions

### Catalog persistence is a hybrid: bounded spine, indexed rows

The roadmap defers this decision to the owning plan; it resolves into three
units.

**The spine lives in the Lightscaper project document** and is snapshot-cloned
by ordinary history like every other schema family: catalog identity and
counters, the virtual-folder tree, collection identities and kinds,
smart-collection rules, the hierarchical keyword tree, the color-label palette,
and the process-version registry — each bounded by a count that does not scale
with photo count (4 096 folders, 4 096 collections, 16 384 keywords, under 3 MB
worst case). Structural collection *membership* is a back-reference on the photo
row instead; the spine records identity, sort key, and count only.

**Photo rows live in a dedicated indexed store**, `photoCatalog`, keyed
`${catalogId}:${photoId}`, with a `catalogId` index plus compound indexes on
capture time, content digest, and folder, so browse, dedupe, and folder
filtering are 64-record cursor pages (`indexeddb-backend.ts:218-237`).
**Develop state lives per photo version** in `photoDevelop`, keyed
`${catalogId}:${versionId}` with a `[catalogId, photoId]` index, carrying only
the version-id list and a develop digest, so a rating change never rewrites a
stack and a develop edit never rewrites a row.

Row and develop mutations therefore cannot use snapshot undo; they use an
inverse journal. The budget proving the choice, and the WP-L2D.0 thresholds:
spine ≤ 4 MiB independent of photo count; one row write is one keyed put; a
full-catalog rating change over 100 000 rows retains ~5 MB of inverse payload
against a 32 MiB ceiling; zero whole-catalog clones.

### Catalog mutation is a bounded, inverse-journaled command surface

`PhotoCatalogCommandV1` is a closed discriminant union — `photo/add-many`,
`photo/remove-many`, `photo/set-rating-many`, `photo/set-flag-many`,
`photo/set-label-many`, `photo/set-keywords-many`, `photo/move-to-folder-many`,
`photo/set-collection-membership-many`, `photo/add-version`,
`photo/remove-version`, and `develop/set-stack` — over a repository port, not the
project draft. Each handler reads the pre-image of exactly the rows it touches
and emits its own inverse, both journaled into `photoCatalogJournal`,
keyed `${catalogId}:${sequence}` and tagged `transactionId`, so undo pops a
whole transaction rather than a single command.

Two bounds keep it honest. A command touches at most 4 096 rows and is refused
above that, so a selection-scale operation is a sequence of bounded commands
sharing one `transactionId` — the service that splits a selection is L3's, the
bound and the grouping field are L2's. The journal retains 200 transactions,
matching `AUDIO_EDITOR_HISTORY_LIMIT` (`history.js:4`), or 32 MiB of inverse
payload, whichever binds first. Spine mutations are ordinary snapshot-history
commands and do *not* join the shared `AUDIO_EDITOR_COMMAND_TYPES` list: V24
already shows a product-owned union with an inheritance path
(`editor-project-v24-commands.ts:38-41`), and `applyEditorCommand` is gated on
the exact shared schema version (`commands.js:89-91`).

### `.scape` carries the catalog as digest-pinned shards

A catalog archive is `manifest.json` plus `project.json` (the spine) plus
JSON-Lines shards under two new asset kinds, `photo-catalog-shard` and
`photo-develop-shard`, registered through `resolveScapeProjectAssetExtension`
(`scape-project-asset-extension.ts:50-79`) and admitted by `allowedAssetKinds`
(`scape-archive-envelope.ts:255-268`). Each shard holds at most 4 096 rows and 4
MiB, matching the export streaming chunk (`scape-export-destination.ts:11`), and
is claimed by a manifest descriptor carrying its exact `size` and `sha256`
(`:43-59`), so an unreferenced or resized shard is refused (`:299-300`). The
shard ceiling is 2 048 per kind, keeping the archive under the 4 096-entry
maximum (`:19`) at a million photos.

**What "opens read-correctly in Framescaper as project state" means.** That
path, not interpretation: the loader returns a document above its own schema
number structured-cloned and read-only with reason `newer-schema`
(`docs/project-compatibility.md:25-27`), and the archive path returns it
unmutated and saves back byte-identically (`:29-34`), with no shard dropped and
a feature report naming exactly the capabilities Framescaper lacks. Interpreting
a developed photo as a still is L5's handoff.

### `RenderSampleProfileV1` declares; a separate module admits

`src/common/editor/render-sample-profile-v1.ts` owns vocabulary and carries no
policy: `RenderSampleFormatV1` is `'unorm8' | 'unorm16' | 'float32'`, and
`RenderSampleProfileV1` is `schemaVersion`, `sampleFormat`, `primaries` (`srgb`,
`bt709`, `display-p3`, `bt2020`), `transfer` (`srgb`, `bt709`, `linear`, `pq`,
`hlg`), `alphaMode` (`straight`, `premultiplied`, `opaque`), and `channelOrder`;
`RenderSampleBufferV1` pairs it with `width`, `height`, and a `samples` typed
array of the declared format. The vocabularies reuse the tokens
`video-color-management-v27.ts:30-32` already declares, so a source
interpretation maps onto a profile with no translation table.

`render-sample-admission-v1.ts` owns the policy: an admitted-profile set as
ordinary data with one member today (`unorm8`/`srgb`/`srgb`/`straight`), a named
refusal-code list on the `native-media-image-sequence-rgba8-admission.ts:10-20`
pattern, and `assertRenderSampleBufferAdmitted(buffer, admitted = DEFAULT)` —
defaulted so a test build widens it without a type or schema change, which is how
WP-L2.0 proves depth-agnosticism, with a source scan on the
`tests/audio-editor-framescaper-v25-candidate-profile.test.ts:88-91` technique.

### Process versions are a registry with pinned goldens

`DevelopStackV1.processVersion` is a string from a closed registry declared in
the spine and validated against `src/common/editor/photo-process-version.ts`. An
entry pins the ordered operation semantics that version renders under, and a
golden per entry pins its output for a fixture stack; an unregistered version is
refused with a named code rather than defaulting to the newest. Upgrading is an
explicit `develop/set-stack` carrying both versions, journaled like any other
mutation and never a side effect of a preset, sync, paste, import, or handoff.
L4, L6, and L7 add entries and never edit one; the goldens fail if they do.

### `PhotoMetadataReadV1` is a first-party bounded reader, not a dependency

No EXIF or IPTC parser exists in the tree and no plausible npm candidate is
narrower than the read model; the licensing, notice, and tracked-version chain a
dependency would owe is recorded in the rejected alternatives below. The
repository already carries bounded first-party readers of comparable difficulty:
the ZIP central-directory reader (`scape-archive-layout.ts:17-38`), the WAV
layout reader (`wav.js:206`), and `parseCubeLutV1`
(`video-color-cube-lut-v27.ts:15-18, 41`). L2 writes the reader.

It is three modules — container scan, TIFF IFD walk, tag mapping — bounded by
`PHOTO_METADATA_READ_LIMITS_V1`: 8 MiB scanned (matching
`IMAGE_IMPORT_LIMITS.maximumMetadataBytesPerFile`,
`image-import-admission.ts:19` on `codex/milestone-8-images`), 8 IFDs, 512
entries per IFD, 1 024 bytes per string, 128 keywords, 64 array values, a
visited-offset set refusing a revisited IFD, a step budget that throws rather
than looping, and every offset plus length checked before any read. Unknown tags
are dropped, never guessed; an unparseable known field becomes a named refusal;
and L2 has no write path — writing is `PhotoSidecarV1` in L5.

### The storage database version bump is one serialized change

Adding `photoCatalog`, `photoDevelop`, and `photoCatalogJournal` bumps
`EDITOR_STORAGE_DATABASE_VERSION` from 8 to 9, and the upgrade handler drops
every existing store before recreating the schema
(`indexeddb-backend.ts:73-84`). That is recorded policy
(`storage/README.md:29-31`), but it reaches Soundscaper and Framescaper databases
too, so it lands announced and serialized, with its schema tests.

### Rejected alternatives (recorded to prevent re-litigation)

| Alternative | Why rejected |
| --- | --- |
| The catalog as one project document | Four independent ceilings refuse it: 100 000 traversal nodes (`scape-project-document.ts:38`), 256 MiB per publication counting document plus revision (`project-publication-admission.ts:8`), 200 whole-project undo clones (`history.js:4`), 20 retained revisions (`storage.js:34`). It breaks at ~3 571 photos. |
| Photo rows in the `settings`/`analysis` key-value domain | `MAXIMUM_KEY_VALUE_INVENTORY_RECORDS = 65_536` (`storage/key-value-repository.ts:8`) is already below six figures, and the domain has no secondary index, so every browse would be a full scan. |
| Per-photo project documents with a light index | One project row, one lock, and one revision chain per photo multiplies `projects`/`revisions` writes by the photo count and gives the Project Bin 100 000 entries; the lock model is one lease per project (`project-lock.js:3-5`). |
| One `.scape` entry per photo | `maximumEntryCount: 4_096` (`scape-archive-envelope.ts:19`) caps the archive two orders of magnitude below target; shards of 4 096 rows reach a million photos in 245 entries. |
| Routing catalog commands through `applyEditorCommand` | It is gated on the exact shared schema version (`commands.js:89-91`) and commits one whole project; V24 already shows the product-owned union with an inheritance path. |
| An npm EXIF/IPTC parser | Full licensing, notice, and tracked-version chain plus Pages bytes for a general parser, against a ~30-tag read model the repository's own bounded-reader precedents cover. |

## Phase structure

| Phase | Mode | Content |
| --- | --- | --- |
| L2.0 | Serialized (one work stream) | `RenderSampleProfileV1` and its admission; the persistence substrate, the three stores, the database version bump, the inverse-journal repository |
| L2A | Parallel track | `PhotoCatalogV1` schema family over the substrate |
| L2B | Parallel track (file-disjoint) | `DevelopStackV1`, the process-version registry, and its goldens |
| L2C | Parallel, may open at L2.0 | `PhotoMetadataReadV1`, its bounded reader, and the fuzz corpus |
| L2D | Serialized | `.scape` disposition, cross-product read, catalog-scale budget |

L2A and L2B must not begin until every L2.0 acceptance check passes; L2C shares
no file with any other phase and opens once the V30 image classification is on
`main`; L2D requires L2A and L2B.

## Work packets

Every L2 packet is decomposed here against the five fields; no slice doc is owed
at pickup, and any packet that grows one names it here first.

### WP-L2.0 — Render sample profile and admission

- **Outcome:** `render-sample-profile-v1.ts` (vocabulary, interfaces, normalize,
  serialize, per-format byte math) and `render-sample-admission-v1.ts` (admitted
  set as data, named refusal codes, `assertRenderSampleBufferAdmitted` with a
  defaulted admitted-set parameter); the existing interchange types
  (`video-mask-matte-rgba-v13.ts:9-13`,
  `unified-exact-render-visual-materializer-v13.ts:17`) re-expressed as
  `RenderSampleBufferV1` carrying an `unorm8` profile.
- **Invariants:** no sample-format, primaries, or transfer literal outside the
  vocabulary module and the admitted-set data; no consumer branches on the
  concrete typed-array class; widening the admitted set changes no type and no
  schema; every buffer crossing a module boundary carries a profile; a profile
  has no retention of its own, since nothing persists one outside its buffer.
- **Acceptance:** `npm test -- --shard=common` runs
  `tests/render-sample-profile-v1.test.ts` (normalize, serialize, parse round
  trip, closed-field refusal for all three formats, a future `schemaVersion`
  profile refused with its named code and never normalized) and
  `tests/render-sample-admission-v1.test.ts` (widened-set admission, default-set
  refusal with `sample-format-not-admitted`, source scan for stray literals); the
  Framescaper render goldens
  (`tests/fixtures/unified-exact-render-plan-goldens.ts`) stay byte-equal, and
  `npm run check:architecture` holds the 600-line ceiling.
- **Non-goals:** no 16-bit or float evaluation path, wide-gamut render, change to
  `assertManagedVideoColorRenderAdmissionV1`, or GPU work.
- **Stop condition:** stop if a consumer needs a per-format branch to compile —
  that means the buffer abstraction is wrong.

### WP-L2.1 — Catalog persistence substrate

- **Outcome:** the `photoCatalog`, `photoDevelop`, and `photoCatalogJournal`
  stores with their compound indexes created in `indexeddb-backend.ts` at
  `EDITOR_STORAGE_DATABASE_VERSION` 9; `storage/photo-catalog-repository.ts`,
  `photo-develop-repository.ts`, and `photo-catalog-journal-repository.ts`
  composed into `storage/repositories.ts` behind `StorageRepositoryPort`; a paged
  row reader over `readCursorPage`; the closed `PhotoCatalogCommandV1` union with
  per-handler inverse derivation, the 4 096-row bound, `transactionId` grouping,
  and 200-transaction / 32 MiB retention.
- **Invariants:** no path materializes more than one cursor page of rows; a
  command exceeding the row bound is refused, never truncated; a journal entry is
  written in the same transaction as the mutation it inverts or neither lands;
  undo restores the exact pre-image; no catalog command writes media; deletion is
  total — removing a catalog removes its rows, develop documents, and journal
  entries in one transaction, leaving no orphan keyed to it.
- **Acceptance:** `npm test -- --shard=common` runs
  `tests/photo-catalog-repository.test.ts` (keying, index coverage, page bounds,
  digest dedupe), `tests/photo-catalog-journal.test.ts` (inverse round trip per
  command kind, transaction grouping, both retention bounds, refusal above the
  row bound), `tests/photo-catalog-storage-schema.test.ts` (stores, indexes, keys
  at database version 9 plus the documented wipe-on-upgrade),
  `tests/photo-catalog-deletion.test.ts` (nothing outlives its catalog), and
  `tests/photo-catalog-interruption.test.ts`, aborting at each boundary.
- **Non-goals:** no import pipeline, derivative previews, UI, smart-collection
  evaluation, or relink.
- **Stop condition:** stop if any command's inverse cannot be derived from the
  rows it touches without reading the rest of the catalog.

### WP-L2A.0 — `PhotoCatalogV1` schema family

- **Outcome:** the eleven-module family under `src/lightscaper/` on the V24
  template — `editor-project-v31-validation.ts` owning
  `LIGHTSCAPER_PROJECT_V31_SCHEMA_VERSION` and the spine interface,
  `editor-project-v31.ts` (create/clone/load), `editor-project-v31-migration.ts`
  (refuse below 31), `editor-project-v31-commands.ts` (spine union with a
  V24-style inheritance path), `editor-project-v31-history.ts`, and the four V31
  profile modules with the runtime prerequisite; the schema number claimed in
  `project-schema-version.ts`; compatibility rows in
  `config/project-compatibility.json` and `docs/project-compatibility.md`. No
  capability key is added or flipped: L1 owns the seven photo keys and L2 ships
  schemas, not a claimed capability, so no new capability id is minted here
  (lightscaper-1-plan.md WP-L1.1, where every photo key but `photoSurface` stays
  `false` until its owning milestone).
- **Invariants:** validation is closed-field and rejects unknown keys
  (`closed-domain-value.ts:6-60`); the spine's bounded counts hold under every
  command; a document above schema 31 is returned read-only with reason
  `newer-schema` and never normalized; feature requirements reconcile to exactly
  the capabilities the spine uses; no spine field's size scales with photo count;
  every virtual-folder command mutates catalog state only — no folder command has
  a filesystem effect of any kind, and the command union carries no path field a
  desktop tier could later resolve (roadmap-lightscaper.md:95); deleting the
  project deletes the spine with it.
- **Acceptance:** `npm test -- --shard=lightscaper` runs
  `tests/lightscaper-project-v31-domain.test.ts` (create, validate, clone,
  serialize, every reject path, future-schema refusal),
  `tests/lightscaper-project-v31-commands.test.ts` (every discriminant, batch
  atomicity, inherited delegation, folder payloads carrying no absolute or
  relative path), `tests/lightscaper-project-v31-history.test.ts` (undo/redo,
  limit, cross-project entry refusal), and
  `tests/lightscaper-project-v31-feature-requirements.test.ts`;
  `npm test -- --shard=common` keeps
  `tests/production-capability-inventory.test.js` green with Lightscaper's
  capability block unchanged and pins the new
  `tests/project-compatibility-policy.test.js` rows; `npm run check:static`
  passes.
- **Non-goals:** no browse UI, import, develop state, or smart-collection
  *evaluation* — rules validate here and evaluate in L3.
- **Stop condition:** stop if any spine field's worst case grows with photo
  count — it belongs on the row instead.

### WP-L2B.0 — `DevelopStackV1` and the process-version registry

- **Outcome:** `src/common/editor/photo-develop-stack-v1.ts` — ordered
  `DevelopOperationInstanceV1` records whose `effectId` is admitted against the
  shared catalog (`video-effects.js:100`), a geometry record generalizing
  `VideoClipComposition`'s normalized crop and transform
  (`video-clip-composition.ts:87-94`), mask bindings referencing
  `VideoMaskMatteGraphV1` graphs, `virtualCopyOf`, and an explicit
  `processVersion`; `photo-process-version.ts` holding the registry and refusal
  codes; per-version goldens; the document's clone, serialize, validate, and
  migration behavior; `develop/set-stack` and its inverse; the clipboard
  disposition — a copied stack carries operations, geometry, mask bindings, and
  `processVersion` and drops instance identities, `virtualCopyOf`, and the photo
  reference, on the `video-visual-presentation-v27.ts:91-114` fresh-identity
  pattern.
- **Invariants:** an operation id absent from the shared effect catalog is
  refused, so a Lightscaper-only filter cannot enter the schema; a registered
  `processVersion` renders identically forever and its golden proves it, and an
  unregistered one is refused, never defaulted; no path rewrites a stack's
  `processVersion` implicitly — only a `develop/set-stack` command carrying both
  versions, journaled with its inverse, may change it, and preset application,
  sync, clipboard paste, `.scape` import, and cross-product handoff all preserve
  the recorded version; the stack records no sample format, primaries, or
  transfer, because the render profile is a per-buffer declaration supplied by
  the evaluator, so widening the admitted set in L7 reopens every existing stack
  unchanged; a virtual copy is a first-class version, never a mutation of its
  parent; removing every develop document leaves the original digest-stable.
- **Acceptance:** `npm test -- --shard=common` runs
  `tests/photo-develop-stack-v1.test.ts` (validate, clone, serialize, reject,
  unknown-effect refusal, virtual-copy independence, a copy carrying no instance
  identity that pastes onto another photo version without collision,
  `develop/set-stack` the only path that changes a recorded `processVersion`),
  `tests/photo-develop-stack-migration.test.ts` (below-baseline refused,
  future-version returned unmodified with reason `newer-schema`, matching
  `docs/project-compatibility.md:25-27`),
  `tests/photo-process-version-goldens.test.ts` (one golden per registry entry,
  re-derived from the fixture stack rather than copied),
  `tests/photo-develop-stack-generated.test.ts` (seeded generator,
  serialize→parse→serialize a fixed point), and
  `tests/photo-develop-state-removal.test.ts`, which deletes every `photoDevelop`
  row and version for a developed fixture photo, re-reads the original from the
  media repository, and asserts its SHA-256 equals the digest recorded at import
  with the catalog row still valid and holding no develop reference.
  `npm test -- --shard=framescaper` runs
  `tests/framescaper-photo-develop-stack-parity.test.ts`, which authors the
  stack's operation set onto a still clip and renders it, proving parity.
- **Non-goals:** no new operations (L4), mask node kinds (L6), presets, or render
  evaluation beyond the parity assertion.
- **Stop condition:** stop if an operation the stack needs cannot be expressed as
  a shared effect — it is added to the shared catalog in L4.

### WP-L2C.0 — `PhotoMetadataReadV1` and its fuzz corpus

- **Outcome:** `photo-metadata-container-scan.ts`, `photo-metadata-tiff-ifd.ts`,
  and `photo-metadata-read-v1.ts` with `PHOTO_METADATA_READ_LIMITS_V1` and a
  named refusal-code list; the closed tag allowlist covering capture time and
  offset, camera make/model, lens, exposure time, f-number, ISO, focal length,
  orientation, bounded-integer GPS, and the IPTC IIM
  title/description/creator/copyright/keyword set;
  `scripts/build-photo-metadata-corpus.mjs` generating the corpus from a pinned
  seed, its digest recorded in the test.
- **Invariants:** every offset plus length is bounds-checked against the scanned
  window before any read; no IFD is visited twice; the step budget is checked
  every iteration; an unrecognized tag is dropped and an unparseable known tag
  becomes a refusal record, never a fabricated value; no timezone is inferred
  that the file does not state; nothing in L2 writes metadata; a read record is
  derived state, recomputed from the original rather than retained as the source
  of truth, and deleted with the row it describes.
- **Acceptance:** `npm test -- --shard=common` runs
  `tests/photo-metadata-read-v1.test.ts` (per-tag decode against first-party
  synthesized JPEG and TIFF fixtures, both byte orders, every refusal code
  reached) and `tests/photo-metadata-read-fuzz.test.ts`, which regenerates the
  corpus from the pinned seed, asserts its digest, and requires every member to
  produce a validated record or throw a named refusal within the step budget — no
  unnamed error and no read outside the declared window, asserted through an
  instrumented byte source recording every read range. `npm run check:static`
  confirms no dependency was added.
- **Non-goals:** no XMP, metadata write, capture-time editing, panel, maker
  notes, or ICC profile parsing.
- **Stop condition:** stop if the read model needs a tag whose interpretation
  depends on a maker note — record it unsupported and refuse.

### WP-L2D.0 — `.scape` disposition, cross-product read, and budget

- **Outcome:** `src/lightscaper/editor-scape-native-v31.ts` on the
  `editor-scape-native-v24.ts:17-49` pattern; a `ScapeProjectAssetExtension`
  registering `photo-catalog-shard` and `photo-develop-shard` with shard
  planning, body validation, import staging, and rebound-project validation; the
  fixture `l2-synthetic-catalog-100k-v1` and the workload
  `l2-catalog-scale-structural-v1` registered in `config/quality-budgets.json`
  against `portable-node-structural-26.5.0` including its `eligibleWorkloadIds`
  row; the collector `scripts/collect-l2-catalog-structural-quality.mjs` on the
  `writeStructuralQualityBudgetEvidence` contract
  (`quality-budget-evidence.mjs:39`).
- **Invariants:** every shard is claimed by a manifest descriptor with its exact
  size and digest; export streams shards and never buffers the catalog; import is
  transactional, so an abort leaves no partial catalog; Framescaper's read
  mutates nothing and saves back byte-identically.
- **Acceptance:** `npm test -- --shard=lightscaper` runs
  `tests/lightscaper-scape-catalog-roundtrip.test.ts` (export→import→export
  JSON-semantic equality, shard digests, shard-count ceiling, abort at each
  boundary), and `npm test -- --shard=common` runs
  `tests/lightscaper-scape-framescaper-read.test.ts` (`newer-schema` read-only
  result, no shard dropped, feature report naming the unavailable capabilities,
  byte-identical save-a-copy), whose basename names two products and so
  classifies cross-product. `npm run quality:collect:l2-catalog-structural`
  produces evidence meeting `catalog.maximumProjectDocumentBytes lte 4194304`,
  `catalog.maximumResidentCatalogRows lte 4096`,
  `catalog.maximumJournalTransactionBytes lte 33554432`,
  `catalog.wholeCatalogClones eq 0`, and `catalog.maximumScapeEntryCount lte
  2048`, from a detached verification worktree at the candidate commit, because
  the collector refuses a dirty checkout
  (scripts/quality-budget-evidence.mjs:52-54) and a shared-tree run measures
  other sessions' work. `npm run audit:quality-results` passes with the ledger's
  qualified set and accepted cohorts unchanged — `l2-catalog-scale-structural-v1`
  registers `status: "provisional"` and enters no cohort, because
  `qualification.qualifiedWorkloadIds` is pinned to the five milestone-2 ids
  (tests/quality-budget-m2-resource-contract.test.ts:86-88) and promotion needs a
  reviewed no-retry cohort, which is not an L2 gate;
  `tests/quality-budget-l2-catalog-structural-collector.test.ts` derives every
  metric over the fixture and asserts each threshold read from
  `config/quality-budgets.json` rather than repeated as a literal.
- **Non-goals:** no merge-on-import (L3 Optional), relink, export presets, or
  develop rendering in Framescaper (L5).
- **Stop condition:** stop if a threshold can only be met by raising a `.scape`
  or publication limit — a schema needing them raised is the wrong schema.

## Quality-budget and evidence duties

- Fixture `l2-synthetic-catalog-100k-v1` is generated, not stored: pinned by seed
  with its digest recorded, following the M4 parity fixture
  (`tests/helpers/m4-production-parity-fixture.ts:47-49`), declaring 100 000 photo
  rows, 512 folders, 256 collections, 4 096 keywords, and one version each.
- Workload `l2-catalog-scale-structural-v1` runs on
  `portable-node-structural-26.5.0`, the only `qualificationEligible` environment
  (`config/quality-budgets.json:357-360`); registering it requires the
  environment's closed `eligibleWorkloadIds` list (`:362-368`), its scope
  paragraph (`docs/quality-budgets.md:170-182`), and the frozen-set assertion in
  `tests/quality-budget-m2-resource-contract.test.ts:117-136` to move in the same
  commit; that test deep-equals the whole descriptor, so a config-only edit reds
  the `common` shard.
- The workload registers `status: "provisional"` and enters no accepted cohort,
  so the ledger's cohorts keep covering the pinned qualified set exactly once
  (`scripts/audit-quality-result-cohorts.mjs:26-30`); promotion by a reviewed
  no-retry cohort (`docs/quality-budgets.md:86-99`) is a maintainer judgment,
  not an L2 gate.
- Every threshold is a first-party structural counter emitted by an instrumented
  production path, never derived from the fixture specification — the rule the
  three M2 structural collectors follow (`docs/quality-budgets.md:419-429`). No
  timing or memory threshold is claimed; those need provisioned hardware.
- Coverage is unchanged: `.c8rc.json:12-14` enforces 80/70/80 over the union of
  shards, and every new `src/common/editor/` module is inside its `include`
  globs. `npm run check:notices` and `audit:ci` pass with `package.json` and
  `package-lock.json` untouched — asserted evidence that L2 added no dependency.

## Coordination rules

- **Spine files, one owner per edit, rebase before push.**
  `src/common/editor/storage/indexeddb-backend.ts` — the version constant and
  every store creation — is the sharpest: one agent, one commit, with the schema
  test. Also spine: `storage/repositories.ts`, `storage.js`,
  `project-schema-version.ts` (the serialized schema-number namespace),
  `project-feature-requirements.ts`, `scape-archive-envelope.ts`,
  `scape-project-asset-extension.ts`, `config/production-capabilities.json`,
  `config/project-compatibility.json`, `config/quality-budgets.json`,
  `config/maintainability-allowlist.json`, `docs/project-compatibility.md`,
  `docs/quality-budgets.md`, `tests/quality-budget-m2-resource-contract.test.ts`.
- **L1-owned, not editable here:** `src/common/products.js`,
  `src/common/editor/project-feature-capabilities.ts` (the closed capability-key
  registry), `scripts/lib/node-test-shards.mjs`, `.dependency-cruiser.cjs`, the
  workflow matrices, the route and PWA surfaces; a packet needing one changed
  escalates to L1.
- **A test's shard follows its basename as well as its imports.** Once L1
  registers the product, a `tests/lightscaper-*.test.ts` basename alone
  classifies the file into the `lightscaper` shard and a basename naming two
  products classifies it back to `common`
  (`scripts/lib/node-test-shards.mjs:42-48`), so the acceptance command and the
  filename are chosen together: a test over a `src/common/editor/` module takes a
  neutral `photo-*`/`render-sample-*` name and runs under `--shard=common`.
- **Schema revisions stay serialized product-wide.** The V31 number claim, the
  database version bump, and the `.scape` asset-kind registration are three
  serialized events; at most one is in flight, and none overlaps V30 landing.
- **Never fork a shared module into `src/lightscaper/`.** `DevelopStackV1`, the
  render-sample modules, and the metadata reader live under `src/common/editor/`
  with Framescaper-side tests; only the V31 family and its `.scape` adapter are
  product-owned.
- **Shared fate on repo gates.** `npm run check` stays green on every push;
  because many sessions work this tree at once, staging names explicit paths and
  verification runs in a detached worktree at the exact commit — as does every
  quality collector, which refuses a dirty checkout outright
  (`scripts/quality-budget-evidence.mjs:52-54`).

## Known constraints this plan absorbs

- **The V30 dependency is real and partial.** `image-format-signature.ts` and
  `image-import-admission.ts` on `codex/milestone-8-images` classify raster
  families by bytes alone — `dng`, `cr2`, `cr3`, `nef`, `arw`, `raf`, `orf`,
  `rw2` among them — and bound metadata reads to 8 MiB per file. WP-L2C.0
  consumes those bounds and WP-L2A.0 references `FramescaperImageSourceV1`'s
  immutable-original-plus-digest shape; both wait for the branch to land on
  `main`, and WP-L2.0, WP-L2.1, and WP-L2B.0 do not.
- **WebKit cannot witness storage behavior.** The pinned Playwright WebKit build
  exposes no OPFS and no IndexedDB Blob storage (roadmap.md:271-274), so
  storage-dependent browser acceptance is Chromium and Firefox; L2 adds no
  surface, and its gates are Node gates by design.
- **`sampleFormat` is an overloaded word** already naming audio PCM formats
  (`project-media-validation.ts:72`, `desktop-codec-provider-catalog.ts:37`); the
  pixel meaning is disambiguated by type name, module, and refusal-code prefix,
  not by renaming the field the roadmap fixed. The 600-line ceiling binds too:
  V24's largest module is 347 lines, so the catalog family is more modules, not
  larger ones (`scripts/check-file-size.mjs:29-41`).

## Watch items (not gates yet)

- Whether L3's browse surfaces need an index L2 did not create — a new compound
  index is another database version bump, so L3's query shapes are worth reading
  before L2's stores freeze — and whether 4 096 rows is the right command split.
- Raw metadata layout: several raw containers are TIFF-structured, so the L2
  reader may already cover their EXIF IFDs, and whether `processVersion` carries
  a date or a monotonic integer settles once a second entry exists.

## Non-goals and fences

- No surface of any kind: no grid, loupe, metadata panel, import dialog, or menu
  entry. L2 is schemas and storage; L3 owns the library, and its entry points are
  menu-reached and off by default (AGENTS.md:8-11).
- No capture, tethering, or camera control; no destructive raster editing and no
  mutable raster layer — develop state is parametric and re-derivable; no
  ML-dependent field, flag, or schema slot, not even a reserved one.
- No patent-encumbered codec support; the format classification L2 consumes
  recognizes HEIF bytes without granting decode authority. No Adobe, XMP, or DNG
  compatibility claim and no metadata write path. No new third-party dependency:
  the licensing matrix, notices, and tracked version list stay untouched.
- No second export stack, archive format, or command protocol, and no second
  history model beyond the bounded inverse journal this plan justifies.
