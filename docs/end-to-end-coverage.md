# End-to-end coverage

Soundscaper has a strict end-to-end coverage gate for the production JavaScript
that ships in its two browser sites and two Electron applications. The gate
unions evidence from the Chromium browser suite and the packaged
`nightly-with-tests` runner. It requires exactly 100% coverage for lines, statements, functions, and branches; it does not round a partial result up.
Node and unit-test coverage is separate and does not contribute to this gate.

## Capture evidence

Build and run the ordinary Chromium suite with coverage as described in
`AGENTS.md`. A distributed `nightly-with-tests` application automatically runs
the ordinary browser suite and then a dedicated Chromium dual-origin phase.
Both use the same authenticated reciprocal browser builds, so their portable
script URLs share one exact build-evidence denominator; the second phase serves
them at the loopback origins recorded by that evidence. Both phases append
profiles to the same `coverage/v8-browser/` directory. The runner later executes
packaged coverage after the non-instrumented performance phases. Each nightly
run directory preserves:

- `coverage/v8-browser/` for raw Chromium profiles;
- `coverage/v8-packaged/` for packaged Electron main, preload, renderer, worker,
  worklet, and service-worker profiles;
- `coverage/build-evidence/` for the exact browser and Electron JavaScript plus
  source maps against which those profiles were recorded.

The dedicated coverage phase is separate so instrumentation cannot affect the
nightly performance verdict. Keep the entire run directory. Do not copy only
the raw profile files or rebuild the applications before checking them.

One nightly run covers both products on one target. Runs from multiple operating
systems or architectures may be combined when platform-specific paths require
it. Every input must name the same full Git revision and carry
identical executable evidence and normalized source maps, plus identical
authenticated browser evidence. Target-generated
native-runtime manifests intentionally make the enclosing Electron package
archives different; assembly retains each run's runtime, full evidence digest,
and exact archive records while comparing a separate executable-evidence digest.
It still rejects stale sources, different JavaScript, different maps, or mixed
browser builds.

## Assemble and check

Check out the exact revision recorded by the nightly runs, then provide one or
more complete run directories. The first command verifies and combines their
profiles into a portable capture:

```sh
npm run coverage:e2e:assemble -- \
  --output coverage/e2e-capture \
  /path/to/nightly-run-linux \
  /path/to/nightly-run-windows
```

Prepare the hash-bound executable inventory and run the strict gate:

```sh
npm run coverage:e2e:prepare -- \
  coverage/e2e-capture/capture-index.json coverage/e2e
npm run coverage:e2e:check -- coverage/e2e coverage/e2e-report
```

Assembly fails for missing runtime surfaces, unknown executable URLs, mismatched
source maps, changed repository sources, or unequal executable build evidence.
The capture index keeps the distinct full package provenance for every input
run. Preparation copies the exact generated executables and binds every source,
script, surface, revision, and digest into the inventory. The final command
independently validates each surface, rebases all admitted raw V8 profiles, and
materializes their union in one c8 pass. That lets complementary Chromium and
Electron ranges share the one coverage map c8 derives from their combined execution. The command
exits nonzero if any required surface or executable coverage point is absent.

CDP renderer and preload profiles carry an exact script-source cache which is
checked against the preserved executables. Standard Node V8 profiles contain
URLs and execution ranges rather than source bytes; their main and child-process
entries are instead restricted to digest-authenticated installed paths from the
same preserved package evidence.

Service workers are instrumented at Chromium's browser target before their
first instruction; a page-target attachment is too late to retain top-level,
install, and activate execution. Both ordinary and packaged collectors also
bank triggered precise-coverage updates so a worker that exits before profile
teardown does not lose its final ranges.

The generated `coverage/e2e-capture/`, `coverage/e2e/`, and
`coverage/e2e-report/` directories are diagnostics and must not be committed.
