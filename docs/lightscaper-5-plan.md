# Lightscaper milestone L5 plan: export and cross-product handoff

> **Current release-policy note (2026-08-31):** qualification ledgers, cohorts,
> and release-admission commands retained below are historical planning context.
> Future implementation uses ordinary CI, disposable diagnostics, and optional
> owner QA as described by the current release and quality policies.

> Owning source for L5 sequencing, the photo-delivery and handoff
> decisions, their invariants, and the bounded work packets. The
> [Lightscaper roadmap](../roadmap-lightscaper.md#l5-export-and-cross-product-handoff)
> owns scope and status; the licensing, capability, compatibility, and
> quality-budget policies own theirs. Grounded against the repository on
> 2026-08-25 at commit `3d1e908c` with file:line verification. L5 depends
> on L4 for the global operation set and the preset model, on L2 for
> `DevelopStackV1`, `PhotoCatalogV1`, `RenderSampleProfileV1`, and
> `PhotoMetadataReadV1`, and on L1 for the registry-driven product switch
> (lightscaper-1-plan.md, lightscaper-2-plan.md, lightscaper-4-plan.md);
> L7 (lightscaper-7-plan.md) widens these paths to deeper samples and
> wider gamuts and adds no export scope here. Re-ground every citation at
> pickup — earlier milestones will have moved the tree.

## Goals and ordering principle

1. **Primary: a finished photo leaves without a hidden decision.** The roadmap
   fixes the exact license for divergence between what the develop view showed
   and what the file contains — output color conversion, resizing, output
   sharpening, watermarking, and metadata shaping, and nothing else
   (roadmap-lightscaper.md:74-77) — so anything else that moves pixels between
   preview and export is a defect, and the delivery report is the machine proof
   that every admitted step was disclosed
   (`src/common/editor/delivery-conversion-inventory.ts:23-36`).
2. **Secondary: one delivery model, extended — not a second export stack.**
   `PhotoExportPlanV1` is a third builder beside `createExportPlan`
   (`src/common/editor/export.js:155`) and `createVideoExportPlan`
   (`src/common/editor/video-export.js:244`), consuming the four contracts
   milestone 6 built: the report vocabulary
   (`src/common/editor/delivery-report.ts:18-24`), preset resolution
   (`src/common/editor/delivery-preset.ts:20-40`), the queue
   (`src/common/editor/delivery-queue.ts:30-48`), and the file-save purpose
   allowlist (`src/common/editor/file-service.js:190`). A batch member is one
   ordinary export action, as the audio batch already is
   (`src/common/editor/controller/delivery-queue-service.ts:18-20`).

Work is ordered by contract risk: the plan shape, the format registry, and the
availability declaration land first, because every later packet emits a plan,
names a format, and reports what that format could not do. Metadata and the
sidecar follow, since their report items are what the batch gate counts.

## What already exists (do not re-plan)

- **The plan seam is the semantic authority for delivery.** Two builders
  resolve settings into a frozen serializable plan and nothing encodes without
  one: `createExportPlan` (`src/common/editor/export.js:155`),
  `createVideoExportPlan` (`src/common/editor/video-export.js:244`). The one
  controller entry is `handleExportAction`
  (`src/common/editor/controller/export-service.ts:69`), owning cancel
  (`:70-77`), video dispatch by format (`:79-81`), and a single named lifetime
  task with its abort signal and generation guard (`:103-110`).
- **Milestone 6's delivery model is complete on the web tier.** Dispositions
  `preserved|converted|missing|omitted` with counts
  (`delivery-report.ts:18-24`); the report record (`:44-50`) whose audio-shaped
  subject fields are already nullable (`:35-42`); conversions derived from the
  plan, not described by the caller (`delivery-conversion-inventory.ts:23-36`);
  deterministic JSON with a caller-supplied timestamp
  (`delivery-report-document.ts:12-14, 32-35`); a bounded in-session queue with
  ordered jobs, pause, cancel, and retry-from-failure
  (`delivery-queue.ts:10-28, 30-48`); presets as validated data with closed
  field lists resolving to plan options and carrying no encode path
  (`delivery-preset.ts:6-18, 24-45`); and conformance that reads produced bytes
  back instead of trusting the writer (`delivery-conformance.ts:9-13, 28-37`).
- **Queue recovery classes are a closed, evidence-bound vocabulary.** Task
  kinds `encoded-export`, `image-sequence-export`, `proxy-generation`
  (`native-queue-record.ts:43-47`); classes `atomic-restart` and
  `verified-frame-checkpoint` (`:51-54`); only an image sequence may
  checkpoint, because an encoded container has no verifiable partial state
  (`:71-77`), and admission refuses the mismatch (`:189-195`). The web queue
  declares `encoded-export`/`atomic-restart`
  (`controller/delivery-queue-service.ts:111-113`) and refuses to record a
  delivery that published nothing (`:36-38, 52-60`).
- **Browser image encoding is canvas-only, and proven.** The freeze path puts
  evaluated RGBA into a 2D canvas, forces opaque alpha, calls
  `canvas.toBlob(…, 'image/png')`, and refuses a blob whose type is not
  `image/png`
  (`src/common/editor/ui/workspace/video-preview-freeze-capture.ts:56-86`,
  encode `:79-83`, assertion `:84`); a second site adds a `toDataURL` fallback
  and a quality argument (`src/common/editor/video-media.js:263-280`); and
  encoded-payload ceilings with typed refusals exist
  (`video-preview-capture-admission.ts:13, 59-73`).
- **The primitives a watermark needs are present, and color is SDR-only.**
  Text, shape, and solid generator documents over a closed font set
  (`video-visual-model-v24.ts:43-51, 53-59, 61-64`, union `:77-81`), still
  sources bound to managed media by id and digest (`:20-31`), per-owner
  presentation with `enabled`, `opacity`, `blendMode`, grade, and mask bindings
  (`video-visual-presentation-v27.ts:19-29`), and `sharpen` as a shared effect
  over FFmpeg `unsharp` (`video-effects.js:29, 46-48`). `VideoColorGradeV1`
  (`video-color-management-v27.ts:62-72`) narrows to sRGB/BT.709 (`:74-79`) and
  refuses wide gamut or HDR without an exact transform (`:400-406`).
- **Cross-product handoff exists and is witnessed.** `prepareProjectHandoff`
  flushes, re-checks project identity under a capture interlock, releases the
  project lock, and returns `{projectId, revision}`
  (`controller/project-admin-service.ts:92-120`); the menu action pairs it with
  `otherProductId` and a locale navigation
  (`ui/workspace/workspace-application-menu-runtime.js:236-240`); a browser
  spec proves a Scape archive crosses products, is held read-only by the
  recipient, and returns editable
  (`tests/browser/audio-editor-scape-product-roundtrip.spec.js:35-80`).
  Framescaper projects validate `sequences`, `primarySequenceId`, and
  `subsequences` (`src/framescaper/editor-project-v28-validation.ts:47-48`) and
  browser `image/*` import already builds still sources
  (`src/framescaper/editor-selected-v27-authoring-workflows.ts:198, 348`).

## Verified gaps this plan closes (grounded 2026-08-25)

- **No photo export plan, format table, or output-stage order exists.** The two
  format registries are audio (`controller/export-settings.ts:9-22`, twelve
  ids) and video (`video-export.js:46-60`); neither admits a still image.
- **No TIFF encoder is reachable from a browser.** The only in-tree TIFF encode
  is the native FFmpeg profile `encode-tiff-sequence`, muxer `image2`, pixel
  format `rgba64le`
  (`src/common/editor/native-media-v14-native-dispatch.ts:138-141`); its
  licensing row reads `"status": "blocked"`
  (`config/production-licensing-matrix.json:1386-1399`), the native build recipe
  lists `tiff` in `blockedComponents`
  (`native/framescaper-media-host/build/ffmpeg-9.0.1-configure.json:47-57`), and
  the web FFmpeg profile enables audio encoders only
  (`src/common/editor/media-export.js:15-20`).
- **The shared still scaler is nearest-neighbor.** `scaleFrame`
  (`unified-exact-render-visual-materializer-v13.ts:180`) samples with
  `Math.floor(y * sourceHeight / height)` and its horizontal twin (`:198-200`),
  so exporting a downsized photo through it is an unreported quality conversion
  and "resample quality" (roadmap-lightscaper.md:348) has nothing to select
  between yet.
- **No filename templating exists anywhere**: names come from
  `sanitizeExportName` (`src/common/editor/export.js:133-142`) and
  `createExportFileName` (`:144-152`), which hardcode a mix/stem shape. **The
  file-save purpose allowlist has no sidecar token** — its eleven entries run
  `project` through `interchange` (`file-service.js:190`).
- **No metadata write path exists for images, and no EXIF/IPTC/XMP code exists
  at all** — a repository-wide search over `src/` for `exif`, `IPTC`, and `XMP`
  returns nothing. Audio metadata is a bounded map capped at 32 fields under a
  `^[A-Za-z0-9_.-]{1,64}$` key rule turned into `-metadata` arguments
  (`media-export.js:4-5, 348-361, 363-365`); video delivery discards source
  metadata and data streams with `-map_metadata -1`, `-map_chapters -1`, and
  `-dn` (`video-ffmpeg.js:74-84`).
- **The product switch is a binary ternary** — `PRODUCT_IDS` holds two entries
  (`src/common/products.js:4`), `otherProductId` is a ternary over them
  (`:30-32`) — and pixel interchange is 8-bit throughout:
  `UnifiedExactRenderRgbaFrameV13` carries `Uint8Array` pixels
  (`unified-exact-render-finishing-consumers-v13.ts:49-53`) and the grade
  evaluator divides samples by 255 (`:282-291`).

## Decisions

### `PhotoExportPlanV1` extends the seam; it is not a second stack

`src/common/editor/photo-export.ts` exports
`createPhotoExportPlan(photoVersion, options)`, where `photoVersion` is the
resolved row-plus-`DevelopStackV1` record L3's pager yields, returning a frozen
serializable plan: source reference and digest, resolved `DevelopStackV1` with
its `processVersion`, output `RenderSampleProfileV1`, the ordered output-only
stage list, format descriptor, filename, metadata scope, and sidecar
disposition. Four facts make it an extension rather than a rival: a preset
resolves to its options through `resolveDeliveryPresetPlanOptions` under a new
`photo` kind (`delivery-preset.ts:20-22, 24-40`); its report is a
`DeliveryReport` with the audio-shaped subject fields left null
(`delivery-report.ts:35-42`); a queued member reaches it through the one
`handleExportAction` call the queue service already makes
(`controller/delivery-queue-service.ts:18-20`,
`controller/export-service.ts:69`); and publication goes through the existing
file-service purposes (`file-service.js:190`).

### The output-only stage order is fixed and named in the plan

The plan carries `PhotoOutputStageV1[]` in exactly the roadmap's order — output
color conversion, resize, output sharpening, watermark, metadata shaping
(roadmap-lightscaper.md:74-77) — fixed because the alternative, sharpening
before resizing, changes pixels for a reason the user did not state. An active
stage emits a `converted` report item, an inactive one emits nothing, and a
stage absent from the plan cannot run: the executor iterates the plan's list.

### TIFF does not ship in L5, and the registry says why

No TIFF encoder is reachable from a browser, and the one in the tree is blocked
twice: the licensing row is `blocked` pending corresponding source, notices,
alpha interoperability, and payload evidence
(`config/production-licensing-matrix.json:1386-1399`), and the native recipe
blocks the component (`ffmpeg-9.0.1-configure.json:47-57`). The roadmap's
condition is "TIFF where an encoder is proven"
(roadmap-lightscaper.md:346-347), so the format registry carries a `tiff` entry
with `available: false`, the blocking row id, and the tier that would supply it
— the L8 desktop tier over L7's native services — in the declaration shape
presets use for gated codecs (`delivery-preset.ts:15-17`). Asking for TIFF is
refused with that reason, never downgraded to PNG, and the refusal is itself a
golden, so activating TIFF later is a visible diff rather than a quiet flip.

### Goldens pin decoded pixels and plan bytes, never encoded bytes

`canvas.toBlob` is an engine implementation: PNG filter selection, deflate
level, and JPEG quantization vary across Chromium, Firefox, and WebKit, so
pinning encoder output bytes pins the browser rather than the render. Three
things are pinned instead: the plan document, byte-exact on the
deterministic-serialization pattern the report follows
(`delivery-report-document.ts:12-14`); PNG output, decoded back and asserted
RGBA-identical to the rendered frame; and JPEG output, decoded back and
asserted within a declared per-channel tolerance through the effect-parity
comparison helpers (`tests/browser/video-effect-parity-helpers.js:3-4, 32`).
Reading produced bytes back rather than trusting the writer is delivery
conformance's own rule (`delivery-conformance.ts:9-13`), and the split mirrors
milestone 6's (docs/milestone-6-plan.md:270-272).

### Metadata write is additive, scoped, and reported

A canvas-encoded file carries no source metadata at all, so include is the
decision and strip is the default. `PhotoMetadataWriteScopeV1` closes over
seven independently included groups; six — `copyright`, `creator`, `camera`,
`capture`, `location`, `keywords` — take their values from L2's
`PhotoMetadataReadV1`, so nothing is re-parsed here. `ratings-labels` is
sourced from `PhotoCatalogV1` row state, not from `PhotoMetadataReadV1`, and is
stated as such in the report item. Writing is a bounded pure-JS step over the
encoder's output: an EXIF APP1 segment spliced into the JPEG stream, an `eXIf`
chunk into the PNG stream, and an APP13 Photoshop IRB for the IPTC IIM groups.
No dependency is added, so the licensing chain is untouched. Every excluded
group emits an `omitted` report item naming it, so "stripped" is a disclosure
rather than an absence — the rule that turned silent WAV dither into an
itemized conversion (docs/milestone-6-plan.md:362-366).

### `PhotoSidecarV1` is Lightscaper's own and saves under its own purpose

The sidecar is a deterministic JSON document carrying `schemaVersion`, the
photo reference and digest, the `DevelopStackV1` with its `processVersion`, the
written metadata scope and values, and the export plan fingerprint. It makes no
Adobe or XMP compatibility claim in the schema, the extension, the copy, or the
documentation (roadmap-lightscaper.md:90-91, 536-537). Serialization follows
`delivery-report-document.ts:12-14`: fixed key order, caller-supplied
timestamp, byte-stable across runs. It saves under a new `sidecar` purpose
added to the allowlist (`file-service.js:190`) rather than reusing `report`.

### Batch export checkpoints per photo and says so honestly

A single photo delivery declares `encoded-export` with `atomic-restart`, as the
web queue already does (`controller/delivery-queue-service.ts:111-113`). A
batch declares `image-sequence-export` with `verified-frame-checkpoint`, which
the queue record admits for that task kind and no other
(`native-queue-record.ts:71-77, 189-195`). The claim is honest because the
checkpoint boundary is a whole finished file: N photos publish N independent
atomic outputs, so resuming skips files already verified on disk rather than
claiming partial-container resume, and an interrupted write is re-run whole.

### Watermark, sharpening, and resampling are shared operations

A text watermark is a `VideoGeneratorTextDocumentV1`
(`video-visual-model-v24.ts:43-51`); a graphic watermark is a
`VideoStillSourceV1` bound to managed media (`:20-31`); both composite through
`VideoVisualPresentationV1`'s `opacity` and `blendMode`
(`video-visual-presentation-v27.ts:19-29`). Output sharpening is the shared
`sharpen` operation (`video-effects.js:46-48`) applied after resize; a radius
parameter, if needed, extends that shared definition in `src/common/` with a
Framescaper test in the same change, never as a Lightscaper-local variant
(roadmap-lightscaper.md:38-41). Resampling generalizes in place:
`src/common/editor/photo-resample.ts` owns the kernels (`nearest`, `box`,
`triangle`, `catmull-rom`, `lanczos3`) and `scaleFrame`
(`unified-exact-render-visual-materializer-v13.ts:180`) routes through it at
`nearest`, so Framescaper still renders stay byte-stable.

### Handoff carries develop state, never pixels

A developed photo opens in Framescaper as a still source bound to the same
managed media id and digest — no media copy, the roadmap's own boundary
(roadmap-lightscaper.md:83-85). Transport is the existing Scape archive
(`scape-export-plan.ts:86-95`) over the `prepareProjectHandoff` lock discipline
(`controller/project-admin-service.ts:92-120`). Pixel identity follows from both
products evaluating the same `DevelopStackV1` through the same shared code, so
the proof is digest equality.

### Rejected alternatives (recorded to prevent re-litigation)

| Alternative | Why rejected |
| --- | --- |
| A separate photo export stack under `src/lightscaper/` | Two stacks drift; the plan seam is the single semantic authority and milestone 6 forbade a second one (docs/milestone-6-plan.md:319). A builder that skipped the report model could convert silently. |
| A WASM TIFF encoder dependency in L5 | Costs a licensing-matrix row, a `THIRD_PARTY_LICENSES.md` section with the exact locked version, `LICENSES/` text, a `build:*`/`audit:*` pair wired into `audit:ci` (package.json:139), plus corresponding source and pinned hashes on the runtime-asset pattern (`config/ffmpeg-runtime-manifest.json:1-30`) — for one format the roadmap already made conditional. |
| Rebuilding `@ffmpeg/core` with the TIFF encoder enabled | The enabled set is governed by two blocked gates, `ffmpeg-enabled-library-corresponding-source` and `ffmpeg-enabled-codec-patent-review` (config/production-licensing-matrix.json:859, 865), and milestone 6 recorded a core rebuild as outside its scope (docs/milestone-6-plan.md:276-282). |
| A hand-rolled uncompressed baseline TIFF writer | An 8-bit uncompressed strip TIFF is not the 16-bit layered TIFF the format is asked for; shipping one under the name is the hidden conversion the primary goal forbids. |
| Byte-pinned goldens over `canvas.toBlob` output | Pins the browser build, not the render; the first Chromium encoder change turns a correct product red. Decoded-pixel goldens pin the thing under test. |
| Reusing the `report` save purpose for the sidecar | Different artifacts with different retention sharing a token lets a sidecar reach the report save target; a new token costs one allowlist line (`file-service.js:190`). |
| Labeling batch export "resumable" without per-file verification | The recovery vocabulary is evidence-bound and refuses the mismatch at admission (`native-queue-record.ts:189-195`); an unproven claim is the mislabeling milestone 6 forbade. |
| An SSIM/MAE tolerance for cross-product pixel identity | Both products evaluate the same stack through the same shared code; anything short of digest equality hides a real divergence behind a threshold. |

## Phase structure

| Phase | Mode | Content |
| --- | --- | --- |
| L5.0 | Serialized (one work stream) | WP-L5.0: `PhotoExportPlanV1`, format registry, availability declaration, report wiring |
| L5A | Serialized after L5.0 | WP-L5A.0 output stages, WP-L5A.1 metadata and sidecar, WP-L5A.2 templates, presets, and the single-export surface |
| L5B | Serialized after L5A | WP-L5B.0: batch queue, determinism, abortability, resume evidence |
| L5C | Parallel with L5A and L5B, file-disjoint | WP-L5C.0: handoff both ways and collection-to-sequence |

L5A does not begin until every WP-L5.0 acceptance check passes; L5C opens once
L1's registry-driven switch is on `main`.

## Work packets

Every L5 packet is decomposed here against the five fields (Outcome,
Invariants, Acceptance, Non-goals, Stop condition); no slice doc is owed at
pickup, and any packet that grows one names it here first.

### WP-L5.0 — `PhotoExportPlanV1`, format registry, and encoder availability

- **Outcome:** `src/common/editor/photo-export.ts` with `createPhotoExportPlan`
  producing a frozen serializable plan; `photo-export-formats.ts` declaring
  `jpeg` and `png` available on Web Core through canvas encode and `tiff`
  unavailable with its blocking row id
  (`config/production-licensing-matrix.json:1386-1399`) and the tier that would
  supply it; `PhotoExportSizingV1` closing over fit, long edge, megapixels, and
  percentage; the output `RenderSampleProfileV1` recorded per plan; report
  construction over the plan-derived inventory
  (`delivery-conversion-inventory.ts:23-36`).
- **Invariants:** no encode happens without a plan; a format whose availability
  is false is refused with its reason and never substituted; the plan
  serializes byte-identically across runs for identical inputs; the plan states
  its sample profile rather than the types assuming 8-bit sRGB; the builder
  reads one resolved photo-version record and never a catalog handle, so no
  export path holds more than the rows L3's pager already returned.
- **Acceptance:** `npm test -- --shard=lightscaper` covering
  `tests/lightscaper-photo-export-plan.test.ts` (plan goldens for every
  available format times every sizing mode; byte-stable serialization across
  two builds), `tests/lightscaper-photo-export-formats.test.ts` (the exact TIFF
  refusal message and its row id; every declared row id resolves in the
  matrix), and `tests/lightscaper-photo-export-no-second-stack.test.ts` (the
  controller's import closure reaches no writer outside `handleExportAction`).
  `npm run check:architecture` holds the 600-line ceiling
  (`config/maintainability-allowlist.json:3`).
- **Non-goals:** no output stages, metadata, sidecar, queue, filename
  templates, or new dependency.
- **Stop condition:** stop if any plan field cannot be derived from
  `DevelopStackV1` plus stated options — a plan that reads ambient controller
  state cannot be pinned by a golden.

### WP-L5A.0 — Output-only stages: resample, sharpening, watermark

- **Outcome:** `photo-output-stages.ts` executing the fixed stage order over
  the rendered frame; `src/common/editor/photo-resample.ts` owning the kernel
  set, with `scaleFrame`
  (`unified-exact-render-visual-materializer-v13.ts:180`) routed through it at
  `nearest`; output sharpening on the shared `sharpen` operation
  (`video-effects.js:46-48`); `PhotoWatermarkV1` over
  `VideoGeneratorTextDocumentV1` (`video-visual-model-v24.ts:43-51`) or
  `VideoStillSourceV1` (`:20-31`), composited through
  `VideoVisualPresentationV1` opacity and blend
  (`video-visual-presentation-v27.ts:19-29`); one `converted` report item per
  active stage.
- **Invariants:** with every output stage inactive, exported pixels equal
  evaluated preview pixels exactly; stage order is fixed and unconfigurable; no
  stage runs that the plan did not declare; existing Framescaper still renders
  stay byte-stable, because the default kernel is the behavior already there.
- **Acceptance:** `npm test -- --shard=lightscaper` covering
  `tests/lightscaper-photo-output-stages.test.ts` (a null-stage export digest
  equal to the evaluated-frame digest; one report item per active stage; a
  stage absent from the plan is unreachable) and
  `tests/lightscaper-photo-resample.test.ts` (per-kernel goldens; 1:1 identity
  for every kernel). `npm test -- --shard=framescaper` covering
  `tests/framescaper-shared-watermark-composite.test.ts`, which authors the
  same watermark descriptor as a Framescaper generator layer and asserts the
  same pixels. `tests/audio-editor-video-delivery-goldens.test.ts` (`:30-40`)
  stays green unmodified.
- **Non-goals:** no ICC handling beyond sRGB; no Display P3 output, L7's
  widening; no develop-side sharpening, which is L4's.
- **Stop condition:** stop if honoring a stage would require a second
  evaluation of the develop stack — one render, then output-only steps, or the
  preview/export identity invariant is not provable.

### WP-L5A.1 — Metadata write and `PhotoSidecarV1`

- **Outcome:** `photo-metadata-write.ts` producing an EXIF APP1 segment for
  JPEG and an `eXIf` chunk for PNG from L2's `PhotoMetadataReadV1` values,
  bounded on field count and key grammar like audio metadata
  (`media-export.js:4-5, 348-361`); `PhotoMetadataWriteScopeV1` closing over
  the seven groups; `photo-sidecar.ts` defining and deterministically
  serializing `PhotoSidecarV1`; a `sidecar` token added to the file-service
  purpose allowlist (`file-service.js:190`); `docs/photo-sidecar-schema.md`
  documenting the schema and stating outright that it makes no Adobe or XMP
  compatibility claim. IPTC IIM groups are written as an APP13 Photoshop IRB
  segment for JPEG (the container L2's reader scans) and EXIF-only groups as
  APP1 / `eXIf`; a group whose container L2 cannot read back is refused at
  scope validation rather than written blind.
- **Invariants:** every excluded group emits an `omitted` report item; no
  metadata is written that the scope did not include; the sidecar round-trips
  through L2's validator and re-renders the identical stack; the sidecar is
  written only after the image file has published, so an aborted export leaves
  neither; no XMP or Adobe claim appears in schema, extension, copy, or docs.
- **Acceptance:** `npm test -- --shard=lightscaper` covering
  `tests/lightscaper-photo-metadata-write.test.ts` (a written segment parsed
  back by L2's reader yields the same values; the scope matrix — all groups, no
  groups, one group at a time — pins both bytes and report items),
  `tests/lightscaper-photo-sidecar.test.ts` (byte-stable serialization; a
  sidecar re-render digest equal to the export digest; future-version refusal),
  and `tests/lightscaper-photo-sidecar-no-xmp-claim.test.ts`, which scans the
  schema module, the copy catalog entries, and `docs/photo-sidecar-schema.md`
  for `xmp` and `adobe` and fails on a match outside the disclaimer sentence.
  `npm run docs:check` covers the new document.
- **Non-goals:** no XMP read or write; no DNG; no metadata write back into the
  original — originals are immutable (roadmap-lightscaper.md:70).
- **Stop condition:** stop if writing a segment requires re-encoding the image;
  metadata shaping appends to a produced file and never touches its pixels.

### WP-L5A.2 — Filename templates, export presets, and the single-export surface

- **Outcome:** `photo-filename-template.ts` with a closed token vocabulary
  (`{originalName}`, `{sequence}`, `{exportDate}`, `{captureDate}`, `{rating}`,
  `{presetLabel}`, `{width}`, `{height}`, `{copyName}`), reusing
  `sanitizeExportName` (`export.js:133-142`) for per-segment safety and
  resolving collisions deterministically; a `photo` kind in
  `DELIVERY_PRESET_KINDS` (`delivery-preset.ts:20-22`) with its closed settings
  list; the Lightscaper export dialog reaching the controls the delivery preset
  service already exposes (`controller/delivery-preset-service.ts:18-25`); the
  menu entry contributed through the per-product export extension point
  (`ui/application-menus.js:237`, `ui/application-menu-product-items.js:107`);
  `photoExport` and `photoMetadata` flipped to `true` in Lightscaper's
  `config/production-capabilities.json` profile and in their `projectFeatures`
  inventory rows, every evidence path existing on disk first.
- **Invariants:** an unknown template token is rejected, never rendered
  literally; the same template plus the same inputs yields the same name; a
  collision resolves deterministically and is reported; an unknown preset field
  is rejected under the closed-list rule (`delivery-preset.ts:24-29`); the
  surface is menu-reached and off by default.
- **Acceptance:** `npm test -- --shard=lightscaper` covering
  `tests/lightscaper-photo-filename-template.test.ts` (token goldens, unknown
  token refusal, collision determinism over a 100-name fixture) and
  `tests/lightscaper-photo-export-preset.test.ts` (preset-to-plan resolution
  goldens; dialog parity — the same stated settings produce the same plan
  through both paths). `npm test -- --shard=common` covering
  `tests/production-capability-inventory.test.js`. `npm run test:browser`
  covering `tests/browser/lightscaper-photo-export.spec.js`, keyboard-complete
  in Chromium and Firefox — the pinned Playwright WebKit build exposes no OPFS
  or IndexedDB Blob storage (roadmap.md:270-274), so the catalog-backed
  workflow is two engines under the deferral L3 records
  (roadmap-lightscaper.md:286-289). The same command covers
  `tests/browser/lightscaper-photo-export-pixel-goldens.spec.js` over fixture
  `l5-photo-export-suite-v1`: every format times sizing mode times metadata
  scope cell is encoded and decoded back, PNG asserted RGBA-identical to the
  evaluated frame and JPEG within the recorded tolerance
  `l5-jpeg-channel-tolerance-v1`, and the values L2's `PhotoMetadataReadV1`
  reads back equal the scope — Chromium and Firefox.
- **Non-goals:** no batch UI, queue, or preset catalog shipped as content.
- **Stop condition:** stop if a template token needs catalog state the plan
  does not carry — the plan is the input to naming, not the controller.

### WP-L5B.0 — Batch export: determinism, abortability, resume

- **Outcome:** photo batches built through `delivery-batch.ts` (`:10-26`) with
  photo-version targets; the batch enqueued through the existing runner and
  service (`controller/delivery-queue-runner.ts:21-33`,
  `controller/delivery-queue-service.ts:18-26`) declaring
  `image-sequence-export` with `verified-frame-checkpoint`
  (`native-queue-record.ts:43-54, 71-77`); per-photo conformance decoding each
  produced file back before counting it verified
  (`delivery-conformance.ts:9-13`); resume that skips verified files, re-runs
  any other whole, and reports per-member progress.
- **Invariants:** member order is a total order derived from the catalog sort
  and the plan, never from completion order; no partial file publishes; a
  canceled job stays canceled even if its executor later resolves; a queue
  record stores no media bytes (`delivery-queue.ts:20-27`); a resumed batch
  produces byte-identical outputs to an uninterrupted one for the files it
  re-runs.
- **Acceptance:** `npm test -- --shard=lightscaper` covering
  `tests/lightscaper-photo-batch-export.test.ts` (deterministic member order
  over a shuffled selection; abort injected at enqueue, mid-render,
  post-render-pre-publish, and post-publish leaves zero partial files and a
  consistent queue; a resumed batch's outputs equal the uninterrupted run's;
  the `delivery.partialPublishedOutputBytes` collector observes zero,
  `config/quality-budgets.json:1625`) and
  `tests/lightscaper-photo-batch-recovery-class.test.ts` (a batch claiming
  `verified-frame-checkpoint` without per-file verification is refused at
  admission, `native-queue-record.ts:189-195`). `npm run test:browser` covering
  `tests/browser/lightscaper-photo-batch-export.spec.js` for pause, cancel, and
  retry-from-failure in Chromium and Firefox.
- **Non-goals:** no scheduling beyond the queue's FIFO with explicit
  reordering; no Electron persistent-queue binding or cross-session resume,
  which ride L8's durable queue.
- **Stop condition:** stop if any batch member cannot be verified by reading
  its produced bytes back — an unverifiable member stays out of the checkpoint
  set rather than being counted done.

### WP-L5C.0 — Cross-product handoff both ways and collection-to-sequence

- **Outcome:** a developed photo handed to Framescaper as a
  `VideoStillSourceV1` bound to the same managed media id and digest
  (`video-visual-model-v24.ts:20-31`) with its `DevelopStackV1` intact; a
  Framescaper still opened in Lightscaper's develop against the same media; a
  collection handed as a Framescaper sequence over the validated `sequences`
  and `primarySequenceId` fields
  (`src/framescaper/editor-project-v28-validation.ts:47-48`); transport over
  the Scape planner (`scape-export-plan.ts:86-95`) and the
  `prepareProjectHandoff` lock discipline
  (`controller/project-admin-service.ts:92-120`), driven by L1's
  registry-selected destination, not `otherProductId`
  (`src/common/products.js:30-32`); `crossProductHandoffAvailable` flipped from
  `false` to `true` for Lightscaper in its bootstrap, the disabled-reason
  assertion in `tests/browser/editor-products.spec.js:114-137` updated for the
  three-product submenu, and the enablement paired in the same change with the
  destination product proving it opens the handed-off document (L1 gated it off
  only because no schema existed before L2).
- **Invariants:** no media bytes are copied in either direction; the recipient
  either renders the stack or refuses visibly, never renders it differently;
  the same `DevelopStackV1` at the same `processVersion` yields the identical
  RGBA digest in both products; the project lock is released before navigation
  and reacquired by the recipient; a handed-off stack returns re-editable with
  every parameter present; no path rewrites a stack's `processVersion`
  implicitly — only a `develop/set-stack` command carrying both the old and the
  new version, journaled with its inverse, may change it; preset application,
  sync, clipboard paste, Scape import, and cross-product handoff all
  preserve the stack's recorded version.
- **Acceptance:** `npm test -- --shard=common` covering
  `tests/lightscaper-develop-stack-cross-product-render.test.ts`, which renders
  one `DevelopStackV1` fixture through the Lightscaper develop entry and the
  Framescaper still-clip entry and asserts both SHA-256 digests equal each
  other and a pinned constant — a cross-product test lands in `common` by the
  shard rule (`scripts/lib/node-test-shards.mjs:6-11`). `npm run test:browser`
  covering `tests/browser/lightscaper-framescaper-handoff.spec.js`, which
  develops a photo in Lightscaper, digests the canvas readback, hands off,
  digests the Framescaper readback, asserts equality, hands back, and asserts
  the develop parameters are present and editable — Chromium and Firefox,
  following the existing cross-product spec's structure
  (`tests/browser/audio-editor-scape-product-roundtrip.spec.js:35-80`).
- **Non-goals:** no ordering or per-photo duration presets for the handed-off
  sequence — roadmap-lightscaper.md:361-362 marks them Optional and they are
  excluded from this exit; no Framescaper timeline authoring; no translation of
  develop state into video effects beyond the shared instances the stack names.
- **Stop condition:** stop if L1's registry-driven destination has not landed;
  adding a second two-product ternary to reach the handoff is the defect L1
  exists to remove.

## Quality-budget and evidence duties

- Register workload `l5-photo-export-delivery` in `config/quality-budgets.json`
  beside the delivery workload already there (`:1611-1616`), reusing two
  correctness metrics rather than minting synonyms:
  `delivery.unreportedConversions eq 0` (`:1624`) and
  `delivery.partialPublishedOutputBytes eq 0` (`:1625`). Add fixture
  `l5-photo-export-suite-v1`, a pinned synthetic photo set spanning the format,
  sizing, and metadata-scope matrix, with its environment ids and the recorded
  JPEG per-channel tolerance `l5-jpeg-channel-tolerance-v1`.
- Correctness, conformance, golden, and refusal suites run in ordinary CI.
  Throughput thresholds over the batch fixture qualify only on a provisioned
  environment and stay recorded as unqualified until one exists; batch-export
  throughput and memory over real photo sizes join the existing L9 real-library
  soak row (roadmap-lightscaper.md:503-505), and packaged/desktop delivery
  throughput joins the L9 packaged row (:506-508). Real-device handoff evidence
  is the convergence scenario in L9's WP-L9.6 and the device matrix in WP-L9.3,
  and L5 claims neither. L5 creates no new L9 row; it adds
  `l5-photo-export-suite-v1` to those rows' evidence. A threshold change is a
  reviewed budget change, never a silent edit (docs/quality-budgets.md). Ledger
  integrity is enforced by `npm run audit:quality-results` (package.json:133),
  which rides `audit:ci` (`:139`) inside `check:static` (`:140`) and `check`
  (`:141`).
- The WP-L5A.2 capability block is asserted by
  `tests/production-capability-inventory.test.js`; every evidence path it names
  exists on disk first. No new third-party dependency is introduced, so no
  licensing row, `THIRD_PARTY_LICENSES.md` section, `LICENSES/` text, or
  `build:*`/`audit:*` pair is owed — a packet that reaches for one stops.

## Coordination rules

- L5.0 is one work stream; L5A and L5B follow in order. L5C runs parallel and
  file-disjoint: the export track owns `photo-export*.ts`,
  `photo-output-stages.ts`, `photo-resample.ts`, `photo-metadata-write.ts`,
  `photo-sidecar.ts`, `photo-filename-template.ts`; the handoff track owns the
  handoff service and sequence adapter.
- A test's shard follows its basename as well as its imports
  (`scripts/lib/node-test-shards.mjs:42-48`), so the acceptance command and the
  filename are chosen together: a `lightscaper-` basename lands in the
  `lightscaper` shard even when every module it exercises is shared.
- Spine files — one owner per edit, rebase before push, staged by explicit path
  and never with `git add -A`: under `src/common/editor/`, `export.js`,
  `video-export.js`, `media-export.js`, `file-service.js`, `video-effects.js`,
  `delivery-preset.ts`, `delivery-report.ts`,
  `delivery-conversion-inventory.ts`, `delivery-queue.ts`,
  `unified-exact-render-visual-materializer-v13.ts`,
  `controller/export-settings.ts`, `controller/export-service.ts`,
  `controller/delivery-queue-service.ts`,
  `controller/project-admin-service.ts`, `ui/application-menus.js`, and
  `ui/application-menu-product-items.js`; plus `src/common/products.js`, the
  i18n copy catalogs, `scripts/lib/node-test-shards.mjs`, and the
  `production-capabilities`, `production-licensing-matrix`, `quality-budgets`,
  and `maintainability-allowlist` files under `config/`.
- Three edits are serialized product-wide with at most one in flight: the
  `sidecar` purpose token (`file-service.js:190`), the `photo` preset kind
  (`delivery-preset.ts:20-22`), and any change to the shared `sharpen`
  definition (`video-effects.js:46-48`). Each lands with both products' tests
  in the same change. Local gate runs in this shared tree mix other sessions'
  uncommitted work, so acceptance is measured in a detached verification
  worktree at the exact commit and published by pushing that commit explicitly;
  `npm run check` stays green on every push.

## Known constraints this plan absorbs

- **No browser TIFF encoder, and the native one is blocked twice**, so WP-L5.0
  declares it unavailable with its row id instead of approximating it. **The
  shared still scaler is nearest-neighbor**
  (`unified-exact-render-visual-materializer-v13.ts:198-200`), so WP-L5A.0
  generalizes it in place at its default and Framescaper output holds.
- **Pixel interchange is 8-bit**
  (`unified-exact-render-finishing-consumers-v13.ts:49-53`) and managed color
  refuses wide gamut and HDR fail-closed
  (`video-color-management-v27.ts:400-406`), so every golden here is cut at
  `unorm8`+sRGB and depth and Display P3 are L7's widening.
- **WebKit exposes no OPFS, no MediaRecorder, and no IndexedDB Blob storage**
  (roadmap.md:270-274), so catalog-backed browser acceptance is two engines,
  stated rather than claimed as three. **The product switch is binary until L1
  lands** (`src/common/products.js:4, 30-32`); WP-L5C.0 stops rather than adding
  a second ternary.
- **The Framescaper V30 still-image campaign on `codex/milestone-8-images` owns
  still ingest and timeline-image modeling**; WP-L5C.0 depends on it landing on
  `main` and forks nothing from it, and the Electron persistent queue stays
  unactivated (docs/milestone-6-plan.md:392-395), so batches run in session.

## Watch items (not gates yet)

- `ImageDecoder`/WebCodecs image-decode coverage per engine: a decoder-based
  read-back would replace `createImageBitmap` in the conformance step once
  coverage is uniform.
- Whether the TIFF licensing row clears; if it does, the registry entry flips
  with the L8 desktop tier and no L5 packet reopens.
- Encoded-payload ceilings for very large exports: the preview ceiling is 4 MiB
  (`video-preview-capture-admission.ts:13`) and a photo ceiling has to come
  from measurement; moving `l5-jpeg-channel-tolerance-v1` across Playwright
  browser bumps is a reviewed change, not a fixture edit.

## Non-goals and fences

- No TIFF, DNG, or ICC output in L5; output profiles beyond sRGB and Display P3
  stay Deferred (roadmap-lightscaper.md:355-356), and Display P3 itself arrives
  with L7.
- No XMP, Adobe catalog, or DNG-writer compatibility claim
  (roadmap-lightscaper.md:90-91).
- No new third-party dependency, codec, or runtime asset. No print, book,
  slideshow, map, or web-gallery module; a collection handed to Framescaper as
  a sequence is the slideshow path (roadmap-lightscaper.md:92-93).
- No capture, tethering, or camera-control schema, adapter, permission, or UI
  (roadmap-lightscaper.md:103-106); no destructive raster editing and no
  ML-dependent capability (roadmap-lightscaper.md:107-117).
- No writing to originals, and no moving or renaming files on disk
  (roadmap-lightscaper.md:70, 94).
- No second export stack: plans remain the single semantic authority and every
  photo delivery is one ordinary export action.
- Every new surface is menu-reached and off by default.
