# Milestone 3B-4b1: linked audio and video visibility controls

> Bounded pickup contract for the first 3B-4b slice after
> [shuttle and edit-point navigation](milestone-3b-shuttle-navigation.md).
> This slice makes two already-persisted Framescaper behaviors reachable from
> the keyboard-accessible application menus. It does not introduce a trim tool
> or a track-lock fact.

## Foundation already present

- Timeline A/V pairing is the persisted clip `avLinkId`, not the external
  linked-original storage relationship. `clip/link-av` and `clip/unlink-av`
  already validate, mutate, persist, and undo one exact pair, and the action
  facade already exposes them as `video.link` and `video.unlink`.
- A valid A/V link contains one video and one audio clip with derived-equal
  presentation ranges on the two tracks of one media lane group. Existing trim,
  move, split, and overwrite expansion follows that link.
- Video tracks already persist `hidden`; program preview, export, and edit-point
  navigation already exclude hidden tracks. The timeline row already has a
  pointer control, but no application-menu route reaches the same command.
- There is no persisted `locked` field, lock command, or mutation guard. A later
  schema slice must add those together before any surface claims lock safety.

## Slice boundary

This slice delivers two Framescaper-only application-menu commands:

1. **Link audio / Unlink audio** in the existing Edit > Clip boundaries menu.
2. **Show video / Hide video** in the existing Tracks menu.

Both commands use existing controller actions, create no always-visible control,
and remain available to pointer and keyboard users through the existing menubar.
Soundscaper receives neither item and retains its current menus and shortcuts.

3B-4 remains in progress. Subsequent bounded slices own the frame-canonical trim
planner, persisted track locking and command enforcement, roll/ripple, slip/slide,
uniform rate-stretch, and keyboard-complete trim feedback.

## Contracts closed before code

1. **The selected timeline clip determines linked-audio state.** A selected clip
   with a valid `avLinkId` exposes Unlink audio. An unlinked selected video or
   audio clip exposes Link audio only when exactly one unlinked opposite-kind
   clip has the same resolved start and end on the companion track in the same
   `laneGroupId`. Zero or multiple candidates disable the command; the UI never
   guesses across lane groups or ranges.
2. **Link and unlink stay one existing document command.** Link calls
   `video.link(videoClipId, audioClipId)` and lets the controller allocate the
   stable A/V-link ID. Unlink calls `video.unlink(selectedClipId)`. No UI-owned
   document clone, batch, second conforming pass, or silent alignment repair is
   introduced. Undo and redo therefore change both members atomically.
3. **Visibility targets one selected video track.** Show/Hide is enabled only
   when the selected track is video and editing is writable. It calls the same
   `track.update(trackId, { hidden })` action as the existing row control. Audio
   mute/solo and folder visibility remain distinct; this slice does not invent
   an audio-track `hidden` field.
4. **Menu state is derived and fail-closed.** A strict TypeScript UI model reads
   only the current project projection and stable selected IDs, returns frozen
   state, rejects no user project, and reports an unavailable command when the
   exact pair or video track cannot be resolved. Menu construction contains no
   independent link or timing arithmetic.
5. **Reachability does not add workspace chrome.** The existing application
   menubar owns both commands. No toolbar button, badge, panel, filmstrip button,
   or default-visible track control is added. Existing row visibility remains
   unchanged.
6. **This is schema-neutral.** `avLinkId` and video `hidden` already belong to
   the current document. The schema version, capability registry, command
   protocol, compatibility policy, and project feature manifest stay unchanged.

## Acceptance

- Pure fixtures resolve linked, uniquely linkable, ambiguous, cross-lane,
  misaligned, missing-selection, video-track, audio-track, and Soundscaper-hidden
  states without mutating their inputs.
- The menu items call the existing actions with exact stable IDs, reflect the
  current Link/Unlink and Show/Hide labels, and disable while editing is blocked.
- A real Framescaper browser workflow imports an A/V item, reaches both commands
  through accessible menu roles, unlinks and relinks the exact pair, toggles
  video visibility, and proves undo/redo plus persisted state. With menus closed,
  the slice adds no default-visible control.
- Focused Node tests, typecheck, build, focused Chromium, and the canonical
  non-browser gate pass.

## Implementation sequence

1. Add failing table-driven tests for the strict derived menu-state model.
2. Implement the model and menu-item builders in a focused maintained TypeScript
   module under `ui/`.
3. Insert the two conditional items into the existing Edit and Tracks menus and
   wire them to the existing controller actions.
4. Add the English and German labels to the Framescaper sequence/editor copy.
5. Add and run the focused browser workflow, then record status evidence.

## Non-goals

- No track-lock field, control, schema revision, or claim that current commands
  respect a lock that does not exist.
- No edge trim, roll, ripple trim, slip, slide, rate-stretch, tool mode, or trim
  keyboard binding.
- No external linked-original attach, detach, relink, storage, or media identity
  behavior.
- No automatic A/V synchronization, source analysis, cross-lane pairing, or
  repair of clips whose ranges differ.
- No Soundscaper menu or shortcut change and no new default-visible UI.

## Stop conditions

- Stop if a link candidate cannot be proved unique from one lane group and one
  exact resolved presentation range.
- Stop if either command needs a new persisted field, command type, capability,
  or compatibility rule.
- Stop if menu reachability requires a new always-visible control or bypasses the
  existing controller/history path.
- Stop if a claimed visibility effect is not already derived from `track.hidden`
  by preview, export, and navigation.

The four packaged Electron timing-probe rows remain `pending-external`, and the
explicit WebKit deferral remains unchanged. This browser slice records only the
qualified local Chromium result.
