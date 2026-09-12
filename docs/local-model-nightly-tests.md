# Real local-model tests

The nightly-with-tests desktop package runs real model downloads and inference
after its functional browser tests, browser metrics, and packaged-runtime metrics.
These expensive checks use `playwright.nightly-local-assistance.config.mjs` and
`tests/electron/local-assistance-models/`. They are excluded from `npm test`,
`npm run test:browser`, and the normal Playwright configuration. Lightweight tests
in the normal Node suite validate the case manifest, output checks, package
integration, and generated documentation without downloading models.

Desktop packaging supplies native engines for all 13 published models. ONNX
Runtime 1.29.0 is staged from the integrity-verified official npm packages with
target-specific file hashes in `config/assistance-onnx-runtime-payloads.json`.
Whisper v1.9.3 is built from pinned source on the package runner; its executable,
license, and build provenance are recorded in the package's authenticated runtime
manifest. Both staging paths support Linux x64/arm64, macOS arm64, and Windows
x64/arm64. The existing Sherpa runtime inventory supplies Silero, Parakeet, and
Pyannote/ERes2Net on its built targets; Windows ARM64 packaging compiles its
Node-API wrapper using `config/assistance-sherpa-win-arm64-build.json` and the
recipe's verified native libraries. Each generated model guide lists the exact
platform intersection between the model catalog and native packaging support.

The required suite now includes **19 cases covering 21 model identities**. Eight
additional models have prepared cases and guides: wav2vec2 alignment, TIGER,
room dereverberation, PANNs, both Beat This variants, TransNetV2, and Qwen3.
Their signed catalog entries are still pending. A required entry missing from
the authenticated catalog **fails its case**; defining a case does not authorize
installation, substitute an upstream download, or bypass the catalog signature.
Room dereverberation's upstream GPL-3.0 declaration, full license text, and source
directions are recorded in `LICENSES/local-models/` and `THIRD_PARTY_LICENSES.md`.
Its dry training corpus and base-checkpoint lineage remain unknown.

The Qwen engine is llama.cpp b10509, compiled from a byte-pinned source archive
for all five desktop targets. Packaging selects the static CPU completion
helper, records compiler and license provenance, and applies two exact-source
compatibility changes: honor disabled thinking and keep a human status trailer
out of JSON output. These changes have input, output, and patch hashes in the
build receipt. Qwen's production worker still validates strict JSON and candidate
authority. Packaging the engine does not itself publish the model weights.

**Windows ARM64 catalog approval is pending.** Native build recipes are prepared,
but the existing signed catalog admits only Whisper on Windows ARM64. The other
12 models require a refreshed catalog signed by the existing authorized signer.
Until it is published, those published-model cases report explicit platform skips
on Windows ARM64. The eight entirely unpublished models fail their required cases
on every target. All 13 published models are admitted on macOS arm64, Linux x64/arm64, and Windows
x64. The committed catalog keeps its valid signature; packaging support does not
override its platform scope or establish that an ARM64 build has passed inference.

The legacy public-supply candidate register can still say `pending-external`:
it tracks separately published runtime payloads. `desktop-prepare` generates
authenticated manifests for the native files actually placed in each package's
runtime directory and includes those manifests in its ASAR. The tests use these
packaged engines, without substituting development dependencies or simulated
output. Packaging support is separate from a successful test result on each
platform; retain the report from the actual package run.

## Requirements

- Use the repository's Node.js 26.5.0 and npm 12.0.1.
- Run on the platform and architecture of the packaged product runtimes.
- On Windows, install the latest supported
  [Microsoft Visual C++ v14 Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170)
  matching the desktop app: **x64** for the x64 package or **ARM64** for the ARM64
  package. ONNX and Sherpa require these runtime libraries; model downloads do
  not include them. Using the distributed app does not require Visual Studio.
