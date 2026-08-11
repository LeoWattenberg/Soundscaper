# Milestone 3B-4a: shuttle and edit-point navigation

> Slice-level pickup decomposition for the first half of
> [3B-4](milestone-3b-work-packets.md#3b-4--trim-tools-and-shuttle-navigation).
> This slice takes the packet's schema-neutral transport and navigation work;
> 3B-4b keeps every document mutation and track-control change. Grounded against
> the repository on 2026-08-11; every file and line reference below was read,
> not inferred.

## What the foundation already provides

- **Sequence-frame navigation is already exact.** `sequenceFrameAtSample`,
  `sequenceFrameBoundarySample`, `snapSampleToSequenceFrame`, and
  `stepSampleBySequenceFrames` (`sequence-frame-navigation.ts:20-90`) resolve
  every boundary from the absolute origin. The sequence timing service already
  uses them to step and seek the program playhead (`controller/sequence-timing-service.ts:76-92`).
- **The engine already has the two playhead ports this slice needs.** Ordinary
  `seek` clamps and publishes a position (`engine/transport-control.ts:191-203`),
  while `scrub` publishes the requested position before asynchronously auditioning
  a bounded forward frame (`232-303`). `endScrub` keeps that position (`306-313`).
  In contrast, the ordinary `stop` operation resets the playhead to zero
  (`181-188`), so it cannot implement the K key's hold-at-frame contract.
- **Controller actions already narrow those ports.** The transport facade exposes
  `seek`, guarded `scrub`, and `endScrub` (`controller/action-facade.ts:261-276`),
  and the composition root already has injectable clock and cancellable-timer
  seams for controller-owned work (`app.js:370-374`). Its current `now` default is
  a wall clock, so the shuttle still needs a dedicated monotonic clock port; no
  engine API has to grow to make that controller clock move the playhead.
- **The runtime projection is the timing surface.**
  `resolveRuntimeProjectProjection` (`runtime-clip-projection.ts:117-165`) gives
  consumers resolved sample boundaries while retaining each video clip's
  sequence-frame boundaries. The older clip-selection navigation service already
  demonstrates nearest-boundary search and deterministic document ordering
  (`controller/clip-selection-navigation-service.ts:164-268`), but it searches
  audio tracks only (`205-247`) and is not wired into the controller. It is a
  precedent, not the video rule this slice needs.
- **Edit targeting is already session state.** `resolveVideoEditTargets`
  (`video-edit-targeting.ts:40-79`) makes an explicit target complete and otherwise
  inherits the selected track and its lane-group partner. `videoEditService.targets`
  exposes that result through the action facade (`controller/action-facade.ts:190-201`).
- **Video visibility already exists, but track locking does not.** Video tracks
  persist `hidden`, the current control toggles it (`ui/timeline/VideoTrackRow.jsx:368-381`),
  and no current track wire type, validator, or command has a `locked` field. This
  slice can truthfully exclude hidden tracks. It cannot claim to exclude locked
  tracks until 3B-4b defines and implements the lock itself.
- **The workspace and menu already have the two allowed surfaces.**
  `AudioEditorWorkspaceView` carries `productId` and sends keyboard events through
  `handleWorkspaceKeyboard` (`ui/workspace/AudioEditorWorkspaceView.jsx:94-114`),
  which already yields to editable and local-control contexts
  (`ui/workspace-shortcuts.ts:45-60`). The existing Transport menu
  (`ui/application-menus.js:370-380`) is already pointer- and keyboard-reachable
  and can conditionally render Framescaper items. It, rather than an always-visible
  workspace addition, is where this slice's explicit commands belong.

What is missing is one controller-owned shuttle clock, a video edit-point
resolver, and Framescaper surfaces that reach both without making the engine,
the document, or Soundscaper pretend to have a new transport mode.

## Slice boundary

This slice delivers **J/K/L shuttle and previous/next video edit-point
navigation on the active sequence's program playhead**, through a conditional
submenu in the existing Transport menu and the Framescaper keyboard surface.
The source monitor remains independent and does not receive these keys.

It is **3B-4a** and leaves 3B-4 in progress. **3B-4b** owns roll, ripple, slip,
slide, rate-stretch, keyboard-complete trim feedback, track locking, completion
of track-visibility semantics, and linked-audio controls. The existing `hidden`
flag is read here; no new visibility or lock state is authored here.

## Contracts closed before code

1. **Shuttle is controller session state, not transport or document state.** One
   private service holds `idle` or a direction, a rate rung, an anchor sequence
   frame, an anchor clock value, and a cancellable scheduled callback. Reopen
   restores none of it; shuttle does not dirty the project, enter history, save,
   clone, copy, or hand off. Its frozen view is published only so the menu items
   can report direction and rate.
2. **The rate ladder is finite and key presses are deterministic.** The signed
   ladder is `-8x, -4x, -2x, -1x, 0, +1x, +2x, +4x, +8x`. Every accepted J moves
   exactly one adjacent rung toward `-8x`; every accepted L moves one toward
   `+8x`; both saturate at the end. Thus J from idle starts `-1x`, repeated J
   accelerates, and L from `-1x` stops at `0` before the next L starts `+1x`.
   Browser-generated `keydown` events with `repeat === true` are ignored: each
   rung is one deliberate key press or menu activation, not a platform repeat-rate
   accident. Every non-zero rung change captures the current resolved boundary and
   current clock as a new anchor, so changing speed cannot retroactively move
   elapsed time. K moves directly to `0`, leaves the playhead where it is, and
   returns the service to idle.
3. **Elapsed time is evaluated from one absolute anchor.** The service receives
   an injected monotonic clock plus schedule/cancel ports. A tick derives the
   magnitude as `floor(max(0, now - anchor) * rate numerator * abs(rung) /
   (1000 * rate denominator))`, then applies the rung's sign. It never adds a
   per-tick sample delta and never rounds through seconds.
   `stepSampleBySequenceFrames` applies that signed total to the anchor. The legal
   range is zero through the greatest sequence boundary at or before the current
   `editorTimelineDurationFrames`; reaching either end publishes that boundary and
   retires the shuttle instead of leaving a timer spinning. Late or irregular
   callbacks therefore reach the same frame as an on-time callback at the same
   clock value. Starting or changing direction conforms the current playhead to
   its nearest sequence boundary once; every published shuttle position is on the
   sequence grid, and a callback whose derived frame has not changed issues no
   redundant scrub or seek.
4. **Reverse is descending scrub, not reversed media.** Each shuttle tick uses
   the existing scrub port when the project can audition and the seek port when
   audition is unavailable; reverse supplies descending frame boundaries to the
   same ports. The engine's scrub audition is a short forward slice from each
   requested position (`engine/transport-control.ts:255-298`), so this slice
   claims responsive picture and playhead shuttle with sampled audio feedback,
   not continuous backwards audio. It creates no reversed source, cache, proxy,
   or persisted retime. K ends the scrub and pauses ordinary playback at its
   current frame; it never calls the zero-resetting engine `stop` merely to halt
   shuttle.
5. **Only one playhead owner remains active.** Starting J or L pauses ordinary
   playback at its current position, cancels pending play-at-speed preparation,
   and ends any prior scrub before installing the shuttle session. Ordinary play,
   play-at-speed, seek, scrub gestures, recording preparation, project switch,
   sequence-rate change, controller disposal, and a successful edit-point jump
   cancel the shuttle first. Every callback captures a session generation and
   project/sequence identity; a cancelled or late callback cannot seek, scrub,
   publish state, or restart its timer. At most one tick action is in flight, and
   the next callback is scheduled only after its scrub or seek settles. A scrub
   rejection is handled through the controller error boundary and retires that
   session rather than becoming a floating promise.
6. **An edit point is a distinct video boundary on the active sequence.** The
   resolver reads the runtime projection and the active sequence's `trackIds`,
   considers timeline video clips only, and groups each clip's start and end by
   integer sequence frame. Project Bin clips, audio boundaries, annotations,
   source in/out points, and the padded empty timeline are not edit points. A
   track with `hidden === true` contributes none. There is no lock predicate in
   3B-4a because no lock fact exists; 3B-4b adds `locked === true` to this same
   eligibility boundary atomically with the lock command and control.
7. **Explicit target, then selection, then visible sequence tracks determines
   scope.** An explicit video edit target is complete: when it is present, that
   one eligible lane is searched, and a missing or hidden explicit target returns
   no point rather than quietly falling back. With no explicit target, an
   eligible selected video track — or the selected audio track's eligible video
   lane-group partner — is searched. Only when selection resolves no eligible
   video lane does navigation search every visible video track in sequence order.
   This carries the targeting rule users already learned in 3B-3 instead of
   creating a second meaning for a target.
8. **Direction is strict and ties are one point.** Previous chooses the greatest
   boundary sample strictly before the playhead; next chooses the least strictly
   after it. A playhead exactly on a cut therefore moves past that cut, while an
   off-grid playhead may return to the containing frame's start when moving
   backwards. Equal sequence frames across lanes, or an outgoing end and incoming
   start at one cut, are one navigation point. Its diagnostic hit list is ordered
   by sequence track order, project clip order, start before end, then stable ID;
   the playhead result is independent of which tied hit is first. Navigation does
   not wrap at either end.
9. **Navigation moves only the program playhead.** Previous/next first cancel an
   active shuttle, seek once to the resolved boundary sample, and return a frozen
   result carrying the sequence frame, sample, formatted sequence timecode, and
   ordered hits for accessible feedback. They do not change the time selection,
   selected clip, selected track, edit target, source monitor, or document. With
   no point in the requested direction they leave everything untouched and report
   that boundary rather than jumping to zero or the project end.
10. **Pointer and keyboard call the same actions, in Framescaper only.** The
    existing Transport menu gains a Framescaper-only **Shuttle and edit points**
    submenu with Previous edit, Reverse shuttle, Shuttle stop, Forward shuttle,
    and Next edit items. Reverse is checked and includes the active absolute rate
    only at a negative rung; Forward does the same only at a positive rung; Stop
    is checked at `0`. Activations update the
    existing status message with direction, rate, and sequence timecode while the
    existing program timecode remains the position readout; no new default-visible
    surface is added. Unmodified J/K/L
    invoke reverse/stop/forward; unmodified Up/Down invoke previous/next only when
    the event reaches the workspace root. A focused input, slider, menu, or other
    local Arrow-key handler wins by preventing or consuming the event first.
    Framescaper reserves J/K/L before generic preference matching,
    so its existing L binding for Loop cannot fire or be advertised there; Loop
    remains a focusable menu command. Soundscaper keeps its current L-to-Loop
    behavior and gains none of these fixed video-editor keys.
11. **No schema revision, serializable command, or compatibility capability.**
    Shuttle state, navigation scope, and feedback are transient controller/UI
    facts. The edits they inspect are ordinary registered sequence/video state,
    and the only mutation is the engine playhead. The single schema-revision slot,
    command protocol, product capability register, and compatibility policy stay
    untouched.

## Commit sequence

Each step is independently green under the canonical gate.

### S1 — This decomposition

No code. Records what the foundation already provides, the slice boundary, the
eleven contracts, and the current absence of any lock state.

### S2 — The shuttle clock model

`video-shuttle-model.ts`: the pure signed-ladder transitions and the absolute
elapsed-time-to-sequence-frame calculation. Table-driven tests cover every key
transition, ignored key repeat, integer and NTSC rates at 44.1 and 48 kHz,
irregular timer cadence, unchanged-frame callbacks, both boundary retirements,
safe-integer refusal, and ten thousand observations without cumulative drift.

### S3 — The edit-point model

`video-edit-point-navigation.ts`: collect, scope, group, order, and select the
previous or next distinct boundary under contracts 6-8. Pure fixtures cover an
explicit target, selected video, selected audio lane partner, all-track fallback,
hidden lanes, coincident cuts, overlap ties, off-grid pivots, empty directions,
and deterministic results after save-shaped cloning.

### S4 — The controller service

A focused strict-TypeScript service owns the injected clock, timer, generation,
project/sequence identity, shuttle view, and navigation actions. It coordinates
pause, scrub/seek, error handling, teardown, and the existing sequence timing and
video-target ports without importing React or persisting state.

### S5 — Composition and transport ownership

Wire the service into the composition root and action facade; expose its frozen
view and five actions; and make every competing transport/project lifecycle path
retire it before taking the playhead. Unit tests use a fake clock and scheduler
and prove cancellation, project/rate invalidation, serialized scrub settlement,
missing-media seek fallback, boundary retirement, and dispose cleanup.

### S6 — The Framescaper menu and shortcuts

Append the conditional five-item submenu to the existing Transport menu, including
dynamic checked/rate state, shortcut labels, and existing status/timecode feedback.
The product-scoped workspace shortcut layer routes deliberate J/K/L presses and
Up/Down to the same actions, removes the misleading Framescaper L-to-Loop
label/dispatch, and leaves Soundscaper and local menu/roving-control keys unchanged.
No default-visible control or workspace customization is part of the slice.

### S7 — Browser proof

A real Framescaper workflow uses the Transport submenu to start forward shuttle,
accelerate it, step back through `0`, stop without resetting, and reverse, proving
every observed playhead position is a sequence boundary. Through both menu items
and keys it navigates a two-lane fixture with a coincident cut and a hidden lane,
then proves explicit-target and selected-lane precedence, no wrap, dynamic
checked/rate state, accessible status/timecode feedback, and undo history and the
canonical document unchanged. It also proves held-key repeat does not accelerate,
L does not toggle Loop in Framescaper, focused menu/local controls retain their
Arrow behavior, no new default-visible control appears, and the maintained
Soundscaper shortcut still toggles Loop.

The source-monitor slice left one browser proof for four disagreeing edit points
because the real time-selection surface could not establish the required range
(`milestone-3b-source-monitor.md:163-171`). This slice moves only the playhead and
does not change that selection surface, so it does not claim that proof; 3B-4b
inherits it if its trim workflow makes the range reachable.

### S8 — Status, evidence, gates

Link this decomposition from the 3B packet, move the roadmap's 3B-4 bullet to
**In progress** naming 3B-4b as the remainder, update maintainability ratchets,
and run the focused Node suites, build, browser workflow, and canonical gate.
Do not mark 3B-4 Implemented while any trim or track-control outcome remains.

## Concurrency

The Soundscaper track works in the same tree. This slice owns two pure video
navigation modules, one controller service, its action-facade composition, and
the Framescaper menu items and shortcut routing. It touches shared application-menu,
copy, and maintainability files narrowly. It changes no workspace layout,
document schema, command protocol/runtime, capability or compatibility register,
engine public API, trim command, or track wire type.

## Non-goals

- No roll, ripple, slip, slide, rate-stretch, trim gesture, or trim feedback
  (3B-4b).
- No track-lock field, command, control, or lock-aware navigation claim (3B-4b).
- No new track-visibility control or inherited visibility model; this slice only
  reads the existing video-track `hidden` flag (3B-4b completes the packet's
  visibility outcome).
- No linked-audio edit control or trim propagation (3B-4b).
- No continuous reverse audio, pitch preservation, audio time-stretch, persisted
  reversed media, or reverse render path.
- No four-point fit, retiming curve, reverse/freeze-frame document state, or
  nested sequence (3B-5).
- No edit-point selection range, mark-driven sequence navigation, loop-shuttle
  mode, wrapping navigation, or shuttle across more than the active sequence.
- No Soundscaper shortcut or transport-surface change beyond preserving its
  existing behavior in regression coverage.
- No new default-visible panel, side rail, badge, or inline control; the existing
  Transport menu is the opt-in and reachability surface.

## Stop conditions

- Stop if shuttle progression would accumulate tick deltas instead of resolving
  from one absolute clock anchor and the sequence origin.
- Stop if reverse requires persisted reversed media, a reverse engine graph, or
  a document retime to remain usable.
- Stop if the five actions cannot be reached through the existing Transport menu,
  or if J/K/L cannot be scoped to Framescaper without stealing Soundscaper's
  L-to-Loop command or bypassing focused-control keyboard behavior.
- Stop if an edit point would have to read persisted clip timing behind the
  runtime projection, invent a lock fact, or include an off-sequence/hidden lane.
- Stop if a cancelled, switched, disposed, or rejected session can retain a timer,
  publish a late position, or leave a promise rejection unobserved.
- Stop if the slice needs a schema revision, serializable command, capability ID,
  or persisted derived cache.
