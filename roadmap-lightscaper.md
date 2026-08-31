# Lightscaper product roadmap

> Grounded against the repository on 2026-08-25. Lightscaper does not exist in the tree yet: every milestone below is accepted future scope, ordered by dependency, closing only when its exit gate passes. Nothing here is a release-date promise. The [main roadmap](roadmap.md) owns the shared platform and the two existing products; this file adds Lightscaper without changing any milestone, fence, or gate there.

Lightscaper is the third product over the shared local-first editor platform: a
photo library and non-destructive develop editor — broadly the shape of
Lightroom Classic — served at `/lightscaper/<locale>/` from the same origin,
IndexedDB/OPFS media library, project locks, and Scape project format as
Soundscaper and Framescaper. Product-unique code lives in `src/lightscaper/`;
every operation that changes pixels lives in `src/common/` where Framescaper
can reach it too.

## How to use this roadmap

This file answers the same four questions as the main roadmap:

1. What milestone owns the work?
2. What user or platform outcome is still missing?
3. What must be true before the milestone closes?
4. What is explicitly outside the current scope?

It is not an implementation log or an evidence register. Sequencing decisions,
invariants, decision records, and bounded work packets belong to the owning
plan document for each milestone, which carries the `path:line` evidence this
file deliberately omits:

- L1 product seam: [L1 plan](docs/lightscaper-1-plan.md);
- L2 catalog and develop contracts: [L2 plan](docs/lightscaper-2-plan.md);
- L3 photo library: [L3 plan](docs/lightscaper-3-plan.md);
- L4 develop, global adjustments: [L4 plan](docs/lightscaper-4-plan.md);
- L5 export and handoff: [L5 plan](docs/lightscaper-5-plan.md);
- L6 local adjustments and repair: [L6 plan](docs/lightscaper-6-plan.md);
- L7 raw and deep color: [L7 plan](docs/lightscaper-7-plan.md);
- L8 desktop tier: [L8 plan](docs/lightscaper-8-plan.md); and
- L9 owner QA and diagnostics: [historical L9 plan](docs/lightscaper-9-plan.md).

Each plan is grounded at the commit named in its own header; re-ground its
citations at pickup. Machine-readable claims stay in the
policies the main roadmap already names: capabilities in the
[capability inventory](config/production-capabilities.json), licensing in the
[production licensing policy](docs/production-licensing-policy.md), budgets in
the [quality budgets](docs/quality-budgets.md), and the owner release rule in the
[release policy](docs/release-policy.md).

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
- The Framescaper V30 still-image campaign in flight on
  `codex/milestone-8-images` owns still ingest and timeline-image modeling.
  Lightscaper milestones that need it depend on it landing on `main`; do not
  duplicate, preempt, or rebase-fork that work.

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
  shared-effect stack intact, without copying media; and the reverse handoff
  holds.

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

Nothing exists under `src/lightscaper/`. What Lightscaper builds on:

| Area | Current capability |
| --- | --- |
| Product seam | Two-product registry with per-product profiles, capabilities, routes, workspaces, and desktop blocks; binary "other product" handoff; per-product PWA manifests, icons, i18n copy, CI shards, and desktop packaging. |
| Imaging engine | Twelve shared parametric video effects; managed SDR color that renders sRGB/BT.709 sources with linear-light grade math and `.cube` LUT parse/sample, while declared Display-P3/BT.2020 primaries and PQ/HLG transfers are recognized in the schema but refused fail-closed at render admission; a mask graph with vector-shape, vector-path, raster, alpha, feather, invert, and boolean nodes; visual presets; keyframe curves. |
| Stills | Still source/clip schema, browser `image/*` still import, PNG encode, and native (desktop) PNG/TIFF/EXR sequence decode behind an 8-bit sRGB, no-alpha admission; the Framescaper V30 "Add Images" campaign is in flight on a separate branch. |
| Pixel interchange | 8-bit straight RGBA end to end; color math is floating-point per sample, but no 16-bit or float interchange buffer exists. |
| Library and storage | OPFS/IndexedDB media library, id-keyed with recorded SHA-256 content digests, with retained originals and disposable derivatives, capacity preflight, single-writer project locks, Project Bin, Scape archive, and revisioned JSON commands with snapshot undo/redo. |
| UI and platform | Vendored Audacity design system, product-profile-driven workspace/menu/dialog shells, i18n catalogs, offline application shell, and the hardened Electron wrapper. |
| Gates | Sharded Node suite, browser workflows, coverage-union thresholds, architecture and file-size ceilings, licensing/notice/WASM audits, correctness checks, and packaged desktop smokes. Performance reports are diagnostics. |

Known architectural constraints that drive the sequence:

