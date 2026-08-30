# Milestone 3B-5f: exact retime output cadence and dormant preview

> **Implemented on 2026-08-12.** Commit `e1e833e0` delivers 3B-5f-a's exact
> output cadence and generic latest-presentation queue; commit `24a12c73`
> delivers 3B-5f-b's exclusive paused HTML adapter and pinned VFR Chromium
> oracle. Both slices remain dormant: no maintained product path imports them
> and `videoRetime` availability is unchanged.

The canonical `npm run check` gate passed with 5,357 tests total, 5,355 passed
and 2 skipped; 90.00% statement and line coverage, 82.08% branch coverage, and
90.75% function coverage. The focused Node cadence/executor suite passed 23/23
and focused Chromium passed 4/4. Architecture passed with 896 modules, 2,486
dependencies, and 1,975 maintained files. The build processed 1,180 modules
and emitted 104 production JavaScript chunks; the largest was 400,686 bytes.
Packet 3B-5 remains **In progress**; the immediate pickup is 3B-5g's
contract-first deterministic FFmpeg feasibility gate.

## Delivery split and dependency rule

3B-5f was delivered in two atomic implementation slices:

1. **3B-5f-a — cadence and generic executor:** exact lazy global output cadence,
   one bounded latest-presentation queue, a balanced exact-to-Number terminal,
   and fake-port strict tests.
2. **3B-5f-b — browser media adapter:** an exclusive paused
   `HTMLVideoElement` adapter, one new decoder-qualified VFR fixture, and an
   isolated focused Chromium oracle.

Packet 3B-5f is complete. Serialized 3B-5g may now begin only at its
contract-first feasibility gate; export implementation remains stopped until
its deterministic all-mode representation and bounds are proven. The existing
irregular WebM could not qualify 5f-b's final source frame: its exact final
interval is `[0.879, 0.928)`, while Chromium reports a duration of `0.879718`
and presents the prior frame at `0.830` for every seek in the reachable tail.
Truncating that source's timing view or treating `seeked` as picture evidence
remains forbidden.

## 3B-5f-a exact global cadence

Add strict `src/common/editor/video-retime-output-cadence.ts`, under 600 lines,
with a public surface equivalent to:

```ts
interface VideoRetimeOutputCadenceInput {
	readonly sampleStart: number;
	readonly sampleDuration: number;
	readonly sampleRate: number;
	readonly sequenceRate: RationalRate;
	readonly outputRate?: RationalRate;
}
interface VideoRetimeOutputFrame {
	readonly outputFrame: number;
	readonly relativePts: Readonly<{ numerator: bigint; denominator: bigint }>;
	readonly absoluteSample: number;
	readonly sequenceFrame: number;
}
interface VideoRetimeOutputCadence {
	readonly sampleStart: number;
	readonly sampleDuration: number;
	readonly sampleRate: number;
	readonly sequenceRate: RationalRate;
	readonly outputRate: RationalRate;
	readonly outputFrameCount: number;
	readonly frameAt: (index: number) => VideoRetimeOutputFrame;
	readonly localCellAt: (
		index: number, sequenceStartFrame: number, outerFrameCount: number,
	) => number | null;
}
function videoRetimeOutputRateFromInteger(rate: number): RationalRate;
function createVideoRetimeOutputCadence(
	input: VideoRetimeOutputCadenceInput,
): VideoRetimeOutputCadence;
```

The input and both rates are closed own-data records. Rates are positive,
canonical `gcd(num, den) === 1` safe integers; a Number rate never crosses this
seam. `videoRetimeOutputRateFromInteger` is the sole convenience normalizer.
Omitted output rate snapshots the canonical sequence rate. Sample start is a
nonnegative safe integer, duration and sample rate are positive safe integers,
and `sampleStart + sampleDuration` must remain safe. Require the existing exact
sequence-grid bound `sequenceRate.num <= sequenceRate.den * sampleRate`; a
higher rate has coincident sample boundaries and no unique containing frame.

