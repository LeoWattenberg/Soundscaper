# Motionscaper final integration status

Status: **M01–M12 In progress**. Reviewed repairs are integrated into
`feat/motionscaper` in the main Motionscaper worktree. Latest reviewed integration
is source `75bba7a0a`, including the reviewed native shutdown repair,
paired-download synchronization, saved-kind/cross-consumer contract tests and
deferred panel focus ownership.
Its combined gates remain open.
The failed ordinary browser capture uses frozen source
`328cae02fb961d87524a6bcb37c54800b3ae7026` on
`feat/motionscaper-final-validation`. This status records fresh validation on
2026-10-15. A fresh complete ordinary browser run is active on clean source
`3e8b3e9420aeda3353158ab9400461c5af1a2980`. Each result qualifies only its stated
source and workload; none marks a milestone complete or certifies a release.

## Evidence boundary

The environment reboot removed `/tmp` proposals, execution logs, receipts and
preservation/reference artifacts stored there. The old reports below remain
historical. Fresh sites, native helpers, reference decoders and Linux packages
were built and verified separately against source 328. Their new receipts do
not reconstruct the lost runs. Source and committed configuration alone prove
implementation, not execution or compatibility.

Fresh results below have terminal process results and retained evidence under
`~/.cache/soundscaper/motionscaper-recovery-328cae02f-20261013/` on the validation
host. The original ordinary browser invocation is closed and failed; the fresh
complete run and subsequent focused results retain their own sources. Changed source will need the
applicable gates again. Do not infer
success from a progress marker, an earlier source's result or generated files.

## Implementation and acceptance are separate

The [owning implementation order](motionscaper-implementation-order.md) makes
all twelve packages required for first release. A read-only source audit locates
the named implementation paths below. It establishes no additional wholly
missing named local deliverable, but it is not an exhaustive correctness proof.
The original completion gates remain unchanged.

| Package | Implemented local paths | Acceptance still needed |
| --- | --- | --- |
| M01 | Own browser/desktop bootstrap, storage/locks/origin, release identity, routes, offline assets, locale/help and test ownership. | Current shells and existing products, exact isolation/resource closures and supported installed targets. |
| M02 | Typed family-v1 `.mscape`, validation/history/leases, durable asset closure, foreign/future custody; explicit Frame 1.1 family-v2 migration with exact originals. | Current malformed/archive/retention/interruption/ownership workflows across admitted hosts. |
| M03 | Shared rational evaluator, parenting/precomp/audio/remap, typed curves and consumption ledger used by preview/export/linked sources. | Current nested/mixed-rate/seek/cycle/timing/history equality across consumers. |
| M04 | Pinned lazy CanvasKit, retained fonts, paragraph/vector rendering, linear SDR CPU/WebGL compositing. | Current multilingual/geometry/color/alpha/offline and equal-quality reference results. |
| M05 | Persistent preview worker/host adapter, bounded queues, MP4/WebM/PNG, native ProRes/PCM, retained cleanup and duration harnesses. | Current physical destination/cancellation/reference and duration evidence; broader maximum/host matrix. |
| M06 | Opt-in timeline, canvas, property/value/speed/path/operator/text-animation controls, parenting/nesting/work areas/clipboard. | Complete title/shape authoring, Save/reopen/export, Undo, focus/keyboard/accessibility and shaping workflows. |
| M07 | Masks/feather/mattes/blends/adjustments/effects, point/planar/stabilization/corner pin/chroma key and manual corrections. | Current tracked/keyed/masked pixels and history, stale-analysis/cycle/unavailable-effect behavior. |
| M08 | Closed deterministic expression AST, stable references, procedural/audio queries, diagnostics and baking. | Current seek/order/cycle/budget/cancellation/audio/bake evidence. |
| M09 | Perspective/orthographic scene authoring, lights/materials/shadows, translucent depth planes, deterministic lens/shutter sampling. | Current equal-quality browser/native references and other hardware/platform/maximum cases. |
| M10 | Explicit saved-revision transfer, Frame successor connection/conform/Undo/Resume, native watcher, retained offline preview/finish/export. | Current full link/dual-origin/offline/atomic/concurrent export and actual platform-isolation evidence. |
| M11 | Readable installed-host scripts, reviewed editable subset, sampled/rendered alternatives, immutable original/report/media custody. | Actual installed AE export/reimport, reference frames/subframes and tested host-version matrix; environment unavailable. |
| M12 | Own candidate/stable packaging, source-bound web build/deployment, signing/updater configuration, associations, handbook/copy and capability register. | Complete current canonical gates/coverage/ratchets, credentialed target/install/update and publication acceptance. |