- the pixel path is 8-bit sRGB and the image admission refuses deeper input,
  so raw and wide-gamut work is gated on the L2 interchange contract;
- no EXIF, IPTC, or XMP reader exists anywhere in the tree;
- shared history snapshots whole projects, so a six-figure-photo catalog
  cannot be one project document without the persistence decision L2 owns;
- the product registry, routes, shards, PWA shell, i18n copy, desktop configs,
  and several scripts hardcode exactly two products; and
- catalog-scale browsing has no precedent in the current library UI or its
  recorded budgets.

## Milestone sequence

| Milestone | Status | Purpose |
| --- | --- | --- |
| L1. Product seam | **Planned** | Register the third product with everything off. |
| L2. Catalog and develop contracts | **Planned** | Fix the schemas and the depth-agnostic pixel contract before any surface. |
| L3. Photo library | **Planned** | Import, browse, cull, and organize at real-library scale. |
| L4. Develop: global adjustments | **Planned** | Deliver the parametric develop loop on shared effects. |
| L5. Export and handoff | **Planned** | Close the import → develop → export loop and the cross-product paths. |
| L6. Local adjustments and repair | **Planned** | Add masked adjustments and parametric healing. |
| L7. Raw and deep color | **Planned** | Activate deep processing, raw decode, and wide-gamut output. |
| L8. Desktop tier | **Planned** | Package the desktop product and add-in-place libraries. |
| L9. Owner QA and diagnostics | **Planned** | Exercise the coherent product, improve diagnostics, and record optional observations without a certification gate. |

L3 and L4 may proceed in parallel once L2 and L3's catalog-and-ingest core
land. Earlier milestones may ship independently. L9 rounds out owner QA and
debugging; it does not delay a release whose automated gates are green and
whose owner accepts the known issues.

## L1. Product registration and platform seam

**Depends on:** nothing outside the tree.

**Goal:** make `/lightscaper/<locale>/` a real registered product whose
surfaces are deliberately empty, without changing Soundscaper or Framescaper
behavior.

L1 changes no milestone-2 closure scope: it adds no route, role, platform, or
fault class to the frozen closure inventory and requires no scope revision —
the third product is new-capability work the milestone-2 rule itself assigns
to later milestones, and this roadmap records the user's acceptance of that
scope.

- **Shared — Planned:** a `src/lightscaper/product.js` profile (identity, base
  path, workspace, panels, import/export choices, shortcuts, capability map)
  registered in the product registry, with the new photo capability keys added
  as explicit booleans to all three profiles and the capability inventory.
- **Shared — Planned:** retirement of every two-product assumption that "the
  other product" implies: product switching and handoff, route parsing,
  product bootstrap, sidebar links, and menu filters driven by the registry
  rather than by ternaries.
- **Web Core — Planned:** static routes, PWA manifest, icons, offline
  application shell, and per-locale product copy for every supported locale,
  within the existing Pages and chunk ceilings.
- **Shared — Planned:** a `lightscaper` Node-test shard, workflow matrix rows,
  architecture rules for `src/lightscaper/`, and a complete
  `config/production-capabilities.json` block whose evidence paths exist.
- **Electron Enhanced — Blocked until L8:** desktop identity, packaging, and
  per-product desktop wiring stay untouched in L1.

### Exit gate

- `npm run check:static` passes with the third product registered, and the
  Soundscaper and Framescaper suites pass unchanged.
- The route renders product-branded with an empty library in Chromium,
  Firefox, and WebKit browser workflows.
- The capability inventory test pins the Lightscaper claims, and every claimed
  capability is `false` except the registered photo surface.
- Product switching reaches all three products from each of them in a browser
  workflow.

## L2. Catalog and develop-state contracts

**Depends on:** L1. The still-source model follows the Framescaper V30
campaign once it lands on `main`; L2 references it and must not fork it.

**Goal:** fix the schemas everything else builds on — the catalog, the develop
stack, and the pixel interchange — before any surface exists.

- **Shared — Planned:** a photo-catalog project family over the shared media
  library: photo references with content digests, virtual folders whose
  operations never write the filesystem, collections and rule-based smart
  collections, ratings, flags, color labels, hierarchical
  keywords, capture-time and file metadata, and virtual copies as first-class
  versions.
- **Shared — Planned:** the catalog persistence decision — the unit of
  storage, revision, and history for six-figure photo counts under the
  snapshot-history constraint — recorded in the owning plan with its budgets
  before implementation.
- **Shared — Planned:** develop state as an ordered stack of shared-effect
  instances plus geometry and mask bindings, per photo version, carrying an
  explicit process version; deterministic serialization, validation,
  migration, clone, undo/redo, clipboard, and Scape round trip like every
  schema family.
