# Lightscaper milestone L6 plan: local adjustments and repair

> Owning source for L6 sequencing, the mask-graph, local-adjustment, and
> repair decisions, their invariants, and the bounded work packets. The
> [Lightscaper roadmap](../roadmap-lightscaper.md#l6-local-adjustments-and-repair)
> owns scope and status; the capability inventory, licensing policy, and
> quality-budget ledger own their claims. Grounded against the repository on
> 2026-08-25 at commit `3d1e908c` with file:line verification. L6 depends on
> L4 (lightscaper-4-plan.md) for the global operation set and the preset
> model and on L2 (lightscaper-2-plan.md) for `DevelopStackV1`,
> `RenderSampleFormatV1`, and process versions; it adds no export scope and no
> new milestone surface to L5. Re-ground every citation at pickup — earlier
> milestones will have moved the tree.

## Goals and ordering principle

1. **Primary: a local edit is still develop state.** Every artifact L6 adds
   is validated parameters that re-render from the original on every
   evaluation. No pixel buffer is authored, stored, or mutated; removing the
   develop state yields the original byte-identically
   (roadmap-lightscaper.md:69-71), and the destructive-raster fence —
   no brush-stroke painting into pixels, no tile-backed mutable raster
   layers, no per-stroke document model (roadmap-lightscaper.md:107-110) —
   stays literal, not reinterpreted.
2. **Secondary: one mask graph, widened — not a photo mask fork.** The new
   node kinds land inside the shared graph that already carries
   vector-shape, vector-path, raster, alpha, feather, invert, and boolean
   (`src/common/editor/video-mask-matte-v24.ts:38-95`) and its rasterizer
   (`video-mask-matte-rgba-v13.ts:16-40`), so Framescaper authors and
   renders every one of them. A Lightscaper-only mask kind is a placement
   defect (roadmap-lightscaper.md:38-41).

Work is ordered by contract risk: the coverage-buffer contract and the node
extraction land first because every later packet emits coverage, every later
node kind is normalized through the extracted module, and the 600-line
ceiling (`config/maintainability-allowlist.json:3`) forbids growing the graph
module in place.

## What already exists (do not re-plan)

- **The mask graph is complete, bounded, and closed-domain.** Seven node
  kinds (`src/common/editor/video-mask-matte-v24.ts:38-95`), a frozen limit
  record — depth 32, 4096 nodes, 16384 path points, 256 inputs, 64 boolean
  inputs (`:10-16`) — one normalizer that doubles as the validator
  (`:127-157`), canonical sorting of nodes by id (`:201`) and inputs by name
  (`:174`) that makes goldens order-independent, and Kahn traversal with
  depth accounting and an explicit cycle refusal (`:328-362`).
- **Node addition has three exact seams.** The pre-pass reads every node
  against the union field list with `id`/`kind` required
  (`video-mask-matte-v24.ts:118-121, 184`), the discriminant dispatch ends in
  a fail-closed refusal (`:194-199`), and `nodeReferences` (`:364-368`)
  decides what topology sees; a kind that misses one is rejected before its
  own normalizer runs.
- **Input bindings are kind-matched.** `validateInputBindings`
  (`video-mask-matte-v24.ts:319-326`) refuses a raster node bound to an
  alpha input and vice versa, and refuses a dangling name. Input kinds are
  exactly `raster | alpha` (`:21`).
- **The rasterizer is a memoized single-channel evaluator.** One
  `Uint8Array` per node cached by node id
  (`video-mask-matte-rgba-v13.ts:28-39`), a 33 554 432-pixel frame ceiling
  (`:25`), edge-clamped separable box feather capped at radius 64
  (`:161-190, 206-208`), Rec.709 luma weights (`:154-156`), and boolean
  composition as `max`/`min`/`min(a, 255-b)`/`abs(a-b)` (`:70-73`) —
  continuous, not set-theoretic, once coverage stops being binary.
- **Masks already cut alpha in both render paths.** The unified materializer
  multiplies frame alpha by coverage
  (`unified-exact-render-visual-materializer-v13.ts:61-72`); the Framescaper
  linear export path multiplies all four premultiplied channels
  (`video-export-visual-linear-v27.ts:75-85`). Neither gates an operation
  with coverage; both replace the picture's own alpha.
- **A float linear working buffer already exists.**
  `UnifiedExactLinearPremultipliedFrameV13` holds `Float64Array` pixels
  (`unified-exact-linear-rgba-v13.ts:16-20, 29-45`), while the interchange
  in and out stays 8-bit RGBA
  (`unified-exact-render-finishing-consumers-v13.ts:50-53, 281`;
  `unified-exact-render-visual-materializer-v13.ts:81`).
- **Masks attach through presentations.** `maskMatteIds` is a bounded,
  unique, ordered id list on `VideoVisualPresentationV1`
  (`video-visual-presentation-v27.ts:19-29, 60-63`) resolved to a
  `mask-matte` identity role by the render plan
  (`unified-exact-render-plan-v13.ts:168-175`); finishing presets
  deliberately donate no mask references (`:91-114`).
- **Mask authoring is already menu-reached in Framescaper.** The
  `video-mask-matte` surface
  (`src/framescaper/editor-selected-v27-visual-authoring-model.ts:12-15,
  69-70`), its `attachedMaskIds`/`selectedMaskId` fields (`:51-52, 98,
  117-118`), the `framescaper-edit-video-mask-matte` leaf
  (`src/common/editor/ui/framescaper-candidate-authoring-menu.ts:104-105`,
  filtered at `ui/application-menu-product-filter.js:29`), and the dialog
  fields (`ui/dialogs/FramescaperSelectedV27VisualAuthoringDialog.tsx:
  201-228`) together author exactly one rectangle-or-ellipse `vector-shape`
  (`editor-selected-v27-authoring-workflows.ts:115-127`).
- **Mask mutation is one compare-and-swap command.**
  `video-mask-matte/set` carries `expectedMaskMatte`, normalizes both sides
  (`src/framescaper/editor-project-v24-visual-command.ts:56-61, 172-180`),
  and applies through `replaceById` over `videoMaskMattes` (`:113-116`) under
  the 200-entry snapshot history (`src/common/editor/history.js:4`).
- **Processor stacks are the per-source pixel-processor seam.** Four kinds —
  tracking, similarity-stabilization, spatial-denoise, temporal-denoise
  (`video-motion-model-v27.ts:33-67`) — inside a source-bound stack (`:69-74`)
  reached from a presentation's `processorStackId`
  (`video-visual-presentation-v27.ts:27`), executed per frame with `enabled`
  honoured (`unified-exact-render-finishing-consumers-v13.ts:185-200`).
- **Adjustment layers target tracks, not regions.** `VideoAdjustmentLayerV1`
  carries a sequence range, `targetTrackIds`, and `effectIds`
  (`video-visual-model-v24.ts:107-116, 217-228`), authored as one command
  (`editor-selected-v27-authoring-workflows.ts:102-112`); it has no mask
  field and no spatial extent.

## Verified gaps this plan closes (grounded 2026-08-25)

- **No gradient or range node kind exists.** The seven kinds at
  `video-mask-matte-v24.ts:38-95` are the whole vocabulary; nothing produces
  a ramp, and nothing selects by luminance or color.
- **No mask can gate an operation.** Both consumers apply coverage to the
  picture's alpha (`unified-exact-render-visual-materializer-v13.ts:68-70`;
  `video-export-visual-linear-v27.ts:79-83`). There is no record anywhere
  that binds a mask id to a subset of operations.
