# Lightscaper milestone L4 plan: global develop adjustments

> Owning source for L4 sequencing, the shared-effect-catalog and
> render-authority decisions, their invariants, and the bounded work
> packets. The [Lightscaper
> roadmap](../roadmap-lightscaper.md#l4-develop-global-adjustments) owns
> scope and status; the capability inventory, licensing matrix, and
> quality-budget policies own their claims. Grounded against the
> repository on 2026-08-25 at commit `3d1e908c` with file:line
> verification. L4 consumes `DevelopStackV1`, the
> `RenderSampleProfileV1`/`RenderSampleBufferV1` pair, and the
> process-version rule from L2 (lightscaper-2-plan.md) and the
> catalog-and-ingest core from L3 (lightscaper-3-plan.md), whose L3.0
> phase also lands the derivative preview tiers WP-L4C.1 consumes; L4
> opens on L3.0 acceptance alone and never waits on L3A or L3B. It hands
> L6 (lightscaper-6-plan.md) the global operation set masks bind to and
> the preset model, and hands L5 (lightscaper-5-plan.md) a stack that
> renders identically on both sides of a handoff. Re-ground every
> citation at pickup — earlier milestones will have moved the tree.

## Goals and ordering principle

1. **Primary: the develop loop never lies about what the photo looks like.**
   The render of record is machine-independent and byte-reproducible, proxy
   evaluation is declared as proxy and never reaches an exported pixel, and an
   operation the renderer cannot execute refuses instead of rendering as a
   no-op — the discipline the preview ledger already applies
   (`src/common/editor/ui/video-preview-render-ledger.js:45,99-115`).
2. **Secondary: one catalog, three products, no fork.** Every operation L4 adds
   is a definition in the shared registry
   (`src/common/editor/video-effects.js:29-100`), authorable from the existing
   Framescaper rack (`ui/inspector/VideoEffectRack.jsx:3,58-61`) and executable
   by the shared evaluator, with tests in both products in the same change. A
   Lightscaper-only filter is a placement defect.

Work is ordered by contract risk: the parameter model, the renderer-coverage
declaration, and the render authority land first, because every later packet
registers a definition and is gated by the goldens the first packet builds.
Proxy develop closes last, because it can only be measured against a finished
operation set.

## What already exists (do not re-plan)

- **Twelve parametric shared effects** built by a `parameter`/`definition`
  helper pair (`src/common/editor/video-effects.js:3-27`), keyed by
  `color-adjust`, `pixelate`, `vignette`, `gaussian-blur`, `sharpen`,
  `rgb-split`, `chroma-key`, `luma-key`, `spill-suppression`, `glow`,
  `outline`, `drop-shadow` (`:29-100`), with `videoEffectDefaults` (`:120`),
  `validateVideoEffectParams` (`:133`), `createVideoEffect` (`:181`),
  `normalizeVideoEffect` (`:195`), `updateVideoEffect` (`:389`), and
  `serializeVideoEffectsToFfmpegOperations` (`:240`). Instances are commanded
  and undone inside the single commit boundary
  (`commands/effects-video-runtime.js:20-49`), and a slider drag already
  coalesces into one history entry
  (`controller/video-effect-service.ts:251-264`).
- **The compositor is one fixed-code shader with an eight-float pass budget.**
  `EFFECT_CODES` maps the twelve ids to branch codes
  (`ui/video-preview-effects.js:18-31`) read by one fragment shader
  (`:120-333`); a pass carries only `u_params0`/`u_params1` (`:44-45`) plus a
  blur kernel of at most 30 pairs (`:5`), and `videoEffectPasses` scales
  pixel-unit parameters by the preview scale (`:414-425`). Framescaper's exact
  browser render drives the same compositor and refuses the frame on any
  omitted or fallback effect
  (`src/framescaper/editor-video-exact-browser-effects-v27.ts:26-51`).
- **Managed-SDR color has a grade model and a CPU executor.**
  `VideoColorGradeV1` carries exposure stops, contrast, pivot, lift/gamma/gain,
  saturation, and a LUT reference (`video-color-management-v27.ts:62-72`); the
  maths runs per pixel in linear Rec.709/D65 (`:325-339`), stacks up to 64
  grades (`:268-274`), and decodes canvas readback separately (`:246-264`);
  `.cube` LUTs are bounded (`video-color-cube-lut-v27.ts:15-18,41`) and
  referenced only by a digest-bound `lut-sha256:` key.
- **Curves, geometry, and presets are bounded primitives already.**
  `compileInterpolationCurve` takes anchors plus hold/linear/eased/bezier
  segments (`interpolation-curve.ts:41-53,89-100`), bound by keyframe curves to
  numeric-descriptor targets (`video-keyframe-curves.ts:49-56,80-84`);
  `VideoClipComposition` holds crop, anchor, position, scale, rotation, flips,
  opacity, blend mode, and compositing order
  (`video-clip-composition.ts:50-63,68-94`); a preset is either one effect type
  plus params (`effect-presets.js:23-70`) or a Framescaper template
  instantiated under a fresh identity
  (`video-visual-presentation-v27.ts:31-35,90-112`).
- **Proxy policy, derivative recipe bindings, and a deterministic CPU denoise
  operator exist.** `resolveFramescaperVideoProxyUseV20` returns the original
  for every non-preview purpose
  (`src/framescaper/editor-video-proxy-use-policy-v20.ts:41-62`); derivative
  records bind `originalSha256`, `recipeId`, `recipeVersion`, and
  `outputSha256` (`storage/derivative-cache-entry.ts:43-49`); and
  `processSpatialDenoiseV1` (`video-motion-denoise-v27.ts:62-85`) is a
  deterministic CPU operator the exact render path already uses.

## Verified gaps this plan closes (grounded 2026-08-25)

- **Effect parameters are numbers and nothing else.**
  `validateVideoEffectParams` and `normalizeVideoEffectParams` both reject any
  value that is not a finite number inside `[min, max]`
  (`video-effects.js:145-151,169-175`), so a tone curve, an eight-band HSL
  mixer, and a black-and-white mix have no representation. The audio catalog
  answered this by special-casing one type in its normalizer
  (`effects.js:422-448`) — the pattern L4 must not repeat thirteen times.
- **The catalog's iteration order is load-bearing and pinned.**
  `VIDEO_EFFECT_V5_TYPES` is literally `VIDEO_EFFECT_TYPES.slice(0, 6)`
  (`video-effects.js:100-101`), consumed as the `allowedTypes` admission for
  schema version 3 (`video-ffmpeg-render-description.ts:224`), and
  `tests/audio-editor-video-effects-batch2.test.ts:24-26` asserts both slices,
  so a thirteenth definition fails it on its first commit.
- **A catalog entry with no shader silently vanishes from the preview.**
  `videoEffectPasses` returns `[]` for a type absent from `EFFECT_CODES`
  (`ui/video-preview-effects.js:388-389`); only the separate ledger marks it
  omitted, and nothing declares which renderers cover which definition, so the
  coupling to `EFFECT_CODES` and to the FFmpeg switch — whose default throws
  (`video-effects.js:379`) — is convention.
- **The GPU compositor cannot be the full-resolution photo renderer.** Output
  axes are admitted only through `exactVideoPreviewRenderDimension`, capped at
  4096 (`ui/video-preview-render-size.js:3-14`;
  `ui/video-preview-compositor-size.js:14-20`), and `captureEvaluatedRgba`
  refuses a readback above 64 MiB (`ui/video-preview-compositor.js:557-560`). A
  24-megapixel photo is 6000×4000 and 96 MB of RGBA: past both limits.
- **Grade lives on the presentation, and no histogram, scope, or local-contrast
  operator exists.** `VideoVisualPresentationV1.grade` is evaluated only by the
  V13 finishing consumer (`video-visual-presentation-v27.ts:19-29`;
  `unified-exact-render-finishing-consumers-v13.ts:275-290`); the shader has no
  grade code, and the sole "histogram" in the visual tree is a comment saying
  they stay transient (`video-color-management-v27.ts:6`). The vertex transform
  is affine only (`ui/video-preview-geometry-shader.ts:9-12`).
- **Effect copy is bilingual and parity-asserted.**
  `VIDEO_EFFECT_COPY_BY_LOCALE` carries only `de` and `en`
  (`src/common/i18n/video-effect-copy.js:3-57`) spread into the catalogs
  (`catalogs.js:174,1179`), and `tests/i18n-runtime.test.js:18` asserts the two
  key sets are `deepEqual`.
- **No preset model covers a partial stack.** Audio presets carry one
  `effectType` and its params (`effect-presets.js:31-37`); nothing expresses
  "apply this preset's tone ladder and curve but leave white balance alone".

## Decisions

### The shared catalog is extended in place, never renamed

`src/common/editor/video-effects.js` keeps its path and its exported symbol
names. Sixty-nine files import it — thirty-one non-test modules (`app.js`, four
`commands/` runtimes, `controller/video-effect-service.ts`, nine
`project-feature-*` modules, `video-export.js`, `video-ffmpeg.js`,
`video-ffmpeg-render-description.ts`, two `video-keyframe-*` modules,
`unified-exact-render-plan-v9.ts`, four `ui/` modules, four Framescaper
modules, `desktop/project-library-fallback-role-witnesses.js`,
`scripts/lib/desktop-project-library-runtime.mjs`) plus thirty-eight test
files. A rename with a compatibility re-export leaves two live import paths for
one registry, the exact shape of the plan-version pin drift milestone 6 had to
repair (docs/milestone-6-plan.md:186-200); without one it is a sixty-nine-file
mechanical diff on a tree several sessions edit at once. Decisively, `type` is
persisted project data — a stack serializes `{id, type, enabled, params}`
(`video-effects.js:187-192`) — so renaming the file without renaming the ids
buys nothing, and renaming the ids migrates shipped documents in service of a
filename. What generalizes is the type system, not the path; new definition
modules take neutral names (`visual-effect-catalog-{tone,color,detail}.ts`)
because `video-effects.js` at 420 lines cannot absorb thirteen further
definitions under the 600-line ceiling (`scripts/check-file-size.mjs:29-41`).

### Parameter descriptors gain declared kinds

`parameter()` grows a `kind` defaulting to `'scalar'`, beside `'curve'` (a
`CompiledInterpolationCurve` over positions in `[0,1]`) and `'band-set'` (a
fixed-length named-band record of individually bounded scalars). Validation
dispatches on the kind inside `video-effects.js`; no call site outside it
learns a new type name. `'curve'` reuses `compileInterpolationCurve`
(`interpolation-curve.ts:89`) rather than adding a second spline: the
anchor/segment model (`:41-49`) is exactly a photo tone curve, already bounded
and tested. Keyframe binding stays scalar-only, because `videoKeyframeCurves`
reads descriptors as `{min, max, integer}` (`video-keyframe-curves.ts:80-84`);
the normalizer refuses a non-scalar target instead of producing `NaN`, which
costs Lightscaper nothing and closes a Framescaper hole.

`definition()` gains a frozen `renderers` field naming its executors: `'cpu'`
(mandatory), `'webgl'` iff the id appears in `EFFECT_CODES`, `'ffmpeg'` iff the
FFmpeg switch maps its filter. A registry test asserts the three declarations
agree with the three implementations, so the silent `[]` return and the FFmpeg
default throw become unreachable for a registered id. A `domains` field
(`'video' | 'photo'`, non-empty) lets the develop panel and the effect rack
each list what belongs to them without either filtering by a hardcoded id list.

### The CPU evaluator is the render of record; WebGL is a proxy accelerator

L4 adds `src/common/editor/visual-effect-cpu-evaluator.ts` and its per-family
operator modules: a deterministic, tiled, straight-RGBA evaluator executing a
normalized stack over a `RenderSampleProfileV1` buffer. It, not the compositor,
produces every pixel that is exported, zoomed to 1:1, or pinned as a golden.
Three verified facts force this. The compositor's 4096-axis and 64 MiB readback
ceilings mean it cannot render a 24-megapixel original at all. GPU results are
not byte-reproducible across drivers, so a GPU render of record cannot satisfy
"golden frames proving determinism across runs"
(roadmap-lightscaper.md:328-330) on CI hardware unlike a maintainer's. And the
pattern is in-tree: temporal denoise runs a WebGL2 accelerator, catches
failure, reports through `onAcceleratorFallback`, and falls back to a
deterministic CPU implementation (`video-motion-denoise-v27.ts:17-25,50-59`).
The roadmap's proxy carve-out makes the split honest — preview-resolution
derivatives stand in during editing while full resolution stays the render of
record for zoom and export (roadmap-lightscaper.md:74-78,322-324) — so
"byte-equal preview and export" is asserted where it means something: the 1:1
loupe evaluation and the export call one evaluator on one stack and must
produce identical bytes, while the proxy view is held to the recorded parity
thresholds. A divergence beyond threshold is a defect in the pair, and raising
the threshold is a reviewed budget change rather than a packet decision.

### Color grading is `VideoColorGradeV1` reached through the catalog

The `color-grade` definition's parameters are the wheels a photographer turns —
shadow, midtone, and highlight hue/saturation/luminance plus blending and
balance — and its normalizer projects them onto a `VideoColorGradeV1`
lift/gamma/gain triplet set (`video-color-management-v27.ts:62-72`), executed
by the existing `applyManagedSdrLinearGradeStackPixelV1` (`:268-289`).
`color-profile` carries only a `VideoCubeLutReferenceV1` and reuses that
executor with an identity grade, which is how `.cube` profiles land without a
second LUT path. Framescaper's presentation-level grade is untouched: both
routes call one implementation. Exposure lives in two places by design —
`VideoColorGradeV1.exposureStops` is grade-stage exposure, `tone-ladder` owns
Basic-panel exposure — and `color-adjust` is left exactly as it is, because it
sits inside `VIDEO_EFFECT_V5_TYPES` and its FFmpeg goldens are pinned.

### The Lightroom vocabulary maps onto the catalog like this

| Roadmap operation | Disposition | Catalog entry |
| --- | --- | --- |
| White balance | new | `white-balance` (temperature, tint) |
| Tone ladder | new | `tone-ladder` (exposure, contrast, highlights, shadows, whites, blacks) |
| Vibrance and saturation | new | `vibrance` (vibrance, saturation); plain saturation stays on `color-adjust` |
| Texture, clarity, dehaze | new | `presence` — local-contrast passes over the existing separable blur |
| Tone curve | new, `'curve'` kind | `tone-curve` (parametric region scalars plus rgb/red/green/blue point curves) |
| HSL mixer | new, `'band-set'` kind | `hsl-mixer` (eight bands × hue/saturation/luminance) |
| Black-and-white mix | new, `'band-set'` kind | `black-and-white-mix` (eight band weights) |
| Color-grading wheels | new, projects onto the grade model | `color-grade` |
| Sharpening | parameter extension | `sharpen` gains radius, detail, masking |
| Noise reduction | new, reuses an existing operator | `noise-reduction` over `processSpatialDenoiseV1` plus a chroma stage |
| Post-crop vignette | parameter extension plus ordering rule | `vignette` gains midpoint, roundness, feather, highlights, evaluated after geometry |
| Grain | new | `grain` (amount, size, roughness) with a per-photo deterministic seed |
| LUT profiles over `.cube` | reuse | `color-profile` over `VideoCubeLutReferenceV1` |
| — | unchanged, video domain | `color-adjust`, `pixelate`, `gaussian-blur`, `rgb-split`, `chroma-key`, `luma-key`, `spill-suppression`, `glow`, `outline`, `drop-shadow` |

### Presets are partial develop stacks; sync applies a preset

A develop preset is a validated, versioned record naming a subset of operation
ids and, per id, the parameter subset it carries. That makes full and partial
presets, copy/paste with a settings picker, sync, auto-sync, and relative
quick-develop one mechanism with five surfaces. Application resolves to
ordinary `effectsVideo` commands through `applyEditorCommand`, so history,
undo, and the Scape round trip come free and no batch is a second mutation
path. Quick-develop deltas clamp at descriptor bounds rather than throwing,
because `normalizeVideoEffectParams` refuses an out-of-range value outright
(`video-effects.js:169-175`).

### Geometry extends the composition model; perspective is a homography

Crop, straighten, rotate, flip, and aspect presets are the existing
`VideoClipComposition` fields (`video-clip-composition.ts:50-63,68-85`) with an
aspect-preset resolver and a straighten angle folded into
`transform.rotationDegrees`. Manual perspective correction is new: a normalized
3×3 homography with vertical, horizontal, rotate, aspect, scale, and offset
controls resolving to it. The preview vertex shader must divide by the third
component, and because that varying interpolates linearly the CPU evaluator
inverts the homography per output pixel instead.

### Rejected alternatives (recorded to prevent re-litigation)

| Alternative | Why rejected |
| --- | --- |
| Rename `video-effects.js` to a visual catalog with a compatibility re-export | Two live import paths for one registry across sixty-nine files; the ids are persisted document data, so the rename moves a filename and leaves the vocabulary video-flavored anyway. |
| Fork a photo catalog under `src/lightscaper/` | Violates the shared-effect rule (roadmap-lightscaper.md:38-42); two catalogs guarantee two renderers and two sets of goldens. |
| Special-case structured parameters per type in the normalizer | The audio `eq.bands` branch (`effects.js:422-448`) repeated thirteen times makes the registry unverifiable; declared kinds keep dispatch in one place. |
| Make the WebGL compositor the render of record | It refuses axes above 4096 and readbacks above 64 MiB, so it cannot render a 24-megapixel original, and GPU output is not byte-reproducible across runners. |
| A second grade model for photo color wheels | `VideoColorGradeV1` already carries lift/gamma/gain, saturation, and a digest-bound LUT with a tested executor; a parallel model guarantees divergence at handoff. |
| Auto-straighten or upright via a learned model | ML implementations sit behind the milestone-7 fence (roadmap-lightscaper.md:110-118); the optional geometric estimator is line-detection arithmetic and carries no model. |

## Phase structure

| Phase | Mode | Content |
| --- | --- | --- |
| L4.0 | Serialized (one work stream) | Parameter kinds, renderer/domain declarations, module split, CPU evaluator core, conformance harness, catalog-ordering repair |
| L4A | Parallel track | Tone and color operations (WP-L4A.0) |
| L4B | Parallel track, file-disjoint from L4A | Detail and texture operations (WP-L4B.0); geometry (WP-L4B.1) |
| L4C | Serialized after L4A and L4B | Develop workspace (WP-L4C.0), then proxy develop and exit evidence (WP-L4C.1) |

No packet after WP-L4.0 begins until every WP-L4.0 acceptance check passes.

## Work packets

Every L4 packet is decomposed here against the five fields (Outcome,
Invariants, Acceptance, Non-goals, Stop condition); no slice doc is owed at
pickup, and any packet that grows a slice doc names it here first.

### WP-L4.0 — Catalog widening, render authority, conformance harness

- **Outcome:** `parameter()` and `definition()` carry `kind`, `renderers`, and
  `domains`; validation dispatches on descriptor kind inside
  `video-effects.js`, `'curve'` delegating to `compileInterpolationCurve` and
  `'band-set'` validating a fixed-length named-band record; definition bodies
  move to `visual-effect-catalog-{tone,color,detail}.ts` with
  `video-effects.js` as the assembling entry point under 600 lines;
  `visual-effect-cpu-evaluator.ts` executes a stack over a
  `RenderSampleBufferV1` tile by tile under an abort signal, each tile
  carrying the `tile` descriptor that places it in the full image; a
  conformance harness renders any stack through both executors, reporting SSIM
  and per-channel MAE; `VIDEO_EFFECT_V5_TYPES` derives from an explicit id
  list.
- **Invariants:** no persisted `type` id changes; an existing stack of the
  twelve current effects normalizes to identical params, serializes to
  identical FFmpeg expressions, and renders identically; a definition whose
  declared renderers disagree with the implementations fails the registry test;
  a non-scalar keyframe target is refused; every operator reads position from
  the tile descriptor, never from the buffer's own width and height; the
  evaluator allocates per tile.
- **Acceptance:** `npm test -- --shard=common` runs
  `tests/audio-editor-visual-effect-catalog-declarations.test.ts` proving every
  id declares at least `'cpu'`, declared `'webgl'` equals
  `Object.keys(EFFECT_CODES)`, and declared `'ffmpeg'` equals the serializable
  set, plus `tests/audio-editor-visual-effect-cpu-evaluator.test.ts` pinning
  SHA-256 digests for all twelve existing effects at default and boundary
  parameters; `tests/audio-editor-video-effects.test.js` and
  `tests/audio-editor-video-keyframe-curves.test.ts` pass unmodified;
  `npx playwright test tests/browser/audio-editor-video-effects-parity.spec.js
  --project=chromium` passes unregenerated; `npm run check:architecture`
  passes with no new `config/maintainability-allowlist.json` entry; and
  `tests/audio-editor-build-chunk-ownership.test.ts` passes with the new
  modules given owners in `scripts/lib/build-chunk-groups.mjs`.
- **Non-goals:** no operation is registered here; no UI change; no Lightscaper
  module.
- **Stop condition:** stop if the evaluator and the compositor cannot reproduce
  any of the twelve existing effects within the recorded parity thresholds —
  the harness gates every later packet.

### WP-L4A.0 — Tone and color operations

- **Outcome:** `white-balance`, `tone-ladder`, `vibrance`, `tone-curve`,
  `hsl-mixer`, `black-and-white-mix`, `color-grade`, and `color-profile`
  registered with CPU operators, WebGL passes, `de`/`en` copy, and Framescaper
  rack controls for the `'curve'` and `'band-set'` kinds; `color-grade` and
  `color-profile` normalize onto `VideoColorGradeV1` and execute through
  `applyManagedSdrLinearGradeStackPixelV1`; and one new entry in
  `photo-process-version.ts` pinning the ordered semantics of the L4
  operation set, with its golden per L2's registry contract; the entry is
  added once for the milestone and never edited by a later packet.
- **Invariants:** every operation is renderable from Framescaper with no
  Lightscaper import in its path; managed-SDR admission still refuses HDR,
  wide-gamut, and legacy-unmanaged interpretations before any of them evaluates
  (`video-color-management-v27.ts:392-409`); a `'band-set'` or `'curve'`
  parameter reaches the WebGL pass encoder as a lookup texture, never as raw
  floats, because a pass carries two `vec4`s
  (`ui/video-preview-effects.js:44-45`); `color-adjust` stays byte-unchanged; a
  stack recorded under the pre-L4 `processVersion` renders through the pre-L4
  entry unchanged.
- **Acceptance:** `npm test -- --shard=common` runs
  `tests/audio-editor-visual-effect-tone-color.test.ts` (CPU digests at
  default, boundary, and neutral parameters per id, a neutral instance proving
  a byte identity) and the extended declarations test;
  `npm test -- --shard=framescaper` runs
  `tests/framescaper-visual-effect-authoring-tone-color.test.ts` authoring each
  id onto a Framescaper clip and rendering it under
  `applyVideoExactBrowserEffectsV27`'s ledger contract;
  `npm test -- --shard=lightscaper` runs the mirror over a `DevelopStackV1`
  and L2's `tests/lightscaper-process-version-goldens.test.ts` with the L4
  entry's golden;
  `npx playwright test
  tests/browser/audio-editor-visual-effect-conformance.spec.js
  --project=chromium` gains one case per id within the recorded parity
  thresholds; and `tests/i18n-runtime.test.js` passes with `de`/`en` parity
  for every new `videoEffect*` key.
- **Non-goals:** no masked application (L6); no histogram; no preset model; no
  geometry.
- **Stop condition:** stop if any operation's two implementations cannot meet
  the recorded thresholds without raising them.

### WP-L4B.0 — Detail, texture, noise, vignette, grain

- **Outcome:** `presence`, `noise-reduction` over `processSpatialDenoiseV1`
  plus a chroma stage, `grain` with a deterministic per-photo seed, extended
  `sharpen` (radius, detail, masking), and extended post-crop `vignette`
  (midpoint, roundness, feather, highlights).
- **Invariants:** extended `sharpen` and `vignette` reproduce pre-L4 output
  byte for byte at pre-L4 parameters on both the FFmpeg serialization
  (`video-effects.js:294-317`) and the shader; `grain` is a pure function of
  `(seed, x, y, params)` with no clock, no `Math.random`, and no dependence on
  tile boundaries, `(x, y)` being global image coordinates read from the tile
  descriptor rather than tile-local ones; pixel-radius parameters scale with
  evaluation resolution the way `videoEffectPasses` already scales sigma and
  offsets (`ui/video-preview-effects.js:414-425`).
- **Acceptance:** `npm test -- --shard=common` runs
  `tests/audio-editor-visual-effect-detail.test.ts`, including a tile-boundary
  case rendering one image as a single tile and as a 4×4 tiling and asserting
  byte equality, and a grain-determinism case;
  `npm test -- --shard=framescaper` and `npm test -- --shard=lightscaper` each
  author and render every new id; and the untouched
  `tests/browser/audio-editor-video-effects-parity.spec.js` still passes for
  `sharpen` and `vignette` unregenerated.
- **Non-goals:** no ML denoise (roadmap-lightscaper.md:110-118); no parametric
  heal or clone (L6); no temporal-denoise change.
- **Stop condition:** stop if `presence` or `noise-reduction` cannot produce
  tile-independent output — a tile-dependent operator makes the render of
  record depend on the tiling schedule.

### WP-L4B.1 — Geometry: crop, straighten, aspect, flip, perspective

- **Outcome:** aspect-preset resolution, straighten, rotate, flip, and crop
  over the existing composition record; a normalized perspective homography
  with vertical/horizontal/rotate/aspect/scale/offset controls resolving to it,
  the preview vertex shader performing the perspective divide and the CPU
  evaluator inverting it per output pixel; the ordering that post-crop
  `vignette` evaluates after geometry; optionally, geometric auto-straighten.
- **Invariants:** an identity homography leaves existing composition output
  byte-unchanged in both renderers; crop stays in the normalized
  `crop.{left,top,right,bottom}` domain (`video-clip-composition.ts:51-54`) so
  Framescaper keyframe descriptors keep working; geometry never resamples the
  original.
- **Acceptance:** `npm test -- --shard=common` runs
  `tests/audio-editor-visual-geometry-perspective.test.ts` pinning CPU digests
  for identity, pure-vertical, pure-horizontal, and combined homographies and
  asserting identity is a byte identity; `npm test -- --shard=framescaper`
  authors a perspective correction on a Framescaper clip and renders it; the
  conformance spec covers the four homography cases within the recorded
  thresholds; and when the optional auto-straighten lands,
  `tests/audio-editor-visual-geometry-autostraighten.test.ts` recovers a known
  rotation from a ruled fixture within 0.1 degrees, recorded as an
  `applicationFeatures` entry on the Lightscaper profile, not as a new
  `PROJECT_FEATURE_CAPABILITY_IDS` key — L1 owns that closed registry and the
  seven photo keys are its whole photo surface.
- **Non-goals:** auto/guided upright stays **Optional**
  (roadmap-lightscaper.md:320-321) and is not scheduled here; when taken it is
  an additional geometric estimator resolving to the same normalized
  homography this packet defines, under its own `applicationFeatures` entry
  rather than a new capability key, and never a learned model; no
  lens-profile correction; no content-aware fill of exposed corners.
- **Stop condition:** stop if the perspective divide changes any existing
  affine composition golden — it must be a no-op at `w == 1`.

### WP-L4C.0 — Develop workspace, presets, sync, quick develop

- **Outcome:** a Lightscaper develop workspace registered through the product
  profile's `panels`/`defaultWorkspace` (`src/framescaper/product.js:6-13` is
  the shape) carrying a histogram with clipping indicators over evaluator
  output, before/after and split views, per-version history and named
  snapshots, copy/paste with a settings picker, sync and auto-sync, and
  relative quick-develop batch adjustments; `photo-develop-preset-v1.ts`
  holding the partial develop-stack model applied through ordinary
  `effectsVideo` commands; and the `VideoEffectRack.jsx` parameter renderer
  extended with `'curve'` and `'band-set'` controls so Framescaper gains them
  too.
