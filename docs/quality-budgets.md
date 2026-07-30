# Quality budgets and benchmark qualification

Soundscaper's quality-budget foundation is **in progress**. The checked-in
ledger names fixtures and proposed numeric limits, validates its own contract,
and provides a deterministic fail-closed evaluator. It does not claim that any
performance workload or platform has qualified.

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
- The 12-effect 1280x720 preview test records timing and heap data, but its media
  file is generated with `MediaRecorder` for each run. It therefore remains a
  provisional fixture.
- Hosted CI is suitable for deterministic correctness checks. Its shared CPU
  and software-renderer behavior make it ineligible for fixed-hardware timing
  qualification.

The existing 500,000-byte JavaScript chunk ceiling and 25 MiB Pages asset
ceiling remain independent build gates. Registering future measurements here
must not weaken either limit.

## Contract statuses

`provisional` identifies existing evidence that is not yet a reproducible
qualification gate. `planned` identifies an accepted future fixture and its
starting budget. `optional` applies only to milestone 7. `blocked` preserves the
milestone 8B upstream-design fence.

The top-level `qualification.qualifiedWorkloadIds` array stays empty until a
workload has all of the following:

1. a deterministic, digest-pinned fixture or generator;
2. a provisioned and exact environment descriptor;
3. an automated collector that emits all required finite metrics;
4. a result evaluated by `scripts/quality-budget-evaluator.mjs`; and
5. retained raw evidence from a no-retry run.

A workload does not become qualified merely because an individual test passed,
a proposed threshold was checked in, or a hosted runner happened to report a
fast result.

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

## Fixed hardware environments

`reference-linux-gpu-01` is intentionally unprovisioned. Before its status can
change, capture and check in all of these exact values:

- OS image/revision and update policy;
- CPU model and logical core count;
- installed RAM;
- GPU model, VRAM, driver, and reported WebGL vendor/renderer;
- display resolution, refresh rate, and device-pixel ratio;
- AC/battery and performance-governor policy;
- browser version, executable digest, and launch flags; and
- the self-hosted runner labels that resolve only to this machine.

Qualification must fail if the captured identity differs. SwiftShader,
llvmpipe, another software renderer, or an unknown renderer cannot satisfy the
preview hardware gate.

The native OS, capture-device, and final release matrices are also
unprovisioned. Packaging on hosted Windows, macOS, and Linux runners is valuable
distribution evidence, but it cannot qualify real audio latency, camera,
microphone, display-capture, or system-audio budgets without controlled devices.

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

A second provisional milestone 2 fixture drives direct WAV export with an exact
3,153,920-frame, 48 kHz, 32-channel silent-float plan. Its 403,701,760-byte PCM
payload is exactly 385 MiB, one MiB above the desktop 384 MiB output-memory threshold;
the complete 403,701,804-byte RIFF has pinned SHA-256
`f1978598e11527049bcafae0f1d4847238e5322e11fddf714cc9f298bf12f9fe`.
The opt-in Node witness uses the production planner, export controller,
64-packet PCM sink queue, passthrough streaming resampler, WAV stream encoder,
and exact-size direct-destination adapter. A counting SHA-256 target retains
only the 44-byte header prefix, counters, and digest state. It verifies 770
4,096-frame render packets, 771 serial destination writes, four-way exact byte
agreement, no temporary-storage preflight or final `Blob`, and cancellation
after the first PCM packet without close or commit.

The witness records a conservative 34,603,352-byte structural maximum for
path-owned binary backing stores: 64 queued 524,288-byte PCM packets, one mapped
packet, one encoder emission, two 44-byte header copies, and the 32-channel
Float64 dither state. That is below the planned 64 MiB buffered-binary budget.
It is an ownership-derived correctness bound, not a renderer-heap or process-RSS
measurement. Run it with `npm run test:reference:wav-385mib`; direct invocation
may opt in with `SOUNDSCAPER_RUN_REFERENCE_WAV_385MIB=1`. Routine Node and
coverage discovery fast-skips it with that command.

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
The milestone 2 bounded-memory workload therefore remains planned.

The fixture specifications are deliberately concrete:

- milestone 2: the provisional exact 8 GiB sparse Zip64 payload-lazy
  inspection and counting-sink full-import witnesses, plus the exact 385 MiB
  direct-WAV counting-SHA witness described above;
- milestone 3: a two-hour, 24-audio-track, two-proxy-video-track editorial
  session with 10,000 edits;
- milestone 4: 48 kHz deterministic audio vectors plus calibrated 128x72 video
  golden frames;
- milestone 5: 10,000 malformed helper cases and a 30-minute native loopback;
- milestone 6: a one-hour audio master and ten-minute 720p/30 video master;
- milestone 7: selected and deliberately unselected local media assets;
- milestone 8A: all six capture-source combinations over 30 minutes;
- milestone 8B: a named placeholder whose contents are derived only after the
  Audacity design and compatibility entry gate; and
- milestone 9: an eight-hour complete-system soak.

Except for the explicitly provisional milestone 2 witness, these are
specifications rather than generated evidence. A future fixture becomes active
only when its implementation and provenance are checked in and its contract
test is tightened accordingly.

## Result evaluation

`evaluateQualityBudget(qualification, expectedEnvironment, measurement)` accepts
already-aggregated finite metrics and returns immutable verdicts and failure
messages. It uses only `eq`, `gte`, and `lte` comparisons; it does not evaluate
configuration strings as code.

A collector result should use the following shape before a persistent result
schema is promoted:

```json
{
	"environmentId": "reference-linux-gpu-01",
	"rendererClass": "hardware",
	"metrics": {
		"preview.frameIntervalP95Ms": 16.7,
		"preview.retainedJsHeapDeltaBytes": 524288
	}
}
```

Passing numbers cannot override an unprovisioned or ineligible environment. This
is why the current ledger cannot produce a qualified preview result.

## CI progression

The safe progression is:

1. Keep the contract/evaluator tests in the canonical Node suite.
2. Enable deterministic FFmpeg/WebGL parity in a one-worker, no-retry nightly
   browser job and retain its JSON metrics.
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

## Changing a threshold

A threshold change must record the old and new values, the affected fixture and
environment, raw before/after measurements, the reason, and the reviewing
commit or issue. Hardware, driver, browser, or fixture changes create a new
environment or fixture revision; they are not silent edits to an existing
baseline. Thresholds must not be loosened automatically to make a regression
pass.
