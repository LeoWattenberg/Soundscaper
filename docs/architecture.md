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
narrow owning module directly. The active document has one typed history owner
(`controller/document-state.ts`); its project accessor derives from that
history. Autosave owns its queue and timers, reports save status through its
publish port, and exposes a drain port rather than sharing mutable queue fields
with unrelated services. The action assembly has a closed dependency inventory
and checks missing callable ports during construction. Its public facade
preserves inferred action signatures instead of asserting an unrelated
controller shape. Legacy command payloads remain a staged typing boundary.

Domains leave the composition root as typed compositions. Recording is the
first: `controller/recording-state.ts` owns every recording field (the flat
controller state exposes them as live accessors for legacy readers), and
`controller/recording-composition.ts` builds routing, capture, finalization,
take-cycle, timed and session services from one declared dependency contract,
so the compiler checks their wiring and the root only supplies ports. Where two
services described one object differently (the routed loudness meter, the
source writer's commit result, the input stream) the contract was unified
rather than cast. Transport follows the same shape: `controller/transport-state.ts`
owns the playhead, transport state, meters, play-at-speed and playback-cache
preparation, the metronome and the playback display toggles, and
`controller/transport-composition.ts` builds the transport and view-state
services, whose runtimes are now declared rather than `any`-indexed and generic
over the document shape the root supplies.

`index.js` and `facade.ts` form the curated
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

Product module substitutions are checked by `npm run typecheck:products`, which
runs TypeScript over Soundscaper and Framescaper in both browser and desktop
compositions. Its compiler host reads the same ordered alias table as Vite; this
checks arguments and results at the actual consumer, including dynamic imports.
Disabled implementations retain their owning module's type contract through
explicit type-only imports. The ordinary source check still checks the default
graph, and export-parity tests guard substitution coverage.

Autosave retains an immutable document generation during its debounce and only
materializes the snapshot when saving starts. Preparation and persistence share
one failure boundary. Controller history compaction memoizes immutable past
snapshots with weak keys; the present is always recomputed because clipboard
roots can change without a document edit.
