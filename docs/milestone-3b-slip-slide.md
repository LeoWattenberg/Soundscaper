# Milestone 3B-4b6: frame-canonical slip and slide

> **Implemented:** delivered through commit `c490af3b` on 2026-08-11, after
> [3B-4b5 — frame-canonical roll and ripple trim](milestone-3b-roll-ripple-trim.md).
> This slice adds video-bearing slip and slide through one pure planning
> authority, one atomic transform command, the existing menu, and whole-clip
> pointer gestures, without a default-visible control. It does not complete
> packet 3B-4; the immediate pickup is bounded **3B-4b7 — uniform rate-stretch**,
> followed by the remaining keyboard-complete trim feedback.

## Foundation already present

- The foundation coordinate matrix makes slip a source-domain operation and
  slide one conformed center move with fixed outer endpoints. Neither operation
  may accumulate sample deltas or conform neighboring extents independently.
- V15 persists video placement/extent in sequence frames and source in/out in
  source frames. Runtime projections expose resolved samples, while validated
  timing assets expose exact source PTS for VFR media.
- The edge and roll/ripple planners already own exact rational mapping, stable
  relation closure, monotonic common clamps, composition validation, immutable
  previews, and canonical `sequencePlacement` command metadata.
- Persisted track locks are enforced centrally across direct and nested
  commands. A planner still consumes the same live facts so preview, menu state,
  and commit fail early and agree.
- Edit > Clip boundaries, configurable menu-action resolution, clip-body
  dragging, Escape cancellation, source/program timecode, and status
  announcements are the opt-in surfaces. No new workspace chrome is needed.

## Slice boundary and request authority

Add strict, UI-independent **slip** and **slide** planning whose participant set
contains video. Requests are a tagged union:

```text
{ mode: 'slip', activeClipId, requestedSourceInFrame }
{ mode: 'slide', activeClipId, requestedStartSample }
```

Both targets are absolute points against an immutable request-start projection,
never deltas from a prior preview. A source-timing input supplies verified PTS
or an exact rational CFR projection; missing/corrupt required timing refuses.

The planner returns a deeply frozen no-op or ordered transform plan. A focused
controller previews it and, after a fresh live replan, commits exactly one
`clip/transform-many`. Framescaper exposes four one-frame application-menu
actions and modifier variants of whole-clip dragging. Soundscaper and ordinary
move keep their current behavior.

## Target and relation closure

1. **The active center is explicit.** If the active clip belongs to the active
   clip selection, that selection seeds the center block; otherwise only the
   active clip does. Group and A/V relations then expand transitively in stable
   project order. Every participating clip must have one timeline owner and one
   source, and the final set must contain video.
2. **Slip moves the center block's source ranges only.** It does not search for
   timeline neighbors. Every reached A/V ID must contain exactly one video and
   one audio participant. Differing source rates are legal because the shared
   source-time span is changed into each source's own frame/sample grid once.
3. **Slide closes exact touching triplets.** Center closure must leave at most
   one center on a lane. For each center, add its unique same-lane left neighbor
   ending exactly at the center start and right neighbor starting exactly at the
   center end. Expand every role through group/A/V relations; a role reaching a
   new lane seeds that role there, and the unique touching center and remaining
   neighbor are completed. Repeat to a fixed point.
4. **Roles cannot cross.** Every affected lane ends with exactly one left,
   center, and right clip in that order. Conflicting clues, a relation crossing
   roles, duplicates, missing counterparts, gaps, overlaps, transitions,
   equal/nested ranges, ambiguous ownership, or more than one candidate refuses.
   All participating video belongs to one sequence and one rational rate.
5. **Visibility is not authority.** Hidden lanes reached by selection, group,
   A/V, or triplet completion still participate.
6. **Locks fail closed.** Every slip participant and every slide center or
   neighbor must be unlocked in the live V15 project. One affected locked lane
   refuses preview and commit; central command admission remains final authority.

