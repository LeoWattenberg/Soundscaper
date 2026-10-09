# Sixth user-path regression audit

Target: 200 additional distinct bugs. All 200 fixes have focused regressions and
complete public workflow verification; full-suite validation continues. The
initial revision is `ee0d3fabd`; work is isolated on
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

Focused regressions run for each correction. The full Node suite runs after
each 50 verified fixes; immutable checkpoint results and complete browser
workflow results are recorded below.

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

Immutable Green33 `ae7939d4e` completes all15 focused Chromium workflows in59.1
seconds (`/tmp/soundscaper-round6-green33-chromium.log`), after both guarded
product builds pass (`/tmp/soundscaper-round6-green33-build.log`). This verifies
dialog057/060/061, effects040/042, editing051 and I/O032. Native primary and
secondary-touch completion, actual continuous output PCM, exact exported clocks,
ordinary controls and Undo/Redo remain asserted. The uncounted EDIT046 timeline
lock continuation also completes all three ordinary audio/video/header checks.
The previously complete same-build Green32 I/O031 ZIP download and effects041
real quiet/silent WAV checks qualify those two roots; their stale-link and
all-muted fixture mistakes remain excluded. There are **184 distinct verified
fixes**: editing51, effects42, I/O31 and dialogs60. Pending candidates never
enter this count.

The complete Green32 static gate on `a1a725fc1` exits0, including all seven
repository lint shards, strict types, architecture and ownership checks, policy
and runtime audits, documentation checks and the guarded production build
(`/tmp/soundscaper-round6-green32-static.log`). Green33's complete static gate
is running for its additional shared type changes. Full100 all-engine browser
checks on `ba2dac3c3` continue; the full150 all-engine run remains queued behind
them. These runs are not recorded as passing before their actual completion.
No assistance runtime asset update is required.

Green34 `08212b4eb` completes12 of13 initial focused Chromium checks in58.3
seconds (`/tmp/soundscaper-round6-green34-chromium.log`). Editing052's Title
and PNG retain5 seconds after30→25fps and Undo/Redo; effects043's live
Compressor keeps continuous native output with zero lost frames; I/O033
retains playable video while declining the product's unavailable captions;
and dialog063's open popup releases the configured command while retaining
ordinary navigation. The failure is dialog062's incorrect Ctrl+Alt+Up fixture
assumption: the unchanged native-editable policy intentionally owns modified
arrows. Its corrected ordinary Ctrl+1 binding is explicitly permitted by that
policy, causally fails Green33 after the idle and plain-digit controls, and
completes unchanged production Green34 in9.5seconds with time/focus and
Undo/Redo intact (`/tmp/soundscaper-round6-timecode-digit-numeric-public-green.log`).
The native digit-listener repair therefore qualifies without changing the
workspace's native-editable admission. There are **189 distinct verified fixes**:
editing52, effects43, I/O32 and dialogs62. Pending I/O034 and dialog064 remain
excluded. The complete Green33 static gate exits0; both guarded Green34 product
builds pass.

Three initially failed full100 workflows pass unchanged isolated retries on the
same `ba2dac3c3` source: Chromium playback-follow4.1seconds and Firefox
mixed-width split17.7seconds/native-rate paste13.2seconds
(`/tmp/soundscaper-r6-edit-full100-chromium-unchanged-retry.log` and
`/tmp/soundscaper-r6-edit-full100-firefox-unchanged-retry.log`). The original
failures are retained: editor boot visibility and whole-test export-close
deadlines; no PCM failure or changed assertion, source or timeout is involved.
The complete all-engine run itself continues in WebKit and is not claimed
to pass. No assistance runtime asset update is required.

Immutable Green35 `1f33ae496` passes both guarded product builds and completes
14 of18 initial Chromium workflows (`/tmp/soundscaper-round6-green35-chromium.log`).
Seven newly verified roots complete their entire retained public paths: I/O034
publishes and reloads images after dirty timing Undo; editing053 keeps native
mono Take Comp output and Undo/Redo; effects044/045 preserve actual Reverb tail
and Click Removal PCM with zero lost frames; dialogs064/065/067 retain locked
target admission, native source frequency defaults and effect-popup shortcut
ownership. The existing native spectral worker control and zero-count label-lock
and native reader-stop completions also pass.