- **Invariants:** every mutation is one `applyEditorCommand` commit, so undo is
  single-step per gesture; drags coalesce through the existing gesture seam
  (`controller/video-effect-service.ts:251-264`); a preset never carries an
  instance identity (`video-visual-presentation-v27.ts:98-101`); an unknown
  preset field is rejected, not ignored; quick-develop deltas clamp; no path
  rewrites a stack's `processVersion` implicitly — only a `develop/set-stack`
  command carrying both the old and the new version, journaled with its
  inverse, may change it; preset application, sync, clipboard paste, Scape
  import, and cross-product handoff all preserve the stack's recorded version;
  every new surface is menu-reached and off by default (AGENTS.md:8-11).
- **Acceptance:** `npm test -- --shard=common` runs
  `tests/audio-editor-photo-develop-preset.test.ts` with property tests over
  generated stacks — apply-then-undo restores the stack exactly, partial
  application touches only the named operations, sync across N versions equals
  N independent applications, an unknown field is rejected, and a stack under
  an older `processVersion` renders to the same digest after a preset
  application that does not name its operations;
  `npm test -- --shard=lightscaper` runs
  `tests/lightscaper-develop-history-snapshots.test.ts`;
  `npx playwright test tests/browser/lightscaper-develop-loop.spec.js
  --project=chromium --project=firefox` completes open → adjust → compare →
  snapshot → copy → sync → preset keyboard-only with the histogram and both
  clipping indicators asserted visible; `tests/i18n-runtime.test.js` and
  `tests/production-capability-inventory.test.js` pass with `photoDevelop`
  flipped to `true` in the Lightscaper profile and its `projectFeatures`
  inventory row, the boolean, the row, and its evidence paths landing in one
  change and the key explicit in all three profiles.
