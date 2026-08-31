# Milestone 3B-4b8: canonical clip-focus trim keyboard parity

> **Historical slice record:** implementation details remain useful provenance;
> qualified browser rows and qualification-status language below predate the
> owner-run release policy and do not gate or certify a current release.

> **Implemented:** delivered through commit `a20cbc0a` on 2026-08-11, after
> [3B-4b7 — frame-canonical uniform rate-stretch](milestone-3b-uniform-rate-stretch.md).
> This bounded Framescaper slice closes the remaining vendored clip-focus trim
> and stretch callback seam. It gives an exact linked A/V pair one
> sequence-frame keyboard step through the existing edge-trim and uniform-rate
> authorities. It adds no shortcut, menu, control, chrome, schema, or edit
> primitive and completes packet 3B-4.

## Foundation and seam already present

- `TrackNew.tsx` owns local keyboard handling while a rendered clip itself has
  DOM focus. Shift plus horizontal arrow emits `onClipTrim`; adding Alt emits
  `onClipStretch`; adding Command/Control chooses the opposite edge and an
  inward operation. Plain horizontal arrows remain clip-focus navigation.
- Both callbacks currently have the shape `(clipId, edge, deltaSeconds)`. Every
  outward callback supplies `-0.1`; every inward callback supplies `+0.1`.
  `useAudioTrackRowNavigation.js` converts that fixed seconds value to project
  samples and calls legacy `clip.trim` or `clip.stretch`.
- `AudioTrackRow.jsx` is the application owner of those callbacks. Its
  `normalizeClipSemantics` path makes each top-level audio clip a real focusable
  `[data-clip-id][role="group"]`; the callbacks are not workspace-global keys.
- 3B-4b3's `video.trim.commit` service already replans an absolute boundary
  against the fresh branded command projection, binds persisted live locks,
  commits at most one `clip/transform-many`, and publishes exact trim status.
- 3B-4b7's `video.trim.rateStretch.commit` service does the same with fresh
  verified source timing and publishes effective-rate plus exact-boundary
  status. Its menu entries already satisfy opt-in menu reachability.
- The filmstrip video row does not use vendored `TrackNew` clip callbacks. This
  slice closes the callbacks that exist; keyboard selection of a video clip can
  continue to reach both operations through the delivered Clip boundaries
  menu. No second filmstrip key map is introduced here.

## Slice boundary

When and only when Framescaper's `videoCompositing` capability is true and the
focused audio clip belongs to an exact timeline A/V link with a video companion,
adapt the existing callback payload into one absolute canonical boundary request
and commit it through the corresponding video trim service. Soundscaper,
audio-only clips, and unlinked audio keep the current legacy callback functions
byte-for-byte in behavior.

This is a routing and request-construction slice. The existing planners remain
the only participant, clamp, source-bound, composition, verified-timing, and
lock authorities.

## Shortcut and direction contract

| Focused-clip key | Operation | Moving edge | Intent |
| --- | --- | --- | --- |
| Shift+Left | edge trim | left | outward |
| Shift+Right | edge trim | right | outward |
| Cmd/Ctrl+Shift+Left | edge trim | right | inward |
| Cmd/Ctrl+Shift+Right | edge trim | left | inward |
| Alt+Shift+Left | rate stretch | left | outward |
| Alt+Shift+Right | rate stretch | right | outward |
| Cmd/Ctrl+Alt+Shift+Left | rate stretch | right | inward |
| Cmd/Ctrl+Alt+Shift+Right | rate stretch | left | inward |

The current vendor callback API is sufficient and must not change. The adapter
interprets a negative callback value as **outward** and a positive value as
**inward**, then discards its magnitude. It validates a finite non-zero value;
it never treats `0.1` as timing authority. Characterization tests pin all eight
rows so a later vendor change cannot silently reverse direction.

For an authority video boundary at sequence frame `F`, the requested frame is:

| Edge | Outward | Inward |
| --- | --- | --- |
| left | `F - 1` | `F + 1` |
| right | `F + 1` | `F - 1` |

Resolve that integer target once with
`videoFrameToSampleFrame(target, sequence.rate, project.sampleRate, 'point')`
and send the resulting absolute sample to the appropriate planner request.
Never add a rounded samples-per-frame delta, round through seconds, reuse a
prior result, or accumulate callback values. Every accepted key event starts
from the fresh live canonical boundary, so integer, NTSC, and non-divisible
project sample rates cannot drift. Operating-system key repeat is a sequence of
independent one-frame commands, not one accumulated seconds edit.

