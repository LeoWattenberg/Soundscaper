# Quality budgets and benchmark qualification

Soundscaper's quality-budget foundation is **in progress**. The checked-in
ledger names fixtures and proposed numeric limits, validates its own contract,
and provides a deterministic fail-closed evaluator. The five frozen milestone 2
first-party structural workloads have qualified. On 2026-08-21 the project
owner also designated the Windows x64 RTX 3090 machine as the fixed-GPU
reference and accepted its M1 preview, M4 production-parity, and M4B-2 keyed
parity results. Other timing, heap/RSS, third-party codec-memory, device,
durability, and release-platform workloads remain open.

The source of truth is
[`config/quality-budgets.json`](../config/quality-budgets.json). The roadmap
describes product outcomes; this ledger gives those outcomes stable workload,
fixture, environment, metric, and threshold identifiers.

## What is active today

- Node 26.5.0, npm 12.0.1, Playwright 1.61.1, and the Playwright browser
  revisions are pinned from checked-in dependency and workflow inputs.
- Chromium browser workflows run in the digest-pinned Playwright container.
  Their release status remains provisional.
- Firefox and WebKit now run in the maintained functional matrix alongside
  Chromium. All three remain provisional rather than performance- or
  release-qualified. Playwright WebKit is useful engine evidence; it is not by
  itself a Safari release qualification.
- The four 128x72 video-effect parity frames are deterministic and SHA-256
  pinned. Their full FFmpeg/WebGL audit is still opt-in.
- The milestone-4 production-parity fixture adds one second of digest-pinned
  48 kHz stereo Float32 vectors, exact impulse/PDC and automation landmarks,
  and a focused four-frame FFmpeg/WebGL workload. Run its one-worker,
  no-retry collector with `npm run quality:collect:m4-production-parity`.
  Local and hosted runs identify themselves as local/hosted correctness and
  remain `pending-external` while their five metrics pass. A metric failure is
  recorded as `failed`, independently of environment qualification. After the
  reference descriptor is provisioned, `npm run
  quality:collect:m4-production-parity -- --reference <output-directory>`
  enables explicit qualification. The provisioned runner must set
  `SOUNDSCAPER_M4_REFERENCE_HOST_OBSERVATION_PATH` to an independently captured
  `m4-reference-host-observation-v1` JSON record. Browser observations and that
  host-owned record
  assemble the complete OS/update-policy, CPU/RAM, GPU/VRAM/driver/WebGL,
  display/refresh/pixel-ratio, power-policy, browser-binary/launch-flag, and
  runner-label fingerprint. The collector requires a byte-exact descriptor
  match before publishing accepted evidence; the configured expected value is
  never used as observed evidence. A reference-mode identity or fingerprint
  mismatch aborts collection before writing either pending or accepted files.
  Accepted evidence pins the complete budget-config digest and, through its
  digest-bound raw artifact, the exact registered workload descriptor digest.
- Accepted fixed-GPU reference run, 2026-08-21: the project owner designated
  the Windows x64 downloadable-nightly machine at revision
  `657e2d67d57070b31bbfe7c8a2b76b5a54bbe082` as the reference. Its NVIDIA
  GeForce RTX 3090 ran through ANGLE/D3D11 with one worker, one attempt, and zero
  retries. The metrics phase passed all three collected workloads. M1 reported
  p95 frame interval `8.100000023841858` ms and retained-JS-heap delta `-7304`
  bytes. M4 reported maximum audio sample error `0`, PDC error `0`, minimum
  video SSIM `0.981534357583265`, maximum normalized channel MAE
  `0.020067401960784315`, and silently omitted effects `0`. M4B-2 passed all 12
  keyed preview/offline operations with no omitted, substituted, or fallback
  operation. The accepted scope is the metrics phase only; unrelated handbook
  failures made the enclosing nightly run fail and are not relabelled. The
  retained metrics artifacts are identified by summary byte length `8075` and
  SHA-256 `04ec246be3f0fef9c7b9447056f5a95f7c3b7ecb4e1465677cf2673625c090d6`,
  plus raw byte length `5268909` and SHA-256
  `eb7e9716d75b462f9118084a36ed9a5b2a0a38f309e5345a765e24162a399b45`.
- The 12-effect 1280x720 preview test records timing and heap data against a
  repository-owned, digest-pinned, six-second synthetic VP8 fixture. Its
  2026-08-21 owner-designated fixed-GPU reference run passed both thresholds.
  Decoder/audio scheduling and other platforms remain outside that acceptance.
- Hosted CI is suitable for deterministic correctness checks. Its shared CPU
  and software-renderer behavior make it ineligible for fixed-hardware timing
  qualification.

