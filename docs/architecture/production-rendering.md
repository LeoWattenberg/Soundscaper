# Production rendering architecture

Production rendering turns persisted editorial intent into the same audible and
visible result in live playback, preview, offline export, stems, and derived
media. It is built around shared semantic resolvers rather than renderer-specific
project state.

## Shared authored vocabulary

Automation lanes, video keyframes, and transition curves share `hold`, `linear`,
`eased`, and Bézier interpolation. `hold` serves discontinuous and discrete
values; Bézier segments carry explicit handles.

Authored positions are exact clip- or lane-relative rationals in their declared
domain. Normalized `[0, 1]` time, evaluated sample positions, renderer matrices,
and filter expressions are derived values and are not persisted as substitutes.

[`interpolation-curve.ts`](../../src/common/editor/interpolation-curve.ts) owns
the wire vocabulary and validation. Exact evaluation and inversion live in
[`interpolation-curve-math.ts`](../../src/common/editor/interpolation-curve-math.ts).
An evaluator produces a semantic value; a downstream scheduler or renderer owns
the named rounding policy needed by its output boundary.

Parameters use stable addresses, not array positions or display labels. An
address identifies the owning track, mixer node or edge, effect instance, and
optional compound element. Its canonical collision-free key survives effect
reordering and reload. The address contract is defined in
[`parameter-address.ts`](../../src/common/editor/parameter-address.ts).

Parameter limits, taper, step size, automation tolerance, and scheduling support
come from [`effect-parameter-descriptors.ts`](../../src/common/editor/effect-parameter-descriptors.ts)
and [`scheduled-parameter-registry.ts`](../../src/common/editor/engine/scheduled-parameter-registry.ts),
not duplicated facts in an automation editor or video inspector.

## Audio automation

Each lane declares one timebase: `absolute-samples` stores nonnegative project
sample frames, while `musical-beats` stores nonnegative reduced rational
quarter-note beats from the tempo-map origin.

Tempo edits reflow musical lanes and do not move absolute-sample lanes. A lane
does not mix timebases or cache tempo-derived sample positions. The current lane
record, bounds, and contextual validation live in
[`automation-lane-v21.ts`](../../src/common/editor/automation-lane-v21.ts) and
[`automation-lane-timebase-v21.ts`](../../src/common/editor/automation-lane-timebase-v21.ts).

A lane has stable lane and point IDs, strictly increasing positions, and one
fewer segment than points. Persisted lanes are bounded to 4,096 points. When
gesture capture exceeds the useful density,
[`automation-lane-thinning-v21.ts`](../../src/common/editor/automation-lane-thinning-v21.ts)
applies deterministic adaptive thinning while preserving endpoints,
discontinuities, mode boundaries, and significant extrema.

At most one lane owns a canonical parameter address. If no lane exists, the
target's static value is authoritative. Lane values are validated against the
registered parameter descriptor; discrete parameters use hold semantics, and
latency-changing parameters are not automatable.

Automation write modes (`read`, `trim`, `touch`, `latch`, and `write`) are
session state, not project state. A cancelled or stale gesture restores the last
committed curve. Scheduling resolves authored lane time through the shared time
model and is owned by
[`automation-lane-scheduler-v21.ts`](../../src/common/editor/engine/automation-lane-scheduler-v21.ts).

## Mixer graph and latency compensation

The mixer is an explicit graph. Nodes and edges describe track assignment,
sends, sidechains, pre/post-fader placement, channel mapping, buses, VCA
relationships, and output roles. There is no parallel hidden routing model.

[`mixer-graph-v21.ts`](../../src/common/editor/mixer-graph-v21.ts) owns the
closed graph record and structural validation. Dangling references, illegal
roles, and cycles reject; they are not repaired on load. Summation and graph
traversal are deterministic.

Arrangement folders and mixer buses have distinct authority. A folder owns
arrangement identity; its owned bus carries mix state. Reconciliation is atomic
and is implemented by
[`folder-mixer-graph-v21.ts`](../../src/common/editor/folder-mixer-graph-v21.ts).
Code should not infer a second bus hierarchy from track nesting.

