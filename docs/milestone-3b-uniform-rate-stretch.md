# Milestone 3B-4b7: frame-canonical uniform rate-stretch

> **Historical slice record:** implementation details remain useful provenance;
> any qualification, human sign-off, evidence-admission, or milestone-9 release
> language below is superseded by ordinary CI and optional owner QA.

> **Implemented:** delivered through commit `2bbfa06b` on 2026-08-11, after
> [3B-4b6 — frame-canonical slip and slide](milestone-3b-slip-slide.md).
> It adds constant-rate video-bearing stretch through one pure planning
> authority, one atomic transform command, the existing Clip boundaries menu,
> and the existing video stretch handles. It does not add retiming curves or
> complete packet 3B-4; the immediate pickup is the narrow canonical
> clip-focus keyboard adapter/status-parity slice.

## Foundation already present

- Current V15 video clips persist canonical `sequenceStartFrame`,
  `sequenceFrameCount`, `sourceInFrame`, and `sourceFrameCount`; sample-domain
  placement and source aliases are command/runtime projections only.
- Playback and export already derive a video clip's constant rate from its
  fixed source-time range divided by its program duration. Audio scheduling
  likewise derives varispeed from fixed source frames over program samples.
- `clip/transform-many` and its optional canonical `sequencePlacement` carry a
  multi-clip edit through one operation-level conform and one undo entry.
- The strict trim planners already own branded command projection, stable
  selection/group/A-V closure, exact A/V cardinality, live V15 lock predicates,
  video-track composition validation, and verified CFR/VFR timing views.
- Framescaper's video filmstrip already renders left/right stretch handles, but
  they currently call the legacy `clip.stretch` action. That action is
  `audioEffects`-gated, sample-authoritative, and intentionally remains the
  Soundscaper audio-only path; Framescaper cannot reuse it.

## Outcome boundary

Deliver uniform, constant-rate stretch for a video-bearing relation set:

1. a pure planner owns absolute-edge conformance, one exact rational duration
   scale, common clamping, source preservation, and complete previews;
2. one controller service replans from live project/timing/lock state and
   commits exactly one `clip/transform-many`;
3. two lazy Framescaper Clip boundaries actions and the existing video stretch
   handles use the same planner authority;
4. localized feedback states the applied edge, effective rate, clamp/no-op,
   and exact program timecode; and
5. the video speed badge reports the derived source/program rate rather than
   the legacy persisted `speedRatio` compatibility field.

## Contract 1: strict inputs and authority

- The public seam is
  `planFrameCanonicalRateStretch(project, timingViews, request)` where project
  is the branded V15 command projection, timing views are verified synchronous
  source views, and request is the frozen shape
  `{ activeClipId, edge, requestedBoundarySample, isTrackLocked? }`.
- `edge` is `left` or `right`; `requestedBoundarySample` is the absolute edge
  under the playhead or current pointer, never an accumulated UI delta.
- The active clip must be video, or audio with exactly one participating video
  companion under the same valid A/V link. That video is the authority.
- Active unlinked audio refuses even when group or selection closure reaches a
  video. Neither an aligned nor a differently placed grouped clip may create a
  second request/delta authority.
- The authority sequence and its integer frame grid own the one conform. All
  participating video must use that same sequence ID and rational rate.
- Timing evidence must match each persisted video source decision and exact
  timing-asset identity. Missing, stale, substituted, or unverified evidence
  refuses before planning.
- Move the shared `VideoSourceTimingView` type to a source-timing owner and
  re-export it compatibly for slip/slide; rate-stretch must not depend on a
  sibling feature module.

## Contract 2: deterministic target closure

- Seed from the active clip and include the current selection only when it
  contains that active clip. Expand group and A/V relationships transitively in
  stable project clip order, using the existing transform-closure semantics.
- Every participating clip has exactly one media-track owner and matching
  source kind. Hidden lanes still participate; every reached V15 locked track
  refuses, and a caller predicate may only strengthen the persisted lock fact.
- Every nonempty A/V link in the final set contains exactly one audio and one
  video clip on the same lane group with identical original presentation
  endpoints. Missing, orphaned, or ambiguous companions refuse.
- Unlinked audio may participate when closure is seeded by a valid video
  authority. Multiple audio participants may share a lane, but this bounded
  slice refuses more than one participating video on the same video lane.
## Contract 3: one rational duration scale

- The edge opposite the requested edge is anchored for every participant:
  right stretch keeps each original start; left stretch keeps each original
  end. Source start/end are unchanged.
