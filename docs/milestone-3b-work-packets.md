# Milestone 3B work packets: Framescaper editorial features

> Pickup contract for the Framescaper half of milestone 3. This document
> decomposes the 3B summary in [the milestone plan](milestone-3-plan.md) before
> feature code is changed. The roadmap owns product scope; this document owns
> packet boundaries, dependencies, and acceptance. Its sibling is
> [`docs/milestone-3a-work-packets.md`](milestone-3a-work-packets.md).

## Pickup status and sequencing

The 3.0 foundation is the implementation baseline: sequences already carry a
rational rate, a drop-frame flag, a start timecode, and their track membership;
video clips are frame-anchored in sequence frames with source-domain in/out
points; and the runtime clip projection is the only timing surface consumers
read. The four packaged Electron probe rows in
`config/milestone-3-timing-probe-matrix.json` remain `pending-external` and are
not relabelled or treated as passing evidence.

What the foundation did **not** provide is any editorial surface over that
model: no command can change a sequence's timing, nothing renders or parses
SMPTE timecode, and no navigation works in sequence frames. 3B-1 closes exactly
that gap, and every later packet builds on its timecode and frame-navigation
primitives.

Schema-neutral work lands first. Document schema revisions stay serialized
product-wide: at most one revision is in flight, it is owned by one agent, and
it lands atomically with its validators, command migrations, and fixtures. 3B-1
is deliberately schema-neutral. The implementation order is:

1. Sequence timing surfaces (rates, SMPTE, frame navigation).
2. Probed source timing and preserved source characteristics.
3. Source/program monitors and three-point editing.
4. Trim tools, shuttle, and edit-point navigation.
5. Retiming, speed ramps, and nested sequences.
6. Proxies, offline/relink, and multicamera groups.
7. Exit evidence.

Every new capability-bearing document type lands atomically with its ID, both
product profiles initially unavailable, production inventory, compatibility
rule, owned-state predicate, state-to-manifest completeness fixture, and
same-schema cross-product preservation fixtures. Framescaper availability is
enabled only after its full native workflow passes.

Every schema revision also includes exact-current validation; typed rejection of
older schemas; future-schema read-only handling; clone, undo/redo, clipboard,
`.scape`, desktop, and archive fixtures; byte-idempotent load/save; semantic
survival after editing; and a fresh versioned desktop-library scope so old
catalog rows cannot poison startup. There are no pre-release migrations.

## 3B-1 — Sequence timing surfaces

- **Outcome:** Make the foundation's sequence timing model editable and legible.
  One undoable command sets a sequence's name, rational rate, drop-frame flag,
  and start timecode. A shared module owns SMPTE drop and non-drop timecode
  formatting, parsing, and the sample⇄sequence-frame mapping consumed by the
  readout, the ruler, stepping, and snapping. The timeline exposes a sequence
  timecode readout, a timecode ruler, and pointer/keyboard frame stepping, and
  the sequence's source timecode reading for a clip's current source frame.
- **Invariants:** The sequence rate is rational and independent of
  `project.sampleRate`; drop frame stays legal only at 30000/1001 and 60000/1001.
  Timecode labels count the sequence's nominal integer frame rate, which is the
  same bound the persisted `startTimecode` validator applies, so a legal label
  is exactly a legal persisted value. Drop frame is a labelling rule and never a
  timing rule: it changes which labels exist, never a resolved sample position.
  Every displayed, parsed, stepped, or snapped position resolves through the
  shared time module under a named policy — boundaries resolve from the absolute
  origin with `point`, a position resolves to the frame that contains it, and no
  value is accumulated or rounded through seconds. A rate change conforms each
  video clip in that sequence once, from its resolved absolute boundaries onto
  the new grid, preserving wall-clock placement rather than frame indices;
  source ranges never move, linked audio is recomputed from the conformed video
  endpoints, and Project Bin pairs keep aligned resolved durations. A start
  timecode keeps its label across a rate change and is conformed only when that
  label becomes illegal at the new rate or drop-frame combination.