The four initial failures are fixture observers after the repaired behavior:
I/O036 correctly refuses the real16-bit PNG through the normal visible alert,
while its fixture expects the toolbar status; dialog066 retains all native
composition assertions, then waits for a nonexistent Undo toolbar selector.
Use the actual visible refusal alert and existing Edit → Undo/Redo menu.
The corrected fixtures retain exact no-publication, saved/reopened static image,
native draft and history assertions; each remains causally RED on unchanged
Green34. Without any production change, Green35 completes all three musical
field workflows in2.7/2.3/2.7seconds (`/tmp/soundscaper-round6-musical-number-composition-public-green.log`)
and both ordinary image precision controls in4.2/2.1seconds
(`/tmp/soundscaper-round6-image-precision-public-green.log`). Native WebKit's
actual static-only bitmap route completes both static PNG and visible APNG
refusal workflows in7.2/4.2seconds (`/tmp/soundscaper-round6-image-animation-public-green.log`);
its faithful alert fixture also remains causally RED on unchanged Green34.
These qualify dialog066 and I/O035/036. There are **199 distinct publicly
verified fixes**: editing53, effects45, I/O35 and dialogs66. EDIT054 is the sole
pending qualifying candidate and contributes zero until its whole build passes.

Three additional full100 WebKit failures pass unchanged isolated retries on
the same `ba2dac3c3`: complete multi-selection move/trim/stretch4.6seconds,
right-edge playback follow4.9seconds and pinned off-screen follow6.3seconds
(`/tmp/soundscaper-r6-edit-full100-webkit-unchanged-retry.log`,3/3). The original
failures retain their actual shared playback-start refusal or transient canvas
observation; all assertions, deadlines and source stay unchanged. The complete
all-engine full100 run and queued150 run remain pending; neither is claimed
to pass. Green35's complete static gate is running. No manual **Update AI assets**
run is required: the browser/UI/test changes retain the assistance runtime closure.

The last retained pointer workflow completes on immutable Green36 `10ce509b8`:
ordinary mouse and native pen moves each retain 14,400 frames, a mouse tap no
longer replaces the active pen gesture, and exact Undo/Redo completes in
8.7 seconds (`/tmp/soundscaper-r6-edit-pointer-fixture-public-green.log`). The
first Green36 attempt stopped before the pen at a pending autosave entry; its
polling observer now tolerates that absent entry without changing any movement
or history assertion. The same observer on unchanged Green34 still completes
both healthy controls and causally fails at zero versus 14,400 frames in
11.1 seconds (`/tmp/soundscaper-r6-edit-pointer-fixture-causal-red.log`). This
qualifies EDIT054. There are **200 distinct publicly verified fixes**: editing54,
effects45, I/O35 and dialogs66. The excluded I/O004 and dialog019 remain excluded;
variant and fixture completions contribute no extra count.

Green35's complete static gate exits zero, including all repository lint shards,
strict product/test/tooling types, architecture and size checks, runtime and
notice audits, handbook builds, and the guarded production build
(`/tmp/soundscaper-round6-green35-static.log`). Green36's complete typecheck and
both product builds also exit zero. Green37 `3a748640a` builds both products
with the zero-count I/O008 missing native channel metadata completion; its
whole Firefox capture checks are running. Full100 and queued full150 browser
checkpoints remain pending. The final full200 canonical and browser gates use
the committed source and faithful observers. No manual **Update AI assets**
run is required.

The final read-only register audit confirms exactly54 editing,45 effects,
35 I/O and66 dialog roots, each with causal RED and complete built public GREEN.
Current dialog table statuses now refer to the later immutable receipts;
historical pending and failed checkpoint prose is retained. Green37 completes
all18 unchanged native capture monitoring, batching and Stop-tail workflows
across Chromium, Firefox and WebKit, including exact channel/PCM assertions
(`/tmp/soundscaper-round6-green37-capture-public-green.log` and
`/tmp/soundscaper-round6-green37-capture-controls-green.log`). The independently
measured native video observer preserves exact coded/display dimensions and
declared40:33 on all three engines, while unchanged pre-fix Green18 remains
causally RED at97:80. These completions add zero count.

Final canonical validation runs on Green38 `74ee50e15`
(`/tmp/soundscaper-round6-checkpoint200-green38-canonical.log`). The final
all-engine browser checkpoint is queued on Green39 `b6ee08055`, which changes
only the faithful video observer and its receipt after Green38; production
source bytes are identical. Green39's two guarded product builds exit zero.
The earlier full100 and full150 browser checkpoint results remain pending.
The initial Green38 browser queue was replaced before it started so the final
run includes the verified native observer. No runtime asset update is required.

The first full200 canonical attempt on Green38 exits1 after completing all
static gates and both Node batches. The isolated batch passes1/1; the parallel
batch reports24,860 cases,24,825 passes,2 failures and33 skips in826,853ms.
Combined: **24,861 cases,24,826 passes,2 failures,33 skips**. Both failures are
retained in `/tmp/soundscaper-round6-checkpoint200-green38-canonical.log`.

