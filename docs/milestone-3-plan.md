# Milestone 3 plan: parallel editorial foundations

> Owning source for milestone-3 sequencing, the shared time-model decision,
> its invariants, and the bounded work packets. The
> [roadmap](../roadmap.md#3-parallel-editorial-foundations) owns scope and
> status; the compatibility and security policies own their claims. Grounded
> against the repository, OpenTimelineIO, DAWproject, and the AUP4
> interchange on 2026-08-09; revised twice the same day after external
> review rounds with code-level verification of their findings.

## Goals and ordering principle

1. **Primary: users must not hit trouble.** No cumulative A/V drift, no
   video cuts off the frame grid, no meter changes drifting off barlines, no
   silent read-only degradation from unregistered features, no silent loss
   of undeclared document state, no non-deterministic save/reopen.
2. **Secondary: implementation stays smooth for concurrent agents.** The
   serialized foundation phase removes the files both product tracks would
   otherwise fight over; parallel work starts only where ownership is
   file-disjoint.

Work is ordered by user-facing risk, not by delivery speed. The most
irreversible decisions (schema, time model) land first, once, under review,
before any dependent feature work begins — and the schema switch itself is
prepared by schema-neutral packets so the final change is small and atomic.

## Pre-release schema policy

Decided by the user on 2026-08-09: the product has no external users, so
**retained schema migrations are removed until the first shipped release**.

- Schema changes before release are clean breaks: bump the version, write
  no migration. Existing development projects are re-imported from source
  media — which is strictly better for video, because re-import probes real
  source timing instead of conforming documents that carry a fabricated
  30 fps rate.
- **Kept:** the `schemaVersion` field, future-schema read-only handling,
  exact-current-version validators, and the `.scape` exact-byte-copy path.
  These protect cross-build and cross-product project exchange during
  development. Opening an older-schema document fails with a typed
  "re-import required" error, never a crash or a silent partial load.
- **Removed:** the retained v1→v9 migration chain and router as a
  saved-project compatibility surface, the dead `load`/`validate` halves of
  the legacy version modules, and the retained-migration fixture matrix.
  The v2–v8 modules themselves remain: they are the factory implementation
  (the current factories alias down to them) and have many non-migration
  importers.
- **Audacity import dependency (must be resolved inside WP-0.0):** the AUP
  and AUP4 converters deliberately build **schema-v2** projects
  (`createAudioEditorProjectV2` in both converters) and the import services
  then upcast them through the migration router. Deleting the chain
  naively breaks Audacity import, which is a maintained interchange
  feature, not a legacy-document concern. WP-0.0 therefore either rewrites
  both converters to assemble current-schema documents directly (the
  factories already alias to the same implementations, so this is largely
  re-pointing assembly and defaulting newer fields), or retains a clearly
  internal composed upcast adapter used only by the importers and never
  advertised as saved-project compatibility. AUP, legacy-XML AUP, and AUP4
  import acceptance is part of WP-0.0's gate.
- **Policy consequence:** the compatibility register's `projectSchema`
  block, the `legacy-schema-migration` rule, the retirement conditions,
  the two rule narratives asserting "V1–V8 remain maintained", the derived
  compatibility document, and the tests that pin them all change together
  as a deliberate versioned policy edit (WP-0.0). Roadmap §2's deferred
  note about retained raw-schema migrations and §9's retained-migration
  qualification line are updated when that packet lands.
- From the first shipped release onward, the retained-migration policy is
  reinstated for released schema versions.

This dissolves two constraints an earlier draft imposed: there is no
"single milestone-3 schema bump" mandate, and no legacy-video quantization
migration. Schema revisions remain **serialized** — at most one in flight,
owned by one agent — but bounded follow-up revisions per track are now
cheap and permitted.

## Phase structure

| Phase | Mode | Content |
| --- | --- | --- |
| 3.0 | Serialized (one work stream) | Schema policy enactment, shared time module, runtime projection, timing-asset contract, atomic foundation schema switch, registration framework, headroom refactors |
| 3A | Parallel track | Soundscaper editorial features over the foundation |
| 3B | Parallel track | Framescaper editorial features over the foundation |

3A and 3B must not begin until every 3.0 acceptance check passes. Within
3A/3B, agents follow the coordination rules below.

### Current implementation checkpoint

The Framescaper track now selects its exact V18 product boundary. Nested
sequences and multicamera groups are registered, menu-reachable, persisted, and
materialized through maintained playback and delivery. Proxy attachments and
their exact bodies have claim-bound preservation across local storage,
format-2 Scape, retention, and desktop V10, while re-attestation remains an
isolated preview-only primitive with no maintained consumer. Proxy generation,
attach/detach lifecycle, offline handling, and relink remain unavailable.
Retiming remains hard-stopped at exact executor feasibility. These implemented
slices do not close milestone 3: the four packaged Electron timing rows remain
`pending-external`, the fixed GPU host remains unprovisioned, the long-form
fixture/workload remains provisional, and milestone 2's Electron lease matrix
is still partial.

## Time-model decision

### Canonical coordinate

The canonical timeline coordinate remains **integer sample frames at the
document's `project.sampleRate`**. This is per-document: new projects
default to 48 kHz, and legacy Audacity import carries the source project's
rate, so 44.1 kHz and 96 kHz documents are reachable. The foundation
revision bounds `project.sampleRate` to a sane audio range (following the
AUP4 boundary validator's 1..768,000 precedent, with a non-degenerate
lower bound) — an unbounded rate permits documents where many frame
boundaries collapse onto one sample.

Milliseconds, microseconds, and float seconds are rejected as timebases.
One 48 kHz sample is 1/48 ms and one NTSC frame is 1001/30000 s; neither
terminates in any decimal subdivision of the second, so fixed decimal ticks
cannot satisfy the sample-accuracy or frame-accuracy exit gates. Float
seconds are rejected on **identity**, not precision: gapless abutment needs
bit-identical boundary equality, ripple edits need associativity, and
positions serve as map and sort keys. (Do not argue "floats lose precision"
in reviews — at three hours the representable error is ~1e-7 samples; the
identity argument is the correct and sufficient one.)

### Authoritative coordinates

Authority is assigned **per coordinate, not per object**: a clip carries
several time coordinates (timeline placement, extent, source in/out), and
each has exactly one authoritative domain. All other representations are
derived at runtime; **derived sample caches are never persisted** — a
persisted cache would make every tempo edit rewrite large parts of the
document, and validators would have to police staleness. Where a persisted
derived field is unavoidable, validators **reject** mismatches; they never
silently repair them.

| Coordinate | Authoritative domain |
| --- | --- |
| Audio clip placement/extent (absolute) | integer timeline samples |
| Audio clip placement (musical), markers/regions with musical anchor | exact rational beats; samples derived through the tempo map |
| Video clip placement and extent | integer frame index/count at the sequence's rational rate |
| Video clip source in/out | integer source-frame index in the source's own timebase |
| Tempo event | exact rational beat position; in a `sampleLocked` map, authority flips to the sample position per event |
| Signature event | integer bar index |
| Warp/retime breakpoint | (outer-domain anchor, source-domain position) pair |

Notes:

- Sequences are first-class: `{ rate: {num, den}, dropFrame,
  startTimecode }`. The rational rate table currently lives only in snap
  grids, which is a UI concern, not a document model. A video source's
  `frameRate` remains **source metadata** describing the probed media; one
  source can appear in differently rated sequences, so the sequence rate
  is never stored on the source.
- Audio clips and markers carry `anchor: 'sample' | 'musical'` from the
  foundation revision. A musically anchored clip additionally declares its
  **extent semantics**: beat-anchored start with either a fixed sample
  extent or a tempo-following beat extent. That choice is a foundation
  wire contract closed in WP-0.4 design, not an afterthought.
- Tempo maps fitted to recorded performance set `sampleLocked`, flipping
  event authority to samples for that map; sample-locked is the exception,
  not the default semantic.
- Nested sequences define cycle rejection (a sequence may not contain
  itself transitively), a maximum nesting depth, and explicit
  mutation/aliasing semantics for shared subsequences before any container
  ships.

### Runtime projection shields consumers

Persisted coordinate domains are not read directly by playback, preview,
composition, export, navigation, transitions, or waveform code. A single
**resolved runtime projection** — produced by the shared time module —
maps every clip to resolved absolute sample boundaries (and, for video,
resolved frame indices). Consumers are migrated onto the projection while
the schema is still v9 (WP-0.2), so the later schema switch changes the
resolver, not dozens of consumers. Today those consumers interpret the
persisted fields as samples directly; changing the persisted domain
without this layer would break playback, source mapping, and export in the
same commit as the schema — an unreviewably large atomic change.

### Edit deltas and mixed-domain operations

Per-clip delta quantization is not associative (at 30000/1001 in a 48 kHz
document, two 800-sample ripples each round to zero frames while one
1600-sample ripple rounds to one), so quantization happens at the
**operation** level. But a single raw sample delta cannot be applied to
everything either: frame boundaries are not equidistant in samples
wherever `sampleRate * den / num` is fractional. At 44.1 kHz and 24 fps
the boundaries resolve to samples 0, 1838, 3675 — a one-frame clip's
resolved extent is 1838 samples at frame 0 and 1837 at frame 1, so moving
it cannot preserve both a fixed audio sample duration and exact frame
alignment. The rules are therefore:

- An operation that affects any video track computes its delta once and
  conforms it to a whole number of sequence frames. Video coordinates
  update **in frame space**.
- A/V links model a **shared presentation anchor**, not stored coordinate
  equality. Linked audio boundaries are recomputed from the video clip's
  resolved absolute endpoints after the move; the audio extent may
  breathe by ±1 sample at fractional rates, which is inaudible and keeps
  the pair exactly frame-aligned. The current validator invariant
  (bit-identical stored ranges on linked clips) is replaced by derived
  equality: linked audio ranges must equal the video clip's resolved
  range.
- Unlinked audio clips in a mixed operation shift by the operation's
  resolved sample delta (the difference of resolved absolute positions,
  not an accumulated per-clip value).
- Audio-only operations on audio-only track sets keep sample resolution.
- Slip operates in the **source** domain (source frames/PTS), not the
  sequence frame grid.
- The foundation phase produces an **edit-primitive × coordinate-domain
  matrix** (move, ripple, roll, slip, slide, split, paste, duplicate,
  range delete × placement/extent/source-in-out per track kind) stating,
  for every cell, the domain the delta is computed in and the conforming
  rule applied. Command implementations cite their cell; the matrix is the
  acceptance artifact for review.
- Validators reject video placements off the frame grid only once every
  edit primitive routes through the conformed-delta path; the validator
  and the command migrations land in the same revision, never separately.

### Tempo map semantics

- Signature events anchor at integer bars; tempo events anchor at exact
  rational beats. Sample positions of events are derived at runtime by a
  single rounding of the exact rational sum of prior segments from the
  origin, never accumulated segment-by-segment and never persisted.
- Tempo values are stored as bounded rationals, not free doubles. Exact
  arithmetic over IEEE doubles produces unbounded denominators and
  non-canonical equal-looking tempos. The concrete representation
  (`{num, den}` vs integer micro-BPM), canonical reduction rule,
  denominator bound, and equality semantics are closed as a WP-0.4 design
  decision before the schema lands — they are open only until then.
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

Audio warp markers and video retime share one breakpoint-map structure —
an ordered list of (outer anchor, source position) pairs with per-segment
modes — and one evaluator in the shared module, but validity rules differ
per feature:

- **Audio warp:** strictly increasing in both domains (no freeze, no
  reverse of audio content through warp).
- **Video retime, foundation scope:** position-pair segments express
  piecewise-constant speed, freeze (flat), and reverse (decreasing), with
  direction changes as explicit per-segment modes, never inferred from
  coordinates.
- **True speed ramps are deferred to the 3B follow-up revision.** A linear
  speed ramp integrates to a quadratic position curve and needs
  interpolation parameters, continuity rules, inversion semantics, and
  zero-crossing behavior — an underspecified "shared" curve frozen now
  would be the kind of premature contract this plan exists to avoid, and
  follow-up revisions are cheap under the pre-release policy.

Breakpoints are trim-invariant; the existing StaffPad normalized-[0,1]
keyframes become a derived render-time artifact, never storage, because
normalized positions slide under the audio on every trim. Mapping chains
(output frame, retime curve, source ticks) compose as one exact rational
map with a single rounding at the end — rounding to samples mid-chain is
amplified by the retime ratio into the source domain.

### Rounding policies

One shared core owns exact rational division; callers select a **named
semantic policy** rather than a single universal rule:

- `point` — nearest, half away from zero, for instants (clip anchors,
  markers, snapped positions). Tie and negative behavior are stated in the
  helper's documentation and tests.
- `enclosingStart` / `enclosingEnd` — floor / ceil, for ranges that must
  cover their content (export buffer sizing legitimately uses ceil on
  durations today; that semantic is kept, not "fixed").
- `directional` — floor or ceil expressing user intent (snap to
  previous/next grid line), as the snap grid already does.

Every **timeline/timebase conversion site** in `src/common/editor/`
migrates to the module and declares its policy — the audit scope is time
conversions, not every arithmetic rounding in the tree (pixel, FFT, byte,
and PCM-quantization math is out of scope). The audit classifies each
existing site as point vs enclosing; at least five distinct behaviors
exist today, including a length rounded with `Math.round` beside a point
rounded the same way — each gets an explicit, reviewed policy.

Additional rules:

- Absolute-origin discipline: derived boundaries are computed from the
  origin as a function of the coordinate's own anchor
  (`samplePos(n) = round(n * den * sampleRate / num)`); extents are
  `resolve(end) - resolve(start)`, never `start + rounded duration`.
- Intra-clip features (envelope points, warp breakpoints, ramp control
  points) round clip-relative and clamp into the clip span — the
  deliberate asymmetry the AUP4 profile already implements and tests.
- At 48 kHz no standard rate produces an exact .5 tie (the fractional
  parts cycle through fifths); 44.1 kHz at 24 fps (1837.5 samples/frame)
  is the case that exercises the tie rule and must be in the fixture set.
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

### Bulk timing data lives outside the document

A per-frame VFR timing index is bulk data: one hour at 30 fps is 108,000
entries, and the document model hard-rejects that scale twice over — the
`.scape` encoder and the v9 validation budget each count every scalar
against a 100,000-node ceiling. Commands also deep-clone the whole
document per edit, and undo history retains up to its 200-entry limit of
historical snapshots plus the present document, each an independent deep
copy.

VFR (and any comparable bulk timing) data is therefore an **immutable,
digest-bound asset** referenced from the video source, with a fully
specified wire contract (WP-0.3): canonical encoding and timestamp
timescale, the final-frame duration rule, byte and frame-count ceilings,
missing/corrupt-asset behavior, atomic publication, and exact binding to
the source content digest. Its storage, retention, reclamation fencing,
`.scape` packaging, and desktop handoff behavior follow the same lifecycle
discipline as other derived/retained media. The document stores the
reference and summary metadata (nominal rate, frame count, digest), never
the table.

### Types and field hygiene

- Branded numeric types (`SampleFrame`, `VideoFrame`, `SourceTicks`)
  replace the bare `EditorFrame = number` alias at API boundaries so
  samples and frames cannot be swapped silently.
- `EditorVideoSource.frameCount` currently stores a **sample** count and
  `frameRate` is decorative (import hardcodes 30). The foundation
  revision renames the field to its true meaning; `frameRate` becomes the
  probed rational source rate — source metadata only, distinct from any
  sequence rate.
- **Silent-drop protection targets the factories and normalizers, not
  migration whitelists.** Loading a current-version document rebuilds
  every clip through the version-factory chain down to an explicit key
  literal, and clip add, split/trim, and clipboard paste re-normalize
  through the same factories — an unlisted new field survives clone and
  in-memory edits but is silently dropped on the next load or normalize.
  Every new persisted field is added to the owning `create*`/normalize
  functions in the same change, verified by two tests: **serialization
  idempotence** (load → save with no edits is byte-identical) and
  **semantic survival** (load → edit → save → load preserves the new
  field's value; revision counters and timestamps are excepted, since an
  edit legitimately changes them).

### Rejected alternatives (recorded to prevent re-litigation)

| Alternative | Why rejected |
| --- | --- |
| Milliseconds / decimal ticks | Cannot represent 1/48000 s or 1001/30000 s; fails both accuracy gates by construction. |
| Float seconds | Identity failures (abutment, associativity, keys); determinism gates unverifiable. |
| Adobe-style ticks (254,016,000,000/s) | 2^53 overflows at 9 h 51 m; JSON doubles silently corrupt longer projects. |
| Flicks (1/705,600,000 s) | Numerically fine but forces a full-repo migration and still needs the rational source layer (real container timebases are not flick-exact); may be used internally as an intermediate inside the conversion module only. |
| Per-value rationals (CMTime-style) | Serialization bloat, comparator costs, timescale-proliferation overflow; the useful part (nominal typing) is adopted via branded types. |
| Beats-canonical (tick) timeline | Wrong for mixed media: video-only documents would carry a tempo map to express frame times; every buffer boundary becomes tempo-dependent. Beat authority is provided per-coordinate instead. |

External validation: OTIO stores rate as a double and its maintainers have
had an open request to make it rational since 2017 — treat OTIO as the
cautionary tale, not the model. DAWproject is beats-first with per-element
`timeUnit` opt-out, which is exactly the per-coordinate anchor domain
above. The AUP4 profile already proves "foreign float time at the
boundary, exact integers inside" end-to-end with exact-equality tests and
no drift budget.

## Schema revisions

- Schema revisions are **serialized**: at most one in flight, owned by one
  agent, landed atomically with its validators, command migrations, and
  fixtures. Under the pre-release schema policy they are otherwise cheap —
  no migration is written.
- The **foundation revision** (WP-0.4) establishes the time-model core:
  sequences, frame-anchored video placement, source-domain in/out with the
  external timing-asset reference, the tempo and signature map,
  per-coordinate anchors, foundation-scope breakpoint maps, branded types,
  and the video source field renames. Product-track document types whose
  contracts are not yet designed (take lanes, comping, folders, proxies,
  multicam grouping, nested-sequence containers, persisted ramp curves)
  land in bounded follow-up revisions decomposed at pickup time — designed
  then, not frozen now.
- **Foundation wire contracts closed in WP-0.4 design, before the
  switch:** canonical rational-rate bounds and the legal
  drop-frame/rate combinations for sequences; the `startTimecode`
  representation; `project.sampleRate` bounds; musical clip extent
  semantics (fixed-sample vs beat extent); the tempo-value representation
  (canonical form, denominator bound, equality semantics); and the
  timing-asset reference shape from WP-0.3.
- Every revision derives its version checks from the shared constant. The
  foundation revision replaces today's hardcoded exact-9 sites — the
  command gate's literal version array, the compatibility service's
  version test, feature-requirement retention, and `.scape`
  feature-requirement remapping — with constant-derived checks, so each
  later bump is a one-constant change. (Left hardcoded, a naive bump would
  silently skip compatibility evaluation and fallback-asset retention for
  new documents — the latter is data-loss-shaped.)
- Fixtures per revision: current-version validation, future-schema
  read-only, older-schema typed rejection, clone/undo/clipboard/`.scape`
  round trips, and the idempotence/survival test pair above.

## Compatibility and registration duties

Every new capability-bearing feature registers, in the same change set:
capability registry, both product profiles, the machine-readable capability
inventory, and the compatibility register (including flipping the existing
planned `video-proxy-fallback` rule when proxies land). An unregistered
feature ID evaluates as unknown and forces projects read-only without
erroring; a milestone-3 feature shipping unregistered is a release-blocking
defect.

Registration alone is not enough: today only two of twenty capability IDs
auto-author project feature requirements, and nothing checks that project
state implies a manifest entry. Phase 3.0 provides the
**state-to-manifest completeness framework** plus predicates and fixtures
for the foundation document types. Each later feature then lands
atomically at pickup: its capability ID; profile entries (initially
unavailable, flipped only when implemented); its state predicate and
manifest requirement; and same-schema cross-product fixtures.

Two distinct degradation paths are tested separately, because clean
schema bumps change which one fires: **future-schema handling** (an older
build sees a newer version and goes read-only before any manifest
evaluation) and **same-schema capability handling** (a build on the same
version encounters a known-but-unavailable or unknown capability ID and
degrades per the compatibility rules). "Open it in an older build" is
only a test of the first path. Policy docs follow the register tooling
(narrative sync and evidence repin) — never hand-edit derived narrative
blocks.

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
double quotient (`30000/1001` computed in floating point, never a `29.97`
literal). Upstream's `to_timecode()` charitably snaps rates within 0.1 of
a SMPTE rate before drop-frame inference, but `is_smpte_timecode_rate()`
and other consumers compare bit-exactly, so exact quotients are the only
representation safe across all consumers. Pre-round all values in our
module: OTIO's `rescaled_to()` preserves fractional doubles unrounded,
and its frame/timecode consumers then truncate toward zero — so fractional
values silently lose a frame downstream. One timebase per item, audio at
the sample rate, video at the sequence rate; VFR timing tables ride in
metadata. For DAWproject, video flattens to seconds, and note/automation
positions in ecosystem files carry six-decimal precision (the reference
implementation's marshaling — the XSD itself mandates no precision), so
our exporter writes full precision while conformance tests use tolerance
equality for notes/automation and exact equality elsewhere. AUP4 export
flattens the tempo map to the single global tempo with an explicit
compatibility item, never silently.

## Work packets

Foundation packets are fully decomposed here; 3A/3B items are decomposed
into the same template (outcome, invariants, acceptance, non-goals, stop
condition) by the implementing agent at pickup time, before code.
WP-0.1..0.3 are deliberately **schema-neutral** so the schema switch in
WP-0.4 is small and atomic.

### WP-0.0 — Pre-release schema policy enactment

- **Outcome:** the policy above is reflected in the compatibility register
  and derived document (projectSchema block, retirement conditions, the
  `legacy-schema-migration` rule, and the "V1–V8 remain maintained"
  narratives), their pinning tests, the security-evidence pins, and the
  two roadmap lines that promise retained migrations; the v1→v9 migration
  chain, its dead legacy loaders/validators, and their assertions are
  deleted; older-schema opens fail with the typed re-import error; and
  Audacity import is re-based per the dependency note above (converters
  emit current-schema documents, or a clearly internal upcast adapter
  remains).
- **Invariants:** future-schema read-only, the `.scape` byte-copy path,
  and the v2–v8 factory implementations are untouched; AUP, legacy-XML
  AUP, and AUP4 **interchange remains fully functional** — it is a
  feature, not a schema migration.
- **Acceptance:** full canonical gate green; AUP/AUP4 import fixtures
  pass; a fixture proves an older-schema document produces the typed
  error and a newer-schema document still opens read-only.
- **Stop:** if any milestone-2 closure evidence would have to change,
  stop — the closure inventory cites no migration evidence, so a conflict
  means a mistaken deletion.

### WP-0.1 — Shared time module

- **Outcome:** one module owning rational time arithmetic, the named
  rounding policies, beat/frame/sample conversions, and the breakpoint-map
  evaluator with per-feature validity rules. Absorbs and deletes the five
  duplicate seconds/frames helpers (AUP4 profile and conversion, legacy
  AUP conversion, control-value adapters, Audacity live effects) and the
  four scalar beat-math sites (snap grid, transport model, both recording
  capture services), classifying every migrated timeline/timebase call
  site into a named policy.
- **Invariants:** exact rational arithmetic; gcd reduction before
  evaluation; documented tie and negative behavior; absolute-origin
  discipline; enclosing-range semantics preserved where they are
  intentional (export sizing); no BigInt in per-sample/per-pixel loops.
- **Acceptance:** property tests for round-trip identity, tie cases
  (44.1 kHz x 24 fps), overflow assertions at the documented bounds;
  AUP4 exact-equality suite green on the consolidated helpers; the 6/8
  count-in defect (numerator quarter-notes instead of signature-denominator
  beats) fixed and covered.
- **Non-goals:** no schema change; no new commands; no UI.
- **Stop:** if consolidation changes any existing wire value in AUP4
  round-trip fixtures, stop and review rather than adjusting fixtures.

### WP-0.2 — Runtime clip projection (schema-neutral)

- **Outcome:** the resolved runtime projection described above, produced
  by the shared time module, adopted by playback, preview, composition,
  export, navigation, transition, and waveform consumers while the schema
  is still v9 (where persisted and resolved domains coincide, so adoption
  is behavior-preserving and independently verifiable).
- **Acceptance:** the video pipeline and editing suites pass unchanged on
  the projection; a coverage check shows no remaining direct reads of
  persisted clip time fields from the shielded consumer set.
- **Non-goals:** no schema change; no persisted-field semantics change.
- **Stop:** any consumer that cannot be expressed against the projection
  without new persisted state — surface it as a design gap before the
  schema switch, not after.

### WP-0.3 — Timing-asset contract and probing feasibility (schema-neutral)

- **Outcome:** the timing-asset wire contract (canonical encoding,
  timestamp timescale, final-frame duration rule, byte/frame ceilings,
  missing/corrupt behavior, atomic publication, digest binding to source
  content) with its storage, retention, `.scape` packaging, and desktop
  handoff behavior implemented and tested; plus a probing feasibility
  spike proving supported runtimes can actually extract rational rates
  and per-frame timing (and defining the recorded fallback when probing
  is unavailable, e.g. conform-to-CFR-at-ingest with the decision stored
  on the source).
- **Acceptance:** asset lifecycle tests (publish, reference, reclaim
  fencing, handoff, corrupt-asset degradation); probe results on the
  supported-browser and Electron matrix for representative CFR and VFR
  fixtures.
- **Non-goals:** no document-schema reference yet; the asset store and
  codec stand alone until WP-0.4 wires the reference.

### WP-0.4 — Foundation schema switch (atomic)

- **Outcome:** the foundation revision scoped in "Schema revisions",
  landed atomically with the conformed-delta command migrations (move,
  ripple, roll, slip, slide, split, paste, duplicate, range delete,
  clipboard, source mapping), the derived-equality A/V link validator,
  constant-derived version checks at the four hardcoded sites, and the
  probed-import path replacing the fabricated 30 fps source metadata for
  newly imported media. All foundation wire contracts listed above are
  closed in this packet's design step before implementation.
- **Invariants:** authoritative-coordinate table; runtime projection is
  the only consumer-facing time surface; factory/normalizer coverage for
  every new field with the idempotence/survival test pair; validators
  enforce frame-grid video placement and per-feature breakpoint validity —
  landing in the same revision as the command migrations, never before
  them.
- **Acceptance:** the edit-primitive × coordinate-domain matrix reviewed
  and cited by each command implementation; the revision fixture set;
  desktop library schema pin and portable-archive version checks updated
  together; a measured snapshot-history memory budget for the new document
  types against the milestone-1 long-session budgets (a 3.0 acceptance
  check, not a deferred watch item, because long-form memory is a
  milestone-3 exit gate).
- **Non-goals:** no feature UI; no persisted ramp curves (3B revision);
  no MIDI-shaped schema (fenced through milestone 7).
- **Stop:** a second schema revision proposal while this one is in
  flight; any frame-grid validator landing ahead of its command
  migrations; any consumer found reading persisted time fields directly.

### WP-0.5 — Registration framework and foundation predicates

- **Outcome:** the state-to-manifest completeness framework with
  owned-requirement predicates and fixtures for the **foundation**
  document types; the atomic per-feature registration pattern documented
  for 3A/3B pickup (capability ID + initially-unavailable profile entries
  + predicate + same-schema fixtures in one change).
- **Acceptance:** registry/profile equality tests; the completeness test
  over foundation types; separate tests for future-schema handling and
  same-schema unknown/unavailable capability handling; a test proving a
  deliberately unregistered fixture feature degrades to reported
  read-only.
- **Stop:** any register edit that requires weakening an existing pinned
  narrative or evidence pairing.

### WP-0.6 — Parallel-work headroom

- **Outcome:** application menu registry and the feature-requirement
  module split below the size ceiling with headroom for both tracks;
  ratchet entries updated in the same commits.
- **Non-goals:** no behavior change; pure extraction.

### 3A packets (Soundscaper track, parallel after 3.0)

The pickup decomposition and execution contract is maintained in
[`docs/milestone-3a-work-packets.md`](milestone-3a-work-packets.md).

Tempo map editing and transport/metronome integration; markers and named
regions with batch identity and ripple; nested track folders; take lanes,
cycle recording, comping, and interrupted-take recovery; transient
analysis, warp markers, beat-aware stretch, quantization, and groove (all
via the shared breakpoint model with exact offline fallback); punch and
count-in plus the approved Audacity gaps. Document types among these land
as bounded, serialized follow-up schema revisions designed at pickup, each
with its atomic capability registration.

### 3B packets (Framescaper track, parallel after 3.0)

The pickup decomposition and execution contract is maintained in
[`docs/milestone-3b-work-packets.md`](milestone-3b-work-packets.md).

Sequence surfaces (rational rates, drop/non-drop SMPTE display, source
timecode, frame stepping and snapping); probed exact source timing at
ingest; source/program monitors and three-point editing; trim tools with
keyboard-complete feedback; retiming and speed ramps (the persisted ramp
curve revision lands here, over the foundation breakpoint model); nested
sequences and subsequence time mapping; proxy attachment and
offline/relink; multicamera groups (sub-frame sync offsets are why the
timeline stays sample-canonical). Document types among these land as
bounded, serialized follow-up schema revisions designed at pickup, each
with its atomic capability registration.

## Two-agent coordination rules

- Phase 3.0 is one work stream. Its outputs are reviewed before 3A/3B
  open.
- Schema revisions are serialized product-wide: one in flight, one owner,
  landed atomically with validators, command migrations, and fixtures.
- Spine files stay serialized after 3.0: the command protocol and domain
  registries, validators, the compatibility register and its documents,
  the i18n catalog, application menus, and the maintainability allowlist.
  Convention: rebase before push; a spine edit and its ratchet or count
  updates land in the same commit; the second agent rebases rather than
  resolving spine conflicts by hand.
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
  import hardcodes 30 fps — renamed/replaced in WP-0.4.
- Snap arithmetic multiplies a float step instead of using the
  integer-numerator form — rewritten in WP-0.1.
- Five duplicate seconds/frames converters with divergent clamping —
  consolidated in WP-0.1.
- Exact-version checks hardcoded as literals (command gate, compatibility
  service, retention, `.scape` remap) — made constant-derived in WP-0.4.

## Watch items (not gates yet)

- WebKit qualification for new editorial workflows inherits the
  milestone-2 durability caveat; do not claim cross-engine coverage the
  matrix does not show.

## Non-goals and fences

- No MIDI schema, ports, flags, or UI in any tempo/metronome work
  (deferred-capability fence through milestone 7).
- No Framescaper recording surfaces (milestone 8A).
- No DAWproject/OTIO/FCPXML exporters in milestone 3; the schema only
  records what milestone 6 needs.
- Tempo ramps (non-hold segments) and persisted video speed-ramp curves
  are out of scope for the foundation revision.