## Routing and commit invariants

1. **Capability first, relation second.** Thread the current
   `snapshot.capabilities.videoCompositing === true` fact to the narrow row
   adapter. In that profile, classify an exact non-empty A/V link as canonical;
   lock state and planner admissibility are not routing predicates. Without the
   capability, or for audio-only/unlinked audio, call the existing legacy trim
   or stretch callback unchanged.
2. **No refusal fallback.** Once a callback is classified as video-bearing, a
   missing/ambiguous companion, malformed relation, lock, unsupported rate,
   non-neutral audio, composition collision, source bound, or planner no-op
   must never fall through to legacy mutation. The canonical service owns the
   result or refusal.
3. **One immutable authority per event.** A focused-clip step builder resolves
   the linked video, its sequence, current edge frame, and absolute adjacent
   boundary from one branded live command projection. Commit replans on that
   same live projection; rate stretch also reads verified timing for it. Stale
   rendered geometry and preview transforms are never commit inputs.
4. **Existing closure stays intact.** The focused linked audio ID remains the
   `activeClipId`. The edge planner preserves its deterministic
   selection/group/A/V expansion; the rate planner preserves its stricter exact
   linked-video target rules. The adapter does not construct participant lists.
5. **One command and one undo.** A transforming event prepares exactly one
   `clip/transform-many` containing every planner transform. One Undo restores
   the whole relation and one Redo reapplies it. A no-op creates no history
   entry. Source ranges remain governed by the chosen planner: edge trim changes
   source presentation as specified there; rate stretch keeps source ranges
   fixed.
6. **Locks are live authority.** Do not pre-disable a callback from rendered
   lock state. Both services rebind `isTrackLocked` from the fresh project, so a
   lock on either participant refuses the whole operation without document or
   history change. Never issue a legacy edit after that refusal.
7. **Status is shared, not translated twice.** Successful and no-op keyboard
   commits use the existing edge-trim or rate-stretch reporter. Exact applied
   timecode, effective rate, clamp suffix, success/info state, and report-after-
   commit ordering therefore match menu and pointer operations. Thrown lock,
   capability, and admissibility errors continue through the existing workspace
   error boundary; add no keyboard-only copy or status channel.
8. **Real focus stays local.** The event must originate on the focused clip
   group and follow the existing `TrackNew` callback. Do not add a document,
   workspace, shortcut-registry, or window listener. Prevented browser defaults,
   clip roving-tabindex behavior, Enter selection, Tab order, move keys, and
   vertical navigation remain unchanged. The same clip ID retains focus after a
   successful keyed edit whenever it remains present.
9. **Global edit blocking remains first.** The existing `blocked` guard returns
   before canonical or legacy work. It creates no command, plan, or report.
10. **No new surface.** Reuse the Clip boundaries menu entries delivered by
    3B-4b3 and 3B-4b7. Do not add a button, panel, side rail, badge, inline
    control, menu leaf, preference, tooltip shortcut claim, or default-visible
    affordance.

## TDD seams and implementation order

1. Add red strict TypeScript tests for a pure callback-intent adapter. Pin all
   eight key rows as the emitted `(edge, sign)` pairs, magnitude independence,
   finite/non-zero validation, capability gating, exact-link routing, and legacy
   Soundscaper/audio-only/unlinked results.
2. Add red pure step-request tests at integer, 30000/1001, and a non-divisible
   project sample rate. Cover both edges and directions, an active linked-audio
   ID resolving through its video authority, point-rounded absolute samples,
   immutability, malformed/dangling/ambiguous link refusal, and no seconds math.
3. Add red edge and rate service tests for a fresh-project step commit, fresh
   timing on rate stretch, persisted locks overriding stale caller state,
   planner clamp/no-op, exactly one prepared command, report ordering, and one
   command round trip with Undo/Redo. Refactor an internal plan-on-project seam
   if necessary rather than performing a builder read followed by a second
   unrelated commit read.
4. Wire a focused `clip-focus-trim-keyboard-routing.ts` through
   `useAudioTrackRowNavigation.js` and `AudioTrackRow.jsx`, with the capability
   fact passed from the existing timeline snapshot. Leave the legacy helper
   bodies and the vendored `TrackNew` production API unchanged. Focused UI tests
   prove canonical dispatch, refusal without fallback, and legacy dispatch.
