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

The immutable `756da708e` delta passes 32 of 33 checks across Chromium,
Firefox and WebKit (`/tmp/soundscaper-round6-green14-public-browser.log`).
ADM's unchanged-ID split control exceeds Firefox's original 30-second overall
deadline during history menu navigation; no ADM/state assertion fails. The
unchanged isolated Firefox retry on that exact build passes in 19.6 seconds
(`/tmp/soundscaper-r6-edit-adm-track-replacement-green14-firefox-retry.log`).
All deletion, surviving-ID replacement and bus-removal/reassignment controls
are now green. Together with loudness weighting, notes composition, skin
navigation and routing pointer admission, this qualifies five additional roots
and reaches **100 distinct verified fixes**. Positive Speed Delay's complete
Preview/Apply PCM comparison also passes all three engines as an uncounted
follow-through of effects 017. Both guarded product builds pass.

The full 100-fix canonical non-browser gate starts on that exact immutable
source (`/tmp/soundscaper-round6-checkpoint100-canonical.log`); it includes the
complete Node suite after its static checks and is not yet recorded as passing.
The first checkpoint's complete browser suite still runs against `68655eafb`,
with its failures retained. The full 100-fix browser checkpoint is queued after
that run so complete suites do not overlap. Later source-ready roots remain
uncounted until their own public checks pass. The target remains 200.

The immutable `de04b82c9` delta completes 33 checks with 13 passed and 20 failed
(`/tmp/soundscaper-round6-green15-public-browser.log`). Chromium verifies the
guided crop, keyframe transfer, ruler loop and spectrogram corrections. Native
microphone/screen persistence and short capture Stop passed Chromium on the
preceding immutable `756da708e`; WebKit now passes those four cases and both
microphone-only monitoring controls. These actual public workflows qualify
editing 033, effects 022, dialogs 034–035 and I/O 017–019, bringing the distinct
verified count to **107**. Each has causal regression and focused GREEN evidence;
portable failures are retained separately from that reachability qualification.

The unchanged isolated Firefox ruler workflow passes on `de04b82c9`
(`/tmp/soundscaper-r6-edit-ruler-loop-button-green15-firefox-retry.log`). Other
unchanged retries retain setup, audio-observer or overall-deadline failures.
No assertions, deadlines, pressure ceilings or coverage gates are relaxed.
Unrelated host workloads exhaust swap and cause substantial scheduling delays;
new portable retry batches are deferred while that load persists. Both guarded
product builds pass on the next immutable `9bd6730b2`, whose Chromium delta is
in progress (`/tmp/soundscaper-round6-green16-chromium.log`). The full 100-fix
canonical gate has passed repository lint and is still running its static checks
before the complete Node suite. The target remains 200 and work continues.

Uncounted exclusion: the production Soundscaper menu stand-in deliberately omits
native analyzer entries. Parameter and publication hypotheses in the Vamp dialog
therefore have no normal shipped menu path; their probes are removed without a
source change or qualifying count.

The immutable `9bd6730b2` Chromium delta passes Clip Properties lock/unlock,
the browser PNG control, bounded Speed Delay Preview/Apply PCM parity and valid
Paulstretch resolution (`/tmp/soundscaper-round6-green16-chromium.log`). Its
three initial failures remain recorded: native image cleanup was observed
synchronously before its release completed; the compressor export used the
default24-bit dither although its exact-zero assertion required float PCM; and
the color-composition workflow reached its repaired assertions before exceeding
its unchanged overall deadline at the last cancellation control.

The native image fixture now awaits the same one release within its existing
budget; both browser and native PNG import/save/reload workflows pass on the
same product bytes (`/tmp/soundscaper-round6-green16-image-retry.log`,2/2).
The compressor selects ordinary32-bitFloat WAV output and passes its unchanged
finite-PCM, exact digital-zero and audible-tone assertions
(`/tmp/soundscaper-r6-effects-legacy-compressor-green16-float-export.log`).
The unchanged isolated color workflow passes as well
(`/tmp/soundscaper-round6-green16-color-retry.log`). These qualify editing034,
effects023, I/O020 and dialog036, giving **111 distinct verified fixes**.
The preview corrections are follow-through of effects017 and add zero count.
The canonical100-fix gate has passed all four production composition typechecks
and continues its complete test/tooling compilation. Full-suite results remain
pending; work continues toward200.