- Allow approximately **2.36 GiB** for the 13 published model downloads, plus
  packaged runtimes, installation working space, fixtures, and reports. Model
  files come from the public catalog URLs; no model-service account, API key,
  download token, or other secret is required. Candidate artifacts need additional
  space once published; Qwen alone adds about **2.33 GiB**. Converted artifact
  sizes are provisional until their exact published bytes are authenticated.
- Keep at least **12 GiB of memory free** for the full planned suite. Qwen
  requires at least **16 GiB total system memory**. The model
  catalog's `minimumMemoryBytes` checks total system memory; the operation host
  separately requires enough currently free memory for its reservation.
- Linux Electron needs a display. Use `xvfb-run -a` for a machine without a
  graphical session. The tests use hidden windows and a loopback debugger.

The dedicated configuration runs one worker, without retries, with a 30-minute
timeout per case. Nineteen cases cover 21 required identities: speaker diarization
and subject detection each execute a pair, and SigLIP2's frame case executes both
its vision network and text network. Both Beat This variants run independently.
Word alignment supplies speech and a known transcript; separation expects three
stems; dereverberation supplies reflected speech; tagging supplies speech;
beat tracking supplies synthesized rhythmic music; TransNetV2 receives a visual
cut; Qwen receives two existing editorial candidates. See the
[case manifest](../config/local-model-real-test-cases.json) and
[fixture provenance](../tests/electron/local-assistance-models/fixtures/README.md).

## Run the distributed package

Launch the nightly-with-tests application. The local-model phase starts
automatically; no environment setup is needed. Use `--unattended` or set
`SOUNDSCAPER_NIGHTLY_TESTS_UNATTENDED=1` to write the final verdict to stdout
instead of displaying a completion dialog.

Each run creates a separate output directory beside the launcher. By default,
the model cache is `<run directory>/local-assistance/models`, so a new run tests
fresh downloads. To opt into reuse, set
`SOUNDSCAPER_LOCAL_ASSISTANCE_MODEL_CACHE` to an absolute path before launching.
The production installer still verifies the installed artifacts. This cache is
separate from the user's editor profile. There is no reset flag: use a new,
empty cache directory when checking fresh installation.

Assertion failures in an earlier phase do not suppress independent diagnostics.
Interruption or an infrastructure failure stops later expensive phases. A model
failure contributes to the package's failed verdict.

## Run only the real-model suite from a checkout

Prepare the current product archives first. These commands package the host's
platform and architecture and replace the generated nightly product directory:

Building Whisper and Qwen also requires CMake and a native C/C++ toolchain: GCC
on Linux, Xcode command-line tools on macOS, or Visual Studio C++ build tools
on Windows. Windows ARM64 uses the ClangCL toolset with C++ exception support.
Native staging downloads its pinned public sources during packaging.
End users of a distributed package do not need these development tools.

```sh
npm run build
npm run build:browser:framescaper
npm run prepare:browser:products
npm run desktop:nightly-tests:products
```

Then run the separate configuration. This POSIX-shell example uses the installed
Electron binary as the diagnostic host and a fresh output/cache directory:

```sh
export SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS=1
export SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT="$PWD"
export SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/scape-model-tests.XXXXXX")"
export SOUNDSCAPER_NIGHTLY_TESTS_EXECUTABLE="$(node -p 'require("electron")')"
export SOUNDSCAPER_NIGHTLY_TESTS_HOST_ENTRY="$PWD/desktop/nightly-tests-main.mjs"
export SOUNDSCAPER_PACKAGED_PRODUCT_ROOT="$PWD/release/desktop-nightly-products"
export SOUNDSCAPER_LOCAL_ASSISTANCE_MODEL_CACHE="$SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT/local-assistance/models"
npx playwright test --config playwright.nightly-local-assistance.config.mjs
```

On Linux without a display, prefix the last command with `xvfb-run -a`. On
Windows, set the same environment variables in PowerShell using absolute Windows
paths and use `node_modules/electron/dist/electron.exe` as the executable.

