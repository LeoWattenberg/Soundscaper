# Fifth user-reproducible regression audit

This audit is in progress toward 100 additional distinct fixes. Fifty-two
new roots have completed ordinary browser verification (editing 15, dialogs 16,
effects/analysis 14, import/export 7). Its immutable
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
focus restoration passed two engines and requires follow-through for WebKit;
that pending root remains uncounted.
Browser evidence names each exact checkpoint. Firefox audio
uses the unchanged CI PulseAudio setup with a private 48 kHz null sink.

Final canonical, Node, build, and browser handoff gates have not yet run for
this audit. Current changes do not alter the assistance runtime closure and
do not require a manual **Update AI assets** run.