- **Non-goals:** no mask UI (L6); no export dialog (L5); no WebKit claim.
- **Stop condition:** stop if any batch surface needs a mutation path that is
  not an ordinary command.

### WP-L4C.1 — Proxy develop, structural budgets, exit evidence

- **Outcome:** develop evaluation bound to L3's derivative tiers through a
  purpose/mode/pressure policy generalized out of
  `src/framescaper/editor-video-proxy-use-policy-v20.ts` into
  `src/common/editor/`, with Framescaper's tests moving with it; proxy results
  keyed by the derivative cache's recipe binding so a stack edit invalidates
  exactly the affected derivative; and a registered `l4-develop-interaction`
  workload with fixtures, the active CI environment, and structural thresholds
  for evaluator work — `develop.maximumProxyEvaluationPixels` (count),
  `develop.evaluationsPerAdjustGesture` (count),
  `develop.maximumRetainedEvaluationBuffers` (count) — plus the parity
  metrics, its collector and ledger row.
- **Invariants:** export and 1:1 zoom resolve to the original for every purpose
  that is not interactive preview
  (`editor-video-proxy-use-policy-v20.ts:46-51`); a proxy-evaluated pixel never
  reaches an export buffer; the 1:1 evaluation and the export are
  byte-identical apart from declared output-only steps
  (roadmap-lightscaper.md:74-81); an unavailable proxy degrades to the
  original, never to a stale render.
