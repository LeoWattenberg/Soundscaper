# Fourth audit: 100 additional user-reproducible bugs

This register records 100 distinct fixes beyond the previous audits' 303.
An additional public Search reveal defect found during closing verification is
recorded separately below. Each counted entry has ordinary public steps in
Soundscaper or Framescaper: menus, keyboard input, recording, supported editing
controls, or import and export.
The detailed registers record each reproduction, observed failure, correction
and regression evidence.

| Area | IDs | Count | Detailed register |
| --- | --- | ---: | --- |
| Effects, generators, macros, mixer, analysis and toolbar commands | R4-ROOT-001–025 | 25 | [Effects and analysis](bugfix-round4-effects-analysis.md) |
| Timeline editing, selection, native visual commands and routing | R4-EDIT-001–030 | 30 | [Editing](bugfix-round4-editing.md) |
| Dialogs, preferences, field commits, focus and workspace geometry | R4-DIALOG-001–029 | 29 | [Dialogs and controls](bugfix-round4-dialogs.md) |
| Import, export, source timing, delivery and project copies | R4-IO-001–016 | 16 | [Import and export](bugfix-round4-io.md) |
| Total | | **100** | |

Impact varies. Consequential corrections include generating audio into a label-only
selection without overwriting an unselected recording, retaining mixer routing when
duplicating or splitting tracks, preserving the pitch of a replaced looped source,
and exporting unchanged imported ADM projects and their copies. Other entries fix
keyboard focus, modified shortcuts, field commits and missing indications. This
register establishes reproducible defects; it does not imply equal severity or
measure how frequently users encounter them. Most entries concern interactions
or availability, and several independent handlers share a broad usability theme,
such as modified-key ownership. One hundred distinct causes do not represent
one hundred equally large workflow breakdowns.

Public browser workflows first failed against the immutable pre-fix baseline
`a0322d6e4`. Independently implemented owners were also checked against snapshots
containing related corrections when needed to establish that a candidate remained
broken. Corrected workflows were exercised in Chromium, Firefox and WebKit,
subject to the capability exclusions explicitly recorded in their registers.
Focused domain or faithfully mounted production-control tests accompany the fixes.

The count excludes malicious prepared files, private-state injection, inaccessible
controls, passing hypotheses, unsupported operations without an exposed erroneous
entry point, and test-harness or timing failures. Media comes from normal editor
output or established recording/writing tools. Read-only observers measure actual
downloads, sample values, rendered output and public control state; they do not
provide inaccessible steps for causing a defect.

Variants sharing one cause count once. The owners' cross-audit review distinguishes
independent handlers, command planners and delivery boundaries from variants of
the same implementation. Additional corrections for a recorded cause add no ID,
including bus-profile capture with Master muted, integer keyframe bridge policy,
native visual mapper follow-through, ADM archive copies, consumer registration and
the desktop application's JavaScript runtime inventory. Failed setup attempts and
invalid secondary expectations remain excluded rather than being converted into
counted defects.

Changes are committed atomically with explicit owned paths. Closing verification
includes the Labels panel's reload-bootstrap correction for R4-DIALOG-017 and
the verification follow-through described below. Focused public green runs alone
are not described as an uninterrupted full-suite pass.

`npm run check` passed on `360253a7e` with Node.js 26.5.0 and npm 12.0.1: the
complete lint, type, architecture, audit, documentation and build gates passed,
as did 23,321 Node tests, with 32 explicit skips and no failures. That total includes
the freshly compiled isolated desktop preflight. That canonical run includes
the Labels bootstrap and dialog-geometry regressions.
Standalone `npm test` passed after the final browser-helper change on `2b1961ae2`:
23,318 passes, 35 explicit skips and no failures, including its fresh desktop
preflight. Three additional skips in that standalone checkout were existing
shipped-preload checks requiring a build. After the normal browser prebuild,
those exact three checks passed separately with no skips. Their follow-up results
do not alter the recorded standalone totals.
Changed lintable files were linted during implementation, and the maintainability
gate was also checked against the original `a0322d6e4` baseline. That build's largest
production JavaScript chunk was 478,719 bytes. Startup graph budgets passed without
raising their ceilings. Coverage reporting here is Node-only; this does not claim
the combined Node and Chromium CI coverage gate.

The host's original WSLg audio endpoint left Firefox's native `AudioContext`
suspended even on an empty page, before the application loaded. Browser
verification therefore uses the repository's unchanged CI PulseAudio null-sink
setup. Its unchanged Firefox clock health check passed: the clock advanced by
0.059 seconds and restarts took at most 38 milliseconds. This uses a private
test endpoint and per-process environment settings, without changing application
bytes, assertions or test deadlines. Earlier interrupted browser attempts are
not claimed as complete runs.