File provides New Composition, Open/Save/Save Copy, media import, compositions,
After Effects Bridge, Send Composition to Framescaper, Render and Render Queue.
View opens the workspace, canvas, preview and timeline; Layer opens properties,
paths, operators, appearance, compositing, tracking, expressions and scene tools.
Help opens the own handbook/tutorials and the desktop's manual own-tag update
check. These are implemented opt-in surfaces, not missing menu placeholders.

Source authorities include `src/common/editor/ui/motionscaper/shell-menu.ts`,
`MotionscaperDocumentRuntime.tsx`, the Motion project/evaluator/renderer owners,
`src/framescaper/editor-composition-link-*`, and the dedicated desktop IPC.
The [release preparation](../operations/motionscaper-release.md) also exists:
Motion Pages tables, own stable workflow and exact source/artifact deployment
checks are implemented. The register remains on the candidate channel. No tag,
register activation, hosted deployment, dispatch or publication was performed
by this recovery.

## Latest integrated validation

All twelve packages remain **In progress**. The complete implementation and a
passing focused workflow are distinct from the required combined acceptance.
These newer results retain their own source identities; none changes the failed
source-328 ledger below into a pass.

| Gate and source | Latest terminal result |
| --- | --- |
| Complete static gate, `17b8a6964` | Passed full lint, types, architecture, audits, documentation and builds, with an 8 GiB Node heap. Source and observed process closure were verified. Subsequent changes retain their own focused checks; this result is not retagged to newer source. |
| All five exhaustive Node partitions, `17b8a6964` | Passed: 27,295 tests, 27,281 passed, zero failures/cancellations and 14 declared skips. Motion's 1,095 tests passed without skips, including real pinned-helper MOV decoding. The isolated desktop deadline and paired-download cases passed in the unchanged complete gate. No Node heap override was set. Source, staged inputs, observed processes and raw-profile closure were verified; raw coverage remains unparsed and unadmitted. |
| All five exhaustive Node partitions, `3e8b3e942` | Closed failed: 27,286 tests, 27,270 passed, two failures and 14 declared skips. Motion's 1,086 tests passed without skips, including real pinned-helper MOV decoding. Common-2 failed the isolated desktop AudioWorklet deadline check; Sound failed a paired-download test that observed the second archive before its report. All partitions and owned processes closed. |
| Paired-download test repair, `b2688a52d` | All five original test-file cases passed after waiting for the existing action's completion across its release timer and MessageChannel task. Exact filenames and blob retention/revocation assertions remain unchanged. Strict types, changed-file lint and size checks passed. This focused result does not replace the failed whole Node gate. |
| Desktop deadline diagnosis, `3e8b3e942` | Two bounded passive observations passed with exact PCM and no deadline fault. Neither reproduced the historical failure. The first omitted the gate's coverage/loaders; the second restored them but added an unproven 8 GiB heap setting. The cause remains unknown and no production repair is claimed. |
| Fresh complete ordinary browser run, `3e8b3e942` | Active: all 7,542 discovered cases, 2,514 per engine, four workers and zero retries. Chromium's Import/Split shortcut case timed out waiting for its file chooser; the run continues. Fresh sites/maps and exact source/dependency/browser inputs were verified. No terminal result or coverage acceptance is claimed yet. |
| Passive Import/Split observation, `3e8b3e942` | The original single Chromium workflow passed once with bounded passive focus/key observation. All 63 recorded events fit the cap, and the shortcut opened its chooser. No focus steal was observed. This changes scheduling and does not reproduce or explain the full-run timeout. |
| Deferred panel focus repair, `01e0f3d55` | Deterministic controls reproduced an older queued handoff overriding a newer user focus choice. The fix retires superseded requests while preserving trigger restoration and the original 30-frame mount bound. All 71 focused cases, eight dispatch controls, strict types, lint, architecture and build passed. The default-heap test typecheck exhausted memory; its explicit 12 GiB retry passed. This proves a separate focus defect and does not establish the cause of the browser Import timeout. |
| Saved-kind and mixed-rate consumer contracts, `82c9aaa3f` / `bcdc43f1f` | New controls preserve all ten layer kinds, animated property kinds and exact asset bodies through store/archive reopen; an authored rational-clock/pixel oracle agrees across actual preview playback, shuffled seeks, export, saved links and Frame thumbnails. These are Node/CPU and instrumented-IndexedDB checks, not physical-browser durability or codec qualification. Four final focused cases passed after repairing an existing test's missing temporary-directory parent. The initial auxiliary Motion shard remains failed: 1,094/1,096 passed, one setup failure and one native-artifact skip. |
| Retained mixed-image reopening, `cbf09f9ea` | The unchanged workflow passed Chromium, Firefox and WebKit, without skips or retries. Per-file read serialization fixes the reproduced same-worker exclusive OPFS lock collision; the retained image was intact. This does not claim cross-worker or read/write arbitration. |
| Complete linked/dual-origin suites, `19bc434e8` | Closed failed: 34/36 linked cases and 8/9 dual-origin cases passed. Firefox failures were image reopening and an absent-host GPU assertion; WebKit lost the archive of a two-download pair. All three first linked-editor/offline/export workflows passed. |
| Fresh complete linked/dual-origin suites, `c61839c8d` | Closed failed: 34/36 linked and all 9/9 dual-origin cases passed. Chromium failed on a native-export audio-clock gap; WebKit failed while waiting for Resume to adopt a saved revision. Firefox passed all linked cases. GPU/loss/restore checks passed on capable hosts. |
| Native linked-export variants, `c38e0c2a2` | Both unchanged variants passed in all three engines: six cases, without skips or retries. Native PCM delivery now keeps its capture clock running under bounded backpressure; deterministic controls still reject actual clock loss and blocked sinks. This earlier focused result alone did not close the full suites. |
| Complete linked/dual-origin suites, `1887abecc` | Passed all 36 linked and nine dual-origin cases across Chromium, Firefox and WebKit, without failures, skips or retries. All three first linked-editor/offline/export workflows passed with real exports and retained current-release bodies. Chrome I420 and WebKit NV12 plane checks passed; Firefox's native BGRX result remains plane-unqualified. The separate Chromium absolute-HTML blue-241 limitation is retained. |
| Required five-workflow Linux aggregate, `1a788b61b` | Passed launch, scene, authored title, successor picture/PCM and saved-file link workflows. The authored workflow covers actual New, shape/text authoring, native Save, preview and cancellation/retry. Its decoded RGB error was 3.93/1023 against the unchanged eight-code limit; alpha was exact. The complete five-workflow aggregate admits Linux x64 only; other targets remain open. |
| Fresh five-workflow Linux aggregate, `1202edeba` | Closed successfully with all five source-bound markers, source/artifact guards and final absence of all 74 recorded process identities. Independent completed-evidence audit passed without replay. The unchanged legacy launch/scene/successor scripts await Electron closure without retaining its numeric code/signal; strict command closure must not be described as a new per-Electron exit-code assertion. |
| Six unchanged WebKit regression workflows, `cbf09f9ea` | Punch, three tempo workflows, musical selection and configurable-effects search passed, without skips or retries. Non-reproduction does not establish the causes of their earlier failures. |
| Controlled-duration browser workflow, `fa68087f7` | Passed both 300- and 1,200-frame workloads: preview, PNG/WebM output, independent picture/timestamp/audio checks, actual cancellation/retry, memory limits and cleanup. All 591 memory rows were audited; peak RSS was 2,078,101,504 bytes, below the unchanged 2 GiB bound. This qualifies the fixed software Chromium profile, not maximum workloads or other hosts. |
| Controlled-duration native workflow, `fa68087f7` | Closed failed after generating the 300-frame movie, when encoder identity/argv observation was rejected. Fourteen real encoder-memory observations exceeded the unchanged minimum of three. Output-only diagnosis subsequently passed selected pictures, all timestamps and exact PCM, but cannot qualify that failed invocation, which did not complete cancellation/retry, 1,200 frames or the memory comparison. |
| Controlled-duration native workflow, `5ca4a2ea1` | Closed failed during application shutdown with SIGTRAP, after all three 300-frame movies and cancellation/retry. File-only reference checks passed for those movies; 1,200 frames did not run. The exact shutdown signal chronology was not captured, so the historical cause remains unproven. |
| Native shutdown repair, `d49ce710f` | The observer sends graceful termination to the application owner first and awaits closure before authenticated residual cleanup. Nine new controls and 93 combined observer/CDP regressions passed, including a real parent/dependent process control. Strict application exit and signal refusals remain unchanged. |
| Controlled-duration native workflow, `1202edeba` | Passed both 300- and 1,200-frame preview/ProRes workloads, cancellation/retry at each duration and all six independently decoded MOV references. All 449 memory rows and 81 real encoder observations were audited; peak whole-application RSS/PSS was 1,075,535,872/625,772,544 bytes. Exact PCM, contiguous timestamps, picture/alpha bounds, memory tails and final process absence passed. This qualifies the fixed Linux x64 profile, not maximum workloads or other hosts. |
| Complete accepted coverage union and external matrix | Open. Failed raw profiles remain unparsed and unadmitted; no coverage floor, startup ceiling, timeout, color bound or signal bound was weakened. No installed AE environment is available. |

