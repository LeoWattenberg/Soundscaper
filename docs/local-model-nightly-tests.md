# Real local-model tests

The nightly-with-tests desktop package runs real model downloads and inference
after its functional browser tests, browser metrics, and runtime metrics.
These expensive checks use `playwright.nightly-local-assistance.config.mjs` and
`tests/electron/local-assistance-models/`. They are excluded from `npm test`,
`npm run test:browser`, and the normal Playwright configuration. Lightweight tests
in the normal Node suite validate the case manifest, output checks, package
integration, and generated documentation without downloading models.

Desktop builds prepare native-engine archives for all 22 published models and
publish them to the same R2 bucket as model weights. Kokoro G2P is built from
pinned offline inputs for the selected target. Each archive and its expanded
files are inventoried in an authenticated manifest; the package-specific nightly
result establishes whether text-to-WAV inference passed on that machine.

ONNX Runtime 1.29.0 is staged from the integrity-verified official npm packages with
target-specific file hashes in `config/assistance-onnx-runtime-payloads.json`.
Whisper v1.9.3 is built from pinned source on the package runner; its executable,
license, and build provenance are recorded in the package's authenticated runtime
manifest. Both build paths support Linux x64/arm64, macOS arm64, and Windows
x64/arm64. The existing Sherpa runtime inventory supplies Silero, Parakeet, and
Pyannote/ERes2Net on its built targets; Windows ARM64 packaging compiles its
Node-API wrapper using `config/assistance-sherpa-win-arm64-build.json` and the
recipe's verified native libraries. Each generated model guide lists the exact
platform intersection between the model catalog and downloadable native support.

The required suite now includes **20 cases covering 22 published model identities**.
The catalog admits the eight additional models with exact entry and artifact
SHA-256 pins: wav2vec2 alignment, TIGER, room dereverberation, PANNs, both Beat
This variants, TransNetV2, and Qwen3. Their catalog-task register marks
activation `ready` because target builds generate and verify the required
runtime closures. A required catalog entry or downloadable authenticated runtime
missing for a target **fails its case**;
defining a case does not authorize a substitute upstream download or bypass any
artifact or runtime pin.
Room dereverberation's upstream GPL-3.0 declaration, full license text, and source
directions are recorded in `LICENSES/local-models/` and `THIRD_PARTY_LICENSES.md`.
Its dry training corpus and base-checkpoint lineage remain unknown.

The Qwen engine is llama.cpp b10509, compiled from a byte-pinned source archive
for all five desktop targets. Packaging selects the static CPU completion
helper, records compiler and license provenance, and applies two exact-source
compatibility changes: honor disabled thinking and keep a human status trailer
out of JSON output. These changes have input, output, and patch hashes in the
build receipt. Qwen's production worker still validates strict JSON and candidate
authority. Publishing the engine does not itself publish the model weights.

All 22 published models are admitted on Windows ARM64. The existing Sherpa and
ONNX runtime closures are generated and authenticated for publication. The
Kokoro G2P package-generated recipe covers all five desktop targets. Its
actual helper closure is built and authenticated before publication; the required
nine-language case then checks speech generation. Cross-target test results come
from running each package on its target machine and must be read from that
package's nightly report.
The committed catalog keeps exact artifact pins.

The source runtime-family register describes supported build targets.
`desktop-prepare` generates authenticated manifests for the native archives.
Run the manual **Update AI assets** workflow on main to publish the authenticated
runtime archives for the selected targets and read back their complete public
responses. The separate **Desktop test artifacts (internal)** workflow runs on
every push to `main` and can also be dispatched manually there. It builds and
publicly verifies the exact archives in a read-only handoff job.
Its package jobs receive no upload credentials and use the verified source-bound
handoff. CI uploads the test packages without running their suites; launch a
package on a real machine for the browser and local-model results.
The resulting packages include the URLs and digests in the app ASAR; an
unpublished or mismatched archive stops packaging. Update the assets before
running a test artifact or release workflow for a revision whose generated
runtime bytes differ from those already published.
The tests download these engines without substituting development dependencies
or simulated output. Build support is separate from a successful test result on
each platform; retain the report from the actual package run.

## Requirements

- Use the repository's Node.js 26.5.0 and npm 12.0.1.
- Run on the platform and architecture of the packaged product runtimes.
- On Windows, install the latest supported
  [Microsoft Visual C++ v14 Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170)
  matching the desktop app: **x64** for the x64 package or **ARM64** for the ARM64
  package. ONNX and Sherpa require these runtime libraries; model and runtime
  downloads do not include them. Using the distributed app does not require Visual Studio.
