# Milestone 3B-4b4: persisted track locking and central enforcement

> **Planned immediate pickup:** bounded slice after
> [3B-4b3 — frame-canonical edge-trim integration](milestone-3b-frame-canonical-edge-trim-integration.md).
> This slice introduces the first persisted track-lock fact, enforces it at the
> low-level command boundary for both products, and exposes Tracks > Lock/Unlock.
> It does not add another trim tool or an always-visible control. Packet 3B-4
> remains in progress.

## Foundation already present

- Exact-current V14 has no required track `locked` field. Its clean-break loader
  rejects older authoring schemas and keeps future schemas opaque/read-only, so
  an optional V14 extension cannot establish enforceable semantics.
- Every persisted edit reaches `applyEditorCommand`. Direct commands and every
  nested `batch` child use the same mutable-draft dispatcher, after which V10+
  reconciliation restores canonical sequence, source, musical, folder, and
  feature-requirement state before validation.
- 3B-4b2's trim planner accepts a temporary lock predicate, and 3B-4b3 replans
  video-bearing preview/commit against a live project. Video edit navigation
  excludes hidden tracks but cannot yet exclude locked tracks.
- The existing `track/update` history path and Tracks menu can carry one boolean
  toggle. No new command type or row control is required.
- Desktop persistence is independently pinned to library schema 6, project
  schema 14, filesystem scope `v6`, and SQLite `user_version` 8. Compatibility
  and security evidence also names exact schema 14.

## Slice boundary

Introduce exact project schema **V15** with required own boolean `locked` on
audio, video, and label tracks, defaulting to `false`. Soundscaper and
Framescaper both preserve and enforce it and expose one selected-track
**Lock track** or **Unlock track** item in the existing Tracks menu.

This is an editorial lock, not visibility, mixing, permissions, or whole-project
read-only state. It protects a track's owned timeline content, resolved timing,
and structural identity while selection and header/mix/view/track-rack controls
remain usable. Roll/ripple follows this slice, then slip/slide, uniform
rate-stretch, and the remaining keyboard-complete trim feedback.

## Contracts closed before code

1. **V15 owns one required fact for every track kind.** Factories normalize
   `locked` and default it to `false`. Exact validation requires an own data
   property whose value is boolean; missing values, accessors, and non-booleans
   refuse. Clone, history, JSON, browser storage, desktop storage, and `.scape`
   retain it without deriving it from product, selection, mute, hidden, or
   folder state.
2. **Protected state is semantic, not an array index.** A transaction-start
   locked track retains its identity, lane/folder membership, owned clip or
   label identities and editorial data, canonical ranges, and resolved
   presentation/source ranges. Referenced media identity, bounds, timing, or
   content cannot change so as to change that material. Clip-local video effects
   remain protected with their clip.
3. **All owned editorial mutations refuse.** This includes clip/label add,
   remove, update, move, trim, transform, split, link, group, join, replace, and
   render-over paths. Range, clipboard, punch, insert, overwrite, Project Bin,
   source re-probe/replacement, tempo, and sequence commands also refuse when
   their reconciled result changes protected state. Group, A/V, collision,
   ripple, lane, and folder expansion cannot omit a locked participant.
4. **Non-editorial controls remain available.** Selection and existing header,
   mixer, view, and audio track-rack controls stay allowed, including name,
   gain/pan, mute/solo/arm, video hidden, display/spectrogram/envelope view,
   collapse/height, effects-active state, track effects, and mixer routing. The
   exact lock toggle is allowed. Unrelated source or Project Bin work is allowed.
   Lock never implies hidden, muted, bypassed, unselected, or project read-only.
5. **Unrelated structure may change around a lock.** Adding, removing, or
   reordering an unrelated track or folder remains valid even if the locked
   track's numeric array index changes. The lock protects the locked node; it
   does not freeze the complete sequence preorder.
6. **Destructive structure has narrow preflight.** Before mutation, direct
   removal/reorder of a locked track, movement of its node, movement/removal of
   its media-lane block, and movement/removal of a folder subtree containing it
   refuse. This preflight expands the command's lane/folder structure but does
   not classify all command types or reject an unrelated index shift.
7. **Two semantic postconditions are final authority.** The outer apply captures
   protected baselines in both command-projection and persisted coordinates.
   After every non-batch child, including children nested to arbitrary depth, a
   raw semantic invariant compares protected state on the disposable draft; this
   prevents an intermediate edit from being hidden by a later restore while its
   collision or routing side effects survive. After persistence reconciliation,
   a second invariant compares the canonical and resolved persisted result before
   `applyEditorCommand` returns. Together they cover indirect and future commands;
   command-specific classification may improve diagnostics but cannot exempt a
   changed protected result.
8. **Lock authority grows monotonically through a nested batch.** The outer apply
   starts with every transaction-start track whose `locked === true`. Unlocking a
   draft never removes its authority, so `unlock -> edit -> relock` refuses
   atomically. When a child locks an initially unlocked track, its post-child
   state becomes the protected baseline for all later siblings and descendants.
   Thus `edit -> lock` may succeed, but `lock -> edit` refuses. A standalone
   Lock/Unlock is one history operation.
9. **Refusal is atomic everywhere.** Direct apply, history, controller actions,
   and arbitrary batch nesting observe the same rule. No draft, revision,
   timestamp, history entry, autosave, selection, success status, or playback
   publication escapes. Undo/redo restores whole validated snapshots rather than
   replaying a forbidden command.
10. **Video consumers use persisted live lock.** The edge-trim controller derives
    the planner predicate from the same live project used for preview or commit;
    caller omission/false cannot weaken it. Locked participation disables menu
    planning and refuses pointer preview/commit without legacy fallback. Commit
    still replans live, and audio-only trim remains centrally protected.
    Previous/next edit navigation skips locked lanes; an explicit locked target
    returns no point rather than falling back. Lock does not hide the lane from
    playback, preview, or export.