The latest complete Node receipt is `current-17b8a6964-node/closed.json`, SHA-256
`d9fa8b9a9f9d18f0e4d9947a30c28cb88557e9812d97987f9b2a16882a382967`.
Its post-audit is `current-17b8a6964-node/post-audit.json`, SHA-256
`15b7c1b0533f16d2f3974019b5f0ec29bc26fb5957193f94d52a3acb10f338df`.
It verified 51,372 input pins, absence of all 5,239 recorded PID/start identities
and empty root sessions, plus 5,261 stable raw profiles (13,198,215,341 bytes).
The lifetime census was sampled; it does not prove every unobserved detached
process birth. These raw profiles have not been parsed or admitted as coverage.
The latest static receipt is `current-17b8a6964-static/closed.json`, SHA-256
`9d407f85397bde43b02c38ee46f974bfb6b5cd359b768a3faaeb9bb977bff892`.
The earlier failed Node receipt is `current-3e8b3e942-node/closed.json`, SHA-256
`64ad72571cdc144cf707071bd25105b89331230d6f27d7080ed775aa5a17fda3`.
All five commands closed, source and staged helper bytes remained unchanged,
and all observed owned process identities were gone. Its static receipt is
`current-3e8b3e942-static/closed.json`, SHA-256
`696732565f03678b1cae919d7866563aca8a6c26e4c46791de565f54ddab5b08`.
The paired-download test qualification is
`transfer-sender-action-wait-3e8b3e942/qualification.json`, SHA-256
`4f06725d12cf76125ed0fa6d90ce69cbc4578b4b0a037e8686d852382a03f9f6`.
The full 45-case linked/dual-origin qualification is
`link-retention-1887abecc/qualification.json`, SHA-256
`9b5a4a88d860bbb9bf5e9741a1a0baa40eb4abed14f759b94666b4851e11af30`.
The five-workflow aggregate closure is
`current-1a788b61b-native-qualification/aggregate-recorder-command/outer-tool-closure.json`,
SHA-256 `c43cf8e6cd48d586ca1b2aa6e88b0cb6bfd64551d14f5d79bf3b6ed205ece604`.
The newer source-1202 aggregate qualification is
`current-1202edeba-native-qualification/linux-aggregate/qualification.json`,
SHA-256 `ee88688b4c5b7ac716c90c48c586daef28f63e57c11089b7d5f90fa52f7f3c5d`;
its actual tool closure and post-run audit are retained in
`current-1202edeba-native-qualification/aggregate-command/outer-tool-closure.json`,
SHA-256 `b8a597a4de2f61198c4cac38228936b70a1d5438a6fefbb0e518528cbab16126`.
Its independent completed-evidence review is
`current-1202edeba-native-qualification/aggregate-command/independent-duration-audit-final.json`,
SHA-256 `86afe81fa51e9517e7c32c134f417d10ba12de7d80911c361e942617a9e04c00`.
The new saved-kind/consumer qualification is
`early-contract-tests-17b8a6964/qualification-final.json`, SHA-256
`61d4fbcf9361f89518bd7de20ecf8fbbff3cd89074aeb89ad59fc32c7d5b3b9e`.
The focus repair qualification is
`m12-panel-focus-ownership-17b8/qualification.json`, SHA-256
`c7a947d1c7c611130928ad95b5273c7d4891b33345ef06041f5c5a0cacc210de`.
The browser duration receipt is
`current-fa680-sustained-browser/workload/qualification-receipt.json`, SHA-256
`d7694f821c83982d65007b4852d55ab172b4fefc6539b4b9d865f9c789c45e07`;
its independent audit is `current-fa680-sustained-browser/qualification-audit.json`,
SHA-256 `9768301276c6fe9a0fc1aa3554d216af4ff2fb7b36bd69fe5186710e0278c59d`.
The native duration receipt is
`current-1202-sustained-native/workload-preserved/qualification-receipt.json`,
SHA-256 `cdf0666578f30ded1bc85d0e5f3ddce18cec1a38abd4281139db6ef08b547d05`;
its independent audit is
`current-1202-sustained-native/independent-qualification-audit.json`, SHA-256
`379771a18a310225e6e59ae1f1401366596f5a75a137763f4e6c094388453669`.
That audit preserves the raw last-scan zombie observation separately from the
later successful fresh absence check; it does not rewrite the raw ledger.
Native package custody preserves the original sandbox bytes/inodes and records
changes to historical package metadata; older packages are not silently
requalified after those changes.

