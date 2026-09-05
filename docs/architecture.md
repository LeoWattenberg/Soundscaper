# Architecture and maintainability

The Vite entry selects a product from `src/soundscaper/` or `src/framescaper/`.
Both products depend on shared code in `src/common/`; the editor domain lives in
`src/common/editor/`, while React presentation belongs in its `ui/` directory.

New stateful editor coordination belongs in strict TypeScript under
`src/common/editor/controller/`. Controllers may depend on editor domain and
platform adapters, but must not import React UI -- including for a type, which
the rules now see. Domain vocabulary a controller needs therefore does not live
in `ui/`: the local assistance types are in `src/common/editor/assistance/`, and
a shape both a presentation module and editor core name gets its own contract
module beside the domain rather than inside the surface that happens to use it.
Production source must never import `tests/`. Within the editor, import the
narrow owning module directly. `index.js` and `facade.ts` form the curated
external facade; editor implementation modules may not import it. The former
`app.js`/`index.js` cycle has been removed, and the architecture check prevents
any cycle from returning while enforcing the core-to-UI boundary.

The rules live in `.dependency-cruiser.cjs`, and `npm run check:architecture`
cruises `src`, `desktop` and `native` -- all three, because `desktop/` is not
only the Electron main process. It is also where the renderer/main contracts and
the bundled stream parsers live, and browser code reads them. That boundary is
one-way and enumerated: `src/` may import the eight shared desktop modules named
at the top of the configuration and nothing else under `desktop/`, may not
import any desktop module that imports `electron`, and may not name `electron`
itself. `desktop/` and `native/` are held to the no-React and no-`tests/` rules
alongside `src/`.

Remaining large legacy modules and integration suites are ratcheted in
`config/maintainability-allowlist.json`. Their limits capture the reviewed
baseline; new behavior should be extracted rather than increasing a limit, and
a smaller file must lower its recorded limit in the same change. The editor
shell and design-system stylesheet are already decomposed into focused modules;
do not rebuild either monolith.
`npm run check:architecture` enforces both dependency rules and
a 600-line default ceiling and an 800-line browser-spec ceiling.
`eslint-suppressions.json` similarly records exact
counts for pre-existing lint debt while leaving new violations unsuppressed.
TypeScript linting resolves the strict projects and rejects floating or
misused promises; Node's test-registration function is the sole known-safe
promise-returning call.

Use the narrowest useful feedback loop:

| Change | Minimum check |
| --- | --- |
| Domain/helper/controller | `npm test` and `npm run typecheck` |
| Vite or React UI | `npm run build` |
| User interaction | `npm run test:browser` |
| Patch, WASM, codec, or notice metadata | Matching `audit:*` command |
| Before review | `npm run check` |

`npm run test` runs both JavaScript and TypeScript Node tests through `tsx`.
Browser tests deliberately remain a separate CI job so their diagnostics can be
retained without obscuring fast structural failures.

The production Vite build uses ordered semantic chunk groups for React and the
design system, editor engine, storage/model, controller/core, timeline, shell,
and remaining vendor code. Keep a module in the narrowest owning group and
verify the resulting dependency DAG before changing those priorities. The build
fails when any emitted JavaScript chunk exceeds 500,000 bytes; split ownership
instead of raising that ceiling.
