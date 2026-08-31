# Quality diagnostics

[`config/quality-budgets.json`](../config/quality-budgets.json) describes the
diagnostics the repository can actually run. It does not qualify a release. A
result says only what the named runner observed; the owner decides whether to
release after considering CI, package audits, native self-tests, diagnostics,
and manual QA.

The register has no evidence registry, status ladder, hardware matrix, accepted
cohort, reviewer key, attestation, or release-admission result. Generated
diagnostic output stays disposable under `test-results/`.

## Configuration contract

The top level has exactly five fields:

- `schemaVersion`
- `fixtures`
- `measurements`
- `thresholds`
- `workloads`

A fixture gives an ID, kind, executable specification, optional artifacts, and
an optional limitation. A measurement gives an ID and a behavior:
`blocking` or `observational`. Its threshold separately gives the comparison,
numeric value, and unit. A workload owns fixture IDs and measurement IDs and is
`blocking` when any of its measurements is blocking; an entirely observational
workload is `observational`.

There are deliberately no checked-in environments or software fingerprints.
Collectors retain the platform, renderer, package, device, and tool versions
that actually ran beside their result. That observation does not become a
representative-machine claim.

## Result evaluation

Deterministic correctness, integrity, and render-parity misses are blocking.
Missing, extra, duplicated, detached, or non-finite data also fails closed.
Timing, heap, RSS, latency, underrun, drift, and supported dropped-frame limits
are observational: a miss is reported as a warning and preserves the measured
value. Unsupported measurements use `null` plus a reason when the reporting
format supports it; they are never replaced with invented zeroes.

Collectors use one attempt and no retry-to-pass. Workload-specific procedures
such as warm-up count, sample count, nearest-rank percentiles, and forced GC
remain in the runner code and its tests instead of becoming release policy in
the register. Raw records use closed schemas and digest-bind source, package,
runtime, model, or helper bytes where those bytes affect the observation.

## Hosted and local diagnostics

Hosted CI is useful for deterministic structural checks, media correctness, and
render parity. Shared CPU time and software rendering are not hardware
lower-bound evidence. A local browser or packaged runner similarly describes
only the runtime it observed. Native and device collectors reject hosted runners
when their workflow requires an actual local audio or capture device.

The hosted collector writes a raw log and a derived report. CI blocks on
correctness or parity failures and reports observational performance misses as
warnings. It never publishes an accepted evidence artifact.

## Fixtures and project sizes

Fixtures pin media geometry, duration, sample rate, channel layout, operation
inventory, generator revision, and digests where those facts affect a
measurement. Small correctness fixtures and virtual-length witnesses state what
they do not allocate or execute.

Direct stem-archive publication uses a small focused Node correctness fixture.
It checks ZIP32 and 7z Copy framing, at-most-64-KiB input slices, serialized sink
backpressure, close-before-commit behavior, cancellation, and zero partial
publication. Provider-injected FFmpeg/MEMFS fixtures are retained historical
tests; they do not describe the production browser codec runtime, which uses
dedicated reviewed audio WASMs and WebCodecs/Mediabunny with no FFmpeg fallback.

The direct compressed diagnostic covers both render strategies and all seven
registered formats. Its virtual 269,484,049-byte output is delivered in 258
ranges and proves transport arithmetic and backpressure only. It does not
allocate the virtual body or execute real codecs. There is no synthetic
bounded-memory workload claiming more than those structural checks prove.

### Direct video transport diagnostic

The direct MP4 and WebM diagnostic uses canonical version-8 plans. A
2,097,169-byte body is read in three ranges of 1,048,576, 1,048,576, and 17
bytes, with one stat call, serialized writes, and zero whole-output `readFile`
calls. It covers the transport slice, not codec conformance, packaged UI,
reference-scale memory, crash recovery, or filesystem durability.

The [legacy-schema refusal witness](../tests/audio-editor-video-export-plan-version.test.ts)
keeps the plan version and diagnostic narrative synchronized.

The sparse 8-GiB Scape witness checks exact range and publication behavior
without retaining the media body. Direct WAV diagnostics similarly distinguish
structural path-owned bytes from browser heap, process RSS, and durable storage.

### Browser storage diagnostics

The dedicated OPFS storage worker exposes six closed operation IDs. It uses
synchronous access handles only after capability detection and caps at 16 MiB
both canonical PCM and exact bounded ranges. It handles media and derivative
writes as slices and obtains worker-owned `File` snapshots. It performs an exact
synchronous size check, records store close, and terminates. Asynchronous OPFS
and IndexedDB remain correctness fallbacks.

The automated test runs Chromium, Firefox, and WebKit. The Chromium and Firefox
witness covers main-realm `createWritable`, `getFile`, persisted PCM, original
video, and derivatives across reload and playback. A second tab is read-only
while the writer lock is held. WebKit still exercises the supported fallback;
none of these runs makes a browser release-qualification claim.

The browser suite exercises `indexeddb-quota-refusal`,
`opfs-quota-refusal`, `indexeddb-multitab-writer`,
`opfs-multitab-writer`, `offline-shell-upgrade`, and
`storage-eviction-recovery`.

Shell upgrade begins with a prior complete cache, activates one complete current
active-product cache, and retires only safely obsolete caches. The current
product's verified core is guaranteed offline after installation; optional
assets and the other product become available offline only after their exact
allowlisted bytes have been fetched, verified, and cached on use. Dedicated
audio WASM payloads and dynamically loaded WebCodecs/Mediabunny chunks are
ordinary digest-bound application assets; no FFmpeg runtime is fetched, cached,
served, or retained for rollback.

## Native and packaged diagnostics

The M5 helper and M5B media/OpenFX collectors validate closed measurements,
source revisions, package/runtime hashes, observed host/runtime identity, and
the exact registered measurements. The M6 reference-master collector derives
delivery conformance, loudness, partial-output, frame, A/V, caption, and render
observations from closed reports. The M8 capture collector derives completion,
supported drift/drop observations, teardown, recovery, and device authorization
from its six real source combinations.

Performance observations never turn into a fixed lab profile. Runtime manifests,
package bytes, source pins, and content inventories remain SHA-256-bound
technical inputs.

## Local assistance

The runnable privacy diagnostic derives network requests after installation,
unselected-media reads, accepted-output digest mismatches, cancellation timing,
and canonical-state loss from a closed trace. Model catalogs and runtime
artifacts retain their authenticated SHA-256 bindings.

Speech and visual accuracy are manual QA until real offline models and runners
exist. Synthetic or caller-invented results do not stand in for those models.
When the model set is installed, local assistance remains a conditional manual
QA workflow rather than a planned pseudo-workload in this register.

## Changing a threshold

A threshold change should state the old and new values, affected fixture and
measurement, observed before/after values, and reason. Never loosen a blocking
correctness threshold merely to hide a regression. Update the register, focused
tests, and this guide together.