- **Coverage is 8-bit in the type, not in an admission check.**
  `evaluateVideoMaskMatteRgbaV13` returns `Uint8Array<ArrayBuffer>`
  (`video-mask-matte-rgba-v13.ts:16-21`) — exactly the shape the standing
  constraint forbids, since the limit must live in an admission check, never
  in the types (roadmap-lightscaper.md:52-56).
- **No brush artifact of any kind exists.** No dab, stroke, stamp, or
  coverage-input concept appears anywhere under `src/common/editor/`.
- **No heal or clone operation exists.** The twelve shared video effects
  (`video-effects.js:29-98`) contain none, and the registry cannot hold one:
  every parameter must be a finite number inside scalar bounds
  (`:143-152, 168-176`), so a spot list is unrepresentable there.
- **The graph module has no headroom.** `video-mask-matte-v24.ts` is 409
  lines against a 600-line ceiling with no allowlist row
  (`config/maintainability-allowlist.json:3`); four node kinds plus brush
  admission exceed it.
- **Framescaper's mask surface authors one shape.** The authoring workflow
  emits a full-frame rectangle (`editor-selected-v27-authoring-workflows.ts:
  115-127`) and the dialog exposes shape, width, and height only
  (`FramescaperSelectedV27VisualAuthoringDialog.tsx:212-222`); there is no
  list, rename, duplicate, overlay, or composition surface in either
  product.
- **The Lightscaper shard does not exist.** `NODE_TEST_SHARD_IDS` is
  `common|framescaper|soundscaper` and the classifier hardcodes two products
  (`scripts/lib/node-test-shards.mjs:12, 24-27`); L1 owns the third.

## Decisions

### Coverage is a declared buffer, not a `Uint8Array` return type

L6 introduces `MaskCoverageV1`: a coverage buffer that declares its sample
format alongside its samples and admits `unorm8` only. It reuses L2's
`RenderSampleFormatV1` union and the named-refusal-code admission pattern and
declares its own single-channel admitted-format set — it carries no
`primaries`, `transfer`, `alphaMode`, or `channelOrder`, which have no meaning
for coverage. The evaluator becomes
`evaluateMaskCoverageV1(graph, width, height, inputs, format)`, and
`evaluateVideoMaskMatteRgbaV13` stays as a thin `unorm8` adapter so every
existing Framescaper call site (`video-export-visual-linear-v27.ts:78, 223`;
`selected-v27-exact-frame-support.ts:152`;
`selected-v28-openfx-exact-composition.ts:118`;
`unified-exact-render-visual-materializer-v13.ts:65`) and every existing
golden is byte-identical after the change. L7 then admits `unorm16` and
`float32` coverage by widening the admission set, with no schema, type, or
call-site change — which is the test WP-L6.0 writes and L7 flips.

