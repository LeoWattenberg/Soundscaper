# Architecture and maintainability

The Vite entry selects a product from `src/soundscaper/` or `src/framescaper/`.
Both products depend on shared code in `src/common/`; the editor domain lives in
`src/common/editor/`, while React presentation belongs in its `ui/` directory.

## Controller ownership

Stateful editor coordination belongs in strict TypeScript under
[`src/common/editor/controller/`](../../src/common/editor/controller/).
Controllers may depend on editor domain and platform adapters, but never on
React UI, including for types. Shared vocabulary belongs beside its owning
domain rather than under `ui/`, and production source never imports `tests/`.

Controller code is grouped by the task whose state or side effects it owns:

| Maintainer task | Owning domain | Boundary |
| --- | --- | --- |
| Run reports and transient or Vamp analysis | [`analysis`](../../src/common/editor/controller/analysis/) | Isolates track analysis on detached documents, owns progress/result publication, and validates worker results. |
| Prepare optional local assistance and publish reviewed results | [`assistance`](../../src/common/editor/controller/assistance/) | Owns selected-media preparation, model choice, review authority, semantic-index custody, and text-to-speech project services. |
| Capture media and recover or publish takes | [`capture`](../../src/common/editor/controller/capture/) | Owns Framescaper capture sessions, origin/write fences, Web VCR adaptation, and post-commit derivatives. |
| Coordinate clip and video edits | [`clip-video`](../../src/common/editor/controller/clip-video/) | Owns frame-canonical clip workflows, source reprobe, exact preview, committed time/pitch rendering, and video effects. |
| Assemble the controller and its public actions | [`composition`](../../src/common/editor/controller/composition/) | Wires domain ports, product policy, startup/disposal, snapshots, presentation state, and the action facade. |
| Mutate, save, open, lock, and retain documents | [`document`](../../src/common/editor/controller/document/) | Owns history, project mutation, sessions, saves, views, feature compatibility, annotations, folders, archives, and media consolidation or trim. |
| Apply clipboard and generator edits | [`edit`](../../src/common/editor/controller/edit/) | Owns paste policy and conversion plus generated-audio insertion. |
| Select, configure, and execute effects or macros | [`effects`](../../src/common/editor/controller/effects/) | Owns effect selection and controls, Audacity tools, spectral/audio processing, macro execution, and result writing. |
| Render and deliver project output | [`export`](../../src/common/editor/controller/export/) | Owns immutable export snapshots, audio/video strategies, presets, interchange, stem archives, and temporary output. |
| Import projects and media | [`import`](../../src/common/editor/controller/import/) | Owns project-bin import, linked-video relink, audio decoding, DAWproject/SESX, raw PCM, and Freesound ingest. |
| Read and persist editor preferences | [`preferences`](../../src/common/editor/controller/preferences/) | Owns setting persistence, preference actions, skin preview, and translation drafts. |
| Record audio and manage take cycles | [`recording`](../../src/common/editor/controller/recording/) | Owns recording state, routing/capture coordination, metering, sound activation, finalization, and take recovery. |
| Reuse controller-only primitives | [`shared`](../../src/common/editor/controller/shared/) | Provides lifecycle, owned-state, capacity, progress, deferred-facade, and transient-render contracts without becoming a second feature owner. |
| Read, retain, analyze, and present source media | [`source`](../../src/common/editor/controller/source/) | Owns source lifetime, chunk access, waveforms, time/pitch caches, visual sources, and application of a document to playback. |
| Coordinate tracks and audio production | [`track-audio`](../../src/common/editor/controller/track-audio/) | Owns track actions, derived-audio rewrites, take comping, audio warp, selection views, and mix/render planning. |
| Drive playback and transport state | [`transport`](../../src/common/editor/controller/transport/) | Owns playhead and transport state, playback preparation, meters, metronome, speed, and display toggles. |

A source file directly under one of these domains is public to the controller;
same-domain implementation belongs under `internal/`. The exact public inventory
and allowed runtime or type-only dependency directions live in
[`controller-domain-policy.json`](../../config/controller-domain-policy.json).
The architecture gate rejects undeclared domains and public modules, root source
files, barrels, new dependency directions, runtime upgrades of type-only edges,
and cross-domain imports of internal files. Consumers import the narrow owner
directly. After removing a direction, run
`npm run check:controller-domains:tighten` to claim it.

