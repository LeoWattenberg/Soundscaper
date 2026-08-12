# Milestone 3B-5d: native video-retime workflow decomposition

> **3B-5d reviewed; 3B-5e, 3B-5f, and 3B-5g-a implemented on 2026-08-12.** The
> decomposition landed in `17ffbae3`; commit `23b7fe17` delivers exact
> authenticated frame dispatch, `e1e833e0` delivers exact output cadence and
> its generic queue, and `24a12c73` delivers the paused HTML adapter plus VFR
> browser oracle. Contract correction `e905a3dd` precedes `b8bfbda5`'s dormant
> backend-neutral V6 export intent. The delivered [3B-5a
> algebra](milestone-3b-exact-video-retime-algebra.md), [3B-5b V16
> wire](milestone-3b-video-retime-v16.md), [3B-5c clip
> mapper](milestone-3b-video-retime-runtime-mapping.md), dispatcher, cadence,
> preview, and export-intent family still expose no maintained
> writable/drawable workflow or capability change.

The canonical `npm run check` gate passed with 5,368 tests total, 5,366 passed
and 2 skipped; 90.03% statement and line coverage, 82.04% branch coverage, and
90.8% function coverage. Architecture passed with 900 modules, 2,494
dependencies, and 1,981 maintained files. The build transformed 1,180 modules
and emitted 104 production JavaScript chunks; the largest was 400,686 bytes.
No Chromium row was required for 3B-5g-a because its serializer is dormant and
has no maintained consumer. Packet 3B-5 remains **In progress**. Exact
execution in 3B-5g-b, atomic adoption in 3B-5h, and the `videoRetime`
capability remain hard-stopped pending a reviewed exact backend or
narrower-domain proof.

## Dependency audit and delivery rule

One implementation packet is not bounded. `VideoPreviewPanel.jsx` suppresses
React position updates during GPU playback and drives one positive media
`playbackRate`. Export V5 admits one ascending source range/rate and emits
`trim,setpts=(PTS-STARTPTS)/rate`. Neither represents reverse, freeze, or ramp;
an FFmpeg branch/argument per safe-integer-sized output frame is unbounded.

Delivery is therefore serialized as five dependency-correct packets:

1. **3B-5e — exact frame dispatch:** exact CFR/VFR time plus a lazy all-mode dispatcher; no consumer.
2. **3B-5f — dormant output/preview executor:** exact cadence and isolated imperative preview.
3. **3B-5g-a — dormant export intent:** bounded backend-neutral V6 intersection serialization.
4. **3B-5g-b — exact executor feasibility:** hard-stopped until one backend proves the full oracle.
5. **3B-5h — atomic native adoption:** authoring, maintained consumers, Framescaper capability/
   policy, menu-opened UI, and focused Chromium together.

Packets 3B-5e through reviewed 3B-5g-a may add dormant modules/tests, but no
maintained path imports them. 3B-5g-b adds no executor code while stopped, and
3B-5h cannot begin partial adoption around it. `videoRetime` stays false in both
products/register until an atomic 3B-5h can close every required consumer.

## 3B-5e — exact authenticated frame dispatch

**Implemented in `23b7fe17`.** `video-source-timing-view.ts` now binds one
opaque, snapshot-safe CFR/VFR timing token per source/project view, and
`video-retime-frame-dispatch.ts` lazily resolves all five curve modes to exact
source timing plus one direction-owned drawable frame. The implementation has
no maintained consumer; the contract below remains the acceptance record.

Ownership is strict TypeScript under 600 lines per new module. The intended
surface is equivalent to:

```ts
interface ExactSourcePosition { readonly numerator: bigint; readonly denominator: bigint }
interface BoundVideoSourceTimingView {
	readonly sourceId: string; readonly frameCount: number; readonly kind: 'cfr' | 'vfr';
}

interface VideoRetimeFrameDescriptor {
	readonly outerCell: number;
	readonly segmentIndex: number;
	readonly mode: VideoRetimeCurveSegment['mode'];
	readonly sourceFrame: ExactSourcePosition;
	readonly sourceTime: ExactSourceTime;
	readonly drawableSourceFrame: number;
	readonly drawableSourceStartTime: ExactSourceTime;
	readonly drawableSourceEndTime: ExactSourceTime;
}

interface VideoRetimeFrameDispatcher {
	readonly outerFrameCount: number;
	readonly terminal: Readonly<{
		readonly outerBoundary: number; readonly sourceFrame: ExactSourcePosition;
		readonly sourceTime: ExactSourceTime;
	}>;
	dispatchOuterCell(outerCell: number): VideoRetimeFrameDescriptor;
}

function bindVideoSourceTimingView(timingViews: ReadonlyMap<string, VideoSourceTimingView>,
	source: unknown): BoundVideoSourceTimingView;
function videoSourceFrameTime(timing: BoundVideoSourceTimingView,
	sourceFrame: ExactSourcePosition): ExactSourceTime;
function createVideoRetimeFrameDispatcher(clip: unknown,
	timing: BoundVideoSourceTimingView): VideoRetimeFrameDispatcher;
```

