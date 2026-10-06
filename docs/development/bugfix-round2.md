# Second audit: 100 additional user-reproducible bugs

This round fixes 100 distinct defects beyond the first audit's 102. Each counted
defect was reproduced through ordinary menus, controls, keyboard input, recording,
or import and export. The detailed registers record the steps, observed failure,
correction, and regression evidence for every entry.

| Area | IDs | Count | Detailed register |
| --- | --- | ---: | --- |
| Effects, macros, generators, analysis, and listening volume | R2-ROOT-001–023 | 23 | [Effects and analysis](bugfix-round2-effects-analysis.md) |
| Timeline editing, gestures, automation, folders, and clip audio | R2-EDIT-001–029 | 29 | [Editing](bugfix-round2-editing.md) |
| Dialogs, field commits, navigation, and keyboard focus | R2-DIALOG-001–031 | 31 | [Dialogs and controls](bugfix-round2-dialogs.md) |
| Import, export, metadata, delivery, and Project Bin | R2-IO-001–017 | 17 | [Import and export](bugfix-round2-io.md) |
| Total | | **100** | |

The count excludes malicious or malformed prepared files, private-state
injection, inaccessible controls, intentional limits, passing hypotheses, and
test-harness failures. Ordinary media fixtures include standard WAV recordings,
an uncompressed AIFF-C written by Python's audio library, and an untouched
audio-only WebM recorded by Chromium. Native audio observers only record the
connections and scheduled values made by normal user workflows.

Variants sharing an underlying defect count once. Follow-up fixes to the first
audit's numbered defects and to this round's existing entries add no count.
These include additional single-line field commits, the skin carousel's disabled
focus handling, and very short Project Bin video trims.

Changes are committed in focused commits selecting only their owned files.

`npm run check` passed: 22,059 Node tests passed, 32 skipped, and none failed.
The canonical gate also passed full repository lint, type checking, architecture,
runtime and license audits, documentation checks, and production builds. The
builds remained within the chunk-size and startup-graph budgets.

The complete browser run covered 3,855 cases in Chromium, Firefox, and WebKit:
3,673 passed, 179 skipped, and three reported test-only failures. Two older
expectations contradicted the fixes: promoting a take now preserves its selection,
and the mask menu offers only its supported shapes. The third test sent a second
synthetic paste while the spreadsheet could still be busy and read-only. Its
readiness wait now observes the public grid state and focus before that paste.
These corrections preserve the media, history, validation, and row-content
assertions and add no bugs to the count.

All three exact failed IDs passed together with `--last-failed` (exit 0, 20.0
seconds). Application builds stayed unchanged throughout the full run and its
reruns; the three corrections changed only their test files. The following
totals combine each engine's full run with its successful corrected-ID reruns:

| Browser | Unique passed cases | Skipped cases | Unresolved failures |
| --- | ---: | ---: | ---: |
| Chromium | 1,270 | 15 | 0 |
| Firefox | 1,213 | 72 | 0 |
| WebKit | 1,193 | 92 | 0 |
| Total | **3,676** | **179** | **0** |

The focused red-to-green regressions and reproduction details remain in the
four registers above. Each register's consecutive IDs were checked again at
handoff: 23 + 29 + 31 + 17 = 100. Modified browser specs also passed targeted
lint, and the handoff passed `npm run lint:changed` and `git diff --check`.

These UI, browser, audio-domain, and test changes use the existing assistance
runtime closure. A manual **Update AI assets** run is **not required**.