- Convert the requested absolute sample to the authority sequence edge once
  with exact `point` policy. Its resulting positive frame count over the
  immutable authority frame count defines one reduced positive rational
  `durationScale`.
- Apply that same rational to every immutable original duration. Video counts
  and unlinked-audio sample durations point-round once; no preview or repeated
  key gesture may scale an already rounded result.
- Each changed video emits resolved timeline aliases plus exact
  `sequencePlacement { sequenceStartFrame, sequenceFrameCount }`. Its canonical
  source range, trim metadata, effects, and `retimeMap` remain byte-stable.
- Each linked audio clip takes the absolute final program endpoints of its own
  video companion, preserving NTSC phase instead of independently rounding the
  authority delta.
- A transform/no-op plan reports the requested and applied sequence edge,
  resolved boundary sample, signed edge-frame delta, reduced duration scale,
  derived authority playback rate, clamp state, participants, transforms, and
  complete previews. Every result and nested record/array is frozen.

## Contract 4: source and audio semantics

- Source ranges never change. CFR source duration is exact rational frame time;
  VFR source duration is the difference between the verified in/out boundary
  PTS values.
- Every final video effective rate must remain within the currently supported
  preview range `1/16..16`. The base project must already satisfy this bound;
  rate-stretch does not silently repair an unpreviewable document.
- Participating audio must be neutral varispeed: `pitchCents === 0`,
  `speedRatio === 1`, `stretchToTempo === false`, and `warpMap == null`.
  Reversed neutral audio is permitted because its fixed source range remains
  authoritative.
- Audio transforms change only program placement/extent, clamp fades to the
  final duration, and rescale envelope coordinates once from immutable local
  positions. They omit source/trim fields, `speedRatio`,
  `renderCacheRevision`, and unrelated audio state.
- Non-neutral time/pitch audio refuses. Composing pitch preservation, rendered
  caches, tempo following, or warp maps belongs to Soundscaper audio effects or
  later retiming work, not this packet.
- Any non-null video `retimeMap` refuses; curves, reverse, and freeze remain
  owned by 3B-5.

## Contract 5: clamp, composition, and command

- Validate the original projection before searching. Unsafe ranges, invalid
  base video composition, unsupported base effective rates, or malformed links
  refuse; they are not reported as clamp/no-op.
- Analytically bound the authority count for positive extents, sequence origin,
  safe-integer endpoints, every participant's rounded extent, and the effective
  rate range. Use BigInt rational arithmetic for intermediate products.
- If the exact request is illegal only because of source-independent placement
  or video composition, choose the nearest legal authority-frame count toward
  identity with a bounded monotone search. The one-changed-video-per-lane rule
  makes each affected endpoint monotone; prove the legal prefix and refuse the
  known independently-rounded multi-video reappearance case.
- Substitute all planned video records and validate every affected video lane.
  The operation does not invent overwrite, transition repair, or ripple.
- A fully clamped identity result is a frozen no-op and commits nothing.
  Otherwise service commit prepares and submits one serializable
  `clip/transform-many`; undo/redo round-trips every participant in one step.
- Persisted track-lock admission remains the final low-level authority even
  though preview and service fail early from the same live projection.

## Contract 6: menu, pointer, feedback, and badge

- Add lazy Framescaper-only Clip boundaries leaves with stable IDs
  `rate-stretch-left-edge-to-playhead` and
  `rate-stretch-right-edge-to-playhead`. They remain present for Search and
  configurable shortcuts but perform no planning while menus are closed.
- Menu materialization plans from the live playhead and owns disabled state;
  activation builds a fresh absolute request and service commit replans live.
  Soundscaper exposes neither leaf.
- Route existing video stretch handles to `video.trim.rateStretch.preview` and
  `.commit`. Pointer move/release supplies the current absolute edge sample;
  it never sends float deltas or preview transforms. A zero-delta release still
  reaches a fresh no-op plan and must not become a seek.
- Preview renders every participant, tags changed audio waveforms, and shows one
  conformed active-edge guide. Refusal/no-op clears stale preview state.
- No new default-visible control or global shortcut is added. Menu access is the
  screen-reader/configurable-keyboard surface for this operation.
- The video speed badge derives the actual fixed-source/program playback rate
  from the same verified timing boundary. A stale `clip.speedRatio` must not be
  displayed as the video authority.
- Localized status reports applied left/right stretch, effective rate and exact
  program timecode, with distinct clamped and no-op outcomes, only after a
  successful commit or planned no-op.

## Foundation matrix row