- **Acceptance:** Timecode round-trips at 23.976, 24, 25, 29.97 drop and
  non-drop, 30, 50, 59.94 drop, and 60 across hour boundaries; the drop-frame
  label sequence matches the standard at `00:00:59;29 → 00:01:00;02` and
  `00:09:59;29 → 00:10:00;00`; illegal drop-frame labels and out-of-range frame
  fields are rejected rather than repaired. A rate change keeps every clip's
  wall-clock placement within one frame of the new grid, keeps A/V links
  derived-equal, and survives undo/redo, save/reopen, clone, and `.scape`.
  Frame stepping from an arbitrary sample lands on frame boundaries, is
  reversible, and does not drift over ten thousand steps at 44.1 kHz with a
  24 fps sequence. Pointer and keyboard reach the same sequence settings, the
  readout and ruler carry accessible names, and the browser workflow proves a
  rate change through the real product surface.
- **Non-goals:** No probed source timing or persisted source start timecode
  (3B-2 owns both; until then a clip's source timecode reads from its source
  frame at a zero origin and is labelled as such). No sequence creation,
  deletion, or nesting (3B-5). No three-point editing (3B-3), shuttle, or global
  frame-nudge keys (3B-4). No schema revision, no new capability ID: sequence
  timing state is already registered and its owned requirement already fires on
  non-default rate, drop-frame, or start-timecode values.
- **Stop condition:** Stop if a rate change would need per-clip delta rounding,
  if a timecode display would need a persisted derived cache, if drop-frame
  handling changes any resolved sample position, or if a second sequence has to
  exist before the surfaces are usable.

## 3B-2 — Probed source timing and preserved characteristics

The pickup decomposition for its first half is maintained in
[`docs/milestone-3b-probed-source-characteristics.md`](milestone-3b-probed-source-characteristics.md),
which owns the slice boundary between the probed characteristics themselves and
the re-import upgrade path that follows them. Its second half is
[`docs/milestone-3b-source-display-geometry.md`](milestone-3b-source-display-geometry.md),
which measures what the pinned FFmpeg build and the qualified browsers do with a
display matrix and a pixel aspect ratio, makes every surface present the source's
display geometry, and leaves the re-import upgrade to 3B-2c. That upgrade is
decomposed in
[`docs/milestone-3b-source-reimport-upgrade.md`](milestone-3b-source-reimport-upgrade.md),
which owns the one undoable command that re-probes an already-imported source
and conforms the edits cut against its old frame grid.

- **Outcome:** Replace fabricated ingest metadata with probed source truth:
  exact rational frame rate, frame count, VFR timing published as the
  digest-bound timing asset the foundation contract already defines, plus
  rotation, display aspect, field order, alpha, codec, colour, audio stream
  inventory, and source start timecode. Sources record which timing decision
  produced them, and re-import upgrades a conformed source without invalidating
  edits that do not depend on the change.
- **Invariants:** A probe result is either exact or an explicitly recorded
  conform-at-ingest fallback; nothing fabricates a nominal rate. Bulk timing
  stays outside the document. Every preserved characteristic is validated on the
  wire and never silently defaulted. The source frame rate is source metadata
  and never a sequence rate.
- **Acceptance:** The revision fixture set, probe results across the supported
  browser and Electron matrix for representative CFR and VFR fixtures, corrupt
  and missing asset degradation, rotation/aspect/field/alpha rendering parity,
  and re-import upgrade paths.
- **Non-goals:** No transcoding, no proxy generation, no retiming.
- **Stop condition:** Stop if a probe cannot distinguish exact from conformed
  timing, or if a preserved characteristic has no consumer that can honour it.

## 3B-3 — Monitors and three-point editing