The immutable `449787703` passes both guarded product builds. Its Chromium
delta completes 7 of 8 public workflows
(`/tmp/soundscaper-round6-green17-chromium.log`): both locked-track Duplicate
menus preserve source protection and Undo/Redo; both browser and native
foreign-project Save As retain exact original archive bytes; Brown noise has
low/high octave energy ratio 3.6022166; native Parametric EQ multi-touch keeps
the second band's authored 500 Hz/0 dB while the first moves; and uppercase
RGBA text applies and reopens canonically. These qualify editing035, I/O021,
effects024–025 and dialog038, giving **116 distinct verified fixes**.

Dialog037's source-lock and allowed presentation assertions pass before its
final Unlock/reopen exceeds the unchanged overall deadline. The unchanged
isolated retry also reaches those assertions before the same overall deadline
(`/tmp/soundscaper-round6-visual-lock-green17-retry.log`). This root remains
pending complete public GREEN. The failed batch and retry are retained without
relaxing assertions or deadlines.

The full100-fix canonical gate has passed lint, production/test/tooling types,
architecture and documentation builds and is now running the complete Node
suite. It reports two earlier DSP snapshot failures and three desktop test
payload closure failures; these are under investigation and this gate is not
recorded as passing. The full50-fix all-engine browser suite is still running.
Full100 browser verification will follow it without overlapping full browser
suites. Work continues toward200, with source-ready candidates kept separate.

The identical dialog037 public workflow passes after the complete Node run
finishes (`/tmp/soundscaper-round6-visual-lock-green17-post-node.log`, 1/1,
14.8 seconds). Its source, fixture, assertions and deadline are unchanged, and
both earlier deadline failures remain recorded. This gives **117 distinct
verified fixes**.

The full100-fix canonical gate finishes with24,324 Node cases:24,286 passed,
five failed and33 skipped (`/tmp/soundscaper-round6-checkpoint100-canonical.log`).
The two mono Vocoder parity snapshots still expect the prior fixed bug;
substituting only that earlier owner restores both original signatures. Exact
corrected signatures and independent carrier continuity/routing controls pass.
The other three failures expose omitted native fixture dependencies in the
desktop nightly test payload. Its explicit inventory is completed, retaining
negative omitted-painter and native-lease closure checks (32/32 focused passing).
These narrow support corrections are committed and add zero bug count. A full
canonical retry on the next immutable snapshot remains required. Full50 browser
verification is still running; full100 browser verification follows it.

The immutable `d7cb58183` passes both guarded product builds. Its public
Chromium delta reports17 passed and two failures across19 cases
(`/tmp/soundscaper-round6-green18-chromium.log`). Completed workflows qualify
editing036, effects026–027, I/O022 and dialogs040–042. The two dialog039
failures occur after every repaired admission assertion and successful channel
conversion: the final observers use retired Audio clip accessible names. Using
the actual rendered clip names preserves both command/count expectations and
the same product bytes; both complete workflows pass12 seconds
(`/tmp/soundscaper-round6-track-menu-green18-retry.log`,2/2). This gives
**125 distinct verified fixes**: editing36, effects27, I/O21 and dialogs41.

The same batch also verifies the uncounted native BWF/AIFF-C purpose admission
and browser BWF recorder metadata follow-through. The full canonical100 retry
is running on this immutable snapshot
(`/tmp/soundscaper-round6-checkpoint100-green18-canonical-retry.log`). Full50
all-engine browser verification has entered WebKit; failed earlier runs are
preserved, and full100 browser verification follows it sequentially.

The immutable `18a33ffa1` passes both guarded product builds. The next three
public Chromium workflows pass the ADM stereo Split and live Echo Decay cases,
but Make stereo still loses the right-channel PCM despite passing the routing
metadata assertions (`/tmp/soundscaper-round6-green19-chromium.log`, two passed,
one failed). The exact decoded-audio assertions remain unchanged, and editing037
stays uncounted until its complete split/merge workflow passes. Effects028's
ordinary live edit retains its existing recurring echo, giving **126 distinct
verified fixes**: editing36, effects28, I/O21 and dialogs41. The full100 canonical
retry has passed static checks and entered the complete Node suite; full50
browser verification remains in progress.

