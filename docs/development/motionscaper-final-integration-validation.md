# Motionscaper final integration status

Status: **M01–M12 In progress**. The surviving implementation source is
`328cae02fb961d87524a6bcb37c54800b3ae7026` on
`feat/motionscaper-final-validation`. This status records fresh validation on
2026-10-13, with the ordinary browser run still active. It does not mark any
milestone complete or certify a release.

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
| Ordinary Chromium/Firefox/WebKit suite | Active, 7,536 discovered cases. Chromium finished with 2,492 passed, three failed and 17 skipped; all 139 Motion-named Chromium cases passed. Firefox and WebKit results are pending. |
| Separate dual-origin and Motion-links suites | Canonical complete runs pending. Supplemental real-editor Firefox delivery failed its unchanged blue-pixel bound; Linux WebKit timed out during video encoding. |
| Handbook browser suite | All 32 cases passed, without skips or retries. |
| Fresh bounded Linux packaged aggregate | Passed all nine steps and four workflow receipts for Linux x64 software rendering, with verified packages, native helper and independent decoder. This does not cover the separate authored-title failure below. |
| Browser and native controlled-duration workflows | Pending for this source. |
| Complete accepted Node/Chromium coverage union and monotone ratchets | Pending. Only the closed passing common-1 Node profiles have been strictly audited and compacted. Failed common-2 and active browser profiles have not been admitted; no floors or ceilings were lowered. |
| Installed AE, other target/sign/install/update/hardware/maximum matrix | Open; AE environment unavailable. |

### Failures and repairs in progress

The three Chromium failures are Spreadsheet Undo after an asynchronous paste,
Contrast after attenuation, and the recording-louder guide's authored Amplify
value. The Spreadsheet repair waits for the existing checkbox to become enabled
before Undo; its unchanged complete file passed 42 cases across all three engines
on a separate repair branch. Contrast and Amplify remain under investigation.

The three common-2 failures come from the sustained-browser verifier importing
the entire host workload into the portable nightly payload. A separate repair
extracts the reference verifier and stages its four actual dependencies. The
original failing assertions and new omission tests pass on that repair branch.
These focused results do not make the original full-suite failures successful.
Neither repair is yet integrated into the frozen source-328 browser capture.

Supplemental M10 execution reached actual connection, update, Undo/Resume,
Conform, portable Save/Open and matching blue preview in Firefox. Delivered MP4
pixels exceeded the unchanged green-channel limit. Inspection found BT.601
planes declared as BT.709; an explicit WebCodecs conversion repair is in progress.
WebKit's encoder timeout is a separate unresolved result. The complete final
offline-editor step was not reached in either run.

The supplemental M05 desktop workflow completed real New Composition, shape/text
authoring, Save, preview, cancellation and retry, and produced a ProRes 4444 MOV.
Its strict color check failed: 9.83 ten-bit code values versus the unchanged limit
of eight, at two text-edge channels across two frames. Alpha was exact. Encoding
the retained CPU reference produced identical movie and decoded bytes. A
precodec conversion stayed within the bound; native ProRes quality is being
repaired. Menu execution and the passing small-scene aggregate do not close this
failed authored-title gate.

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