- **Acceptance:** `npm test -- --shard=common` runs
  `tests/audio-editor-visual-proxy-use-policy.test.ts` (moved, extended with
  the photo purposes) and
  `tests/audio-editor-photo-develop-proxy-invalidation.test.ts` proving a
  parameter change invalidates only derivatives bound to the changed recipe;
  `npx playwright test tests/browser/lightscaper-develop-proxy.spec.js
  --project=chromium` asserts the 1:1 digest equals the export digest and
  both differ from the proxy digest; and
  `node scripts/collect-l4-develop-interaction-quality.mjs` writes the ledger
  row and `tests/quality-budget-l4-structural-metric-units.test.ts` fails if
  any `l4-develop-interaction` threshold declares `ms`, `seconds`, or `RTF`;
  `npm run audit:quality-results` and `npm run check` pass.
- **Non-goals:** no export formats, sizing, output sharpening, watermarking, or
  metadata scopes (L5); no desktop tier (L8); no human or real-device evidence
  (L9).
- **Stop condition:** stop if the 1:1 evaluation and the export can diverge for
  any stack.

## Quality-budget and evidence duties

- Workload `l4-develop-interaction` registers in `config/quality-budgets.json`
  against the active `github-ubuntu-playwright-1.62.1` environment only; the
  unprovisioned owner-qualified descriptors are not claimed, and
  `portable-node-structural-26.5.0` stays frozen to milestone 2's five
  resource workloads (docs/quality-budgets.md:172-175). Thresholds cover
  proxy evaluation work, gesture-coalescing counts, and the parity pair. No
  elapsed-time threshold is registered: hosted CI is ineligible for timing
  qualification (docs/quality-budgets.md:76-78) and the portable structural
  environment is ineligible for elapsed time (:177-182). Real
  adjust-to-repaint and 1:1 evaluation timing on provisioned hardware is
  added to the existing L9 real-device row (roadmap-lightscaper.md:498-499);
  L4 creates no new L9 row.
