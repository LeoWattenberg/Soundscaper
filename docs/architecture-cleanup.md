# Architecture review follow-through

All five findings from the original architecture review are addressed.

| Finding | Resolution | Status |
| --- | --- | --- |
| Autosave preparation failures can leave the editor stuck saving | Preparation, cloning, validation, and persistence failures publish an error and retain recoverable dirty state; regression tests cover retries | Complete |
| Snapshot work happens before debounce; retention rescans unchanged history | Clone after settling, retain immutable snapshots until then, and cache historical source metadata without caching mutable clipboard roots | Complete |
| Product aliases escape consumer type checking | Compile real consumers using the ordered production aliases for both products on browser and desktop | Complete |
| Storage upgrade documentation promises a destructive reset | Documentation describes the implemented migration behavior | Complete |
| Controller assembly is oversized and weakly typed | Focused strict TypeScript owners, a bounded and strictly checked composition root, owner-derived action signatures, one document/history authority, and lifecycle regressions | Complete |

## Controller and document ownership

The composition root is 694 lines, down from 1,372 at review. Its size ceiling is
694 and it is enrolled in the strict JavaScript gate. Its public options and
service bindings derive their contracts from the owning TypeScript modules;
production product substitutions and test fixtures compile against those ports.

Startup, resources, disposal, project switching, saving, retention, capture, and
native project operations have focused owners. Deferred bindings preserve method
signatures, receivers, and failures. Disposal is idempotent, isolates cleanup
failures, and waits for source readers before retiring storage. Regression tests
cover disposal during startup, late asynchronous work, and project-lock ownership.

Document state has one history authority. Session captures admit every history
entry through the selected runtime and retain their ownership token. Checkpoints
are minted by the controller and restore one history, preserving its exact present
identity. Product runtime selection retains its actual result types and refuses
malformed/accessor history and commands before mutation. Future and foreign
projects retain inert read-only custody without acquiring an editable schema.

## Authored documents and resolved consumers

Track, effect, generator, Nyquist, Project Bin, and playback consumers receive
resolved timing; commands and durable publication retain authored documents.
Musical clips keep their beat authority. Image/video clips and label tracks no
longer acquire fabricated PCM metadata or mandatory audio clip inventories.

Mix previews retain the document revision that produced their consumer view and
reject stale or foreign views. Project Bin previews resolve musical geometry
before creating sample-anchored preview clips. Source replacement checks resolved
source extents at the appropriate sample rate. Projection boundaries and rounding
policies are recorded in exhaustive source-discovered audits.

Take-cycle publication preserves the selected product's family/schema tuple; only
the common fallback requires V17. A real Soundscaper publication regression checks
its history entry and exact present identity. Capture proxy publication admits a
complete history before installing it through the same authority.

Audio buffer creation preserves concrete buffer types through effects and
generated audio publication. Web Audio and planar PCM share a channel reader.
Cache admission rejects malformed inventories before cancellation or retention
changes. The shared recording factory has a checked Framescaper adapter that
preserves browser host identity and awaits chunk delivery. Optional capture
implementation stays deferred until its menu-driven setup gesture.

## Validation

- The canonical static gate passed: full repository lint; source, desktop,
  strict JavaScript, all four product-composition, test and tooling type checks;
  architecture and size checks; dependency/security audit; documentation checks
  and build; and the production application build.
- The full Node suite passed 16,469 tests, with 24 existing skips and zero failures.
- The full Chromium/Firefox/WebKit run passed 1,236 tests with 101 skips and one
  Firefox capture timeout. The diagnostic showed capture entered recovery when
  storage could not keep up during concurrent Node/browser workloads. That exact
  case passed in 9 seconds with one worker, including pause/resume, import, and
  reopen, bringing all 1,237 non-skipped cases through successfully.
- Both products were rebuilt with hidden source maps outside the served bundles.
  Fresh Chromium coverage passed 436 tests with 10 skips and no failures or
  retries. The capture/import/reopen case also passed under coverage.
- The fresh Node and Chromium profiles were merged in `coverage/all` and checked
  with `node scripts/check-coverage.mjs coverage/all`. Every production scope
  passed its existing line, branch and function floors. The Node-only report is
  not the union those floors measure.
- Both product builds passed their asset and chunk guards. The largest JavaScript
  chunk is 492,078 bytes, below the 500,000-byte ceiling.

The source-size and startup-byte ratchets were run. No ceilings or coverage floors
were raised to accommodate the cleanup.