Delivered in two slices. The first is
[`docs/milestone-3b-three-point-editing.md`](milestone-3b-three-point-editing.md),
which owns the three-point arithmetic, track targeting, and the insert and
overwrite primitives. The second is
[`docs/milestone-3b-source-monitor.md`](milestone-3b-source-monitor.md), which
owns the source monitor, source in/out marking, replace, and match-frame, and
records that the program monitor is the existing preview surface rather than a
second compositor.

- **Outcome:** Source and program monitors with source in/out marking, track
  targeting, and the insert, overwrite, replace, lift, extract, match-frame, and
  three-point edit primitives operating in sequence frames.
- **Invariants:** Every edit cites its cell in the foundation edit-primitive ×
  coordinate-domain matrix. Three-point arithmetic resolves the fourth point
  once at operation level. Linked audio follows the conformed video endpoints.
- **Acceptance:** The primitive matrix, monitor parity, targeting rules,
  undo/redo, and keyboard-complete workflows.
- **Non-goals:** No trim tools, no multicam, no retiming.
- **Stop condition:** Stop if a primitive needs a second conforming rule beyond
  its matrix cell.

## 3B-4 — Trim tools and shuttle navigation

The delivered nine slices are
[3B-4a — shuttle and edit-point navigation](milestone-3b-shuttle-navigation.md):
session-only J/K/L shuttle and strict previous/next video edit-point navigation
through the existing Transport menu and Framescaper workspace keys; and
[3B-4b1 — linked audio and video visibility controls](milestone-3b-linked-audio-visibility.md):
application-menu Link/Unlink for one exact timeline A/V pair and Show/Hide for
the selected video track, using the existing undoable persisted commands;
[3B-4b2 — frame-canonical edge-trim planner](milestone-3b-frame-canonical-edge-trim-planner.md),
implemented in commit `024ad9b` on 2026-08-11; and
[3B-4b3 — frame-canonical edge-trim integration](milestone-3b-frame-canonical-edge-trim-integration.md):
one planner authority for existing video-bearing pointer preview/commit plus
Framescaper-only left/right-to-playhead application-menu reachability,
implemented in commit `8de72ca` on 2026-08-11; and
[3B-4b4 — persisted track locking and central enforcement](milestone-3b-track-locking.md):
one atomic V15 revision for required audio/video/label track locks, low-level
direct and nested command enforcement, shared Tracks-menu Lock/Unlock
reachability, and lock-aware frame trim and edit-point navigation, implemented
in commit `86496f4` on 2026-08-11; and
[3B-4b5 — frame-canonical roll and ripple trim](milestone-3b-roll-ripple-trim.md):
one frame-canonical authority for roll and lane-ripple planning, atomic command
and history, persisted-lock refusal, lazy Framescaper menu state, existing-handle
modifier routing, complete previews, and localized feedback, delivered through
commit `47a0be9` on 2026-08-11; and
[3B-4b6 — frame-canonical slip and slide](milestone-3b-slip-slide.md): one
frame-canonical authority for exact source-domain slip and fixed-outer-edge slide
planning, atomic command and history, verified timing, persisted-lock refusal,
lazy Framescaper menu state, whole-clip modifier routing, complete previews and
guides, and localized feedback, delivered through commit `c490af3b` on
2026-08-11; and
[3B-4b7 — frame-canonical uniform rate-stretch](milestone-3b-uniform-rate-stretch.md):
one exact rational duration authority with fixed source ranges, verified
CFR/VFR timing, canonical linked A/V persistence, live lock refusal, lazy menu
reachability, existing stretch-handle routing, localized feedback, and a
derived-rate badge, delivered through commit `2bbfa06b` on 2026-08-11. The
canonical gate passed with 5,253 tests total, 5,251 passed and 2 skipped, 90.08%
statement and line coverage, 81.95% branch coverage, 90.58% function coverage,
and a 388,318-byte largest production JavaScript chunk; focused Chromium
exact-timing rate-stretch coverage passed 1/1. The closing slice is
[3B-4b8 — canonical clip-focus trim keyboard parity](milestone-3b-canonical-trim-keyboard.md):
one adjacent-sequence-frame authority for all eight existing focused-clip trim
and stretch key rows, exact linked A/V persistence, live-lock refusal without
legacy fallback, unchanged Soundscaper behavior, and retained local focus. The
Alt access-key conflict was fixed in commit `b0d33c78`, and the complete slice
was delivered through commit `a20cbc0a` on 2026-08-11. Focused Chromium
canonical keyboard coverage and the focused Alt access-key regression each
passed 1/1. The final canonical gate passed with 5,274 tests total, 5,272 passed
and 2 skipped, 90.08% statement and line coverage, 81.97% branch coverage,
90.6% function coverage, and a 388,318-byte largest production JavaScript
chunk. Packet 3B-4 is complete; the immediate next packet is **3B-5 — Retiming,
ramps, and nested sequences**.