- The metric ids `parity.videoMinimumSsim`, `parity.videoMaximumChannelMae`,
  and `parity.silentlyOmittedEffects` are reused rather than renamed, so
  `m4-production-render-parity` and the L4 workload speak one vocabulary;
  changing a value is a reviewed budget change, never a silent edit. Fixtures
  extend `video-effect-parity-rgba-v1`'s deterministic-generator pattern with
  pinned SHA-256 artifacts, adding a wide-tonal-range and a high-frequency
  detail chart.
- Coverage stays at the `.c8rc.json` union thresholds (lines 80, branches 70,
  functions 80 over `src/common/editor/**`), so the evaluator ships Node tests
  rather than browser specs the collector does not count. The `photoDevelop`
  capability key flipped on the Lightscaper profile needs a matching
  `projectFeatures` entry in every product block of
  `config/production-capabilities.json`, because
  `tests/production-capability-inventory.test.js:33` compares them with
  `deepEqual`.

## Coordination rules

- Spine files — one owner per edit, rebase before push, never staged with
  `git add -A`: `src/common/editor/video-effects.js`,
  `ui/video-preview-{effects,compositor,geometry-shader}`,
  `ui/inspector/VideoEffectRack.jsx`, `video-color-management-v27.ts`,
  `video-clip-composition.ts`, `commands/runtime-registry.ts`,
  `src/common/i18n/{video-effect-copy,catalogs}.js`,
  `src/framescaper/product.js` and the Lightscaper profile,
  `config/{production-capabilities,quality-budgets}.json`, the maintainability
  allowlist, `scripts/lib/build-chunk-groups.mjs`, and
  `tests/browser/audio-editor-video-effects-parity.spec.js`.
