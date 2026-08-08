# Milestone 3 plan: parallel editorial foundations

> Owning source for milestone-3 sequencing, the shared time-model decision,
> its invariants, and the bounded work packets. The
> [roadmap](../roadmap.md#3-parallel-editorial-foundations) owns scope and
> status; the compatibility and security policies own their claims. Grounded
> against the repository, OpenTimelineIO, DAWproject, and the AUP4
> interchange on 2026-08-09.

## Goals and ordering principle

1. **Primary: users must not hit trouble.** No cumulative A/V drift, no
   video cuts off the frame grid, no meter changes drifting off barlines, no
   silent read-only degradation from unregistered features, no lossy or
   irreversible migration surprises, no non-deterministic save/reopen.
2. **Secondary: implementation stays smooth for concurrent agents.** The
   serialized foundation phase removes the files both product tracks would
   otherwise fight over; parallel work starts only where ownership is
   file-disjoint.

Work is ordered by user-facing risk, not by delivery speed. The most
irreversible decisions (schema, time model) land first, once, under review,
before any dependent feature work begins.

## Phase structure

| Phase | Mode | Content |
| --- | --- | --- |
| 3.0 | Serialized (one work stream) | Shared time module, schema revision, compatibility registration, headroom refactors |
| 3A | Parallel track | Soundscaper editorial features over the foundation |
| 3B | Parallel track | Framescaper editorial features over the foundation |

3A and 3B must not begin until every 3.0 acceptance check passes. Within
3A/3B, agents follow the coordination rules below.

## Time-model decision

### Canonical coordinate

The canonical timeline coordinate remains **integer sample frames at the
document's `project.sampleRate`**. This is per-document: schema validation
accepts any positive safe-integer rate, and legacy Audacity import writes
the source project's rate, so 44.1 kHz and 96 kHz documents are reachable
even though new projects default to 48 kHz.

Milliseconds, microseconds, and float seconds are rejected as timebases.
One 48 kHz sample is 1/48 ms and one NTSC frame is 1001/30000 s; neither
terminates in any decimal subdivision of the second, so fixed decimal ticks
cannot satisfy the sample-accuracy or frame-accuracy exit gates. Float
seconds are rejected on **identity**, not precision: gapless abutment needs
bit-identical boundary equality, ripple edits need associativity, and
positions serve as map and sort keys. (Do not argue "floats lose precision"
in reviews — at three hours the representable error is ~1e-7 samples; the
identity argument is the correct and sufficient one.)

### Anchor domains

Every time-bearing object declares exactly one authoritative domain; all
other representations are derived, cached at most, and validated against
the anchor. Validators **reject** derived/authoritative mismatches; they
never silently repair them.

| Object | Authoritative domain |
| --- | --- |
| Audio clip (absolute) | integer timeline samples |
| Audio clip (musical), markers/regions with musical anchor | exact rational beats; samples derived through the tempo map |
| Video clip start and extent | integer frame index/count at the sequence's rational rate |
| Video source in/out | integer source-frame index in the source's own timebase |
| Tempo event | exact rational beat position (plus derived sample cache) |
| Signature event | integer bar index |
| Warp/retime breakpoint | (outer anchor, integer source sample/frame) pair |

Notes:

- Video clip **starts** are frame-anchored, not only extents. Every edit
  primitive that moves a video clip (ripple, paste, slip/slide/roll, move)
  quantizes its delta to whole sequence frames; validators reject video
  placements off the frame grid. Without this rule, sample-domain ripple
  deltas produce sub-frame video cuts.
- Sequences are first-class: `{ rate: {num, den}, dropFrame,
  startTimecode }`. The rational rate table currently lives only in snap
  grids, which is a UI concern, not a document model.
- Audio clips and markers carry `anchor: 'sample' | 'musical'` from the
  first schema revision. Retrofitting the field later means another
  migration on a hand-written chain; quantize/groove features have nothing
  stable to work against without it.
- Tempo maps fitted to recorded performance set a `sampleLocked` flag so
  analysis-derived maps do not re-flow; sample-locked is the exception, not
  the default semantic.
- VFR sources persist a per-frame timing index (frame index to PTS in the
  source timebase) or a recorded conform-to-CFR-at-ingest decision. A
  single rational rate cannot describe irregular timestamps.

### Tempo map semantics

- Signature events anchor at integer bars; tempo events anchor at exact
  rational beats. Sample positions of events are derived by a single
  rounding of the exact rational sum of prior segments from the origin,
  never accumulated segment-by-segment.
- Tempo values are stored as bounded rationals (integer micro-BPM or
  `{num, den}`), not free doubles. Exact arithmetic over IEEE doubles
  produces unbounded denominators and non-canonical equal-looking tempos.
- Milestone 3 ships **hold (step) tempo segments only**. Hold segments are
  exactly representable in both the beat and sample domains and round-trip
  through DAWproject, which offers only hold and linear. If ramps ship
  later, they are defined as linear-in-beats with a closed-form integral in
  the shared time module (DAWproject's linear means bpm linear in beats;
  interpolating against samples instead silently drifts mid-segment).
- The tempo map lives at a top-level, load-order-independent location in
  the document so loaders and importers resolve it before any beat-domain
  position (DAWproject import is forced to be two-pass otherwise).

### Warp and retime

Audio warp markers and video speed ramps are structurally the same object:
a monotonic breakpoint map from an outer timeline domain to a source
domain with a declared interpolation rule. Build it once in the shared
module. Breakpoints are trim-invariant pairs (outer anchor, integer source
position); the existing StaffPad normalized-[0,1] keyframes become a
derived render-time artifact, never storage, because normalized positions
slide under the audio on every trim. Mapping chains (output frame, retime
curve, source ticks) compose as one exact rational map with a single
rounding at the end — rounding to samples mid-chain is amplified by the
retime ratio into the source domain.

### Rounding rules

- One exported helper owns rounding: round-half-away-from-zero, with tie
  and negative behavior stated in its documentation and tests. The repo
  currently has three inconsistent rules (snap-grid
  half-away-from-zero, `Math.round` in paste scaling, `Math.ceil` in
  export scaling); all callers migrate to the helper.
- Absolute-origin discipline: derived boundaries are computed from the
  origin as a function of the object's own anchor
  (`samplePos(n) = round(n * den * sampleRate / num)`); extents are
  `resolve(end) - resolve(start)`, never `start + rounded duration`. This
  applies product-wide, audio and video alike.
- Intra-clip features (envelope points, warp breakpoints, ramp control
  points) round clip-relative and clamp into the clip span — the deliberate
  asymmetry the AUP4 profile already implements and tests.
- At 48 kHz no standard rate produces an exact .5 tie (the fractional
  parts cycle through fifths), so the tie rule is currently unexercised;
  44.1 kHz at 24 fps (1837.5 samples/frame) is the case that exercises it
  and must be in the fixture set.
- Foreign-timeline pairing (VFR PTS against a CFR sequence; A/V stream
  pairs in interchange) uses a per-boundary tolerance derived from the
  coarser of the two rates, following the linked-stereo precedent in AUP4
  conversion — never a global epsilon.

### Numeric safety

- Every composed rate conversion (nested sequence, retime, cross-rate)
  reduces to lowest terms via gcd **before** evaluation, with an explicit
  assertion on the safe domain. Unreduced composition overflows 2^53
  quickly: NTSC nested in NTSC-film with a 1/1000-denominator ramp is
  unsafe after roughly 187 frames.
- Evaluation is integer-numerator-first (`(n * den * sampleRate) / num`);
  the single-hop double path is safe to ~1.87e8 frames and stays the fast
  path. Out-of-bound or composed cases evaluate in BigInt. BigInt is
  banned inside per-sample and per-pixel loops; conversions happen per
  clip boundary or event and are hoisted/cached in render paths. Rulers
  and waveform drawing may use cached double approximations; commit,
  render, export, and snap paths must be exact.

### Types and field hygiene

- Branded numeric types (`SampleFrame`, `VideoFrame`, `SourceTicks`)
  replace the bare `EditorFrame = number` alias at API boundaries so
  samples and frames cannot be swapped silently.
- `EditorVideoSource.frameCount` currently stores a **sample** count and
  `frameRate` is decorative (import hardcodes 30). The schema revision
  renames the field to its true meaning and makes `frameRate` the rational
  sequence-facing rate in the same change; two live meanings of
  "frameCount" must never coexist.

### Rejected alternatives (recorded to prevent re-litigation)

| Alternative | Why rejected |
| --- | --- |
| Milliseconds / decimal ticks | Cannot represent 1/48000 s or 1001/30000 s; fails both accuracy gates by construction. |
| Float seconds | Identity failures (abutment, associativity, keys); determinism gates unverifiable. |
| Adobe-style ticks (254,016,000,000/s) | 2^53 overflows at 9 h 51 m; JSON doubles silently corrupt longer projects. |
| Flicks (1/705,600,000 s) | Numerically fine but forces a full-repo migration and still needs the rational source layer (real container timebases are not flick-exact); may be used internally as an intermediate inside the conversion module only. |
| Per-value rationals (CMTime-style) | Serialization bloat, comparator costs, timescale-proliferation overflow; the useful part (nominal typing) is adopted via branded types. |
| Beats-canonical (tick) timeline | Wrong for mixed media: video-only documents would carry a tempo map to express frame times; every buffer boundary becomes tempo-dependent. Beat authority is provided per-object instead. |

External validation: OTIO stores rate as a double and its maintainers have
had an open request to make it rational since 2017 — treat OTIO as the
cautionary tale, not the model. DAWproject is beats-first with per-element
`timeUnit` opt-out, which is exactly the per-object anchor domain above.
The AUP4 profile already proves "foreign float time at the boundary, exact
integers inside" end-to-end with exact-equality tests and no drift budget.

## Migration (single schema revision)

- Milestone 3 performs **one** schema bump carrying every new document type
  for both tracks. Concurrent or stacked bumps inside the milestone are
  prohibited.
- Audio positions migrate unchanged. Video clip placements are quantized
  onto the chosen sequence frame grid; the migration is deterministic,
  bounded (each start moves less than one frame), and reported through the
  compatibility report rather than applied silently.
- New persisted fields are added to the migration key whitelists in the
  same change; a field missing from the whitelists is silently demoted to
  `opaqueExtensions`, which is treated as a defect class and covered by a
  dedicated test.
- Fixtures follow the compatibility policy: immediate predecessor and
  oldest retained schema, across project state, history, clipboard,
  `.scape`, and both product profiles, plus future-schema read-only.

## Compatibility and registration duties

Every new capability-bearing feature registers, in the same change set:
capability registry, both product profiles, the machine-readable capability
inventory, and the compatibility register (including flipping the existing
planned `video-proxy-fallback` rule when proxies land). An unregistered
feature ID evaluates as unknown and forces projects read-only without
erroring; a milestone-3 feature shipping unregistered is a release-blocking
defect. Policy docs follow the register tooling (narrative sync and
evidence repin) — never hand-edit derived narrative blocks.

## Interchange lookahead (milestone 6 requirements bought cheaply now)

Structural properties the milestone-3 schema records because retrofitting
them is expensive:

- per-element anchor domain (maps 1:1 onto DAWproject `timeUnit` and OTIO
  per-source ranges);
- stable identities for shared/aliased timelines (DAWproject
  `clip/@reference`);
- nestable sequence containers (OTIO Stacks, DAWproject nested Lanes);
- rational sequence rate preserved as project-side data even when an
  exchange format drops it (OTIO has no sequence-rate slot; export carries
  `{num, den}` in a metadata namespace).

Exporter rules recorded for milestone 6: emit OTIO rates as the exact
double quotient (`30000/1001`, never `29.97` — SMPTE and drop-frame
detection use bit-exact equality); pre-round all values in our module
(OTIO rescaling truncates toward zero and never rounds); one timebase per
item, audio at the sample rate, video at the sequence rate; VFR timing
tables ride in metadata. DAWproject export flattens video to seconds and
serializes notes/automation at six decimals, so conformance tests use
tolerance equality there and exact equality elsewhere. AUP4 export
flattens the tempo map to the single global tempo with an explicit
compatibility item, never silently.

## Work packets

Foundation packets are fully decomposed here; 3A/3B items are decomposed
into the same template (outcome, invariants, acceptance, non-goals, stop
condition) by the implementing agent at pickup time, before code.

### WP-0.1 — Shared time module

- **Outcome:** one module owning rational time arithmetic, the rounding
  helper, beat/frame/sample conversions, and the breakpoint-map evaluator.
  Absorbs and deletes the five duplicate seconds/frames helpers (AUP4
  profile and conversion, legacy AUP conversion, control-value adapters,
  Audacity live effects) and the four scalar beat-math sites (snap grid,
  transport model, both recording capture services).
- **Invariants:** exact rational arithmetic; gcd reduction before
  evaluation; documented rounding and tie rules; absolute-origin
  discipline; no BigInt in per-sample/per-pixel loops.
- **Acceptance:** property tests for round-trip identity, tie cases
  (44.1 kHz x 24 fps), overflow assertions at the documented bounds;
  AUP4 exact-equality suite green on the consolidated helpers; the 6/8
  count-in defect (numerator quarter-notes instead of signature-denominator
  beats) fixed and covered.
- **Non-goals:** no schema change; no new commands; no UI.
- **Stop:** if consolidation changes any existing wire value in AUP4
  round-trip fixtures, stop and review rather than adjusting fixtures.

### WP-0.2 — Schema revision

- **Outcome:** one bump introducing sequences, frame-anchored video
  placement, source-domain in/out with VFR timing tables, the tempo and
  signature map, per-object anchors, warp/retime breakpoint maps, branded
  types, and the video source field renames; migration with deterministic
  video-grid quantization and compatibility reporting.
- **Invariants:** anchor-domain table above; derived fields rejected on
  mismatch; whitelist coverage test; validators enforce frame-grid video
  starts and monotonic breakpoint maps.
- **Acceptance:** compatibility-policy fixture matrix; future-schema
  read-only route; migration determinism test (migrate twice, byte-equal);
  desktop library schema pin and portable-archive version checks updated
  together.
- **Non-goals:** no feature UI; no engine changes beyond what validation
  requires; no MIDI-shaped schema (fenced through milestone 7).
- **Stop:** any second schema bump proposal inside milestone 3.

### WP-0.3 — Capability and policy registration

- **Outcome:** every milestone-3 capability registered across registry,
  product profiles, capability inventory, and compatibility register, with
  read-only-on-unknown behavior demonstrated for each on older builds.
- **Acceptance:** registry/profile equality tests; a test proving a
  deliberately unregistered fixture feature degrades to reported read-only
  (the guard against silent shipping).
- **Stop:** any register edit that requires weakening an existing pinned
  narrative or evidence pairing.

### WP-0.4 — Parallel-work headroom

- **Outcome:** application menu registry and the feature-requirement
  module split below the size ceiling with headroom for both tracks;
  ratchet entries updated in the same commits.
- **Non-goals:** no behavior change; pure extraction.

### 3A packets (Soundscaper track, parallel after 3.0)

Tempo map editing and transport/metronome integration; markers and named
regions with batch identity and ripple; nested track folders; take lanes,
cycle recording, comping, and interrupted-take recovery; transient
analysis, warp markers, beat-aware stretch, quantization, and groove (all
via the shared breakpoint model with exact offline fallback); punch and
count-in plus the approved Audacity gaps.

### 3B packets (Framescaper track, parallel after 3.0)

Sequence surfaces (rational rates, drop/non-drop SMPTE display, source
timecode, frame stepping and snapping); probed exact source timing at
ingest (replacing the hardcoded 30 fps import path); source/program
monitors and three-point editing; trim tools with keyboard-complete
feedback; retiming and speed ramps via the shared breakpoint model;
nested sequences and subsequence time mapping; proxy attachment and
offline/relink; multicamera groups (sub-frame sync offsets are why the
timeline stays sample-canonical).

## Two-agent coordination rules

- Phase 3.0 is one work stream. Its outputs are reviewed before 3A/3B
  open.
- Spine files stay serialized after 3.0: the command protocol and domain
  registries, migration and validators, the compatibility register and its
  documents, the i18n catalog, application menus, and the maintainability
  allowlist. Convention: rebase before push; a spine edit and its ratchet
  or count updates land in the same commit; the second agent rebases
  rather than resolving spine conflicts by hand.
- Leaf ownership is product-disjoint: the Audacity/Nyquist/StaffPad/AUP4
  stack and recording services belong to 3A; the video domain, controller,
  storage, preview, and desktop locator modules belong to 3B.
- Repo-wide gates (coverage thresholds, lint suppression counts, chunk
  budgets) mean one agent's red main stalls both; keep the canonical check
  green on every push.

## Known defects this plan absorbs

- Count-in computes numerator quarter-notes regardless of the signature
  denominator (6/8 yields a double-length lead-in) — fixed in WP-0.1.
- `EditorVideoSource.frameCount` stores samples under a frame name;
  import hardcodes 30 fps — renamed/replaced in WP-0.2.
- Snap arithmetic multiplies a float step instead of using the
  integer-numerator form — rewritten in WP-0.1.
- Five duplicate seconds/frames converters with divergent clamping —
  consolidated in WP-0.1.

## Watch items (not gates yet)

- Undo history stores full project snapshots (limit 200); milestone-3
  document types grow snapshot size. Measure long-session memory against
  the milestone-1 budgets once 3.0 fixtures exist; promote to a gate only
  on evidence.
- WebKit qualification for new editorial workflows inherits the
  milestone-2 durability caveat; do not claim cross-engine coverage the
  matrix does not show.

## Non-goals and fences

- No MIDI schema, ports, flags, or UI in any tempo/metronome work
  (deferred-capability fence through milestone 7).
- No Framescaper recording surfaces (milestone 8A).
- No DAWproject/OTIO/FCPXML exporters in milestone 3; the schema only
  records what milestone 6 needs.
- Tempo ramps (non-hold segments) are out of scope for milestone 3.