The existing 500,000-byte JavaScript chunk ceiling and 25 MiB Pages asset
ceiling remain independent build gates. Registering future measurements here
must not weaken either limit.

## Contract statuses

`qualified` identifies a workload covered by a reviewed result cohort.
`provisional` identifies broader fixture evidence that is not itself a
qualification gate. `planned` identifies an accepted future fixture and its
starting budget. `optional` applies only to milestone 7. `blocked` preserves the
milestone 8B upstream-design fence.

The top-level `qualification.qualifiedWorkloadIds` array admits a workload only
after it has all of the following:

1. a deterministic, digest-pinned fixture or generator;
2. a provisioned and exact environment descriptor;
3. an automated collector that emits all required finite metrics;
4. a result evaluated by `scripts/quality-budget-evaluator.mjs`; and
5. retained raw evidence from a no-retry run.

A workload does not become qualified merely because an individual test passed,
a proposed threshold was checked in, or a hosted runner happened to report a
fast result.

The accepted `m2-structural-aad0ba1` cohort binds all five frozen workload IDs
to source revision `aad0ba1`, the exact quality-budget digest, the scoped
portable Node environment, one attempt, zero retries, and checked-in byte
length/SHA-256 records for each ignored raw and accepted workspace artifact.
Each pair was re-read and independently verified after collection. This cohort
qualifies only the declared first-party structural counters; every broader
fixture limitation below remains in force. The composite
`m2-streaming-bounded-memory` performance workload is not in the frozen closure
set and remains planned.

## Measurement procedure

Correctness counters and exact media comparisons may run in ordinary CI.
Timing, retained-heap, device, and native-helper budgets use a fixed environment
and the following common procedure:

1. Build once from a clean dependency install and run against that exact build.
2. Verify the fixture digest or deterministic generator revision before the
   measurement begins.
3. Verify the complete environment identity. An unexpected renderer, browser,
   driver, device, power mode, or display mode is an environment failure, not a
   skipped or successful benchmark.
4. Disable Playwright retries and use one worker. Run one unreported warm-up
   trial followed by five measured trials in fresh browser contexts or fresh
   helper processes.
5. Use `performance.now()` for renderer elapsed time and a monotonic native
   clock for helpers. Do not mix wall-clock timestamps into elapsed metrics.
6. Compute percentiles with nearest rank: after sorting `n` values ascending,
   percentile `p` is item `ceil(p * n) - 1` using a zero-based index.
7. For Chromium retained-JavaScript-heap measurements, perform three forced
   collections before each before/after snapshot and use the stable snapshot
   specified by the workload collector. Record all raw snapshots. Other browser
   engines require a separately pinned process-level method rather than
   pretending the Chromium CDP method is portable.
8. Evaluate every threshold. A missing or non-finite metric, environment ID
   mismatch, or software renderer where hardware is required fails the result.
9. Retain raw samples, aggregates, environment identity, fixture digests, Git
   revision, threshold revision, and evaluator verdicts together.

Collectors must avoid materially changing the path under measurement. In
particular, synchronously calling `WebGL2RenderingContext.finish()` for every
preview draw changes GPU pipelining. A replacement preview collector should
record presentation cadence and GPU completion as separate metrics.

No benchmark retry may turn a failure into a pass. A failed run may be repeated
for diagnosis, but both runs remain evidence and the original result remains
failed.

## Metric units

Every threshold declares its unit from the `units` enum in
`config/quality-budgets.json`: `bytes`, `count`, `dB`, `frames`, `LU`,
`MiB/hour`, `ms`, `ratio`, `RTF`, `samples`, `seconds`.

A metric name that states its quantity binds the unit it may be published in — a
metric ending in `Seconds` is published in `seconds`, one ending in `Bytes` in
`bytes`, and so on. Enum membership alone is not enough: a threshold that names
one quantity and declares another leaves the collector to choose between
emitting the wrong unit and being rejected for emitting the right one, and the
published evidence record then misstates what was measured.

## Portable structural environment

`portable-node-structural-26.5.0` is active only for the five frozen milestone 2
resource workload IDs. It requires Linux x64, Node 26.5.0, npm 12.0.1, and the
`first-party-owned-structural-counters` measurement class. The result verifier
refuses any other workload even if it supplies passing numbers.

This environment qualifies deterministic counters such as maximum owned input
or output slices, sequentially retained bodies, final renderer Blob retention,
and partial publication. It is not eligible for elapsed-time, browser or
renderer heap, process RSS, native/WASM heap, codec amplification, garbage
collection, filesystem durability, packaged UI, or operating-system behavior.
Those remain explicit residuals of the provisional fixtures; no structural
result may promote them.

