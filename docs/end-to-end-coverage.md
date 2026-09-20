# End-to-end coverage

Soundscaper has a strict end-to-end coverage gate for the production JavaScript
that ships in its two browser sites and two Electron applications. The gate
unions evidence from the Chromium browser suite and the packaged
`nightly-with-tests` runner. It requires exactly 100% coverage for lines, statements, functions, and branches; it does not round a partial result up.
Node and unit-test coverage is separate and does not contribute to this gate.

## Capture evidence

Build and run the ordinary Chromium suite with coverage as described in
`AGENTS.md`. A distributed `nightly-with-tests` application automatically runs
its dedicated packaged-coverage phase after the non-instrumented correctness
and performance phases. Each nightly run directory preserves:

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
it. Every input must name the same full Git revision and have identical executable evidence and normalized source maps; assembly rejects stale or mixed builds.

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
source maps, changed repository sources, or unequal build evidence. Preparation
copies the exact generated executables and binds every source, script, surface,
revision, and digest into the inventory. The final command independently
materializes the raw V8 profiles, unions compatible counters across Chromium and
Electron, and exits nonzero if any required surface or executable coverage point
is absent.

CDP renderer and preload profiles carry an exact script-source cache which is
checked against the preserved executables. Standard Node V8 profiles contain
URLs and execution ranges rather than source bytes; their main and child-process
entries are instead restricted to digest-authenticated installed paths from the
same preserved package evidence.

The generated `coverage/e2e-capture/`, `coverage/e2e/`, and
`coverage/e2e-report/` directories are diagnostics and must not be committed.