This matters beyond tidiness. Gradient and range nodes produce continuous
coverage, so 8-bit quantizes a masked exposure ramp to 256 steps before it
reaches a float linear buffer that could carry far more
(`unified-exact-linear-rgba-v13.ts:19`); recording that as an admitted
format makes the loss a stated property of `unorm8` rather than an
invisible property of a return type.

### The brush is a bounded parametric dab set consumed through the raster node

This is the fence call, and it is resolved here, not deferred. A brush that
paints a mask is in scope; painting pixels is not
(roadmap-lightscaper.md:107-110). The line L6 draws:

- **What is authored** is `VideoMaskBrushV1`: an id and an unordered,
  canonically sorted, bounded set of dabs, each
  `{ x, y, radius, hardness, flow }` in normalized frame coordinates. The
  record's closed field list admits no color, no blend mode, no layer, no
  opacity-over-time, and no timestamp, and `readClosedDomainRecord`
  (`src/common/editor/closed-domain-value.ts:6-11`) refuses any field outside
  it, so a color cannot be smuggled in later without a reviewed schema change
  that this plan's test would fail.
- **What is stored** is that record. No pixel buffer, no tile, no layer, no
  history of strokes. Dab count is capped like every other graph bound, in
  the same frozen limits object.
- **What is evaluated** is coverage, rasterized from the dabs at the exact
  evaluation width and height on every evaluation, so the same brush is
  resolution-independent across proxy preview and full-resolution export.
  The fold is `max` over dabs — commutative, so authoring order is not
  state and the normalizer's canonical sort is lossless.
- **How it enters the graph** is the existing `raster` node, as the roadmap
  directs (roadmap-lightscaper.md:384). `VideoMaskMatteInputV1.kind` gains
  `coverage`; `validateInputBindings` (`video-mask-matte-v24.ts:319-326`)
  admits a `raster` node bound to a `coverage` input only when its
  `channel` is `luma`, and refuses `red|green|blue|alpha` fail-closed. The
  evaluator resolves `coverage` inputs from a brush map rather than the
  RGBA frame map, so a 33.5-megapixel brush costs one byte per pixel
  instead of the four an RGBA input would cost against the same ceiling
  (`video-mask-matte-rgba-v13.ts:25, 141-143`).
- **Erasing is composition, not stroke order.** A subtractive brush is a
  second `VideoMaskBrushV1` composed through the existing `boolean`
  `subtract` node (`video-mask-matte-v24.ts:81-86`), which is also the
  add/subtract/intersect vocabulary the management surface exposes
  (roadmap-lightscaper.md:385-387). No per-stroke ordering semantics enter
  the model, which is precisely the fenced "per-stroke document model".

### A local adjustment is a coverage-weighted composite in the working space

`PhotoLocalAdjustmentV1` binds one mask id, an ordered subset of L4
operation instances, and one `amount` in `[0, 1]`. Evaluation runs the
operation subset over the whole buffer and composites
`out = in * (1 - c*amount) + op(in) * (c*amount)` in the linear working
space the color context already declares
(`video-color-management-v27.ts:37-44`, `workingSpace: 'linear-rec709-d65'`),
using the existing `Float64Array` linear frame
(`unified-exact-linear-rgba-v13.ts:19`) rather than a new buffer type.

Two endpoints are exact by construction and both are pinned as goldens:
coverage 0 is byte-identical to the stack with the instance removed, and
coverage at full scale with `amount` 1 is byte-identical to the same
operations applied globally. That is what makes an empty mask a provable
no-op and a full mask a provable equivalence, and it is what keeps preview
and export the same render (roadmap-lightscaper.md:72-78).

### Maskability is declared on the operation, fail-closed

An operation is maskable only when its shared catalog entry declares it.
Geometry — crop, straighten, rotate, flip, perspective — is never maskable,
because it changes where pixels are rather than what they are, and an
output-only step is never maskable, because it runs after the develop stack
by definition (roadmap-lightscaper.md:75-77). An operation added later
without a declaration refuses admission into a local adjustment instead of
silently becoming maskable. L4 reserves the `maskable` field; L6 fills it
per operation and owns the admission predicate and its refusal.

### Range nodes sample the buffer entering the instance they gate

A `range-luminance` or `range-color` node binds a named `raster` input like
every other input-bound node, and the evaluator registers exactly one buffer
under the reserved source ref for a local adjustment: the buffer entering
the instance the mask gates. The instance's own output is never readable by
its mask, so no feedback path exists and evaluation stays a pure function of
the stack. Framescaper binds the same node kinds to ordinary named inputs,
so authorability is unchanged. Luminance uses the Rec.709 weights the raster
node's `luma` channel already uses
(`video-mask-matte-rgba-v13.ts:154-156`), so the two never disagree.

