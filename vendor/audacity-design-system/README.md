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
