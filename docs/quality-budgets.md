# Quality budgets and diagnostics

[`config/quality-budgets.json`](../config/quality-budgets.json) describes
repeatable diagnostic inputs and numeric expectations. It does not certify a
release. A passing result means only that the named measurement met the named
thresholds. The owner decides whether to release, informed by CI, package
audits, native self-tests, diagnostics, and manual QA.

The repository deliberately has no evidence register, accepted-result cohort,
hardware lower-bound claim, reviewer key, or workload status that means
“release approved.” Generated diagnostic files are disposable test output and
are never release-admission inputs.

## What is active today

Fixture and workload status describes whether a diagnostic is maintained:

- `active` means the fixture or workload is runnable now.
- `planned` means its contract is recorded but its runner or fixture is not
  complete.
- `optional` means it covers an optional feature and may be skipped when that
  feature is not installed.
- `blocked` means a named technical prerequisite is absent.

These values do not express release readiness. Environment status is `active`
when its checked-in descriptor is runnable and `unprovisioned` when a local
device or runtime must supply observations. A collector may evaluate a real
observation against the thresholds without changing that descriptor.

## Configuration contract

The top-level register contains only schema and grounding metadata, the
offline-cache narrative, measurement policy and units, pinned software inputs,
environment descriptors, fixtures, and workloads with thresholds.

Each workload owns exact fixture IDs, environment IDs, and thresholds. Each
threshold names a metric, comparison, value, and unit. Values are read from the
register by collectors rather than copied into runner code.

## Measurement procedure

Diagnostics use one attempt and zero retry-to-pass attempts. Timing workloads
use the checked-in warm-up and timed-run counts, a single timing worker, and the
nearest-rank percentile method. Correctness ledgers include warm-up failures
when a warm-up could expose corruption, unauthorized access, or lost state;
timing summaries exclude warm-up samples.

Raw measurements use closed schemas. Collectors reject missing, duplicated,
extra, non-finite, relabelled, or detached data. Where a run depends on package,
source, model, helper, or runtime bytes, the record carries their byte lengths
and SHA-256 hashes. A derived result is recomputed from the raw record before it
is written, and existing output is never overwritten.

## Result evaluation

Deterministic correctness and parity thresholds are blocking for the diagnostic
command: a missing metric or failed equality/limit produces `failed` and a
non-zero exit. Timing, heap, RSS, and other performance observations report the
measured value honestly. Hosted diagnostics may classify observational budget
misses as warnings where their runner cannot provide a stable performance
reference.

An unsupported measurement is omitted or represented as unavailable with a
reason. It is never replaced by an invented zero. A result may be `passed` or
`failed`; soak diagnostics separately use `ok`, `warnings`, `failed`, and
`incomplete`.

## Hosted CI diagnostics

Hosted CI runs deterministic structural, media-correctness, and render-parity
workloads. The hosted environment is useful for reproducibility, but shared CPU
time and software rendering are not claims about owner hardware or a minimum
supported machine. Timing and GPU observations remain diagnostics.

The hosted collector writes a raw log and a derived report under
`test-results/`. CI may fail on correctness/parity errors. It does not publish
an accepted artifact or mutate this register.

## Portable structural environment

`portable-node-structural-26.5.0` is the deterministic Node 26.5.0/npm 12.0.1
environment for first-party counters. Its metrics cover exact byte ranges,
write sizes, retained payloads, partial publications, and similar structural
facts. They do not imply browser heap, process RSS, device, filesystem,
operating-system, codec, or elapsed-time behavior.

## Observed local-runtime diagnostics

`local-runtime-diagnostics` names whichever local browser or packaged runtime
is executing the diagnostic. It does not select an owner machine, GPU, operating
system, or representative hardware profile. Native, capture-device, Web VCR,
and local-runtime results carry only the environment they actually observed,
including renderer, platform, device, and package identity where relevant.
There is no checked-in host/profile matrix to complete. No host is a release
requirement and no result is promoted into a hardware lower-bound claim.

## Fixtures and project sizes

Fixtures pin exact media geometry, duration, sample rate, channel layout,
operation inventory, generator revision, and digests where those facts affect a
metric. Small correctness fixtures and virtual-length transport witnesses must
say what they do not allocate or execute.

