# Time and media architecture

Soundscaper and Framescaper edit audio and video without reducing every
coordinate to seconds. A project instead preserves the domain in which a value
was authored, then resolves that value for a particular runtime consumer.

This document describes the invariants that timing code must preserve. The
implementation, validators, compatibility register, and tests are authoritative
when details differ from this overview.

## Coordinate authorities

The common timeline coordinate is an integer sample frame at the document's
`project.sampleRate`. It is the interchange point for playback, waveform,
navigation, and other audio-clock consumers; it is not the persisted authority
for every kind of time.

Each coordinate has one owning domain:

| Coordinate | Persisted authority |
| --- | --- |
| Absolutely placed audio | Integer timeline sample frames |
| Musically placed audio and markers | Exact rational beats |
| Video placement and extent | Integer sequence frame index and count |
| Video source in/out | Source frames or the source's own timebase |
| Ordinary tempo event | Exact rational beat position |
| Sample-locked tempo event | Integer timeline sample position |
| Signature event | Integer bar index |
| Warp or retime point | An outer-domain/source-domain coordinate pair |

Milliseconds, decimal ticks, and floating-point seconds are presentation or API
values, not stable timeline identities. Boundaries are compared, sorted, and
used as map keys; their representation must therefore be exact and associative.

A clip can contain several authorities at once. Its timeline position, source
in-point, duration, musical anchor, and retime map must not be conflated merely
because a UI can display all of them as timecode.

Branded `SampleFrame`, `VideoFrame`, and `SourceTicks` types make accidental
cross-domain arithmetic visible in TypeScript. Their definitions and the exact
conversion primitives live in
[`timeline-time.ts`](../../src/common/editor/timeline-time.ts).

## Exact values and rounding

Rates, beats, tempo values, and authored curve coordinates use reduced rational
values. Conversions compose the integer numerator before division and use
`BigInt` internally when ordinary integer arithmetic cannot remain exact. This
exactness belongs at edit, validation, and planning boundaries; it is not a
requirement to run per-sample or per-pixel processing with `BigInt`.

Every conversion to an integer names its rounding purpose. The shared policies
are defined in
[`timeline-rounding-policy.ts`](../../src/common/editor/timeline-rounding-policy.ts):

- `point` chooses the nearest representable point.
- `enclosingStart` rounds toward the outside of a range's start.
- `enclosingEnd` rounds toward the outside of a range's end.
- `directional` follows the direction of the edit.

Resolve endpoints from the same absolute origin, then subtract them to obtain a
duration. Do not add independently rounded durations: at fractional frame rates
that accumulates drift and can make adjacent ranges disagree about a boundary.

Rounding is a named semantic decision, not a helper default to copy casually.
New conversions should expose the policy at the boundary where loss of exactness
occurs and test both positive and negative directions where applicable.

## Runtime projection

Playback and rendering code do not interpret heterogeneous persisted clip
coordinates directly. The shared
[`runtime-clip-projection.ts`](../../src/common/editor/runtime-clip-projection.ts)
resolves a project to absolute sample boundaries and, for video, the applicable
frame coordinates. Projected clips identify their coordinate domain as
`resolved-samples`.

The projection is the shield between document semantics and runtime consumers:

1. validators establish one authoritative persisted representation;
2. the projection resolves tempo, sequence, and anchor semantics once;
3. playback, preview, export, composition, navigation, transitions, and waveform
   code consume the resolved view;
4. runtime-derived sample positions are not written back as caches.

Persisting derived sample caches would create two authorities after tempo or
sequence changes. Where a format deliberately contains redundant evidence, a
mismatch is rejected instead of silently repaired.

The projection carries an internal version and an unforgeable runtime brand.
Consumers that require resolved coordinates should assert that boundary rather
than accept objects which merely resemble projected clips.

## Sequences and source timing

A sequence rate is rational and is distinct from the rate reported by a video
source. The same source may be edited into differently rated sequences. Drop
frame and start timecode affect display and interchange; they do not replace the
underlying frame index.

[`sequence-timing-model.ts`](../../src/common/editor/sequence-timing-model.ts)
derives the sequence view shared by rulers, readouts, and controllers.
[`sequence-timecode.ts`](../../src/common/editor/sequence-timecode.ts) owns
timecode parsing and formatting.

Source timing remains source authority:

- constant-frame-rate media maps through its exact rational rate;
- variable-frame-rate media maps through an immutable presentation-timestamp
  index;
- the final VFR frame has an explicit duration rather than an inferred open end;
- presentation timestamps and frame ordinals remain distinguishable.

The VFR index is an external, digest-bound binary asset, not a large table in
project JSON. Its canonical encoding, summary, and integrity checks are owned by
[`video-timing-asset.ts`](../../src/common/editor/video-timing-asset.ts) and
[`video-timing-asset-reference.ts`](../../src/common/editor/video-timing-asset-reference.ts).
Exact source-boundary lookup is exposed through
[`video-source-timing-view.ts`](../../src/common/editor/video-source-timing-view.ts).