The chunk-owner guard identifies exactly two eager project-command consumers
of EDIT052's unowned pure sequence conformance helper. Assign that helper to
the existing exact project-command inventory; retain every semantic group and
the eager/lazy guard. The new mapping regression is independently RED, then
the correction and unchanged chunk, cross-product and exact sequence/history
controls pass90/90. Immutable Green40 `f9fcebaeb` passes both guarded builds and
the complete native pen/mouse, Title and PNG sequence-rate public workflows in
8.5/11.5/6.0seconds, including exact Undo/Redo
(`/tmp/soundscaper-round6-green40-ownership-public-green.log`). This is zero-count
EDIT052 completion.

The archive-focus failure occurs at its initial Install-button admission,
before installation or either focus assertion: fifty event-loop turns end
before the real authenticated catalog publishes. The exact unchanged file
passes2/2 in isolation on Green38. Observe the existing store adapters' real
catalog and installation completion, retaining their original return values,
digest-pinned bytes and both focus assertions. The corrected fixture passes
13/13 authentication/metadata/focus controls, strict types and changed lint
before test-only commit `1aa233df3`. This contributes zero count and changes no
product focus timing. The corrected final snapshot will rerun the complete
canonical gate; its final browser queue replaces the unstarted Green39 queue.
All200 qualifying roots remain verified. No manual **Update AI assets** run
is required.

The full 100-fix all-engine browser run on Green23 `ba2dac3c3` completes with
**5,898 cases: 5,662 passed, 26 failed and 210 skipped** in 5.0 hours, exiting 1
(`/tmp/soundscaper-round6-checkpoint100-green23-full-browser.log`). Fifteen
complete unchanged isolated retries pass on that same build with their
original assertions and deadlines. The six native capture metadata failures,
one incidental short-tail block observer and two native video dimension
observers have the later verified zero-count completions recorded above.
The remaining two failures occur before post-reload project activation or
normal marker-creation autofocus has completed; their faithful fixture
completion checks are recorded separately. The failed full checkpoint remains
a failed result, rather than being replaced by isolated passes.

Green41 `b102ebd34` completes the corrected full 200-fix canonical gate with
actual exit 0 (`/tmp/soundscaper-round6-checkpoint200-green41-canonical-retry.log`).
All seven repository lint shards, strict types, architecture and size guards,
runtime/notice audits, documentation checks and guarded production build pass.
The isolated Node batch passes 1/1; the parallel batch passes 24,827 with 33 skips
and zero failures in 867,485 ms. Combined: **24,861 cases, 24,828 passed,
33 skipped and zero failed**. Node-only coverage is 90.13% statements/lines,
82.33% branches and 90.73% functions; this is not the CI union on which coverage
floors are scored, and no floor was lowered.

The unstarted Green41 final browser queue is terminated with actual exit 143
so its replacement includes the final test-only readiness/focus completions.
No test in that queue had started. The full 150-fix all-engine run continues on its
immutable Green27 build; the final snapshot also repeats the complete canonical
gate after the browser helper edit. The verified count remains 200. No manual
**Update AI assets** run is required.

The maintained visual-inspector fixture now waits for the editor's existing
ready and project-activation completion after reload, then verifies selection
after each native Enter. It retains every original Pattern, Noise, saved-state,
digest and restored-value assertion, the 180-second workflow deadline and the
5-second field assertion budgets. It completes on unchanged Green23 with two
passes (Chromium 37.8 seconds, WebKit 1.2 minutes) and the existing Firefox
WebGL2 capability skip, exiting 0 in 2.1 minutes
(`/tmp/soundscaper-r6-visual-inspector-ready-green23-all.log`). Green41 likewise
exits 0 with two passes (15.2/33.6 seconds) and that same original skip in
58.2 seconds (`/tmp/soundscaper-r6-visual-inspector-ready-green41-all.log`).
Strict types, changed lint, size and diff checks pass. Seven added test lines
complete fixture admission without changing product selection behavior or
adding a qualifying root.

The chapter guide fixture now observes normal Add-marker completion in the
docked panel before deliberately moving focus to the timeline. Its unchanged
rename and complete chapter ZIP export assertions pass on unchanged Green23
in Chromium 4.0 seconds, Firefox 6.7 seconds and WebKit 6.5 seconds: three
passes, actual exit 0 in 21.0 seconds
(`/tmp/soundscaper-r6-full100-chapter-focus-all-engines.log`). Focused guide and
annotation controls pass 71/71; narrow types, targeted and changed lint, size
and diff checks pass. This two-line helper completion preserves all original
deadlines and product focus behavior and contributes zero additional roots.
All 26 observations from the failed full 100-fix browser run now have retained
diagnoses and complete unchanged or faithful-fixture verification. The final
all-engine checkpoint will include both test-only fixture completions.

