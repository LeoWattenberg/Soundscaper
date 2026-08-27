# Milestone 3B-4b3: frame-canonical edge-trim integration

> **Implemented:** commit `8de72ca` on 2026-08-11. Bounded slice immediately after
> [3B-4b2 — frame-canonical edge-trim planner](milestone-3b-frame-canonical-edge-trim-planner.md).
> This slice inherits that planner as its only trim authority and makes ordinary
> video-bearing edge trim use it through the controller, existing timeline
> handles, and Framescaper's application menu. It does not introduce track-lock
> state or any later trim tool. Packet 3B-4 remains in progress; the immediate
> next slice is persisted track-lock schema plus central command enforcement.

## Foundation already present

- 3B-4b2 owns absolute-boundary conformance, canonical video/source mapping,
  related-clip expansion, common clamping, composition validation, immutable
  previews, and command-shaped transforms. This slice does not duplicate or
  weaken any of those rules.
- Existing timeline video clips already expose left and right pointer handles.
  Pointer preview and release currently travel through separate floating-ratio
  UI/controller calculations; replacing that split authority is the integration
  work here.
- The existing `clip/transform-many` runtime can commit one ordered planner
  result under one operation identity. V10+ reconciliation persists video
  `sequenceStartFrame`, `sequenceFrameCount`, `sourceInFrame`, and
  `sourceFrameCount`, then derives linked-audio presentation endpoints.
- The application menu already has a Framescaper-aware Edit > Clip boundaries
  section and an established strict menu-model/runtime adapter pattern. It is the
  required opt-in, pointer- and keyboard-reachable surface; no workspace chrome
  is needed.
- No persisted track `locked` fact exists. The 3B-4b2 planner accepts an injected
  predicate and truthfully defaults it to unlocked; a later atomic schema and
  central-enforcement slice owns the first real lock fact.

## Slice boundary

Route **ordinary left/right edge trims whose expanded participant set contains
video** through the 3B-4b2 planner for both preview and commit. Add
Framescaper-only **Trim left edge to playhead** and **Trim right edge to
playhead** items under Edit > Clip boundaries. Both items use the program
playhead as the requested absolute sample boundary and call the same controller
path as the existing pointer handles.

The controller commits one `clip/transform-many` for a changed plan, publishes
the actual conformed/clamped boundary through existing status and timecode
feedback, and creates no history entry for a no-op. Audio-only trims retain their
current path. Packet 3B-4 remains in progress.

## Contracts closed before code

1. **Preview and commit have one arithmetic authority.** Pointer movement,
   pointer release, and either menu item give the inherited planner an active
   clip ID, edge, and absolute timeline-sample boundary. UI code does not compute
   a source ratio, clamp, or accumulated delta. Preview records are selected
   directly from the returned plan; commit replans through the same function
   against the live project immediately before mutation.
2. **One plan becomes one history operation.** The controller accepts only a
   frozen changed plan from the inherited authority and prepares exactly one
   `clip/transform-many`. It does not split video and linked audio into separate
   commands or wrap a hidden second transform in a batch. An explicit no-op
   returns without commit, revision change, history entry, or status success
   claim. A refusal reaches the existing error boundary without partial change.
3. **Preview must predict persisted geometry.** With an unchanged project, the
   preview and release request resolve to byte-equivalent planner transforms.
   After commit, the projected clips have the previewed sample endpoints while
   persisted video retains only canonical sequence/source coordinates. If the
   project changes between preview and release, the live replan owns the result;
   stale preview data is never committed as authority.
4. **The integration is video-bearing only.** A selected video clip, or a
   selected audio clip whose deterministic trim expansion contains its exact
   linked video companion, is eligible. The inherited selection/group/A/V
   closure remains intact. Audio-only participant sets keep the established
   `clip.trim` path and its current preview, controller, and keyboard behavior.