- **Outcome:** J/K/L shuttle, edit-point navigation, roll, ripple, slip, slide,
  and rate-stretch tools, track lock and visibility, linked-audio controls, and
  keyboard-complete trim feedback.
- **Invariants:** Trim deltas conform once per operation; slip stays in the
  source domain; locked tracks never move.
- **Acceptance:** The trim matrix, keyboard parity, feedback surfaces, and
  undo/redo behaviour.
- **Non-goals:** No retiming curves, no multicam.
- **Stop condition:** Stop if a trim tool needs a persisted derived cache.

## 3B-5 — Retiming, ramps, and nested sequences

**Status: In progress.** The delivered first slice is
[3B-5a — exact video-retime curve algebra](milestone-3b-exact-video-retime-algebra.md):
one schema-neutral pure compiler, closed-form evaluator, and discrete exact
inverse contract before any persisted ramp revision or maintained workflow.
Its contract landed in `b7d452a5` and its implementation in `fcff5eab` on
2026-08-11. The focused algebra suite passed 11/11; the canonical gate passed
5,286 tests total (5,284 passed, 2 skipped), with 90.1% statement/line, 82%
branch, and 90.64% function coverage. Architecture passed with 887 modules,
2,463 dependencies, and 1,952 maintained files; the build emitted 104
JavaScript chunks with a 388,318-byte largest chunk. No browser row was required
because 3B-5a exposes no maintained workflow.

The delivered second slice is
[3B-5b — V16 video-retime curve persistence and preservation](milestone-3b-video-retime-v16.md):
one retime-only raw schema revision with exact preservation and read-only
admission, implemented in `3fe50815` on 2026-08-11. Its canonical gate passed
with 5,314 tests total (5,312 passed, 2 skipped), 90.14% statement/line, 82.07%
branch, and 90.69% function coverage. Architecture passed with 891 modules,
2,481 dependencies, and 1,963 maintained files; the build emitted 104
JavaScript chunks with `aup4-worker` largest at 400,636 bytes. Focused Chromium
V16 retime compatibility passed 1/1. Packet 3B-5 remains in progress.

The delivered third slice is
[3B-5c — exact clip-bound video-retime runtime mapping](milestone-3b-video-retime-runtime-mapping.md):
one schema-neutral runtime seam for exact forward mapping, inverse occurrences,
and breakpoint partitions before any maintained retime consumer or capability
availability change, implemented in `e826691f` on 2026-08-11. Its canonical
gate passed with 5,322 tests total (5,320 passed, 2 skipped), 90.15%
statement/line, 82.09% branch, and 90.70% function coverage. Architecture
passed with 892 modules, 2,483 dependencies, and 1,965 maintained files; the
build emitted 104 JavaScript chunks with `aup4-worker` largest at 400,686 bytes.
No browser row was required because no maintained consumer uses the seam.
Packet 3B-5 remains in progress.