### Healing is a shared processor kind that samples the operation's input

`VideoHealSpotSetV1` is an ordered, bounded list of spots, each with a
target center and radius, a repositionable source offset, feather, mode
`clone | heal`, and opacity, all in normalized coordinates. Every spot in
one instance samples the buffer entering that instance, so reordering spots
cannot change the result and the golden is stable; cloning over a clone is
expressed by stacking a second instance, which keeps the capability without
making evaluation order-sensitive. Sampling is edge-clamped exactly as the
feather node clamps (`video-mask-matte-rgba-v13.ts:206-208`), so a source
disc that overhangs the frame renders deterministically, while a source
center outside the normalized frame refuses at normalize — the roadmap's
"out-of-bounds sources" gate (roadmap-lightscaper.md:397-399) needs both a
golden and a refusal.

Healing cannot be a `VIDEO_EFFECT_DEFINITIONS` row: that registry admits
only finite scalars inside declared bounds
(`video-effects.js:143-152, 168-176`). It follows the precedent of
`VideoColorGradeV1`, which is pixel-transforming, shared, and lives outside
the twelve-effect registry (`video-color-management-v27.ts:62-72`). For
Framescaper the spot set arrives as a fifth processor kind, `heal-spots`,
inside the existing source-bound stack (`video-motion-model-v27.ts:63-74`),
which already runs per frame with `enabled` honoured
(`unified-exact-render-finishing-consumers-v13.ts:185-200`) — so
authorability and renderability in Framescaper come from one vocabulary
addition rather than a parallel path.

### New kinds do not bump the graph schema version; unknown kinds refuse

`VideoMaskMatteGraphV1.schemaVersion` stays `1` (`video-mask-matte-v24.ts:98,
129-131`). A node or input kind is admitted by the project schema revision that
introduces it, and a build that predates the addition refuses the unknown kind
fail-closed at the discriminant (`:199`) or at the union field pre-pass
(`:184`). That is the recorded future-version behavior for this family, and it
is asserted rather than assumed. The admitting revision is the Lightscaper
project family's next number after L2's V31, claimed once in
`project-schema-version.ts` for the whole L6 addition set, with the
Framescaper-side admission riding that product's own current revision; the four
L6 records land under one number, not four. Every new node kind's evaluation
math is pinned to the develop stack's `processVersion`: changing a weight, a
falloff curve, or a color metric later is a new process version, never an edit
to an existing one (roadmap-lightscaper.md:79-81).

### Rejected alternatives (recorded to prevent re-litigation)

| Alternative | Why rejected |
| --- | --- |
| A `brush` node kind carrying dabs inline in the graph | The graph is copied whole by clipboard and preset paths (`src/framescaper/editor-session-clipboard-v8.ts:95, 179`); inlining up to a full dab budget per node would put paint-scale data into every copy and collide with the 4096-node bound. The roadmap also directs brush masks over the raster node (roadmap-lightscaper.md:384). |
| Storing brush coverage as a rasterized image in the media library | That is a stored pixel buffer for an edit — the destructive-raster fence (roadmap-lightscaper.md:107-110) — and it would break resolution independence between proxy preview and full-resolution export. |
| Ordered add/subtract dabs inside one brush record | Order-dependent dab folding is a per-stroke document model in all but name. Subtraction is a second brush through the existing `boolean subtract` node, which is already the composition vocabulary the UI exposes. |
| Extending `VideoAdjustmentLayerV1` with a mask field | It is a timeline-range, track-targeting record (`video-visual-model-v24.ts:107-116`) with no per-photo meaning; a local adjustment is a develop-stack instance, and conflating them would force Lightscaper into Framescaper's sequence model. |
| Applying coverage to alpha, as today's consumers do | Alpha cutting removes the picture (`unified-exact-render-visual-materializer-v13.ts:68-70`); gating an operation must leave the unmasked pixels untouched, which only the weighted composite gives. |
| Compositing masked results in the encoded 8-bit domain | The operations run in linear light (`video-color-management-v27.ts:37-44`); compositing elsewhere would make a full-coverage mask differ from the same operation applied globally, breaking the equivalence golden. |
| Keeping `Uint8Array` as the coverage return type and widening in L7 | The standing constraint puts the limit in an admission check, never the types (roadmap-lightscaper.md:52-56); deferring means L7 edits five call sites and every golden instead of one admitted format. |
| Heal spots sampling the accumulating buffer within one instance | Evaluation would become order-sensitive, so reordering spots would move pixels and no stable golden could exist. Stacking instances preserves clone-over-clone. |
| A heal entry in `VIDEO_EFFECT_DEFINITIONS` | The registry rejects any non-numeric parameter (`video-effects.js:170`), so a spot list cannot be expressed; forcing it would mean flattening spots into indexed scalars. |
| An ML subject/sky/person mask in L6 | Fenced to milestone 7's rules — Electron Only, native-only inference, never a completion dependency (roadmap-lightscaper.md:111-117). |