The duration profile is **300 and 1,200 frames**, or ten and forty seconds at
30 fps, not 300 and 1,200 seconds. Its fixed picture, PCM, memory, timing and
cleanup requirements remain unchanged.
Earlier source `cbf09f9ea` duration attempts remain failed: the browser command
observer rejected process-stat admission, and the native observer captured only
two encoder-memory rows. The later browser pass and native failure above are
separate runs, not replacements for those historical outcomes.

## Frozen source-328 gate ledger

| Gate at source 328 | Result recorded on 2026-10-13 |
| --- | --- |
| Canonical static gate | `npm run check:static` passed, including full lint, types, audits, documentation and builds. Changed-file lint remains required for subsequent edits. |
| All exhaustive Node partitions | All five finished: 27,125 tests, 27,108 passed, 14 declared skips and three failures in common-2's nightly-payload dependency closure. Motion's 953 tests passed without skips. Full Node acceptance is failed. |
| Ordinary Chromium/Firefox/WebKit suite | Closed with exit 1: 7,536 cases, 7,207 passed, 25 failed, 303 declared skips and one unrun serial-dependent case. Chromium: 2,492 passed, three failed, 17 skipped. Firefox: 2,368 passed, nine failed, 134 skipped, one unrun. WebKit: 2,347 passed, 13 failed, 152 skipped. Full browser acceptance is failed. |
| Separate dual-origin and Motion-links suites | Canonical complete runs pending. The first linked-editor workflow subsequently passed all three engines on source `f316e407e`, including physical export and reopening after both origins closed. This is three cases, not complete suite acceptance. |
| Handbook browser suite | All 32 cases passed, without skips or retries. |
| Fresh bounded Linux packaged aggregate | Passed all nine steps and four workflow receipts for Linux x64 software rendering, with verified packages, native helper and independent decoder. This does not cover the separate authored-title failure below. |
| Browser and native controlled-duration workflows | Pending for this source. |
| Complete accepted Node/Chromium coverage union and monotone ratchets | Pending. Only the closed passing common-1 Node profiles have been strictly audited and compacted. Failed common-2 and failed ordinary browser profiles have not been admitted; no floors or ceilings were lowered. |
| Installed AE, other target/sign/install/update/hardware/maximum matrix | Open; AE environment unavailable. |