The immutable `0b272a361` passes both guarded product builds and every one of
seven public Chromium checks (`/tmp/soundscaper-round6-green20-chromium.log`,
44 seconds). The unchanged ADM split/merge PCM assertions now preserve both
channels through Undo/Redo within2.384e-7 after isolating private track captures
from the authored programme router. Editing037, effects029, I/O023 and dialogs043–044
therefore qualify. This gives **131 distinct verified fixes**: editing37,
effects29, I/O22 and dialogs43. The floating-panel and camera-folder corrections
await their own later immutable public verification and are not counted here.

The full100 canonical retry on `d7cb58183` passes its complete static gate but
fails in its parallel Node batch:24,449 cases,24,414 passed,two failed and33
skipped (`/tmp/soundscaper-round6-checkpoint100-green18-canonical-retry.log`).
The older custom-toolbar fixture asks source mutations to dispatch on a locked
track, conflicting with the repaired canonical lock admission; its binding
control now uses an unlocked track and a separate locked control requires no
dispatch. The older native still-picker expectation retains media instead of
the existing corrected image purpose. These support corrections add zero count.
Their full canonical rerun remains required; this failed run is not passing
evidence. Full50 browser verification continues, followed sequentially by
full100 browser verification.

The immutable `4e4d8ac7b` passes both guarded product builds and all three
public Chromium checks in9 seconds (`/tmp/soundscaper-round6-green21-chromium.log`).
The camera-folder operation retains its linked picture/audio block from either
track menu, through atomic Undo/Redo and folder collapse. The floating-panel move
retains its first native touch when a second finger begins. Editing038 and
dialog045 therefore qualify, giving **133 distinct verified fixes**: editing38,
effects29, I/O22 and dialogs44. The next spectrum and timeline annotation changes
remain uncounted until later built public verification. The complete full100
canonical retry is running on this immutable snapshot with both faithful support
corrections (`/tmp/soundscaper-round6-checkpoint100-green21-canonical-retry.log`).
Full50 browser verification continues; full100 follows it sequentially.

The immutable `e2e2b5112` passes both guarded product builds. Native timeline
annotation and spectral-band multi-touch workflows pass in3.7 and3.4 seconds,
respectively (`/tmp/soundscaper-round6-green22-chromium.log`). Editing039–040
qualify, giving **135 distinct verified fixes**: editing40, effects29, I/O22
and dialogs44. Both short-spectrum checks reach the repaired refusal and absent
report, then fail at an empty global status observer. Their exact warning and
ordinary smaller-window recovery remain required; effects030 stays uncounted.
The playback-meter correction likewise awaits its later built public GREEN.

Both exact short-spectrum warning and the ordinary smaller-window level/frequency
recovery pass on the unchanged `e2e2b5112` build after observing its actual alert
region (`/tmp/soundscaper-r6-effects-spectrum-short-selection-browser-green22.log`,
2/2 in6.3 and6.7 seconds). Effects030 therefore qualifies: **136 distinct verified
fixes** comprise editing40, effects30, I/O22 and dialogs44. The caption Save Cancel
and playback-meter corrections remain source-ready and uncounted.

The immutable `ba2dac3c3` passes both guarded product builds and all six public
Chromium checks in48.7 seconds (`/tmp/soundscaper-round6-green23-chromium.log`).
The playback meter retains a silent right channel, native caption save cancellation
reports no completed publication, and project switching retains explicit No tracks
while its focused-track control still supports Remove/Undo/Redo. Dialog046, I/O024
and editing041 therefore qualify: **139 distinct verified fixes** comprise editing41,
effects30, I/O23 and dialogs45. The same build verifies the Arabic project-tab
direction follow-through, which continues the prior RTL family and adds zero count.

The complete first-milestone all-engine browser run on `68655eafb` finishes with
5,267 passed,196 skipped and150 failed in4.0 hours
(`/tmp/soundscaper-round6-checkpoint50-green10-full-browser.log`). Those failures
remain failed evidence, including external Nyquist fixture failures whose faithful
correction is separately recorded above; the complete run is not a PASS. The
next sequential full-browser checkpoint runs on immutable `ba2dac3c3` with two
workers and the working Pulse backend
(`/tmp/soundscaper-round6-checkpoint100-green23-full-browser.log`). No full-browser
suites overlap. The full100 canonical non-browser retry on `4e4d8ac7b` has passed
the static gate and is running its Node suite; its final result remains pending.