## Fixed hardware environments

The owner-designated fixed-GPU reference is the Windows x64 RTX 3090 machine
used by the accepted 2026-08-21 downloadable metrics run. Its packaged-runtime
identity is `owner-qualified-windows-x64-rtx3090-01`; the nightly-with-tests
runner formally verifies M4 against the exact observed Chromium/WebGL
fingerprint and writes `packaged-runtime/qualification.json`. That admission is
independent of Framescaper results in the same run. The older
`reference-linux-gpu-01` descriptor is retained only for older general-purpose
collector contracts and is not the M4 packaged-runtime qualification host.

Reference-host observations continue to capture these exact values for future
runs:

- OS image/revision and update policy;
- CPU model and logical core count;
- installed RAM;
- GPU model, VRAM, driver, and reported WebGL vendor/renderer;
- display resolution, refresh rate, and device-pixel ratio;
- AC/battery and performance-governor policy;
- browser version, executable digest, and launch flags; and
- the self-hosted runner labels that resolve only to this machine.

Future reference runs must fail if the captured identity differs. SwiftShader,
llvmpipe, another software renderer, or an unknown renderer cannot satisfy the
preview hardware gate.

The native OS, capture-device, and final release matrices are also
unprovisioned. Packaging on hosted Windows, macOS, and Linux runners is valuable
distribution evidence, but it cannot qualify real audio latency, camera,
microphone, display-capture, or system-audio budgets without controlled devices.

## Milestone 4B keyed render parity

`m4b2-keyframe-render-parity` is registered only as a provisional correctness
workload. Its deterministic 128x72 RGBA fixture evaluates hold, linear, eased,
and Bezier opacity curves at exact segment starts, interiors, and ends. Each of
the 12 operations must be rendered by both the preview and offline consumers;
the collector independently recomputes their frame comparisons and requires a
minimum SSIM of `0.98`, maximum normalized channel MAE of `6/255`, and exactly
zero omitted, substituted, or fallback operations.

Run the opt-in no-retry diagnostic with `node
scripts/collect-m4b2-keyframe-parity-quality.mjs`. Ordinary local and hosted
Playwright results remain correctness evidence only. The project owner's
2026-08-21 designation makes the retained Windows RTX 3090 metrics artifact the
accepted reference exception: all 12 keyed operations passed, with no omitted,
substituted, or fallback operation. This acceptance removes the 4B-2 reference-
GPU blocker; manual qualification and deliberate capability/profile/App-route
activation remain separate gates.

## Fixtures and project sizes

Small deterministic artifacts may be checked in with their byte length and
SHA-256 digest. Reference-scale projects should use lazy deterministic streams
or sparse fixtures so the test does not commit multi-gigabyte generated files.
The generator revision, seed, logical byte length, stream metadata, and expected
digest must still be stable.

The milestone 2 sparse fixture remains provisional and requires observable sparse-file
support. Its generator creates an exact 8,589,934,592-byte logical Zip64 archive
with current-schema project metadata and an 8,589,932,094-byte sparse-zero video
asset. That asset is pinned to SHA-256
`7feeb1e9eacb6561f3c5afb4ebf3896c8237660a9b4ed8917d3275c79bed38be` and
ZIP CRC-32 `2909126900`; these values are authentic fixture identity, not
placeholders.

`npm run quality:collect:m2-scape-8gib` runs the sparse full-import reference
once, admits one exact identity-bound diagnostic, and writes its provisional
raw/accepted pair under `test-results/quality/m2-resources`. It records maximum
protocol range and media-emission bytes, retained sink payload, and invalid
publication count; it does not turn the fixture's OPFS, RSS, packaged UI,
durability, or publisher-authentication exclusions into qualified claims.

A second provisional milestone 2 fixture drives direct WAV export with an exact
3,153,920-frame, 48 kHz, 32-channel silent-float plan. Its 403,701,760-byte PCM
payload is exactly 385 MiB, one MiB above the desktop 384 MiB output-memory threshold;
the complete 403,701,804-byte RIFF has pinned SHA-256
`f1978598e11527049bcafae0f1d4847238e5322e11fddf714cc9f298bf12f9fe`.
The opt-in Node witness uses the production planner, export controller,
channel-aware PCM sink queue, passthrough streaming resampler, WAV stream
encoder, and exact-size direct-destination adapter. A counting SHA-256 target
retains only the 44-byte header prefix, counters, and digest state. It verifies
193 render packets requested at 16,384 frames, a 16-packet/32-MiB pending-PCM
ceiling, 98 serial destination writes including the header, four-way exact byte
agreement, no temporary-storage preflight or final `Blob`, and cancellation
after the first 4 MiB coalesced PCM write without close or commit.

