# Milestone 3B-5g: exact serialized video-retime export intent

> **Historical intent record.** The selected V27 web-core route now binds the
> maintained exact ordinal authority to preview and browser export as specified
> by the [Milestones 1–4 activation plan](milestones-1-to-4-activation-plan.md).
> Hard-stop and unavailable labels below remain evidence of the earlier packet;
> native milestone-5 execution is still excluded and unclaimed.

> **3B-5g-a implemented on 2026-08-12.** Contract correction `e905a3dd`
> removed the unreachable decimal sub-cap, and `b8bfbda5` delivers only the
> dormant backend-neutral V6 intent below. The canonical `npm run check` gate
> passed with 5,368 tests total, 5,366 passed, and 2 skipped; 90.03% statement
> and line coverage, 82.04% branch coverage, and 90.8% function coverage.
> Architecture passed with 900 modules, 2,494 dependencies, and 1,981
> maintained files. The build transformed 1,180 modules and emitted 104
> production JavaScript chunks; the largest was 400,686 bytes. No Chromium row
> was required because the serializer is dormant and has no maintained
> consumer. Packet 3B-5 remains **In progress**: 3B-5g-b, 3B-5h, and the
> `videoRetime` capability remain hard-stopped pending a reviewed exact backend
> or narrower-domain proof.

## Outcome and packet order

1. **3B-5g-a — backend-neutral export intent:** snapshot canonical clips and
   authenticated timing, apply 3B-5f's one global cadence, and serialize only
   active clip mapping intersections into one closed, JSON-safe, deeply frozen
   `video-retime-export-intent` V6.
2. **3B-5g-b — exact executor feasibility:** remain stopped until a reviewed
   backend can prove the exact picture-ordinal oracle for the complete admitted
   V16 domain without output-sized state or float repair.

V6 is an ephemeral intent version, not project schema V17 or a complete video
export plan. It does not persist into `.scape`, history, clipboard, Project Bin,
or compatibility state. Creating it does not assert that any backend can
execute it.

## 3B-5g-a public seam

Own the implementation in a new strict module under 600 lines,
`src/common/editor/video-retime-export-plan.ts`, with this public surface:

```ts
interface VideoRetimeExportIntentInputV6 {
	readonly sampleStart: number; readonly sampleDuration: number; readonly sampleRate: number;
	readonly sequenceBinding: Readonly<{ id: string; rate: RationalRate }>;
	readonly outputRate?: RationalRate;
	readonly topology: readonly Readonly<{
		startSample: number;
		endSample: number;
		layers: readonly Readonly<{
			clips: readonly Readonly<{ clipId: string }>[];
		}>[];
	}>[];
	readonly canonicalClips: readonly unknown[];
}
interface DecimalExactRationalV6 {
	readonly numerator: string; readonly denominator: string;
}
interface VideoRetimeExportIntersectionBaseV6 {
	readonly index: number; readonly topologyIntervalIndex: number;
	readonly layerIndex: number; readonly clipIndex: number;
	readonly clipId: string; readonly sourceId: string;
	readonly sequenceStartFrame: number; readonly outerFrameCount: number;
	readonly sourceInFrame: number; readonly sourceOutFrame: number;
	readonly startSample: number; readonly endSample: number;
	readonly startOutputFrame: number; readonly endOutputFrame: number;
}
type VideoRetimeExportIntersectionV6 = Readonly<
	VideoRetimeExportIntersectionBaseV6 & (
		| {
			readonly mapping: 'curve'; readonly segmentIndex: number;
			readonly mode: VideoRetimeCurveSegment['mode'];
			readonly segmentStartOuterCell: number; readonly segmentEndOuterCell: number;
			readonly sourceStart: DecimalExactRationalV6; readonly sourceEnd: DecimalExactRationalV6;
			readonly startVelocity?: DecimalExactRationalV6; readonly endVelocity?: DecimalExactRationalV6;
			readonly startOuterCell: number; readonly endOuterCell: number;
			readonly clippedSourceStart: DecimalExactRationalV6; readonly clippedSourceEnd: DecimalExactRationalV6;
			readonly drawableStartTime: DecimalExactRationalV6; readonly drawableEndTime: DecimalExactRationalV6;
		}
		| {
			readonly mapping: 'uniform-wall-clock';
			readonly clipStartSample: number; readonly clipEndSample: number;
			readonly sourceStartTime: DecimalExactRationalV6; readonly sourceEndTime: DecimalExactRationalV6;
			readonly clippedSourceStartTime: DecimalExactRationalV6; readonly clippedSourceEndTime: DecimalExactRationalV6;
		}
	)
>;
interface VideoRetimeExportIntentV6 {
	readonly kind: 'video-retime-export-intent';
	readonly version: 6;
	readonly sampleStart: number; readonly sampleDuration: number; readonly sampleRate: number;
	readonly sequenceBinding: Readonly<{ id: string; rate: RationalRate }>;
	readonly outputRate: RationalRate; readonly outputFrameCount: number;
	readonly intersections: readonly VideoRetimeExportIntersectionV6[];
	readonly limits: Readonly<{
		topologyRecordCount: number; compiledSegmentCount: number;
		geometricCandidateCount: number; serializedIntersectionCount: number;
		decimalByteCount: number;
	}>;
}
function createVideoRetimeExportIntentV6(
	input: unknown,
	timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>,
): VideoRetimeExportIntentV6;
```