Domain compositions accept declared dependencies and return typed ports; the
composition root wires them without granting one domain mutable access to
another's state. The active document has one typed history owner in
[`document-state.ts`](../../src/common/editor/controller/document/document-state.ts),
and every project mutation goes through that owner. Recording and transport keep
separate writable state while the compatibility facade exposes stable read-only
views. Lazy export receives a bounded workspace projection rather than the whole
controller. Product-specific absence is represented by typed stand-ins chosen at
composition, not by casts or open string indexes.

[`index.js`](../../src/common/editor/index.js) and
[`facade.ts`](../../src/common/editor/facade.ts) form the curated external editor
facade; editor implementation modules may not import it. The architecture gate
also enforces this core-to-UI direction and rejects dependency cycles.

The rules live in `.dependency-cruiser.cjs`, and `npm run check:architecture`
cruises `src`, `desktop` and `native` -- all three, because `desktop/` is not
only the Electron main process. It is also where the renderer/main contracts and
the bundled stream parsers live, and browser code reads them. That boundary is
one-way and enumerated: `src/` may import the eight shared desktop modules named
at the top of the configuration and nothing else under `desktop/`, may not
import any desktop module that imports `electron`, and may not name `electron`
itself. `desktop/` and `native/` are held to the no-React and no-`tests/` rules
alongside `src/`.

Maintained sources are growth-frozen as soon as they reach the 550-line warning
band. `config/maintainability-allowlist.json` records those reviewed baselines
alongside the ratchets for legacy modules already over their hard ceiling. A
new file may not enter the warning band, and an existing file may not exceed its
recorded size. CI compares each warning-band file with its source at the
explicit base revision; local checks compare the working tree with `HEAD`, and
both follow Git renames. `npm run check:size:tighten` claims reductions and removes a
warning-band row after its file falls below 550 lines. The editor shell and
design-system stylesheet are already decomposed into focused modules; do not
rebuild either monolith.
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
instead of raising that ceiling. Its startup check also rejects a static import
path from either product's bootstrap chunk back to itself after chunks are emitted.

Product module substitutions are checked by `npm run typecheck:products`, which
runs TypeScript over Soundscaper and Framescaper in both browser and desktop
compositions. Its compiler host and Vite resolve substitutions by the imported
source file's path, so another directory's same-named file cannot be replaced
accidentally. This checks arguments and results at the actual consumer, including
dynamic imports.
Disabled implementations retain their owning module's type contract through
explicit type-only imports. The ordinary source check still checks the default
graph, and export-parity tests guard substitution coverage.
Each browser project environment loads its desktop library bridge only when the
preload global is present; ordinary browser startup keeps that renderer code out
of its static graph.

Autosave retains an immutable document generation during its debounce and only
materializes the snapshot when saving starts. Preparation and persistence share
one failure boundary. Controller history compaction memoizes immutable past
snapshots with weak keys; the present is always recomputed because clipboard
roots can change without a document edit. The public document snapshot and
controller project getter expose detached, frozen views with stable identity for
each source revision. A writable project lock claims a durable write token;
autosave compares that token and the exact stored document in the same IndexedDB
transaction as publication. Lock recovery stays read-only if the stored document
changed while write access was unavailable. Desktop project libraries check the
same expected document and a main-owned writer token at the SQLite commit point;
an unchanged save checks both in main as well. Internal project publications that
replace the active revision refresh the autosave baseline before admitting the
next save.
Scape replacement imports hold that write authority through their exact-current
publication and rollback. A same-ID replacement installs the committed document
as fresh session history; rollback leaves staged assets intact if ownership has
changed and they may now be referenced by another writer.

Long-source playback sends PCM packets and acknowledgments over a direct
worker-to-worklet MessageChannel. The main thread still serves storage reads and
transport control. Live playback prepares streamed clips within a five-second
lookahead, with at most eight preparations in flight; realtime rendering keeps
its eager preparation and completion barrier.

The opt-in [realtime stack worker backend](realtime-effect-workers.md)
defines a shared block pipeline and a bounded DSP worker pool for independent
effect stacks, including latency, automation, and buffer ownership requirements.
