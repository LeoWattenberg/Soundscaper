# Building the desktop local-model runtimes

Users install model weights from **Tools → Model Manager** and access operations
through their menus. Installing a model also downloads its required CPU engine
archive. If weights were preseeded or installed with an older application,
the required engine downloads on first use. Users do not need Node.js, Python,
CMake, or an inference server.

Windows installations also need the Microsoft Visual C++ Redistributable for
their architecture (x64 or ARM64), required by the native ONNX libraries. Use
[Microsoft's supported redistributable download](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170).

`npm run desktop:prepare` builds and authenticates the CPU engines for the
selected product and target, then creates five archives for that target. It
places only their pinned distribution manifest in the application and removes
the engine files from the installer staging tree. The same preparation is used
for both Soundscaper and Framescaper release packages and nightly-with-tests.
Preparation fails when an engine cannot be built or authenticated.

## Build prerequisites

Use the repository's Node.js 26.5.0 and npm 12.0.1. Install dependencies with
`npm ci`. Building whisper.cpp also requires CMake and a C/C++ compiler:

- Linux: `build-essential` and `cmake`; the desktop CI jobs install them.
- macOS: Xcode command-line tools and CMake. Build the macOS ARM64 package on
  Apple Silicon.
- Windows: Visual Studio 2022 or later with the C++ build tools and CMake.
  Include the ARM64 compiler tools and **C++ Clang tools for Windows** when
  building Windows ARM64. Whisper requires the ClangCL toolset on ARM64; the
  Windows ARM64 CI image already includes it. The target architecture is passed
  to CMake explicitly, so x64 build-time Node.js can prepare an ARM64 package
  on the Windows ARM runner.

The first preparation downloads pinned upstream inputs. Verified inputs are
cached under `.native-build/assistance-runtimes/`, outside the disposable
`.desktop-build/` staging directory. Subsequent product builds reuse downloads;
the source-built executable is built again and its actual output is inventoried.
No model weights are bundled or downloaded during ordinary application builds.

## Engines and model coverage

| Engine | Models |
| --- | --- |
| Sherpa ONNX 1.13.5 | Silero VAD, both Parakeet models, Pyannote segmentation and ERes2Net speaker embeddings |
| ONNX Runtime Node 1.29.0 | DeepFilterNet3, YuNet, D-FINE, U²-Net-P, PP-OCRv4, Nomic, SigLIP2, wav2vec2, TIGER-DnR, PANNs CNN10, both Beat This checkpoints, TransNetV2, Dereverb Room and Kokoro |
| whisper.cpp v1.9.3 | Whisper large-v3 turbo GGML |
| llama.cpp b10509 | Qwen3 4B Q4_K_M |
| Kokoro G2P 0.9.4 | Offline phonemization for Kokoro, installed with ONNX Runtime |

ONNX Runtime comes from the exact npm archives and file hashes in
`config/assistance-onnx-runtime-payloads.json`. Packaging extracts the selected
platform's CPU files without executing npm install scripts or downloading CUDA.
The runtime archive includes the upstream license and third-party notices.

whisper.cpp comes from the pinned source archive recorded in
`scripts/lib/desktop-assistance-whisper-runtime.mjs`. Its build disables GPU
backends and host-specific CPU tuning. A small source-checked patch routes JSON
through inherited stdout without reopening `CON` or `/dev/stdout`, which do not
work with every Electron/Node process pipe. This preserves the existing
bounded-output worker. Build provenance records the original source, patch,
recipe, tools and resulting files. The MIT license accompanies the executable.

Windows ARM64 has no upstream Sherpa Node addon package at the pinned version.
Preparation builds that wrapper using the exact inputs in
`config/assistance-sherpa-win-arm64-build.json`, then stages it with the existing
Sherpa JavaScript package and official ARM64 libraries. The archive build receipt
records the source, compiler and resulting file hashes. Other platforms retain
the existing upstream Sherpa package inventories.

The current digest-pinned model catalog admits all 22 models on Windows ARM64
as well as macOS ARM64, Linux x64/ARM64 and Windows x64. Catalog admission
and package-runtime authentication remain independent checks; building an
engine does not override either one.

Kokoro's ONNX engine and offline G2P helper have package recipes for all five
desktop targets. Preparation freezes the pinned Python closure into a helper,
archives it, and records its exact target file inventory in
`config/assistance-kokoro-g2p-runtime-manifest.json` inside the application.
Installing Kokoro through Model Manager fetches both ONNX Runtime and G2P;
first use fetches either missing runtime for preseeded weights. The production
worker verifies the G2P inventory before each subprocess invocation. End users
do not install Python. The packaged nightly nine-language text-to-WAV case
establishes whether that target build performs speech
generation; a recipe alone is not a passing inference result.

## Package integrity

The installer has no files under `runtime/assistance/`. The packaged
`app.asar` contains `config/assistance-runtime-distribution.json`, which pins the URL,
compressed byte length, SHA-256 and exact extracted file inventory of each
archive. The archives use immutable keys under
`https://assets.soundscaper.org/runtime/assistance/` in the same EU R2 bucket
as model weights. The manual **Update AI assets** workflow runs
`npm run desktop:publish:assistance-runtimes` to upload them and require public
HEAD, byte-range and full SHA-256 readback. Desktop preview builds publish
Windows archives once per target and pass the authenticated manifest to both
product package jobs. Desktop package workflows verify the staged archives
against those published immutable URLs before packaging.

On request, the main process downloads a pinned archive into the user's app
data directory, checks its compressed digest, extracts only the listed regular
files, checks every file digest, and installs the closure under
`<userData>/runtime/assistance/`. Main and the inference worker authenticate
engine bytes again before execution. Missing, extra or altered files fail
authentication; a missing runtime cannot execute while offline.

For Developer ID macOS releases, preparation signs every Mach-O engine file
before archiving it and repins the signed bytes in the manifests. The existing
package signing hook signs the remaining application files and verifies the
packaged copy. Follow [the signing setup guide](desktop-signing-setup.md) for
the release credentials. Windows package signing covers the application and
its pinned archive manifest; downloaded engine files are checked against that
manifest before execution.

## Validation

The normal Node suite checks provisioning, integrity failures and model-output
validators without downloading weights. The computationally intensive suite is
separate: [real model nightly tests](local-model-nightly-tests.md) downloads and
attempts every published model through the desktop bridge. Kokoro's required
case checks one published voice in each of its nine language variants and fails
if its G2P helper is missing, altered, or unable to produce a valid WAV. The suite
checks useful, nonempty outputs; audio must be finite and audible. Audio
transformation outputs must also differ from their input. These checks establish
execution, not recognition or restoration quality.