- The registry is edited by one packet at a time; L4A and L4B run in parallel
  only because their definition modules are disjoint, and the assembly list
  plus the `EFFECT_CODES` table are serialized between them, appended in id
  order, never inserted. Schema revisions stay serialized product-wide: the
  descriptor-kind widening, the preset record, and the perspective field are
  three, at most one in flight.
- A test reaching both `src/framescaper/` and `src/lightscaper/` lands in the
  `common` shard, because the classifier assigns any file with more than one
  product owner there (`scripts/lib/node-test-shards.mjs:42-48`); write the
  Framescaper-authorable proof as two single-product tests plus one
  cross-product test, not one file that silently moves shards. A test's shard
  follows its basename as well as its imports — the `PRODUCTS` table matches a
  product name in the filename (`:24-27`) — so the acceptance command and the
  filename are chosen together, and a `tests/lightscaper-*` file never runs
  under `--shard=common`.

## Known constraints this plan absorbs

- **The catalog-ordering pin breaks on the first new definition**
  (`video-effects.js:100-101`); WP-L4.0 converts the V5 set to an explicit id
  list before any append.
- **Eight floats per shader pass** mean a 24-value HSL mixer or a sampled curve
  uploads as a lookup texture, reconciled against `EFFECT_PROGRAM_COUNT = 18`
  (`ui/video-preview-effects.js:6`). That file also has eight lines of headroom
  — 592 against the 600-line default with no allowlist entry — so the first new
  shader branch forces an extraction.
