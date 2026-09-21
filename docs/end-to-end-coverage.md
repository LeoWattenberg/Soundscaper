# End-to-end coverage

Soundscaper has a strict end-to-end coverage gate for the production JavaScript
that ships in its two browser sites and two Electron applications. The gate
unions evidence from the Chromium browser suite and the packaged
`nightly-with-tests` runner. It requires exactly 100% coverage for lines, statements, functions, and branches; it does not round a partial result up.
Node and unit-test coverage is separate and does not contribute to this gate.

## What the gate measures

The denominator comes from the authenticated production build, not from a
hand-maintained source glob. A source map owns only executable first-party
sources under `src/` or `desktop/` that it actually maps. If an emitted script
has no such mapping, the exact emitted JavaScript is measured instead. Exact
mapped third-party code is excluded; listing an unused first-party source in a
map is not enough to classify a vendor bundle as first-party.

Before evidence is accepted, the build audit inventories every JavaScript and
HTML resource and rejects unrecognized executable-string producers such as
`eval`, executable `Blob` workers, dynamic imports, or inline HTML handlers.
The macro runner is a closed first-party recipe: its fixed,
digest-authenticated module wrapper is measured while the user's macro program
remains data. Any other generated module or changed wrapper fails admission.

Third-party dynamic code is excluded only through byte-exact recipes derived
from the authenticated build. The admitted Mediabunny `Blob` workers are
reconstructed from their emitted call sites and matching source-map spans. The
FFmpeg core is admitted only at its canonical production JavaScript and Wasm
URLs with the manifest and publication-policy pins committed at the recorded
revision. Chromium must report the exact protocol language and canonical URL;
its JavaScript source bytes are checked directly, while its empty debugger text
is accepted for Wasm only when the captured base64 bytes have the pinned digest
and WebAssembly magic. A changed URL, query, fragment, source, pin, policy, or
producer fails rather than widening the exclusion.

Raw V8 input is checked structurally against the authenticated JavaScript and
its source map. Required root, explicit-function, and class-initializer spans
come from an independent parse and cannot disappear from the union. Reported
functions must match those source-derived spans, while their block ranges must
use contextual source boundaries and form nonduplicated nested or disjoint
trees. Selected branch-count and outcome-cardinality checks reject collapsed
topology. These checks detect malformed or incomplete capture structure; as
with other local coverage tools, the runtime counts themselves are trusted
capture evidence, not a cryptographic attestation that could distinguish an
edited count from an identical genuine count.

Executable routes created only by a browser test do not contribute coverage.
Those tests opt out of collection, and a recursive static guard follows their
local helpers to reject an unmarked JavaScript response, inline script, event
handler, `srcdoc`, or `javascript:` URL. The packaged M4 and M4B2 synthetic
parity pages remain in the non-instrumented metrics phase and are not members
of packaged coverage. The corresponding production sources remain in the
build-derived denominator.

For Electron, the evidence generator reverse-enumerates JavaScript and HTML in
`app.asar` and executable resources beside it. The packaged runner records
those resources before launch and after collection. Assembly rejects added,
missing, or changed files, unknown profiler URLs, changed source bytes, and
unapproved target-runtime scripts. Test-harness files are packaged separately
and are not part of the normal product inventory; the few generated renderer
bridges needed to drive the packaged application are accepted only by their
exact product-bound recipe and bytes.

The real-model phase launches each product through the diagnostic host with a
fresh private Node coverage directory. It starts precise CDP coverage before
reloading the host, then closes the diagnostic window normally so inference
helpers shut down and Electron checkpoints its main-process profile. Each
session binds its files directly to one product, launch, archive alias, and
canonical executable Resources identity; assembly does not infer ownership from
an operating-system PID that could be reused. A hard-killed child, missing root
profile, stale archive or Resources tree, unmanifested file, or foreign script
invalidates that session. These sessions augment, but never replace, the
ordinary packaged coverage capture required for both products.

## Capture evidence

Build and run the ordinary Chromium suite with coverage as described in
`AGENTS.md`. A distributed `nightly-with-tests` application automatically runs
the ordinary browser suite and then a dedicated Chromium dual-origin phase.
The ordinary runner binds both production-shaped Pages sites to the exact,
distinct loopback origins recorded by their manifests; the dual-origin phase
validates and reuses that pair. Both therefore use the same authenticated
reciprocal browser builds, Pages headers and redirects, and exact
build-evidence denominator. Both phases append profiles to the same `coverage/v8-browser/`
directory. The runner later executes packaged coverage
after the non-instrumented performance phases. Each nightly run directory
preserves:

- `coverage/v8-browser/` for raw Chromium profiles;
- `coverage/v8-packaged/` for packaged Electron main, preload, renderer, worker,
  worklet, and service-worker profiles;
- `coverage/v8-local-assistance/` for product-bound real-model Electron main,
  preload, utility-process, and worker-thread sessions;
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
same preserved package evidence. Real-model Node profiles are read recursively
only from their manifest-bound private session directory, so identical or
reused process IDs across products cannot move coverage between surfaces.

Service workers, dedicated workers, shared workers, and worklets are attached
before their first instruction; a later page-target attachment can miss worker
startup and service-worker install/activate execution. Triggered
precise-coverage updates are banked when Chromium emits them, but detaching a
worker does not itself emit a final update. The coverage-only page hook therefore
pauses `Worker.prototype.terminate()`, checkpoints active workers, and resumes
before the native termination runs.

Cross-document navigation is checkpointed before the old renderer context is
destroyed. The collector pauses the document in `beforeunload`, drains both its
page profiler and its attached dedicated workers, and only then resumes the
reload or navigation. A take triggered by `Runtime.executionContextsCleared` is
too late: Chromium has already discarded the prior document's ranges. Playwright
navigation and close operations also checkpoint first, including a
`page.close({ runBeforeUnload: false })` that deliberately skips the hook.

The generated `coverage/e2e-capture/`, `coverage/e2e/`, and
`coverage/e2e-report/` directories are diagnostics and must not be committed.