The witness records a conservative 41,943,384-byte structural maximum for
path-owned binary backing stores: 16 queued 2,097,152-byte PCM packets, one
mapped packet, one encoder emission, the 4 MiB coalescing buffer, two 44-byte
header copies, and the 32-channel Float64 dither state. That is below the
planned 64 MiB buffered-binary budget.
It is an ownership-derived correctness bound, not a renderer-heap or process-RSS
measurement. Run it with `npm run test:reference:wav-385mib`; direct invocation
may opt in with `SOUNDSCAPER_RUN_REFERENCE_WAV_385MIB=1`. Routine Node and
coverage discovery fast-skips it with that command.

`npm run quality:collect:m2-direct-wav` runs that production-path reference
exactly once, accepts exactly one identity-bound structured diagnostic, and
writes the raw/accepted evidence pair under `test-results/quality/m2-resources`.
The pair is provisional generated evidence until retained and reviewed; the
collector itself does not update `qualifiedWorkloadIds`.

A third provisional milestone 2 fixture records direct stem-archive publication
for exact native-PCM ZIP32 and 7z Copy plus canonical realtime and centrally
admitted offline compressed ZIP32 audio as small focused Node correctness
evidence. The native ZIP32 service case preflights only the four-byte largest
sequential intermediate, then selects and opens an exact 268-byte destination
before rendering `01-dialogue.wav` and `02-music.wav` with four marker bytes
apiece. It reconstructs the archive, closes before commit, cleans each staged
result, and leaves failures and cancellation unpublished. Those markers isolate
archive publication rather than native-container conformance; format-specific
WAV, AIFF, and BWF evidence still owns encoder correctness. The native admission
and shared ZIP32 fixtures retain the two 60-byte/exact-380-byte
largest-intermediate case, the 468-byte 3/1/2/2-byte archive, and the 256 KiB
source sliced at 64 KiB under serial backpressure. Prepared Blob mode retains
the legacy 272-byte preflight, ordered archive additions, and browser download
publication.

The maintained planner selects 7z only when an exact native stem plan exceeds
ZIP32 limits. A deliberately small injected route fixture avoids making that a
scale run: it preflights the same four-byte largest sequential intermediate,
opens one exact 151-byte destination, writes a zero-filled 32-byte prefix before
rendering, retains at most one complete four-byte stem, and appends the complete
next header. After the exact stream is sealed, the destination replaces only
that fixed 32-byte prefix once without changing its written-byte count, then
commits. The completed bytes match the checked-in 7z Copy golden, and the route
constructs no final archive `Blob` and calls neither the legacy archive nor the
download publisher.

The compressed service cases admit MP3, FLAC, Ogg Vorbis, Opus, WavPack, MP2,
and AAC/M4A for owned canonical `realtime-stream` plans and exact centrally
admitted `offline` plans. Each snapshot fingerprint remains bound through
publication. Realtime staging is the output-width `outputBytesPerRender`.
Offline staging is bounded by
`max(outputFrames × inputChannels × offlineBytesPerSample,
outputBytesPerRender)`. The first term uses requested FLAC integer bytes per
sample or four bytes for the other six formats. The possible realtime-retry
term is output-width `outputFrames × outputChannels × Float32(4)`, including for
FLAC. The per-entry cap is
`max(strategy-aware staging bound, 1 MiB)`. Preflight charges that same bound,
not WAV framing, codec output, or aggregate legacy staging, and the synthetic
maximum ZIP32 destination is selected and opened before render. The cap is a
refusal boundary, not a qualified codec expansion or conformance bound.

The exact compressed witness names `01-Voice.mp3` and `02-Music.mp3`, has an
eight-byte raw preflight and a 16-byte aggregate legacy claim, gives each entry
a 1,048,576-byte maximum, and opens a 2,097,406-byte maximum ZIP32 destination.
Injected three- and five-byte encoded bodies yield a dynamically recomputed
262-byte actual ZIP32 archive. Actual entry, emitted, destination-written, and
committed counts agree. The route constructs no final ZIP `Blob`, calls neither
the legacy archive nor download publisher, and owns at most one encoded stem at
a time. It does retain one complete staged WAV `Blob`, the complete worker
MEMFS output, and one complete encoded result; the witness therefore makes no
bounded-codec-memory claim. All seven formats also pass the direct service in
both render strategies. Offline cases stage the unmapped input width and give
FFmpeg canonical channel mapping. An ordinary offline renderer or encoder
failure may retry only the current stem in realtime before its ZIP entry begins;
currentness loss refuses that retry, and post-entry failure never retries.

