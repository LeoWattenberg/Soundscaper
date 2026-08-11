# Milestone 3B-5a: exact video-retime curve algebra

> **Planned immediate pickup after 3B-4:** this bounded, schema-neutral slice
> defines and implements the pure exact algebra needed before the persisted
> ramp-curve revision. It adds no document field, migration, command, menu,
> control, capability claim, playback path, or export behavior.

## Outcome boundary

One strict module compiles a bounded internal V2-style curve, evaluates it in
closed form, and inverts a source position onto the discrete outer-frame grid.
It is useful only through direct unit tests in this slice. Later 3B-5 slices may
adopt it when the V16 wire contract, commands, UI, playback, export, linked
audio policy, and capability evidence are each designed.

The module is pure: no project read, timing-asset read, mutation, command,
history, worker, cache, or floating-point approximation. All public results and
nested members are deeply frozen.

## Internal curve contract

The normalized shape is internal TypeScript, not `.scape` state:

```ts
type VideoRetimeCurveRational = Readonly<{ num: number; den: number }>;
type ExactVideoRetimeRational = Readonly<{
	numerator: bigint;
	denominator: bigint;
}>;

interface ExactVideoRetimeCurve {
	readonly version: 2;
	readonly outerFrameCount: number;
	readonly sourceStartFrame: number;
	readonly sourceFrameCount: number;
	readonly points: readonly Readonly<{
		outerFrame: number;
		sourceFrame: VideoRetimeCurveRational;
	}>[];
	readonly segments: readonly ExactVideoRetimeSegment[];
}

type ExactVideoRetimeSegment =
	| Readonly<{ mode: 'constant-forward' | 'constant-reverse' | 'freeze' }>
	| Readonly<{
		mode: 'ramp-forward' | 'ramp-reverse';
		startVelocity: VideoRetimeCurveRational;
		endVelocity: VideoRetimeCurveRational;
	}>;
```

- There are 2 through 4,097 points, at most 4,096 segments, and exactly
  `points.length - 1` segments. Unknown keys, sparse arrays, accessors, and
  non-plain records refuse rather than being normalized away.
- `outerFrame` is a safe integer clip-relative frame boundary. Points are
  strictly increasing inside `0..outerFrameCount`; the first is `0` and the
  last is `outerFrameCount`.
- `sourceFrame` is a canonically reduced bounded number rational with positive
  denominator in the closed source-boundary range
  `sourceStartFrame..sourceStartFrame + sourceFrameCount`. Source positions are not
  rounded to integer frames during evaluation.
- Constant-forward source positions increase, constant-reverse positions
  decrease, and freeze endpoints are equal. A constant velocity is derived
  exactly from its endpoint span; it is not stored twice.
- Ramp velocities are nonnegative source-frame magnitudes per outer frame. A
  forward ramp has increasing source endpoints and positive sign; a reverse
  ramp has decreasing endpoints and negative sign. Both magnitudes cannot be
  zero. Nonnegative endpoints keep the linear magnitude from crossing zero in
  a segment interior.
- Position is C0 because adjacent segments share one point. Velocity is not
  continuous by default: an author may express an explicit speed jump between
  adjacent segments. A direct forward/reverse direction change is stricter:
  both incident ramp velocities at the shared breakpoint must be zero. A
  freeze segment is an explicit zero-speed interval. A constant-speed direct
  reversal therefore refuses instead of hiding a zero crossing.

## Bound compilation

`compileVideoRetimeCurve(input)` accepts only the internal V2-style input above
and returns its normalized, deeply frozen snapshot. The three bound fields are
required safe integers: `outerFrameCount` and `sourceFrameCount` are positive,
`sourceStartFrame` is nonnegative, and both closed ends remain safe. Compilation
requires points at both outer boundaries and never inserts, clamps, or holds an
edge. A later persisted-wire adapter owns translating a V15 map or future V16
state into this exact bound shape.

Constant segments retain V15's evaluated forward, reverse, and freeze semantics
for equivalent fully bound points. This slice proves that equivalence without
claiming that every historically valid V15 map is ready for native playback;
clip binding and compatibility admission remain later integration work.

## Exact evaluation

`evaluateVideoRetimeCurve(curve, outerFrame)` accepts an in-bounds integer,
canonical bounded number rational, or runtime `ExactVideoRetimeRational` outer
coordinate and returns a reduced, frozen runtime exact rational. Its BigInt fields are deliberately
non-persisted: a valid bounded curve can produce an interior ramp denominator
larger than `Number.MAX_SAFE_INTEGER`. Out-of-bounds evaluation refuses; edge
holding is a compile-time binding decision, not an evaluator clamp.

For segment start `(a, p0)`, end `(b, p1)`, `L = b - a`, and `t = x - a`:

- constant modes use `p(x) = p0 + (p1 - p0) * t / L`;
- freeze returns `p0`; and
- a ramp with direction `d` (`+1` forward, `-1` reverse) uses
  `p(x) = p0 + d * (v0*t + (v1-v0)*t*t/(2*L))`.

Every ramp validates the integral endpoint identity
`p1 - p0 = d * L * (v0 + v1) / 2` exactly. Normalization, comparison,
multiplication, and reduction use BigInt numerator/denominator arithmetic.
There is no `Number` division, epsilon, sampled integration, accumulated frame
delta, or intermediate rounding.

Runtime exact numerators and denominators have a 4,096-bit normalized ceiling.
Runtime exact inputs are checked against that ceiling before normalization or
GCD. Every normalized intermediate is checked against the same ceiling; one
primitive operation may allocate at most the bounded product of two admitted
operands before reduction. Evaluation, composition, and inversion refuse
deterministically when that budget is exceeded instead of admitting unbounded
BigInt work.

## Discrete exact inversion

`invertVideoRetimeCurve(curve, sourceFrame, options)` accepts a canonical
bounded number rational or runtime `ExactVideoRetimeRational` and finds
occurrences on the integer outer-frame grid without solving a quadratic root.
It returns one of three frozen occurrence shapes:

```ts
{ kind: 'point', outerFrame: number }
{ kind: 'range', startOuterFrame: number, endOuterFrame: number }
{ kind: 'bracket', beforeOuterFrame: number, afterOuterFrame: number }
```

- `point` means exact equality at that integer frame.
- `range` is the maximal inclusive integer range over which the curve equals
  the requested source position, including adjacent equal freeze segments.
- `bracket` contains consecutive integer frames whose exact evaluated source
  values enclose one continuous monotone crossing. It reports the cell, not an
  invented nearest source frame or a claimed irrational root.

Segments own `[start, end)`; only the final segment owns its closed end. Shared
breakpoint hits are therefore emitted once. Freeze ranges are maximally merged;
all other occurrences are ordered by their outer interval and deduplicated.
Each monotone segment uses exact comparisons and a bounded binary search over
integer frames. It never calls `sqrt`, converts to float, scans every frame, or
rounds a source request.

The selection policies are `all`, `earliest`, `latest`, and `nearest-cell`.
`all` returns the ordered occurrence list. The other policies select one
occurrence unchanged or return no occurrence. `nearest-cell` requires a safe
integer `outerHint`, compares distance to each closed point/range/bracket cell,
and chooses the earlier cell on a tie. It does not approximate the continuous
root. A source position outside every exact segment range yields no occurrence,
never a silent nearest-source projection.

## Red seams and acceptance

Production ownership is
`src/common/editor/video-retime-curve.ts`. Red tests begin in
`tests/audio-editor-video-retime-curve.test.ts`; dense multi-hit,
freeze-range, and irrational-root cases may be extracted to
`tests/audio-editor-video-retime-inversion.test.ts`.

Acceptance covers deep immutability; rational normalization and overflow
refusal; the 2/4,096/4,097 bounds; all five segment modes; exact endpoint and
mid-ramp values; forward/reverse ramps with one zero endpoint; endpoint-identity
and interior-zero refusal; allowed same-direction speed jumps; explicit-zero
direction changes; V15-equivalent forward/reverse/freeze evaluation;
integer and NTSC-shaped ratios; exact points; maximal freeze ranges;
irrational-root brackets; repeated source hits across direction changes; all
four selection policies; half-open deduplication; and logarithmic-search
instrumentation over a maximum safe outer extent.

Run the focused strict tests while red/green, then typecheck, lint,
architecture, file-size, `npm test`, `npm run check`, and diff checks before
recording this algebra as implemented. No browser row is required because no
maintained workflow consumes it yet.

## Non-goals and stop conditions

- No V16 schema, migration, persisted curve, validator, clone/clipboard/scape
  fixture, command, Undo/Redo, menu, shortcut, control, default-visible UI,
  capability change, compatibility flip, playback, preview, export, render
  cache, audio warp, pitch policy, nested sequence, optical flow, or proxy work.
- Stop if exact evaluation needs float arithmetic, an approximation tolerance,
  sampled integration, unbounded BigInt growth at the public boundary, or
  more than one rounding policy.
- Stop if inversion needs a square root, per-frame scanning, source snapping,
  an ambiguous scalar result for a freeze/multi-hit curve, or a hidden choice
  among occurrences.
- Stop if a schema or product surface must land to make the pure tests pass.

The persisted ramp-curve revision and every maintained consumer remain later
3B-5 slices. The four packaged Electron timing-probe rows remain
`pending-external`, and WebKit remains deferred; this algebra changes neither.