Probed source characteristics preserve uncertainty. Unknown rotation, field
order, color, or rate facts remain `null`; validators and consumers must not
invent plausible defaults and then persist them as observations. The closed
probe record is defined by
[`video-source-characteristics.ts`](../../src/common/editor/video-source-characteristics.ts).

## Editing across domains

Quantization belongs to the operation, not to each affected clip. Two small
sample deltas rounded separately need not equal their combined frame delta, so
per-clip conversion can make a group edit non-associative.

The mixed-domain rules are:

- an operation touching video conforms once to a whole sequence-frame delta;
- video placement and extent change in frame space;
- linked audio endpoints are recomputed from the resolved video endpoints;
- linked audio may change by one sample at fractional rates to remain exactly
  aligned with the video presentation range;
- unlinked audio in that operation moves by the resolved absolute sample delta;
- audio-only operations retain sample resolution;
- slip edits change source coordinates without changing presentation placement.

The frame-canonical planners under
[`src/common/editor/`](../../src/common/editor/) implement trim, ripple, roll,
slide, slip, and rate-stretch semantics. In particular,
[`frame-canonical-trim-planning.ts`](../../src/common/editor/frame-canonical-trim-planning.ts)
shows the endpoint-based linked-audio rule. A new edit operation should reuse
these planners or state why its domain contract is different.

An A/V link represents a shared presentation anchor, not equality between two
stored coordinate records. Validation compares the resolved presentation
ranges.

## Tempo, warp, and retime

Tempo events and musical anchors use exact beats. Ordinary maps derive samples
from beat positions; `sampleLocked` maps are the explicit exception in which
event sample positions remain fixed. Tempo integration rounds once from the map
origin so edits do not accumulate segment-local errors.

Audio warp and video retime share the idea of an ordered breakpoint map but not
all behavior:

- audio warp is strictly forward and increasing;
- video retime can contain forward, reverse, and freeze regions;
- the current video curve also supports exact forward and reverse ramps;
- outer positions are ordered and bounded;
- authored maps are capped at 4,096 points;
- evaluation and inversion retain exact rational coordinates until a named
  output boundary requires rounding.

Audio rules are owned by
[`audio-warp-domain.ts`](../../src/common/editor/audio-warp-domain.ts). Video
curve validation and exact integration are owned by
[`video-retime-curve.ts`](../../src/common/editor/video-retime-curve.ts), with
runtime mapping and export cadence in their neighboring `video-retime-*`
modules. Do not make an audio map accept freeze or reverse merely because the
lower-level breakpoint evaluator can represent them.

## Proxies and derived media

A proxy is an authenticated derivative, never a new timing authority. It is
bound to the exact original generation, content identity, and timing facts from
which it was made. Preview may use a conforming proxy, while export and delivery
remain original-authoritative.

Proxy timing must reproduce the original frame-boundary view. The proxy
container's audio is ignored; project audio remains the audio authority. The
relationship and conformance rules live in
[`video-proxy-relationship.ts`](../../src/common/editor/video-proxy-relationship.ts)
and
[`video-proxy-timing-conformance.ts`](../../src/common/editor/video-proxy-timing-conformance.ts).

Missing, stale, or nonconforming derived media produces an explicit unavailable
or fallback state. It must not silently change source mapping or export timing.

## Persistence and compatibility

Project schema validators own the exact wire representation. Runtime projection,
timecode labels, evaluated samples, decoder state, and viewport-dependent values
are derived and do not belong in project JSON.

Feature registration and preservation are governed by
[`project-feature-capabilities.ts`](../../src/common/editor/project-feature-capabilities.ts)
and the machine-readable
[`project-compatibility.json`](../../config/project-compatibility.json). A new
timing-bearing field must be registered with its owning feature so another
product can reject or preserve it deliberately rather than partially interpret
it.

Current-format validators reject ambiguous or contradictory timing data. They do
not guess a source rate, normalize an invalid authored boundary, or silently
pick one of two competing authorities.

## Verification

The focused executable specifications include:

- [`audio-editor-timeline-time.test.ts`](../../tests/audio-editor-timeline-time.test.ts)
  for rational conversion, tempo, rounding, and breakpoint behavior;
- [`audio-editor-runtime-clip-projection.test.ts`](../../tests/audio-editor-runtime-clip-projection.test.ts)
  for the resolved consumer boundary;
- [`audio-editor-video-timing-asset.test.ts`](../../tests/audio-editor-video-timing-asset.test.ts)
  for immutable VFR timing evidence;
- [`audio-editor-video-retime-curve.test.ts`](../../tests/audio-editor-video-retime-curve.test.ts)
  for exact curve semantics;
- [`audio-editor-video-proxy-timing-conformance.test.ts`](../../tests/audio-editor-video-proxy-timing-conformance.test.ts)
  for original/proxy boundary equivalence.

When changing a timing contract, test exact boundary equality, fractional rates,
non-default sample rates, negative-direction edits where supported, save/reopen,
and both preview and export consumers. A visually plausible result is not enough
if it creates a second authority or allows cumulative drift.
