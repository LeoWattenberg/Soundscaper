# Fifth user-reproducible regression audit

This audit is in progress toward 100 additional distinct fixes. Eighty-six
new roots have completed ordinary browser verification (editing 22, dialogs 27,
effects/analysis 24, import/export 13). Its immutable
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
Browser evidence names each exact checkpoint. Firefox audio
uses the unchanged CI PulseAudio setup with a private 48 kHz null sink.

Final canonical, Node, build, and browser handoff gates have not yet run for
this audit. Current changes do not alter the assistance runtime closure and
do not require a manual **Update AI assets** run.