The reviewed fourth slice and its first implementation are
[3B-5d/3B-5e — native video-retime workflow decomposition and exact frame
dispatch](milestone-3b-native-video-retime-workflow.md). The dependency-ordered
contract landed in `17ffbae3`; exact authenticated CFR/VFR frame dispatch
followed in `23b7fe17` on 2026-08-12. Its canonical gate passed with 5,334 tests
total (5,332 passed, 2 skipped), 90.17% statement/line, 82.09% branch, and
90.73% function coverage. Architecture passed with 893 modules, 2,485
dependencies, and 1,968 maintained files; the build processed 1,180 modules
and emitted 104 JavaScript chunks with `aup4-worker` largest at 400,686 bytes.
The focused algebra/mapper/timing/dispatch review suite passed 31/31. No browser
row was required because no maintained path imports the dormant dispatcher.
Packet 3B-5 remains in progress.

The delivered fifth slice is
[3B-5f — exact output cadence and dormant preview](milestone-3b-video-retime-output-preview.md),
split into a pure cadence/generic queue in `e1e833e0` and a decoder-qualified
HTML adapter in `24a12c73`, both on 2026-08-12. Its canonical gate passed with
5,357 tests total (5,355 passed, 2 skipped), 90.00% statement/line, 82.08%
branch, and 90.75% function coverage. Architecture passed with 896 modules,
2,486 dependencies, and 1,975 maintained files; the build processed 1,180
modules and emitted 104 JavaScript chunks with a 400,686-byte largest chunk.
The focused Node cadence/executor suite passed 23/23 and focused Chromium
passed 4/4, including the unequal final VFR interval. No maintained path
imports this dormant family and there is no capability flip. Packet 3B-5
remains in progress.

The delivered sixth slice's backend-neutral half is
[3B-5g — exact serialized video-retime export intent](milestone-3b-video-retime-export-plan.md).
Contract correction `e905a3dd` removed a dominated decimal sub-cap, then
`b8bfbda5` implemented 3B-5g-a's dormant, JSON-safe,
intersection-bounded V6 intent on 2026-08-12. Its canonical gate passed with
5,368 tests total (5,366 passed, 2 skipped), 90.03% statement/line, 82.04%
branch, and 90.8% function coverage. Architecture passed with 900 modules,
2,494 dependencies, and 1,981 maintained files; the build transformed 1,180
modules and emitted 104 JavaScript chunks with a 400,686-byte largest chunk.
No browser row was required because no maintained consumer imports the dormant
serializer. Packet 3B-5 remains in progress. 3B-5g-b exact execution is
hard-stopped because the pinned FFmpeg Number/rational paths cannot prove the
complete admitted V16 ordinal domain; 3B-5h, every maintained retime consumer,
and the capability flip remain blocked pending a reviewed exact backend or
narrower-domain proof.

- **Outcome:** Explicit retiming and speed ramps over the shared breakpoint
  model, reverse and freeze frames, nested sequences with subsequence time
  mapping, and deterministic flattening. The persisted ramp-curve revision lands
  here.
- **Invariants:** Nested sequences reject cycles and bound depth; composed rate
  conversions reduce before evaluation; ramps integrate in closed form.
- **Acceptance:** The revision fixture set, composed-mapping exactness, and
  flattening determinism.
- **Non-goals:** No optical flow, no audio warp.
- **Stop condition:** Stop if a ramp requires interpolation the shared evaluator
  cannot invert.

## 3B-6 — Proxies, relink, and multicamera