- **The pixel interchange is 8-bit** — frames are `Uint8Array` end to end
  (`unified-exact-render-finishing-consumers-v13.ts:49-53`;
  `unified-exact-render-visual-materializer-v13.ts:72,195`) — so every operator
  is coded against `RenderSampleProfileV1` and L7 admits `unorm16` and
  `float32` without touching one. Managed SDR stays the only admitted color,
  refusing wide-gamut and HDR fail-closed
  (`video-color-management-v27.ts:400-408`).
- **WebKit is deferred:** the pinned Playwright build exposes no OPFS,
  MediaRecorder, or IndexedDB Blob storage (roadmap.md:270-276), so
  storage-dependent develop acceptance is Chromium plus Firefox.
- **L1 owes the third product seam:** `PRODUCT_IDS` still holds two entries
  (`src/common/products.js:4`) and the workspace switcher still branches on
  `productId === 'soundscaper'`
  (`ui/workspace/useAudioEditorWorkspaceLifecycle.js:107-112`).
- **L2 owes `DevelopStackV1`, `RenderSampleProfileV1`, and the process
  version;** if they are unlanded at pickup, L4.0 stops rather than defining
  them. The V30 still-image campaign owns still ingest — depend on it landing
  on `main`, never fork it (roadmap-lightscaper.md:57-61).