Direct stem-archive publication uses a small focused Node correctness fixture.
It checks ZIP32 and 7z Copy framing, at-most-64-KiB input slices, serialized sink
backpressure, close-before-commit behavior, cancellation, and zero partial
publication. Provider-injected FFmpeg/MEMFS fixtures are retained historical
tests; they do not describe the production browser codec runtime, which uses
dedicated reviewed audio WASMs and WebCodecs/Mediabunny with no FFmpeg fallback.

The direct compressed diagnostic covers both render strategies and all seven
registered formats. Its virtual 269,484,049-byte output is delivered in 258
ranges and proves transport arithmetic and backpressure only. It does not
allocate the virtual body or execute real codecs, and therefore remains outside
the bounded-memory workload despite the active structural checks.

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

The dedicated OPFS storage worker exposes six closed operation IDs. It uses synchronous access handles only after capability detection and caps at 16 MiB both canonical PCM and exact bounded ranges. It handles media and derivative writes as slices and obtains worker-owned `File` snapshots. It performs an exact synchronous size check, records store close, and terminates. Asynchronous OPFS and IndexedDB remain correctness fallbacks.

The Chromium and Firefox witness covers main-realm `createWritable`, `getFile`, persisted PCM, original video, and derivatives across reload and playback. A second tab is read-only while the writer lock is held. This is not WebKit and not reference-scale; it does not measure heap, RSS, crash, or power-loss behavior. WebKit still runs the automated test; historical milestone-9 wording is not a release gate.

The browser suite exercises `indexeddb-quota-refusal`, `opfs-quota-refusal`,
`indexeddb-multitab-writer`, `opfs-multitab-writer`,
`offline-shell-upgrade`, and `storage-eviction-recovery`.

<!-- policy-narrative:milestone-2-offline-cache-qualification -->
Shell upgrade begins with a prior complete cache, activates one complete current
active-product cache, and retires only safely obsolete caches. The current
product's verified core is guaranteed offline after installation; optional
assets and the other product become available offline only after their exact
allowlisted bytes have been fetched, verified, and cached on use. Dedicated
audio WASM payloads and dynamically loaded WebCodecs/Mediabunny chunks are
ordinary digest-bound application assets; no FFmpeg runtime is fetched, cached,
served, or retained for rollback.
<!-- /policy-narrative:milestone-2-offline-cache-qualification -->

## Native and packaged diagnostics

The M5 helper and M5B media/OpenFX collectors validate closed measurements,
source revisions, package/runtime hashes, observed host/runtime identity, one
no-retry attempt, and the registered metrics. Local device collectors refuse
hosted runners when a real audio or capture device is required. Passing their
thresholds does not authorize a package or a release.

The M6 reference-master diagnostic derives delivery conformance, loudness,
partial-output, frame, A/V, caption, and render-time metrics from sealed reports
for both registered canvases. The M8 capture diagnostic derives completion,
A/V drift, supported dropped-frame observations, teardown, recovery, and device
authorization metrics from the exact six source combinations.

Packaged runtime reports keep deterministic correctness/parity failures
separate from timing and memory observations. Runtime manifests, package bytes,
and content inventories remain SHA-256-bound technical inputs.

## Milestone 5 package audit

The M5 handoff is an automated package audit. It verifies source acquisitions,
licensing, payload manifests, target and architecture binding, required native
self-tests, runtime-manifest identity, exact package names and contents, byte
lengths, SHA-256 hashes, and equal installed closures across package formats.
It has no reviewer, signature, notarization, attestation, or release-readiness
state.

## Milestone 7 local-assistance privacy diagnostics

The optional privacy diagnostic derives network requests after installation,
unselected-media reads, accepted-output digest mismatches, cancellation p95,
and canonical-state losses from a closed trace. Model catalogs and runtime
artifacts retain their existing authenticated SHA-256 bindings. A local or
packaged observation is labelled as such and cannot impersonate another
environment.

## Milestone 7 local-assistance accuracy criteria

Speech and visual accuracy workloads remain planned criteria until real offline
models and runners produce the registered metrics. Synthetic or caller-invented
results do not stand in for those models. Manual QA covers local assistance when
the required model set is installed.

## Changing a threshold

A threshold change should state the old and new values, affected fixture and
environment, raw before/after measurements, and the reason for the change.
Never loosen a deterministic correctness threshold merely to hide a regression.
Update the register, its focused tests, and this guide in the same change.
