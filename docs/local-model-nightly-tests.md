# Real local-model tests

The nightly-with-tests desktop package runs real model downloads and inference
after its functional browser tests, browser metrics, and packaged-runtime metrics.
These expensive checks use `playwright.nightly-local-assistance.config.mjs` and
`tests/electron/local-assistance-models/`. They are excluded from `npm test`,
`npm run test:browser`, and the normal Playwright configuration. Lightweight tests
in the normal Node suite validate the case manifest, output checks, package
integration, and generated documentation without downloading models.

**Current limitation: native runtime packaging is incomplete.** The committed
`config/assistance-runtime-family-supply-candidates.json` marks every ONNX Runtime
and whisper.cpp target as `pending-external`; those verified native packages are
not supplied by `desktop-prepare`. This affects seven cases covering eight models:
Whisper, DeepFilterNet3, YuNet, D-FINE, U²-Net-P, PP-OCRv4, Nomic, and SigLIP2.
Their model weights are downloadable, but the current package cannot execute
their inference. The real tests expose this as failures on catalog-supported
platforms; a complete run cannot pass until the native packages are admitted and
shipped. The suite does not substitute Node-installed engines or simulated output.

The Sherpa runtime inventory has built payloads for Linux x64/arm64, macOS arm64,
and Windows x64. It supports Silero, Parakeet v2/v3, and the paired Pyannote/ERes2Net
case on those targets. Model publication also lists macOS x64, but the native
runtime inventory has no corresponding admitted target. These statements describe
the committed inventories, not a claim that all inference tests have passed.

## Requirements

- Use the repository's Node.js 26.5.0 and npm 12.0.1.
- Run on the platform and architecture of the packaged product runtimes.
- Allow approximately **2.36 GiB** for the 13 published model downloads, plus
  packaged runtimes, installation working space, fixtures, and reports. Model
  files come from the public catalog URLs; no model-service account, API key,
  download token, or other secret is required.
- Keep at least **8 GiB of memory free** for the complete suite. A machine with
  **16 GiB system memory or more** is a practical starting point. The model
  catalog's `minimumMemoryBytes` checks total system memory; the operation host
  separately requires enough currently free memory for its reservation.
- Linux Electron needs a display. Use `xvfb-run -a` for a machine without a
  graphical session. The tests use hidden windows and a loopback debugger.

The dedicated configuration runs one worker, without retries, with a 30-minute
timeout per case. Eleven cases cover all 13 catalog models: speaker diarization
and subject detection each execute a pair, and SigLIP2's frame case executes both
its vision network and text network. See the
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

A case is skipped only when the catalog explicitly does not publish one of its
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
are generated from `config/local-model-catalog.json`, the same real-test case
manifest, and the native runtime inventories. Edit those sources and run
`npm run docs:generate`; do not hand-edit
the generated pages. `npm run docs:reference:check` and the normal manifest tests
reject missing model coverage or stale documentation.