- **Shared — Planned:** a depth- and gamut-agnostic frame contract: buffers
  declare sample format (`unorm8` now; `unorm16` and `float32` reserved),
  color primaries, and transfer; admission proves 8-bit sRGB is the only
  accepted profile today rather than the types assuming it.
- **Shared — Planned:** an EXIF/IPTC read model (write stays in L5) with a
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

- **Web Core — Planned:** import into the managed library: originals retained
  immutable with recorded digests, digest dedupe, bounded batches, per-file
  failure reporting, rename templates, apply-during-import of keywords and
  metadata presets (develop presets once L4 lands), and interruption recovery
  to a consistent catalog.
- **Web Core — Planned:** derivative previews as disposable artifacts in tiers
  (thumbnail, fit-screen), built in cancellable background batches,
  regenerated on demand, and evictable under storage pressure.
- **Web Core — Planned:** grid, filmstrip, loupe, compare, and survey views;
  ratings, flags, and labels with auto-advance culling; stacks; sort orders;
  a filter bar over text, attributes, and metadata columns; and collections
  with live smart collections.
- **Web Core — Planned:** a metadata panel over the L2 read model,
  capture-time edit, batch rename, missing-media detection and relink through
  the existing relink path, and catalog snapshot/backup through Scape
  export.
- **Shared — Planned:** a pinned synthetic large-library fixture, with its
  import, scroll, filter, and search measurements and thresholds recorded in
  the quality-diagnostics configuration and run in CI.
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

- **Shared — Planned:** the Lightroom-vocabulary global set mapped onto shared
  effects, extending the existing catalog where an operation is missing:
  white balance; the tone ladder (exposure, contrast, highlights, shadows,
  whites, blacks); vibrance and saturation; texture, clarity, and dehaze;
  a parametric-plus-point tone curve with per-channel curves; an HSL mixer;
  black-and-white mix; color-grading wheels over the existing grade model;
  sharpening; noise reduction; post-crop vignette; grain; and LUT profiles
  over `.cube`. Every new operation is a shared effect authorable from
  Framescaper in the same change.
- **Web Core — Planned:** the develop workspace: a histogram with clipping
  indicators, before/after and split views, per-version history and named
  snapshots, copy/paste with a settings picker, sync and auto-sync across
  selections, relative quick-develop batch adjustments, and full and partial
  presets on the shared preset model.
- **Shared — Planned:** crop, straighten, rotate, flip, and aspect presets on
  shared geometry, plus manual perspective correction.
- **Web Core — Optional:** geometric auto-straighten and auto/guided upright;
  the ML fence applies only to ML-based implementations.
- **Web Core — Planned:** proxy develop: adjustments evaluated on
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

- **Web Core — Planned:** single and batch export: JPEG and PNG everywhere and
  TIFF where an encoder is proven; sizing by fit, long edge, megapixels, or
  percentage; resample quality; output sharpening; text and graphic
  watermarks; filename templates; metadata include/strip scopes; and export
  presets — bounded, abortable, progress-reporting, and background-queued
  like the other delivery paths.
- **Shared — Planned:** sidecar write: develop state and metadata serialized
  beside exports in Lightscaper's documented sidecar schema, with no
  Adobe-compatibility claim.
- **Shared — Deferred:** output profiles beyond sRGB and Display P3 (custom
  ICC) until the platform color-management story proves them.
- **Shared — Planned:** handoff both ways: a developed photo opens in
  Framescaper as a still with its stack intact and renders pixel-identically;
  a Framescaper still opens in Lightscaper's develop; and a collection hands
  to Framescaper as a sequence.
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

- **Shared — Planned:** mask-bound adjustment instances applying any subset of
  the global operations through a mask; linear-gradient, radial-gradient, and
  luminance/color range mask nodes added as shared node kinds beside the
  existing vector, raster, alpha, feather, invert, and boolean nodes; and
  brush masks over the raster node.
- **Web Core — Planned:** mask management: list, rename, duplicate, overlay
  visualization modes, add/subtract/intersect composition, and keyboard
  reachability.
- **Shared — Planned:** parametric healing: clone and heal spots with
  repositionable sources, re-rendered from the original on every evaluation,
  with a visualize-spots view.
- **Shared — Optional:** red-eye correction.

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
| Distribution | Browser and desktop workflows, licenses, notices, SHA-256 sums, authenticated runtime/catalog payloads, and unsigned package smoke. |

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
- Before implementation, decompose each milestone item into a bounded work
  packet with outcome, invariants, acceptance, non-goals, and stop condition
  in the owning `docs/lightscaper-*-plan.md`.
- Promote a platform tier only when the supported matrix proves the stronger
  contract.