For a packaged nightly launcher, point `SOUNDSCAPER_NIGHTLY_TESTS_EXECUTABLE` at
its actual Electron executable and omit `SOUNDSCAPER_NIGHTLY_TESTS_HOST_ENTRY`.
Set `SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT` to its staged test payload and
`SOUNDSCAPER_PACKAGED_PRODUCT_ROOT` to that payload's `products` directory. All
configured paths must be absolute. The explicit
`SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS=1` gate is required for direct runs;
merely listing this configuration is also gated against accidental downloads.

The default product is Framescaper, whose shared assistance runtime covers both
audio and visual operations. `SOUNDSCAPER_LOCAL_ASSISTANCE_PRODUCT_ID=soundscaper`
selects the other product archive. Optional
`SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM` and `SOUNDSCAPER_PACKAGED_RUNTIME_ARCH`
describe the actual target, using `linux`/`darwin`/`win32` and `x64`/`arm64`; do
not use them to disguise the host platform. To investigate one case, append,
for example, `--grep=deepfilter-enhancement` to the command. That is a partial
run, not evidence that every model passed.

## What executes and how it is judged

The test launcher opens a dedicated hidden Electron window with an isolated
temporary user-data directory. It loads the selected product's **production
preload, assistance registration, and native runtime files from its packaged
ASAR and runtime directory**. Tests install through the real model manager,
stage inputs through the production renderer-to-main IPC bridge, run real
inference, read the authenticated output, and verify its digest and size.

The diagnostic host automatically accepts its native local-assistance consent
dialog. This is the consent test double; model downloads, model bytes, IPC, and
inference results are real. It does not replace the existing browser UI tests
for menus, settings, consent, progress, review, and applying results. The test
host is packaged only in the nightly diagnostic launcher. The shipping editors'
consent behavior and security settings are unchanged.

Decoded audio must remain finite, retain its geometry, contain changed PCM
samples, and exceed the silence threshold. Transcripts and OCR must contain
readable text with valid timing or regions. Speaker/VAD output must contain
bounded speech regions. Embeddings must have valid dimensions and finite,
nonzero, nonconstant vectors. Subject and saliency fixtures must produce useful
detections. No exact waveform, spelling, detection box, or ranking is a golden
reference; these are execution checks, not perceptual-quality benchmarks.

Alignment checks every supplied word and bounded timing. Separation checks all
three stems and rejects unchanged, silent, or duplicated stems. Tagging requires
valid labels and scores; beat and shot checks require ordered in-range events.
Editorial generation requires the exact candidate inventory and readable
requested text fields in strict JSON, preserving production content restrictions.

A missing required catalog identity fails before platform checks. A case is
skipped only when the catalog explicitly does not publish one of its
required models for the target platform. The report names that model and target.
On a catalog-supported platform, unavailable runtimes, failed downloads,
insufficient resources, adapter errors, empty results, and inference failures
**fail the case**. They are not converted to skips or successful stub results.

## Reports and model documentation

Under `<run directory>/local-assistance/`, inspect:

- `results.json`, `junit.xml`, and `playwright-report/index.html` for results,
  failures, and explicit platform skips.
- `test-results/` for per-case install records, Electron logs, inference evidence,
  validation summaries, and the processed audio or model output attachments.
- `console.log` for the packaged launcher's captured phase output. Direct
  Playwright invocations print their console output in the terminal.

Keep those reports with the package version and source revision when comparing
runs. A failed or skipped test is not evidence of model quality, and a passing
small fixture does not guarantee lossless denoising or accurate transcription.

The English [individual model guides](../handbook/src/content/docs/reference/local-models/index.md)
are generated from `config/local-model-catalog.json`, the required candidate
identities in `config/milestone-7-model-catalog-tasks.json`, the same real-test case
manifest, the Sherpa native inventory and Windows ARM64 build recipe, the ONNX
payload inventory, and the Whisper and llama stagers' exported versions and build targets.
These staging sources describe
packaged capabilities independently of public runtime publication. Edit the
appropriate source and run
`npm run docs:generate`; do not hand-edit
the generated pages. `npm run docs:reference:check` and the normal manifest tests
reject missing model coverage or stale documentation.
