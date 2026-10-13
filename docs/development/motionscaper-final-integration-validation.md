# Motionscaper final integration status

Status: **M01–M12 In progress**. Reviewed repairs are integrated into
`feat/motionscaper` in the main Motionscaper worktree. The separate ordinary
browser capture still uses frozen source
`328cae02fb961d87524a6bcb37c54800b3ae7026` on
`feat/motionscaper-final-validation`. This status records fresh validation on
2026-10-13. Its results do not qualify the newer combined implementation,
mark any milestone complete or certify a release.

## Evidence boundary

The environment reboot removed `/tmp` proposals, execution logs, receipts and
preservation/reference artifacts stored there. The old reports below remain
historical. Fresh sites, native helpers, reference decoders and Linux packages
were built and verified separately against source 328. Their new receipts do
not reconstruct the lost runs. Source and committed configuration alone prove
implementation, not execution or compatibility.

Fresh results below have terminal process results and retained evidence under
`~/.cache/soundscaper/motionscaper-recovery-328cae02f-20261013/` on the validation
host. The browser invocation is still running; its partial results are explicitly
identified. Changed source will need the applicable gates again. Do not infer
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

## Current gate ledger

| Gate at source 328 | Result recorded on 2026-10-13 |
| --- | --- |
| Canonical static gate | `npm run check:static` passed, including full lint, types, audits, documentation and builds. Changed-file lint remains required for subsequent edits. |
| All exhaustive Node partitions | All five finished: 27,125 tests, 27,108 passed, 14 declared skips and three failures in common-2's nightly-payload dependency closure. Motion's 953 tests passed without skips. Full Node acceptance is failed. |
| Ordinary Chromium/Firefox/WebKit suite | Closed with exit 1: 7,536 cases, 7,207 passed, 25 failed, 303 declared skips and one unrun serial-dependent case. Chromium: 2,492 passed, three failed, 17 skipped. Firefox: 2,368 passed, nine failed, 134 skipped, one unrun. WebKit: 2,347 passed, 13 failed, 152 skipped. Full browser acceptance is failed. |
| Separate dual-origin and Motion-links suites | Canonical complete runs pending. Color conversion and browser media initialization repairs have focused evidence; the full linked/offline workflow and new file/presentation oracle remain under qualification. |
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
musical-number tempo editing, a disabled Select menu, search activation and a
return-to-home navigation timeout. The annotation workflow reached and closed
the read-only Frame view; its timeout occurred during the subsequent Sound
home navigation, before checking reopened annotations. These failures remain
open. A separate delayed-focus control is investigating search activation;
it does not establish acceptance of the original workflow.

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
cancelled custody checks preserved. Used-font persistence and real owned-origin
shutdown/reopening are still being qualified.

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
The maintained authored-title workflow now checks exact saved menu intent and
decoder/CanvasKit byte authority; its 14 focused checks pass. Its real native
Save, preview, destination cancellation/retry and export execution remains
pending on a fresh package. Menu execution and the earlier small-scene aggregate
do not close the failed authored-title gate.

Integration preserves each original repair commit in Git ancestry. Seven
finished auxiliary worktrees were removed after their commits were merged;
remaining worktrees stay below the ten-worktree limit. No source, dependency,
site or packaged bytes used by the active frozen capture were changed.

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
