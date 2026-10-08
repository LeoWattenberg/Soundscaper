# Sixth user-path regression audit

Target: 200 additional distinct bugs. This audit is in progress and has not
reached the target. Its initial revision is `ee0d3fabd`; work is isolated on
`fix/user-path-bugs-round6`.

Only defects reached through ordinary menus, input fields, media imports and
authored projects qualify. A root counts after a causal failing regression and
corrected public workflow verification. Prior roots, sibling symptoms,
adversarial files, unavailable internal actions and setup failures do not count.

The registers distinguish verified fixes from changes awaiting public checks:

| Area | Register |
| --- | --- |
| Editing and timeline commands | [Editing](bugfix-round6-editing.md) |
| Dialogs and workspace controls | [Dialogs](bugfix-round6-dialogs.md) |
| Effects, generators and analysis | [Effects and analysis](bugfix-round6-effects-analysis.md) |
| Import, export and bin playback | [Import and export](bugfix-round6-io.md) |

Focused regressions run for each correction. The full Node suite is required
after each 50 verified fixes; the first milestone has not been reached.

The immutable checkout at `c85e613cf` verifies 25 distinct roots through
29 public Chromium regressions, all passing in 34.3 seconds
(`/tmp/soundscaper-round6-green5-browser.log`). The same cases across all three
engines report 84 passed and three Firefox failures involving audio observers
or recording setup; those additional failures are being investigated and are
not represented as passing (`/tmp/soundscaper-round6-green5-browser-all-engines.log`).
Full repository lint and TypeScript checks pass again, and both product builds
pass on this checkout. Changes awaiting a later immutable build remain separate
from that verified count.

The initial full Node run completed 23,948 tests across its two execution
batches. Its parallel batch reported 22 failures: 20 reference conformance cases
ran before the new worktree had its existing provisioned Python validators,
one older Freesound expectation retained the defective pagination behavior,
and the documentation index had not yet included these new registers. The
validators are now copied locally, the pagination expectation is corrected,
and the registers are indexed. This run is not recorded as passing.

The immutable checkout at `48e4cbe22` subsequently passes the complete Node
suite: 23,965 cases across two batches, 23,932 passed, 33 skipped and zero failed
(`/tmp/soundscaper-round6-green3-full-node.log`). Full repository lint and
TypeScript checks pass, alongside architecture, runtime audits, documentation
checks and both product builds. Public verification remains separately
recorded per root; a passing Node suite alone does not qualify a fix.

The corrections change UI and browser/controller behavior without changing
assistance runtime source pins, recipes, dependencies, archives or target
inventories. No manual **Update AI assets** run is required.