5. **Menu state delegates admissibility.** The Framescaper menu model derives a
   tentative plan at the current program playhead and disables an item when the
   project is not writable, no eligible selected clip exists, planning refuses,
   or the result is a no-op. It does not recreate participant, source-bound,
   composition, or clamp arithmetic. Menu activation dispatches the exact
   selected clip ID, edge, and playhead sample it presented.
6. **Reachability adds no workspace chrome.** The two menu items are the new
   opt-in surface and are keyboard reachable through the existing application
   menubar. The existing timeline handles remain the pointer surface. No global
   shortcut, tool mode, toolbar button, panel, badge, side rail, or inline
   control is added. Soundscaper receives neither menu item and retains its
   existing trim behavior.
7. **Feedback reports the actual boundary.** A changed trim publishes the edge,
   formatted sequence timecode, and whether the request clamped through the
   existing status payload; the existing sequence/program readout remains the
   persistent position display. A no-op reports that no trim was available, and
   a refusal uses the existing error status. No new always-visible feedback
   surface is introduced.
8. **Visibility and locking remain distinct.** Video `hidden` affects rendering,
   not editability, and does not masquerade as a lock. Because no persisted lock
   value can exist in the current schema, this integration supplies the inherited
   planner's default-unlocked predicate and makes no lock-safety claim. The next
   schema slice must replace that default with the real predicate and enforce it
   centrally before roll, ripple, slip, or slide becomes public.
9. **This remains schema- and protocol-neutral.** The service consumes the
   command-shaped transforms 3B-4b2 already proves against the existing runtime.
   It adds no document field, command type, capability ID, compatibility rule,
   derived cache, or persisted preview state.

## Acceptance

- Strict service fixtures prove left/right menu and pointer requests reach the
  same planner, preview equals commit for an unchanged project, a changed plan
  commits one `clip/transform-many`, a no-op commits nothing, and a refusal
  changes nothing.
- Controller/command fixtures prove canonical V14 video persistence, no derived
  sample aliases in saved clips, exact linked-audio presentation endpoints,
  deterministic group/A/V participation, and one-step undo/redo.
- UI fixtures prove the Framescaper-only menu items derive enabled/disabled state
  from planner results, dispatch exact clip/edge/playhead requests, and do not
  appear in Soundscaper. Existing audio-only trim fixtures remain unchanged.
- Pointer fixtures prove video-bearing preview no longer calls the floating-ratio
  helper and that release uses the last absolute boundary rather than a preview
  delta. Stale preview data cannot bypass the controller's live replan.
- A real Chromium Framescaper workflow trims both edges through the application
  menu and an existing pointer handle, observes exact sequence-frame timecode and
  linked-audio alignment, exercises undo/redo, and proves no new default-visible
  control appeared. It makes no WebKit or packaged Electron claim.
- Focused planner/service/menu/controller tests, typecheck, lint, build, focused
  Chromium, architecture/file-size checks, and the canonical non-browser gate
  passed before this status was recorded as implemented.

## Recorded evidence

- Commit `8de72ca` routed video-bearing pointer preview/release and the two
  Framescaper application-menu actions through the live controller planner,
  with focused service, controller, pointer-routing, feedback, menu-model, and
  application-menu fixtures.
- `npm run check`: **passed** with 5,057 tests total, 5,055 passed and 2 skipped;
  coverage was 89.89% statements, 81.74% branches, 91.43% functions, and 89.89%
  lines.
- The production build guard passed with the largest JavaScript chunk at
  387,422 bytes.
- `npx playwright test tests/browser/audio-editor-video-frame-trim.spec.js
  --project=chromium`: **1/1 passed**. The workflow exercised keyboard-reachable
  left/right trims at the program playhead, canonical sequence-frame/timecode
  persistence, linked-audio alignment, one-step undo/redo, an existing pointer
  trim handle, absence of new default-visible controls, and Soundscaper menu
  exclusion.
- The ten packaged Electron timing-probe rows run automated tests and remain
  `pending-external` only for milestone-9 release admission. WebKit automated
  testing is enabled. This Chromium result does not relabel
  either deferred matrix.