**Status: In progress.** Contract `1d93145b` and implementation `a7f14a47`
delivered
[3B-6a exact video-proxy timing conformance](milestone-3b-video-proxy-timing-conformance.md),
then contract `ce9c4782` and implementation `937e52bf` delivered the dormant
[3B-6b exact proxy relationship proof](milestone-3b-video-proxy-relationship.md)
on 2026-08-12. Contract `26b3bede` and implementation `c195a8c1` then delivered
3B-6c-a1's dormant current-target preparation material on 2026-08-12: exact V17
relationship admission plus one-use retention of the already validated timing
publication in private WeakMap state. The 3B-6b proof spans pre-I/O retime
admission, repository-owned original observation, same-Blob generation,
hashing, exact timing observation, and post-I/O currentness. Its focused Node
suite passed 13/13; both TypeScript configurations and focused lint passed, and
two independent adversarial reviews found no remaining issue. Its canonical
`npm run check` passed with 5,393
tests (5,391 passed and 2 skipped), 90.07% line, 82.01% branch, and 90.86%
function coverage; architecture covered 907 modules, 2,515 dependencies, and
1,992 maintained files; and the build transformed 1,182 modules and emitted
104 JavaScript chunks with a 400,686-byte largest chunk. No browser row was
required because no maintained consumer or UI imports either proof. These
slices add no persistence, capability availability, or compatibility-rule
flip and do not weaken 3B-5's exact-executor hard stop. The c-a1 canonical
`npm run check` passed with 5,736 tests (5,734 passed and 2 skipped), 90.15%
statement and line coverage, 81.66% branch coverage, and 91.29% function
coverage; architecture covered 1,010 modules, 2,789 dependencies, and 2,187
maintained files; and the build emitted 115 JavaScript chunks with a
428,990-byte largest chunk. It added no schema, storage, capability, UI, or
Soundscaper change. Contract `5a59a796`, RED `e9687c0c`, production
`189e901f`, and proof hardening `692fee74` then delivered c-b1's pure dormant
V18 attachment normalizer on 2026-08-12. Its canonical `npm run check` passed
with 5,744 tests (5,742 passed and 2 skipped), 90.17% statement and line
coverage, 81.69% branch coverage, and 91.3% function coverage; architecture
covered 1,011 modules, 2,790 dependencies, and 2,189 maintained files; and the
build emitted 115 JavaScript chunks with a 428,990-byte largest chunk. The
exact three-export module has no maintained consumer and adds no persistence,
preparation consumption, project/schema owner, capability, UI, browser row, or
Soundscaper change. Durable storage and c-c remain hard-stopped on product
isolation.
c-a2 is folded into c-c rather than implemented independently: a
standalone V17 proof lease cannot fence the future all-null V18 base or
authenticate the coordinator's storage-settlement outcome.
The durable pointer moves to V18 because merged take/comp state already owns
V17. Project Bin menu and adaptive-preview lifecycle, then multicamera, follow
the separately reviewed persistence slices.

The reviewed
[3B-6c durable V18 video-proxy attachment](milestone-3b-video-proxy-v18.md)
has delivered its schema-neutral dormant c-a1 preparation slice and pure
dormant
[V18 attachment normalizer](milestone-3b-video-proxy-attachment-normalization.md).
The normalizer consumes no preparation and touches no storage; durable body
staging remains blocked on the product-isolated c-c composition. The remaining
design requires
content-addressed proxy and timing bodies,
atomic pointer publication/rollback, V18 preservation and unavailable
capability, Framescaper-selected `.scape` format 2, and fresh Framescaper
desktop isolation.
The merged shared V17 take/comp wire remains immutable; durable proxy state is
reserved for V18. Soundscaper receives no
profile, capability, UI, browser, or desktop integration in these slices. The
packet explicitly adds no proxy consumer, menu, playback, offline, relink,
delivery, export, or audio behavior. Only the schema-neutral dormant c-a1 and
c-b1 slices are implemented; c-a2 is folded into c-c, and durable storage plus
c-c remain unauthorized. Persistence remains subject to the refreshed V18
blocker review.

- **Outcome:** Proxy attachment with adaptive preview, offline and relink
  handling, and synchronized multicamera groups with sub-frame sync offsets.
- **Invariants:** A proxy never becomes the authoritative source; the planned
  `video-proxy-fallback` compatibility rule flips when proxies land; multicam
  offsets stay sample-canonical.
- **Acceptance:** Proxy lifecycle, offline degradation, relink identity, and
  multicam sync fixtures.
- **Non-goals:** No cloud media, no automatic sync detection beyond the
  recorded offsets.
- **Stop condition:** Stop if relink cannot prove source identity.