## Slip source-domain contract

1. **Choose one source authority.** Use the active video, otherwise its unique
   A/V video, otherwise the first participating video in stable project order.
   `requestedSourceInFrame` is an integer boundary on that source's own grid.
2. **Resolve one exact source-time span.** Let authority boundaries be `I` and
   `O`, and requested in be `B`. Resolve `tau = pts(B) - pts(I)` once from the
   verified timing view. Sequence frames and timeline samples do not enter this
   delta. A non-VFR source uses the exact rational `frame * den / num` rule.
3. **Shift both source boundaries from immutable originals.** For every video,
   map `pts(in) + tau` and `pts(out) + tau` independently to the nearest legal
   integer source boundary with the named `point` policy. For every audio clip,
   map its absolute source-sample boundary times plus `tau` back to integer
   samples with that policy. Reversed audio uses the same low/high source-domain
   shift; reversal does not invert `tau`.
4. **Program geometry is unchanged.** Timeline placement and extent, video
   sequence placement/count, selection, effects, and fades stay fixed. VFR may
   produce a different video `sourceFrameCount` because independently shifted
   PTS boundaries can contain a different number of frames; that is source-grid
   conformance, not a program retime.
5. **Linked A/V uses one time span, not equal integers.** A linked video's PTS
   boundaries and its audio companion's sample boundaries each receive `tau` in
   their own grid. Thus unequal frame/sample rates remain source-time aligned
   without pretending their integer deltas are equal. Presentation endpoints
   remain unchanged and command reconciliation retains derived equality.
6. **Legacy metadata follows actual audio boundaries.** Audio uses
   `trimStart' = max(0, trimStart + in' - in)` and
   `trimEnd' = max(0, trimEnd - (out' - out))`. Video trim metadata stays
   non-authoritative and unchanged. Non-null video retime maps and audio warp
   maps refuse rather than rewriting a breakpoint map in this slice.
7. **One common clamp owns the block.** Intersect source-handle, safe-integer,
   relation, and lock bounds in exact source time. VFR point mapping can create
   non-convex positive-range legality when both shifted endpoints temporarily
   round to one boundary. Starting at the requested authority boundary and
   moving toward `I`, derive every current collapse's exact point-cell `tau`
   interval and jump past the farthest blocking interval through a binary search
   of the authority PTS index. Re-evaluate after each jump; refuse after 64
   jumps rather than scanning a timing index or permitting unbounded pointer
   work. Within that bound the nearest legal target wins, `I` is a no-op, and
   no search walks `abs(B - I)` frames or assumes a monotonic legality prefix.

## Slide frame and neighbor contract

1. **Conform the center move once.** Use the active video center, otherwise its
   unique A/V video, otherwise the first stable center video. Convert the
   absolute `requestedStartSample` to that sequence's frame with `point`, then
   subtract the authority's immutable start to obtain signed frame delta `d`.
   Every video uses `d`; no neighbor derives its own delta.
2. **Outer endpoints stay fixed.** On a lane whose immutable triplet is
   `[L,S] [S,E] [E,R]`, the candidate is `[L,S+d] [S+d,E+d] [E+d,R]`.
   Center source stays fixed, as do video sequence extent and unlinked-audio
   sample duration; linked-audio presentation may breathe by one sample.
   Neighbor extents derive from these absolute boundaries.
3. **Video source edges map once.** The left neighbor's out and right neighbor's
   in map from their immutable sequence/source ratios at their new inner frame.
   Every changed video transform, including the center, carries validated
   `sequencePlacement: { sequenceStartFrame, sequenceFrameCount }`; resolved
   sample aliases must agree at the command boundary.
4. **Audio preserves its own phase.** A linked center or neighbor derives each
   final presentation endpoint from its own video companion, including a
   possible one-sample NTSC phase difference, then maps a changed audio source
   edge from its own immutable range. Other audio centers move by the authority
   start's resolved sample delta with fixed duration; their neighbors meet those
   lane-local endpoints. A linked center anchors a lane with unlinked neighbors;
   an unlinked center with any linked neighbor refuses before candidate search,
   because unlike NTSC phases need not share one sample delta. Existing audio
   trim accounting and fade clamps apply; no global sample alias overrides a
   linked companion.