One global range `[A, A + D)` owns phase. The exact output count is
`ceil(D * outputRate.num / (sampleRate * outputRate.den))`; refuse before query
work unless it is in `1..2,000,000`. For output index `j`, relative PTS is the
reduced exact rational `j * outputRate.den / outputRate.num`; absolute sample is
`A + floor(j * sampleRate * outputRate.den / outputRate.num)`. Existing
`sequenceFrameAtSample` then owns the unique absolute containing sequence
frame. Every multiply/divide uses bounded BigInt intermediates; no accumulated
clock or float phase is accepted.

`localCellAt` subtracts one validated absolute `sequenceStartFrame` from
that frame and returns null outside half-open cells `0..outerFrameCount-1`.
This method centrally owns clip intersection so 5g cannot reset phase per clip
or interval. Mismatched output/sequence rates duplicate or drop whole sequence
cells; they never evaluate the curve at a sub-cell rational. The plan and
frames are deeply frozen. It retains at most one last-query cache, never an
array proportional to output count.

## 3B-5f-a generic latest-presentation executor

Add strict `src/common/editor/video-retime-preview-executor.ts`, under 600
lines and runtime-self-contained except type-only dispatcher imports. Its
logical port and surface are equivalent to:

```ts
interface VideoRetimePreviewMediaPort {
	pause(): void;
	assertCurrent(): void;
	present(request: Readonly<{
		drawableSourceFrame: number;
		intervalStartSeconds: number;
		intervalEndSeconds: number;
		targetSeconds: number;
		signal: AbortSignal;
	}>): PromiseLike<Readonly<{ mediaTime: number }>>;
}
type VideoRetimePreviewResult =
	| Readonly<{ kind: 'presented' }>
	| Readonly<{ kind: 'superseded' }>
	| Readonly<{ kind: 'cancelled' }>;
interface VideoRetimePreviewExecutor {
	requestFrame(descriptor: VideoRetimeFrameDescriptor): Promise<VideoRetimePreviewResult>;
	cancel(): void;
	dispose(): void;
}
function createVideoRetimePreviewExecutor(
	port: VideoRetimePreviewMediaPort,
	options: Readonly<{
		onPresented: (descriptor: VideoRetimeFrameDescriptor) => void;
	}>,
): VideoRetimePreviewExecutor;
```

Construction snapshots and pauses one exclusive media port. Each request
descriptor is read through own enumerable data properties and reduced to a
key `{drawableSourceFrame, exactStart, exactEnd}`; outer cell and curve mode do
not define picture identity. Snapshot the closed complete descriptor and every
nested exact rational once, deeply freeze it, and use that same snapshot for
keying and callback publication; accessors, extras, and later raw mutation
refuse or have no effect. Require canonical positive-denominator exact values
within the 4,096-bit input ceiling and exact `start < end`.

Form the exact interval midpoint under 3B-5a's admitted-product and normalized-
intermediate law. Operands are at most 4,096 bits; permit the bounded raw
products of admitted operands needed for cross-reduced addition, normalize,
then enforce the 4,096-bit ceiling on the reduced midpoint and exact comparison
operands. Never refuse only because a reducible pre-GCD product exceeds that
ceiling. One
balanced scaling terminal converts both boundaries and the midpoint to finite
doubles without ever doing
`Number(hugeNumerator) / Number(hugeDenominator)`. Decode the chosen IEEE-754
value back to its exact binary rational and prove it lies strictly inside the
exact interval. If rounded midpoint misses, one deterministic next-
representable candidate from the lower boundary may be used only after the
same exact proof; otherwise refuse. Numeric boundaries must remain ordered and
contain the target. Underflow, overflow, a collapsed Number
interval, NaN, Infinity, duration clamp, and epsilon repair all refuse.
Pin the reduction case with coprime odd ~2,047-bit `q > r`, with `p=q-r` also
~2,047 bits, plus an odd ~4,043-bit `M` coprime to all three. Start
`(p*q-M)/(p*q)` and end
`(p*r+M)/(p*r)` straddle one by several binary64 ULPs; their raw midpoint work
exceeds 4,096 bits but reduces below the ceiling to `1 + M/(2*q*r)` and passes.

