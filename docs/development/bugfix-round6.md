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
after each 50 verified fixes; the first milestone is now reached.

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
All 16 editing, 11 effects, seven qualifying I/O and 15 dialog roots are
publicly verified on that snapshot: 49 distinct fixes. Its canonical non-browser
gate remains in progress. The initial browser-suite attempt is interrupted; it
is not recorded as passing. The subsequent immutable snapshot at `03748a70e`
restores the original read-only policy and verifies the independent metadata
composition owner through all nine public Chromium, Firefox and WebKit paths
(`/tmp/soundscaper-round6-metadata-composition-green8-browser.log`). That brings
the verified count to 50. The full Node suite runs at this milestone
(`/tmp/soundscaper-round6-checkpoint50-repaired-full-node.log`). Concurrent
browser batches cause previously passing cases to exceed their unchanged
time limits while the host pages heavily, so the additional full browser run
is interrupted and will resume after the full Node run. Its interrupted
results are not passing evidence; focused public results remain recorded
individually. Later source corrections still await their own public GREEN.

The milestone Node run on `03748a70e` completes 24,128 cases across its
execution batches: 24,092 passed, 33 skipped and three failed. The exact
projection-consumer inventory lacks two newly extracted owned adapters; a
workspace-menu support expectation still selects its disabled first item; and
a program-name fixture does not update the saved prop after an Enter commit.
These failures remain failures until their faithful support corrections and a
full rerun pass. No test is skipped and no architecture gate is relaxed.

The same immutable public batch passes every new track, output, timeline label,
folder and marker composition workflow, Manage labels, native capture-setting
retention and delivery-report identity across all three engines. With the
separately corrected metadata fixture, 58 distinct roots are now publicly
verified. Inline clip naming remains incomplete in this build and is excluded;
its ancestor-propagation follow-through awaits a later immutable verification.
The other failing audio workflows had previously passed unchanged; their
load-related timeouts are kept as failed run results pending unchanged retries
(`/tmp/soundscaper-round6-green8-public-browser.log`, 196 passed, 20 failed).

The repaired first-milestone full Node suite on immutable `81a707b96` passes
24,179 tests across its two execution batches: 24,146 passed, 33 skipped and
zero failed (`/tmp/soundscaper-round6-checkpoint50-green9-full-node.log`).
The three faithful support corrections are verified by that complete rerun.
Both product builds pass. The independent translation-surface composition
workflow passes all three engines on this same build after correcting its
reopen-language fixture (`/tmp/soundscaper-round6-translation-composition-final-green9-browser.log`).
That brings the individually verified count to 59; the larger public batch
remains in progress. The unsupported recording-dialog command hypothesis is
retired and excluded with zero count.

The complete `81a707b96` public batch finishes with 255 passed and six failed
(`/tmp/soundscaper-round6-green9-public-browser.log`, 261 checks). Three are
the excluded recording-dialog command hypothesis. The other three reach the
repaired translation composition, saving and ordinary dismissal assertions,
then use the wrong reopen locale; the same build separately passes all three
corrected complete workflows. Every other check passes, including unchanged
retries of the prior load-related failures. Editing 001–025, effects 001–014,
ten qualifying I/O roots (001–003 and 005–011), and twenty qualifying dialog
roots (001–018, 020–021) give 69 distinct publicly verified fixes. Source edits
after that immutable build remain pending and do not add to this count.

The next immutable checkout `68655eafb` builds both products and passes all
78 focused public checks across Chromium, Firefox and WebKit
(`/tmp/soundscaper-round6-green10-public-browser.log`, 6.2 minutes). It adds
editing 026–028, effects 015–016, I/O 012–015 and dialogs 022–025: thirteen
newly verified roots, giving 82 distinct fixes. The same run verifies the
uncounted Nyquist track-index and Arabic metadata-tab follow-through, plus
the corrected translation persistence fixture. Later committed source
corrections are still pending. The canonical complete browser suite now runs
on this snapshot with a working Pulse backend and isolated ports
(`/tmp/soundscaper-round6-checkpoint50-green10-full-browser.log`); it is not
yet recorded as passing. The next complete Node checkpoint is at 100 verified
fixes.

The immutable `a870804cd` delta passes all 48 public checks across Chromium,
Firefox and WebKit (`/tmp/soundscaper-round6-green11-public-browser.log`).
It verifies two additional editing roots, two effects roots and three dialog
roots, bringing the distinct verified count to 89. Native video-proxy file
materialization is verified as an uncounted follow-through of I/O 015. Both
product builds and the required complete bounded repository lint pass
(`/tmp/soundscaper-round6-green11-build.log`,
`/tmp/soundscaper-round6-green11-full-lint.log`). The canonical first-milestone
browser suite still runs against `68655eafb`; its external Nyquist catalog
installation test reports Failed to fetch and remains a failed result pending
investigation. Source-ready later roots await their own public GREEN.

The catalog-fetch failure is isolated by an unchanged Chromium retry against
`68655eafb`, which also reports Failed to fetch before any focus assertion.
Both prior Nyquist workflows now reuse the already committed publication
manifest, metadata and Ten Band EQ source fixture used by the established
Get effects smoke test. Installation/removal focus and actual audio processing
with Undo/Redo pass all six Chromium, Firefox and WebKit checks against the
same application build (`/tmp/soundscaper-round6-checkpoint50-archive-fixture.log`).
This test-support correction adds zero bugs; the complete suite run still
retains its failure until a full corrected rerun passes.

The immutable `8d9d45ff4` delta passes all 36 public checks across the three
browsers (`/tmp/soundscaper-round6-green12-public-browser.log`). It verifies
neutral native-rate source scheduling, equivalent Vocoder carriers, ordinary
closed WebVTT voices and omitted routing-level admission. That brings the
verified count to 93. ADM removal also passes its public export controls, but
remains excluded pending preservation of track identities that survive a
compound replace operation. The original inspector workflows remain green.
Both product builds pass; its required full repository lint is still running.

The immutable `3dfdeb038` delta reports ten passed and five failed checks
(`/tmp/soundscaper-round6-green13-public-browser.log`). Both ordinary Freesound
loading and already-loaded Pause/Resume workflows pass all three engines,
qualifying dialog 030. Bitcrusher passes Chromium and WebKit; its Firefox run
prints correct retained PCM comparisons before exceeding the unchanged overall
30-second deadline. An unchanged isolated Firefox retry on that exact build
passes in 13 seconds (`/tmp/soundscaper-r6-effects-bitcrusher-hold-boundary-green13-firefox-retry.log`),
qualifying effects 020. Native capture checks remain incomplete and uncounted.
The verified total is 95 distinct fixes. Green12's required complete repository
lint also finishes successfully (`/tmp/soundscaper-round6-green12-full-lint.log`).
Recording notes composition, loudness weighting, ADM removal and skin modified
navigation changes await their own immutable public checks.