## Phase structure

| Phase | Mode | Content |
| --- | --- | --- |
| L6.0 | Serialized (one work stream) | Node-module extraction, `MaskCoverageV1` admission, adapter parity |
| L6A | Parallel track (shared schema) | Gradient and range node kinds; brush masks and the coverage input kind |
| L6B | Parallel track (shared render) | Mask-bound local adjustments; parametric heal and clone |
| L6C | Serialized after L6A and L6B | Mask management surface, overlays, browser workflow, capability block |

L6A and L6B must not begin until every WP-L6.0 acceptance check passes:
both consume the extracted node module and the coverage admission, and each
lettered track numbers from `.0`. L6C must not begin until both close, because
the management surface lists and composes the kinds they add.

## Work packets

Every L6 packet is decomposed here against the five fields; no slice doc is
owed at pickup, and a track that grows one names it here first.

### WP-L6.0 — Node-module extraction and the coverage contract

- **Outcome:** node normalizers, field lists, and scalar guards moved from
  `src/common/editor/video-mask-matte-v24.ts` into a new
  `video-mask-matte-nodes-v24.ts`, with the graph module keeping limits,
  topology, input binding, and the public normalizer and re-exporting every
  name it exports today so no call site changes; `MaskCoverageV1` and
  `evaluateMaskCoverageV1` in `video-mask-matte-coverage-v1.ts` declaring a
  sample format per buffer and admitting `unorm8` only;
  `evaluateVideoMaskMatteRgbaV13` reduced to an `unorm8` adapter.
- **Invariants:** every existing mask golden is byte-identical after the
  change; the admitted format set is data read by an admission check, never a
  type; neither module carries a `config/maintainability-allowlist.json` row.
- **Acceptance:** `npm run check:architecture` passes with no new allowlist
  entry; `npm test -- --shard=common` runs
  `tests/audio-editor-video-mask-matte-v24.test.ts` unchanged plus a new
  `tests/audio-editor-video-mask-coverage-v1.test.ts` that pins the admitted
  set to `unorm8`, refuses `unorm16` and `float32` at admission, and proves
  the refusal moves by editing the admitted set alone;
  `npm test -- --shard=framescaper` keeps
  `tests/audio-editor-framescaper-video-export-visual-v27.test.ts` and
  `tests/audio-editor-framescaper-selected-v27-exact-frame-execution.test.ts`
  green unmodified; `npm run typecheck` passes.
- **Non-goals:** no new node kind, no new input kind, no evaluator math
  change, no widening of the admitted format set.
- **Stop condition:** stop if any existing golden moves by one byte — the
  extraction is behavior-preserving or it is wrong.

### WP-L6A.0 — Gradient and range node kinds

- **Outcome:** `linear-gradient` (start and end points, midpoint bias),
  `radial-gradient` (center, two radii, rotation, feather),
  `range-luminance` (bound input, low, high, softness), and `range-color`
  (bound input, reference triplet, tolerance, softness) added to the shared
  node union, its union field list, its discriminant dispatch, its
  `nodeReferences` treatment, and `validateInputBindings`; their evaluators
  added to the coverage evaluator; the Framescaper authoring model, dialog,
  and command path extended to author each kind.
- **Invariants:** unknown fields and out-of-range scalars refuse at
  normalize; a degenerate linear gradient (zero-length axis) and a range
  with `low > high` refuse fail-closed; normalization stays idempotent and
  the canonical node sort is unchanged; coverage from a range node depends
  only on the bound input, never on the gated instance's output.
- **Acceptance:** `npm test -- --shard=common` runs a new
  `tests/audio-editor-video-mask-matte-node-kinds-v1.test.ts` (property
  tests: idempotent normalize, deep-frozen output, closed field lists, both
  bound ends of every scalar, degenerate refusals, canonical ordering) and a
  new `tests/audio-editor-video-mask-coverage-node-kinds.test.ts` (goldens
  pinning coverage bytes for each kind at a fixed 16×16 evaluation, plus
  empty, inverted, and each of the four boolean compositions over
  continuous coverage); `npm test -- --shard=framescaper` runs an extension
  of `tests/audio-editor-framescaper-selected-v27-authoring.test.ts` that
  authors each new kind through `video-mask-matte/set` and renders it in the
  same suite run.
- **Non-goals:** no brush, no local adjustment binding, no UI beyond the
  existing Framescaper mask surface, no perceptual color metric.
- **Stop condition:** stop if any new kind needs a graph-level field or a
  second evaluation pass — the kind belongs inside one node or not at all.

### WP-L6A.1 — Brush masks over the raster node