5. **One common legal `d` controls every triplet.** Preflight exact touching
   structure, then intersect timeline-origin, positive-neighbor-extent,
   source-handle, safe-integer, relation, and lock bounds. Search toward zero as
   above and validate the complete substituted video composition. Invalid
   originals refuse; a legal request may clamp but never invent overwrite,
   split, gap repair, or transition repair.
6. **Mapped media stays simple.** Any affected non-null video retime map or audio
   warp map refuses. Transition overlap at either center edge is not touching
   adjacency and refuses before candidate search.

## Plan, command, preview, and history

- Plans name mode, authority clip/source/sequence, requested and applied
  absolute targets, signed authority delta, clamp state, stable role/participant
  IDs, per-participant final source boundaries, transforms, and complete preview
  records. No-op arrays are empty. Inputs and timing views remain unchanged.
- Slip transforms change only source-range aliases and needed audio trim
  metadata. Slide transforms change center placement plus neighbor
  placement/extent/source edges. Unchanged fields are omitted; previews remain
  complete and tag `source-slip`, `neighbor-trim`, or `placement` work so
  waveform/filmstrip recomputation is truthful.
- Commit reads a fresh branded command projection, verified timing views, and
  persisted locks, replans, and prepares one `clip/transform-many`. It never
  commits preview transforms or a hidden batch. Success is one revision and one
  undo/redo step; no-op/refusal creates none.

## Menu, pointer, keyboard, and feedback

- Framescaper adds **Slip source earlier one frame**, **Slip source later one
  frame**, **Slide clip earlier one frame**, and **Slide clip later one frame**
  under Edit > Clip boundaries, with IDs `slip-source-earlier-one-frame`,
  `slip-source-later-one-frame`, `slide-clip-earlier-one-frame`, and
  `slide-clip-later-one-frame`.
- A planner-owned step-request builder reads the immutable authority and returns
  the absolute request: slip uses authority source-in minus/plus one source
  frame; slide resolves authority sequence start minus/plus one frame to an
  absolute sample. Menu code never adds one, reads persisted aliases, or
  converts rates. It binds the returned request and live plan to that render.
- Exact whole-clip chords capture `Alt`/`Option` as slip and
  `Alt`/`Option`+`Shift` as slide only for a primary, non-touch,
  Framescaper video-bearing body drag with neither Control nor Meta held. A trim
  handle keeps its roll/ripple meaning. Extra modifiers, touch, audio-only, and
  Soundscaper retain ordinary selection/move behavior. Captured gestures suppress
  Shift-add selection and do not change mode mid-drag.
- A planner-owned pointer-request builder receives absolute pointer-down `P0`
  and current `P` plus immutable source boundaries `I/O` and program extent `D`.
  It resolves `tauPointer = (P - P0) * (pts(O) - pts(I)) / D` exactly, then maps
  `pts(I) + tauPointer` once to absolute `requestedSourceInFrame`; right means
  later source. Slide likewise targets the immutable center start. Release sends
  the final absolute request to a fresh replan; Escape cancels.
- Preview keeps slip program boxes fixed while updating source content. Slide
  renders every center and neighbor plus guides at the conformed center edges.
  No persistent overlay or readout is added.
- Success feedback is localized. Slip reports signed applied authority source
  frames and the resulting authority source timecode; slide reports signed
  applied sequence frames and resulting center start/end program timecodes.
  Both append the clamp marker when applicable. No-op is informational and
  refusal uses the existing error status. The four stable menu IDs remain
  configurable-shortcut targets; no unmodified global key is added.

## Acceptance and exact first TDD seam

