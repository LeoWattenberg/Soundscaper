# Fifth user-reproducible regression audit

This audit has fixed 102 additional distinct roots with ordinary browser
reproduction and corrected public verification (editing 26, dialogs 33,
effects/analysis 29, import/export 14). Its immutable
baseline is `fe6440c81b3a0fe29a028c64db867ae7d2cf3252`.

Count an entry only after ordinary public user actions reproduce its defect
and the corrected workflow passes. Prepared malicious files, private state
injection, unavailable entry points, earlier root causes, sibling symptoms,
and test setup failures do not count. The detailed registers distinguish
source-ready corrections from completed public verification.

| Area | Register |
| --- | --- |
| Editing, selections, routing and native timeline commands | [Editing](bugfix-round5-editing.md) |
| Dialogs, preferences and authoring controls | [Dialogs](bugfix-round5-dialogs.md) |
| Effects, generators, macros and analysis | [Effects and analysis](bugfix-round5-effects-analysis.md) |
| Import, export and project reopening | [Import and export](bugfix-round5-io.md) |

The baseline and corrected checkpoints use locked detached checkouts, private
dependency copies, normal guarded product builds, and ordinary loopback
production previews. Checkpoint one is `23070df21`; its normal browser-product
build passes. Checkpoint two is `5948d84d0`; both product builds and the
coordinated strict test typecheck pass. Checkpoint nine is `004e07463`; its guarded Soundscaper and Framescaper builds
pass. Checkpoint ten is `459027ddc`; its guarded product builds pass as well.
Checkpoint eleven is `41e0214e0`; both guarded builds and coordinated source
and test typechecks pass, as does the complete bounded-memory lint.
Checkpoint thirteen is `a3d463c31`; both guarded product builds pass.
Checkpoint fifteen is `9a5629963`; both guarded product builds and coordinated
source and test typechecks pass.
Checkpoint sixteen is `92984139e`; both guarded production builds pass.
Checkpoint seventeen is `24ccf24b0`; both guarded production builds pass,
but its pending DAWproject report adapter introduced a cold startup cycle.
The corrected archive chunk ownership adds no count. Checkpoint eighteen,
`b40d2db8b`, passes both guarded builds and ordinary editor startup, followed
by the dialogue-chain and source-BPM public regressions in all three engines.
Checkpoint nineteen, `cf64e5829`, passes both guarded product builds, native
Bin Insert and Source Nyquist processing in all three engines. Visual-preset
focus restoration required follow-through for WebKit. Checkpoint twenty,
`4b866b72a`, passes both guarded product builds and that corrected focus
workflow, recording-notes inline code, Nyquist refusal retention, mixed-width
stereo splitting and delayed video audio across all three engines. Coordinated
source types pass; two strict I/O fixture declarations were corrected, adding
no bug count, and whole test types pass. Checkpoint twenty-one, `0a7c080f8`,
passes both guarded builds, Source editor rack profile capture and existing-clip
mono-to-stereo paste across all three engines. Checkpoint twenty-two,
`2d5177efb`, passes both guarded builds and loudness analysis repetition across
all three engines. The complete bounded-memory lint passes all eleven shards.
Checkpoint twenty-three, `c1fb08c11`, passes both guarded builds, ordinary
camera stereo admission, native-rate noise-profile export, styled Bin placement,
recording-notes blank-block formatting and visualizer-preset source selection.
The first visualizer-preset WebKit run reached the correct reopened state but
exceeded its overall deadline; an unchanged isolated run passes within that
original deadline. No product assertion or budget was weakened.
Checkpoint twenty-four, `a2b649a5c`, passes both guarded product builds,
Parametric EQ shortcut ownership and recording-notes literal emphasis across
all three engines, together with their existing interaction controls.
Checkpoint twenty-five, `b92c1f339`, passes both guarded product builds and
Source tempo processing of repeated audio across all three engines, including
decoded pitch, repeat timing and Undo/Redo.
Checkpoint twenty-six, `97a72977b`, passes both guarded product builds and
spreadsheet command ownership across all three engines. Camera speed
admission still requires follow-through for its public Unlink recovery.
Checkpoint twenty-seven, `675136fab`, passes both guarded product builds,
canonical text application and negative recording-offset placement across
all three engines. Recording calibration uses an ordinary zero-offset warm-up
capture before comparing two offsets; the exact 100-millisecond difference
and the original deadline remain unchanged.
Checkpoint twenty-eight, `04a70d3fa`, passes both guarded product builds and
the complete automated-prefix noise-profile workflow plus the existing Source
profile control in all three engines. Equivalent static and automated filter
settings now produce exactly equal captured profiles.
The camera-speed refusal, ordinary public Unlink recovery, independent speed
change and complete Undo/Redo also pass in all three engines at that checkpoint.
Checkpoint twenty-nine, `0338e893d`, passes both guarded builds, configured
routing-graph command dispatch and the existing pointer/keyboard graph control
in all three engines. Absolute timed-recording deadlines survive Pause/Resume,
sequence timing fields commit or cancel before blur, and stereo splitting
refuses unrepresentable custom channel maps before changing any document or
audio. Their recovery and existing controls pass in all three engines. The
coordinated source typecheck and complete bounded-memory lint pass. The first
test typecheck caught a missing blur declaration in a test fixture; that fixture
is corrected, and both its focused strict check and the coordinated retry pass.
Checkpoint thirty, `c4e928664`, passes both guarded builds, native picture
Overwrite and its existing Insert control, plus targetless visual-preset
removal and its existing focus control across all three engines.
Checkpoint thirty-one, `a26a52e78`, passes both guarded builds. Warp authoring
now refuses a looping recording before publishing an unusable map; WAV export,
unchanged history and ordinary return-to-one-repeat recovery pass in all three
engines.
Checkpoint thirty-two, `7ff19f182`, passes both guarded builds, surround Speed
admission and ordinary camera Bin audition of authored companion audio across
all three engines. Linked pitch-and-speed recovery remains available, and an
unchanged companion remains audible. Coordinated source and test typechecks
and the complete bounded-memory lint pass. The first source check caught an
unsupported tooltip prop in the pending curve fix; it is corrected before its
source commit, and the coordinated retry passes.
Checkpoint thirty-three, `9ac41696b`, passes both guarded builds and exact
Filter Curve inverse admission plus the existing curve interactions and rack
persistence in all three engines (12/12). Recording-notes multiline Bold/Italic
preview, exact toggling and saved reload also pass in all three engines (6/6).
A test helper received a locator instead of its page; that fixture call is
corrected without changing the product assertions or deadline.
Checkpoint thirty-four, `1e11bebe1`, passes both guarded builds and Silence
menu capability admission plus supported Trim and Soundscaper silent-WAV
controls in all three engines (6/6). Selected Title preset source isolation also
passes alongside the original Inspector workflow (6/6), adding no new count.
Checkpoint thirty-five, `15416e48c`, passes both guarded builds and spectral
handle command ownership, one-entry Undo, plain editing and existing pointer
cancellation in all three engines (9/9).
Checkpoint thirty-six, `bdd10b55f`, passes both guarded builds, actual-unit
effect-knob modified-key ownership and existing endpoint controls plus stereo
divider commands/plain editing and pointer Escape in all three engines
(6/6 per area). The divider ratio belongs to session view state; an incorrect
extra Undo expectation was corrected to verify document history and unchanged
view geometry, adding no count. Coordinated source types pass; the first
test check caught a missing array guard in an I/O menu fixture. Its focused
compiler and the coordinated retry pass after that fixture correction.
Checkpoint thirty-seven, `1672be43a`, passes both guarded builds and modal
resize modified-key admission with ordinary resizing and resumed command
dispatch in all three engines (3/3). Recording-notes multiline Code passes
alongside Bold/Italic (9/9), adding no separate root.
Checkpoint thirty-eight, `62ecb3872`, passes both guarded builds, output-name
Enter/Escape focus and Undo/Redo (6/6) plus native-rate Paste spectrum, duration
and history with existing speed/channel controls (9/9), all three engines.
Checkpoint thirty-nine, `7c3977b10`, passes both guarded builds, output-lane
modified command ownership with name editing (9/9), canceled selection effects
and remembered Auto Duck control admission with existing Amplify controls
(9/9), and individual-stem detector closure with existing clip-export controls
(21/21), all three engines. The complete bounded-memory lint passes.
Checkpoint forty, `d2083aed9`, passes both guarded builds, native effect-slider
configured command ownership with pointer cancellation (6/6) and styled saved
preset application after a Bin donor rename, including exact history and
reload (3/3), all three engines. Grouped pitch-and-speed rendering and the
existing loop-render control also pass in all three engines (6/6); an initial
Firefox menu-opening timeout occurs before rendering, and its unchanged
isolated workflow passes within the original deadline.
Checkpoint forty-one, `5d70b4a74`, passes both guarded builds and selected-track
printing while retaining an unselected grouped recording, with combined and
individual print controls (9/9), all three engines.
Checkpoint forty-three, `4210f5247`, passes both guarded builds. Real published
Nyquist installation and replacement-action focus pass in all three engines
(3/3). The publication permits the standard local test origin and production
origin; custom checkpoint ports had been refused before installation, so
those earlier prerequisites were excluded. Native Title/Solid/still bystanders
no longer prevent Freeze from resolving its selected camera ordinal. Its
unchanged camera and Title workflows pass in Chromium (2/2); Firefox lacks
the real WebGL2 prerequisite and WebKit lacks the required IndexedDB Blob
readback, producing four explicit capability skips. The camera-only controls
confirm those host limitations; skips are not reported as passes.
Checkpoint forty-four, `79df3004c`, passes both guarded builds. The broad
handoff run exposed an older archived Nyquist input-binding failure: declared
version-one effects received a scalar where they expected selected audio.
Real publication, parameter editing and Apply reproduce it on checkpoint
forty-three without network substitution. The corrected legacy input binding
passes real mono/stereo runtime controls, and the live downloaded EQ, exact
measured Undo/Redo, original archive smoke and installation focus pass across
all three engines (9/9). Modern effects and headerless prompts retain their
existing input semantics. Earlier auxiliary export setup and ideal-wave
comparison errors are excluded; their raw evidence is retained.
This source-final normal build covers every counted correction. Later changes
in this audit correct verification setup and assertions or update documentation
and size ratchets, without changing application bytes.
Browser evidence names each exact checkpoint. Firefox audio
uses the unchanged CI PulseAudio setup with a private 48 kHz null sink.

