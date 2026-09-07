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
- The root has shrunk from 1,372 to 981 lines in this pass; its size ceiling
  has been ratcheted down.

Remaining controller work:

- Extract remaining resource, project lifecycle, and product capture assembly
  into focused checked modules.
- Remove remaining arbitrary-value import dependency contracts, and check the
  composition root itself rather than relying on unchecked JavaScript callers.
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
