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

The delivered first two slices are
[3B-4a — shuttle and edit-point navigation](milestone-3b-shuttle-navigation.md):
session-only J/K/L shuttle and strict previous/next video edit-point navigation
through the existing Transport menu and Framescaper workspace keys; and
[3B-4b1 — linked audio and video visibility controls](milestone-3b-linked-audio-visibility.md):
application-menu Link/Unlink for one exact timeline A/V pair and Show/Hide for
the selected video track, using the existing undoable persisted commands. Packet
3B-4 remains in progress: the frame-canonical trim planner, track locking,
roll/ripple/slip/slide, uniform rate-stretch, and keyboard-complete trim feedback
remain.

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