The terminal report matches all 7,536 discovered case identities and records
one attempt per case, no retries, no flaky outcomes and no global report errors.
The source and all seven site inventories remained unchanged. The omitted
Firefox case is the rehearsal-edit workflow after the serial ADR failure.
The durable `browser-ordinary/terminal-review.json` receipt has SHA-256
`71a159f8895a70cd47f1282d17738cfb8038cdf0bc7ca2e952fbd7b5a30dc526`;
its failure/skip ledger retains every original error and declared skip.

### Failures and repairs in progress

The three Chromium failures are Spreadsheet Undo after an asynchronous paste,
Contrast after attenuation, and the recording-louder guide's authored Amplify
value. The integrated Spreadsheet repair waits for the existing checkbox to
become enabled before Undo; its unchanged complete file passed 42 cases across
all three engines. The integrated Amplify repair reserves a user's draft before
late headroom analysis; its 32 focused Node checks and both original workflows
passed across all three engines. These focused passes do not replace the failed
source-328 results or establish acceptance of the combined implementation.

The three common-2 failures come from the sustained-browser verifier importing
the entire host workload into the portable nightly payload. A separate repair
extracts the reference verifier and stages its four actual dependencies. The
original failing assertions and new omission tests pass on the integrated
repair. These focused results do not make the original full-suite failures
successful. The frozen source-328 browser capture remains unchanged.

