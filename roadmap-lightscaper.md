# Lightscaper product roadmap

> Re-grounded against the repository on 2026-10-08. Lightscaper implementation has started: milestones below remain accepted scope, ordered by dependency, closing only when their exit gates pass. Nothing here is a release-date promise. The [main roadmap](roadmap.md) owns the shared platform, Soundscaper, and Framescaper; this file adds Lightscaper without changing any milestone, fence, or gate there.

Lightscaper is the third product over the shared local-first editor platform: a
photo library and non-destructive develop editor — broadly the shape of
Lightroom Classic — built independently for `lightscaper.org/<locale>/`,
following the implemented [separate-origin decision](docs/decisions/product-origins.md).
It reuses IndexedDB/OPFS storage primitives, project-lock contracts, and the
Scape container while owning a photo-catalog schema family and media library.
Product composition and domain code live in `src/lightscaper/`; photo
presentation lives in `src/common/editor/ui/lightscaper/`. Every operation that
changes pixels lives in `src/common/` where Framescaper can reach it too.

## How to use this roadmap

This file answers the same four questions as the main roadmap:

1. What milestone owns the work?
2. What user or platform outcome is still missing?
3. What must be true before the milestone closes?
4. What is explicitly outside the current scope?

It is not an implementation log or an evidence register. This roadmap itself
owns Lightscaper scope, status, dependencies, ordering, and exit gates. Keep
durable cross-cutting contracts in the subject-oriented
[engineering documentation](docs/README.md), and keep a change's implementation
sequence and temporary `path:line` inventory in its issue, pull request, or Git
history. Re-ground code references when work starts instead of preserving a
dated milestone plan.

Machine-readable claims stay in the policies the main roadmap already names:
capabilities in the
[capability inventory](config/production-capabilities.json), licensing in the
[production licensing policy](docs/policies/licensing.md), budgets in
the [quality budgets](docs/development/quality-diagnostics.md), and the owner release rule in the
[release policy](docs/operations/release.md).

### Agent operating rules

