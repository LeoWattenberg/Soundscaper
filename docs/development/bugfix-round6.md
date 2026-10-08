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
engines initially report 84 passed and three Firefox failures involving audio
observers or recording setup (`/tmp/soundscaper-round6-green5-browser-all-engines.log`).
The existing CI clock probe independently confirms the inherited WSLg audio
socket stays suspended. The already running CI null sink passes that probe;
all three unchanged Firefox workflows then pass on the same build
(`/tmp/soundscaper-r6-effects-io-firefox-null-sink-green5.log`). Thus every one of
the 87 public checks is verified with a working audio backend. Subsequent
Firefox runs use `PULSE_SERVER=unix:/tmp/soundscaper-ci-pulse-runtime/native`.
Full repository lint and TypeScript checks pass again, and both product builds
pass on this checkout. Changes awaiting a later immutable build remain separate
from that verified count.

The next immutable checkout, `1a269a3fa`, builds both products and runs
144 public checks across Chromium, Firefox and WebKit. Its initial run reports
131 passed and 13 failed (`/tmp/soundscaper-round6-green6-browser-all-engines.log`).
Three failures occur after the repaired Record options focus assertion because
the test uses R rather than the existing P pause/resume binding; the unchanged
application passes all three corrected keyboard workflows
(`/tmp/soundscaper-round6-record-completion-green6-browser.log`). Two roots
remain incomplete: bin selection inherits its ancestor disabled state, and
spectral effect targeting broadens to an overlapping clip. Four native capture
checks also encounter missing browser track-format metadata before the causal
recording assertion; their portable proof remains under investigation. All 13
editing roots, eight effects roots (excluding 007), five I/O roots (excluding
004, with 006 verified through both native-rate Chromium captures), and 11
dialog roots give a verified count of 37. Pending source corrections do not
add to that count. The first full-suite milestone remains at 50.

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

The immutable `e139818a9` first50-candidate snapshot passes 177 of 183 public
checks across all three engines (`/tmp/soundscaper-round6-checkpoint50-round6-browser.log`).
Three failures show that the bin-selection hypothesis is unsupported: the real
controller deliberately forbids read-only selection. Its mocked helper fixture
hid that invariant, so its admission change and invalid regressions are
retired and the root remains excluded with zero count. The other three failures
follow repaired waveform and Undo assertions, but expect plural seconds for the
existing singular one-second accessible copy. The corrected fixture passes
all three full exported-PCM/Undo workflows on the same build
(`/tmp/soundscaper-round6-properties-warp-duration-green7-browser.log`).
All 16 editing, 11 effects, seven qualifying I/O and 15 dialog roots are now
publicly verified: 49 distinct fixes. The full canonical non-browser gate and
5,463-case browser run are in progress on this frozen candidate revision. A
subsequent snapshot at `03748a70e` restores the original read-only policy and
includes the independently reproduced delivery-report project-identity fix;
its public GREEN is needed to reach the first 50.