The integrated rack-dialog repair mounts the header with its loaded parameter
controls, preventing the demonstrated Close-target movement during loading.
Both loading regressions and the original Radio/ADR workflows passed all three
engines; the unchanged resize workflow also passed in a separate follow-up.
The original full-run failures remain recorded.

Five direct GPU checks now require an independent native host witness. Their
original comparisons passed in Chromium and WebKit; Firefox's absent WebGL2
produces five explicit qualification skips. CPU fallback checks remain intact;
these skips do not prove Firefox GPU fidelity. The real-audio readiness check
now observes a live analyser/clock/playing tuple in-page within the original
five-second deadline. A failed diagnostic captured loud intervals missed by
cross-process polling. The unchanged one-second playback, signal, queue and
pause assertions passed all three engines after this observation repair.

The frozen full run also exposed Punch recording, short-import playback and
post-workspace-switch tempo failures. Bounded unchanged-workflow diagnostics
passed the latter two categories but did not establish their original causes.
They remain unresolved; no timing or signal bounds were relaxed.

WebKit's remaining failures also include three live-effect continuity cases,
musical-number tempo editing, a disabled Select menu and a return-to-home
navigation timeout. The annotation workflow reached and closed
the read-only Frame view; its timeout occurred during the subsequent Sound
home navigation, before checking reopened annotations. These failures remain
open. The integrated search repair cancels stale opening and restoration focus
frames on activation or unmount. Its causal mounted-component controls fail on
the old implementation and pass normally and in StrictMode after repair. The
unchanged search workflows and cold effect-dialog controls passed 36 cases
across all three engines on source `d8dbe9a4c`; these focused results do not
close full browser acceptance. Integration also fixes the rack dialog's chunk
ownership and extracts shared video transfer functions without changing their
numerical formulas.

A paired capture of the original three WebKit live-effect workflows passed
their ScriptProcessor assertions on frozen source 328. Its independent native
observer nevertheless found a 26.12 ms near-silent EQ interval inside the
post-edit window. Both observers used the same live output; native input and
frame continuity guards passed. A read-only audit found no persistent EQ
history reset. Synchronous audio-thread coefficient rebuilding and upstream
chunk starvation remain possible causes. The passing ScriptProcessor checks
therefore do not qualify native continuity or resolve the original failures.
The first prepared additive observer was refused before execution because it
selected the final destination instead of the intermediate two-input join.
A corrected preparation retained the original 53 controls and passed 71 added
controls, with 286 input pins and independent review. Its single actual WebKit
diagnostic closed failed: the original test body passed, but diagnostic admission
found the injected selector missing and no additive observer. Source/site guards
and process closure passed. This instrumentation failure provides no causal
evidence for the historical gap; callback coverage and the cause remain open.
Its terminal receipt is
`webkit-eq-mixed-join-328cae02f-cpu12-15/run/closed.json`, SHA-256
`e66d777bde5238923c1d05151d80ad3eaad19c5012caa9b127916f2146a7ca0a`.