- The [main roadmap's agent operating rules](roadmap.md#agent-operating-rules)
  apply to Lightscaper work verbatim, as does its maintenance rule that each
  milestone item is decomposed into a bounded work packet before
  implementation.
- Every pixel-transforming operation is a shared effect: it lives under
  `src/common/`, registers in the shared catalogs, and is authorable and
  renderable from Framescaper with tests in both products in the same change.
  A Lightscaper-only image filter is a placement defect, not a product feature.
- Every exit gate is provable by CI or a deterministic script or test a
  maintainer runs locally. Human, visual, real-camera, and real-device checks
  belong in optional owner QA; they report only the environments actually
  tried and never certify a release or activate a capability.
- The persisted schema and the pixel interchange are bit-depth- and
  color-space-agnostic from their first version. Processing may ship 8-bit
  sRGB first, but the limit lives in an admission check, never in the types or
  the schema; widening depth later is a newly admitted profile, not a
  migration.
- Do not fork Framescaper or shared modules into `src/lightscaper/`. When a
  Framescaper-owned module needs generalizing, move it to `src/common/` in the
  same change with both products' tests.
- The implemented Framescaper
  [image-media contract](docs/features/framescaper-images.md) owns still ingest
  and timeline-image modeling. Lightscaper reuses that shared foundation rather
  than creating a parallel image model.

## Product boundaries and invariants

- Every main-roadmap boundary holds unchanged: local-first, account-free,
  offline after install; Scape as the lossless portable project format, which
  Lightscaper writes as `.liscape` while still opening `.sscape`, `.fscape`,
  and the legacy `.scape`;
  Pages asset and chunk ceilings; Electron hardening; accessibility,
  deterministic history, bounded working sets, interruption recovery, and
  migration safety as release requirements.
- Originals are immutable. Every Lightscaper edit is re-derivable develop
  state stored beside — never inside — the original; removing develop state
  yields the original, byte-identical.
- The develop preview and the exported photo are the same render. Apart from
  proxy evaluation — preview-resolution derivatives may stand in during
  editing while full resolution remains the render of record for zoom and
  export — and declared output-only steps — output color conversion,
  resizing, output sharpening, watermarking, and metadata shaping — exported
  pixels are identical to evaluated preview pixels, and a divergence is a
  defect even when each path is internally consistent.
- Develop stacks are versioned like project schemas: a stack authored under an
  old process version keeps rendering identically, and upgrading it to a newer
  process version is an explicit, recorded decision.
- A photo, its develop stack, and its collections round-trip through Scape;
  a developed photo opens in Framescaper as a still source with its
  shared-effect stack intact; and the reverse handoff holds. Browser handoff
  follows the separate-origin contract: it transfers an authenticated editable
  copy into the destination library and leaves the sender unchanged. Shared
  code does not grant access to another origin's media store.

The following are not completion requirements:

- cloud sync, accounts, publish services, hosted map tiles, or reverse
  geocoding;
- Adobe catalog, XMP develop-state, or DNG-writer compatibility claims —
  sidecar and archive schemas are Lightscaper's own, documented;
- print, book, slideshow, map, or web-gallery modules — a collection handed
  to Framescaper as a sequence is the slideshow path;
- moving or renaming the user's files on disk from catalog folder operations;
- parity with every Lightroom SKU or feature year; or
- a general raster paint editor.

## Deferred-capability fences

Through L1–L9:

- add no tethered-capture, camera-control, or other capture schema, adapter,
  permission, or UI: the main roadmap's milestone-8A capture fence applies to
  Lightscaper unchanged, and any future tethering starts as a new roadmap
  decision after milestone 8 closes;
- add no destructive raster editing: no brush-stroke painting into pixels, no
  tile-backed mutable raster layers, no per-stroke document model — parametric
  heal/clone that re-renders from the original is develop state and stays in
  scope;
- start ML-dependent capabilities — subject/sky/person masks, ML denoise,
  super-resolution, content-aware remove, face recognition, ML auto-settings —
  only under the main roadmap's milestone-7 local-assistance rules: optional,
  Electron Only with native-only inference per the user's 2026-08-11 re-tier
  of milestone 7, removable, with web surfaces reading accepted results only
  as ordinary project state, and never a completion dependency of any
  milestone here; and
- keep patent-encumbered codecs (HEIC/HEVC among them) excluded until they
  pass the licensing and patent review the main roadmap already requires.

## Status and platform notation

The [status and platform tables of the main roadmap](roadmap.md#status-and-platform-notation)
apply unchanged. Every item below is **Planned** unless marked otherwise; the
platform tier states the contract the item must meet when it lands.

## Current foundation

Lightscaper owns a registered product composition, a durable per-photo catalog,
managed-original storage, and menu-owned import, paged browse, metadata and
culling workflows. Opt-in thumbnails and a selected-photo loupe use disposable
previews; global search and sort use bounded indexed candidate pages. Menu-owned
develop and single-photo PNG/JPEG export workflows have landed; their milestones
remain in progress. File-menu archive handoff exports a saved editable photo and
receives it into the selected library with authenticated Original, LUT, and brush
bodies. Current single-photo handoff preserves repaired recipes through editable
Frame sources, native save/reopen/export, and reverse Photo3 publication.
The import dialog also selects an ordinary Frame still's timeline or Project Bin
placement explicitly. Manual collections, smart collections, and saved filters
download as editable Frame sequences in native query order. The remaining L5
export and cross-product qualification gates are open. Raw and desktop
capabilities remain disabled.

| Area | Current capability |
| --- | --- |
| Product seam | Three-product registry, separate-origin routes and independently built sites, per-product profiles/capabilities/PWA/i18n, registry-driven switching, and product-owned test shards. Lightscaper desktop wiring waits for L8. |
| Imaging engine | Shared parametric video effects, managed SDR color with linear-light grade math and `.cube` LUTs, mask graphs, visual presets, and keyframe curves. Wider primaries/transfers remain recognized by the schema and refused at render admission. |
| Stills | Framescaper V30 still import and timeline-image modeling landed; Lightscaper reuses shared image admission, native decode, EXIF orientation, and immutable original bindings. |
| Pixel interchange | A versioned descriptor admits sample formats, primaries, and transfer independently. Current processing admits `unorm8` sRGB; deeper buffers and wider processing wait for L7. |
| Library and storage | Separate catalog-root and photo rows, bounded summary/membership pages, per-photo commands and history, verified retained originals with digest dedupe and custody, managed-import recovery, and catalog Scape round trips. |
| Library queries and previews | Global filename/capture/rating indexes, resumable explicit index preparation, scalar paged definition selectors, and cancellable demand previews with disposable paired cache entries and one shared presenter owner. |
| Metadata | Bounded shared EXIF/IPTC readers, immutable extracted facts, authored metadata overrides, and Lightscaper's import adapter. |
| UI and platform | Shared design-system/dialog ownership, a product-owned photo shell, opt-in menu workflows, offline application shells, and the existing hardened Electron wrappers for Soundscaper and Framescaper. |
| Gates | Sharded Node suites including Lightscaper, browser workflows, coverage-union thresholds, architecture and file-size ceilings, licensing/notice/WASM audits, correctness checks, and existing packaged desktop smokes. Performance reports are diagnostics. |

Architectural constraints that still drive the sequence:

- current image processing admits only static 8-bit sRGB input; raw and deep
  color must widen admission and evaluation through the L2 contracts in L7;
- original custody and catalog persistence have separate owners and must
  reconcile interrupted publication before a library is exposed;
- catalog-scale browsing uses bounded indexed pages rather than whole-project
  history snapshots; remaining library view/filter/organization workflows and
  hosted validation of the measured synthetic budgets remain L3 work; and
- origins have separate storage: cross-product editing transfers an
  authenticated editable copy under the handoff contract.

## Milestone sequence

| Milestone | Status | Purpose |
| --- | --- | --- |
| L1. Product seam | **Done** | Register the third product with everything off. |
| L2. Catalog and develop contracts | **Done** | Fix the schemas and the depth-agnostic pixel contract before any surface. |
| L3. Photo library | **In progress** | Import, browse, cull, and organize at real-library scale. |
| L4. Develop: global adjustments | **In progress** | Deliver the parametric develop loop on shared effects. |
| L5. Export and handoff | **In progress** | Close the import → develop → export loop and the cross-product paths. |
| L6. Local adjustments and repair | **In progress** | Add masked adjustments and parametric healing. |
| L7. Raw and deep color | **Planned** | Activate deep processing, raw decode, and wide-gamut output. |
| L8. Desktop tier | **Planned** | Package the desktop product and add-in-place libraries. |
| L9. Owner QA and diagnostics | **Planned** | Exercise the coherent product, improve diagnostics, and record optional observations without a certification gate. |

L3 and L4 may proceed in parallel once L2 and L3's catalog-and-ingest core
land. Earlier milestones may ship independently. L9 rounds out owner QA and
debugging; it does not delay a release whose automated gates are green and
whose owner accepts the known issues.

## L1. Product registration and platform seam

**Depends on:** nothing outside the tree.

**Goal:** make the independently built Lightscaper `/<locale>/` route a real registered product whose
surfaces are deliberately empty, without changing Soundscaper or Framescaper
behavior.

L1 changes no milestone-2 closure scope: it adds no route, role, platform, or
fault class to the frozen closure inventory and requires no scope revision —
the third product is new-capability work the milestone-2 rule itself assigns
to later milestones, and this roadmap records the user's acceptance of that
scope.

- **Shared — Done:** a `src/lightscaper/product.js` profile (identity, base
  path, workspace, panels, import/export choices, shortcuts, capability map)
  registered in the product registry, with the new photo capability keys added
  as explicit booleans to all three profiles and the capability inventory.
- **Shared — Done:** retirement of every two-product assumption that "the
  other product" implies: product switching and handoff, route parsing,
  product bootstrap, sidebar links, and menu filters driven by the registry
  rather than by ternaries.
- **Web Core — Done:** static routes, PWA manifest, icons, offline
  application shell, and per-locale product copy for every supported locale,
  within the existing Pages and chunk ceilings.
- **Shared — Done:** a `lightscaper` Node-test shard, workflow matrix rows,
  architecture rules for `src/lightscaper/`, and a complete
  `config/production-capabilities.json` block whose evidence paths exist.
- **Electron Enhanced — Blocked until L8:** desktop identity, packaging, and
  per-product desktop wiring stay untouched in L1.

### Exit gate

- `npm run check:static` passes with the third product registered, and the
  Soundscaper and Framescaper suites pass unchanged.
- The route renders product-branded with an empty library in Chromium,
  Firefox, and WebKit browser workflows.
- The capability inventory test pins the Lightscaper claims. Registration
  enables only the photo surface; each later capability is activated with its
  own maintained workflow evidence.
- Product switching reaches all three products from each of them in a browser
  workflow.

## L2. Catalog and develop-state contracts

**Depends on:** L1 and the landed Framescaper V30 still-source model; L2
references that model and must not fork it.

**Goal:** fix the schemas everything else builds on — the catalog, the develop
stack, and the pixel interchange — before any surface exists.

- **Shared — Done:** a photo-catalog project family over the shared media
  library: photo references with content digests, virtual folders whose
  operations never write the filesystem, collections and rule-based smart
  collections, ratings, flags, color labels, hierarchical
  keywords, capture-time and file metadata, and virtual copies as first-class
  versions.
- **Shared — Done:** the catalog persistence decision — the unit of
  storage, revision, and history for six-figure photo counts under the
  snapshot-history constraint — recorded in the owning plan with its budgets
  before implementation.
- **Shared — Done:** develop state as an ordered stack of shared-effect
  instances plus geometry and mask bindings, per photo version, carrying an
  explicit process version; deterministic serialization, validation,
  migration, clone, undo/redo, clipboard, and Scape round trip like every
  schema family.
- **Shared — Done:** a depth- and gamut-agnostic frame contract: buffers
  declare sample format (`unorm8` now; `unorm16` and `float32` reserved),
  color primaries, and transfer; admission proves 8-bit sRGB is the only
  accepted profile today rather than the types assuming it.
- **Shared — Done:** an EXIF/IPTC read model (write stays in L5) with a
  bounded, fuzz-tested parser.

### Exit gate

- Property and golden tests cover the validate, migrate, clone, serialize, and
  reject paths of every new schema family, including future-schema refusal.
- A catalog document round-trips through Scape and opens read-correctly in
  Framescaper as project state.
- Admission tests prove the 8-bit-only limit lives in admission: widening the
  accepted profile set in a test build requires no schema or type change.
- Metadata parsing survives its fuzz corpus without a crash, hang, or
  over-read.

## L3. Photo library

**Depends on:** L2, and the V30 still work landed on `main`.

**Goal:** deliver the keyboard-first import → browse → cull → organize loop at
real-library scale.

- **Web Core — In progress:** import into the managed library: originals retained
  immutable with recorded digests, digest dedupe, bounded batches, per-file
  failure reporting, rename templates, apply-during-import of keywords and
  metadata presets (develop presets once L4 lands), and interruption recovery
  to a consistent catalog.
- **Web Core — Done:** derivative previews as disposable artifacts in tiers
  (thumbnail, fit-screen), built in cancellable background batches,
  regenerated on demand, and evictable under storage pressure.
- **Web Core — In progress:** grid, filmstrip, loupe, compare, and survey views;
  ratings, flags, and labels with auto-advance culling; stacks; sort orders;
  a filter bar over text, attributes, and metadata columns; and collections
  with live smart collections.
  Current culling captures bounded pre-edit successors across page boundaries
  and refreshes the destination through current catalog/query indexes, including
  saved filters and collapsed stacks. Existing page and interaction fences
  preserve durable edits when navigation is retired or refresh fails.
- **Web Core — In progress:** a metadata panel over the L2 read model,
  capture-time edit, batch rename, missing-media detection and relink through
  the existing relink path, and catalog snapshot/backup through Scape
  export.
- **Shared — Done:** a digest-pinned 20,000-photo synthetic fixture
  measures managed import, rendered-grid scrolling, keyword filtering, and
  distant search against recorded quality-diagnostics thresholds. All nine
  threshold checks passed locally in Chromium and Firefox and in
  [hosted Chromium CI](https://github.com/LeoWattenberg/Soundscaper/actions/runs/37763387640)
  at source revision `39cd7c9b707984425731c96de2a846f7985c0a22`, with one
  attempt and no retries. Repeated 2×2 media isolates catalog
  scaling; this baseline does not measure large-image decoding or
  representative camera working sets.
- **Shared — Optional:** merge-on-import of a catalog Scape archive into an open
  catalog.

### Exit gate

- Node and browser workflows cover the full loop keyboard-complete in every
  engine whose storage workflow is supported — Chromium and Firefox today;
  WebKit joins when a pinned Playwright build exposes the required
  OPFS/IndexedDB storage, per the milestone-2 scope-revision-2 deferral.
- The large-library fixture meets its recorded budgets in CI.
- Original immutability is proven by digest checks across the import, edit,
  relink, and eviction suites.
- Interrupting import or preview builds at any persistence boundary leaves a
  valid, recoverable catalog.

## L4. Develop: global adjustments

**Depends on:** L2; needs only L3's catalog-and-ingest core and may proceed in
parallel with the rest of L3.

**Goal:** deliver the parametric develop loop — open, adjust, compare, preset,
sync — entirely on shared effects.

- **Shared — In progress:** the Lightroom-vocabulary global set mapped onto shared
  effects, extending the existing catalog where an operation is missing:
  white balance; the tone ladder (exposure, contrast, highlights, shadows,
  whites, blacks); vibrance and saturation; texture, clarity, and dehaze;
  a parametric-plus-point tone curve with per-channel curves; an HSL mixer;
  black-and-white mix; color-grading wheels over the existing grade model;
  sharpening; noise reduction; post-crop vignette; grain; and LUT profiles
  over `.cube`. Every new operation is a shared effect authorable from
  Framescaper in the same change.
- **Web Core — In progress:** the develop workspace: a histogram with clipping
  indicators, before/after and split views, per-version history and named
  snapshots, copy/paste with a settings picker, sync and auto-sync across
  selections, relative quick-develop batch adjustments, and full and partial
  presets on the shared preset model.
- **Shared — In progress:** crop, straighten, rotate, flip, and aspect presets on
  shared geometry, plus manual perspective correction.
- **Web Core — Optional:** geometric auto-straighten and auto/guided upright;
  the ML fence applies only to ML-based implementations.
- **Web Core — In progress:** proxy develop: adjustments evaluated on
  preview-resolution derivatives with the full-resolution render reserved for
  zoom and export, within recorded latency budgets.

### Exit gate

- Every operation has golden frames proving determinism across runs and
  byte-equal preview and export renders apart from declared output-only
  steps.
- Every new shared effect is authorable and renderable in a Framescaper test
  in the same suite run.
- History, snapshots, sync, and presets pass property tests over generated
  stacks, including process-version stability goldens.
- Browser workflows complete the develop loop keyboard-first within recorded
  interaction budgets in every engine whose storage workflow is supported,
  under the same WebKit deferral as L3.

## L5. Export and cross-product handoff

**Depends on:** L4.

**Goal:** close the loop: finished photos leave in repeatable recipes, and
photo work moves between products without loss.

- **Web Core — In progress:** single and batch export: JPEG and PNG everywhere and
  TIFF where an encoder is proven; sizing by fit, long edge, megapixels, or
  percentage; resample quality; output sharpening; text and graphic
  watermarks; filename templates; metadata include/strip scopes; and export
  presets — bounded, abortable, progress-reporting, and background-queued
  like the other delivery paths. Menu-owned batch graphic watermarks now retain
  placement and file identity for explicit reselection during recovery, while
  preserving completed image and JSON acknowledgments; see the
  [batch graphic export contract](docs/architecture/lightscaper-batch-graphic-export.md).
- **Shared — In progress:** sidecar write: the current menu-owned PNG/JPEG and
  batch export dialogs offer default-off JSON containing the saved Develop
  recipe and metadata in Lightscaper's documented sidecar schema, with no
  Adobe-compatibility claim. Image and JSON acknowledgments remain separate,
  with JSON-only retry/recovery; the remaining L5 export-matrix qualification
  is separate.
  Genuine Current Photo3 exports now use Sidecar2, preserving ordered repairs
  and full saved provenance. Single and batch PNG/JPEG render repairs before
  crop/flip and adjustments; explicit JSON-only retry and reopened batch
  recovery retain native image acknowledgments. Current journal starts require
  the caller's positive native CAS acknowledgment before downloading, and
  unfinished hidden or replacement batches retain Develop exclusion until
  their renderer work joins. Legacy Photo1/2 readers and Sidecar1 bytes stay
  unchanged. Qualification includes 1,103 selected Lightscaper Node tests and
  14 English/German Chromium/Firefox workflows covering repaired pixels,
  metadata, sidecars, retry/recovery, and unchanged native Original custody.
- **Shared — Deferred:** output profiles beyond sRGB and Display P3 (custom
  ICC) until the platform color-management story proves them.
- **Shared — In progress:** handoff both ways: a developed photo opens in
  Framescaper as a still with its stack intact and renders pixel-identically;
  a Framescaper still opens in Lightscaper's develop; and a collection hands
  to Framescaper as a sequence. Menu-owned selected collection and saved-filter
  sequences retain active saved recipes, original and LUT resources, and native
  query order. Single-photo Current handoff preserves repaired stacks and
  authenticated brush resources through editable Source3 and reverse Photo3
  publication. Current collection and saved-filter sequences preserve truthful
  Photo/process provenance through editable Source2/3, selected LUT and brush
  declarations, and native query order. Complete retained resources are
  authenticated before Original acquisition; inactive histories stay in the
  sender. Full cross-product and export-matrix qualification remains open.
- **Shared — Optional:** ordering and per-photo duration presets for the
  handed-off sequence.

### Exit gate

- Golden exports pin pixels and metadata for every format, size, and scope
  combination in the matrix.
- Batch export is deterministic, abortable at any point without partial-file
  corruption, and resumable.
- A browser workflow proves the same develop stack renders pixel-identically
  in both products and survives the round trip re-editable.

## L6. Local adjustments and repair

**Depends on:** L4.

**Goal:** make adjustments spatial — where in the frame, not only how much —
on the shared mask graph.

- **Shared — In progress:** mask-bound adjustment instances applying any subset of
  the global operations through a mask; linear-gradient, radial-gradient, and
  luminance/color range mask nodes added as shared node kinds beside the
  existing vector, raster, alpha, feather, invert, and boolean nodes; and
  brush masks over the raster node.
- **Web Core — In progress:** mask management: list, rename, duplicate, overlay
  visualization modes, add/subtract/intersect composition, and keyboard
  reachability.
- **Shared — In progress:** parametric healing: clone and heal spots with
  repositionable sources, re-rendered from the original on every evaluation,
  with a visualize-spots view.
- **Shared — Optional:** red-eye correction.

Menu-authored linear and radial gradients and luminance/color ranges bind
existing adjustments through the shared renderer. Range membership samples the
actual input of the bound adjustment, and the temporary overlay observes coverage
through later geometry in the joined preview owner. Saved recipes retain their
masks through editable handoff; Frame authors and renders the same range nodes.
Brush masks have a bounded paint/erase replay kernel and immutable, authenticated
resource storage. Catalog writes verify bodies reachable through retained
versions, history, redo, snapshots, and disabled or unbound graphs in the
selected media namespace. The shared renderer now accepts an explicit authenticated
brush source, resamples linear alpha coverage at each adjustment's actual input,
and projects the exact blended coverage into its temporary overlay. The selected
Photo Session now lends its immutable brush bodies through its existing joined
operation lifetime. Its cached renderer shares that source across proxy,
full-resolution, and PNG/JPEG export, including restored catalog namespaces.
Photo Develop's Settings menu now opens an opt-in brush mask dialog. Its bounded
alpha grid supports pointer paint/erase, keyboard stamps, local undo/redo, and
authenticated re-editing of installed alpha or raster-alpha masks. The grid maps
to each bound adjustment's input; an explicitly selected overlay shows the result
through later geometry in After. Applying installs immutable bytes in the current
selected media owner before editing the still-current draft. Save records that
recipe through the existing Photo history and revision check. Existing graph
identities and unrelated masks survive re-editing; bindings can select multiple
existing adjustments and their enabled states.
Catalog backups now use archive schema 6 and photo pack 3 when any retained
Photo needs brush bodies; catalogs without brushes keep schema 5. The new
archive stores authenticated SCMASK01 bodies beside originals and LUTs, covering
inactive versions, history, redo, snapshots, disabled or unbound masks, and
unused declared inputs. Selected backup checks complete metadata and
authenticates bodies serially before reading originals or opening the selected
writable file, then verifies them again before destination Close. The scalar
closure budget does not impose a renderer-sized aggregate body limit.
Restore installs bodies in the freshly allocated media namespace and audits
the exact declared, delivered, reachable, and stored inventories before and
after promotion and at the final native publication ACK. Reader and decoder
cleanup join before the existing one-pointer catalog selection. Original bytes,
permanent custody, recipes, and brush identities survive restore and reopen.
Focused Lightscaper tests and English/German native Chromium and Firefox
workflows cover catalog backup, allocated restore, two reopens, and selected
proxy/full rendering. The native File System Access backup witness is qualified
in Chromium and remains skipped in Firefox, where that capability is absent.
Archives 1–5 remain readable; direct schema 5 and pack 2 paths still refuse
brush references before consuming their originals and join provisional rollback.
Editable Frame handoff retains its brush refusal guards. Current preset
transport is covered by the explicit archive 7 route described below.
Develop's Settings menu now opens an opt-in general mask manager, listing all
retained graphs, including composed mattes and disabled or unbound brush masks.
Duplicate creates a fresh graph identity while preserving every node, input,
output, and immutable source reference; the copy starts unbound. Remove prunes
only that graph's bindings and supports removing the final graph. Binding
checkboxes can transfer multiple existing adjustments from other graphs without
changing their enabled states, order, or parameters. Changes stay local until
Apply edits the current draft; Save uses the existing revision check and history.
These management commands do not acquire, install, or delete brush bodies.
An explicit bound adjustment selects the temporary overlay, which starts off.
English/German native Chromium and Firefox workflows cover keyboard duplication,
binding, removal, history restoration, reload, full preview, and PNG export,
checking independent pixels and unchanged originals and immutable brush bodies.
Focused mounted tests also fence retained actions after local edits, Close,
owner replacement, same-event draft replacement, and React effect replay.
The opt-in mask manager now supports an explicit Rename action. Typing remains
local and does not rename until that action; Apply edits the draft and Save
records the existing history. Named options show the label and stable graph ID.
Duplicates inherit the label and start unbound; a blank rename clears only the
name. Named graphs use schema 2 inside Develop process 2; an explicit rename of
a process 1 recipe promotes it, while loading an unnamed recipe never upgrades
it. Legacy graph and Develop readers remain strict. Names participate in recipe
digests and survive history, snapshots, virtual copies, settings/preset 2,
names-only archive 5, brush archive 6, and editable Frame Source 2 handoff.
Rendering validates the name and evaluates the same graph through a computational
view, preserving pixels, alpha, binding IDs, and immutable brush references.
Gradient, range, and brush re-editing preserve retained names.
The same opt-in manager now authors Add, Subtract, and Intersect compositions.
The selected graph keeps its name, ID, and bindings; it copies the other graph's
complete definition with collision-safe node, input, and path identities, while
the other mask remains available. Subtraction is selected minus other coverage.
Composition remains local until Apply and the existing Save records it in history.
Copied range nodes sample the input of the selected mask's bound adjustment;
brush references retain their immutable body identity and archive custody.
The manager also offers Color overlay and Grayscale mask views after explicitly
enabling the overlay and choosing a bound adjustment. Grayscale maps the actual
projected coverage to opaque display intensity; color retains the existing red
overlay. Both use the selected adjustment's input and the real geometry suffix.
The choice is temporary, resets when reopening the manager, and changes neither
the saved recipe nor After pixels, histograms, or exported output. Presentation
keeps it separate from the renderer's strict mask/effect IDs and wipes its
borrowed display plane before retirement completes.
An internal repair foundation now defines ordered Clone and Heal spots in
original coordinates, including movable sources, radius, feather, and opacity.
Clone samples premultiplied linear-sRGB donors; Heal reconstructs source
gradients against original target boundaries with a bounded screened-Poisson
profile. Every donor and boundary reads one immutable captured frame, while
overlapping spots blend destinations in authored order. The shared byte kernel
preflights complete work and memory bounds before reading pixels, joins native
cancellation and consumers, and retires its owned frames and serial patch scratch.
This explicit pixel-frame API does not establish original provenance or admit
repairs into existing process 1/2 recipes. A strict process 3 recipe now retains
the ordered repair definitions alongside existing effects, geometry, masks, and
bindings. Only an explicit repair edit promotes an older recipe; removing the
last spot keeps process 3. The new shared current renderer accepts process 1/2/3
and runs repairs before legacy geometry and every adjustment. It copies one
staged frame, awaits repair snapshot/output/scratch retirement, then adopts that
frame before borrowing brush bodies. Range masks sample the repaired input of
each adjustment; existing strict process 1/2 readers still refuse repairs.
Focused Lightscaper goldens cover Clone/Heal, moved sources, crop/flip/exposure,
range/LUT ordering, authentic brush declarations, and joined native retirement.
Strict Photo3 and workspace3 documents now retain repairs throughout versions,
redo history, and snapshots. Explicit current owners share the bounded history,
command, and catalog transaction logic with permanently strict legacy readers.
Whole-photo undo/redo keeps monotonic revisions and the highest retained aggregate
version, and virtual copies retain repaired settings without a new original.
The current catalog checks the complete retained LUT and brush closure before
saving; its database, memberships, and scalar query profiles stay unchanged.
Focused Lightscaper tests cover persistence/reopen, revision conflicts, atomic
rollback, borrowed verification, cancellation, and save acknowledgement. These
instrumented IndexedDB tests do not establish native browser qualification.
Explicit Current Session and Develop3 entry points now retain complete repaired
documents through the selected default or restored library. Startup recovery
verifies the retained LUT and brush closure before promoting original custody;
metadata and membership receipts preserve repaired state. The Current original
reader authenticates immutable bytes and revisions through the existing owner,
and the Photo renderer evaluates repairs before adjustments in both resolution
profiles. Selected Lightscaper now uses genuine Current documents throughout
the menu-owned Develop workflow. Settings opens Repair spots for ordered Clone
and Heal authoring, with numeric edits and target/source pointer movement on
the authenticated Original. Visualize spots starts off and displays actual
linear-light Original edges without changing the recipe. Existing effect,
geometry, and local-mask edits preserve repairs. Apply changes the draft;
Save uses the existing native revision check and history, and virtual copies
retain repairs without another original.
Qualification includes 1,012 passing selected Lightscaper Node tests and
English/German Chromium and Firefox workflows for Clone/Heal, Original-edge
visualization, pointer movement/cancellation, Save, history, virtual copies,
and reopen. These browser checks assert repaired preview/full-resolution
pixels and unchanged native Original bytes, hash, and custody.
Current single and batch PNG/JPEG exports now retain repaired recipes and use
Sidecar2 for Photo3, including a restored legacy active recipe. Current saved
facts and the complete Original/LUT/brush closure are checked before durable
delivery; JSON retry and reopened recovery avoid another image render or
download. English/German Chromium and Firefox checks verify literal PNG and
independently decoded JPEG pixels after Clone/Heal, crop/flip, and exposure,
along with immutable Original bytes and native custody.
Current Settings now supports repaired recipes in Copy/Paste, full and partial
Sync, acknowledged Auto-sync, and relative Quick Develop. Copy retains the
unsaved draft; the selected native source authenticates its full retained and
draft resource closure before publishing a packet. Local selection includes
the complete bound-adjustment and mask group, including unused declarations.
Brush packets keep their exact authenticated identity within the selected
Session; raw, cloned, foreign-Session, and unsupported external references
cannot grant paste authority. Target saves independently authenticate their
complete resource closure, and Originals remain unchanged. Legacy packets
retain their grouping and leave target repairs intact; clearing repairs keeps
process 3. Current settings and whole-recipe clipboard values have explicit
schema 3 owners while the legacy readers remain strict.
Current settings writes retire the active preview and keep queued old-revision
presentations suspended through the native acknowledgments and document reload.
English/German Chromium and Firefox workflows verify unsaved Heal/brush Copy,
partial Sync/Auto-sync, and relative Quick Develop with literal preview/export
pixels and the complete native Original/brush custody checks.
Current presets now save unsaved repaired recipes through the Settings menu,
with explicit Preset3 and mixed Row3 formats at the existing physical settings
key. Reads preserve legacy rows; removing the final Preset3 keeps Row3. Each
write authenticates the entire retained LUT/brush closure before native CAS.
Rename preserves the complete settings and their authored digest. Application
uses an actual selected native preset ID and row revision, authenticates the
whole row, and rechecks it before each target write. Stored brush settings and
JSON clones cannot acquire clipboard authority through a preset. Originals
remain unchanged, and current preview retirement also fences preset application.
English/German Chromium and Firefox workflows exercise dirty Heal/brush/LUT
preset save, reopen, rename, application, history restoration, and sticky delete.
Two actual native settings owners also compete for the same row: one receives
a positive CAS acknowledgment and the other a conflict. Repair-only presets
retain the target's geometry and local brush, with literal preview/PNG pixels
and complete native Original, LUT, and brush custody checks.
Current catalog backup and restore now carry complete repaired Photos and
presets through explicit archive 7, photo pack 4, and preset pack 3 owners.
The mixed preset row preserves its presence, revision, complete settings,
authored digests, and sticky schema 3 after the final repaired preset is removed.
All retained history, redo, snapshots, disabled adjustments, and unused declared
LUT and brush inputs participate in the combined resource closure. Backup
checks complete metadata and actual packed-entry capacity before acquiring
resource bodies, reading Originals, or opening the destination. It authenticates
bodies serially and checks the final native metadata fences before Close.
Restore installs the unchanged Original bytes in a freshly allocated native
media namespace and audits complete photo, preset, LUT, and brush inventories
before and after promotion and at the final publication acknowledgment.
Reader and decoder cleanup join before the existing one-pointer publication.
A known positive native acknowledgment survives late cancellation; corruption
and rejected publication keep the previous selected library. Wholly legacy
backups retain their schema 5 or 6 bytes, and archive readers 1–6 remain strict.
The selected Lightscaper Node regression run passes 1,998 cases in 237 files.
Eight English/German native workflows pass in each of Chromium and Firefox,
covering complete repair history, preset-only resources, two reopen cycles,
actual preset application, late cancellation, and corruption rollback. Their
independent observations check complete metadata, native Original chunk bytes,
LUT and brush custody, and literal preview/PNG pixels.
Menu-owned Current photo handoff now carries repaired recipes into editable
Frame Source3 with explicit provenance2. Ordered Clone/Heal spots, mask names,
geometry, disabled LUTs, and unused brush declarations remain intact. Complete
LUT and SCMASK bodies are authenticated alongside the unchanged Original. Frame
save, reopen, and project export preserve these bindings; Current receive
publishes a fresh Photo3 and may reuse its authenticated Original. Source
provenance retains the actual Photo and process versions, while wholly legacy
handoffs retain Source2 behavior and permanent strict readers. Native Frame save
audits actual resource bodies and checks their content tokens inside the existing
project transaction before publication acknowledgment.
The selected Lightscaper Node regression run passes 2,388 cases in 271 files;
73 focused owning cases cover the final Current contracts and native lifetime,
edit, save, reopen, archive, and render paths. Eight English/German Chromium and
Firefox workflows verify actual Frame menu import, source rename, native
save/reopen/export, reverse Photo3 publication, literal preview/PNG pixels,
unchanged Originals, complete resource custody, and corruption refusal. Both
product builds pass with the existing startup and chunk ceilings; Frame startup
uses 100 requests and Lightscaper uses 51.
Current collection and saved-filter handoff now uses a named Current Session
child and explicit View2, preserving complete selected declarations, including
disabled LUTs and unused brushes. The entire retained Photo namespace and
resource ledger are admitted before body authentication or Original acquisition.
Source3 provenance retains a full Photo3 even when its selected process is
legacy; Photo2 brush recipes remain Photo2, and wholly legacy recipes keep
Source2. Each generated source pack counts its Original independently, with
mandatory pack-prefix and resource limits checked before scoped Original reads
or decode, followed by exact generated-pack and ZIP bounds. The selected
Lightscaper Node regression passes 2,442 cases in 280 files, including actual
native Frame import, command edit, CAS save, reopen, export, literal recipe
pixels, resource custody, and joined decode/brush cancellation. Eight
English/German Chromium and Firefox sequence workflows pass through actual
collection and saved-filter export, Frame menu import, edit, native save,
reopen, and project export, with unchanged sender custody. Native OPFS reads
serialize per path through snapshot acquisition to prevent Firefox access
contention; cancellation, other paths, and writer dispatch remain independent.
The existing File-menu import options now apply retained Current repair presets
through a named Session child and the existing managed-import writer. Complete
preset-row declarations and LUT/brush bodies are authenticated before Original
preparation; every unpublished target rechecks the native row. Full presets
retain geometry and local resources, while repair-only presets preserve other
target settings. Original bytes, paths, and content tokens remain unchanged;
deduplicated imports add their own permanent Original roots. Failed files keep
their input positions, and acknowledged imports survive later refusal or
cancellation. The inherited V2 preset import remains strict. The selected
Lightscaper regression passes 2,472 cases in 284 files. Eight English/German
Chromium and Firefox workflows verify actual menu import, per-file results,
complete native custody, literal preview/PNG pixels, and reopen for both full
and repair-only presets. Both product builds retain the startup and chunk
ceilings.
Direct Frame repair and mask-name authoring remain open. Remaining
L3–L6 exit gates still require completion; L7–L9 remain incomplete. Final
inter-slice qualification follows completion of the implementation milestones.

### Exit gate

- New mask node kinds pass property tests and goldens and are authorable from
  Framescaper in the same suite run.
- Preview/export goldens extend over masked stacks and healing, including
  mask-graph edge cases: empty, inverted, boolean-composed, and out-of-bounds
  sources.
- Browser workflows author, compose, and toggle masks keyboard-first with the
  overlay asserted visible.

## L7. Raw and deep color

**Depends on:** L2's contract, L4, and L5.

**Goal:** make raw photography first-class: deeper-than-8-bit working pixels,
raw decode, and wide-gamut output, all through the contracts L2 fixed —
export widens through the existing L5 paths without new milestone scope
there.

- **Shared — Planned:** `unorm16` and `float32` admitted through the L2
  contract with a linear working space for the develop stack; goldens
  re-pinned at depth; the 8-bit path remains the conformance baseline within
  declared tolerances; no schema change occurs, by design.
- **Web Core — Planned:** raw decode through a licensed WASM decoder
  (candidate: LibRaw, subject to the licensing review) as a pinned runtime
  asset outside the Pages bundle on the FFmpeg-runtime pattern — pinned
  hashes, corresponding-source archive, notices — with demosaic, neutral
  camera baseline rendering, highlight recovery, and an embedded-preview fast
  path for culling before full decode.
- **Web Enhanced — Planned:** GPU evaluation of the develop stack where
  capability-detected, with the CPU path as the conformance oracle under
  recorded tolerance budgets.
- **Electron Enhanced — Planned:** native raw decode and preview services
  through the milestone-5 helper architecture, fail-closed, with the WASM
  path as fallback.
- **Shared — Planned:** manual lens corrections (distortion, chromatic
  aberration, defringe, vignette) as shared effects.
- **Shared — Blocked on licensing:** profile-based lens corrections until a
  lens-profile database passes the licensing review.
- **Shared — Blocked on licensing:** camera-matching color profiles until a
  camera-profile source passes the licensing review; L7 ships neutral camera
  baseline rendering meanwhile.
- **Shared — Planned:** wide-gamut output (Display P3) where the platform
  proves it, and soft proofing against the export profile.
- **Shared — Planned:** HDR exposure merge to a floating-point working image
  with alignment and deghosting.
- **Shared — Deferred:** panorama stitching.
- **Shared — Optional:** DNG output.

### Exit gate

- A pinned raw fixture corpus — synthetic plus freely licensed real files,
  digest-pinned and provisioned like the interchange references — decodes
  deterministically to goldens in CI.
- The depth-agnosticism proof holds: the same stack at 8-bit and float
  matches within declared tolerances, exactly where declared exact, with no
  schema migration in the diff.
- GPU and CPU renders match within recorded tolerance budgets in every CI
  environment where the capability is detected, with the Chromium
  software-GPU path pinned as the CI-provable baseline.
- Licensing, notice, and runtime-asset audits pass with the new decoder.
  Camera-model breadth is an L9 row, not an L7 claim.

## L8. Desktop tier

**Depends on:** L1 and L3; L7 for the native decode services it packages.

**Goal:** package the desktop product and add the library conveniences only
the desktop can offer.

- **Electron Enhanced — Planned:** the Lightscaper desktop package through the
  existing hardened wrapper and per-product packaging seam: app identity,
  entitlements, associations, project-library integration, and release and
  nightly matrix rows.
- **Electron Only — Planned:** add-in-place libraries over capability-scoped
  folder access: originals stay in the user's folders, are watched for
  external rename and move with relink assistance, and are never read or
  written outside the granted scopes. When a granted volume is disconnected,
  develop continues on the preview-resolution derivatives and full-resolution
  render refuses visibly until relink.
- **Electron Enhanced — Planned:** the L7 native raw and preview services
  packaged, audited, and fail-closed with the Web Core path as fallback.

### Exit gate

- Packaged smoke covers install, open, import-in-place, relink, develop,
  export, and reopen on the existing desktop target matrix in CI.
- Watched-folder and scope tests prove no read or write outside granted
  scopes, and revocation reaches a defined recoverable state.
- Disabling every native service leaves a complete, working Web Core product
  in the packaged app.

## L9. Owner QA and diagnostics

**Depends on:** L1–L8 closed. Deferred and Optional items are excluded,
and Blocked items stay excluded while their named blockers remain.

**Goal:** exercise Lightscaper as a coherent product and make failures easier
to diagnose. Human and real-device observations are optional owner QA, not
acceptance evidence, and this milestone adds no product capability.

- **Shared — Planned:** exercise representative real-camera raw files and
  record only the camera models, converters, and environments actually tried.
- **Web Core — Planned:** current and previous Chromium, Firefox, and Safari
  on real devices, including color management on actual wide-gamut displays.
- **Shared — Planned:** accessibility review with assistive technology across
  library culling and develop, at supported zoom, contrast, locale, and
  direction.
- **Shared — Planned:** add a real-library debug soak over import, browse,
  search, develop, and export, with truthful memory/timing diagnostics and
  explicit unavailable measurements.
- **Electron Enhanced — Planned:** optionally exercise packaged install,
  upgrade, rollback, uninstall, and catalog preservation on environments the
  owner has available.
- **Web Enhanced — Planned:** GPU/CPU render-parity breadth on real GPUs
  across vendors and the real-device browser matrix, beyond the CI-detected
  environments L7 pinned.
- **Shared — Planned:** automated licensing, provenance, notice, and
  corresponding-source checks for the raw decoder, any lens-profile data, and
  every new runtime asset, recording an explicit license selection for every
  dual-licensed input per the licensing policy.

### Exit gate

- Ordinary static, Node, browser, package, notice, source, hash, and smoke
  checks pass on the revision being considered.
- No known data-loss, security, or primary-workflow failure remains.
- Representative cross-product handoff stays covered by automated tests;
  optional owner QA may add observations without becoming a gate.
- The owner decides whether and when to push the release tag.

## Interface and schema commitments

- Every main-roadmap interface and schema commitment applies to Lightscaper
  work unchanged.
- The frame contract declares sample format, primaries, and transfer per
  buffer; consumers refuse undeclared profiles instead of assuming them.
- Develop stacks carry an explicit process version; renderers keep old
  process versions rendering identically rather than migrating them silently.
- The sidecar schema is Lightscaper-owned, documented, and versioned; its
  presence implies no Adobe-compatibility behavior.
- Every schema addition defines validation, migration, future-version
  behavior, clone/serialization, commands/history, Scape disposition, and
  retention/deletion behavior.

## Acceptance matrix

| Scenario | Required evidence |
| --- | --- |
| Original safety | Digest-stable originals across import, develop, relink, eviction, and export; develop state removable with byte-identical restoration. |
| Develop determinism | Same stack, same pixels: goldens across runs, preview versus export, 8-bit versus deep paths within declared tolerances, and process-version stability. |
| Cross-product handoff | A developed photo renders pixel-identically as a Framescaper still and returns re-editable; explicit locks; no silent conversion. |
| Catalog scale | Recorded import/scroll/filter/search budgets over the pinned large-library fixture; bounded memory over soak. |
| Interrupted mutation | Abort, kill, or reload at import, preview-build, develop, and export boundaries leaves a valid recoverable catalog. |
| Shared-effect parity | Every Lightscaper operation authorable and renderable from Framescaper in the same suite run. |
| Distribution | Browser and desktop workflows, licenses, notices, SHA-256 sums, digest-pinned runtime/catalog payloads, and unsigned package smoke. |

## Platform feasibility references

Revalidate platform assumptions when the owning milestone starts:

- [ImageDecoder (WebCodecs)](https://developer.mozilla.org/en-US/docs/Web/API/ImageDecoder)
- [Origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
- [WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
- [Canvas wide-gamut color spaces](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext)
- [File System Access](https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker)
- [WebAssembly feature support](https://webassembly.org/features/)

## Maintaining this roadmap

- Keep it forward-looking; evidence lives in owning policies, and this file
  changes only when scope, priority, status, dependency, or an exit gate
  changes.
- Preserve heading anchors once machine-readable policies cite them, and
  extend the anchor verification in `tests/roadmap-guidance.test.js` — which
  today verifies only `roadmap.md` anchors — in the same change that adds the
  first such citation.
- A status becomes **Implemented** only with maintained behavior and its
  automated gate. Moving a human judgment into an implementation gate is a
  scope error; record the observation in optional owner QA instead.
- Before implementation, decompose the selected outcome into bounded changes
  with explicit invariants, acceptance, non-goals, and stop conditions. Add or
  amend a subject-oriented engineering document only when the result creates a
  durable contract that future maintainers need.
- Promote a platform tier only when the supported matrix proves the stronger
  contract.
