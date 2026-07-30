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

The milestone 2 fixture now has a provisional desktop inspection witness. It
creates an exact 8 GiB logical sparse Zip64 archive with current-schema project
metadata, then inspects it through single exact closed ranges of at most 16 MiB.
Every response is `206`, total transferred bytes stay below 8 MiB, collision
cancellation happens before import, and the path never assembles a whole
`Blob`. The test requires observable sparse-file support and skips when the
filesystem cannot provide it. The huge asset digest and CRC are placeholders,
so this is not payload-integrity, full-import, process-RSS, browser-heap, or
storage-quota qualification. The milestone 2 bounded-memory workload therefore
remains planned.

The fixture specifications are deliberately concrete:

- milestone 2: the provisional exact 8 GiB sparse Zip64 desktop
  inspection/collision-cancel witness described above;
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