Supplemental M10 execution reached actual connection, update, Undo/Resume,
Conform, portable Save/Open and matching blue preview in Firefox. Delivered MP4
pixels exceeded the unchanged green-channel limit. Inspection found BT.601
planes declared as BT.709. The integrated finishing conversion now produces
explicit limited-range BT.709 planes. Firefox passed the original full case;
WebKit media initialization was separately diagnosed and repaired, and its real
delivery passed the color check before a later offline failure. Chromium's
correct 709 file exposed a separate native canvas conversion approximation.
An independent file oracle with retained absolute presentation measurements is
being qualified; the original HTML-pixel failure is not relabeled successful.
Offline reopening also required avoiding an unused portable-recovery import.
That key-only custody admission repair is integrated, with present/corrupt and
cancelled custody checks preserved. The first complete linked-editor workflow
now passes in Chromium, Firefox and WebKit on source `f316e407e`, with no
retries, skips or errors. Each engine verified 121 current-release cache bodies,
including eight used fonts, against the manifest and actual built bytes. Both
owned origins then closed before reopening the same stored owner with a ready
editor, blue preview, matching link digest and no page errors. All 1,415 site
and source-map files remained unchanged. The receipt is
`video-color-repair/used-assets-dotted-original/qualification.json`, SHA-256
`e7b4d1509a37df5015bddb52cad11e2716066c03ba24d1c7ef3fa8fa4106fcfc`.

The integrated delivery repair completes missing color signaling only for the
encoder's own limited-range BT.709 AVC output. Bounded native configuration
repairs preserve picture bytes and timing and leave the general metadata
parser strict. The offline repair replays the observed completed asset set
through the current worker; it does not claim complete historical inventory or
general persistence. The workflow separately proves its actual cache custody.
Chromium's absolute native/HTML blue value remains 241; its normative decoded
file planes satisfy the unchanged twelve-code bound and match an independent
same-plane presentation control. Firefox's BGRX native output satisfies that
bound but does not qualify normative YUV-plane decoding. Earlier absolute
presentation failures remain recorded. Complete linked and dual-origin suites
on the combined implementation remain pending.

The supplemental M05 desktop workflow completed real New Composition, shape/text
authoring, Save, preview, cancellation and retry, and produced a ProRes 4444 MOV.
Its strict color check failed: 9.83 ten-bit code values versus the unchanged limit
of eight, at two text-edge channels across two frames. Alpha was exact. Encoding
the retained CPU reference produced identical movie and decoded bytes. A
precodec conversion stayed within the bound. The integrated native quality
repair passed all five native CTests and a fresh maintained helper/reference
replay of the retained authored input, with a maximum 3.93-code error against
the same eight-code limit. Those receipts remain bound to source `f66040509`,
not the newer combined implementation. They do not establish a new packaged
GUI result.
The maintained authored-title workflow checks exact saved menu intent and
decoder/CanvasKit byte authority; its initial 14 focused checks passed before
fresh native execution. The later source-9173 standalone success is recorded
above. Menu execution and the earlier small-scene aggregate did not close the
failed authored-title gate; the required combined aggregate and duration gates
remain separate. Normal native reuse verification
and a fresh maintained reference-decoder build/verification passed on clean
source `a92368082`; all seven prefix trees and 172 files remained unchanged.
The native receipt retains its original `f66040509` identity. These phases did
not stage or package a desktop application, run the GUI or change its sandbox.

Integration preserves each original repair commit in Git ancestry. Eight
finished auxiliary worktrees were removed after their commits were merged;
remaining worktrees stay below the ten-worktree limit. No source, dependency,
site or packaged bytes used by the completed frozen capture were changed.

