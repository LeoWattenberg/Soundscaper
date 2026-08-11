# Milestone 3B-4b5: frame-canonical roll and ripple trim

> **Implemented:** delivered through commit `47a0be9` on 2026-08-11, after
> [3B-4b4 — persisted track locking and central enforcement](milestone-3b-track-locking.md).
> This slice adds video-bearing roll and track-ripple trim through one pure
> planning authority, one atomic transform command, the existing application
> menu, and the existing timeline handles. It does not add a default-visible
> control or mark packet 3B-4 complete; the immediate pickup is
> [3B-4b6 — frame-canonical slip and slide](milestone-3b-slip-slide.md).

## Foundation already present

- 3B-4b2 owns exact rational edge mapping, one-point sequence conformance,
  source-handle clamping, reversed-audio formulas, immutable previews, and full
  candidate video-composition validation. 3B-4b3 replans live and commits one
  `clip/transform-many` for ordinary video-bearing trims.
- The foundation coordinate matrix requires roll to conform one shared edit
  point and ripple to conform one operation span before shifting affected lanes.
  Neighboring extents may not be conformed independently.
- Current projects persist canonical video sequence/source frames and derive
  linked-audio presentation from video endpoints. The command projection is the
  only planner input that exposes both those authorities and resolved samples.
- V15 track `locked` is persisted for every lane kind. The central command guard
  is final authority across direct and nested commands; planners must still use
  the same live lock facts so preview and menu state fail early and truthfully.
- Edit > Clip boundaries, configurable menu-action shortcut resolution, existing
  trim handles, drag previews, Escape cancellation, sequence timecode labels,
  and status announcements already provide the required opt-in surfaces.

## Slice boundary and outcome

Add one strict, UI-independent planner for **roll** and **track-ripple trim**
whose participant set contains video. Its request is
`{ mode: 'roll' | 'ripple', activeClipId, edge: 'left' | 'right',
requestedBoundarySample }`. The sample is an absolute point in the immutable
pointer/menu-start projection, never a delta accumulated from previews.

The planner returns a deeply frozen no-op or ordered transform plan. A focused
controller previews it and, after a fresh live replan, commits exactly one
`clip/transform-many`. Framescaper exposes four menu actions to the playhead and
modifier variants of the existing handles. Soundscaper and audio-only trim keep
their current behavior.

This is lane-targeted ripple, not a sequence-global extract: only deterministic
media-lane closure described below moves. Timeline labels and other annotations
do not ripple in this slice.

## Targeting, adjacency, and expansion

1. **The active edge is explicit.** Planning begins with the selected/pointer
   clip, its chosen edge, and the command projection used for that render or
   commit. Expansion is mode-specific and stable; it may not leave one selected,
   grouped, or A/V-linked member behind.
2. **Ripple has one edge participant per lane.** Selection, group, and A/V
   relations expand transitively from the active clip. Every result exposes the
   chosen edge at the same resolved edit point, and video results expose the same
   sequence-frame boundary. More than one participant on a lane, another edge,
   mixed sequences/rates, missing ownership, or ambiguous A/V refuses.
3. **Roll classifies one matched touching pair per lane.** Seed the active clip
	and its unique same-lane exact-touch neighbor, then reach a fixed point by
	alternating selection/group/A/V expansion across both sides with addition of
	each newly reached lane's unique exact-touch opposite-side counterpart.
	Classify every result by `end == J` (left) or `start == J` (right); every
	affected lane requires exactly one of each. An unclassified or dual clip, gap,
	overlap, transition, equal/nested interval, duplicate side, unmatched peer, or
	ambiguous closure refuses. The first slice never repairs or rolls a transition.
4. **Ripple moves a deterministic lane suffix.** Seed lanes are the edge-block
   lanes. Each lane's suffix cut is that lane participant's original far-right
   endpoint, so equal chosen edges may have unequal durations. All
   nonparticipants beginning at or after their lane cut shift. Repeatedly expand
   transformed clips through group and A/V relations. For a reached lane without
   an edge participant, the fallback cut is the minimum original far-right
   endpoint across the initial edge lanes; a relation peer before that cut
   refuses, while a peer at/after it seeds that lane and moves every clip at/after
   the fallback cut. Refuse a straddler at any seed or fallback cut and repeat to
   a finite fixed point. This rule is order-independent; no clip is split,
   deleted, or silently detached.
5. **Visibility is not targeting authority.** Hidden lanes still participate
   when an explicit edge, group, A/V link, or suffix closure reaches them.
   Visibility affects rendering only and cannot bypass relation or lock rules.
6. **Locks fail closed.** The edge block, roll neighbors, every suffix clip, and
   every lane reached during closure must be unlocked in the live V15 project.
   One locked affected lane makes preview/menu a refusal and commit changes
   nothing. The controller derives this predicate; callers cannot weaken it,
   and central command admission remains final authority.

