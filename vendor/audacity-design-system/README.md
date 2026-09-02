# Vendored Audacity design system

In-tree copy of three packages from
[DilsonsPickles/audacity-design-system](https://github.com/DilsonsPickles/audacity-design-system),
vendored at the commit recorded in [UPSTREAM](UPSTREAM) (muse_framework style: plain copy, no
submodule). The application's Vite build compiles this source directly; there is no separate
build step. `check:notices` verifies that the commit recorded in `UPSTREAM` matches the entry
in `THIRD_PARTY_LICENSES.md`.

## How it is wired

- `@dilsonspickles/components` → `components/src/index.ts`
- `@audacity-ui/core` → `core/src/index.ts`
- `@audacity-ui/tokens` → `tokens/src/index.ts`

Aliases are declared in `vite.config.mjs` (`resolve.alias`) and `tsconfig.base.json` (`paths`),
both file-targeted. Node-run tests resolve the same aliases through tsx and stub CSS/asset
imports via `scripts/node-style-asset-loader.mjs`.

## Rules

- **No deep subpath imports** of `@dilsonspickles/components/...` — the file-targeted alias
  does not support them and they resolve to broken paths.
- **Unused components' CSS does not ship.** Component modules the app never imports are
  tree-shaken along with their stylesheets. App code that renders a component's markup by
  class name *without* mounting the component must import that component's stylesheet
  directly by relative path (see `TimelineFlyouts.jsx` / `AudioEditorMenuBar.jsx`); the
  scoping plugin still applies to it.
- **Do not import** `components/src/style.css`: it is a stale upstream aggregate covering only
  28 of 127 component stylesheets. Component modules import their own CSS; that is the delivery
  path.
- The vendored `package.json` files are provenance + Node module-typing only; their
  `main`/`module`/`exports` fields point at `dist/` artifacts that do not exist here and are
  bypassed by the file-targeted aliases.
- Design-system CSS is scoped at build time by `scripts/postcss-audacity-design-system.mjs`
  (keyed on this directory's path). CSS added here lands scoped under
  `#kw-audio-editor-design-system` automatically.

## Local deviations from upstream

Tracked so upstream syncs know what to preserve. Aside from this list, keep the tree pristine.

1. `"type": "module"` added to all three `package.json`s (upstream omits it; without it Node
   tooling compiles the tree as CommonJS while Vite builds ESM).
2. Ported application patches (formerly `patches/components/`, applied to the compiled dist) —
   one commit per logical change, see `git log -- vendor/audacity-design-system`.
3. React-19 type fixes (upstream types against `@types/react` 18).
4. `/* @__PURE__ */` on **every** `createContext` call in the tree: when a module's exports are
   unused, rolldown otherwise keeps the bare call while dropping its import binding, which
   throws `ReferenceError: createContext is not defined` at boot. The 0.10.1 sync brought three
   new contexts into `PreferencesContext.tsx` and reproduced exactly that failure, so the
   annotation now covers all of them rather than the single call it started as;
   `tests/vendored-design-system-pure-annotations.test.js` fails if a sync adds an unannotated
   one. Upstream-PR candidate.
5. `TrackNew.tsx` renders each clip in `clip.color` rather than the track colour that 0.10.1
   switched to. Upstream made that switch because its own sandbox lets `clip.color` drift away
   from the destination track; the application resolves clip colour before passing clips down
   (`AudioTrackRow.jsx` maps the `'auto'` sentinel to the track colour), so it cannot drift here,
   and upstream's version makes the "Clip color" command have no visible effect. Covered by the
   clip-colour case in `tests/browser/audio-editor-timeline-interactions.spec.js`.
6. `TrackNew.tsx` keeps the Shift+Arrow / Cmd+Shift+Arrow clip-edge trim chords that 0.10.1
   replaced with bracket keys. The application routes those chords through its frame-canonical
   trim path (`clip-focus-trim-keyboard-routing.ts`) and documents them as the clip-focus trim
   shortcut, so the branch is restored *ahead of* the new bracket branch and both work. Covered
   by `tests/browser/audio-editor-canonical-trim-keyboard.spec.js`.

7. `Dialog.tsx` registers its Escape handler on `document` in the **bubble** phase (0.10.1 moved
   it to capture + `stopImmediatePropagation`). In capture the dialog sees Escape before every
   overlay nested inside it, so closing a `Dropdown` opened within a dialog closed the whole
   dialog instead, and `Dropdown.tsx`'s `e.stopPropagation(); // Prevent Dialog from closing`
   became dead code — a React-root listener never sees an event the document already swallowed.
   With two capture-phase overlays open, registration order decided who won. Bubble phase is
   both what v0.9.0 did and what the application's own `AudioEditorDialogShell` does;
   `stopImmediatePropagation` is kept, so the app-level Escape handler still doesn't fire
   alongside the close. `ContextMenu`'s capture registration is deliberately left alone (see
   "Application-side adaptations" below). Covered by
   `tests/vendored-design-system-dialog-escape.test.ts`. Upstream-PR candidate.
8. `ContextMenuItem.tsx` owns the submenu safe-triangle through a `createSafeTriangleTracker`
   instance held in a ref, rather than the per-render `trackSafeTriangleMove` /
   `clearSafeTriangle` closures upstream attaches and detaches. Arming requires
   `submenuOpen === true`, so the armed handler always came from a later render than the one
   the unmount cleanup (`useEffect(..., [])`) captured: `removeEventListener` never matched, and
   every hover-then-close cycle left a live document `mousemove` listener calling
   `setSubmenuOpen` on an unmounted component. A single tracker fixes the identity for the
   item's lifetime. Covered by
   `tests/vendored-design-system-context-menu-safe-triangle.test.ts`. Upstream-PR candidate.
9. `utils/announce.ts` rounds the time to tenths *before* splitting hours and minutes off.
   Upstream splits first and rounds the seconds remainder afterwards, so the remainder can reach
   60 with nothing to carry into — `formatTimeForA11y(59.97)` announced "60 seconds" and
   `(119.98)` "1 minute 60 seconds". Every clip `aria-label` in `TrackNew` is built from this.
   Covered by `tests/vendored-design-system-announce.test.ts`. Upstream-PR candidate.
10. `TrackControlPanel.tsx` takes a `returnFocus` argument on `commitRename` and passes `false`
    from the rename input's `onBlur`. Upstream sets the focus-return flag unconditionally, and
    because `commitRename` is also the blur handler, ending a rename by clicking another control
    pulled focus straight back to the track-name span, away from the control the user just
    clicked. Keyboard commit and Escape-cancel still return focus. Covered by
    `tests/vendored-design-system-track-control-panel.test.ts`. Upstream-PR candidate.
11. `Clip.css` carries the clip wrapper's resting `z-index: 2` (and the mouse-focus rule resets
    to that level rather than `auto`), and `TrackNew.tsx` no longer writes it inline. Upstream
    added `[data-clip-id]:focus { z-index: 5 }` while the wrapper still got an inline
    `zIndex: … : 2`, which no stylesheet declaration can outrank, so a keyboard-focused clip
    stayed at 2 and a later overlapping sibling painted over its focus ring — exactly what the
    rule exists to prevent. Dragged and raised clips keep their inline `10`. Covered by
    `tests/vendored-design-system-track-new.test.ts`. Upstream-PR candidate.