This seam intentionally contains no format, codec, source Blob/URL, source
presentation, effect, transition-opacity, staged-audio, filter, label, path,
script, or argv field. Those remain owned by the existing export planner or a
future reviewed executor join.

## Input ownership and sample topology

The input, sequence binding, rates, topology records, and arrays are closed plain
own-enumerable data values; arrays are dense and carry no extra keys. Snapshot
through property descriptors once. Accessors, symbols, unstable proxies, extra
fields, noncanonical rates, unsafe integers, and later raw mutation refuse or
have no effect. A `Number` frame rate never crosses this seam. Full persisted
clips are the one closed-record exception described below.

Construct one 3B-5f cadence from the captured closed nonempty
`sequenceBinding: { id, rate }`. This DTO proves structural/self-consistency
only, not project, track, or source provenance. Atomic 3B-5h must derive it and
the timing tokens from one captured project revision.
`topology` is a dense, sorted, nonoverlapping partition of the global half-open
sample range in absolute integer `startSample`/`endSample` coordinates. This is
the current composition owner's domain and permits arbitrary mid-cell export
range edges. Empty `layers` means black. Layer and clip order is stable; an
occurrence contains only its globally unique canonical `clipId`. Copied runtime
clips, float source times, nested sequences, and local output origins refuse.

`canonicalClips` contains exactly one real persisted V16 video clip for each
referenced ID and no unreferenced clip. Such clips legitimately carry unrelated
fields and opaque extensions, so they are not treated as minimal closed DTOs.
Read the own-enumerable data descriptors for `kind`, `id`, `sourceId`,
`sequenceId`, `sequenceStartFrame`, `sequenceFrameCount`, `sourceInFrame`,
`sourceFrameCount`, and `retimeMap` exactly once; ignore other persisted fields
and reject every runtime-projection alias. Every clip must match
`sequenceBinding.id`; an equal rate from another sequence is insufficient.
Every occurrence interval must lie wholly inside that clip's point-rounded
program sample range. Clip IDs are unique, and clips may share one source.

`timingBySourceId` is the sole non-JSON construction input. It is an actual
`ReadonlyMap` with exactly one bound timing token for each active source. Binding
authenticated source/timing identity, not project lineage. Here authenticate
before reading only its source ID/frame count, then compare captured clip fields.
The token proves no canonical-snapshot membership. Never accept raw timing data;
shared sources share one token and incur no O(F) scan.