Add `rate-stretch` to the machine-readable and rendered foundation matrix:

- audio placement: anchor the untouched edge;
- audio extent: point-scale the immutable extent once;
- audio source range: unchanged;
- video placement/extent: anchor the untouched integer sequence edge and
  point-scale the canonical frame count once;
- video source range: unchanged; and
- operation conformance: one video authority conforms the requested edge and
  supplies one reduced rational duration scale for the full relation set.

## Acceptance and TDD sequence

1. Red strict planner/command tests cover both edges, nonzero origins, integer,
   NTSC, VFR, point-policy half ties, and 48 kHz/40 kHz alias collisions;
   unequal participant durations and point-rounding ties; exact linked-audio
   phase; neutral reversed
   and grouped audio; fixed sources; rate/origin/safe-integer/common clamps;
   locks, hidden lanes, malformed links, active-unlinked refusal, non-neutral
   audio, retime/warp refusal, composition, immutability, and frozen output.
2. Production lands the pure domain/target/planner modules, shared timing-view
   ownership, matrix row, and exact transform metadata. A real command/history
   round trip proves preview equals persisted canonical geometry and undo/redo.
3. Red service/feedback tests prove fresh project plus timing reads, persisted
   locks overriding caller input, one command, report ordering, and capability
   error propagation; then compose `video.trim.rateStretch` without growing the
   near-ceiling action facade or application-menu root.
4. Red lazy-menu and pointer-router/hook tests prove the two stable leaves,
   closed-render zero planning, Search/shortcut activation, live playhead,
   existing-handle routing, full previews/guide, stale clearing, and unchanged
   Soundscaper/audio-only behavior. Add derived-rate badge coverage.
5. Focused Chromium proves both menu edges and both existing handles on one
   exact-timed linked A/V fixture, canonical/source persistence, rate feedback,
   common clamp, lock refusal, one-step undo/redo, configurable-menu keyboard
   reachability, Soundscaper absence, and no new default-visible control.
6. Run focused tests while red/green, then `npm run check`, build, focused
   Chromium, and the roadmap/status checks before recording delivery.

## Recorded evidence

- Delivery through commit `2bbfa06b` includes the pure CFR/VFR-capable planner,
  verified source-timing boundary, frame-canonical command persistence,
  controller and localized feedback, lazy Framescaper menu state, existing
  stretch-handle routing, derived-rate badge, and focused browser workflow.
- `npm run check` passed with 5,253 tests total, 5,251 passed and 2 skipped;
  coverage was 90.08% statements and lines, 81.95% branches, and 90.58%
  functions.
- The production build guard passed with the largest JavaScript chunk at
  388,318 bytes. Focused Chromium exact-timing rate-stretch coverage passed
  1/1, validating the persisted timing asset bytes and exact linked A/V
  canonical/source persistence across both lazy menu actions and both existing
  video stretch handles, PTS-derived rate feedback, undo/redo, transient
  previews and guide, lock refusal, localized German feedback, Soundscaper
  absence, and no default-visible control.

## Remaining 3B-4 keyboard seam

This slice does not close packet 3B-4. Vendored clip-focus callbacks still send
fixed 0.1-second trim/stretch deltas through `useAudioTrackRowNavigation.js` and
the legacy `clip.trim`/`clip.stretch` actions. The immediate follow-up is a
narrow canonical keyboard adapter/status-parity slice for video-bearing clips;
it must route those real callbacks through the same absolute planner authorities
and prove keyboard feedback. Link/Unlink, visibility, lock, menu reachability,
and shuttle keys are already delivered.

This slice does not touch time selection. The source-monitor four-disagreeing-
points browser refusal remains assigned to the next packet that actually does.

## Non-goals and stop conditions

- No retiming curve, speed ramp, reverse/freeze authoring, optical flow, audio
  warp, pitch preservation, tempo stretch, render-cache creation, transition
  repair, overwrite, ripple, schema revision, capability change, or new chrome.
- Stop if a result needs a persisted derived cache, a second operation conform,
  a source-range change, unsupported/non-neutral audio composition, unbounded
  search, or a playback/export rate the current deterministic surfaces cannot
  represent identically.
- Stop if preview and commit cannot use the same pure live plan, linked A/V
  cannot remain exact through one transform, or any public route bypasses live
  V15 lock authority.

The ten packaged Electron timing-probe rows run automated tests and remain
`pending-external` only for milestone-9 release admission. WebKit automated
testing is enabled. Local implementation may proceed without relabeling
either qualification boundary.