`video-source-timing-view.ts` owns `ExactSourcePosition`, structurally
compatible with the mapper result without importing retime algebra, plus the
opaque frozen token and exact-time helper. A private `WeakMap` authenticates a
token before any public-field read; forged/cloned lookalikes reject without
getter invocation. Binding requires `source.kind === 'video'`, performs full
identity/index validation once per unique source/project snapshot, snapshots
CFR fields/source ID/frame count, and privately retains only the verified frozen
VFR index. Reuse is O(1); later calls never reread raw inputs or rescan PTS and
an exact query reads only its adjacent ticks or cached end tick.

For exact source coordinate `q = k + f`, CFR returns `q / rate`. VFR returns
the exact interpolation from `PTS[k]` to `PTS[k + 1]`; the last cell uses
`endTicks = PTS[frameCount - 1] + finalFrameDurationTicks`, and
`q === frameCount` returns `endTicks/timescale`. Results are reduced, frozen,
and bounded by the algebra's 4,096-bit ceiling. Closed bounds are
`0..frameCount`. After exact floor division proves `k` is within safe
`frameCount`, `Number(k)` may index PTS in O(1); Number division/float
interpolation, epsilon, registry lookup, and HTML media policy remain forbidden.

`video-retime-frame-dispatch.ts` requires own-data `clip.sourceId`, matches it
to the token, creates one 3B-5c mapper, and proves the clip binding ends no later
than the timing frame count. It snapshots the clip and retains the token and
mapper once. Raw mutation after construction changes nothing.

The mapper's integers `0..N` are boundaries; only outer cells `0..N-1` are
drawable. `dispatchOuterCell(i)` evaluates boundary `i`. A breakpoint belongs
to the new half-open segment, so the returned mode is unambiguous at a freeze
or direction change. Drawable source ownership is exact and direction-aware:

- constant/ramp forward uses `floor(sourceFrame)`;
- constant/ramp reverse uses `ceil(sourceFrame) - 1`;
- freeze uses `floor(sourceFrame)`; and
- every result clamps to the clip binding
  `[sourceInFrame, sourceOutFrame - 1]`, never the whole source.

Thus a reverse beginning on integer boundary `k` draws `k - 1`, a forward
segment beginning there draws `k`, and a freeze exactly at a trimmed
`sourceOutFrame` draws the last admitted clip frame. The descriptor includes
the owned frame's exact `[drawableSourceStartTime, drawableSourceEndTime)` PTS
interval, including VFR final-frame duration, so consumers never recompute
ownership timing. Boundary N is cached separately in `terminal` for duration/
range math and has no drawable owner; media end is never repaired with an
epsilon. One mandatory last-cell cache returns the same frozen descriptor for a
repeated cell, but no array or index proportional to N exists.

Factory cost is one mapper compile plus one already-bound timing lookup and
O(S) retained mapper partitions, S <= 4,096. Dispatch is O(log S) + O(1), with
bounded exact work per distinct video cell; it is never O(F) in VFR frame
count. BigInt is allowed at this video-cell boundary, not per audio sample,
pixel, animation delta, or accumulated clock tick.

Start red in `tests/audio-editor-video-retime-frame-dispatch.test.ts`. Prove
all five modes; nonzero origins; integer and fractional mapped positions;
half-open breakpoints and both direction changes; reverse integer ownership;
freeze at a trimmed source-out below the full source frame count; terminal N;
unequal VFR durations including the final cell; CFR and NTSC-shaped rates;
reduction, deep freeze, bounds, 4,096-bit refusal, and raw snapshot stability.
Accessor/proxy evidence must prove no raw timing map/view/source reads after
bind and no raw clip reads after one mapper compile. A source-ownership audit
proves only binding can perform the O(F) validation, the exact helper reads only
indexed `k`, `k + 1`, or end ticks, and dispatch never imports a raw view/index.
Also prove repeat-cache identity without a public counting/test-only seam.

## 3B-5f — dormant output cadence and preview executor

**Implemented in `e1e833e0` and `24a12c73`.** Exact cadence, the generic
bounded queue, the exclusive paused HTML adapter, and the decoder-qualified
VFR oracle remain dormant and do not change capability availability.
`outputRate` is a positive canonical safe
`{ num, den }`, defaulting to the sequence rate; an integer UI choice normalizes
to `{ num, den: 1 }`, while an unowned finite-Number canvas rate cannot cross
this seam. For sample range `[A, A + D)`, output count is exactly
`ceil(D * outputRate.num / (sampleRate * outputRate.den))`, admitted at
1..2,000,000 before work. Output frame `j` has relative PTS
`j * outputRate.den / outputRate.num`; its absolute containing sample is
`A + floor(j * sampleRate * outputRate.den / outputRate.num)` under named
`enclosingStart` policy. `sequenceFrameAtSample` then finds the absolute
containing sequence frame; subtracting `sequenceStartFrame` selects the local
cell. A mismatched cadence duplicates/drops whole cells, never sub-cell
evaluates. Every query is absolute/lazy; there is no output-sized array or argv.