- Start with `tests/audio-editor-frame-canonical-slip-slide-planner.test.ts`.
  Its red table covers CFR and VFR slip, mismatched linked audio rate, a touching
  NTSC slide triplet, exact own-phase A/V, common clamp, frozen output, and lock
  refusal against an unchanged command projection and timing view.
- Expand fixtures across forward/reversed audio, multi-rate grouped sources,
  VFR boundary-count changes, source/timeline origins, one-frame handles, safe
  integer requests, triplet fixed points, hidden lanes, ambiguous adjacency,
  role-crossing relations, transitions, maps, and invalid originals. Small
  exhaustive slide rows prove legality cannot reappear beyond the first illegal
  same-sign magnitude. A sparse-gap VFR slip row proves that a collapsed point
  cell can be skipped to the nearest reappearing legal target, and a pathological
  index proves the fixed jump limit refuses without partial output.
- Command/history tests apply returned plans at an incommensurate sample/sequence
  rate and prove preview-equal canonical persistence, exact linked presentation,
  source-time alignment, one history entry, and exact undo/redo. Malformed or
  tampered canonical placement refuses.
- Service/menu/pointer tests prove planner-owned absolute step targets, immutable
  pointer origins, live replan, modifier conflict behavior, localized feedback,
  Framescaper-only exposure, and unchanged Soundscaper/ordinary move.
- Focused Chromium exercises all four menu actions, both pointer modes, one
  exact-timed linked pair with validated persisted timing-asset bytes, one locked
  refusal, feedback, and one-step undo/redo while showing no new default-visible
  control. Focused tests, typecheck, lint, architecture, file-size, canonical
  non-browser, build, and Chromium gates pass before status is recorded.

Expected strict modules are `frame-canonical-slip-slide-domain.ts`,
`frame-canonical-slip-slide-planner.ts`, `controller/video-slip-slide-service.ts`,
`controller/video-slip-slide-feedback.ts`, `ui/framescaper-slip-slide-menu-model.ts`,
and `ui/timeline/slip-slide-pointer-routing.ts`. Compose them through
`video.trim.slipSlide.preview/commit` and a narrow request-builder port; keep
each maintained file below 600 lines and register new conversions.

## Recorded evidence

- Delivery through commit `c490af3b` includes the pure CFR/VFR-capable planner,
  verified source-timing boundary, exact canonical command persistence,
  controller and localized feedback, lazy Framescaper menu state, whole-clip
  pointer previews and guides, and focused browser workflow.
- `npm run check` passed with 5,220 tests total, 5,218 passed and 2 skipped;
  coverage was 91.34% statements and lines, 79.93% branches, and 90.45%
  functions.
- The production build guard passed with the largest JavaScript chunk at
  388,318 bytes. Focused Chromium exact-timing slip/slide coverage passed 1/1,
  validating the persisted timing asset and exact linked A/V canonical/source
  persistence across all four menu actions, both modified body gestures,
  undo/redo, transient previews/guides, lock refusal, localized feedback,
  Soundscaper absence, and no default-visible control.

## Non-goals and stop conditions

- No audio-only replacement, transition repair, overwrite, split, rate-stretch,
  retiming curve, reverse video, nested sequence, schema/capability/command
  discriminant, persisted cache/preview, default-visible UI, or Soundscaper menu.
- Stop if slip needs a timeline-domain accumulated delta, unverified PTS, equal
  integer deltas across unlike source grids, or breakpoint-map rewriting.
- Stop if slide needs non-touching/ambiguous neighbors, per-neighbor sequence
  conformance, unlocked narrowing of relation closure, or a video transform
  without canonical placement metadata.
- Stop if either operation cannot preview and commit through the same pure live
  plan, one `clip/transform-many`, and one undo step, or if reachability requires
  a default-visible surface or changes ordinary move/Soundscaper behavior.

The four packaged Electron timing-probe rows remain `pending-external`, and
WebKit remains deferred. This focused Chromium result qualifies only that
workflow.