## Frame, source, and clamp authority

1. **Conform once.** The video authority is the active video, otherwise its
   unique participating A/V video, otherwise the first participating video in
   stable project order. Convert the requested absolute sample point to that
   sequence's integer frame with the existing `point` policy. Subtract the
   immutable original edge frame once to obtain signed frame delta `d`; every
   video uses `d`, never a separately rounded sample delta.
2. **Roll math is one shared boundary.** For adjacent canonical ranges
   `[L, J]` and `[J, R]`, the resolved boundary is `B = J + d`. Results are
   `[L, B]` and `[B, R]`; outer endpoints stay fixed. Each adjoining source
   boundary maps once from that clip's immutable timeline/source ratio. No
   intermediate duration is reused as an input.
3. **Right ripple keeps the left endpoint.** For an edge participant `[S, E]`,
   `B = E + d`; its result is `[S, B]`, and every suffix placement shifts by
   program delta `p = d`. Shrinking therefore uses negative `d` and closes the
   exact resolved span.
4. **Left ripple keeps the program edit anchored.** Here `B = S + d` is the
   source cut on the immutable original. The participant's chosen source edge
   maps at `B`, its final placement remains `S`, its duration becomes
   `(E - S) - d`, and its final end is `E - d`. Every suffix placement shifts by
   `p = -d`.
   Thus trimming head material (`d > 0`) shortens the program, without applying
   `d` a second time to the active clip's placement.
5. **Canonical source mapping is inherited, not forked.** Video boundaries use
   exact integer-ratio mapping from canonical sequence frames to canonical
   source frames and canonical `sourceFrameCount` bounds. A linked audio member
   uses its own participating video companion's resolved endpoint, including
   the possible one-sample NTSC phase difference. Other audio uses the operation
   authority's resolved sample span. Existing forward/reversed mapping, trim
   metadata, and fade clamps apply; non-null video retime maps refuse.
6. **Suffix source ranges never move.** Ripple changes only suffix timeline
   placement. Video suffixes shift by integer `p` sequence frames; unlinked
   audio shifts by `resolvedProgramSampleDelta`, defined as authority
   `sample(B) - sample(E)` on the right and `sample(S) - sample(B)` on the left.
   Linked edge and suffix audio instead derive endpoints from their own video
   companion, preserving a possible one-sample NTSC phase difference. Every
   transformed suffix video shares the authority sequence and rate. Source
   start, source duration, trims, fades, effects, and content remain unchanged.
7. **One common legal delta controls all participants.** Preflight exact-touch
   roll or no-straddler uniform-suffix ripple structure before candidate search;
   that structure must make legality a monotonic prefix from zero. Intersect
   analytic timeline-origin, positive-extent, source-handle, safe-integer,
   relation, and lock bounds, then use a binary search toward zero over at most
   the safe-integer bit width. Never walk `abs(d)` frames or search through a
   legality hole. The nearest legal same-sign delta wins; zero is a no-op.
8. **Validate the complete substitution.** Original and fully substituted video
   tracks must satisfy existing composition rules after edge, neighbor, and
   suffix transforms are applied together. Invalid originals refuse; candidates
   may clamp toward zero but never invent overwrite, split, or transition repair.

## Plan, command, and history contract

- Plans include mode, edge, sequence ID/rate, requested and applied sequence
  frames, `d`, program delta `p`, `resolvedProgramSampleDelta`, resolved
  source-cut sample, resulting program edit sample, clamped state, stable
  edge/neighbor/shifted clip IDs, transforms, and complete preview records.
  No-op plans contain empty transform/preview arrays. Inputs and relation arrays
  remain unchanged; every result is deeply frozen.
- Transforms contain only fields accepted by `prepareTransformClipsCommand`.
  Unchanged fields are omitted from command changes but complete previews carry
  timeline/source bounds plus trim/fade values. Stable project order breaks all
  ties.
- Commit reads a fresh branded command projection, derives persisted locks from
  that same project, replans, and prepares one `clip/transform-many`. It never
  uses preview transforms, `range/ripple-delete`, a batch, or a second annotation
  command. Success is one revision and one undo/redo step; no-op/refusal creates
  none and publishes no success.

## Menu, keyboard, pointer, and feedback

- Framescaper adds **Roll left edge to playhead**, **Roll right edge to
  playhead**, **Ripple left edge to playhead**, and **Ripple right edge to
  playhead** under Edit > Clip boundaries. Live planner results own disabled
  state. The IDs participate in the existing configurable shortcut/menu-action
  resolver and remain keyboard reachable through the menubar; J/K/L and the
  edit-navigation arrows stay reserved, and this slice adds no unmodified global
  key or default-visible control.