The retained evidence includes `gates/static-result.json`, all five
`node/*-result.json` files, the handbook result, and
`native/linux-qualification-review.json`. The native aggregate digest is
`4fdb6f5fbaa2d5bfca7afc857ef5fd6f5ec6dee7ee8ccd1866a0db4d3ce6c883`.
The static log digest is
`3effb9ef8aaba6577e5c758ac4c720687dec6e8ce2581611e26223deb489eb61`.

## Historical reports, not recovered proof

The conversation recorded the following outcomes on 2026-10-12 for
`c80ac57f384318f3284851abda461cacb6f629d8`. Their temporary files are now lost;
these rows preserve history only and must not be presented as accepted current
source-bound evidence.

| Historical c80 activity | Reported outcome before evidence loss |
| --- | --- |
| Full static | Reported successful. |
| Five Node partitions | Reported 27,125 tests: 27,111 passed, 14 declared skips, zero failures. The lost skip ledger cannot be reconstructed from totals. |
| Handbook browser suite | Reported 32 unique cases passed once, without skips or retries. |
| Bounded software Linux x64 packaged aggregate | Reported all nine steps and four required workflow receipts successful. |
| Controlled native duration | Reported 300/1,200-frame 160×90 software preview/ProRes/PCM, references and actual cancellation/retry within predeclared bounds. |
| Controlled Chromium duration | Failed after physical 300-frame PNG/WebM output, during the post-export WebM verifier loader. The 1,200-frame phase did not run; no duration qualification was produced. |
| Full ordinary/supplementary browser and coverage union | No complete accepted result recorded. |

The browser failure was in the maintained verifier's global exposure after
loading an esbuild IIFE through `page.evaluate`. Current source uses
`page.addScriptTag` before calling the verifier. That implemented correction and
its earlier focused report are not a substitute for a new complete workload.
Earlier e44 documentation-discovery and CDP startup failures, the subsequent
bounded one-frame diagnostic, and their repairs were also recorded historically.
They must not be converted into successful full-workload or release claims.

The committed [Linux qualification page](motionscaper-linux-ci-qualification.md)
retains older source-attributed hashes and small-scene measurements. Those are
historical text; receipts are missing and generated bytes were not reverified.
Do not recreate old receipt JSON with invented process identities or label a
new package with an old successful revision.

## Capability and external limits

- The [AE bridge](motionscaper-after-effects-bridge.md) has a documented editable
  subset, not general project or plug-in compatibility. Scalar opacity expression
  translation is opt-in; untrusted declarations do not authorize execution.
  Text, shape, scene and Gaussian mappings require their reviewed metadata and
  profiles. No installed-AE version, frame parity or reimport is qualified.
- Editable Motion-to-AE exchange is muted/video-only. Complete rendered transfer
  covers at most 256 frames of one composition as 8-bit straight-alpha sRGB PNG,
  omits transferred audio, and retains `original.mscape`. Unsupported arbitrary
  projects are not guaranteed an editable-or-baked transfer within these bounds.
- [Direct AEP research](motionscaper-aep-native-format-research.md) reviewed
  Storytold and external candidates; no candidate dependency was adopted or run
  as a native project importer here. Direct parsing/native AE plug-in hosting
  remain separate feasibility work, not a hidden release claim.
- The historical ephemeral Linux WebKit host refused native video encoding and
  lacked credentialless isolation. Policy-preserving link transfer cannot be
  called actual COI there. Larger original archive copies require a streaming
  picker or persistent temporary storage; absence is a visible pre-read refusal.
  These are specific host/capability observations, not general Safari claims.
- Bounded software Linux and one fixed duration profile do not qualify hardware
  GPUs, maximum scene combinations, macOS Safari, other OS/architectures, signed
  installers, file associations or real installed update behavior. The configured
  workflows and finite admission limits do not supply missing execution results.

No installed AE environment is available; no further request is needed. That
explicit M11 gate also keeps the M12 public-release gate open even if all locally
runnable checks later pass. Fresh results should replace only the current gate
ledger with their actual evidence, preserving failed/history attribution and the
qualified source revision after any documentation-only descendant.

This documentation changes no assistance runtime or its target asset inventory.
No manual **Update AI assets** run is required.
