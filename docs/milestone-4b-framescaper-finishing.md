# Milestone 4B pickup: Framescaper finishing

> Owning pickup contract for the Framescaper half of milestone 4. The
> [milestone-4 plan](milestone-4-plan.md) owns shared sequencing and the
> [roadmap](../roadmap.md#4-parallel-production-surfaces) owns product scope.
> This document owns the 4B packet boundaries and the exact 4B-1 persisted,
> command, rendering, preservation, UI, and acceptance contracts.

## Pickup status and sequencing

**Status on 2026-08-21:** the 4B-1 implementation candidate is complete apart
from manual qualification. 4B-2 is **In progress**. 4B-3 through
4B-8 are planned. The owner has separately cleared Soundscaper 4A sequencing;
its V21 local implementation candidate is **Implemented (provisional)** and the
maintained Soundscaper route is selected under the
[4A pickup contract](milestone-4a-soundscaper-production.md), without a
qualification or milestone-completion claim.

The 4B-1 browser implementation candidate includes exact V19 composition state,
commands/history, clipboard V5 and edit preservation, the shared render
description, WebGL and FFmpeg consumers, localized menu editing, browser
storage, current-format `.scape`, copy-only cross-product handoff, and the
calibrated browser/FFmpeg golden matrix. Packaged Framescaper deliberately remains
on its qualified V18/desktop-V10 authority until a complete V19/desktop-V11
transport and proxy/timing archive port exists. The owner-designated Windows
x64 RTX 3090 reference run passed the golden and keyed-parity rows. Manual
packaged qualification is still open; therefore neither this packet
nor milestone 4B is recorded complete by the implementation candidate.

The 4B-2 candidate now includes the dormant exact V20 keyframe domain, bounded
stale-safe commands/history, clipboard V6 and edit-carrier preservation,
current-format `.scape` preservation, the menu-opened keyframe editor, a shared
lazy render-state provider, exact live WebGL preview evaluation, isolated V20
browser storage/runtime composition, and a pre-I/O static-export refusal. Its
dormant export path owns exact export-range and rational-rate timing authority,
an immutable random-access frame source, exact CFR/VFR presentation authority,
occurrence-scoped HTML-video seeking, a bounded offline WebGL RGBA renderer,
linked A/V muxing, bounded SharedArrayBuffer FFmpeg inputs, and both Blob and
direct-sink delivery. The V20 product export strategy and lifecycle acceptance,
dormant security controls, semantic preview/offline parity collector, and
provisional keyed quality registration have also landed. Real Chromium
witnesses cover seeking, WebGL orientation/composition, backpressure, MP4
output, and the dormant product lifecycle.

4B-2 remains **In progress**. The 2026-08-21 owner-designated fixed-GPU run is
the accepted external keyed-parity reference pass; completed manual
qualification is still absent. Both product profiles still advertise
`videoKeyframes` as unavailable, the capability remains false, the browser App
route remains V19, the packaged desktop route remains V18, and V20 is not
selected. Capability/profile/App-route activation remains open and must not be
inferred from the implemented dormant path or its provisional evidence.

The project owner explicitly cleared the milestone-3 implementation sequencing
gate for Framescaper 4B against the current maintained base. That clearance is
implementation authority, not completion or qualification evidence: milestone
3 remains recorded **In progress**, and its manual and packaged-runtime
qualifications remain open or `pending-external`. The milestone-4 reference-GPU
row is passed by the owner-designated run; no unrelated row is relabelled or
waived by this pickup.

The shared 4.0 interpolation, parameter-address, and hosted parity foundations
are implemented. The interpolation vocabulary stores exact clip-relative
rational positions and finite numeric values, and evaluates without choosing a
renderer rounding policy (`src/common/editor/interpolation-curve.ts:35-47,
87-160`). 4B consumes that vocabulary; it does not introduce normalized
keyframe time.

Framescaper currently owns exact project V18 around an unchanged V17
foundation (`src/framescaper/editor-project-v18.ts:40-64` and
`editor-project-v18-validation.ts:56-110`). Its playback and command projections
strip only product-private authority before invoking shared consumers
(`editor-project-v18-runtime.ts:37-80` and
`editor-project-v18-commands.ts:36-69`). 4B-1 therefore opens exact
Framescaper **V19** and follows the same product-owned pattern. Earlier schemas
require typed re-import, future schemas remain opaque and intrinsically
read-only, and the new revision is atomic with its validators, history,
storage, commands, requirements, profiles, fixtures, and selected bootstrap.
There is no pre-release V18 migration.

Schema revisions remain serialized product-wide: one revision is in flight,
with one owner for the command protocol, registry, capability profiles,
compatibility register, application menus, i18n catalogs, and version pins.
Leaf render work may proceed in parallel only after the wire and resolver
contracts below are fixed.

## 4B packet map

The implementation order is:

1. Transform, crop, and compositing controls.
2. Keyframes over geometry and effect parameters.
3. Explicit video transition objects and registry.
4. Selection-aware inspector plus registered new source and clip kinds.
5. Color and motion finishing with deterministic fallbacks.
6. Styled caption tracks and sidecar interchange.
7. Framescaper audio finishing.
8. Exit evidence.

Each document-bearing packet repeats the full registration path from
`docs/milestone-4-plan.md`: exact command discriminants in exactly one domain,
both product profiles initially unavailable, one owned-state predicate and
compatibility rule, capability-policy enforcement at direct and generic
authoring paths, normalizer idempotence and semantic-survival tests, and one
controller mutation path.

## 4B-1 — Transform, crop, and compositing controls

### Outcome and boundaries

Persist one renderer-neutral `videoComposition` value on every timeline and
Project Bin video clip, resolve it once into a serializable visual operation,
and make both WebGL preview and FFmpeg export consume that operation. Provide
Framescaper-only, menu-reached editing for crop, anchor, position, scale,
rotation, flip, opacity, blend mode, and compositing order.

This packet is static. It reserves stable property identities for 4B-2 but adds
no keyframe arrays, transition objects, masks, mattes, titles, still images,
generators, adjustment layers, color management, tracking, or caption state.
It does not persist a WebGL matrix, FFmpeg filter expression, viewport, output
pixel rectangle, source decode size, or any other renderer-derived field.

### Exact persisted value

Every exact-V19 video clip, including a Project Bin video clip, has this own
closed record. An audio clip must not carry the field.

```ts
interface VideoClipCompositionV1 {
	readonly schemaVersion: 1;
	readonly crop: {
		readonly left: number;
		readonly top: number;
		readonly right: number;
		readonly bottom: number;
	};
	readonly transform: {
		readonly anchorX: number;
		readonly anchorY: number;
		readonly positionX: number;
		readonly positionY: number;
		readonly scaleX: number;
		readonly scaleY: number;
		readonly rotationDegrees: number;
		readonly flipHorizontal: boolean;
		readonly flipVertical: boolean;
	};
	readonly opacity: number;
	readonly blendMode:
		| 'normal'
		| 'multiply'
		| 'screen'
		| 'overlay'
		| 'darken'
		| 'lighten'
		| 'difference'
		| 'exclusion';
	readonly compositingOrder: number;
}
```

The units, bounds, and canonical defaults are:

| Field | Unit and meaning | Accepted range | Default |
| --- | --- | --- | --- |
| `crop.left/top/right/bottom` | Fraction of the full oriented display aperture removed at that edge | Each `[0, 1]`; `left + right < 1`; `top + bottom < 1` | `0` |
| `transform.anchorX/Y` | Fraction of the full oriented display aperture | `[0, 1]` | `0.5` |
| `transform.positionX/Y` | Neutral-biased translation in sequence-canvas extents; displacement is `(position - 0.5) * canvasExtent` | `[-8, 8]` | `0.5` |
| `transform.scaleX/Y` | Positive multiplier about the anchor | `[0.01, 100]` | `1` |
| `transform.rotationDegrees` | Clockwise degrees in the top-left-origin display coordinate system | `[-36000, 36000]`; never modulo-normalized | `0` |
| `transform.flipHorizontal/Vertical` | Reflection about the anchor before rotation | Boolean | `false` |
| `opacity` | Static alpha multiplier | `[0, 1]` | `1` |
| `blendMode` | Closed shared blend formula | Enum above | `'normal'` |
| `compositingOrder` | Signed layer priority; larger values are nearer the foreground | Safe integer `[-32768, 32767]` | `0` |

All numeric values are finite and must not be negative zero. Negative zero is
rejected because JSON would silently rewrite it and make an exact validation
path a repair path. Values are rejected rather than clamped, wrapped, rounded,
or defaulted. The top-level, crop, and transform records accept only their own
enumerable data properties with ordinary or null prototypes; accessors,
symbols, extra keys, arrays, functions, `NaN`, and infinities reject. The
normalizer snapshots into a detached recursively frozen value. Normalizing a
canonical value is idempotent, and the all-default constant is recursively
frozen.

The field is mandatory on video clips so there is one exact current wire, not
an absent/default dialect. Constructors create the default. Clone and
normalization detach nested records, so two clips never share mutable crop or
transform state.

### Stable property identities for 4B-2

The following identifiers are frozen now and are scoped to the owning video
clip composition:

- Numeric: `crop.left`, `crop.top`, `crop.right`, `crop.bottom`,
  `transform.anchorX`, `transform.anchorY`, `transform.positionX`,
  `transform.positionY`, `transform.scaleX`, `transform.scaleY`,
  `transform.rotationDegrees`, and `opacity`.
- Discrete: `transform.flipHorizontal`, `transform.flipVertical`, `blendMode`,
  and `compositingOrder`.

4B-2 may interpolate the numeric identities. Discrete identities, if exposed
to keyframes, use hold segments only. A keyframe time is an exact nonnegative
clip-relative rational position; these spatial fractions are values and do not
weaken the normalized-time storage ban.

### Source, crop, and affine semantics

The renderer-neutral resolver receives an already oriented and
pixel-aspect-reconciled source display size, the positive-integer sequence
canvas, one canonical composition, and optional transition opacity endpoints.
It does not inspect a persisted source, decoder, HTML video, WebGL context, or
FFmpeg feature.

Coordinates use a top-left origin, x increasing right, y increasing down, and
positive rotation clockwise. The current contain fit remains the identity
base. For source display size `(sourceWidth, sourceHeight)` and canvas
`(canvasWidth, canvasHeight)`:

```text
fitScale  = min(canvasWidth / sourceWidth, canvasHeight / sourceHeight)
fitWidth  = max(1, round(sourceWidth * fitScale))
fitHeight = max(1, round(sourceHeight * fitScale))
fitX      = round((canvasWidth  - fitWidth)  / 2)
fitY      = round((canvasHeight - fitHeight) / 2)
```

These are the existing contain-fit rounding rules
(`src/common/editor/ui/video-preview-viewports.js:8-16`). The transform anchor
in this fitted aperture is:

```text
anchor = (fitX + anchorX * fitWidth, fitY + anchorY * fitHeight)
offset = ((positionX - 0.5) * canvasWidth,
          (positionY - 0.5) * canvasHeight)
```

For a source-display point first mapped into the contain-fit as `q`, its output
point is `anchor + offset + R * S * F * (q - anchor)`, where `F` applies the two
reflections, `S` applies the positive x/y scale, and `R` is the clockwise
rotation matrix in the y-down coordinate system. Position is deliberately an
offset from the integer-rounded contain fit rather than an absolute canvas
anchor. Therefore every default value reproduces the current fit exactly even
when odd source/canvas parity places the fitted centre half a pixel away from
the mathematical canvas centre.

Crop coordinates are authoritative fractions of the full oriented display
aperture. The retained half-open rectangle is
`[left, 1 - right) × [top, 1 - bottom)`. Crop makes pixels outside that
rectangle transparent; it does not resize, zoom, recalculate the contain fit,
or change the anchor. A crop edge may be subpixel. Its source-pixel rectangle
is continuous (`x = left * sourceWidth`, and correspondingly for y, width, and
height) and is never integer-rounded into persisted or resolved authority.
Sampling uses bilinear interpolation at output-pixel centres; the crop mask is
evaluated against the corresponding continuous source coordinate, with
transparent samples outside the source or retained rectangle.

The visual pipeline is ordered once:

1. Reconcile the decoder output to the source's oriented display aperture,
   using the existing display-presentation authority
   (`src/common/editor/video-source-presentation.ts:51-92`).
2. Apply the existing integer-rounded contain fit to the full aperture.
3. Apply the existing video-effect stack in that untransformed contained
   aperture, preserving today's effect order.
4. Apply the crop mask.
5. Apply flip, scale, and clockwise rotation about the anchor, then the
   neutral-biased canvas translation.
6. Multiply the clip's static opacity by its implicit-transition opacity.
7. Blend the completed track layer into the destination in resolved painter
   order.

Effects therefore move with the clip and crop clips their output. Effects do
not receive an inverse renderer transform and no renderer may choose a
different effect/crop order.

### Painter order, implicit transitions, and blend math

Project track order stays foreground-first, while renderer input stays
bottom-to-top (`src/common/editor/video-timeline.js:95-108`). Active video
track layers are sorted bottom-to-top by:

1. `compositingOrder`, ascending; then
2. project `trackIndex`, descending.

Higher `compositingOrder` is nearer the foreground. Equal order values preserve
today's painter order exactly. Sorts are stable; clip IDs and source IDs are
never hidden tie-breakers.

An existing same-track two-clip overlap remains one atomic implicit-transition
layer. The outgoing and incoming clips must have equal `blendMode` and
`compositingOrder`; validation rejects an overlap that does not. Geometry and
static opacity may differ. Each static opacity multiplies its current
complementary linear transition weight
(`src/common/editor/video-timeline.js:118-145, 450-463`), after which the pair
is mixed outgoing then incoming into one track layer exactly as today. A UI
change to blend mode or order on either member of an existing transition
updates both members in one stale-safe batch; no temporarily invalid project is
published.

Blend modes operate on unassociated channel values in `[0, 1]` in the current
unmanaged encoded canvas RGB space. 4B-1 does not silently introduce a linear
working space; that decision belongs to 4B-5's color contract. For backdrop
`Cb` and source `Cs`, each channel's blend function `B` is:

```text
normal     Cs
multiply   Cb * Cs
screen     Cb + Cs - Cb * Cs
overlay    Cb <= 0.5 ? 2 * Cb * Cs : 1 - 2 * (1 - Cb) * (1 - Cs)
darken     min(Cb, Cs)
lighten    max(Cb, Cs)
difference abs(Cb - Cs)
exclusion  Cb + Cs - 2 * Cb * Cs
```

With unassociated alphas `ab` and `as`, the shared formula produces
premultiplied output:

```text
ao = as + ab * (1 - as)
co = as * (1 - ab) * Cs
   + as * ab * B(Cb, Cs)
   + (1 - as) * ab * Cb
```

Preview and export implement these equations, including color conversion and
clamping, rather than delegating to backend blend-mode names. The sequence
background remains the export plan's opaque background color, black by
default.

### Renderer-neutral contract

`src/common/editor/video-render-description.ts` owns the only spatial
resolution. Its maintained entry point accepts:

```ts
resolveVideoRenderDescription({
	composition,
	sourceDisplaySize: { width, height },
	canvas: { width, height },
	opacityStart = 1,
	opacityEnd = opacityStart,
})
```

It returns a detached recursively frozen JSON-safe record containing the
normalized and continuous source-pixel crop rectangles, one six-scalar
source-display-to-canvas affine matrix that already incorporates the integer
contain fit, effective opacity endpoints after the static multiplier, the
blend mode, and the compositing order. Domain calculation uses JavaScript
double precision. A backend rounds only when it rasterizes a named output
pixel; it does not re-derive geometry from the persisted composition.

The WebGL compositor replaces viewport-only placement and its fixed full-screen
quad assumption (`src/common/editor/ui/video-preview-compositor.js:154-170,
341-415`) with affine/crop sampling and a destination-aware blend pass. Its
structured ledger records requested, rendered, fallback-rendered, and omitted
geometry/blend operations and renderer failure; an unsupported operation is
never silently treated as identity.

The serializable video-export plan advances from version 5 to version 6 and
carries the exact resolved description beside each composition clip
(`src/common/editor/video-export.js:173-212, 234-307`). FFmpeg plan
normalization validates every scalar, enum, opacity endpoint, affine, crop, and
ordering constraint before media I/O, and filter construction consumes the
validated operation (`src/common/editor/video-ffmpeg.js:553-632`). FFmpeg must
not infer the operation from clip fields or use a backend blend alias whose
formula differs. The all-default render descriptor is a regression fixture and
must remain pixel-equivalent to the current contain-fit, normal source-over
pipeline.

### Command and controller contract

Add the exact discriminant `video-composition/set` to
`src/common/editor/commands/protocol.ts` with payload:

```ts
{
	readonly clipId: string;
	readonly expectedComposition: VideoClipCompositionV1;
	readonly composition: VideoClipCompositionV1;
}
```

It belongs to exactly one focused `videoComposition` command domain. The
handler resolves a globally unique timeline or Project Bin clip ID, requires a
video clip, compares the canonical current value to `expectedComposition`,
normalizes the replacement, and mutates no other state. Reset is the same
command with the canonical default, not a second command. A stale expected
value, unavailable capability, locked owning track, intrinsically read-only
project, invalid transition pair, or invalid replacement rejects before
publication and leaves history untouched.

An ordinary set is one controller commit and one revision. Updating the shared
blend/order of an existing implicit transition is a two-child `batch`, still
one commit and one undo entry. Undo and redo restore detached canonical values
and continue the V19 monotone revision/timestamp rules. The common single
mutation boundary remains `controller.actions.edit.commit` through
`src/common/editor/controller/project-mutation-service.ts:143-163`; no dialog,
preview, renderer, or product bootstrap mutates a project directly.

Capability policy covers the direct command and recursive batches. It also
covers every generic carrier able to introduce nondefault composition:
`clip/add`, Project Bin add/place, clipboard paste, insert/overwrite/replace,
and product commands that materialize nested or multicamera clips. A product
without authoring capability may preserve existing state but may not introduce,
erase, reset, or replace it through a generic command.

### Menu and inspector path

The only new UI entry is Framescaper-only:

```text
Edit > Clip boundaries > Transform and compositing…
```

It sits beside the existing menu-reached Clip properties item
(`src/common/editor/ui/application-menus.js:261-274`), is enabled only for one
selected writable video clip, and opens a lazy product-owned dialog/inspector
through the existing workspace-overlay pattern
(`src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx:4-9,
82-94`). No toolbar button, panel, side rail, badge, handle, or inline control
becomes visible by default.

The dialog groups Crop, Transform, and Compositing fields. Position is shown as
a signed percentage offset where persisted `0.5` displays as `0%`; scale,
opacity, and crop use localized percentage presentation without changing their
wire units; rotation uses degrees; order uses an integer input; blend uses a
native accessible select; flips use labelled checkboxes. Reset applies the
canonical default. Blur or Enter commits one accepted edit, Escape closes,
focus returns to the invoking menu path, invalid input remains announced and
uncommitted, and read-only state disables all mutation. English and German
catalogs carry the complete labels and errors.

### Registration and compatibility

Add capability key `videoGeometry` with feature ID
`org.soundscaper.capability.video-geometry`. Both product capability profiles
register it initially unavailable. Framescaper flips it available only in the
same change that passes the native command, inspector, preview, export,
persistence, and parity workflows. Soundscaper keeps it known unavailable.
The existing `videoCompositing` capability continues to describe today's
layered video playback and is not overloaded with this authoring contract.

Any nondefault composition in timeline or Project Bin state owns exactly this
reserved requirement:

```json
{
	"id": "framescaper.video-geometry",
	"featureId": "org.soundscaper.capability.video-geometry",
	"displayName": "Video transforms and compositing",
	"disposition": "bypass",
	"fallback": null
}
```

All-default mandatory values do not invent a requirement. Missing, stray,
reserved-ID-conflicting, publisher-substituted same-feature, and rendered-
fallback declarations reject. The capability is excluded from the generic
audio and video rendered-fallback eligibility sets because 4B-1 defines no
canonical geometry fallback publication or revert workflow. A product where it
is unavailable opens the exact current document only through the maintained
explicit read-only-or-cancel decision and preserves the value opaquely; it
never previews or exports a silently ignored identity transform.

V19 updates the Framescaper runtime, storage, archive, desktop-library,
controller, and selected bootstrap version pins atomically. It retains Scape
formats 1 and 2, advances the fresh desktop library to V11 metadata with SQLite
`user_version` 13 and a `v11` library scope, and never mutates historical V10
catalog state. Explicit Framescaper-to-Soundscaper transfer is copy-only V19
preservation with activation/editing forbidden; transfer back to a V19
Framescaper owner is byte- and semantic-stable.

The session clipboard advances to V5. V5 explicitly carries and detaches
`videoComposition`; V4 requires recopy rather than silently inventing a value.
Current-format `.scape`, browser storage, archive cloning, desktop handoff, and
history carry the exact record. Opaque extension fields are not a composition
transport.

### Edit-primitive preservation matrix

| Operation | Required composition behavior |
| --- | --- |
| Move, trim, roll, ripple, slip, slide, stretch, group, link, unlink | Preserve the exact canonical value |
| Split | Put equal, detached canonical values on both children |
| Join | Admit only clips with equal canonical compositions; retain one detached copy |
| Source replace, reprobe, relink | Preserve composition; source display geometry is resolved afresh at render time |
| Project Bin move/add/place | Preserve the value and detach each placed timeline copy |
| Clipboard copy/paste and duplicate | V5 carries the value; every pasted or duplicated clip owns detached nested records |
| Insert, overwrite, punch, range replace | Preserve or clone according to the source clip; never default an existing nondefault value |
| Nested-sequence materialization | Carry the leaf clip's composition through the transient materialized clip; never persist the resolved affine |
| Multicamera source switch | Preserve the output clip's composition; changing the active source only changes the resolved source display input |
| Delete | Remove the deleted clip's value and reconcile the owned requirement |

Existing spread-based nested materialization
(`src/framescaper/editor-project-v18-nested-playback.ts:196-229`) is not accepted
as proof by inspection. Project Bin placement and clipboard paths currently
special-case only `videoEffects`
(`src/common/editor/commands/project-source-bin-runtime.js:248-290` and
`commands/clipboard-runtime.js:140-180, 525-560`); 4B-1 adds explicit detached
composition handling and focused tests at those paths.

### Acceptance

1. The value normalizer rejects hostile prototypes, accessors, symbols, extra
   keys, arrays, negative zero, nonfinite values, range failures, invalid crop
   sums, unknown modes, noninteger order, and composition on audio clips. It
   proves default construction, recursive freeze, detachment, idempotence, and
   semantic equality.
2. Exact V19 create, validate, clone, load/save, history, selected runtime,
   typed V18 re-import refusal, future opaque-read-only handling, Project Bin,
   `.scape`, browser storage, archive, desktop V11, and copy-only cross-product
   fixtures preserve the value.
3. Requirement tests cover empty/default and nondefault timeline/bin state,
   missing and stray declarations, reserved and same-feature conflicts, both
   profiles, direct and nested-batch capability policy, and every generic
   authoring carrier.
4. Command tests cover stale expected values, one-revision set/reset,
   transition-pair batch, lock/read-only refusal, no partial mutation, and
   undo/redo.
5. The complete edit-primitive table above proves semantic preservation and
   nested-record detachment. Different-composition joins and mismatched
   transition blend/order reject.
6. Resolver vectors cover odd-parity identity contain fit, each crop edge,
   noncentral anchors, both flips, nonuniform scale, clockwise rotations,
   off-canvas translations, static/transition opacity multiplication, stable
   painter-order ties, and changed order.
7. Blend vectors cover transparent, translucent, and opaque source/backdrop
   values for every enum and compare the shared formula independently of both
   renderers.
8. Preview unit tests cover affine/crop sampling and a complete structured
   ledger. Export-plan-V6 and FFmpeg tests validate and execute the same
   descriptors, and malformed or unsupported operations fail closed before
   media I/O.
9. The calibrated 128×72 browser/FFmpeg fixture covers every blend mode and a
   combined crop/anchor/flip/nonuniform-scale/rotation/translation/order case.
   Preview/export acceptance is SSIM at least `0.98`, maximum channel MAE at
   most `6/255`, and zero silently omitted operations under
   `m4-production-render-parity` (`config/quality-budgets.json:1132-1150`).
10. Chromium proves Framescaper menu reachability, keyboard operation, focus
    return, announced validation, reset, undo/redo, save/reopen, forced colors,
    serious axe checks, and no Soundscaper entry. The canonical non-browser
    gate and production chunk ceiling remain green.

### Stop conditions

Stop 4B-1 if either renderer needs a persisted private field, if the all-default
descriptor changes an existing pixel, if a backend blend alias replaces the
shared formula, if one edit primitive drops or aliases the value, if unsupported
state can open writable in a product that cannot render it, if a parity
threshold would need loosening, or if the UI requires a new default-visible
surface.

## 4B-2 — Keyframes

### Persisted keyframe domain wire

Every V20 video clip owns the mandatory closed field `videoKeyframes`. Its
canonical V1 value is
`{ schemaVersion: 1, timeDomain: { authoredDuration, viewStart, viewDuration }, curves: [...] }`.
All three time-domain fields are canonical reduced rational objects in sequence
frames. `authoredDuration` and `viewDuration` are positive, `viewStart` is
nonnegative, and `viewStart + viewDuration <= authoredDuration`. A fresh clip's
contextual empty value uses its exact `sequenceFrameCount` for both duration
fields and zero for `viewStart`; there is no context-free persisted default.

Each curve is a closed `{ target, curve: { anchors, segments } }` record. A
target is either `{ kind: 'composition', parameterId }` for an explicitly
interpolable numeric 4B-1 property, or
`{ kind: 'video-effect', effectId, parameterId }` for a parameter registered by
the referenced effect instance's type. `compositingOrder`, flips, and blend mode
are not V1 composition targets. Registered integer effect parameters use
integer-valued anchors and hold segments only. Curves are sorted by a
collision-free canonical target key and duplicate targets reject.

A clip admits at most 256 curves, which is the bounded local lane cap beneath
the existing project traversal ceiling. Each curve has 2 through 4,096 anchors.
Every anchor and Bezier control time is a canonical reduced rational object
within the inclusive authored domain `0..authoredDuration`; anchors are
strictly increasing and need not cover either endpoint because evaluation holds
the nearest endpoint outside the authored interval. Persisted rationals retain
the shared denominator ceiling. Values and Bezier value controls are finite,
are not negative zero, and remain within the target's registered range.
Evaluation returns a detached canonical target/value patch and persists no
samples, matrices, or other derived state.

A visible clip-local query `p` maps exactly to authored position
`viewStart + p * viewDuration / sequenceFrameCount`. That affine operation
cross-cancels as one exact ratio before exposing a public rational; the derived
query may use the wider safe coordinate denominator domain without widening the
persisted anchor/control wire or converting through floating point.

Crop curves preserve the composition's cross-field invariant over their whole
path. Left/right curves, when both present, have identical anchor positions,
segment kinds, and Bezier control positions; top/bottom follow the same rule.
An absent opposite side is the constant base-composition value. Every paired
anchor and Bezier control retains a conservative minimum aperture of `1e-9`;
this prevents separately rounded binary64 evaluation from closing a crop whose
persisted control polygon merely compares below one. Normalization receives the
owning clip's exact positive visible duration, canonical base composition, and
current registered video-effect stack so target existence, ranges, and crop
validity are contextual rather than duplicated in the persisted wire.

Edits preserve the complete authored curve and change only the exact view
window unless extension requires growing the authored domain:

- trim maps both requested visible-local boundaries through the affine rule and
  stores that authored subwindow; the canonical planner carries an explicit
  old-clip-local `sequenceTrimRange` beside final placement so ripple
  relocation and rounded source coordinates cannot change intent, and an
  ambiguous source-changing canonical command refuses; it inserts no boundary
  anchors;
- extension before authored zero translates every anchor and Bezier control,
  the prior view, and the authored end by one exact positive offset, while
  extension after the authored end grows `authoredDuration`;
- split gives both detached children the complete identical authored curve and
  partitions the prior view at the exact mapped split position;
- stretch changes only the owning clip's `sequenceFrameCount`; the time domain
  and complete authored curve remain byte-equivalent, so the view stretches;
- rejoin is defined only for identical complete authored curves/domains,
  ordered adjacent views, and one exact view-to-visible stretch rate; it
  concatenates the views without curve reconstruction; and
- transient nested/subsequence leaf materialization applies the same trim rule
  to its leaf subrange. Persisted nested source occurrences remain unchanged.

Every edit computes and normalizes a detached candidate before replacement. It
refuses transactionally if a shifted persisted rational or authored extent
cannot remain canonical within the persisted safe-integer and denominator
limits. No trim, split, stretch, rejoin, or nested projection subdivides an
eased/Bezier segment, samples an endpoint, or persists a derived approximation.

The present implementation includes the exact V20 model/domain, bounded
stale-safe commands and history, exact edit/clipboard/Project-Bin carrier
preservation, portable `.scape` preservation, a menu-opened keyframe editor,
and a dormant preview consumer. A project-snapshot-scoped provider compiles
keyed clips lazily and resolves their composition and effect state from the
actual program-preview sample through the exact visible-local mapping above;
legacy clips do not enter that path, and invalid keyed state blanks the program
preview with a localized error instead of rendering static state. Static export
rejects animated state before media or FFmpeg I/O.

The dormant offline path authenticates one bounded immutable project and
active-source inventory, acquires one exact export range and reduced rational
frame rate, and carries exact CFR/VFR presentation descriptors into
occurrence-scoped HTML-video seek ports. It renders each frame through the
shared WebGL compositor into one reused RGBA allocation, streams keyed RGBA and
optional exact-range audio through bounded SharedArrayBuffer rings, muxes AAC
for MP4 or Opus for WebM, and publishes through either bounded Blob collection
or a structure- and digest-bound direct sink. Its version-7 plan and V20 product
strategy retain project, source, timing, generation, currentness, and
cancellation authority through encode and publication cleanup. Product-level
browser acceptance covers edit/undo/redo/save/reopen, stale refusal, Blob and
direct publication, cancellation, and cleanup while production gates stay
untouched.

Dormant security controls now register exact V20 admission, keyed export
authority, bounded keyed RGBA/A/V encoding, Blob publication, direct MP4/WebM
delivery, and rollback without activating a route. The semantic keyed parity
collector compares preview and offline consumers with an independent oracle
and rejects omissions, substitutions, fallbacks, or mutually wrong agreement;
its quality workload is provisional correctness evidence only. Both product
profiles still register `videoKeyframes` as known but unavailable, the browser
App remains on V19, the packaged desktop remains on V18, and the isolated V20
environment/bootstrap remain unselected. The accepted external keyed-parity
reference pass satisfies the GPU row, but capability availability must not
flip until manual qualification exists and the capability, profiles, and App
routes are deliberately activated together.

- **Outcome:** Add bounded keyframe curves to the numeric 4B-1 property IDs and
  registered video-effect parameters, with copy/paste, preset, and stale-safe
  editing through the selection-aware inspector.
- **Dependencies:** 4B-1's wire, affine resolver, renderer parity, and stable
  IDs; the implemented 4.0 interpolation vocabulary.
- **Invariants:** Every persisted time is a canonical authored-domain rational;
  the exact view map preserves trim-in anchoring; points are strictly
  ordered and bounded to 4,096 per curve under the project-wide node ceiling;
  integer effect parameters are hold-only; derived samples, view queries, and
  evaluated matrices are not persisted.
- **Acceptance:** Hold, linear, eased, and Bézier vectors; trim/split/join,
  copy/paste/preset, nested/multicam, undo/redo, storage, renderer parity, point
  caps, and hostile-input tests.
- **Non-goals:** No motion tracking, expression language, spatial Bézier path
  editor, or normalized time.
- **Stop condition:** Stop if a keyframe requires renderer-owned state, a
  normalized position, or an unbounded point collection.

## 4B-3 — Explicit video transitions

### Outcome, dependency, and clean break

Replace every inferred same-track video overlap crossfade with one explicit,
track-owned transition object. The object carries stable identity, an open
structural type slug, exact clip-pair ownership, alignment, duration, and one
curve from the shared interpolation vocabulary. A static first-party registry
initially maintains `dissolve`; future maintained types extend that registry
rather than extending the wire shape or accepting project-supplied code.

4B-3 depends on 4B-1's atomic track-layer composition and on 4B-2's exact curve
and preview/export foundations. V22 implementation must start from a clean,
selected, and fully qualified V20 activation boundary. It must not select V22,
flip a transition capability, or mix a V20 activation repair into a transition
schema change while the current V20 route, storage, export, or packaged
authority remains dormant. The current 4B-2 work above therefore does not
authorize an early V22 product selection. V21 is now allocated to the
owner-authorized Soundscaper 4A automation/mixer/PDC revision; 4B-3 remains
planned and unimplemented, so its reservation moves without changing any
implemented V18, V19, or V20 statement.

Exact V22 has no implicit-transition dialect. A version-gated adapter may
continue to present inferred linear dissolves for schema versions at most 20,
but it must construct a transient descriptor and call the same resolver as
V22. It never writes V22 state. Exact-current validation never invents an
object or an ID. A typed V20 re-import/factory adapter may convert a proper
legacy overlap only when its caller supplies the explicit fresh transition ID;
it creates the default dissolve below before strict V22 validation. Raw V20
load remains a typed re-import refusal, not an in-place migration.

### Exact V22 ownership and wire

Every video track has one mandatory `videoTransitions` array. Audio and label
tracks must not carry that property, no transition is clip-owned, and the
Project Bin has no transition collection. A Project Bin video clip may carry
composition and keyframes, but a transition exists only between two timeline
occurrences on one sequence track.

```ts
interface VideoTransitionV1 {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly type: string;
	readonly outgoingClipId: string;
	readonly incomingClipId: string;
	readonly alignment:
		| 'start-at-cut'
		| 'center-on-cut'
		| 'end-at-cut';
	readonly durationFrames: number;
	readonly curve: {
		readonly anchors: readonly InterpolationAnchor[];
		readonly segments: readonly InterpolationShape[];
	};
}
```

The transition record and its curve, anchor, control, and segment records are
closed values with ordinary or null prototypes and own enumerable data
properties. Accessors, symbols, extra keys, arrays in record positions,
negative zero, nonfinite numbers, binary values, functions, and noncanonical
rationals reject before cloning. Normalization returns detached recursively
frozen values and is idempotent.

`id` is a canonical stable ID and is globally unique in the project, including
against every source, clip, track, sequence, and other transition identity. A
normalizer, validator, command handler, clipboard decoder, or edit runtime
never allocates one. `type` is a canonical lowercase slug matching
`[a-z][a-z0-9-]{0,63}`. That grammar is deliberately open: structural
normalization accepts and preserves an unknown slug without consulting the
first-party registry.

`durationFrames` is a positive safe integer and must equal the owning proper
overlap's exact sequence-frame duration. A curve has 2 through 4,096 anchors,
exactly one fewer segment, and only the shared `hold`, `linear`, `eased`, and
Bezier segment shapes. Positions are canonical exact rationals, strictly
increase from exact `0` to exact `durationFrames`, and every Bezier control
position obeys the shared within-segment ordering rules. The first anchor is
exactly `(0, 0)` and the last is exactly `(durationFrames, 1)`. Every anchor
value and every Bezier value control is finite and in `[0, 1]`. Values need not
be monotone, so an authored maintained type may reverse progress without a
second curve language; the resolver still range-checks every evaluated result.

For one track, sort clips by the existing canonical sequence placement and ID
tie rules. If outgoing clip `O` is followed by incoming clip `I`, define:

```text
S = I.sequenceStartFrame
E = O.sequenceStartFrame + O.sequenceFrameCount
D = E - S
```

`[S, E)` is a proper overlap only when
`O.sequenceStartFrame < S < E < I.sequenceStartFrame + I.sequenceFrameCount`.
Every proper overlap has exactly one transition whose outgoing and incoming
IDs match those roles, and every transition names exactly one such overlap on
its owning track and sequence. Its `durationFrames` equals `D`. The two clips
retain the 4B-1 requirement for equal blend mode and compositing order. A
disjoint or merely touching pair has no transition. Nested/equal-boundary
overlaps, a reversed pair, a dangling or cross-track/cross-sequence reference,
two objects for one pair, an unowned object, and any interval with three active
clips reject.

V22 TDD must freeze four deliberately unresolved protocol details before any
schema implementation: deterministic `videoTransitions` array ordering;
explicit per-track and project transition-count and duration ceilings; the
closed field inventory of `CanonicalTransitionClipEdges` below; and the
enclosing topology-allocation collection field/discriminant. The generic
project node budget is not a substitute for transition-specific caps. The
tests must also freeze the exact owned-requirement display-name literals. Stop
before schema code if any of these remains implicit or if implementations
choose different private shapes.

### Default dissolve and cut alignment

The explicit default for an overlap of duration `D` is a fresh-ID
`type: 'dissolve'`, `alignment: 'center-on-cut'` transition with anchors
`(0, 0)` and `(D, 1)` joined by one `linear` segment. The ID and clip references
come from the owning factory, import planner, or edit command; they are not
defaults. The curve is evaluated over the overlap regardless of alignment.
Alignment owns editorial cut anchoring for a boundary edit; it does not move
curve time, add a persisted cut field, or change render progress by itself.

For current overlap `[S, E)` and duration `D`, derive the cut `C` from the
current alignment. An alignment or duration edit keeps that exact `C`, then
derives destination edges from requested alignment `A'` and duration `D'`:

| Alignment | Current cut | Destination overlap around the preserved cut |
| --- | --- | --- |
| `start-at-cut` | `C = S` | `S' = C`; `E' = C + D'` |
| `center-on-cut` | `C = S + floor(D / 2)` | `S' = C - floor(D' / 2)`; `E' = S' + D'` |
| `end-at-cut` | `C = E` | `S' = C - D'`; `E' = C` |

The centered rule deliberately puts `floor(D' / 2)` frames before the cut and
`ceil(D' / 2)` after it, so an odd frame is biased after the cut. The planner
sets the incoming start to `S'` and outgoing end to `E'`, preserving their
outer edges and reconciling source in/out coordinates through the canonical
edit geometry. It refuses insufficient source handles, nonpositive clip
duration, sequence-boundary overflow, lock/read-only state, a three-way
overlap, or any source/sequence coordinate outside the frozen V22 limits.

Changing duration scales every curve anchor and Bezier control position by the
exact rational `D' / D`; it never samples or approximates a curve. Values and
segment kinds are unchanged. The complete candidate must still meet rational,
point, transition, project, and clip/source bounds. A type or curve-only edit
leaves the clip edges unchanged.

### One resolution and registry authority

`src/common/editor/video-transition-resolution.ts` owns transition geometry,
cut derivation, exact local-position mapping, curve evaluation, type lookup,
and the renderer-neutral result. At an exact sequence position `T`, it
evaluates the transition curve at `T - S`, clamps neither malformed input nor a
registry failure, and returns progress `p` plus complementary dissolve weights:

```text
outgoingWeight = 1 - p
incomingWeight = p
```

The overlap is half-open for active-frame selection. An interval endpoint query
at `E` may evaluate the exact terminal `p = 1` for an export description even
though no preview frame at `E` belongs to the overlap. Transition weight
multiplies the clip's keyframed/static opacity through the existing 4B-1/4B-2
render-state path; it does not replace authored opacity. The pair remains one
atomic same-track layer with one blend mode and compositing order.

`video-timeline.js`, the live preview compositor pool, the keyframe render-state
provider, interval/export planning, and offline frame production all consume
that resolver's result. The existing `videoTransitionOpacity` and
`previewTransitionWeight` calculations are removed. CFR, VFR, nested, preview,
and export callers may map into the exact sequence position, but none may
recalculate progress, infer a V22 pair, interpolate endpoint weights with a
second formula, or substitute a backend transition primitive.

The first-party registry is a frozen, side-effect-free inventory. Each entry
binds one slug to its feature identity, localized label, renderer-neutral
resolver contract, preview consumer, export consumer, and parity fixtures.
Initial V22 contains only `dissolve`. Registry completeness tests require a
one-to-one registration across capabilities, requirements, i18n, menu/dialog
choices, preview, export, consumer ledgers, and golden evidence. Adding a type
is a reviewed first-party code change; neither a project nor an extension may
register executable behavior.

Unknown slugs remain structurally valid and survive clone, storage, archive,
desktop, clipboard, and copy-only cross-product preservation. Registry lookup
is not part of wire normalization. Compatibility reports their deterministic
unknown feature requirement and makes the project intrinsically read-only;
the dialog shows the unavailable slug and consumers refuse before rendering or
export I/O. Unknown, unavailable, or throwing types never become a dissolve,
identity operation, black frame, or omitted ledger entry by accident.

### Command, topology allocation, and history

Register exactly one direct transition command in one focused domain:

```ts
{
	readonly type: 'video-transition/set';
	readonly trackId: string;
	readonly transitionId: string;
	readonly expectedTransition: VideoTransitionV1;
	readonly transition: VideoTransitionV1;
	readonly expectedEdges: CanonicalTransitionClipEdges;
	readonly edges: CanonicalTransitionClipEdges;
}
```

`CanonicalTransitionClipEdges` is a closed planner-owned exact snapshot of the
two clips' boundary authority. Its concrete field inventory must be frozen by
V22 protocol tests before the discriminant is registered; no implementation
may replace it with a partial private object. `expectedTransition` and
`transition` are non-null. Addition and removal belong to topology commands and
their reconciliation, not a nullable interpretation of `video-transition/set`.

The handler requires `transitionId`, both transition objects, both pair
references, and the current canonical edge snapshot to agree with the target
track and current project. The replacement keeps the same transition identity
and pair ownership. It compares current state to `expectedTransition` and
`expectedEdges`, validates the replacement object and `edges` as one complete
V22 candidate, checks both transition capabilities and owning-track locks, and
publishes both clip edges and the transition atomically. A stale object or edge,
wrong pair, unavailable type, invalid curve/geometry, read-only project, or
failed requirement reconciliation leaves the project, revision, timestamp,
and history untouched. One accepted set is one controller commit, revision,
undo item, and redo item through the common project mutation service.

Every generic command that can create a new proper overlap carries one explicit
replayable allocation record for it:

```ts
{
	readonly trackId: string;
	readonly outgoingClipId: string;
	readonly incomingClipId: string;
	readonly transitionId: string;
}
```

The enclosing carrier name and command-field spelling are part of the pre-code
TDD freeze above. Move, trim, roll, ripple, slide, split, join, paste,
duplicate, Project Bin placement, insert, overwrite, replace, nested/product
materialization, and mixed batches use this rule wherever they can create an
overlap. Preparers allocate IDs before command publication; handlers never call
an ID factory. A missing, duplicate, colliding, mismatched, or unused allocation
rejects the entire command. Recursive batches remain one atomic history entry,
and capability policy inspects both the direct command and every allocation-
bearing generic carrier before mutation.

Topology reconciliation follows pair identity, not array position. A surviving
proper overlap between the same outgoing and incoming clip IDs retains its
transition ID, type, alignment, values, and segment shapes, with exact curve
time scaling if `D` changes. A destroyed overlap removes its object. A newly
created pair consumes exactly one fresh allocation and starts as the explicit
default dissolve unless the command carries another available canonical type.
Changing either pair member is remove-plus-create, never identity reuse.

### Edit, clipboard, nested, and preservation rules

| Operation | Required transition behavior |
| --- | --- |
| Move, trim, roll, ripple, slip, slide, stretch, insert, overwrite, replace | Retain and exactly retime a same-pair surviving overlap; remove a destroyed overlap; consume an explicit fresh allocation for every new pair. Refuse before publication if reconciliation would become ambiguous. |
| Split | A split outside `[S, E)` rebinds the transition reference to the one child retaining the participating edge and preserves transition identity. A split inside the overlap, or any split that would fork one transition across children or create a three-way interval, rejects. |
| Join | Remove an overlap consumed by the join. Preserve any unaffected boundary transition by rebinding it to the joined clip only when pair roles and exact geometry remain unambiguous; otherwise reject rather than bake or sample the transition. |
| Delete or remove from track | Remove each transition whose participant or proper overlap is destroyed and reconcile requirements in the same command. |
| Move between tracks/sequences | A complete pair may retain its object only when it moves atomically and remains the same ordered pair with valid geometry. Moving one side destroys the object; a new destination pair requires a fresh allocation. |
| Source replace, reprobe, relink, effects, keyframes, group, link, unlink | Preserve the exact transition when clip IDs and overlap edges survive; source-handle validation still applies to a later duration edit. |
| Duplicate | A duplicated complete pair gets detached transition state with a fresh transition ID and remapped fresh clip IDs. A partial duplicate carries no dangling object. |
| Project Bin | Store no transition. Placing clips is a topology operation and must explicitly allocate any transition created on the destination track. |
| Multicamera switch | Preserve the output clips' track-owned transition; switching the active source does not rewrite type, curve, alignment, or pair identity. |

The session clipboard advances to V7. It carries a detached complete transition
only when both participant clips and their owning track relationship are in the
copied fragment. Paste remaps both clip IDs, consumes the explicit fresh
transition allocation, and validates the complete destination geometry before
publication. A one-sided copy carries no dangling reference. V6 requires
recopy when transition semantics would otherwise be lost; it is never upgraded
by inferring a dissolve. Copy-only recipients preserve a structurally valid
unknown type but cannot author or render it without the matching capabilities.

Persisted transitions remain owned by the source sequence track during nested
and subsequence use. Runtime materialization creates an occurrence-scoped,
detached transient pair and an exact query mapping back to the source
transition's authored curve. Trimming or rate mapping a nested occurrence does
not persist sampled anchors, normalized progress, or a derived curve. The
shared resolver evaluates through that exact mapping. Materialization refuses
if it cannot retain both pair roles, half-open overlap geometry, at-most-two
active clips, or canonical exact coordinates. No transient occurrence ID,
resolved progress, cut, weight, or renderer description enters project JSON.

Current-format `.scape`, browser storage, archive cloning, desktop handoff,
history, and explicit cross-product handoff preserve the complete track-owned
object. V22 advances every Framescaper runtime, repository, archive, desktop
library, bootstrap, and fixture pin atomically; it never teaches an earlier
selected authority to ignore `videoTransitions`.

### Menu and dialog

The only new surface is the Framescaper-only menu path:

```text
Edit > Clip boundaries > Video transition…
```

It opens one lazy product-owned dialog; no toolbar control, inline boundary
handle, default inspector panel, badge, or side rail appears. Selection
resolution accepts one or two selected video clips only when they identify one
unambiguous existing transition or one unambiguous eligible adjacent boundary.
One selected clip with two possible transition boundaries, two clips in the
wrong order or on different tracks/sequences, a partial unknown pair, an
unavailable capability, a locked owner, or insufficient source handles disables
the command with a localized reason.

The dialog exposes registered type, alignment, exact duration in sequence
frames with localized time presentation, and the shared bounded curve editor.
Creating a transition routes through a topology preparer with a fresh explicit
allocation; editing routes through `video-transition/set`; removing it changes
the clip topology so no proper overlap remains. Reset selects dissolve,
center-on-cut, and the two-anchor linear curve for the current duration without
changing identity. Unknown types are named visibly but remain read-only. Enter
or an explicit Apply publishes one valid atomic command, Escape closes, focus
returns to the menu invoker, invalid fields are announced without mutation,
and undo/redo restore object and edges together. English and German catalogs
cover every label, alignment, validation error, unavailable type, and ambiguity
reason.

### Capability and requirement ownership

Add these exact capability registrations:

| Key | Feature ID | Initial availability |
| --- | --- | --- |
| `videoTransitions` | `org.soundscaper.capability.video-transitions` | `false` in both products |
| `videoTransitionDissolve` | `org.soundscaper.capability.video-transition.dissolve` | `false` in both products |

Framescaper flips both only in the V22 activation change after the complete
native workflow passes. Soundscaper keeps both known unavailable. The umbrella
capability authorizes explicit transition ownership and editing; the type
capability authorizes the maintained resolver and both render consumers. A
future registered type gets its own reviewed capability and registry row.

Any nonempty transition collection owns
`framescaper.video-transitions` with feature ID
`org.soundscaper.capability.video-transitions`. Each distinct authored type
slug `x` additionally owns `framescaper.video-transition.x` with deterministic
feature ID `org.soundscaper.capability.video-transition.x`; dissolve therefore
owns `framescaper.video-transition.dissolve` and
`org.soundscaper.capability.video-transition.dissolve`. These are bypass-only,
null-fallback requirements. Empty collections own neither transition
requirement. Missing, stray, reserved-ID-conflicting, same-feature publisher
substitution, and rendered-fallback declarations reject. The exact known and
opaque display-name literals are frozen in the pre-code requirement tests.

An unregistered slug still derives and preserves that exact requirement. Its
feature ID is unknown to the product capability profile, so the maintained
compatibility decision is explicit read-only-or-cancel. Generic commands may
preserve existing state but cannot introduce, remove, reset, retime, or replace
it while either umbrella or type capability is unavailable. Transition
capabilities are excluded from generic rendered-video fallback eligibility
until a separate reviewed fallback/revert workflow exists.

### Test-first implementation and activation gates

1. Freeze the four pre-code protocol decisions above, requirement display
   names, and lower-only test seams before writing V22 validators or commands.
   Record one canonical default fixture and deterministic array/cap vectors.
2. Unit-test closed hostile-input admission, slug grammar, global identity,
   curve endpoint/control/rational bounds, freeze/detachment/idempotence,
   unknown-type preservation, exact track ownership, and every missing,
   duplicate, dangling, unowned, disjoint, touching, nested, equal-boundary,
   cross-sequence, and three-way geometry case.
3. Prove exact V22 create, validate, clone, selected load/save, history,
   clipboard V7, Project Bin exclusion, `.scape`, browser repository, archive,
   desktop library, copy-only transfer, typed V20 re-import refusal, and future
   opaque-read-only behavior. No exact-current fixture relies on normalization
   to synthesize a transition.
4. Cover all three alignments with odd/even old and new durations, sequence
   edges, insufficient handles, source mapping, safe-integer overflow, exact
   curve scaling, and transactional refusal. Freeze expected edge snapshots as
   golden command vectors.
5. Cover stale object and edge CAS, wrong owner/pair, unavailable capability,
   unknown type, lock/read-only state, batch recursion, undo/redo, and missing,
   duplicate, colliding, mismatched, and unused topology allocations. Assert
   that no handler invokes an ID factory and every failure publishes nothing.
6. Execute the complete preservation table, including split on both sides and
   inside an overlap, surviving/destroyed/new pair reconciliation, complete and
   partial duplicate/copy, V6 recopy refusal, nested subrange/rate mappings,
   multicamera switches, and detached remapped identities.
7. Make a consumer audit fail while either current duplicate weight function
   exists. Test the shared resolver at exact start, interior rational samples,
   final active frame, and interval end; assert complementary weights and
   authored-opacity multiplication for direct, nested, CFR, and VFR queries.
8. Require registry-completeness tests and preview/offline-export parity for
   every registered type. Dissolve must pass the maintained GPU/reference
   matrix with zero missing, substituted, fallback-rendered, or omitted
   transition operations. An unknown or unavailable type refuses before media,
   WebGL, FFmpeg, file, or download I/O.
9. Chromium covers menu-only reachability, one/two-selection ambiguity,
   create/edit/remove/reset, keyboard and focus return, localized errors,
   forced colors, serious axe checks, undo/redo, save/reopen, export, no
   Soundscaper authoring entry, and no new default-visible surface.
10. Keep V22 dormant and both capabilities unavailable until canonical tests,
    full browser tests, build/chunk ceilings, security registration, quality
    budgets, desktop/package transport, manual/reference-GPU rows, and the
    complete V20-to-V22 clean activation rehearsal pass. Flip model, storage,
    runtime, bootstrap, product capabilities, and menu selection in one atomic
    activation change only after those gates.

### Non-goals and stop conditions

Audio crossfades keep the existing engine-owned implicit model. They do not
share this video object in milestone 4B; an audio schema decision belongs to
the Soundscaper production track. 4B-3 adds no transition plug-in loader,
project-supplied executable type, mask/matte language, motion tracking,
optical-flow interpolation, renderer-specific persisted expression, normalized
curve time, default-visible timeline handle, or milestone-6 delivery workflow.

Stop 4B-3 if V20 is not a clean selected base; a pre-code wire/cap decision is
still private; a V22 overlap can exist without exactly one object; an object can
exist without its exact pair; an edit handler allocates an ID; topology,
timeline, preview, nested playback, and export disagree about geometry or
progress; a curve is sampled during preservation; a clipboard or edit drops,
aliases, or dangles state; an unknown type renders or disappears silently; a
backend transition alias replaces the shared resolver; more than two clips can
be active; an audio schema is pulled into V22; a new control is visible by
default; or a route/capability flips before native, packaged, security, quality,
manual, and reference-GPU evidence is honestly recorded.

## 4B-4 — Inspector and new visual kinds

This packet is serialized into separately registered slices:

1. **4B-4a — Selection-aware inspector shell.** Generalize the lazy 4B-1
   dialog into a menu-opened, selection-aware surface with stable section
   registration and no default-visible panel.
2. **4B-4b — Still images.** Add an explicit still source/clip kind, image
   import and decoding, duration semantics, geometry/keyframe consumption, and
   export/preview parity.
3. **4B-4c — Titles and generators.** Add explicit title, text, shape, and solid
   generator kinds with closed bounded documents, safe text/font behavior, and
   deterministic software rendering.
4. **4B-4d — Adjustment layers and presets.** Add an explicit adjustment-layer
   kind with bounded target scope, plus versioned presets that copy authored
   state without sharing identities.

Each kind lands atomically with validation, clone, commands, one menu path,
clipboard, Project Bin where meaningful, `.scape`, desktop, cross-product
preservation, and preview/export behavior. No kind is encoded in an opaque
extension, a fake video source, a label, or an effect parameter. Stop a slice if
its kind cannot describe ownership, duration, renderer fallback, and lossless
current-format preservation before UI work begins.

## 4B-5 — Color and motion

This Web Enhanced packet has three pickup slices:

1. **4B-5a — Color contract, LUTs, grading, and scopes.** First close the
   working-space, transfer, alpha, and display-transform contract against the
   currently inert probed color metadata; then add digest-bound LUTs, bounded
   grading state, deterministic software output, and session-only scopes.
2. **4B-5b — Tracking and stabilization.** Persist only bounded authored
   settings and digest-bound analysis assets; keyframes consume the shared
   vocabulary and missing/stale analysis degrades visibly.
3. **4B-5c — Denoise and optical flow.** Register each processor separately
   with declared resource ceilings, cancellation, deterministic software or
   proxy fallback, and calibrated accelerated/fallback parity.

No color grade ships before the color-management decision is recorded in its
slice document. Scopes and transient analysis are not project state. Stop if a
GPU result has no deterministic fallback inside the registered parity budget,
if a derived frame cache enters project JSON, or if unsupported hardware
silently omits an operation.

## 4B-6 — Styled caption tracks

This packet has two slices:

1. **4B-6a — Caption document and interchange.** Add explicit caption tracks,
   regions, speakers, cue styling, safe-area-relative placement, and optional
   word timing, with lossless-or-reported SRT, WebVTT, and one reviewed styled
   sidecar format.
2. **4B-6b — Editing and preview.** Add a menu-reached lazy caption editor,
   keyboard-complete cue operations, safe-area preview, search, and sidecar
   import/export through the registered document type.

Caption state is neither a label nor a timeline annotation. Speaker and word
timing survive exact-current clipboard, `.scape`, desktop, and sidecar round
trips. Burn-in and mux delivery remain milestone 6; transcript generation
remains milestone 7. Stop if a maintained sidecar loss is unreported, if style
can execute active content, or if a caption surface is default-visible.

## 4B-7 — Framescaper audio finishing

This packet has three slices:

1. **4B-7a — Existing shared audio surfaces.** Expose clip gain/fades, track and
   master mix controls, supported shared effects, and Project Bin audio
   workflows through Framescaper menu paths without product forks.
2. **4B-7b — Automation and dialogue finishing.** Adopt the 4A automation
   document/runtime after it is stable and add a deterministic dialogue chain
   that is complete without AI.
3. **4B-7c — Loudness targets and mix export.** Add maintained loudness target
   presets, measurement, and audio mix export using the shared offline engine.

Framescaper capability flags turn on only after the full native workflow and
cross-product preservation tests pass. This packet does not add recording,
voiceover, transcript generation, or a Framescaper fork of Soundscaper-owned
DSP. Stop if a shared audio model must be duplicated or if realtime and offline
results diverge outside the registered audio parity budget.

## 4B-8 — Exit evidence

- **Outcome:** Witness that Framescaper can edit, mix, caption, grade, and
  export one complete imported-media programme without Soundscaper.
- **Invariants:** Evidence is no-retry, digest-bound, environment-labelled, and
  records unavailable, manual, and external rows without promotion. The full
  registration and edit-primitive survival matrices are current.
- **Acceptance:** Canonical non-browser and Chromium suites, qualified packaged
  workflows, the reference GPU golden-frame workload, long-form performance,
  accessibility, `.scape`, desktop, and cross-product handoff all pass their
  registered thresholds.
- **Non-goals:** No milestone-5/6 delivery claims, milestone-7 AI claims, or
  milestone-8 recording claims.
- **Stop condition:** Stop closure on any unavailable advertised workflow,
  omitted renderer operation, unregistered authored state, unqualified required
  environment, or failing current-format round trip.

## Global 4B fences

- No camera, microphone, display, or voiceover recording surface before
  milestone 8.
- No burn-in, mux, package queue, or distribution workflow owned by milestone
  6.
- No transcript generation, AI reframe, generative fill, or analysis claim
  owned by milestone 7.
- No renderer-specific persisted state, derived frame cache, hidden extension
  kind, silently substituted fallback, or default-visible feature surface.
- Manual and external qualification rows remain evidence gates; implementation
  authority never converts them into observed results.
