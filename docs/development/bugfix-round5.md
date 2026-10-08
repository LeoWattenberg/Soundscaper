# Fifth user-reproducible regression audit

This audit is in progress toward 100 additional distinct fixes. Thirty-six
new roots have completed ordinary browser verification (editing 10, dialogs 12,
effects/analysis 9, import/export 5). Its immutable
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
Browser evidence names each exact checkpoint. Firefox audio
uses the unchanged CI PulseAudio setup with a private 48 kHz null sink.

Final canonical, Node, build, and browser handoff gates have not yet run for
this audit. Current changes do not alter the assistance runtime closure and
do not require a manual **Update AI assets** run.