This direct stem-archive witness uses a provider-injected prepared streaming
destination. It does not exercise File System Access, an Electron filesystem,
a native picker, packaged UI, or real browser or operating-system behavior.
The compressed bytes are injected, so it does not qualify actual FFmpeg codec
execution, codec conformance or expansion, worker MEMFS allocation, heap or RSS
amplification, garbage collection, CPU, or elapsed time. Custom FFmpeg and
compressed 7z stems, BW64 stems, video, and final-Blob direct publication remain
excluded, and reference scale remains excluded. These small fixtures are not
renderer-heap, process-RSS, browser, operating-system, quota, crash, power-loss,
or filesystem-durability evidence. They remain outside the inputs to the
milestone 2 bounded-memory workload, which stays planned.

A fourth provisional milestone 2 fixture records direct compressed whole-mix
output across both maintained render strategies as small focused Node evidence.
Closed admission covers all seven canonical built-in formats: MP3, FLAC, Ogg
Vorbis, Opus, WavPack, MP2, and AAC/M4A. Realtime cases map and resample before
WAV staging and give FFmpeg preserve geometry. Centrally admitted offline cases
recompute the exact planner-owned output admission, resample before staging the
unmapped input width, and give FFmpeg the canonical mapping, so each route has
one mapping owner. An ordinary offline renderer failure may reuse the same
unopened target in realtime; cancellation, integrity or currentness loss, and
every post-render failure do not retry. The first-party rendered-fallback case
also keeps its verified provider private and its canonical and global source
state unchanged through direct offline publication.

Each realtime service case preflights an eight-byte staging payload. The small
offline cases preflight 32 bytes; the mono MP3 case establishes that input width,
not mapped output width alone, is charged. These are raw PCM payload counts and
exclude WAV framing and padding. Each case selects its prepared target before
render and opens the exact target only after a five-byte FFmpeg stat, then
closes and commits without the legacy download publisher. Prepared Blob mode
retains the legacy whole-read and download path. The lower-level fixture
presents a virtual 269,484,049-byte output and observes 258 exact monotonic reads
of at most 1,048,576 bytes, at most one range read and sink write at a time, and
awaited backpressure without whole-output `readFile` use. The representative
MP3 planner's separate 33,685,504-frame case establishes only the
269,484,032-byte staging arithmetic and realtime admission reason.

These witnesses establish transport arithmetic and backpressure only. The
central 256 MiB offline ceiling covers exact useful-binary render-context and
crop output, not end-to-end memory. Offline staging synchronously materializes a
complete WAV byte array and Blob, and the complete encoded output still exists
in worker MEMFS. The virtual body is not allocated and the actual FFmpeg codecs
are not executed by this fixture. Native or WASM codec memory, staged-input
residency, renderer or browser heap, GC, process RSS, CPU, elapsed time, and
codec conformance remain unqualified. The fixture is not reference-scale and
does not exercise File System Access, Electron filesystem publication, a native
picker, actual browser or operating-system behavior, packaged UI, quota,
durability, crash, or power loss. A desktop prepared target expires after
900,000 milliseconds, so long offline desktop elapsed-time behavior is also
unqualified. Custom FFmpeg, compressed stems, video, and other noncanonical
delivery are excluded. It stays outside the milestone 2 bounded-memory
workload, which stays planned.

A fifth provisional milestone 2 fixture records direct MP4 and WebM final-video
transport as focused Node evidence. The service cases bind canonical version-8
plans and safe picker contracts, verify rendered-fallback admission before
planning and selection, prepare browser targets before preflight and input work,
and defer desktop target selection until sink open after FFmpeg stat. Both
formats seal the sink before exact-count commit without a final video `Blob`, Object
URL, or download; prepared Blob mode retains the legacy publication path.

The lower fixture allocates a 2,097,169-byte body and transfers it in three
exact ranges of 1,048,576, 1,048,576, and 17 bytes with one stat and zero output
`readFile` calls. It proves transport arithmetic, serial backpressure, and
ordering only. The complete output remains in worker MEMFS, while source-video
and optional staged-audio `Blob` residency, codec execution and conformance,
codec memory, heap, RSS, CPU, elapsed time, browser, operating-system, picker,
packaged, quota, durability, crash, power-loss, and reference-scale behavior
remain unqualified. The fixture stays outside the milestone 2 bounded-memory
workload, which stays planned.