The final source/test snapshot Green42 `7e48ce29d` includes both narrow browser
fixture completions and passes both guarded product builds. Its complete
`npm run check` exits 0
(`/tmp/soundscaper-round6-checkpoint200-green42-canonical.log`), including every
static gate and both Node batches. The isolated batch passes 1/1; the parallel
batch reports 24,860 cases, 24,827 passes, 33 skips and zero failures in
855,572 ms. Combined: **24,861 cases, 24,828 passed, 33 skipped, zero failed**.
Node-only coverage remains 90.13% statements/lines, 82.33% branches and 90.73%
functions. No CI union floor, chunk ceiling or startup graph ceiling changed.

Every required 50-fix milestone has a completed passing full Node run, with
both execution batches combined here:

| Verified fixes | Immutable run | Cases | Passed | Skipped | Failed |
| --- | --- | ---: | ---: | ---: | ---: |
| 50 | Green9 | 24,179 | 24,146 | 33 | 0 |
| 100 | Green21 | 24,491 | 24,458 | 33 | 0 |
| 150 | Green31 | 24,707 | 24,674 | 33 | 0 |
| 200 | Green42 | 24,861 | 24,828 | 33 | 0 |

The full 150-fix all-engine browser checkpoint on Green27 is still running.
The final full 200-fix all-engine run is queued on Green42 behind it
(`/tmp/soundscaper-round6-checkpoint200-green42-full-browser.log`); neither
pending run is claimed to pass. All 200 qualifying roots retain causal RED and
complete public GREEN evidence. No manual **Update AI assets** run is required.

The full 150-fix Firefox recording-meter case exposes one further completion
of the existing capture-width family. Its unchanged public Record, Stop,
Float WAV and idle-meter workflow fails the original left-channel peak control
at 0.565685. Independent native input observation proves two channels with
peaks [0.8, 0] in all three engines; Firefox and WebKit omit the optional track
channel setting. A passive whole-workflow observation on unchanged Green42
confirms that the legacy capture adapter persists one channel and delivers
both WAV lanes at 0.565685. The ordinary mono center panner's equal-power gain
accounts for the observed value; neither the native fixture nor export
assertions are changed.

Commit `9ca719643` uses the existing silent native channel-width probe only
when that metadata is omitted, keeps explicit widths and the two-channel cap,
and rechecks capture ownership before publishing storage after the observation.
Five actual-service regression cases fail before repair while three explicit
width controls pass. The repaired service and related recording controls pass
69/69; additional actual-caller recording integration controls pass 24/24.
Strict types, targeted and changed lint, size and dependency architecture checks
pass. The unchanged complete browser workflow then passes on immutable Green43
in Chromium 5.8 seconds, Firefox 8.3 seconds and WebKit 7.9 seconds: **3/3
passed, actual exit 0 in 25.7 seconds**
(`/tmp/soundscaper-r6-io-meter-channels-green43.log`). Every original left-peak,
silent-right-channel, stereo-width and meter assertion and deadline is retained.
This completion contributes zero further roots; the verified count remains 200.

Green43 `9ca719643` passes both guarded product builds
(`/tmp/soundscaper-round6-green43-build.log`). The unstarted Green42 final browser
queue is terminated with actual exit 143 so its replacement includes this
source correction; no browser case in that queue had started. Green43 repeats
the complete canonical gate
(`/tmp/soundscaper-round6-checkpoint200-green43-canonical.log`), and its final
all-engine browser run is queued behind the continuing immutable Green27
150-fix run
(`/tmp/soundscaper-round6-checkpoint200-green43-full-browser.log`). Both remain
pending at this receipt. No runtime source pin, assistance engine dependency,
archive recipe or supported target changes, so no manual **Update AI assets**
run is required.

Green43's complete canonical gate subsequently finishes with **actual exit 0**
(`/tmp/soundscaper-round6-checkpoint200-green43-canonical.log`). All seven lint
shards, strict product/test/tooling types, architecture and size guards,
runtime/notice audits, documentation checks and the guarded production build
pass. The isolated protocol batch passes 1/1; the main batch reports 24,868
cases, 24,835 passes, 33 skips and zero failures in 1,588,891 ms. Combined:
**24,869 cases, 24,836 passed, 33 skipped, zero failed**. Fresh Node-only
coverage is 90.13% statements/lines, 82.32% branches and 90.73% functions;
the CI union floors and every production chunk/startup ceiling are unchanged.

The unstarted two-worker Green43 browser queue is terminated with actual exit
143 before any browser case starts. Its replacement uses the repository's
normal local four-worker setting, with every case, original assertion and
deadline unchanged, and waits for both the full 150-fix browser checkpoint and
the canonical check process to finish before starting. The final all-engine
browser result remains pending. New deadline observations from the older
WebKit checkpoint are retained for unchanged complete retries after the Node
runner and coverage reporter are idle; they are not counted as new roots or
claimed to pass before those retries complete. The verified count remains 200.