State is exactly last presented, one active request, and one replaceable
pending request. `requestFrame` is synchronous in construction of its Promise:

- repeated active or pending keys return the same Promise, so callers cannot
  accumulate resolver state; their latest descriptor replaces older metadata
  and is the one supplied to the eventual `onPresented` callback;
- active A followed by B then C settles B as superseded immediately and keeps C;
- active A plus pending B followed by newest A settles B and coalesces with A,
  so B never starts;
- a completion with a different pending key is stale, never publishes, settles
  superseded, and starts only that latest pending request; and
- an already-presented key may reuse one cached resolved result only while the
  port still owns that exact media state.

The executor calls `assertCurrent` immediately before `present` and again after
presentation, before publication. Supersession and cancellation are frozen
normal results. Genuine port/currentness faults reject; do not also report
them through a second ambiguous error channel. One centralized `onPresented`
callback supplied at construction runs only for a still-current successful
key, after last-presented state is installed so callback re-entry is safe.
The port's finite `mediaTime` must lie in
`[roundToBinary64(exactStart), roundToBinary64(exactEnd))`. Equality with the
rounded inclusive start represents that exact boundary; otherwise its decoded
binary rational must lie in `[exactStart, exactEnd)`. `seeked` alone cannot
satisfy the executor.

Any `assertCurrent` or media-port fault makes that media-bound executor
terminal: abort and reject active plus pending with the same error, publish
nothing, and require a new executor. A stale success with newer pending work is
the only completion that advances to the pending request. Already-presented
same-key requests return the cached presented result without another callback.
If `onPresented` throws, treat it as one terminal consumer fault: clear the
reusable presented cache, reject active plus pending with that error, and
refuse every later request.

`cancel` aborts and settles active and pending work and generation-fences every
late resolution while leaving the executor reusable only after drain. The
aborted active operation remains a nonpublishing draining slot until its port
Promise settles; that settlement is the port's acknowledgement that a new seek
is safe. Requests during drain occupy the one replaceable pending slot and
must not call `present`. `dispose` cancels and is terminal. Replacing pending
never aborts active, because abort may not stop the decoder. Memory remains O(1).

Start red in `tests/audio-editor-video-retime-output-cadence.test.ts` and
`tests/audio-editor-video-retime-preview-executor.test.ts`. Cover nonzero
global origin; default/integer/NTSC output rates; noncommensurate duplicate and
dropped cells; exact count/floor; first/last/2,000,000 frames; null clip
intersection; unsafe/accessor/noncanonical/rate/count refusals; frozen bounded
state; balanced 4,096-bit intervals; reducible over-ceiling raw midpoint products
whose normalized result fits; normalized over-ceiling refusal; exact midpoint
success and collapsed/no-interior refusal; every A/B/C queue permutation; callback
re-entry/throw; stale success/failure; currentness; cancel-then-immediate-request
drain, disposal, and zero late publication; nested accessors and post-call
mutation. A source audit proves no application consumer imports either module.

## 3B-5f-b paused HTML media adapter and browser oracle

Add strict `src/common/editor/video-retime-html-video-seek-port.ts`, under 600
lines. Its factory is equivalent to
`createVideoRetimeHtmlVideoSeekPort(video, { assertCurrent, timeoutMs? })`.
Options are own-data; `assertCurrent` is required, while timeout defaults to
5,000 ms and must be a positive safe integer no greater than 30,000. The
factory snapshots the element's nonempty current source identity and rejects
any later source/generation change before or after work. It exclusively owns
that `HTMLVideoElement`, requires
`requestVideoFrameCallback` and its cancellation peer, keeps playback paused,
registers `seeked`, error, abort, timeout, and frame-presentation evidence
before assigning exact midpoint `currentTime`, and cleans every resource on all
paths. A paused element presents no further frame for the picture it already
shows, so every uncached request seeks; only the cached-presentation fast path,
keyed by the exact request and an unmoved in-interval clock, skips one. Success
requires both the seek and a callback from that request generation whose finite
`mediaTime` is in the requested half-open interval.
Reject source/currentness change, setter failure, timeout, decode error, absent
rVFC, or an out-of-interval picture. rVFC is the picture authority; harmless
media-clock quantization is not rejected independently. There is no
play/rate fallback, epsilon, or `seeked`-only success. Abort rejects only after
listeners, rVFC, and timer are removed and the issued seek is safe to replace;
that settlement is the generic executor's drain acknowledgement.

