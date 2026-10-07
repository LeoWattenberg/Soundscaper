# Third audit: 101 additional user-reproducible bugs

This round fixes 101 distinct defects beyond the first two audits' 202. Each
counted defect has ordinary public editor steps: menus, controls, keyboard input,
recording, or import and export. The detailed registers document the steps,
observed failure, correction, and regression evidence for every entry.

| Area | IDs | Count | Detailed register |
| --- | --- | ---: | --- |
| Effects, generators, macros, mixer, and analysis | R3-ROOT-001–022 | 22 | [Effects and analysis](bugfix-round3-effects-analysis.md) |
| Timeline editing, gestures, automation, and image commands | R3-EDIT-001–026 | 26 | [Editing](bugfix-round3-editing.md) |
| Dialogs, preferences, field commits, and keyboard focus | R3-DIALOG-001–031 | 31 | [Dialogs and controls](bugfix-round3-dialogs.md) |
| Import, export, source timing, delivery, and Project Bin | R3-IO-001–022 | 22 | [Import and export](bugfix-round3-io.md) |
| Total | | **101** | |

Public browser regressions first failed against immutable pre-fix sites. Most
use the pre-audit baseline; the animated-image phase case uses the immutable
build in which ordinary image Paste first became reachable. Focused domain and
mounted-control tests accompany the fixes. Corrected workflows were then checked
in Chromium, Firefox, and WebKit, subject to explicit browser capability probes.

The count excludes malicious prepared files, private-state injection,
inaccessible controls, unsupported commands, intentional limits, passing
hypotheses, and test-harness failures. Media fixtures are ordinary recordings or
unchanged output from established writers, including libsndfile, FFmpeg,
MediaRecorder, and Subtitle Edit. Read-only observers verify actual downloads,
rendered pixels, sample measurements, and published audio connections without
providing inaccessible steps to cause a failure.

Variants sharing one root count once. Follow-through for an existing numbered
entry adds no count, including Truncate Silence previews and macro runs,
additional native interchange formats, Source Monitor reopening, and delegated
time-format menus. The closing scheduled-recording review found one additional
distinct defect: a nonexistent local daylight-saving time was silently scheduled
at a different time. Its start and end variants share entry R3-DIALOG-031.

Changes are committed in focused atomic commits selecting only their owned
files.

Closing verification uses the frozen audit snapshot `e2a5b8e80`. Other sessions
merged independent work into `main` and replaced its browser outputs during an
earlier suite attempt, so the remaining checks use a detached checkout with its
own dependencies, provisioned reference tools, and build outputs. The separately
committed Project Bin mute correction `74519336b` is included in the final browser
checkout without adding to this audit's count. Results below cover this stated
scope; they do not certify every later independent change on `main`.

`npm run check` passed at `e2a5b8e80`: 22,686 Node tests, including the isolated
protocol preflight; 22,654 passed, 32 skipped, and none failed or were cancelled.
The canonical gate also passed full repository lint, shared and product types,
architecture checks, runtime and license audits, documentation checks, and
production builds. The earlier standalone `npm test` run on the audit fixes also
passed: 22,630 passed and 32 skipped, with no failures or cancellations. The later
total includes tests introduced by the independent simplification merge.

The frozen audit's production build passed its chunk and startup-graph budgets.
It contains 441 JavaScript chunks; the largest is 476,143 bytes, below the
500,000-byte limit.
The startup-graph tightening command found no smaller initial-page ceiling to
claim. The effect-result test extraction recovered its warning-band ratchet;
unrelated recovered sizes were left untouched.

Closing browser verification was collected in separate runs, rather than one
uninterrupted green suite. Chromium completed the audit snapshot with 1,411
passes and 16 capability skips. After including the separately owned Bin mute
correction, the private Firefox/WebKit run completed 2,856 scheduled cases:
2,654 passed, 12 failed, 172 explicitly skipped, and 18 recording dependents
could not run after a serial failure. All twelve original failures subsequently
passed focused runs with their original actions, assertions and time limits.
The two updated Chromium Bin preview cases also passed.

The unchanged 29-case WebKit follow-up passed 17 cases and exposed a different
automation-ride assertion failure, leaving 11 serial dependents unrun. A
read-only rerun of that original engineer workflow passed, including its strict
persisted-automation assertion. All eleven remaining recording dependents then
passed unchanged in their separate run, with no failures, skips or unrun cases.
These separate passes do not prove the cause of every earlier failure or turn
failed or interrupted attempts into passing full-suite runs.

The complete-suite attempts exposed follow-through regressions in
R3-EDIT-023: track-header child controls bubbled into its replacement selection
callback, and in R3-DIALOG-007/027: hover labels could take Escape during a
resize or an old label's pointer listener could clear its replacement. Those
guards are corrected without changing the counted roots. R3-ROOT-013's native
resampling projection also pruned the temporarily replaced audio clip from
durable selection; the operation now restores the live selection in its single
Undo entry. The stronger browser regression checks the still-open audio
inspector's new rate before any close or re-selection. The
unchanged Noise Reduction and narrator automation tests now pass in all three
engines, as do the repaired track-selection, header-gesture, resize and hover
workflows. The final tooltip follow-through passes 51 focused browser cases
across all three engines with the original failure specs unchanged.
Other existing test setups now respect CUE destination acceptance and visible
tooltips consuming the first Escape; their geometry, dismissal and project
assertions remain intact. Preview reload waits for the public saved state and
checks the restored project identity and clips. These final affected workflows
pass 34 browser cases, with 11 existing capability skips and no blocked serial
dependents. Spreadsheet Undo waits for the referenced-files dialog to close and
the grid to become idle after source import; both original Undo assertions remain
intact. A read-only observer showed the changed row appearing before that public
completion state. The corrected setup passes all three engines and adds no bug
count. Two exact ZIP-byte comparisons pin their test date to
avoid comparing different wall-clock archive timestamps. These verification
corrections add no bug count and change no application export behavior.

The Amplify regression now waits for the public suggested gain of approximately
9.12 dB before its first Apply. Previously it only waited for Apply to be enabled,
which did not establish the nonneutral gain required by its scenario. A read-only
Firefox observer captured 9.119245 dB at that original trusted Apply click and the
expected exported peak of 0.35355353. The strengthened setup passes all three
engines, retains both original peak bounds and time limits, and adds no bug
count. That healthy observation does not establish the cause of the earlier
quiet-output failure.

These 101 fixes use the existing assistance runtime closure. For this audit, a
manual **Update AI assets** run is **not required**.
