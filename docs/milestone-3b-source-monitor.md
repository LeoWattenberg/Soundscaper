# Milestone 3B-3b: the source monitor, marking, replace, and match-frame

> Slice-level pickup decomposition for the second half of
> [3B-3](milestone-3b-work-packets.md#3b-3--monitors-and-three-point-editing),
> picking up exactly what
> [3B-3a](milestone-3b-three-point-editing.md#slice-boundary) deferred: the
> monitors, the source in and out marks they make reachable, replace, and
> match-frame. Grounded against the repository on 2026-08-10; every file and
> line reference below was read, not inferred.

## What the foundation already provides

- **The program monitor already exists.** `VideoPreviewPanel`
  (`ui/workspace/VideoPreviewPanel.jsx:174`) composites the sequence at the
  transport playhead, through the same layer resolution the export uses. It has
  a playhead (the transport's), a transport (the global one), and marks (the
  time selection, which 3B-3a already reads as the sequence in and out). This
  slice therefore builds **one** new monitor, and the parity 3B-3 asks for is
  parity of *affordances*, not a second compositor.
- **The three-point resolver already accepts source marks.**
  `resolveThreePointEdit` (`three-point-edit.ts:83`) takes all four points and
  resolves whichever one is missing; 3B-3a simply never had marks to give it and
  passed the whole source instead (`controller/video-edit-service.ts:99-103`).
  Marking is the missing input, not a missing rule.
- **The frame under the playhead is already computed.**
  `resolveSourceTimecodeAtSample` (`source-properties-model.ts:110`) maps a
  sample position to a sequence frame, finds the video clip whose range contains
  it, and adds the offset to that clip's source in point. That is match-frame
  arithmetic, already shipped as a readout.
- **A duration already converts once, as a count.** `convertFrameCount`
  (`three-point-edit.ts:134`) is the change of basis replace needs to size a
  source range from a sequence extent.
- **Overwrite already lifts a range and places into it.**
  `overwriteThreePointEdit` (`commands/three-point-edit-runtime.js:100`)
  conforms once per sequence and disturbs only the lanes it lands on.
- **Session state has a precedent.** Folder selection
  (`controller/track-folder-service.ts:62`) and edit targeting
  (`controller/video-edit-service.ts:71`) are both held in the controller and
  never persisted.

What is missing is a surface that addresses a source by its own frame grid, the
marks that surface sets, and the two operations defined against a playhead.

## Slice boundary

This slice delivers **a source monitor with its own playhead and marks, the
marks feeding the edit already built, replace, and match-frame**, reachable
through the real product.

It closes packet 3B-3. What it does not do — trim tools, shuttle, edit-point
navigation — was never in this packet and belongs to 3B-4.

## Contracts closed before code

1. **The source monitor's playhead lives in source frames.** The monitor
   addresses one video source on that source's own grid: an integer in
   `[0, sourceFrameCount - 1]`. The media element's `currentTime` is a
   *rendering* of that position, converted through the shared time module, and
   never the authority. A decoder that lands between frames, or a browser that
   rounds a seek, therefore cannot move a mark — which is the whole reason the
   position is not kept in seconds.
2. **Marks are a range, and the range is always legal.** A mark pair is two
   source frames with `in < out`, both inside the source. Setting an in at or
   after the current out clears the out, and setting an out at or before the
   current in clears the in — rather than swapping them, which would silently
   invent a range the user did not mark, or refusing, which would make the
   newest mark the one that loses. With neither mark set the monitor offers the
   whole source, which is exactly what 3B-3a already edits with, so marking
   changes what an edit uses without changing how it resolves. Marks belong to
   the item they were set on: editing a different item reads no marks at all
   rather than borrowing somebody else's range.
3. **Monitor state is a working choice, like targeting.** It is held in the
   controller and never persisted: reopening a project restores no playhead and
   no marks, because the document does not owe anyone a scrub position. It
   names a Project Bin item, and when that item is gone the monitor answers
   empty rather than pointing at media that no longer exists.
4. **The edit hands the resolver exactly the points that are marked.** Two
   source marks and a sequence selection with width are four points, and the
   resolver refuses them as over-specified unless they agree
   (`three-point-edit.ts:205`). This slice does not fix that by dropping one:
   four disagreeing points mean "fit this much source into that much
   programme", which is a speed change, and retiming is 3B-5. The refusal says
   so, and clearing either mark makes the edit resolve.
5. **Match-frame and the source-timecode readout answer with the same frame.**
   Two surfaces disagreeing about which frame of which source you are on is
   exactly the drift this milestone forbids. Match-frame needs more than the
   readout returns — the clip's own range, for replace — so it is a second
   resolver, and a test asserts the two agree on the same document rather than
   trusting that they were written to. Where a targeted video lane holds a clip
   under the playhead, that lane wins; the readout takes document order, and the
   monitor discloses which clip it matched.
6. **Match-frame adopts the matched clip's source range as the marks.** The
   position is the matched frame; the marks are the clip's own in and out. So
   the operation answers "where did this frame come from" *and* leaves the
   monitor holding exactly the material that clip uses, which is what makes a
   match-frame useful for re-editing rather than merely informative.
7. **Replace is overwrite over the target clip's own range.** It introduces no
   new command type and no second conforming rule: the sequence range is the
   matched clip's resolved range, so placement and extent are preserved
   exactly, and the source range starts at the monitor's playhead and takes that
   extent converted once as a count. Only the media changes. A source that
   cannot supply that many frames from the playhead refuses the edit, on the
   3B-3a rule — the user is asking for frames that do not exist, so nothing is
   clamped.
8. **A named primitive gets a matrix cell.** `replace` is added to
   `foundation-edit-coordinate-matrix.ts` with its own row, saying that its
   range comes from the clip it replaces rather than from a selection, and
   citing both the controller service and the overwrite runtime it reuses. The
   packet's stop condition is exactly this: a primitive needing a second
   conforming rule beyond its cell would end the slice.
9. **No schema revision, no new command type, and no new capability.** The
   monitor is session state; replace is `edit/overwrite` with a derived range;
   marks are inputs to arithmetic that already exists. The single in-flight
   revision slot stays free.

## Commit sequence

Each step is independently green under the canonical gate.

### S1 — This decomposition

No code. Records what the foundation already provides, the slice boundary, and
the nine contracts.

### S2 — The model

`source-monitor-model.ts`: the pure rules — clamping a position, stepping it,
the mark pair of contract 2, the range an edit reads from it, and the program
frame that match-frame and replace both resolve. Table-driven tests over every
mark transition, both NTSC and integer rates, and the agreement with
`resolveSourceTimecodeAtSample`.

### S3 — The service

A controller service holding the open item, the position, and the marks, with
the invalidation a removed bin item forces. Session state, no document change.
Wired into the action facade and the composition root.

### S4 — Marks feed the edit

`video-edit-service` reads the monitor's range instead of assuming the whole
source, and surfaces the four-point refusal of contract 4.

### S5 — Replace

Resolve the program frame, derive the target clip's range, size the source
range once, and commit one `edit/overwrite`. Plus the `replace` matrix row.

### S6 — The surfaces

A source monitor panel with the media, a source-frame playhead, a transport,
the two mark controls, and match-frame; a Project Bin action that opens an item
into it; and a replace action beside them. All focusable controls, so all
reachable by pointer and by keyboard.

### S7 — Browser proof

Open a bin item into the monitor, mark a range, overwrite with it, match-frame
back from the programme, and replace — through the real product — proving the
resulting document each time, and prove that clearing the marks puts the whole
source back in the edit.

**What this could not prove in a browser, and why.** Contract 4's four-point
refusal needs a time selection with width. Neither a ruler drag nor the Select
menu's *Select all* left a persisted selection this spec could observe, so
reaching that refusal through the product would have meant qualifying the
timeline's selection surface rather than the monitor's. The refusal is proved
against the controller instead (`a marked range and a selection of another
length refuse rather than change speed`), and that refusals reach the user as a
visible error is already qualified by the 3B-3a spec. A browser proof of the
four-point path belongs with whatever packet next touches time selection.

### S8 — Status, matrix, gates

The matrix row, roadmap and packet status, maintainability ratchets, and the
canonical gate.

## Concurrency

The Soundscaper track works in the same tree. This slice owns the source
monitor model, its service, its panel, and the replace path. It touches the
shared workspace panel registry only by appending one panel, the edit
coordinate matrix by adding one row, and the shared copy module by adding keys.
It changes no schema, no command protocol, no capability register, and no
compatibility rule.

## Non-goals

- No four-point edit: fitting a marked source range into a differently sized
  programme is a speed change, and retiming is 3B-5.
- No second video compositor; the program monitor is the existing preview panel
  with the global transport and the time selection.
- No audio-only source monitoring. A bin item's audio member already previews
  through the Project Bin, and an audio-only item would introduce a third rate
  pair — the same reason 3B-3a excluded audio-only three-point editing.
- No J/K/L shuttle or edit-point navigation (3B-4).
- No global shortcuts or application-menu entries; the affordances are focusable
  controls beside the material they act on.
- No mark-driven sequence navigation (go to sequence in/out); the time selection
  already carries those points.
- No proxy, offline, or relink behaviour in the monitor (3B-6).

## Stop conditions

- Stop if replace needs a conforming rule beyond overwrite's cell.
- Stop if the monitor playhead has to be persisted to be usable.
- Stop if match-frame and the source-timecode readout cannot be made to agree.
- Stop if marking requires the media element's clock to become the authority.