## Mapping branches and one-compile ownership

A non-null map contributes `mapping: 'curve'` rows with its original dense
zero-based segment indexes, modes, full outer bounds, exact source endpoints,
and ramp velocities. Persisted `retimeMap: null` instead contributes
`mapping: 'uniform-wall-clock'`; it never becomes a source-frame-linear segment.
Its exact full program bounds are the `point` sample boundaries of the clip's
canonical sequence start/end, and its exact source bounds are
`videoSourceFrameTime(sourceInFrame/sourceOutFrame)`. At clipped program sample
`x`, source time is exactly `sourceStartTime + (sourceEndTime - sourceStartTime)
* (x - clipStartSample) / (clipEndSample - clipStartSample)`.

Before implementing 3B-5g-a, extract one shared
`createVideoRetimeFrameBinding` seam for dispatcher and intent builder. It must
own-data descriptor-snapshot the complete V2 wire—map, dense arrays, every point/
segment record, and nested rational—into private plain values before compiling
once. It exposes canonical segments, exact map/owned-frame operations, and the
bound timing token. After binding, never ordinary-read the raw wire, compile
again for velocities, or duplicate dispatch ownership. Null clips do not compile
or enter this binding, dispatcher, or `localCellAt`; they use only the wall-clock
formula above. The extraction adds no maintained consumer or test-only counter.

## Decimal rational wire

Every exact value is `{ numerator, denominator }` with strings matching
`0|-?[1-9][0-9]*` and `[1-9][0-9]*`. Values are reduced, denominators positive,
and zero is exactly `0/1`; `-0`, leading zeroes, plus signs, exponent notation,
whitespace, and values above the 4,096-bit reduced ceiling refuse. BigInt is
construction-only. The returned graph contains no BigInt, function, undefined,
NaN, Infinity, token, raw map/index, or cache. JSON stringify/parse is
semantically equal, equivalent inputs produce identical property/array order,
and every returned record and array is deeply frozen.

## Global cadence, intersections, and drawable windows

The exact 3B-5f ceil count and absolute-sample floor own every row. Curve rows
also use its containing sequence frame and integer `localCellAt`; null rows use
continuous wall-clock progress at that output sample. Never reset phase,
accumulate a clock, or derive count from seconds.

Let `A = sampleStart`, `D = sampleDuration`, and `count = outputFrameCount`. For
absolute sample boundary `x`, `J(x)` is `0` when `x <= A`, `count` when
`x >= A + D`, and otherwise the positive signed-exact ceiling
`ceil((x - A) * outputRate.num / (sampleRate * outputRate.den))`. Convert clip
and curve sequence boundaries to samples once with the absolute-origin `point`
policy, then intersect them with topology. A null clip contributes one wall-clock
candidate per occurrence; a curve clip contributes its overlapping segments.
Geometrically nonempty candidates count even when `[J(start),J(end))` collapses;
collapsed candidates are not serialized. No output frame is visited.

For a nonempty curve interval, use `localCellAt(startOutputFrame)` and
`localCellAt(endOutputFrame - 1) + 1` to form the minimal continuous containing-
cell envelope; cadence-dropped interior cells need not be reachable. Each row
retains full segment index/bounds/source coefficients, its clipped range, exact
mapped source endpoints, and output bounds. Breakpoints are half-open and belong to
the following segment.

Drawable ownership is exactly 3B-5e: forward/ramp-forward floor, reverse/ramp-
reverse ceil-minus-one, freeze floor, then clip-bound clamp. A segment is
monotone: dispatch only `startOuterCell` and `endOuterCell - 1`, then take the
minimum/maximum owned frames. Those are exactly two ownership calls regardless
of span; never scan the containing-cell envelope. Convert the inclusive range
to its chronological frame-time window, including the final VFR duration. A null
row instead carries full program/source-time bounds and clipped wall-clock times,
with no segment, outer-cell, mapped-source, or drawable-frame field.