The three focused structural collectors run with
`npm run quality:collect:m2-direct-stems`,
`npm run quality:collect:m2-direct-compressed`, and
`npm run quality:collect:m2-direct-video`. Each starts one no-retry Node test
process over its exact production/security files, retains that output in the
raw evidence, and maps independently named fixture counters to its frozen
workload thresholds. These collectors qualify only first-party slice,
sequential-retention, final-Blob, and partial-publication counters; the codec,
worker MEMFS, native/WASM, heap/RSS, timing, browser, OS, and durability
exclusions above remain unchanged.

The [collision-cancel inspection witness](../tests/desktop-scape-sparse-range-integration.test.ts)
remains payload-lazy. It follows the real capability store, protocol, desktop
range adapter, file service, project router, and inspector through single exact
closed ranges of at most 16 MiB. Every response is `206`, total transfer stays
below 8 MiB, only the asset's bounded ZIP end-search suffix is touched, and an
existing-ID collision cancels before import or whole-archive `Blob`
materialization.

The separate [full-import witness](../tests/desktop-scape-sparse-full-import-integration.test.ts)
runs the same exact archive through the real capability store, protocol, desktop
range adapter, file service, project service, and importer. The strict ZIP
reader validates the authentic CRC; its focused
[corruption regression](../tests/audio-editor-scape-streaming-video.test.ts)
proves a stored-entry CRC mismatch is rejected. Import validates the manifest
SHA-256, and a transactional counting sink independently rehashes and counts
all 8,589,932,094 asset bytes without retaining payload chunks. The witness
requires exact at-most-16-MiB `206` ranges, at-most-4-MiB media emissions,
project publication after media commit, exact-once capability release and
pinned-handle close, and no whole-archive `Blob` path.

The maintained importer's point-in-time capacity admission is covered by the
[arithmetic tests](../tests/audio-editor-scape-import-capacity.test.ts) and
[archive admission tests](../tests/audio-editor-scape-import-capacity-admission.test.ts).
It checked-sums validated manifest asset sizes and adds `ceil(10%)` headroom
before transaction capture, source remapping, writer creation, or asset
extraction. For this fixture, 8,589,932,094 asset bytes require exactly
9,448,925,304 free bytes; exact free space is admitted and one byte less is
refused. The full-import counting store supplies that exact injected estimate
before its media writer opens.

This full-import witness is an explicit portable reference-scale gate. Run it
with `npm run test:reference:scape-8gib`; a direct Node-test invocation may opt
in by setting `SOUNDSCAPER_RUN_REFERENCE_SCAPE_8GIB=1`. It passed when included
in an all-files coverage run, but the instrumented test took an observed 525
seconds. Routine `npm test` and `npm run test:coverage` discovery therefore
reports a fast skip that names the dedicated command. The scheduling change
does not remove or weaken any full-import assertion, and the observed duration
is execution evidence rather than a performance qualification threshold.

Neither counting sink is real durable application storage. The qualified
capacity check is a point-in-time admission against an injected estimate, not a
storage reservation; it does not guarantee actual browser quota availability,
estimate accuracy or freshness under concurrent writers, a capacity UI
snapshot, browser-record or filesystem-allocation overhead beyond the policy
headroom, or write-time success. These witnesses do not qualify a packaged
Electron UI, real OPFS or IndexedDB durable storage, renderer/browser heap,
main/renderer RSS, whole-archive storage atomicity, or publisher authentication.
The direct-WAV witness additionally does not qualify File System Access,
Electron filesystem publication, native picker behavior, packaged application
UI, or filesystem durability.

The dedicated OPFS storage worker owns exactly six closed operation IDs. It
creates synchronous access handles only after capability detection and accepts
at most 16 MiB in one read or write message. Canonical PCM is exposed through
exact bounded ranges; media and derivative writes consume at-most-16-MiB
`Blob` slices, while worker-owned `File` snapshots cross back only after an
exact synchronous size check. Store close terminates the worker after admitted
storage work drains. When the synchronous worker capability is unavailable,
the repository retains its asynchronous OPFS path; when OPFS is unavailable or
fails, the existing PCM, media, and derivative repositories retain their tested
IndexedDB correctness fallback.

The focused Chromium and Firefox witness disables main-realm `createWritable`
and `getFile`, then proves persisted PCM, original video, and derivatives can
be imported, reloaded, and used for playback through the worker route. It also
opens the same media-bearing project in a second tab, proves one read-only
loser cannot mutate the project, and returns the writer lock to the first tab.
It is a small correctness witness, not WebKit evidence and not reference-scale,
heap, RSS, crash, or power-loss qualification. Media and derivative body
consumption after the worker-owned snapshot still uses the browser's
`File`/`Blob` backend; it is not a claim that those complete bodies are
synchronously copied through worker messages.

