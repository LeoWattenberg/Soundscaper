# Architecture review follow-through

This records the original review's completion criteria. A service extraction on
its own does not close the controller finding.

| Finding | Completion criterion | Status |
| --- | --- | --- |
| Autosave preparation failures can leave the editor stuck saving | Preparation, cloning, validation, and persistence failures publish an error and retain recoverable dirty state; regression tests cover retries | Implemented |
| Snapshot work happens before debounce; retention rescans unchanged history | Clone once after settling, retain immutable snapshots until then, and cache historical source metadata without caching mutable clipboard roots | Implemented |
| Product aliases escape consumer type checking | Compile the real consumers using each browser/desktop product's ordered alias resolution | Implemented for all four compositions |
| Storage upgrade documentation promises a destructive reset | Document the implemented migration behavior | Corrected |
| Controller assembly is oversized and weakly typed | Focused strict TypeScript owners, a bounded composition root, action signatures derived from their owners, explicit state authority, and verified lifecycle behavior | In progress |

Completed controller changes:

- Deferred synchronous and asynchronous bindings preserve owning signatures,
  receivers, and error behavior without reading services before initialization.
- Snapshot and preference composition have checked owners and regression tests.
- Disposal has an idempotent owner, isolates cleanup failures, and waits for
  source readers before retiring source storage.
- Action methods and resources derive their contracts from owning modules.
  Recording, preferences, macros, video, and sequence actions no longer erase
  their public signatures behind an arbitrary-value facade.
- Macro frequency selection now writes the canonical frequency fields and
  preserves an edge omitted from the macro request.
- Resource creation, startup, native project operations, project bootstrap,
  lock/switch assembly, and optional product capture have focused checked owners.
  Tests cover startup disposal races, PCM transfer ownership, native-operation
  progress cleanup, capture absence, and shared project-lock ownership.
- Audio import has a closed, named dependency contract. Partial fault-injection
  fixtures are admitted only through a test helper, outside the production graph.
- Workspace state preserves document/history types and declares mutable fields
  using their owners' contracts; delivery presets are initialized before bootstrap.
- Document and cache input contracts no longer require transient clip coordinates.
  Mutation, effect, and mix-render ports use their consumers' actual signatures.
- Runtime admission preserves typed hosts' selected method results, including
  product family identity, while publishing only the supported runtime ports.
  Unknown host input retains the existing compatibility contract.
- The root has shrunk from 1,372 to 737 lines across these passes; its size ceiling
  has been ratcheted down.

Further boundary cleanup:

- Analysis cache reads admit unknown stored data and recompute malformed results.
- Video visual activation validates stored bodies and derivative metadata before
  creating object URLs; failed admission releases resources already acquired.
- Source reads preserve the destination audio buffer type through storage, and
  the real store is checked against the source-runtime composition contract.
- Snapshot ports use the preview and macro records their owners publish. Meter
  interfaces have a focused owner and share the recording track contract.
- The default native archive copier binds the active product family. Real archive
  tests cover unchanged future Soundscaper and foreign-family Framescaper copies.
- Checked action composition connects the deferred owner bindings to the public
  facade, preserves explicit overrides, and fences retained callbacks on disposal.
  Project switching retains the document/history types its owner requires.
- Project administration uses explicit project, history, session, save and source
  cleanup contracts. Its shared fixture satisfies them without a runtime cast.
  Capture-origin guards have a separate checked binding that reads the current
  capture owner and preserves denial before administration starts.
- Session mutations retain their result fields through source retirement; a
  compile-time regression checks the real session against the administration port.
  Settings persistence keeps the owning policy and value types through assembly.
- Deferred source bindings retain the concrete render engine, including its
  offline and streaming operations. Recording accepts the track owner's
  `undefined` result when it declines to create a track, without starting capture.
- Capture accepts native browser track capabilities and settings without requiring
  DOM interfaces to have dictionary index signatures. Snapshot admission still
  validates and clones those values before publishing them.