## Watch items (not gates yet)

- Banding in an 8-bit working buffer under an aggressive tone ladder plus
  curve: measured on the tonal-range fixture and recorded, closed by L7's
  deeper profile, never by an L4 dither.
- WebGPU as a compute path for the evaluator's hot operators once the platform
  reference is revalidated; it changes the accelerator, never the render of
  record.

## Non-goals and fences

- No local or masked adjustments, brush or gradient masks, or parametric
  healing — L6 owns all of them.
- No export formats, sizing, output sharpening, watermarking, metadata scopes,
  or sidecar write — L5 owns them, and L4 adds no second export stack beside
  `createExportPlan` (`src/common/editor/export.js:155`); no raw decode,
  wide-gamut output, or deeper-than-8-bit processing, which L7 activates
  through L2's profile without new export scope.
- No ML-based auto-settings, denoise, super-resolution, or upright;
  ML-dependent capability starts only under the milestone-7 rules, Electron
  Only with native-only inference, and is never a completion dependency
  (roadmap-lightscaper.md:110-118).
- No destructive raster editing, mutable tile-backed layers, or per-stroke
  document model; no tethered capture, camera control, or capture schema; no
  patent-encumbered codec input or output; no new third-party dependency
  without its licensing row, notice section, and `LICENSES/` text in the same
  change.
- No new always-visible chrome: every develop surface is menu-reached and off
  by default (AGENTS.md:8-11). No human, visual, or real-device evidence in any
  L4 acceptance: adjust-to-repaint and 1:1 evaluation timing on provisioned
  hardware is carried by the existing L9 real-device row
  (roadmap-lightscaper.md:498-499), and anything else that cannot be proved by
  CI or a deterministic script becomes a named L9 row.