Plugin delay compensation (PDC) is derived runtime state. It depends on the
validated graph, active effect latencies, and sample rate and is never persisted
in the project. The graph-owned compiler in
[`project-path-pdc-plan-v21.ts`](../../src/common/editor/engine/project-path-pdc-plan-v21.ts)
plans compensation for live playback, monitoring, offline rendering, automation,
sends, sidechains, stems, and freeze boundaries.

Each merge aligns its participating paths. Flat project-wide or track-local
latency maxima are not equivalent and must not be introduced as alternate
rules. Inactive racks and sidechains still follow the planner's explicit
audibility semantics rather than ad hoc caller logic.

## Track freeze

Audio freeze is a reversible relationship between an editable track and managed
derived audio. It is not a destructive replacement and the rendered bytes do
not live in project JSON.

The freeze capture point is after the track insert rack and before strip
controls and downstream routing. Fader, pan, strip automation, sends, buses, and
master processing therefore remain live. The graph and PDC plan used for normal
rendering also define the freeze capture; freeze does not maintain a second
render graph.

A freeze record binds the derived body to the track, rack, automation, and other
input digests required to establish freshness. If any authority changes, the
freeze becomes stale and the canonical live track is used. Stale derived audio
must never continue sounding silently.

The persisted relationship is defined in
[`audio-track-freeze-v21.ts`](../../src/common/editor/audio-track-freeze-v21.ts);
its coordinator, lifecycle, and runtime are the neighboring `*freeze*` modules.

Refresh publishes a complete replacement atomically. Unfreeze removes the
relationship while retaining the editable state. Commit turns rendered media
into canonical project media through an undoable edit; history-aware storage
keeps referenced derived bodies alive for as long as an undo entry needs them.

## Reviewed audio effects

Reviewed effect packages execute only from the release-pinned catalog. Packages
are pure WASM with a bounded host ABI; there is no arbitrary package URL,
JavaScript payload, or per-user trust override.

Offline processing runs in a dedicated worker. Realtime execution requires a
separate realtime approval and uses the static first-party AudioWorklet host.
Hash verification, manifest validation, resource limits, revocation, and the
catalog are implemented under
[`reviewed-effects/`](../../src/common/editor/reviewed-effects/).

The authoritative policy surfaces are
[`production-security-matrix.json`](../../config/production-security-matrix.json)
and
[`production-licensing-matrix.json`](../../config/production-licensing-matrix.json).
New effect execution paths must update and satisfy those policies rather than
adding an unregistered host.

## Renderer-neutral video composition

Persisted video composition describes editorial intent: crop, transform,
opacity, blend mode, and compositing order. It does not contain a WebGL matrix,
FFmpeg filter graph, viewport rectangle, decoded dimensions, or backend feature
flag.

[`video-keyframe-render-state-provider.ts`](../../src/common/editor/video-keyframe-render-state-provider.ts)
evaluates authored keyframes into composition and effect state.
[`video-transition-resolution.ts`](../../src/common/editor/video-transition-resolution.ts)
resolves transition geometry and weights.
[`video-render-description.ts`](../../src/common/editor/video-render-description.ts)
combines the already evaluated composition with source display facts, sequence
canvas facts, and supplied transition opacity into a serializable operation for
a static interval. Evaluated effect state remains alongside the description for
the effect stage. Live preview and offline export consume the same resolved
state. A backend may lower or rasterize it, but must not independently
reinterpret its semantics.

The shared operation order is:

1. reconcile source orientation, display aperture, and pixel aspect;
2. apply the sequence's contain fit;
3. apply effects in their declared order;
4. crop;
5. transform around the authored anchor;
6. apply clip and transition opacity;
7. composite in painter order using the shared blend formula.

Blend names denote shared formulas, not whatever similarly named mode a backend
happens to expose. Unsupported operations are surfaced or refused. Silently
omitting an effect, color operation, transition, or blend mode is invalid.