Add a tiny repository-owned VFR MP4 generated by the pinned FFmpeg 0.12.10
runtime from unique ordinal-color frames. Pin the complete generation recipe,
FFmpeg arguments, output SHA-256, exact PTS/timescale/final duration, and pixel
oracle. Its sample table must contain unequal durations and put container
duration/seekable end beyond the last frame PTS. Prequalification must show
that every exact interval midpoint, especially the final one, produces rVFC
`mediaTime` in that interval and the matching ordinal pixels. Do not rewrite or
truncate the existing WebM fixture to make it pass.

The qualified recipe uses four 64×32 RGB ordinal frames and exact timescale
1,000 PTS `[0, 40, 130, 200]` with final duration 70 ticks: intervals are
40/90/70/70 ms and media end is 270 ms. Pinned FFmpeg must use VFR mode,
`settb=1/1000`, the explicit PTS expression, all-I Constrained Baseline H.264
with `-profile:v baseline -crf 1 -pix_fmt yuv420p`, and
`-enc_time_base 1/1000 -video_track_timescale 1000`; omitting encoder time base
silently quantizes the intended PTS and refuses qualification. Midpoint rVFC
times must be `0/.04/.13/.2`, with the four encoded color/bit ordinals. The raw
RGB SHA-256 is `191afca830eff27f7bb057e46256b775e64fa5c143abc7e17f38ec394bc65203`;
the three-times-reproduced 3,967-byte MP4 SHA-256 is
`8800d170f366faadbf9e8b28523e1294c8ec5cbf470f957698d95259a0450205`.

The focused spec
`tests/browser/audio-editor-video-retime-preview-executor.spec.js` remains
under 800 lines. Serve the real strict modules through same-origin Playwright
routes after Vite `transformWithEsbuild`; do not add a test-only application
global or production import. Prove constant/reverse/freeze/both-ramp request
order, final unequal VFR interval, last-wins/stale fencing, pause/currentness,
timeout/cancel cleanup, and pixel plus rVFC oracles. Build first and run focused
Chromium. The delivered qualification proves the final ordinal honestly; loss
of that proof invalidates 5f-b's acceptance evidence.

## Dormancy, future adoption, and stops

- No V17/wire, command, history, capability, menu, application bundle, preview
  panel, Project Bin, export, FFmpeg plan, policy, archive, or desktop change.
- Until atomic 5h, no application/UI/controller/export consumer outside the
  new dormant 5f module family may import it. The later per-clip coordinator
  must hide an entry whenever its latest request is not ready; callback fencing
  alone cannot stop the current GPU RAF from drawing an intermediate seek.
- `VideoPreviewPanel.jsx` is already at 599 lines. 5h must extract a focused
  coordinator/component rather than grow or exempt it, build dispatchers from
  canonical clips before projection, and drive per-entry executors from the
  imperative integer engine-frame RAF path.
- Dispose an executor before retiring its element or releasing its source URL.
  Use one executor per clip/element so transitions and layers remain concurrent.
- Stop on interval-local cadence reset, sub-cell curve evaluation, output-sized
  retained state, overlapping seeks, stale publication, unauthenticated timing,
  per-pixel/audio-sample BigInt, float/epsilon repair, a false VFR final-frame
  claim, or any maintained import/capability flip before 5g and atomic 5h.
