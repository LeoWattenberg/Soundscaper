# Fifth user-reproducible regression audit

This audit is in progress toward 100 additional distinct fixes. Sixty-seven
new roots have completed ordinary browser verification (editing 18, dialogs 22,
effects/analysis 18, import/export 9). Its immutable
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
Browser evidence names each exact checkpoint. Firefox audio
uses the unchanged CI PulseAudio setup with a private 48 kHz null sink.

Final canonical, Node, build, and browser handoff gates have not yet run for
this audit. Current changes do not alter the assistance runtime closure and
do not require a manual **Update AI assets** run.
