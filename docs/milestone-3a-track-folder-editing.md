# Milestone 3A-3b: folder-aware editing, clipboard, and the native tree

> Slice-level pickup decomposition for the second half of
> [3A-3](milestone-3a-work-packets.md#3a-3--nested-track-folders). The V12
> schema switch (`268d42f`) landed the folder document model and deliberately
> shipped no editing surface; this document decomposes what closes that gap,
> ending at the Soundscaper capability flip. Grounded against the repository
> on 2026-08-09; every file and line reference below was read, not inferred.

## Slice boundary

The landed register states the boundary in its own words
(`config/project-compatibility.json`, `current-track-folder-capability`):

> This slice adds no folder-aware editing command, clipboard behavior, or
> native UI, and it authorizes no audio or video fallback.

This slice makes that sentence false, deliberately and in the same commit
that first falsifies it. It delivers folder-aware editing commands, clipboard
survival on a nonempty hierarchy, and an accessible native folder tree, and
ends with `trackFolders` available for Soundscaper. Framescaper stays known
but unavailable; the fallback exclusion survives verbatim.

## No schema revision is required

Every field the editing surface writes already exists and is closed-validated
in V12:

- `track-folder-v12.ts:19-27` — `{ id, name, collapsed, height, hidden, mute,
  solo }`, so rename, collapse, height, hidden, mute, and solo are writes to
  existing fields.
- `track-hierarchy-v12.ts:19-23` — `TrackNodeV12 { kind, id, parentFolderId }`,
  a flat ordered per-sequence node list, so create, move, reorder, and
  delete/promote are splices of that list.
- Bounds are already fixed at `track-hierarchy-v12.ts:9-15`: 4 096 folders,
  16 384 nodes, 1 024 sequences, depth 32.

The clipboard's version axis is independent of the project schema, and this
slice makes no clipboard wire change (contract 4 below).

**The single V13 trigger is persisted folder selection.** `selection` and
`view.selectedTrackIds` are persisted and validated; adding a folder dimension
there is a schema change. Keeping folder selection in controller session state
is what keeps this slice revision-free — see contract 3.

## Contracts closed before code

1. **One move command, not two.** `track-node/move { sequenceId, nodeId,
   parentFolderId, index }` covers folders and tracks alike, because both are
   the same operation on the flat node list: splice a contiguous span. Two move
   commands would give two structures a claim on authoritative ordering, which
   is a named packet stop condition. `track/reorder` becomes a delegating
   alias.
2. **Deletion disposition is explicit on the wire.** `track-folder/remove`
   carries `disposition: 'promote' | 'delete-contents'` with no default, so
   "deletion can never leave an unreachable track" is a wire property rather
   than a code property. `delete-contents` must reuse the existing removal side
   effects at `track-mixer-label-runtime.js:67-83` — clip removal, `delete
   project.mixer.routes[trackId]`, and `disableAutoDuckForRemovedControlTrack`.
   Skipping the route cleanup is a hard commit failure:
   `project-v9-document-validation.ts:157` throws `Mixer route references
   missing audio track`.
3. **Folder selection is not persisted.** It lives in controller session state
   beside `snapshot.selectedTrackId`. Do not add `selection.folderIds` and do
   not widen `view.selectedTrackIds`.
4. **The clipboard wire does not change.** Folders own no clips, so a subtree
   copy has no payload to carry. `AUDIO_EDITOR_COMMAND_CLIPBOARD_SCHEMA_VERSION`
   stays 3 and `TOP_LEVEL_V3_KEYS`/`TRACK_V3_KEYS` stay closed; the paste target
   parent is resolved controller-side in `clipboard-edit-service.ts:231-250`.
5. **Folder IDs need a new minting prefix.** No `track-folder` id path exists
   today — `grep -rn "'track-folder'" src/` returns nothing, and
   `createTrackFolderV12` (`track-folder-v12.ts:56`) demands a caller-supplied
   id. Author `createStableId('track-folder')` following `stable-id.js`, and
   reject a caller-supplied id that collides with **any** track or folder id:
   `track-hierarchy-v12.ts:367-371` enforces global disjointness across all
   sequences.
6. **A move that targets one member of an A/V lane pair moves both.** The span
   expands to the whole lane group rather than rejecting;
   `track-hierarchy-v12.ts:409-439` requires the pair to stay adjacent,
   same-sequence, and same-parent, and `project-v9-media-validation.ts:261-276`
   duplicates the adjacency rule on the flat index. Rejecting would make the
   pair immovable from the UI.
7. **Budget overflow rejects before any mutation**, with a named, localizable
   error. Clamping or flattening would silently reparent — exactly what the
   landed register promises does not happen. Checking after the fact surfaces a
   bare `RangeError` at commit with the draft already dirty.
8. **Folder rejections get one named error class with a stable code**, mirroring
   `AudioEditorProjectReimportRequiredError`, so the UI can announce refusals to
   assistive tech without matching on message text. The two existing reconciler
   message strings stay byte-identical — they are pinned by tests and quoted in
   the register.

**Deferred, and stated rather than implied:** AUP, AUP4, and RIFF folder-loss
reporting. The annotations precedent (`c226c50`) shipped four interchange
modules alongside its flip; this slice ships none, so the register rewrite must
not imply interchange coverage it does not have.

## Commit sequence

Each step is independently green under `npm run check`. Steps S8–S10 also
require `npm run test:browser` — `check` is `lint && typecheck &&
check:architecture && audit:ci && test:coverage && build` and does **not** run
Playwright.

### S1 — Folder subtree mutation primitives

New `src/common/editor/track-hierarchy-mutation-v12.ts`, pure and command-free:
contiguous DFS span extraction, splice under a new parent at a target index,
re-derivation of the project-wide preorder that `track-hierarchy-v12.ts:372-381`
demands, lane-group span expansion, and pre-mutation budget checks.

`track-hierarchy-v12.ts` is 551/600, so this is a new module, not growth.

**Acceptance.** Every rejection path is exercised by a Node test, because the
coverage gate counts `.ts` at lines 80 / branches 70 / functions 80 and
`.jsx`/`.tsx` not at all: move under own descendant rejects (a splice can
satisfy the existing "self or later parent" check vacuously when the
destination lies inside the removed span); missing parent; non-folder parent;
duplicate/colliding id; depth 33; folder and node ceilings; cross-sequence
reparent; lane pair stays adjacent and co-parented; promote leaves zero
unreachable tracks; delete-contents returns the full removal set; re-derived
`project.trackFolders`/`project.tracks` equal the concatenated per-sequence
preorder on a three-sequence fixture.

### S2 — Folder-aware commands and their reconciliation

`track-folder/add`, `track-folder/update`, `track-folder/remove`, and
`track-node/move`, **together with** the reconciler branch that makes their
output valid. These cannot be separate commits: the runtime-registry
exhaustiveness test forces real handlers to exist, and until the reconciler
accepts them any successful execution produces a project that fails the
preorder assertion at commit.

Both guards in `reconcileV12TrackHierarchy` must be conditioned on the new
folder-aware transient, not just the first —
`project-v10-command-projection.ts:439-441` (legacy-edit throw) **and**
`:442-444` (the drift guard), which fires for any folder-aware command that
changes the track set. The module is 537/600, so the branch is extracted into
`project-v12-hierarchy-reconcile.ts`.

Adding `trackFolders` to `EditorCommandCapabilities`
(`command-capability-policy.ts:6-12`, currently five required booleans) breaks
two full object literals. Keep the field required — optionality weakens the
fail-closed contract — and edit
`tests/audio-editor-timeline-annotation-clipboard.test.ts:389-392` **in place**;
that file is 599/600.

This is the commit that first falsifies the register, so it rewrites
`config/project-compatibility.json`, `docs/project-compatibility.md`, and
`tests/project-compatibility-v12-policy.test.js` in the same change. Write the
rewrite **forward-neutral through S3**, or S3 falsifies it again.

Check whether the new modules import `runtime-clip-projection.ts`; if so they
need a `FOUNDATION_RUNTIME_PROJECTION_IMPORTER_EXCLUSIONS` entry in
`foundation-runtime-consumer-audit.ts` in the same commit, because its test
deep-equals discovered importers against registered ones.

### S3 — Legacy track commands become folder-aware

Without this the tree is un-editable the moment it is nonempty:
`commands.js:126-129` marks **every** `track/add|remove|reorder` as a legacy
structural edit, and the reconciler throws whenever `folders.length > 0`. The
verified emitters that would break the instant a user creates a folder are
`controller/track-service.ts:157,187,197,274`,
`controller/track-transform-service.ts:248-250,284`,
`controller/mix-render-model.ts:244-246`,
`controller/clipboard-edit-service.ts:241`, `controller/action-facade.ts:371`,
and the import paths wired at `app.js:706,779,1386,1403,1417`.

`track/add` with no parent defaults to the owning sequence's root. Do **not**
overload the existing `index` field — it is a flat `project.tracks` index
resolved at `track-mixer-label-runtime.js:41,50,63` and live callers pass it as
such; introduce a distinct parent-relative field instead.

This step also closes a capability hole: `track/*` is not gated at all today,
so folder-aware payloads would let a caller reparent while `trackFolders` is
false. Add a payload-shape gate mirroring the existing `selection/set` +
`annotationIds` precedent at `command-capability-policy.ts:32-45`.

**Acceptance** covers duplicate-track, split-into-new-track, A/V source import,
AUP import, mixdown removal, and track transform on a depth-3 foldered fixture.

### S4 — Paste into a project with a nonempty folder tree

Closes the highest-severity latent regression: `createTargetTrack`
(`clipboard-edit-service.ts:231-250`) emits a bare add-track command, so any
paste that must synthesise a track — or an A/V lane partner — currently kills
the whole batch on a foldered project. Resolve the target parent as selected
folder → source track's surviving parent → sequence root.

Put the coverage in `tests/audio-editor-clipboard-edit-service.test.ts`
(307/600). `tests/audio-editor-timeline-annotation-clipboard.test.ts` is
599/600 and effectively frozen.

### S5 — Round-trip survival

The packet requires every tree mutation to survive clone, clipboard,
save/reopen, `.scape`, desktop, and unavailable-Framescaper round trips. Only
clipboard and undo/redo are covered by earlier steps, and `.scape` has no
folder coverage at all today. Apply a folder-aware batch, then assert
byte-exact preservation through each path.

Append to `EXPECTED_RUNTIME_FILES` in
`scripts/lib/desktop-project-library-runtime.mjs` **only if the build actually
emits the module** — the guard is an exact bidirectional match and a
speculative append fails. `tests/desktop-project-library-packaging.test.js`
duplicates that list and must change in the same commit.

### S6 — Controller actions and the folder snapshot

`controller/track-folder-service.ts` plus an `actions.trackFolders` group, each
entry wrapped in the `restricted(...)` pattern the annotations facade already
uses, so the actions exist, are typed, and reject in both products until the
flip. A `controller/document-track-folder-snapshot.ts` becomes the first
**UI-facing** consumer of the `depth`, `ancestorFolderIds`, `rowHidden`,
`hasAudioDescendant`, and `structuralSoloActive` fields —
`track-folder-media-runtime.ts:67,78-88` already consumes the three
`effective*` fields in production, so do not claim the projection is unused.

The snapshot must expose rows for **one sequence**. `project.tracks` and
`project.trackFolders` concatenate every sequence's preorder, and the timeline
renders that flat array today with no sequence filtering; a tree whose
`aria-level`/`aria-setsize` spans sequence boundaries is wrong.

Co-edit the action-key pins: `tests/audio-editor-controller.test.js:104-108`
deep-equals the action keys, and `tests/audio-editor-public-facade.test.ts`
asserts both the key list and a group-count arity immediately after it.

### S7 — Memoize the folder media projection

`VideoPreviewPanel.jsx:247-254` re-enters `projectTrackFolderMediaStateV12` on
every playhead frame for a folder-bearing project, and each call re-runs the
full hierarchy validation plus the projection. A tree that re-projects per
pointer move on top of that is the slice's main latency risk, so it is fixed
before any UI lands.

State the win honestly: the cache elides `deriveTrackFolderStateProjectionV12`
plus `validateTrackHierarchyV12`, while the lineage walk
(`track-folder-media-runtime.ts:139-189`, O(nodes) plus a `JSON.stringify`)
remains as the invalidation key. This is "one lineage walk instead of
validation plus full projection", **not** O(1). An identity-only `WeakMap` over
a mutable draft would be unsound. The private trust `WeakMap`, the
forged-marker check ordering, and lineage semantics are unchanged.

### S8 — Extract the timeline track list view

Pure extraction, byte-identical DOM: the track-list block moves out of
`TimelineWorkspaceView.jsx` (559/600 at `HEAD`) into
`ui/timeline/TrackListView.jsx`, because a folder tree cannot fit in 41 lines
of headroom.

**This step is blocked on the concurrent timeline work — see below.**

### S9 — Render the folder tree

A pure `ui/timeline/track-folder-ui-model.ts` owning row flattening, ordering,
roving-index arithmetic, and keyboard intent (mirroring
`timeline-annotation-ui-model.ts`), plus `TrackFolderRow.jsx` and folder-aware
rendering. `role="tree"` / `treeitem` / `aria-level` / `aria-expanded` /
`aria-posinset` / `aria-setsize` must be authored — no tree pattern exists in
this repo today.

Ordering comes only from the `trackNodes` preorder. Preserve the existing DOM
contract: `data-track-index` keeps its `project.tracks` meaning
(`timeline-navigation.js:3-5` queries it, and
`useAudioTrackRowNavigation.js:28-31` computes `trackBaseTabIndex + trackIndex *
4 + offset`); introduce a separate row index for the tree. Both existing
timeline browser specs must pass unmodified against folder-free **and**
folder-bearing projects.

Folder copy goes in a dedicated `src/common/i18n/track-folder-copy.js` so the
`catalogs.js` diff stays three lines; re-ratchet
`config/maintainability-allowlist.json:29` in the same commit.

### S10 — Pointer and keyboard tree editing

Create, rename, delete/promote, move, and the hidden/mute/solo/height controls,
routed through the same `actions.trackFolders.*` calls so drag-and-drop and
keyboard produce identical projects. Folder entries go in the track context
menu (`ui/timeline/timeline-menu-model.js`, 187 lines), **not** the application
menu — the annotations slice added no application-menu ids either, and
`application-menu-registry.ts` is a frozen object the 3A-4 agent extends.

Cover the two packet items nothing else reaches: nested height determinism, and
wrapping a current selection into a new folder as one atomic history entry.

### S11 — Activate nested track folders

`src/soundscaper/product.js` and `config/production-capabilities.json:211` go
`true`; Framescaper's stay `false`. Rewrite the register rule's
`requiredOutcome`, `currentBehavior`, and `evidence`; the fallback-exclusion
clause survives verbatim and `trackFolders` stays out of both rendered-fallback
capability id sets.

Run `node scripts/sync-policy-narratives.mjs` (a no-op for folders — there is
no `track-folder` binding — but it proves no other fenced block drifted), then
`node scripts/repin-runtime-evidence.mjs`, which is mandatory because
`config/production-security-matrix.json` and `docs/production-threat-model.md`
are SHA-256 and byte-length pinned.

`tests/production-security-evidence.test.js` is **exactly 600 lines and not
allowlisted**: rewrite its regexes in place. Adding one line fails
`check:architecture`.

## Concurrency

The 3A-4 agent's landed work is already on `main` — the `fix/ci-browser-suite-failures`
branch holds one commit that duplicates `7b12b61`, and diffing its named files
against `main` returns nothing.

**The live risk is uncommitted.** As of this writing the shared working tree
carries thirteen modified files, all in `src/common/editor/ui/timeline/`:
`TimelineWorkspaceView.jsx`, `useTimelineViewportModel.js`,
`useTimelineHitTesting.js`, `useTimelineInteractionState.js`,
`TimelineController.jsx`, `constants.ts`, `19-timeline-annotations.css`, plus
`tests/browser/audio-editor-workspace-panels.spec.js` and five Chromium
snapshots. S8 and S9 edit two of those files directly.

S1–S7 are file-disjoint from that work and can proceed now. **S8 must not
start until the timeline work lands**, or the extraction rebases onto a moving
target and its byte-identical-DOM claim is unverifiable.

Other shared surfaces, all currently uncontended but worth a rebase before
touching: `ui/audio-editor-design-system.css` (a strictly ordered `@import`
list — take both imports in numeric order on any conflict),
`src/common/i18n/catalogs.js`, `ui/application-menu-registry.ts`, and
`config/production-capabilities.json` at the flip.

## Ceilings verified at `HEAD`

| File | Lines | Note |
| --- | --- | --- |
| `tests/production-security-evidence.test.js` | 600 | not allowlisted; S11 edits in place |
| `tests/project-compatibility-policy.test.js` | 600 | not allowlisted; touch nothing |
| `tests/audio-editor-project-switch-service.test.ts` | 600 | not allowlisted; no folder coverage here |
| `tests/audio-editor-timeline-annotation-clipboard.test.ts` | 599 | in-place edit only |
| `src/common/editor/ui/timeline/TimelineWorkspaceView.jsx` | 559 | why S8 exists |
| `src/common/editor/track-hierarchy-v12.ts` | 551 | S1 is a new module |
| `src/common/editor/commands/clipboard-runtime.js` | 555 | untouched; no wire change |
| `src/common/editor/project-v10-command-projection.ts` | 537 | S2 extracts its branch |

`config/maintainability-allowlist.json` entries fail when a file **exceeds**
its ratchet, when it drops **below** it, and when it falls to the default
ceiling — never re-ratchet speculatively.

## Non-goals

No schema revision. No persisted folder selection. No clipboard schema 4. No
groups-as-buses, sends, VCAs, automation, or folder clips. No AUP/AUP4/RIFF
folder-loss reporting. No application-menu entries. No structural sort-by-name
— 3A-4 owns the Audacity sorting action and inherits S1's move primitive.

## Stop conditions

- Any second structure claiming authoritative ordering. The `trackNodes`
  preorder is the sole authority; `project.trackFolders`, `project.tracks`, and
  `sequence.trackIds` are derived projections of it.
- Any path that can leave a track in `project.tracks` without a `trackNodes`
  entry, or the reverse.
- A folder-level bus, send, or `mixer.routes` key required to make mute or solo
  behave.
- Any genuinely new persisted field. That means one atomic V13 revision with no
  migration, placed before S2 — which invalidates the ordering below it.
- Folder membership genuinely needing to travel on the clipboard wire. That is
  a slice of its own.
- A commit that cannot go green without adding a line to a file at 600.
- A register left asserting something false at the end of any commit.
- Memoization that needs looser hierarchy limits, a weakened trust `WeakMap`,
  or wider lineage coverage to hit its latency target.