- **Outcome:** `VideoMaskBrushV1` in `src/common/editor/video-mask-brush-v24.ts`
  — id plus a bounded, canonically sorted dab set with a closed field list
  admitting no color; `coverage` added to `VideoMaskMatteInputV1.kind` with
  the `luma`-only raster binding rule; the evaluator resolving coverage
  inputs from a brush map and refusing a missing brush the way it refuses a
  missing frame source (`video-mask-matte-rgba-v13.ts:54-56`); a
  `video-mask-brush/set` compare-and-swap command beside
  `video-mask-matte/set`; a Framescaper authoring path that creates a brush
  and binds it through an ordinary raster node.
- **Invariants:** no brush field carries color, layer, or ordering; dab
  folding is `max` and therefore order-independent; coverage is rasterized
  at the evaluation dimensions on every evaluation, never cached to storage;
  a `coverage` input bound to a non-`luma` channel refuses.
- **Acceptance:** `npm test -- --shard=common` runs a new
  `tests/audio-editor-video-mask-brush-v24.test.ts` proving the closed field
  list refuses a `color` field, that shuffling the dab array yields an
  identical normalized record and identical coverage bytes, that the same
  brush evaluated at 32×32 and 64×64 agrees after nearest-neighbor
  downscale within the pinned tolerance, and that a `coverage` input bound
  with `channel: 'red'` refuses; `npm test -- --shard=framescaper` proves a
  brush authored and bound in Framescaper renders in the same suite run.
- **Non-goals:** no pressure, tilt, or input-device model; no stroke
  interpolation stored as a path; no erase mode inside the record.
- **Stop condition:** stop if brush coverage must be persisted as pixels to
  meet any interaction budget — the budget moves to a watch item and the
  brush stays parametric.

### WP-L6B.0 — Mask-bound local adjustment instances

- **Outcome:** `PhotoLocalAdjustmentV1` in
  `src/common/editor/photo-local-adjustment-v1.ts` binding one mask id, an
  ordered subset of L4 operation instances, and an `amount`; L4's reserved
  `maskable` field filled per operation and its fail-closed admission over the
  shared operation catalog; the coverage-weighted composite implemented once in
  the linear working buffer and consumed by both the unified materializer path
  and the Framescaper linear export path; L2's reserved `localAdjustments` slot
  populated and its validator tightened from empty-only to the L6 record shape.
- **Invariants:** coverage 0 renders byte-identically to the stack with the
  instance removed; full coverage at `amount` 1 renders byte-identically to
  the same operations applied globally; preview and export evaluate the same
  composite; an operation without a `maskable` declaration refuses; a
  geometry or output-only operation can never be admitted.
- **Acceptance:** `npm test -- --shard=common` runs a new
  `tests/audio-editor-photo-local-adjustment-v1.test.ts` with both
  byte-identity goldens, the empty-mask no-op case, the inverted-mask case,
  a boolean-composed mask over two gradients, a graph whose output is a
  range node, and the refusal of an undeclared and of a geometry operation;
  the same shard runs
  `tests/quality-budget-l6-masked-evaluation-collector.test.ts`, which derives
  each structural metric over the pinned fixture and asserts it against the
  threshold read from `config/quality-budgets.json`, never a repeated literal;
  `npm test -- --shard=framescaper` proves the identical composite through
  `tests/audio-editor-framescaper-video-export-visual-v27.test.ts` extended
  with a masked-operation fixture, so preview and export goldens are
  produced in one suite run.
- **Non-goals:** no new operation (L4 owns the set); no preset changes (L4
  owns the preset model); no export-path option.
- **Stop condition:** stop if the preview and export composites cannot be
  driven from one implementation — two implementations are the divergence
  the boundary forbids (roadmap-lightscaper.md:72-78).

### WP-L6B.1 — Parametric heal and clone

- **Outcome:** `VideoHealSpotSetV1` in
  `src/common/editor/video-heal-spot-v1.ts` (ordered spots; target center and
  radius; repositionable source offset; feather; `clone | heal`; opacity; all
  normalized), a `heal-spots` processor kind in the shared processor union, its
  evaluator sampling the instance's input buffer with edge-clamped reads, a
  visualize-spots overlay model that reports spot and source outlines without
  touching pixels, and L2's reserved `repairInstances` slot populated with its
  validator tightened from empty-only to the L6 record shape.
- **Invariants:** the spot set is parameters only — no sampled patch is
  stored; every evaluation re-derives from the instance input; removing the
  instance restores the buffer byte-identically; a source center outside the
  normalized frame refuses at normalize while an overhanging source disc
  renders edge-clamped; spot order does not change the result.
- **Acceptance:** `npm test -- --shard=common` runs a new
  `tests/audio-editor-video-heal-spot-v1.test.ts` proving the digest of the
  render with the heal instance removed equals the digest of the untouched
  decode, that permuting the spot array leaves coverage and pixels
  byte-identical, that an overhanging source matches its pinned golden, that
  an out-of-frame source center refuses, and that the record's closed field
  list refuses a `pixels` or `patch` field; `npm test -- --shard=framescaper`
  proves a `heal-spots` processor authored into a stack renders through
  `unified-exact-render-finishing-consumers-v13.ts` in the same suite run.