11. **Both products expose one menu-only toggle.** Tracks > Lock track appears
    for an unlocked selected audio/video/label track and Unlock track for a
    locked one. It disables without a selection or while editing is blocked and
    dispatches existing `track/update(trackId, { locked })`. Neither product adds
    a row icon, inline switch, toolbar item, badge, panel, rail, or shortcut.
12. **Lock is native shared behavior, not a capability.** There is no capability
    ID, owned requirement, fallback, compatibility read-only state, or new
    command discriminant. Both profiles preserve/enforce it; exact V15 prevents
    an older writer from silently losing its semantics.
13. **The V15 clean break is atomic.** Current aliases, schema predicates,
    projections, types, factories, validation, folder media projection,
    commands, `.scape`, browser/native stores, and both-product fixtures move
    together. V1–V14 use the existing typed source-reimport refusal; V16+ stays
    opaque/read-only. Desktop advances to library schema 7, project schema 15,
    scope `v7`, and SQLite `user_version` 9, including validator, runtime
    inventory, catalog, smoke, and packaged fixtures. Compatibility/security
    registers, derived narratives, digests, and evidence pins advance through
    their owning scripts in the same landing.

## Acceptance

- V15 fixtures cover all track kinds; default false/explicit true; strict own
  data validation; clone, JSON, history, undo/redo, `.scape`, browser persistence;
  V1–V14 refusal; and opaque V16 handling.
- Desktop fixtures prove exact V15 lock round-trip through the new scope,
  catalog, commit/reopen, and both preferred products. The new runtime neither
  opens nor mutates an old desktop scope.
- Semantic fixtures cover every owned audio/video/label change; groups/A-V;
  source and Project Bin replacement; ranges, clipboard, punch and three-point
  edits; musical tempo/sequence-rate changes; and unrelated controls.
- Structural and nested-batch fixtures prove lane/folder expansion, allowed
  unrelated index shifts, `unlock -> edit -> relock`, initially-unlocked
  `edit -> lock`, `lock -> edit`, intermediate restore with collateral changes,
  atomic refusal, unchanged input/history, and exact toggle undo/redo.
- Controller fixtures prove both products enforce direct protocol commands and
  retain native compatibility without a feature requirement.
- Trim/navigation fixtures prove persisted live predicates, no stale-preview or
  legacy fallback bypass, central audio-only protection, implicit locked-lane
  exclusion, and no explicit-target fallback.
- Menu fixtures cover both products, all track kinds, localization, exact IDs
  and booleans, edit blocking, and no visible row control. Focused Chromium
  locks, refuses trim, skips navigation, reloads/hands off, unlocks, and
  exercises undo/redo.
- Focused tests, policy sync/repin checks, typecheck, lint, architecture/file-size
  checks, canonical non-browser gate, build, and focused Chromium pass before an
  implemented status is recorded.

## Implementation sequence and ownership

1. Land failing V15, clean-break, `.scape`, desktop, and cross-product fixtures;
   add `project-v15.ts`/validation and propagate every exact-current pin.
2. Add failing protected-state, structure, and nested-batch fixtures; implement
   one focused strict command invariant with a narrow `commands.js` apply hook.
3. Make the video-edge-trim service and video-navigation model consume persisted
   lock, retaining central enforcement as final authority.
4. Add the shared application-menu/runtime/copy toggle, focused tests, and one
   browser spec; add no row component or style file.
5. Run all gates and owning policy scripts. Record implementation only when the
   whole V15 revision, enforcement, desktop/policy propagation, and menu land
   together. New maintained files remain below the size ceiling.

## Non-goals

- No roll, ripple, slip, slide, rate-stretch, transition repair, retiming curve,
  reverse, freeze frame, nested sequence, or new trim arithmetic.
- No project/folder/clip lock field, collaboration permission, OS file lock, or
  security boundary; no capability, requirement, fallback, new command type, or
  optional V14 extension.
- No blocking of the allowed selection/header/mix/view/rack or unrelated
  structural changes above.
- No default-visible control, styling, shortcut, persisted preview, or derived
  lock cache.
- No raw V1–V14 or old desktop-scope migration beyond the established source
  re-import and clean new scope.
- No WebKit, packaged Electron UI, cross-OS, crash/power-loss, or multi-process
  migration claim from a local Chromium workflow; no packet 3B-4 completion.

## Stop conditions

- Stop if V15 cannot land atomically across schema, stores, desktop namespace,
  policy/security evidence, both products, history, and fixtures. Do not ship an
  optional field, UI-only predicate, or partial guard.
- Stop if any writable document path bypasses `applyEditorCommand`, or nested
  dispatch cannot retain the outer transaction's locked-ID set.
- Stop if the child invariant must guess command arithmetic, the final invariant
  cannot compare reconciled coordinates, either needs a derived cache, or the
  guard must classify every command instead of comparing semantic results.
- Stop if direct locked movement cannot be distinguished from an allowed
  unrelated index shift in narrow structural preflight.
- Stop if unlock authorizes a later child edit, refusal publishes state/history,
  or undo/redo must replay forbidden commands.
- Stop if preview/commit use different lock facts, callers can weaken persisted
  lock, or explicit locked navigation falls back.
- Stop if either product needs a capability/requirement, lacks Unlock, or
  reachability needs a new visible control or changes lock into visibility,
  playback exclusion, or project read-only state.

The four packaged Electron timing-probe rows remain `pending-external`, and
WebKit remains explicitly deferred. A focused Chromium result may qualify only
that workflow; it cannot relabel packaged, crash, power-loss, cross-process, or
other-browser evidence.