- Allow approximately **5.65 GiB** for the 22 published model downloads, plus
  downloaded runtimes, installation working space, fixtures, and reports. Model
  files come from the public catalog URLs; no model-service account, API key,
  download token, or other secret is required. Qwen alone accounts for about
  **2.33 GiB**. Every cataloged artifact has an exact authenticated byte length.
- Keep at least **12 GiB of memory free** for the full planned suite. Qwen
  requires at least **16 GiB total system memory**. The model
  catalog's `minimumMemoryBytes` checks total system memory; the operation host
  separately requires enough currently free memory for its reservation.
- Linux Electron needs a display. Use `xvfb-run -a` for a machine without a
  graphical session. The tests use hidden windows and a loopback debugger.

The dedicated configuration runs one worker, without retries, with a 30-minute
timeout per case. Twenty cases cover 22 required identities: speaker diarization
and subject detection each execute a pair, and SigLIP2's frame case executes both
its vision network and text network. Both Beat This variants run independently.
Word alignment supplies speech and a known transcript; separation expects three
stems; dereverberation supplies reflected speech; tagging supplies speech;
beat tracking supplies synthesized rhythmic music; TransNetV2 receives a visual
cut; Qwen receives two existing editorial candidates; Kokoro receives fixed
text scripts and must produce audible speech through its downloaded offline G2P
helper. The Kokoro case installs the model once per product, then submits
nine short scripts in the corresponding language variants (American and British
English, Spanish, French, Hindi, Italian, Japanese, Brazilian Portuguese, and
Mandarin). Each script selects one voice from that language and requires an
authenticated, non-silent 24 kHz mono PCM16 WAV. The test attaches the WAV and
script digest, package, model, and output digest evidence for each language;
any failure fails the case after the remaining languages are attempted. A pass
does not verify all 54 voices or pronunciation quality. See the
[case manifest](../config/local-model-real-test-cases.json) and
[fixture provenance](../tests/electron/local-assistance-models/fixtures/README.md).

## Run the distributed package

Extract the GitHub Actions artifact ZIP, then launch the Windows `.exe`, macOS
app, or Linux AppImage inside it. The local-model phase starts automatically; no
environment setup is needed. An ordinary launch opens a small progress window
before the tests start and keeps the active test phase visible. The Windows
portable launcher first shows an extraction splash; the test window opens after
its bundled tools are unpacked. Once Electron starts, a
`soundscaper-nightly-tests-startup-<suffix>/startup.log` beside the launcher
records loading and failures, even if no test report directory can be created.
Startup errors wait for acknowledgement and display this log path. An unwritable
launcher directory puts the startup log in the system temporary directory.
When launched from a terminal, the application also immediately prints a
progress bar naming the active test phase.
On a TTY the bar redraws in place; redirected output retains one line per phase.
Use `--unattended` or set
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
preload and assistance registration from its packaged ASAR**, then downloads the
required runtime archives into that profile. Tests install through the real model manager,
stage inputs through the production renderer-to-main IPC bridge, run real
inference, read the authenticated output, and verify its digest and size.

Before each fresh install, the nightly case repeats public HEAD, one-byte Range,
and browser-origin CORS checks against every exact catalog URL. The production
installer's streamed download supplies the full-file SHA-256 check, so the test
does not download a model twice. Its schema-closed install receipt binds those
delivery checks and installed artifact digests to the exact source revision,
product id/version/target, packaged ASAR SHA-256 and length, and product-stage
manifest SHA-256 and length. The inference attachment repeats that package
identity and the runtime-reauthenticated model digests. A copied result from a
different commit or package therefore cannot satisfy the case.

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
- `test-results/` for per-case source/package-bound install records, Electron
  logs, inference evidence, validation summaries, and the processed audio or
  model output attachments.
- `console.log` for the packaged launcher's captured phase output. Direct
  Playwright invocations print their console output in the terminal.

Keep those reports with the package version and source revision when comparing
runs. A failed or skipped test is not evidence of model quality, and a passing
small fixture does not guarantee lossless denoising or accurate transcription.

The English [individual model guides](../handbook/src/content/docs/reference/local-models/index.md)
are generated from `config/local-model-catalog.json`, the catalog and activation
evidence in `config/milestone-7-model-catalog-tasks.json`, the same real-test case
manifest, the Sherpa native inventory and Windows ARM64 build recipe, the ONNX
payload inventory, and the Whisper and llama stagers' exported versions and build targets.
These build sources describe
target capabilities independently of public runtime publication. Edit the
appropriate source and run
`npm run docs:generate`; do not hand-edit
the generated pages. `npm run docs:reference:check` and the normal manifest tests
reject missing model coverage or stale documentation.