- **Non-goals:** no content-aware fill, no ML inpainting, no automatic spot
  detection — all three are milestone-7 fenced
  (roadmap-lightscaper.md:111-117).
- **Stop condition:** stop if any heal mode needs to read a previously
  healed buffer within the same instance; that mode becomes a second
  instance instead.

### WP-L6C.0 — Mask management surface and browser workflow

- **Outcome:** a menu-reached mask management surface in
  `src/common/editor/ui/` listing every mask on the selected version with
  rename, duplicate, delete, add/subtract/intersect composition against an
  existing mask, and per-mask enable; overlay visualization modes (coverage
  tint, coverage on black, coverage on white) rendered from the same
  coverage evaluator the render uses; keyboard reachability across the whole
  surface; i18n copy in `src/common/i18n/`; `photoLocalAdjustments` flipped to
  `true` in the Lightscaper profile and in its `projectFeatures` row in
  `config/production-capabilities.json`, boolean, row, and evidence paths
  moving in one change (`tests/production-capability-inventory.test.js:33`).
- **Invariants:** the surface is menu-reached and off by default
  (AGENTS.md:8-11); the overlay reads the same coverage bytes the render
  consumes, so what is shown is what is applied; every action is one
  compare-and-swap command under the shared history.
- **Acceptance:** `npm run test:browser -- --project=chromium
  --project=firefox tests/browser/lightscaper-develop-local-adjustments.spec.js`
  authors a gradient mask, composes a brush into it with subtract, toggles
  each overlay mode, and asserts the overlay element visible and the
  coverage sample under a fixed pixel matching the evaluator — all through
  keyboard interaction only; `npm run test:browser -- --project=chromium
  tests/browser/framescaper-v27-visual-authoring-menu.spec.js` runs an
  extension proving the same mask-management surface is reachable and
  keyboard-operable in Framescaper; `npm test -- --shard=common` runs
  `tests/production-capability-inventory.test.js` over the new row.
- **Non-goals:** no always-visible panel, rail, or toolbar; no mask
  animation over time; no WebKit claim — the qualified storage matrix is
  Chromium and Firefox today (roadmap.md:271-274).
- **Stop condition:** stop if any overlay mode needs its own evaluator; one
  evaluator feeds both the overlay and the render or the overlay lies.

## Quality-budget and evidence duties

- A workload `l6-masked-develop-evaluation` with a pinned fixture (one photo,
  one gradient mask, one full-budget brush, one boolean composition, one
  eight-spot heal instance) is registered in `config/quality-budgets.json`
  against `portable-node-structural-26.5.0` (`:357`) for structural
  determinism only — coverage buffers allocated per evaluation, peak retained
  coverage bytes, dab-budget refusals — in the existing workload shape
  (`fixtureIds`, `environmentIds`, `thresholds`, `evidence`). No latency
  threshold is registered: `github-ubuntu-playwright-1.62.1` is
  `qualificationEligible: false` (`:342`) and hosted CI is ineligible for
  timing qualification (docs/quality-budgets.md:76-78). Masked-evaluation
  interaction timing on provisioned hardware joins the existing L9 real-device
  row (roadmap-lightscaper.md:503-505); WP-L6B.0 owns the workload and
  proposes its thresholds with the measurement, never backfilled.
- Correctness, refusal, and golden suites run in ordinary CI through
  `npm run check`; only latency thresholds qualify on a named environment and
  L6 registers none, so qualified masked-evaluation latency rides the L9
  real-device row rather than this plan, and `npm run audit:quality-results`
  inside `npm run audit:ci` enforces ledger integrity.
- The `photoLocalAdjustments` row added by WP-L6C.0 carries evidence paths that
  exist on disk, asserted by `tests/production-capability-inventory.test.js`.
- L6 adds no third-party dependency, so no
  `config/production-licensing-matrix.json` row, `THIRD_PARTY_LICENSES.md`
  section, `LICENSES/` text, or `build:*`/`audit:*` pair is owed; a packet
  that reaches for one stops and the dependency is reviewed first.

## Coordination rules

- **Spine files — one owner per edit, rebase before push:**
  `src/common/editor/video-mask-matte-v24.ts` and the new
  `video-mask-matte-nodes-v24.ts`, `video-mask-matte-rgba-v13.ts` and the
  new `video-mask-matte-coverage-v1.ts`,
  `src/common/editor/video-visual-presentation-v27.ts`,
  `src/common/editor/video-motion-model-v27.ts`,
  `src/framescaper/editor-project-v24-visual-command.ts`,
  `src/common/editor/unified-exact-render-plan-v13.ts`,
  `src/common/editor/unified-exact-render-visual-materializer-v13.ts`,
  `src/framescaper/video-export-visual-linear-v27.ts`,
  `src/common/editor/ui/framescaper-candidate-authoring-menu.ts`,
  `src/common/editor/ui/application-menu-product-filter.js`,
  `src/common/i18n/catalogs.js`, `config/production-capabilities.json`,
  `config/quality-budgets.json`, `config/maintainability-allowlist.json`.
