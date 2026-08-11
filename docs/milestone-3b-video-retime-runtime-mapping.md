# Milestone 3B-5c: exact clip-bound video-retime runtime mapping

> **Status: Implemented on 2026-08-11.** Commit `e826691f` binds the exact V2
> algebra from [3B-5a](milestone-3b-exact-video-retime-algebra.md) to the
> persisted V16 clip wire from [3B-5b](milestone-3b-video-retime-v16.md),
> without adopting it in a maintained workflow. It adds no schema, capability,
> command, menu, UI, playback, preview, export, archive, desktop-library,
> policy, or browser change.

The canonical `npm run check` gate passed with 5,322 tests total, 5,320 passed
and 2 skipped; 90.15% statement and line coverage, 82.09% branch coverage, and
90.70% function coverage. Architecture passed with 892 modules, 2,483
dependencies, and 1,965 maintained files. The build emitted 104 production
JavaScript chunks; the largest, `aup4-worker`, was 400,686 bytes. No browser row
was required because no maintained consumer uses this seam. Packet 3B-5 remains
**In progress**; the immediate pickup is **3B-5d — native retime workflow
contract and decomposition**.

## Outcome boundary

Add one strict, pure mapper that compiles one non-null V16 video-retime wire
against its owning clip once. Repeated calls map clip-relative outer positions
in sequence-frame units to absolute source-frame rationals, expose the algebra's
complete discrete inverse occurrences, and publish immutable breakpoint
partitions for later preview and export planning.

This is a runtime math boundary, not a runtime consumer. Current preview accepts
one positive uniform `playbackRate`, and current FFmpeg export emits one constant
`setpts` rate. Neither can represent reverse, freeze, or ramp segments. The
later 3B-5d native-workflow packet must adopt authoring, preview, playback,
export, and the Framescaper capability flip atomically rather than partially
using this mapper for an easy subset.

## Strict API and ownership

Production ownership is a new maintained strict-TypeScript module
`src/common/editor/video-retime-runtime-mapping.ts`, below 600 lines. Its public
surface is equivalent to:

```ts
type VideoRetimeRuntimeQuery =
	| number
	| VideoRetimeCurveRational
	| ExactVideoRetimeRational;

interface VideoRetimeRuntimePartition {
	readonly segmentIndex: number;
	readonly mode: VideoRetimeCurveSegment['mode'];
	readonly startOuterFrame: number;
	readonly endOuterFrame: number;
	readonly startSourceFrame: ExactVideoRetimeRational;
	readonly endSourceFrame: ExactVideoRetimeRational;
}

interface VideoRetimeRuntimeMapper {
	readonly sequenceStartFrame: number;
	readonly sequenceEndFrame: number;
	readonly outerFrameCount: number;
	readonly sourceInFrame: number;
	readonly sourceOutFrame: number;
	readonly partitions: readonly VideoRetimeRuntimePartition[];
	readonly mapOuterFrame: (
		outerFrame: VideoRetimeRuntimeQuery,
	) => ExactVideoRetimeRational;
	readonly invertSourceFrame: (
		sourceFrame: VideoRetimeRuntimeQuery,
		options: Readonly<{
			policy: 'all' | 'earliest' | 'latest' | 'nearest-cell';
			outerHint?: number;
		}>,
	) => readonly VideoRetimeInverseOccurrence[];
}

function createVideoRetimeRuntimeMapper(
	clip: unknown,
): VideoRetimeRuntimeMapper;
```

The factory accepts the exact V16 clip-bound video wire shape used in either the
timeline or Project Bin. It does not authenticate a project schema, clip-store
membership, track owner, or source identity. It requires own enumerable data
properties for `kind`, `sequenceStartFrame`, `sequenceFrameCount`, `sourceInFrame`,
`sourceFrameCount`, and `retimeMap`; required getters are never invoked. It
rejects a non-video clip, a null map, an old map, unsafe bounds, and an unsafe
sequence end. Null-map clips keep the existing uniform runtime path; this mapper
must not invent an identity curve for them.