5. Run the focused node tests while red/green, then the canonical non-browser
   gate, build, focused Chromium, roadmap guidance, and diff checks before
   recording delivery. Do not close 3B-4 until this evidence is current.

Suggested ownership is one new strict domain request builder, one new strict UI
routing adapter, narrow service/facade additions, and focused tests. Do not grow
a maintainability-allowlisted root or add broad barrel exports.

## Browser acceptance

A focused Chromium workflow imports one exact-timed linked A/V fixture into
Framescaper, focuses the actual linked audio `[data-clip-id][role="group"]`, and
presses the real `TrackNew` combinations rather than calling an action from page
script. Across trim and stretch it proves all four edge/direction classes:

- each key press moves the requested video sequence boundary by exactly one
  frame under the sequence's point policy and keeps linked-audio endpoints
  derived-equal;
- trim and fixed-source rate-stretch persistence match their planners, status
  names the applied timecode (and derived rate for stretch), and focus remains
  on the same clip;
- each transforming press adds one history step, one Undo restores both clips,
  and one Redo reapplies both; a clamped/no-op press adds none;
- locking either linked track refuses the key without geometry or history
  change and without a legacy fallback;
- Soundscaper and a Framescaper audio-only clip still exercise the existing
  fixed-seconds legacy callback behavior; and
- no new menu item, global shortcut registration, or default-visible control
  appears.

The test may use Control on the qualified Linux Chromium row; the vendor's Meta
branch remains pinned by unit characterization. WebKit and packaged Electron
rows retain their existing qualification status.

## Recorded evidence

- Delivery through commit `a20cbc0a` includes the strict adjacent-frame request
  builder, fresh-project edge-trim and rate-stretch service routes, the focused
  clip callback adapter, capability and exact-link routing, refusal without a
  legacy fallback, and unit characterization of all eight vendored key rows.
- Commit `b0d33c78` fixes the application-menu access-key owner so a standalone
  Alt press still focuses the File menu while modified Alt clip shortcuts keep
  focus on the clip and reach its existing local callback. Its focused Chromium
  menu regression passed 1/1.
- Focused Chromium canonical clip-focus keyboard coverage passed 1/1. It uses
  the real linked-audio clip focus and all eight trim/stretch combinations to
  prove one-frame canonical boundaries, linked endpoint equality, planner-owned
  source behavior, localized feedback, retained focus, one-step Undo/Redo,
  no-op history, live-lock refusal without fallback, and unchanged legacy
  Soundscaper behavior. No new menu item, global shortcut, or default-visible
  control was added.
- `npm run check` passed with 5,274 tests total, 5,272 passed and 2 skipped;
  coverage was 90.08% statements and lines, 81.97% branches, and 90.6%
  functions. The architecture gate passed across 886 modules, 2,463
  dependencies, and 1,949 maintained files. The production build guard passed
  with 104 JavaScript chunks and a 388,318-byte largest chunk.

## Non-goals and stop conditions

- No new shortcut family, configurable shortcut action, video-filmstrip local
  key map, menu entry, chrome, schema, capability ID, selection model, preview,
  tool mode, pointer behavior, or persisted preference.
- No roll, ripple, slip, slide, move/nudge conversion, transition repair,
  overwrite, time-selection edit, retiming curve, ramp, reverse/freeze, optical
  flow, audio warp, pitch preservation, or tempo stretch.
- No change to legacy Soundscaper or audio-only/unlinked trim/stretch arithmetic,
  and no attempt to make fixed 0.1-second callbacks globally frame based.
- Stop if direction cannot be recovered from the existing edge plus callback
  sign, if a vendor API fork is required, or if local focus cannot reach the
  existing callback without a global listener.
- Stop if one event needs float-delta timing, more than one conform, more than
  one command, a persisted derived cache, planner arithmetic in UI code, or a
  legacy fallback after canonical classification.
- Stop if status would be published before commit, lock authority would come
  from rendered state, source timing would be nominally fabricated, or Undo
  cannot restore the linked relation atomically.

This slice does not touch time selection. The source-monitor four-disagreeing-
points browser refusal remains assigned to the next packet that actually does.