## 3B-7 — Exit evidence

- **Outcome:** Close the Framescaper roadmap bullets only after all native
  workflows, compatibility registrations, cross-product preservation paths,
  accessibility flows, and performance budgets have current evidence.
- **Invariants:** Evidence records observed results without converting deferred
  WebKit or pending external Electron rows into passes. The canonical
  non-browser gate stays green on every commit.
- **Acceptance:** The qualified suites pass on their qualified matrices, and
  video stays frame-accurate across integer, NTSC, VFR, nested, proxy, and
  source-timecode fixtures without cumulative A/V drift.
- **Non-goals:** No claims for unexecuted package matrices, no WebKit promotion.
- **Stop condition:** Stop closure on any unavailable Framescaper capability,
  unregistered owned state, failing qualified runtime, or missing measurement.

## Closed contracts for 3B-1

These were open questions at pickup and are closed here so the implementation
and its review share one contract.

1. **Nominal timecode rate.** A sequence's timecode counts
   `ceil(rate.num / rate.den)` labels per timecode second, computed by exact
   integer division. This is the same bound `validateStartTimecode` already
   applies to the persisted `startTimecode.frames` field, so the label domain
   and the persisted domain cannot diverge.
2. **Drop-frame rule.** Drop frame is legal only at 30000/1001 and 60000/1001,
   as the foundation validator already requires. Two labels per minute (four at
   the doubled rate) are skipped except on minutes divisible by ten. Hours are
   not wrapped at 24; a sequence longer than a day keeps counting.
3. **Position to label.** A sample position maps to the sequence frame that
   contains it: the unique frame whose resolved `point` boundary is at or before
   the sample and whose successor's boundary is after it. The estimate comes
   from exact rational division and is corrected against the resolved
   boundaries, because `point` rounding can move a boundary either way.
4. **Rate change conformance.** Changing a sequence rate preserves wall-clock
   placement, not frame indices. Each video clip in the sequence conforms both
   of its resolved absolute boundaries once onto the new grid with `point`
   rounding, and its extent is the difference of the conformed boundaries — with
   a one-frame floor so no clip collapses. Source ranges are untouched. Linked
   audio is recomputed from the conformed video endpoints by the existing
   reconciliation boundary, and a Project Bin audio partner takes the conformed
   video duration so bin pairs stay aligned.
5. **Start timecode across a rate change.** The label is the user's intent and
   is preserved. It is conformed only when it becomes illegal at the new rate or
   drop-frame combination: an out-of-range frame field clamps to the last legal
   frame, and an illegal drop-frame label advances to the next legal label.
6. **Snapping and stepping.** Sequence-frame navigation is a separate primitive
   from the Audacity snap grid, whose eighteen pinned upstream types stay
   untouched. Stepping resolves the containing frame, adds the signed frame
   count, and resolves the new boundary from the absolute origin, so repeated
   steps cannot accumulate error.
7. **Source timecode scope.** Until 3B-2 probes it, a source's timecode origin
   is zero, and the surface labels a clip's source position as a source-frame
   timecode at the source's own rate. No zero origin is persisted, so nothing
   has to be un-fabricated later.
8. **Registration.** Sequence timing needs no new capability: the foundation
   registered `org.soundscaper.capability.sequence-timing` with the
   `framescaper.sequence-timing` owned requirement, whose predicate already
   fires on a non-default rate, a drop-frame flag, or a non-zero start timecode.
   Making that state editable is what turns the existing registration into a
   reachable one. It needs no compatibility rule either: both products register
   the capability available, so no degradation path changes and the existing
   current-schema editing rule already covers the state this packet edits.

## Global fences

MIDI schema, ports, flags, devices, editing, and UI are out of scope through
milestone 7. Framescaper recording is milestone 8A. DAWproject, OTIO, and
FCPXML exporters are out of scope; milestone 3 only records what milestone 6
needs. New document types cannot be smuggled through opaque extension fields,
lane groups, or mixer groups.
