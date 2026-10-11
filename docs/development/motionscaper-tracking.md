# Motionscaper tracking contracts

M07 tracking foundations provide point tracking, planar tracking, similarity
stabilization, manual sample correction, and authored application commands.
The opt-in **Layer > Tracking and Stabilization** dialog analyzes retained video,
reviews and corrects samples, applies tracking, and exposes undo and detachment.
The projective corner-pin renderer has focused Node and actual worker/CPU browser
coverage.

## Source authority and analysis

`analyzeMotionTracking` in `motion-tracking-analysis.ts` takes an immutable
project snapshot, composition/layer IDs, normalized settings, a borrowed frame
provider, an optional abort signal, and progress reporting. The adapter
`createMotionTrackingFrameProvider` borrows the existing retained media provider;
the caller continues to own its disposal.

Analysis uses retained, pre-effect footage pixels. Coordinates are local source
pixels, before layer transforms, masks, or effects. Bindings cover the retained
asset SHA-256, dimensions, media metadata, exact source timing, analysis settings,
and originating project revision digest. Time-remapped sources require baking
to retained footage. Decoder results must match the requested asset, rational
source time, and dimensions. Acceptance of a newly completed analysis requires
the exact originating revision; unrelated edits during analysis do not silently
adopt its result.

Point and planar analysis reuse the shared feature detector and pyramidal
optical flow through `motion-tracking-primitives.ts`. Planar estimates use a
normalized homography with deterministic outlier rejection. Stabilization reuses
the shared similarity solver and inverse stabilization transform. Explicit lost
samples retain texture, occlusion, or consensus failure; loss does not generate
invented motion or automatic reacquisition. Manual correction can repair these
samples before application.

The admitted limits are 4,096 frames per analysis, 128 features, a 512-pixel
analysis dimension, and 4,194,304 decoded source pixels. A project admits 64
analyses and 65,536 total samples, subject to its existing document budget.
Analysis retains two bounded grayscale frames and one pending decode. It yields
between frames, forwards cancellation to decoding, checks cancellation before
publication, and never publishes a partial result.

## Persistence and application

Optional `composition.tracking` and `composition.trackingApplications` fields
carry closed, immutable data. An absent field stays absent through normalization,
so adding tracking support does not change earlier project digests. Results and
applications survive history and authenticated `.mscape` archives. Persisted raw
analysis freshness follows source/settings authority; saving its own result does
not make it stale merely because the project revision advanced.

`createMotionscaperTrackingCommands` in
`src/motionscaper/editor-tracking-commands.ts` returns an atomic composition
replacement for `accept`, `remove`, `correct`, `detach`, `apply-point`,
`apply-stabilization`, or `apply-corner-pin`. Publish these commands through the
document history. Manual correction recomputes the result digest and marks any
earlier application stale. Removing an analysis retains its authored application
as stale intent; detaching explicitly keeps the authored curves/effect without
further tracking ownership.

Applications require unparented, nonsingular 2D geometry. Source projection is
static; point application preserves the target's initial placement, and
stabilization requires uniform positive source scale. Unsupported animated,
parented, time-remapped, or 3D geometry reports a bake-to-footage action. An
existing application retains its original static baseline, so correction and
reapplication do not compound previously generated animation. Replacing unrelated
authored animation requires explicit `replaceAnimation` intent.

Corner pin requires an explicit qualified `{ cornerPin: true }` capability.
It authors a Motion `corner-pin` effect with four vector2 parameters:
`top-left`, `top-right`, `bottom-right`, and `bottom-left`, in that order. Values
are target-layer local pixel coordinates. The renderer must account for the
retained local raster origin after preceding effects when sampling the source
rectangle. The Framescaper scalar effect registry is not extended. The renderer
admits convex, nondegenerate quadrilaterals and a bounded output surface before
allocation. It resamples pixel centers in premultiplied linear light with
bilinear filtering and transparent outside coverage, retaining negative local
origins. Earlier expanded effects remain part of the input rectangle. The
renderer yields every 16,384 output pixels and observes cancellation before
publication; it does not claim After Effects pixel parity.

## Preview and export admission

`motionTrackingReadiness(project)` returns read-only diagnostics;
`requireMotionTrackingReady(project)` throws if any exist. Compilation,
preview-session project admission, and delivery admission check the pinned
project before loading a runtime, assets, or opening an output sink. The
compiled/preview generation retains that admission rather than checking on
each frame. These hooks do not mutate or discard stale intent.

Raw source freshness and applied geometry are distinct checks. Application
digests bind exact authored property/effect fields, timing, parent, anchor, and
the original application baseline. Corner pins also bind preceding effects and
their order because those can change raster geometry. Names and unrelated
target properties do not invalidate applications. Manual target edits, source
geometry edits, deleted effects, changed samples, and missing analyses produce
an actionable reapply/detach diagnostic. Stale results remain editable.

Focused tests cover translated textured frames, cancellation and decoder
custody, loss, degenerate planes and outliers, source/timing drift, manual
correction, rename stability, intentional detachment, history, geometry
projection, self-application, and portable archive reopening. These fixtures do
not establish general tracking accuracy on arbitrary footage. Four Chromium
menu workflows use an actually encoded H.264 moving checker through the retained
media decoder. They cover point selection, analysis, correction, application,
undo/redo, project-library reopening, removal, detachment, cancellation, and
actionable no-source guidance. Planar and stabilization applications are checked
against actual preview pixels. The stabilization case also guards bilinear alpha
rounding under a fractional inverse transform. Real-footage reference
qualification remains required for M07.

This work does not change assistance runtime assets and does not require a
manual **Update AI assets** run.