- A test's shard follows its basename as well as its imports
  (`scripts/lib/node-test-shards.mjs:42-47`) and only top-level
  `tests/*.test.*` files enter a Node shard (`:29-34`), so browser specs run
  through `npm run test:browser`: command and filename are chosen together.
- WP-L6.0 touches the graph and rasterizer modules alone and must land
  before anything else opens them; L6A and L6B then run file-disjoint —
  node kinds and brush to L6A, adjustment binding and heal to L6B — with
  the presentation and processor schemas owned by L6B.
- Schema revisions stay serialized product-wide: the node/input-kind addition,
  the brush record, the heal processor kind, and the local-adjustment record
  land under one Lightscaper project-schema number claimed once in
  `project-schema-version.ts`, and the packets that fill it serialize behind it.
- This tree is edited by many concurrent sessions: stage explicit paths,
  confirm `git diff --cached --name-only` before committing, and verify in a
  detached worktree rather than trusting a local gate run.
- Shared fate on repo gates; `npm run check` stays green on every push.

## Known constraints this plan absorbs

- **The graph module has no headroom** (409 lines against a 600-line ceiling,
  `config/maintainability-allowlist.json:3`), so WP-L6.0's extraction is a
  prerequisite, not a cleanup.
- **L4 dependency:** the global operation set and the preset model are L4's
  (lightscaper-4-plan.md); L6 consumes them by name and fills the `maskable`
  field L4 reserves. If an operation a packet wants to mask has not landed,
  the packet masks what exists and the rest follows L4.
- **L2 dependency:** `DevelopStackV1`'s mask bindings, its reserved
  `localAdjustments` and `repairInstances` slots, `processVersion`, and
  `RenderSampleFormatV1` are L2's (lightscaper-2-plan.md); `MaskCoverageV1`
  reuses that format union and its admission pattern rather than defining a
  second sample vocabulary, and declares its own single-channel admitted set.
- **L1 dependency:** the `lightscaper` Node shard and the architecture rules
  for `src/lightscaper/` are L1's (lightscaper-1-plan.md); the classifier
  hardcodes two products today (`scripts/lib/node-test-shards.mjs:12, 24-27`),
  so until the shard lands, shared tests land in `common` and product tests
  wait.
- **Boolean composition is continuous, not set-theoretic** once coverage
  stops being binary (`video-mask-matte-rgba-v13.ts:70-73`); WP-L6A.0 pins it
  with goldens so a later "fix" is a reviewed process-version change.
- **Feather is a box blur capped at radius 64**
  (`video-mask-matte-rgba-v13.ts:167`), so gradient falloff is authored in
  the gradient node, never obtained by feathering a hard shape.
- **The frame ceiling is 33 554 432 pixels**
  (`video-mask-matte-rgba-v13.ts:25`): a larger full-resolution masked
  evaluation refuses rather than silently downscaling, and proxy develop is
  the ordinary path (roadmap-lightscaper.md:72-75).
- **WebKit is not in the qualified storage matrix** (roadmap.md:271-274), so
  WP-L6C.0's browser acceptance names Chromium and Firefox, and says why.

## Watch items (not gates yet)

- Coverage precision under `unorm8`: banding on a masked exposure ramp is a
  measurable property of the admitted format, and L7's `unorm16` admission
  answers it, not an L6 change.
- A perceptual color metric for `range-color`; today's metric is the
  encoded-RGB distance the raster node already samples, and a change is a
  new process version.
- Brush dab budgets against real authoring: if a plausible mask exceeds the
  cap, the cap is raised with its evaluation cost measured, never removed.
- Keyframed mask parameters: photos have no time, so L6 adds none, and any
  animation rides the existing keyframe curves
  (`src/common/editor/video-keyframe-curves.ts:49-52`) in a Framescaper packet
  — as does the `heal-spots` processor's per-frame cost inside the processor
  loop (`unified-exact-render-finishing-consumers-v13.ts:185-200`), a
  Framescaper budget rather than an L6 gate.

## Non-goals and fences

- No destructive raster editing: no painting into pixels, no tile-backed
  mutable raster layer, no per-stroke document model
  (roadmap-lightscaper.md:107-110). Brush and heal are parameters that
  re-render from the original.
- No general raster paint editor (roadmap-lightscaper.md:97). No ML masks,
  ML denoise, content-aware remove, or auto-settings: milestone 7's rules
  govern them, and none is a completion dependency (`:111-117`).
- Red-eye correction stays **Optional** (roadmap-lightscaper.md:391) and is
  not scheduled in this plan. When taken, it is a third `heal-spots` mode
  over the same record, never a new schema family.
- No capture or tethering surface of any kind (`:103-106`).
- No export scope: L5 owns export (lightscaper-5-plan.md), and masked stacks
  reach it through the existing plan seam (`src/common/editor/export.js:155`)
  unchanged. No new third-party dependency, codec, or patent-encumbered format
  (roadmap-lightscaper.md:118-119).
- Every new surface is menu-reached and off by default (AGENTS.md:8-11).