`video-retime-v16.ts` may gain one narrow `compileVideoRetimeCurveV16` binding
helper so the factory can validate the closed V16 identity and receive the
existing algebra-identity-gated `CompiledVideoRetimeCurve` from one call to
`compileVideoRetimeCurve`. It must not normalize and then compile the same wire
a second time. Do not grow the near-ceiling
`video-retime-curve.ts`; the compiler, evaluator, inverter, exact-work ceiling,
and curve semantics remain owned there. The mapper retains the one compiled
object in its closure and never exports it or recompiles on map, inverse, or
partition reads.

## Exact forward mapping

`outerFrame` is clip-relative in sequence-frame units: zero is the clip's
`sequenceStartFrame`, and `outerFrameCount` is its `sequenceFrameCount`. The
integers `0..outerFrameCount` are the clip's N+1 sequence-frame boundaries;
reduced rational queries address exact positions between those boundaries. A
query may be a safe integer, a canonical reduced bounded `{ num, den }`, or a
canonical reduced runtime `{ numerator, denominator }` within the algebra's
4,096-bit ceiling. The closed domain is `0..outerFrameCount`; outside values
reject without clamp, edge hold, or nearest-frame repair.

The mapper delegates the local coordinate unchanged to
`evaluateVideoRetimeCurve`. The result is the reduced, deeply frozen absolute
source-frame rational owned by the curve. There is no `Number` division,
epsilon, sampled integration, accumulated delta, source-frame rounding, or
second polynomial implementation. Endpoint results equal the exact persisted
points, including non-integer source positions.

The mapper exposes `sequenceStartFrame` and the safely added
`sequenceEndFrame` only so a consumer can translate absolute sequence
placement. `sourceInFrame` and safely added `sourceOutFrame` are the clip's
closed admissible source binding, not its first/last mapped value or curve
extrema. The mapper does not accept sample frames, seconds, pixels, media
element times, or an already-resolved runtime clip projection.

## Exact inverse and breakpoint partitions

`invertSourceFrame` passes the absolute source query and the exact four
selection policies to `invertVideoRetimeCurve`. Its returned `point` is one
integer boundary, `range` has inclusive boundary endpoints, and `bracket` has
consecutive boundaries with `beforeOuterFrame < afterOuterFrame` enclosing one
continuous crossing. All remain clip-relative. `nearest-cell` preserves the
algebra contract: `outerHint` is any safe integer distance reference, including
outside `0..outerFrameCount`; it is not itself mapped or clamped. Ordered
multi-hits across forward/reverse direction changes remain distinct; adjacent
freeze equality remains one maximal range, which normally includes a shared
end boundary when the following moving segment starts at the same value; shared
moving endpoints remain half-open-deduplicated; and a source value outside every
segment range returns an empty frozen array. The wrapper never solves a root,
scans frames, snaps the source query, or chooses an occurrence that the caller
did not request.

`partitions` contains exactly one stable entry per compiled segment. Each entry
records its segment index and mode, the exact outer breakpoint interval, and
the exact evaluated source endpoints. Segments own `[startOuterFrame,
endOuterFrame)` except that the final segment owns the closed curve end. Entries,
endpoint rationals, and the containing array are deeply frozen. Partitions do
not contain coefficients, sampled values, PTS arrays, resolved sample ranges,
or a persisted/runtime cache.

For S segments, partition length is S and `segmentIndex` equals array index.
Every outer span is nonempty; the first starts at 0; adjacent partitions share
the exact outer boundary and exact source endpoint; and the last ends at
`outerFrameCount`. Mapping every partition endpoint equals its recorded exact
endpoint. Repeated reads retain the same array, entry, and endpoint identities.
These are breakpoint/dispatch partitions only: they tell later consumers where
to split and which mode applies, but do not reconstruct a ramp polynomial or
constitute a native render plan. Consumers call the mapper for values.

Factory work is one compilation plus O(S) partition materialization and O(S)
retained memory. Forward lookup is O(log S), inverse lookup is
O(S log(N + 1)), and partition access is O(1), for S <= 4,096 and safe-integer
N. Every exact query and intermediate retains the algebra's 4,096-bit refusal.
No structure scans or indexes all N outer boundaries.

## Sequence/sample and optional VFR seam