- An unmodified trim handle remains ordinary trim. `Alt`/`Option` starts roll;
  `Alt`/`Option` + `Shift` starts ripple. Mode is captured at pointer-down and
  does not change mid-drag. These trim modifiers suppress selection-toggle
  behavior for that gesture. Touch retains ordinary trim; roll/ripple remain
  available through the keyboard-reachable menu.
- Pointer preview renders every returned preview, including roll neighbors and
  ripple suffixes, plus a guide at the conformed requested cut. Preview records
  distinguish source-changing edge/neighbor trims from placement-only suffix
  moves, so suffixes do not trigger waveform-trim recomputation. Escape cancels.
  Release submits the final absolute pointer point to a fresh controller replan;
  stale previews never become commit authority.
- Success reports localized mode/edge, actual applied frame span, resulting
  program edit timecode, and a clamp marker. For left ripple it must distinguish
  the requested/resolved source cut `B` from the unchanged placement edge `S`
  and the resulting program join `E - d`; `programEditSample` names that join.
  A no-op reports localized informational feedback, never success; refusal uses
  the existing error status. No persistent overlay or new readout is added.

## Acceptance

- Table-driven roll and left/right ripple shrink/extend cases cover integer and
  NTSC rates, nonzero sequence origins, unequal source rates, exact ties,
  one-frame extents, source-handle and timeline-origin clamps, and requests near
  safe-integer limits without work proportional to request magnitude.
- Fixtures cover video-only and exact linked A/V blocks, NTSC companion phase,
  forward/reversed audio, selected touching roll pairs, same-side and cross-side
  group closure, unequal-duration left-ripple lanes, stable tie order, ripple
  suffix fixed points, gaps, hidden lanes, and locked edge/neighbor/downstream
  lanes. Ambiguous adjacency, relation crossing, straddling clips, mixed suffix
  sequences/rates, retime maps, invalid originals, and transition rolls refuse
  atomically. Closure fixtures include an unseeded downstream lane at the
  fallback cut, a pre-cut peer, a straddler, and a two-hop relation. Small
  exhaustive rows prove legal magnitudes cannot reappear after an illegal
  magnitude.
- Repeated preview from immutable originals has no drift. Applying one returned
  transform command yields the previewed projected endpoints, canonical video
  persistence, derived-equal linked audio, unchanged suffix source ranges, one
  history entry, exact undo/redo, and an unchanged input projection.
- Service/menu/pointer tests prove live replan, stale-preview rejection, exact
  action requests, planner-owned enablement, modifier capture, Escape/no-op/error
  behavior, localized actual-boundary feedback, Framescaper-only exposure, and
  unchanged Soundscaper/audio-only ordinary trim.
- Focused Chromium proves all four menu actions, both pointer modes, one NTSC
  linked pair, a locked refusal, feedback, and one-step undo/redo, while showing
  no new default-visible feature. Focused tests, typecheck, lint, architecture
  and file-size checks, canonical non-browser gate, build, and Chromium pass
  before implementation is recorded.

## Recorded evidence

- Delivery through commit `47a0be9` includes the pure planner, exact canonical
  command boundary, controller and feedback, lazy menu state, pointer preview,
  localized status, and focused browser workflow.
- `npm run check` passed with 5,146 tests total, 5,144 passed and 2 skipped;
  coverage was 90.09% statements and lines, 81.91% branches, and 90.46%
  functions.
- The production build guard passed with the largest JavaScript chunk at
  388,318 bytes. Focused Chromium NTSC roll/ripple coverage passed 1/1.

## Non-goals

- No sequence-global ripple, label/annotation ripple, clip split/delete, media
  overwrite, transition roll/repair, or automatic target-lane guessing.
- No audio-only replacement, slip, slide, rate-stretch, retiming curve, reverse
  video, freeze frame, multicam, or nested-sequence behavior.
- No schema, capability, requirement, command discriminant, persisted preview,
  derived cache, toolbar/tool-mode/row control, styling, or Soundscaper menu.
- No packet 3B-4 completion or packaged Electron/WebKit qualification claim.

## Stop conditions

- Stop if either operation needs per-clip sequence conformance, floating ratio
  accumulation, a derived persisted cache, or video bounds from a sample alias.
- Stop if a successful result cannot be one `clip/transform-many` and one undo
  step, or if annotation movement is required to call the operation truthful.
- Stop on ambiguous adjacency, non-monotonic legality, relation closure across
  the stationary cut, or any affected locked lane; do not detach, split, repair,
  or silently narrow targets.
- Stop if preview and commit cannot use the same pure planner and live lock
  facts, or if pointer integration needs a new default-visible surface or changes
  ordinary audio trim/Soundscaper behavior.

The four packaged Electron timing-probe rows remain `pending-external`, and
WebKit remains deferred. A focused Chromium result qualifies only that workflow.