## Video keyframes and transitions

Video keyframes address stable composition or effect parameters and use exact
nonnegative clip-relative rational positions. Numeric properties may use the
shared interpolation shapes; discrete properties use hold. Keyframe state never
persists normalized time or renderer state.

Trim, split, slip, slide, rate stretch, clipboard, history, and save/reopen must
preserve the authored relationship or reject an operation that cannot. The
current owners include [`video-keyframe-state.ts`](../../src/common/editor/video-keyframe-state.ts),
[`video-keyframe-time-domain.ts`](../../src/common/editor/video-keyframe-time-domain.ts),
and the neighboring `video-keyframe-*` modules.

Transitions are explicit track-owned objects. A transition names its exact clip
pair, duration, alignment, type, and curve. It is not inferred merely because
two clips overlap. Definitions and registered implementations live in
[`video-transition-v1.ts`](../../src/common/editor/video-transition-v1.ts),
[`video-transition-registry.ts`](../../src/common/editor/video-transition-registry.ts),
and
[`video-transition-resolution.ts`](../../src/common/editor/video-transition-resolution.ts).

Unknown registered-state types remain preservable but unavailable and read-only;
they are not converted silently to a dissolve. Preview, export, and nested
composition consume the same transition resolver.

## Color, motion, and captions

Video color interpretation, authored corrections, motion operations, and caption
tracks are persisted editorial state only where their current schemas say so.
Analysis results and runtime diagnostics are separate, digest-bound derived or
session assets.

Current owners include
[`video-color-management-v27.ts`](../../src/common/editor/video-color-management-v27.ts),
[`video-motion-model-v27.ts`](../../src/common/editor/video-motion-model-v27.ts),
and [`video-caption-track-v27.ts`](../../src/common/editor/video-caption-track-v27.ts),
with their adjacent analysis, processing, LUT, interchange, and burn-in modules.

Fallbacks must be deterministic and visible. Caption sidecar exchange preserves
timing and authored metadata supported by the interchange contract; burn-in is
a render choice, not a replacement for the caption track.

## Capability and compatibility boundaries

Not every product authors every production feature. The machine-readable truth
is [`production-capabilities.json`](../../config/production-capabilities.json),
with feature identities and ownership predicates in
[`project-feature-capabilities.ts`](../../src/common/editor/project-feature-capabilities.ts).
Both current product profiles advertise audio automation and the mixer graph.
Soundscaper additionally advertises audio-track freeze, while Framescaper
advertises the video composition, keyframe, transition, color, motion, and
caption surfaces.

A capability controls authoring and execution, not whether unknown state may be
discarded. The compatibility rules in
[`project-compatibility.json`](../../config/project-compatibility.json) decide
whether a product can edit, preserve opaquely, or must refuse a project.

New document state requires a stable feature identity, owned-state predicate,
capability entry, compatibility rule, validator, command path, preservation
coverage, and consumer. Partial registration creates silent-loss paths and is
not an acceptable intermediate architecture.

## Verification

[`quality-budgets.json`](../../config/quality-budgets.json) owns production
parity thresholds. The principal executable specifications cover the shared
[`production parity workload`](../../tests/audio-editor-m4-production-parity-workload.test.ts),
[`automation scheduling`](../../tests/audio-editor-automation-lane-scheduler-v21.test.ts),
[`mixer graphs`](../../tests/audio-editor-mixer-graph-v21.test.ts),
[`per-path PDC`](../../tests/audio-editor-project-pdc-path-plan-v21.test.ts),
[`freeze`](../../tests/audio-editor-audio-track-freeze-v21.test.ts),
[`render descriptions`](../../tests/audio-editor-video-render-description.test.ts),
and [`keyframe preservation`](../../tests/audio-editor-video-keyframe-edit-preservation.test.ts).

A production change should be checked across every consumer of its semantic
resolver. Preview/export agreement, exact PDC, stale-derived-media behavior,
save/reopen, history, and unsupported-operation refusal are architectural
requirements, not optional integration polish.