The frozen full browser invocation exposed a read-only pixel observer drawing an
exported MP4 before its verification video presented a decoded frame. Independent
native decoding confirmed the actual downloaded file's picture and 54-by-96
dimensions. Test-only commit `26f38958b` waits for a presented frame at the original
0.1-second seek target. The exact failed download then passed the repaired reader
in Chromium, Firefox and WebKit. The complete original four-case export spec
passed again: 10 passes, two existing Firefox WebGL capability skips, no failures.
The original pixel assertions, downloaded-byte attachment and deadlines remain
unchanged. This observer correction adds no bug ID or application change.

The initial healthy-audio full invocation was interrupted when its active test
checkout was removed. Its completed interactions and ensuing missing-spec and
missing-worker errors are retained as an invalidated run. Complete verification
restarted in a locked, detached `26f38958b` checkout outside the removed temporary
worktree location, with the normal prebuild and unchanged suite configuration.

That replacement exposed an incomplete geometry guarantee from first-audit D16
in [the original dialog register](bugfix-dialogs.md), unrelated to
R4-DIALOG-016's preset-deletion focus fix. After moving Reverb to the window edge,
an ordinary browser-window resize left its header partly offscreen in all three
browsers. Increasing its height through the existing keyboard resize grip also
left the header clipped. Commit `360253a7e` reconciles actual header bounds when
the panel or browser changes size, while retaining the grabbed title point during
movement and restoring the original offset on Escape. Three mounted geometry
regressions first failed, then all 13 focused shell, bounds, movement and focus
tests passed. This completes the earlier clamping fix and adds no fourth-audit ID.

The full invocation also exposed a custom-toolbar test drawing its selection from
under sticky track controls. The unchanged five-case Firefox file reproduced the
failure. A read-only observer measured the start at x328 while those controls ended
at x333; trusted pointer-down hit the track meter, so no waveform selection began.
Test-only commit `2b1961ae2` first chooses the existing View → Zoom → Fit project
to width command, retaining the original quarter-to-three-quarter authored range,
action and persistence assertions, and 60-second deadline. Both measured pointer
starts now hit the intended waveforms. The complete file passed all 15 cases across
Chromium, Firefox and WebKit. This is a setup correction, with no application
change or additional bug ID.

Separate unchanged re-runs passed the complete 20-story Chromium recording and
automation file, Firefox's keyboard-reachable-controls accessibility case, and
Firefox's Reverb macro-cancellation case. The accessibility case completed in
25 seconds against its existing 90-second deadline. These re-runs retain the
original assertions and deadlines. Their earlier full-run failures remain
causally unclassified and are retained alongside the successful re-runs.

The combined `360253a7e` invocation was unexpectedly terminated with SIGTERM
before completion. Its checkout remained intact, but no final JSON report was
written; its last scheduled-case counter is not treated as a pass count. The
termination cause is unknown. Complete engine runs use `2b1961ae2`, whose changes
since `360253a7e` are confined to four browser specs, including the verified setup
correction. Application, configuration and runtime source bytes are unchanged.

An attempt to run all three engines concurrently used four workers per engine,
for 12 simultaneous media-heavy workers. That exceeded the suite's normal
four-worker concurrency and produced a cluster of failures, many during setup
or export before the feature assertions. Firefox and WebKit were intentionally
stopped, with raw evidence preserved; neither produced a final JSON report.
A WebKit wrapper wrote zero from its signal trap, which is explicitly excluded
as a successful suite exit. Chromium continued on its original four workers.
Those partial runs are not complete passes, and concurrency alone does not
establish the cause of every failure. Subsequent engine runs are sequential
with the original worker count, assertions, deadlines and retry policy.

The complete Chromium run on `2b1961ae2` finished with 1,580 passes, seven
failures and 16 explicitly annotated capability or opt-in skips, with no flaky
cases or serial cases left unrun. All seven complete failed files were then run
unchanged: eight passes, no failures or skips, in 45.1 seconds. Two initial
failures were recording setup with no durable PCM captured; the other five
exhausted their original overall deadlines before completing their target
workflow. The original full run remains failed and the causes remain
unclassified; the successful follow-up is recorded separately.

The complete sequential Firefox run on `2b1961ae2` finished successfully:
1,526 passes, 77 skips, no failures or flaky cases, in 45.1 minutes, exit zero.
Its original 1,603-case inventory, four-worker configuration, assertions and
deadlines were unchanged. The earlier concurrent attempt remains a separate
intentionally interrupted result.