The final canonical gate for source and tests at `374e78a87` passes after regenerating its command reference from
the owning menu inventory and updating stale test contracts. Its main suite
reports 23,939 tests: 23,906 passes, 33 skips and no failures; the isolated
preflight adds one pass. This includes the legacy-effect and final capture-owner
regressions. Static checks, full bounded-memory lint and guarded product builds
also pass. Documentation-only follow-ups through `43dfc1665` retain that source
and test closure. Later shared-checkout changes are outside these receipts.

The source-final browser inventory covers all 5,268 unique project/test
identities. Its final composite outcomes are:

| Browser | Passed | Explicit annotated skips | Remaining failures | Inventory |
| --- | ---: | ---: | ---: | ---: |
| Chromium | 1,740 | 16 | 0 | 1,756 |
| Firefox | 1,676 | 80 | 0 | 1,756 |
| WebKit | 1,651 | 100 | 5 | 1,756 |
| Total | 5,067 | 196 | 5 | 5,268 |

This is an identity-complete composite, not a green uninterrupted browser
command. Original failures and deliberate interruptions are retained. Resume
partitions exclude only successful or explicit skipped identities, retaining
failed, interrupted and serial-dependent cases; the final inventories contain
no missing identities or implicitly unrun cases. Three Chromium failures
required uncounted fixture corrections: decoded-silence precision and an
invalid cross-capture latency assumption. Their corrected public workflows
pass, with the exact signed mapping independently checked at both capture
owners. Firefox's 17 remaining failures all pass unchanged in its one-worker
retry (exit 0). WebKit's six-case one-worker retry passes the scientific
frequency assertion but leaves five failures (exit 1): podcast tempo remains
120 instead of 108; keyframe editing and bus-tail rendering exceed their
overall deadlines before the relevant output assertions; preset Save does not
publish its expected completion status within five seconds; and the reloaded
visual Inspector shows Noise when the test expects Test Image. These outcomes
are unresolved and add no counted bugs. No source cause is inferred solely
from resource pressure, and no retry changes their assertions or budgets.
A passive native-event observer subsequently passes the original podcast
actions and assertions: the same connected tempo input receives `108`, a real
blur and a successful save. It does not reproduce the proposed late Effects
focus transfer; Effects focus occurs before tempo editing. The earlier `120`
failure remains unexplained. This diagnostic does not replace the unmodified
retry's failures in the table. Its evidence is retained in
`/tmp/soundscaper-r5-podcast-tempo-public-observer-summary.json`.

Exact Firefox and WebKit identity partitions, frozen fixture hashes and raw
attempts are retained in `/tmp/soundscaper-r5-final-firefox-g44-composite-receipt.json`
and `/tmp/soundscaper-r5-final-webkit-g44-final-composite-inventory.json`.
The earlier browser
run was intentionally stopped for the final-source restart after 2,258 passes,
three failures, four interrupted cases and 40 explicit skips; 2,960 cases
had not run. The two playback/recording timing failures passed unchanged in
isolated reruns; their raw evidence and timing uncertainty remain retained.
Current changes do not alter the
assistance runtime closure and
do not require a manual **Update AI assets** run.