The complete full100 canonical retry on immutable `4e4d8ac7b` passes
(`/tmp/soundscaper-round6-checkpoint100-green21-canonical-retry.log`). All seven
bounded repository lint shards, every source/product/test/tooling typecheck,
architecture and size gates, runtime and license audits, handbook checks and
builds pass. Its isolated native protocol test and parallel Node batch total
24,491 cases:24,458 passed,33 skipped and zero failed. The coverage reporter
completes normally and retains the repository's existing combined-CI floor
policy; no floor is weakened. The sequential all-engine full100 browser run
on `ba2dac3c3` remains in progress. Later candidates are verified individually
and will be covered by the required150 checkpoint.

The immutable `97b556b6d` passes both guarded product builds and eight of ten
focused public Chromium checks (`/tmp/soundscaper-round6-green24-chromium.log`,
60 seconds). The actual camera attribution/CSV/save-reopen workflow, linked
Bass/Treble one-entry Undo/Redo, exact rate-effect Samples-versus-delivered WAV
and nonlinear Source trim retained PCM/Undo/Redo all pass. I/O025, effects031–032
and dialog047 therefore qualify: **143 distinct verified fixes** comprise editing41,
effects32, I/O24 and dialogs46. The automation native12px first-finger control
passes but secondary-release and20px pan checks still fail; editing042 remains
uncounted while its actual pointer payload and CSS authority are investigated.
The independently repaired workspace-resize admission also remains source-ready
until a later built public verification.

The immutable `050940077` passes both guarded product builds and all seven
focused public Chromium checks in28.4 seconds
(`/tmp/soundscaper-round6-green25-chromium.log`). Corrected native automation
pointer-release and20px pan workflows, ordinary/switched-camera OTIO delivery,
and single/two-finger floating-panel resize all pass. Editing042, I/O026 and
dialog048 therefore qualify: **146 distinct verified fixes** comprise editing42,
effects32, I/O25 and dialogs47. Earlier incorrect native pointer-release payloads
remain excluded. Recording-target admission, native plug-in idle topology and
hardware-input meter publication remain source-ready pending the next built
public verification. The full100 all-engine browser checkpoint continues;
the required150 canonical checkpoint will use a later immutable checkout.

The immutable `f44d878b0` passes both guarded product builds and all four
focused public Chromium checks in26.8 seconds
(`/tmp/soundscaper-round6-green26-chromium.log`). Ordinary authenticated native
plug-in idle startup, actual silent-right microphone monitoring, and focused/
multi-track locked-recording refusal with explicit new-track/Undo/Redo controls
all pass. Effects033, dialog049 and editing043 therefore qualify:
**149 distinct verified fixes** comprise editing43, effects33, I/O25 and dialogs48.
The independent ordinary-meter clipping warning and native long-name atomic Save
remain pending public verification on the next immutable checkout. The required
150 canonical run will cover those desktop helper and shared type changes; its
all-engine browser run is queued after the actual full100 browser completion.

The immutable `0729264e1` passes both guarded product builds and all five
focused public Chromium checks in20.4 seconds
(`/tmp/soundscaper-round6-green27-chromium.log`). Short and valid223-byte native
Japanese Save filenames complete actual atomic archive publication, and all
ordinary/EBU meter warning controls pass. I/O027 and dialog050 therefore qualify:
**151 distinct verified fixes** comprise editing43, effects33, I/O26 and dialogs49.
The required150 full canonical check is now running on that immutable checkout
(`/tmp/soundscaper-round6-checkpoint150-green27-canonical.log`), including full
repository lint and both Node execution batches. Its all-engine full browser
run is already queued behind the full100 parent process's actual completion
(`/tmp/soundscaper-round6-checkpoint150-green27-full-browser.log`); neither
checkpoint is reported as passing while pending. The recovered timeline
annotation size ratchet is lowered to550, and the shrunk desktop Save test
leaves its warning band; no size gate is weakened. Selected generator-target
admission, final native suggested-name suffixes, clipboard destinations and
late native parameter writes remain uncounted pending built public checks.