12. `TrackNew.tsx` scopes the time-selection band through `isTrackInTimeSelectionScope`, which
    treats an **empty** `timeSelection.tracks` array as unscoped. Upstream tests the array for
    truthiness alone, so `tracks: []` excluded every row — contradicting the contract documented
    on the type itself (`core/src/types/index.ts`: "Empty / undefined = consumers fall back to
    selectedTrackIndices, then to their own default scope"). Covered by
    `tests/vendored-design-system-track-new.test.ts`. Upstream-PR candidate.
13. `TrackControlPanel.tsx` arms the drag-to-reorder document listeners from `mousedown` and
    drops them on `mouseup`, instead of keeping them attached for the panel's whole lifetime.
    Upstream's always-on effect makes every pointer move anywhere in the editor run one
    immediately-returning handler per track, and re-attaches whenever the host passes an inline
    `onDragReorderDrop`. The armed-gate shape matches `Clip.tsx` and `ResizablePanel` in this
    same tree. Covered by `tests/vendored-design-system-track-control-panel.test.ts`.
14. `MusescoreIcon.woff2` is a deterministic browser-delivery derivative of the unchanged
    upstream `MusescoreIcon.ttf`, generated by pinned `wawoff2` 2.0.1. The TTF remains the
    provenance artifact; `musescore-icon.css` references only the WOFF2, and
    `npm run build:musescore-icon-font -- --check` verifies that the tracked derivative has not
    drifted. Covered by `tests/ui-font-assets.test.js`.
    Upstream-PR candidate.
15. `DialogHeader.tsx` draws the Windows-variant controls itself instead of printing the Segoe
    MDL2 Assets private-use codepoints `\uE8BB` (close) and `\uE922`/`\uE923` (maximize /
    restore), and `DialogHeader.css` no longer sets `font-family: 'Segoe MDL2 Assets'`. That
    font ships only with Windows, so on Linux — and anywhere else it is missing — the close
    button rendered as a missing-glyph box. Close now uses the tree's own bundled
    `Icon name="close"`, and maximize draws a CSS square through
    `.dialog-header__windows-glyph`. Covered by
    `tests/vendored-design-system-dialog-header-controls.test.ts`. Upstream-PR candidate.
16. `EffectSlot.tsx` and `EffectsPanel.tsx` accept a `replaceEffectOptions` prop that replaces
    `EFFECT_REGISTRY` as the source of the caret menu's swap list. The packaged registry holds
    three sample effects (Compressor, Limiter, Reverb), so every slot in the realtime rack
    offered only those three as replacements regardless of what the host actually implements.
    Omitting the prop keeps upstream behaviour. Covered by
    `tests/audio-editor-effect-slot-replace-options.test.tsx`. Upstream-PR candidate.

## Application-side adaptations

Not deviations — application code that had to change because upstream did. Listed because they
are the places where the two keyboard models meet, so a future sync should re-check them.

- `AudioEditorMenuBar.jsx` registers its open-menu key handling on `document` in the capture
  phase at mount. 0.10.1 made `ContextMenu` do the same and call `stopImmediatePropagation` for
  Tab and Escape, which beats React's root listener; registering at mount is what keeps the
  menubar ahead of the menu that opens later.
- `AudioEditorMixerPanel.jsx` no longer handles arrow keys on the send knob. 0.10.1 gave `Knob`
  its own arrow handling with the same step and bounds, so the panel's copy moved every send
  twice per press. Home and End are still the panel's.

## Syncing upstream

1. Clone upstream and export the vendored subset — `packages/{components,core,tokens}/`
   restricted to `src/**`, `package.json`, and top-level `*.md` — at both the recorded commit
   and the target tag.
2. Three-way merge rather than patch: in a scratch repo, commit the recorded-commit export as
   the base, branch this tree onto it as *ours* and the target export as *theirs*, then merge.
   Confirm afterwards that `diff` against *theirs* reproduces the local-deviation set exactly;
   that is what proves no deviation was silently dropped.
3. Update `UPSTREAM` and the `THIRD_PARTY_LICENSES.md` entry (version + commit + tag) together.
   Editing the notices file invalidates two pins in `config/ffmpeg-runtime-manifest.json`
   (`evidence.notices` and `review.payloadSha256`); refresh them with
   `repinFfmpegRuntimeEvidence` from `scripts/lib/ffmpeg-runtime-manifest.mjs`, which leaves the
   human attestation fields alone, or `audit:ffmpeg-runtime` fails.
4. Re-audit the portal selector list in `scripts/postcss-audacity-design-system.mjs` against
   new/renamed classes that render into `document.body` (dropdown/tooltip-style portals).
5. Run the full battery: `npm run check`, `npm run test:browser`, dev + desktop smoke.