The complete sequential WebKit run on `2b1961ae2` finished with 1,484 passes,
four failures, 97 explicit skips and 18 serial stories left unrun, with no flaky
cases, in 37.1 minutes. This full run remains failed. The failed assertions were
a Source Editor waveform-image comparison after its fade value and curve had
restored, an automation point unchanged by its first ArrowDown, Markers failing
to activate before the panel-close check, and marker rename failing to open
before chapter export. The repeated recording focus failure was subsequently
traced to the Search reveal replay described below. The other raw failures remain
unclassified and their successful re-runs are reported separately.

The first unchanged four-file WebKit follow-up had 134 passes, one recording
focus failure and ten serial stories left unrun. All five Source Editor cases,
both panel-close cases and all 118 guides passed. A further replay with read-only
native event and geometry observers had 133 passes, one recording focus failure
and eleven serial stories left unrun; these observer hooks changed no application
state or reproduction actions.

An additional public defect was corrected during verification, separately from
the 100 registered causes: the timeline retained its last Search reveal request
and replayed it on project changes, stealing later editing focus and repeating
its scroll. The observed visible, connected automation point gained focus, then
lost it to the clip group seven milliseconds later, with no point replacement,
hidden geometry, inactive document or open menu. This identified the persistent
reveal effect; it did not depend on an adversary or injected editor state.

The qualifying public regression imports a normal WAV, selects its timeline
result through Search, opens its ordinary track controls, clicks the visible
Volume thumb and continues with native ArrowDown keys. It fails focus retention
on the immutable `2b1961ae2` build. The identical workflow passes Chromium,
Firefox and WebKit on `4ab0ff3be`, retaining focus through two exact decrements
and public saved completion. Unsupported SVG Tab setup attempts were excluded
after they also failed on the corrected source.

Commit `4ab0ff3be` consumes a reveal only after the exact target is focused or a
later deliberate focus choice supersedes it. Project, zoom or viewport changes
no longer replay a completed request; new request revisions remain supported,
and initial deferred targets retain their focus context across effect restarts.
Three mounted regressions first failed while four companion cases passed; all
seven pass after the correction, together with six existing spatial cases.
TypeScript, changed-file lint and size checks passed. Browser regression commit
`c958be7df` contains only the ordinary pointer and keyboard test.

On the corrected `4ab0ff3be` application build, the complete five-file WebKit
follow-up passed all 146 cases in 286.9 seconds: all 20 original recording
stories, five Source Editor cases, two panel-close cases, all 118 guides and the
new public Search-focus regression. There were no failures, skips, flaky cases
or serial stories left unrun. The original assertions, deadlines and worker
policy were retained. This follow-up does not change the earlier full-suite
results recorded above.

The unchanged complete Chromium recording file and the new public Search-focus
case also passed on that build: 21 passes in 210.2 seconds, with no failures,
skips, flaky cases or serial stories left unrun. Both browser runs finished
before the fresh final canonical and standalone Node gates began.

The final canonical `npm run check` passed on `c958be7df`, exit zero, with
Node.js 26.5.0 and npm 12.0.1. Its full lint, types, architecture, audit,
documentation and application build gates passed. The main Node suite had
23,327 passes and 32 explicit skips; the freshly compiled isolated desktop
preflight passed separately, making 23,328 passes and 32 skips in total, with
no failures, cancellations or todos. The seven newly mounted Search-focus
cases are included. Fresh Node-only coverage was 89.62% statements and lines,
82.04% branches and 90.48% functions; this is not the combined CI coverage gate.
The largest production JavaScript chunk remained 478,719 bytes, below the
500,000-byte ceiling. The initial graph used six requests, 251,824 raw bytes
and 68,543 Brotli bytes; the Soundscaper editor graph used 81 requests,
6,620,414 raw bytes and 1,622,725 Brotli bytes. All existing budgets passed
without raising a ceiling.

Standalone `npm test` then passed on the same frozen `c958be7df` checkout,
exit zero, with a new isolated desktop preflight. Its main suite again had
23,327 passes and 32 explicit skips; the separate preflight passed, giving
23,328 passes and 32 skips in total, with no failures, cancellations or todos.
Closing documentation links and the 100-entry count passed, and the file-size
gate passed against `a0322d6e4`. Owned test worktrees and the private audio
endpoint were cleaned up after preserving the reports and immutable browser
builds outside them.

Manual **Update AI assets** is not required. These fixes retain the assistance
engine closure, source pins, recipes, archives, signing logic and engine targets.
The desktop inventory correction concerns the application's project-library
JavaScript, not assistance runtime publication.