Callers supply sequence-domain coordinates. A caller beginning with a sample
position must continue to use `timeline-time.ts` from the absolute sequence
origin under an explicitly named rounding policy, then derive the clip-relative
outer coordinate from the clip's immutable sequence placement. This mapper
does not add a clip-local sample ratio or round midway through that chain.

VFR PTS composition defaults to 3B-5d. It may land here only as a separate pure
helper under the existing exact `video-source-timing-view.ts` owner; the legacy
Number/registry-oriented `video-source-time.ts` is not its owner. The helper
accepts only a verified VFR view and one exact source-frame rational in the
closed `0..frameCount` range, returns the existing exact source-time shape, and
uses the same fixed BigInt ceiling. Integer k selects `presentationTicks[k]`,
`frameCount` selects `endTicks`, and fractional `k + f` interpolates those exact
ticks before applying `timescale`. Bounds or unverified identity reject;
results reduce and freeze; reverse call order changes no result; and no `Number`
conversion occurs until an existing terminal seconds/media adapter.

Include that helper only if the retime mapper remains independent of source
timing, the timing registry, storage, controllers, and UI, and no dependency
cycle or existing-consumer migration is required. Otherwise defer it whole;
required 3B-5c acceptance must not depend on it.

## Red-first sequence and acceptance

Start red in
`tests/audio-editor-video-retime-runtime-mapping.test.ts` before production
code. The focused strict suite proves:

- all five modes, exact endpoints, a non-integer ramp interior, integer and
  NTSC-shaped rational queries, and nonzero clip/source origins;
- reverse and freeze multi-hits, maximal ranges, irrational-root brackets, all
  four selection policies, half-open endpoint deduplication, and empty results;
- one partition per segment in stable order with exact endpoint agreement,
  every partition law above, stable object identities, deep freeze, and no input
  mutation, including a nonmonotone curve whose extrema are interior;
- null/non-video/old-map/accessor, out-of-domain, malformed rational,
  safe-integer, and 4,096-bit work-bound refusals; and
- points/segments Array proxies whose `ownKeys` traps prove one raw traversal at
  factory creation and no further raw reads during repeated forward, inverse,
  or partition access; mutating the raw clip/map afterward proves snapshot
  stability; and
- a source-ownership audit proving the V16 helper contains exactly one
  `compileVideoRetimeCurve` call, the mapper calls that helper exactly once,
  never imports or calls `normalizeVideoRetimeCurveV16` or
  `compileVideoRetimeCurve`, and its closures only evaluate or invert the
  retained compiled object. Do not add a public test-only compiler/counting seam
  or depend on ESM monkey-patching.

If the optional PTS helper is dependency-clean, add focused cases for unequal
VFR frame durations, fractional positions, the final-frame interval, reverse
query order, exact reduction, verified-index admission, and bounds. Those cases
must show that only the terminal adapter converts the exact result to `Number`.

Run the focused suite while red/green, then typecheck, lint, architecture and
file-size checks, `npm test`, `npm run check`, roadmap guidance, documentation
link, and diff checks. No browser row is required or claimed because no
maintained product workflow consumes this seam.

## Non-goals and stop conditions

- No V17 or other schema/current alias, migration, V16 wire change, capability
  registration or availability change, policy/security evidence, desktop or
  archive version, command, history, clipboard, or preservation change.
- No menu, shortcut, authoring control, default-visible UI, preview, playback,
  export, FFmpeg filter, decoder, audio warp, pitch policy, optical flow, proxy,
  fallback, or browser evidence.
- No nested-sequence field, graph edge, cycle/depth rule, composition, or
  flattening. Nested graph/time algebra follows the atomic native retime
  workflow rather than entering this clip-only seam.
- Stop if mapping needs a persisted field or cache, float/epsilon arithmetic,
  mid-chain rounding, duplicated curve algebra, unbounded exact work, or
  per-sample/per-pixel BigInt evaluation.
- Stop if one segment subset must reach preview/export before all five modes can
  share one native workflow, or if VFR composition would reverse the dependency
  direction or require timing-asset I/O here. Move that work to 3B-5d instead.