## Admission, complexity, and strict red

Before returning, enforce `outputFrameCount` in `1..2,000,000`; at most 16,384
topology records, counted as intervals plus layers plus clip occurrences; at
most 16,384 curve segments compiled once across unique clips; and at most 16,384
geometric mapping candidates, stopping at limit-plus-one before more allocation.
`geometricCandidateCount` includes collapsed candidates;
`serializedIntersectionCount === intersections.length`. Precharge the fixed
envelope and preflight every scalar's exact JSON-escaped UTF-8 length. Before each
row is retained, charge exact canonical JSON for repeated strings, fixed keys/
punctuation, arrays, and numeric scalars; refuse above 8,388,608 bytes. Separately
charge every repeated decimal occurrence's exact JSON-token bytes before
retention and expose that diagnostic count. There is no second decimal cap:
under the admitted rational bounds and closed row grammar, canonical row JSON is
always more than twice its decimal-token bytes, so the formerly proposed
4,194,304-byte sub-cap was strictly dominated by the 8,388,608-byte ceiling and
could not be reached through this public seam. Only after admission may one
no-newline `TextEncoder(JSON.stringify(intent))` run; its length must equal the
counter. Never allocate an over-cap stringify. Backend-specific caps await
reviewed 3B-5g-b.

Work is O(T + C + S + K log(S + 1)) through the existing mapper; storage is
O(T + C + S + K). These bounded terms are independent of output-frame and VFR
source-frame counts. Compile each non-null clip once, query only exact endpoint
times, freeze all output, and retain no raw input.

Start red only in `tests/audio-editor-video-retime-export-plan.test.ts`. Prove
global phase; integer/NTSC/noncommensurate rates; a four-cell irregular VFR null
case differing from frame-linear; nonzero-origin NTSC null progress and forbidden
curve fields; all modes and coefficients; half-open/final VFR windows; escaped IDs,
repeated decimals, and canonical JSON/order/freeze; canonical clip ownership; one
compile/token per clip/source; and changing-get V2 Proxy rejection or descriptor-
value semantics with zero post-bind raw gets. Also prove no accessor/VFR scan;
mutation isolation; forged-token/source refusal; repeated decimal accounting and
the JSON-dominance invariant; every independently reachable cap at and above limit;
`J` before/at-start and at/after-end; and a huge-span curve/source with exactly two
ownership calls. A 2,000,000-frame intent never iterates/allocates by output count.
Initial red is missing module/export. Run focused tests, both TypeScript configs,
focused lint, link/diff checks, and the canonical non-browser gate. No Chromium.

## 3B-5g-b hard stop

The repository pins `@ffmpeg/core` 0.12.10 to FFmpeg n5.1.4. Its corresponding
source shows `setpts` evaluates expressions as binary64 before integer PTS,
`fps` and `settb` evaluate binary64 then reduce to bounded `AVRational`, and the
command video-rate parser reduces to a 1,001,000 ceiling. V16 admits exact
rationals and intermediates beyond those representations. An adversarial ramp
can lie on either side of an ordinal boundary while producing the same backend
Number; no rounding mode restores the distinction.

Do not add an FFmpeg module, graph/script, argv, media loader, encoder adapter,
MP4/WebM claim, or browser export oracle. Resume 3B-5g-b only after review adds
timing-owned exact time-to-frame ownership for null VFR and accepts either an
exact backend or a narrower domain with a static proof for every ordinal.
Per-frame schedules/branches, output-sized state, epsilon, sampled integration,
silent rate approximation, constant-rate fallback, and fixture-only allowlists
remain disallowed. Until then 3B-5h export adoption is blocked, `videoRetime`
remains false in both products, and V16 stays preserved read-only without raw-
source fallback. A narrower executor cannot flip broad `videoRetime` without a
separately reviewed capability, admission, and versioning story.