The immutable `435e1779e` passes both guarded product builds and all nine
focused public Chromium checks in39.7seconds
(`/tmp/soundscaper-round6-green28-chromium.log`). Selected generator replacement
and allowed cursor generation, locked Paste destination admission, all three
native parameter completion paths and native Save/New/Open-copy filename
round trips pass. Editing044, effects034, I/O028 and dialog051 therefore qualify:
**155 distinct verified fixes** comprise editing44, effects34, I/O27 and dialogs50.
The Source-header lock and captured-callback correction passes its complete
ordinary rename/Undo/Redo workflow as an uncounted EDIT034 follow-through.

The initial150 canonical run on `0729264e1` passes all seven bounded repository
lint shards, then fails strict source typing at the two common runtime-project
projection ports (`src/common/editor/app.js`404/580); its result remains failed
(`/tmp/soundscaper-round6-checkpoint150-green27-canonical.log`). The owning
callback contract is corrected without app casts or weakened typing in
`9255dd695`, included in `435e1779e`. The full canonical gate is now rerunning
on that corrected immutable checkout, including complete lint and both Node
execution batches (`/tmp/soundscaper-round6-checkpoint150-green28-canonical-retry.log`).
Its full all-engine browser checkpoint remains queued behind the running
full100 browser parent; pending runs are not reported as passing. Successful
Cut clipboard publication is source-ready and remains uncounted pending the
next built complete public workflow. No manual **Update AI assets** run is required.

The immutable `494a0a2b6` passes both guarded product builds. Its complete
14-check Chromium delta reports13passed and one failed in1.3minutes
(`/tmp/soundscaper-round6-green29-chromium.log`). The failure follows repaired
Resample native admission and both completed source-rate edits: its fixture
expects a dialog Close button on the workspace panel. A first corrected
panel-menu fixture reaches Undo but asks for the old clip title; both setup
errors are excluded. Using the existing panel menu and the actual resampled
clip title, all original native-default/focus/rate/Undo assertions pass on
the same immutable build in4.3seconds
(`/tmp/soundscaper-round6-resample-composition-green29-public2.log`).

Editing045/046, effects035/036, I/O029 and dialogs052–055 now qualify:
**164 distinct verified fixes** comprise editing46, effects36, I/O28 and dialogs54.
Ordinary Cut clipboard/history publication, protected timeline renaming,
restored native state controls, Nyquist and related numeric native composition,
actual binaural mapping delivery and ordinary library saving all pass.
No additional count is assigned to the pure shared-policy relocations.

The second150 canonical attempt on `435e1779e` passes full repository lint and
every source/product/test type check, then fails the unchanged dependency
cruise at five cross-domain imports
(`/tmp/soundscaper-round6-checkpoint150-green28-canonical-retry.log`). The owning
recording, Paste and exchange policies move into permitted common editor
modules in `bfe50ccee` and `b355c14fe`, preserving their exact runtime behavior
and callback contracts. The complete architecture gate then passes4746modules
and18192edges with unchanged controller and dependency rules; the new
projection type adapter receives its exact existing-audit classification.
The full canonical150 gate now reruns on corrected immutable `494a0a2b6`,
including full lint for shared structural/native-control types and complete
Node execution batches
(`/tmp/soundscaper-round6-checkpoint150-green29-canonical-retry.log`). The full100
all-engine browser run has entered Firefox; the full150 browser checkpoint
remains queued behind its actual completion. Pending gates remain pending.
No manual **Update AI assets** run is required.

The immutable `6f904d0ab` batch completes9of10 public Chromium checks in2.7minutes
(`/tmp/soundscaper-round6-green30-chromium.log`). Both guarded product builds pass
(`/tmp/soundscaper-round6-green30-build.log`). The final equalizer numeric case
passes native admission, preserved draft/focus and ordinary completion, then
asks for a nonexistent Apply button. Correcting its locator to the existing
Apply to selection control preserves the original behavior assertions; the
complete workflow passes on the same immutable product in8.7seconds
(`/tmp/soundscaper-round6-parametric-number-composition-green30-public.log`).
The fixture mistake adds no product bug and the initial failure remains recorded.

