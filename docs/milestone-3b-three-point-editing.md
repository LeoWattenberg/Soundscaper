# Milestone 3B-3a: three-point editing

> Slice-level pickup decomposition for the first half of
> [3B-3](milestone-3b-work-packets.md#3b-3--monitors-and-three-point-editing).
> This slice owns the arithmetic and the document mutation: resolving the fourth
> point once, choosing which tracks receive, and the insert and overwrite
> primitives. The monitors that make every mark reachable are 3B-3b. Grounded
> against the repository on 2026-08-10; every file and line reference below was
> read, not inferred.

## What the foundation already provides

The edit machinery this slice needs mostly exists, in pieces built for other
operations.

- **Conform once per sequence.** `resolveRangeSequenceGeometry`
  (`commands/range-sequence-geometry.ts:30-74`) resolves one sample span per
  sequence, snapped to that sequence's video grid whenever a targeted video
  track participates, and hands every targeted lane the same span. That is the
  matrix's operation-level conformance rule, already implemented.
- **Lift and ripple over a track range.** `processTrackRange`
  (`commands/range-runtime.js:89-156`) splits the clips a range crosses, keeps
  or shifts the survivors, and rebuilds the track order. Lift and extract — two
  of the primitives 3B-3 names — are `range/lift-delete` and
  `range/ripple-delete` over exactly this helper.
- **Lift-then-place from a source.** `punchReplace`
  (`commands/range-runtime.js:450-469`) already replaces one track's range with
  a range of an existing source. A three-point overwrite is that shape,
  generalized from one track to a targeted A/V pair.
- **Lane-group partner resolution.** Import already finds the audio track that
  belongs with a video track through `laneGroupId`
  (`controller/source-import.ts:387-398`).

What is missing is the arithmetic that decides *which* range, the state that
decides *which* tracks, and an insertion that opens a hole rather than closing
one.

## Slice boundary

This slice delivers **editing from the Project Bin into a targeted sequence**:
the three-point resolver, explicit track targeting, and the `edit/insert` and
`edit/overwrite` primitives, reachable through the real product.

Three things stay with **3B-3b**:

1. **Source and program monitors.** Their transports, their own playheads, and
   the marking affordances that come with them.
2. **Source in and source out marks.** Without a source monitor there is no
   scrub position to mark from, so this slice edits from a bin item's whole
   source range and the resolver's backtimed combinations stay exercised by
   unit tests rather than by a workflow. Marking is 3B-3b's first job.
3. **Replace and match-frame.** Both are defined against the frame under a
   monitor's playhead, so both follow the monitors.

Lift and extract are not re-implemented: they already exist as `range/lift-delete`
and `range/ripple-delete`, and 3B-3b routes the monitor's own affordances to
them rather than adding a second way to delete a range.

## Contracts closed before code

1. **Exactly three of four points; the fourth is resolved once.** The points are
   source in, source out, sequence in, sequence out. A request supplies exactly
   three. Fewer is under-specified and is rejected; four are accepted only when
   the fourth agrees exactly with what the other three imply, and otherwise
   rejected rather than silently preferred. All four combinations resolve
   through one rule, so a backtimed edit is not a second code path.
2. **A duration converts once, as a count, and never endpoint by endpoint.**
   Source frames and sequence frames are different grids at different rates.
   Converting each endpoint separately would let the same source range produce a
   different extent depending on where in the source it starts. So the resolver
   converts the *count* of the fully specified pair once, from the origin,
   through the shared time module's named policies, and adds it to the specified
   endpoint of the other pair. The same N source frames therefore always yield
   the same sequence extent.
3. **A resolved range is admitted against the media it names.** The source range
   must lie inside the source's own frame count and keep at least one frame; a
   sequence range must keep at least one sequence frame. A request that resolves
   outside its media is rejected, not clamped: unlike the re-import upgrade,
   where clamping preserved an edit the user already made, here the user is
   asking for material that does not exist.
4. **Targeting is a working choice, and working choices are session state.**
   Which tracks receive an edit is not a fact about the document — reopening a
   project does not owe the user the target they had — so targeting lives in the
   controller beside the folder selection (`controller/track-folder-service.ts:62`)
   rather than in the schema. It resolves to at most one video and one audio
   track per sequence, because ingest extracts exactly one audio program (3B-2a
   contract 5). With nothing explicitly targeted it falls back to the selected
   track and its lane-group partner, which is the rule import already applies.
5. **An A/V pair lands as one operation or not at all.** When the bin item
   carries linked audio and both targets exist, both clips land in one command
   with a shared A/V link, and the audio's placement is derived from the video's
   conformed endpoints rather than converted independently — the foundation A/V
   rule carried forward. When only one target exists, only that member lands and
   the result says which member was dropped, so a half-placed edit is never
   silent.
6. **Insert and overwrite are two directions of one conformance rule.**
   Overwrite lifts the resolved sequence range on the targeted lanes and places
   the new material in it. Insert splits at the conformed insert point, shifts
   every clip at or after it right by the conformed duration, and then places.
   Both resolve their span once per sequence through
   `resolveRangeSequenceGeometry`, so a video clip and its linked audio move by
   exactly the same resolved span.
7. **A new primitive gets a matrix cell, not a reinterpretation of an old one.**
   `insert` and `overwrite` are added to
   `foundation-edit-coordinate-matrix.ts` with their placement, extent,
   source-range, and operation-conformance rules and the files that implement
   them. The packet's stop condition is exactly this: a primitive that needed a
   second conforming rule beyond its cell would end the slice.
8. **No schema revision and no new capability.** Insert and overwrite produce
   ordinary clips in domains the foundation already defines and validates;
   targeting is session state. The single in-flight revision slot stays free.

## Commit sequence

Each step is independently green under the canonical gate.

### S1 — This decomposition

No code. Records what the foundation already provides, the slice boundary, and
the eight contracts.

### S2 — The resolver

`three-point-edit.ts`: from a source rate, a sequence rate, a project sample
rate, and any three of the four points, resolve the fourth once and admit the
result against the source's frame count. Pure module, table-driven tests over
all four combinations, both NTSC and integer rates, and every rejection.

### S3 — Targeting

A controller service holding the targeted video and audio track per sequence,
with the lane-group fallback of contract 4 and the invalidation a removed track
forces. Session state, no document change.

### S4 — The commands

`edit/insert` and `edit/overwrite` in the protocol, the clip/range/clipboard
domain, and its runtime: conform once per sequence, lift or open, place the
resolved clips, and assert the result against the source bounds the validator
already enforces.

### S5 — The controller service

Resolve the bin item, the targets, and the points from the live document; plan
through S2; commit one command; and refuse — typed — when nothing is targeted,
when the bin item is missing, or when the resolved range does not fit.

### S6 — The surfaces

A targeting toggle on the track head beside the existing arm control
(`ui/timeline/TrackControls.jsx:121-131`), and the insert and overwrite actions
reachable by pointer and keyboard.

### S7 — Browser proof

Target a video track, select a bin item, insert at the playhead and overwrite
into a time selection through the real product, and prove the resulting document
— placement, extent, source range, A/V link — and its undo.

### S8 — Status, matrix, gates

The two matrix rows, roadmap and packet status, maintainability ratchets, and
the canonical gate.

## Concurrency

The Soundscaper track works in the same tree. This slice owns the three-point
resolver, the targeting service, the two new commands and their runtime, and the
track-head targeting control. It touches the shared command protocol only by
appending, and the edit-coordinate matrix by adding two rows. It changes no
schema, no capability register, and no compatibility rule.

## Non-goals

- No source or program monitor, no source in/out marking, no match-frame
  (3B-3b).
- No replace primitive (3B-3b, which owns the monitor playhead it is defined
  against).
- No second implementation of lift or extract.
- No trim tools, shuttle, or edit-point navigation (3B-4).
- No multi-target editing: one video and one audio target per sequence.
- No audio-only three-point editing. The edit is driven by a bin item's video
  member, so the two domains are always source frames and sequence frames; an
  audio-only item would introduce a third rate pair and belongs with whatever
  packet needs it.
- No retiming; an inserted range plays at its own rate.

## Stop conditions

- Stop if a primitive needs a second conforming rule beyond its matrix cell.
- Stop if resolving the fourth point requires converting endpoints separately.
- Stop if targeting has to be persisted to be usable.
- Stop if an A/V pair would have to land in two commands.