- Current Framescaper documents inherit their declared identity, selection and
  track fields directly. Redundant `Omit` operations no longer erase them through
  an inherited index signature. Image-sequence import names both supported
  document owners instead of relying on that erased contract.
- The root now has 704 lines, with its size ceiling ratcheted to match. This is
  still an unchecked composition root; these fixes do not close that remaining item.

Remaining controller work:

- Check the composition root itself rather than relying on unchecked JavaScript
  callers. Its remaining connections still expose mismatches between minimum
  project identity, canonical documents, and transient projections, as well as
  storage and host callback contracts. The extracted owners do not establish that
  the root supplies all of these contracts correctly.
- Keep document/history, recording, transport, and disposal authority with their
  owners; verify cancellation and source-retirement ordering across failures.
- Re-run the relevant validation after the remaining root and dependency work.

Validation of commits `0bfa84f2e` and `a49368dd8`:

- The full static gate passes, including full repository lint, all four product
  type-checking compositions, architecture and audit checks, documentation, and
  the production build. Changed-file lint also passes.
- The final Node suite passes: 16,247 passed and 24 skipped.
- The full Chromium run recorded 434 passed, 10 skipped, one failure, and one
  dependent test not run. The failed frozen-video preview workflow and its
  dependent export test both passed on the focused rerun. Four concurrent
  repetitions of the failed workflow also passed without a code change. The
  full-run failure was an evaluated-preview sample remaining at zero after
  the time display accepted the seek; it remains an intermittent validation
  finding, not a confirmed fixed defect.
- Fresh Node and Chromium coverage profiles pass every existing coverage floor:
  95.48% lines, 80.51% branches, and 89.38% functions overall. Coverage floors
  were not changed.

Validation of the next extraction pass (`f1455d696` through `d974e6ad0`):

- The full static gate and changed-file lint pass. All four product compositions
  are checked; this does not imply that the JavaScript composition root is checked.
- The full Node suite passes: 16,262 passed and 24 skipped.
- The full Chromium suite passes: 436 passed, 10 skipped, and no failures. Both
  browser products were rebuilt with hidden source maps. The previously
  intermittent frozen-video preview workflow passed in this full run.
- Production chunks remain under 500,000 bytes (largest: 492,017 bytes).
  Startup graphs remain within their existing budgets; there was no byte ceiling
  to tighten. The root's maintained size ceiling is now 737 lines.
- A fresh coverage-enabled Node run passed 16,272 tests with 24 skipped (including
  concurrent changes). Its profiles and only this Chromium run's profiles pass
  every coverage floor: 95.46% lines, 80.52% branches, and 89.41% functions overall.
  No coverage floors were changed.

After preserving selected runtime contracts in `ca506dfaa`, the final Node run
passed 16,279 tests with 24 skipped, and all four product type checks passed.
Full repository lint passed again; the final contract edits do not change emitted
runtime behavior. Concurrent capture work remains owned by its separate task.

Validation of the subsequent boundary repairs through `15ea401af`:

- The final full Node run passes: 16,338 passed, 24 skipped, no failures.
- Full repository lint completed, followed by changed-file lint for the final
  declarations and fixtures. All four product compositions, source, test and
  tooling TypeScript checks pass. The JavaScript root remains outside that check.
- Architecture, supply-chain and notice audits, documentation checks, and the
  production build pass. The largest JavaScript chunk is 492,049 bytes; startup
  graphs remain within their budgets and have no byte ceiling to tighten.
- The full browser suite passed across Chromium, Firefox and WebKit: 1,237 passed,
  101 skipped, no failures. After rebuilding for the later administration binding,
  all 45 project-interoperability and capture workflows passed across those browsers.
- The final Framescaper declaration repairs emit no runtime changes. Their 53
  project/image-sequence tests and 17 affected media/capture fixture tests pass.
- The root's size ceiling is ratcheted to 704 lines. Coverage floors, startup
  budgets and chunk ceilings were not weakened.