## Implementation sequence

1. Add failing strict-TypeScript controller-service tests around the completed
   3B-4b2 planner, including one-command, no-op, refusal, and live-replan cases.
2. Add a focused `video-edge-trim-service.ts`, compose it, and expose plan/commit
   methods through a narrow video action group without changing generic audio
   trim.
3. Replace only video-bearing pointer preview/release arithmetic with the service
   plan and commit paths; retain the current audio-only helper.
4. Add a focused Framescaper trim-menu model, the two conditional Edit > Clip
   boundaries items, localized labels, and existing status/timecode feedback.
5. Add focused UI and Chromium proof, run the gates, and only then record this
   slice implemented while leaving packet 3B-4 in progress.

## Expected file ownership

- New `src/common/editor/controller/video-edge-trim-service.ts` and focused
  strict-TypeScript service tests.
- New `src/common/editor/ui/framescaper-video-trim-menu-model.ts` and focused
  strict-TypeScript menu tests.
- Narrow composition/facade changes in `src/common/editor/app.js` and
  `src/common/editor/controller/action-facade.ts`.
- Narrow video-bearing routing changes in
  `src/common/editor/ui/timeline/useTimelinePointerMove.js`,
  `src/common/editor/ui/timeline/useTimelinePointerFinish.js`, and
  `src/common/editor/ui/timeline/interaction-helpers.js`.
- Narrow application-menu/runtime/copy changes in
  `src/common/editor/ui/application-menus.js`,
  `src/common/editor/ui/workspace/workspace-application-menu-runtime.js`, and
  `src/common/i18n/sequence-timing-copy.js`.
- One focused browser spec under `tests/browser/`; no new style file or
  default-visible component.

## Dependency order

1. 3B-4b2 pure frame-canonical edge-trim planner.
2. This 3B-4b3 controller, pointer, and menu integration.
3. A separate atomic schema revision for persisted track locking plus central
   command enforcement and Tracks-menu Lock/Unlock reachability.
4. Roll/ripple, then slip/slide, then uniform rate-stretch and the remaining
   keyboard-complete trim feedback.

The lock slice is not folded into this one. It must decide the locked track
kinds and mutation semantics; bump the current schema; update creation,
validation, cloning, current-version routing, feature/capability and compatibility
ownership where required; preserve the field across both products; enforce it
across every affected direct and nested command; and ship its full revision,
history, serialization, `.scape`, future/older-schema, and cross-product fixture
set atomically. That cost is intentionally larger than this integration slice.

## Non-goals

- No persisted track lock, schema revision, capability, compatibility rule, or
  partial command guard.
- No roll, ripple trim, slip, slide, rate-stretch, overwrite, transition repair,
  retiming curve, reverse, freeze frame, or nested sequence behavior.
- No change to audio-only trim, Clip Properties source editing, global shortcuts,
  tool modes, or Soundscaper menus.
- No default-visible control, new styling, persisted preview, or derived trim
  cache.
- No packet 3B-4 completion claim.

## Stop conditions

- Stop if preview and commit require separate trim arithmetic or if UI code must
  recreate any planner clamp, source mapping, participant, or composition rule.
- Stop if one successful trim cannot be committed as exactly one
  `clip/transform-many` with one history step.
- Stop if integration reads legacy video sample aliases as persisted authority or
  allows stale preview transforms to bypass a live controller replan.
- Stop if application-menu reachability requires a new default-visible surface or
  changes Soundscaper behavior.
- Stop and decompose the lock revision separately if persisted lock state becomes
  a prerequisite; do not add an ad hoc field, UI-only predicate, or partial
  command guard here.
- Stop if the slice needs a new command type, schema revision, capability ID,
  compatibility rule, or persisted derived cache.

The ten packaged Electron timing-probe rows run automated tests and remain
`pending-external` only for milestone-9 release admission. WebKit automated
testing is enabled. This slice may record only its
qualified local Chromium result.