The milestone-2 browser durability matrix is qualified in Chromium and Firefox
for the exact workflow IDs `indexeddb-quota-refusal`, `opfs-quota-refusal`,
`indexeddb-multitab-writer`, `opfs-multitab-writer`,
`offline-shell-upgrade`, `offline-runtime-rollback`, and
`storage-eviction-recovery`. IndexedDB quota injection leaves the failed
revision dirty and reloads the preceding commit. The OPFS worker witness
injects `QuotaExceededError` at its synchronous write boundary and either
refuses without changing the current project or exercises the repository's
IndexedDB fallback. The two tab workflows prove only one writer can mutate the
same project and that ownership transfers back after the newer tab closes.
Shell upgrade begins with a prior cache, activates one complete current cache,
retires the prior cache, and reloads both products offline. A partial FFmpeg
runtime update retains the previous complete verified release. The eviction
workflow exports a current `.scape`, removes the origin's IndexedDB database,
reopens the usable empty editor, and restores the same project identity from
the archive. WebKit qualification is deferred by milestone-2 closure scope
revision 2; the pinned Playwright WebKit build exposes no OPFS, no
MediaRecorder, and no IndexedDB Blob storage, so the two OPFS workflows
cannot run there. These small functional workflows do not qualify real
quota exhaustion thresholds, storage reservation, browser eviction policy,
abrupt process death, power loss, reference-scale capacity, heap, or RSS.

The milestone 2 bounded-memory workload therefore remains planned.

The fixture specifications are deliberately concrete:

- milestone 2: the provisional exact 8 GiB sparse Zip64 payload-lazy
  inspection and counting-sink full-import witnesses, plus the exact 385 MiB
  direct-WAV counting-SHA witness and the small direct native-PCM ZIP32/7z,
  canonical realtime and centrally admitted offline compressed ZIP32 stem,
  direct compressed-audio, and direct MP4/WebM correctness fixtures described
  above;
- milestone 3: a two-hour, 24-audio-track, two-proxy-video-track editorial
  session with 10,000 edits;
- milestone 4: 48 kHz deterministic audio vectors plus calibrated 128x72 video
  golden frames;
- milestone 5: 10,000 malformed helper cases and a 30-minute native loopback,
  plus the five Framescaper native-tier fixtures — canonical plan parity with a
  procedurally generated UHD long-GOP decode workload, one licensed fixture per
  required professional format row, a queue/root/watch/scratch fault workload,
  matching-rate 1080p60 and UHD30 clean-display soak cohorts, and an OpenFX
  1.5.1 conformance and hostile-plug-in suite across all five packaged targets;
- milestone 6: a one-hour audio master and ten-minute 720p/30 video master;
- milestone 7: selected and deliberately unselected local media assets;
- milestone 8A: all six capture-source combinations over 30 minutes;
- milestone 8B: a named placeholder whose contents are derived only after the
  Audacity design and compatibility entry gate; and
- milestone 9: an eight-hour complete-system soak.

Except for the explicitly provisional milestone 2 witness, these are
specifications rather than accepted qualification evidence. Milestone 8A now
has an opt-in collector (`npm run quality:collect:m8a-capture`) that validates
the exact six 30-minute combinations, recomputes all eight registered metrics
from raw ledgers, and binds their observed environment fingerprint. It can emit
only pending-external or failed evidence while the capture device matrix is
unprovisioned; it deliberately refuses accepted or qualified publication.
Another future fixture becomes active only when its implementation and
provenance are checked in and its contract test is tightened accordingly.

## Result evaluation

`evaluateQualityBudget(qualification, expectedEnvironment, measurement)` accepts
already-aggregated finite metrics and returns immutable verdicts and failure
messages. It uses only `eq`, `gte`, and `lte` comparisons; it does not evaluate
configuration strings as code.

Accepted retained summaries use result schema 1 and pass through
`evaluateQualityBudgetResult`. The boundary snapshots only exact own-data
records, then binds the summary to the exact workload, ordered fixtures,
environment descriptor, source revision, quality-budget bytes, and retained raw
artifact:

```json
{
	"schemaVersion": 1,
	"workloadId": "m2-streaming-project-8gib-v1",
	"fixtureIds": ["m2-streaming-project-8gib-v1"],
	"environmentId": "portable-node-structural-26.5.0",
	"environmentFingerprint": { "measurementClass": "first-party-owned-structural-counters" },
	"rendererClass": "unknown",
	"budgetSha256": "64-lowercase-hex-digits",
	"sourceRevision": "40-or-64-lowercase-hex-digits",
	"attemptCount": 1,
	"retryCount": 0,
	"rawEvidence": {
		"artifactName": "m2-streaming-project-8gib-v1.raw.json",
		"byteLength": 4096,
		"sha256": "64-lowercase-hex-digits"
	},
	"metrics": {
		"streaming.maximumProtocolRangeBytes": 4194304,
		"streaming.maximumMediaEmissionBytes": 4194304,
		"streaming.retainedMediaPayloadBytes": 0,
		"streaming.invalidPublishedRevisions": 0
	}
}
```

The attempt count must be one and both the result and policy retry counts must
be zero. The metric keys must equal the workload threshold keys; missing,
additional, accessor-backed, or non-finite values fail. Passing numbers cannot
override an unprovisioned or ineligible environment. Raw generated evidence
remains an ignored CI artifact, while any reviewed summary retains its exact
byte length and SHA-256. This is why the current ledger still cannot produce a
qualified result.

Run `node scripts/verify-quality-budget-result.mjs <accepted-summary.json>` from
the exact reviewed checkout. The verifier hashes the checked-in budget and the
named sibling raw artifact, requires the summary's source revision to equal
`HEAD`, rejects ambiguous workload or environment descriptors, and exits
nonzero on any failed threshold or identity check.

Workload collectors pass observed counters to
`writeStructuralQualityBudgetEvidence`. It requires a clean checkout, derives
the exact platform, architecture, Node, npm, and Git identity, rejects failed
metrics before creating files, uses exclusive file creation, and verifies the
completed pair from disk. Generated pairs remain under ignored `test-results/`
until their raw artifact is retained and their accepted summary is reviewed.

`npm run audit:quality-results` resolves every accepted cohort's historical
budget from Git, recomputes its digest, and requires one artifact descriptor for
every qualified workload. Supplying `-- --evidence-directory <path>` also
rehashes each retained raw/result body and re-evaluates its historical workload
and environment contract.

## CI progression

The safe progression is:

1. Keep the contract/evaluator tests in the canonical Node suite.
2. Run the deterministic M4 PCM/RGBA parity collector in a one-worker,
   no-retry browser job and retain its complete raw evidence. The collector
   recomputes exactly the five registered metrics and refuses ambiguous,
   truncated, non-finite, retried, or overwrite-prone evidence.
3. Keep Chromium, Firefox, and WebKit functional/fallback jobs green without
   treating their hosted timing as performance qualification.
4. Provision the fixed GPU host, add an exact environment check, replace the
   runtime-generated preview media with a digest-pinned fixture, and emit one
   consolidated result artifact.
5. Add device/native labs only when the corresponding milestone contracts land.

Generated results belong under ignored `test-results/` and should be uploaded as
CI artifacts. An accepted summary can be reviewed and versioned separately, but
raw generated `test-results`, `playwright-report`, or coverage content must not
be committed.

### Milestone 6 reference master, and its vertical companion

`m6-reference-master-suite-v1` specifies a ten-minute 1280x720 video master
beside its hour of audio. That canvas predates milestone 6B's canvas lift, which
made the delivered extents an explicit decision rather than a cap, so the suite
alone could no longer exercise what the milestone added: a run could deliver the
landscape master twice, satisfy every threshold, and never reframe anything.

`m6-reference-master-vertical-v1` is therefore registered beside it rather than
edited into it — a fixture change is a new fixture revision, never a silent edit
to an existing baseline. It is the **same** ten-minute master delivered at
1080x1920: identical audio and video durations and identical frame rate, so one
real-time denominator remains correct for both, with only the canvas differing.
The collector refuses a companion that drifts on duration or rate, and refuses
one whose canvas duplicates the suite's, because either would make the
distinction it exists to draw disappear.

No threshold moved. `m6-reference-master-delivery` keeps its eleven metrics and
their values unchanged; what changed is that the workload now names two fixtures,
a run must file a video delivery at each registered canvas or be rejected, and
both fixtures must reach `qualified` before any accepted evidence could be
published. Both remain `planned` and both named environments remain
unprovisioned, so the collector still refuses to publish acceptance and names
every fact the lab owes — including, now, each unbuilt fixture by name.

Reviewing commit: the milestone 6B-5 exit-evidence change that introduced
`m6-reference-master-vertical-v1`.

## Changing a threshold

A threshold change must record the old and new values, the affected fixture and
environment, raw before/after measurements, the reason, and the reviewing
commit or issue. Hardware, driver, browser, or fixture changes create a new
environment or fixture revision; they are not silent edits to an existing
baseline. Thresholds must not be loosened automatically to make a regression
pass.
