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
  ~25 of 117 components. Component modules import their own CSS; that is the delivery path.
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
4. `/* @__PURE__ */` on `PreferencesContext.tsx`'s `createContext` call: when the module's
   exports are unused, rolldown otherwise keeps the bare call while dropping its import
   binding, which throws `ReferenceError: createContext is not defined` at boot.
   Upstream-PR candidate.

## Syncing upstream

1. Clone upstream, diff the recorded commit against the target tag, restricted to
   `packages/{components,core,tokens}/{src,package.json}`.
2. Apply onto this tree; resolve conflicts against the local-deviation commits.
3. Update `UPSTREAM` and the `THIRD_PARTY_LICENSES.md` entry (commit + tag) together.
4. Re-audit the portal selector list in `scripts/postcss-audacity-design-system.mjs` against
   new/renamed classes that render into `document.body` (dropdown/tooltip-style portals).
5. Run the full battery: `npm run check`, `npm run test:browser`, dev + desktop smoke.