The dormant imperative executor keeps retimed media paused, converts only the
descriptor's drawable interval to finite `Number`, and handles balanced
4,096-bit ratios without intermediate infinity. It permits at most one seek in
flight plus one last-wins pending descriptor, coalesces repeated cells, fences
stale callbacks, and uses O(1) queue memory. No positive-rate shortcut stands in
for any mode. Fakes prove protocol/cancellation; an isolated focused Chromium
fixture with real media proves CFR/VFR final-cell and reverse/freeze/ramp seeks.
Nothing imports this executor from `VideoPreviewPanel.jsx` yet.

## 3B-5g — exact serialized intent, stopped executor

The focused [3B-5g contract](milestone-3b-video-retime-export-plan.md) is the
sole authority for this split. **3B-5g-a was implemented in `b8bfbda5` after
contract correction `e905a3dd`.** Its dormant `video-retime-export-intent` V6
serializer consumes global sample cadence, one captured sequence identity/rate,
absolute-sample topology,
canonical clips, and authenticated timing tokens. It emits only JSON-safe active
mapping intersections: curve rows retain original segment coefficients, while
persisted null uses a distinct exact wall-clock row and never the dispatcher.
It is not project schema V17 or a complete video export plan and contains no
format, codec, media, effect, audio, FFmpeg, filter, script, path, or argv claim.

3B-5g-b is hard-stopped. The pinned FFmpeg expression and rate/time-base paths
cannot represent the complete admitted exact V16 domain, so the all-mode
ordinal equation cannot presently be proved without a narrower reviewed domain,
an exact backend, or forbidden per-output scheduling. Do not implement an
executor or browser export oracle while that stop holds. Consequently 3B-5h's
maintained export adoption also remains blocked; no other consumer may be
adopted early to route around it.

## 3B-5h — one atomic maintained workflow

Add one exhaustive `video-retime/set` protocol command and strict factory,
runtime, track-lock ownership, controller service, and capability policy. V16's
project-wide clip-ID uniqueness lets `{ clipId, retimeMap }` locate exactly one
timeline/Project Bin video; the handler validates against its canonical binding
and changes only `retimeMap` in one undoable commit. Apply rechecks a captured
project ID/revision, clip ID, and binding fingerprint so a stale dialog refuses.

Keep generic preservation. Admission narrowly verifies two transitions:
`video-retime/set` produces exactly its canonical whole-map/null result; and
`project-bin/place` may copy an unchanged canonical non-null map/source/local
binding to one fresh timeline ID/start. Raw update, disguised batch, altered
placement map/binding/source, and every other protected closure change reject.
Setting/editing non-null state refuses while `avLinkId` is non-null, but Clear
is allowed; the explicit sequence is **Clear → Unlink Audio → Set**. Existing
linked retimed state renders picture normally while audio retains forward
program placement/duration/pitch—never automatic unlink, warp, reverse, or hold.

Framescaper gets one capability-gated **Video Retime…** item in the existing
clip menu. Its lazy dialog can insert/remove/move integer breakpoints, edit
canonical source rationals, modes, and ramp velocities, validate, Apply the
whole map, or Clear; no partial field persists and no chrome is visible by
default. Soundscaper exposes no item and remains false.

Build one dispatcher cache from captured canonical persisted V16 clips before
runtime projection, keyed by globally unique clip ID; resolved composition
entries join that cache. Never strip aliases or pass `resolveActiveVideoLayers`
clips to a mapper that rejects projections. Adopt it in timeline preview/
playback, both MP4 and WebM export, Project Bin card playback/placement,
source-monitor Match Frame/program resolution, and filmstrip/thumbnails;
suppress the old uniform-rate badge for retimed clips. No raw-source fallback.

Only then flip Framescaper's product/register `videoRetime` true and preserve
the exact owned no-fallback declaration. Update compatibility/security
registers and derived narratives, sync them, and repin manifest evidence when
required; Soundscaper stays false/read-only for the feature.

Focused Chromium must prove menu-only reachability, linked refusal/unlink,
apply/clear and undo/redo, save/reopen, correct visible constant/reverse/freeze/
both ramps during seek/transport, Match Frame, filmstrip and Project Bin,
decoded MP4 **and** WebM frame oracles with unchanged linked-audio pitch,
failure/cancellation, placement, and Soundscaper absence/read-only behavior.
Run focused Node/browser suites and the canonical gate/build/document checks.

## Shared non-goals and stops

- No V17/schema/wire change, persisted cache, fallback, nested-sequence field,
  cycle/depth graph, proxy, optical flow, audio warp, or default-visible chrome.
- Nested sequence composition/flattening follows the complete native clip
  workflow; it must not enter a dispatcher or capability flip by stealth.
- Stop on unauthenticated/stale timing, O(F) dispatch, repeated compilation,
  float/epsilon before a named terminal, mid-chain rounding, N-sized retained
  schedules/argv, an unbounded reverse buffer, or partial maintained adoption.
- If any dormant backend cannot close all five modes under its hard limits,
  leave both product capabilities false and keep V16 preservation/read-only
  behavior unchanged.