Editing047/048, effects037, I/O030 and dialogs056 now qualify:
**169 distinct verified fixes** comprise editing48, effects37, I/O29 and dialogs55.
The actual native one/two-finger video fades, stereo-divider mouse/keyboard/touch
controls, shared stepper ordinary/modified/composing keys with generated PCM,
ordinary short/long Japanese stem archives with real filesystem extraction and
native equalizer composition all complete. Variant controls add no extra count.
The full canonical150 rerun has passed static gates and entered the complete
Node suite; full100 Firefox and its queued full150 browser run remain pending.
No manual **Update AI assets** run is required.

The third canonical150 attempt on immutable494a0a2b6 completes all static gates
and both complete Node execution batches, then exits1 with two fixture failures
(`/tmp/soundscaper-round6-checkpoint150-green29-canonical-retry.log`). The isolated
batch passes1/1; the parallel batch has24664tests,24629passes,2failures and33skips
in916349.5ms. An older project-tab fixture omits the browser's getComputedStyle
primitive needed by the already verified RTL completion. The repository lint
inventory fixture also exceeds Git's default1MiB captured-output bound as this
checkout grows. Matching the production lint runner's existing bounded10MiB
capture preserves the exact complete-inventory and shard assertions; all6focused
lint-shard cases pass (`/tmp/soundscaper-round6-lint-inventory-node-green.log`) and
targeted type-aware lint passes. These fixture corrections add zero user bugs
and weaken no lint, architecture, coverage or behavior gate. A corrected immutable
canonical150 rerun remains required; the failed complete result is retained.

Immutablea8a5aaf38 (Green31) builds both products successfully. Its focused
Chromium batch has5passes and4failures in1.1minutes
(`/tmp/soundscaper-round6-green31-chromium.log`). Three additional roots complete
their public workflows: EFFECT038 native effect-picker composition,
EFFECT039 Reverb's actual stereo-pair WAV output, and DIALOG058 native search
selection, replacement and command activation. The verified count is172:
editing48, effects39, I/O29 and dialogs56. ADM numeric composition completes
DIALOG017 with zero added count. Video range ownership and touch track height
remain pending after causal public failures; their native browser and timeline
owners need further correction. Both labeled Cut variants initially fail a
later range fixture because the playhead icon covers its start hit target.
The existing Jump to project start action before redrawing the same range
preserves every clipboard/history assertion and completes both workflows on
this unchanged build in5.5/5.7seconds
(`/tmp/soundscaper-r6-edit-green31-labeled-cut-green.log`), adding zero count.
The fourth canonical150 run on the same immutable checkout remains active;
the full100 and queued150 browser suites remain pending. No manual
**Update AI assets** run is required.

The fourth complete canonical150 run succeeds on immutablea8a5aaf38 (Green31),
actualexit0 (`/tmp/soundscaper-round6-checkpoint150-green31-canonical-retry.log`).
All repository lint shards, TypeScript boundaries, architecture, audits,
documentation and guarded product builds pass. The isolated Node batch passes1/1
in3289.9ms; the complete parallel batch has24706tests,24673passes,33skips and
zero failures in854118.5ms. Together this is24707tests,24674passes and33skips.
The completed Node-only reporter measures90.1%statements/lines,82.3%branches and
90.69%functions; the unchanged CI floors still apply to the merged Node and
Chromium union. No failed earlier checkpoint result is replaced or omitted.
The full100 and queued150 browser runs remain pending.

Immutablea1a725fc1 (Green32) builds both products and its focused public batch
completes10passes/5failures in1.5minutes
(`/tmp/soundscaper-round6-green32-chromium.log`). EDIT049 native height resizing
completes Undo/Redo in2.6seconds, EDIT050 both spectral-brush creation workflows
retain the exact center/time/frequency bounds in3.4/3.2seconds, and DIALOG059
ordinary and pen-interrupted playhead scrubs complete in2.2/2.0seconds. These
raise the verified count to175: editing50, effects39, I/O29 and dialogs57.
Both existing Parametric EQ graph/composition controls also pass. The video and
EQ native ranges still require browser touch-default protection, live Graphic
EQ still has an actual silent output gap, and frozen-export/Contrast workflows
reach their repaired causal assertions before later download/zero controls
fail. All five remain pending until their entire retained workflows pass.
No manual **Update AI assets** run is required.
