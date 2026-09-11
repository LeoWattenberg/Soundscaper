# Building the desktop local-model runtimes

Users install model weights from **Tools → Model Manager** and run them through
the existing Local Assistance menus. The desktop application includes the
engines; users do not need Node.js, Python, CMake, or an inference server.
Windows installations also need the Microsoft Visual C++ Redistributable for
their architecture (x64 or ARM64), required by the native ONNX libraries. Use
[Microsoft's supported redistributable download](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170).

`npm run desktop:prepare` stages the CPU engines in both Soundscaper and
Framescaper. The same preparation is used by release packages and the products
embedded in nightly-with-tests. Preparation fails when an engine cannot be
built or authenticated, rather than producing a package with unusable models.

## Build prerequisites

Use the repository's Node.js 26.5.0 and npm 12.0.1. Install dependencies with
`npm ci`. Building whisper.cpp also requires CMake and a C/C++ compiler:

- Linux: `build-essential` and `cmake`; the desktop CI jobs install them.
- macOS: Xcode command-line tools and CMake. Build the macOS ARM64 package on
  Apple Silicon.
- Windows: Visual Studio 2022 or later with the C++ build tools and CMake.
  Include the ARM64 compiler tools when building Windows ARM64. The target
  architecture is passed to CMake explicitly, so x64 build-time Node.js can
  prepare an ARM64 package on the Windows ARM runner.

The first preparation downloads pinned upstream inputs. Verified inputs are
cached under `.native-build/assistance-runtimes/`, outside the disposable
`.desktop-build/` staging directory. Subsequent product builds reuse downloads;
the source-built executable is built again and its actual output is inventoried.
No model weights are bundled or downloaded during ordinary application builds.

## Engines and model coverage

| Engine | Models |
| --- | --- |
| Sherpa ONNX 1.13.5 | Silero VAD, both Parakeet models, Pyannote segmentation and ERes2Net speaker embeddings |
| ONNX Runtime Node 1.29.0 | DeepFilterNet3, YuNet, D-FINE, U²-Net-P, PP-OCRv4, Nomic and SigLIP2 |
| whisper.cpp v1.9.3 | Whisper large-v3 turbo GGML |

ONNX Runtime comes from the exact npm archives and file hashes in
`config/assistance-onnx-runtime-payloads.json`. Packaging extracts the selected
platform's CPU files without executing npm install scripts or downloading CUDA.
The package includes the upstream license and third-party notices.

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
Sherpa JavaScript package and official ARM64 libraries. The package receipt
records the source, compiler and resulting file hashes. Other platforms retain
the existing upstream Sherpa package inventories.

The current signed model catalog admits only Whisper on Windows ARM64. The
other twelve entries still need platform approval from the existing catalog
signer; building the engines does not override that signed restriction. All
thirteen models are admitted on macOS ARM64, Linux x64/ARM64 and Windows x64.

## Package integrity and signing

Executable files stay outside `app.asar`, under `runtime/assistance/`.
Preparation generates a target-specific manifest inside
`app.asar/config/assistance-runtime-family-supply-candidates.json`. This packaged
file contains the actual ONNX Runtime and Whisper inventories; the similarly
named source register remains a record of independent public-supply candidates.
No public readback or external signature is claimed for a locally built package.

The stage receipt records the packaged manifest's size and SHA-256. Before and
after package assembly, the build verifies the manifest and the complete file
inventory. Main and the inference helper check engine bytes again before use.
Missing, extra or altered files fail authentication.

On macOS, ad-hoc seals are applied before final inventory hashes where needed.
Electron Builder preserves these sealed runtime files. Developer ID releases
use the existing signing hook: it verifies the original stage, signs native
files, updates the affected manifest hashes before ASAR assembly, and verifies
the packaged copies. Follow [the signing setup guide](desktop-signing-setup.md) for
the release credentials.

Windows package signing preserves the inventoried Whisper executable during
resource copying. Its integrity is checked against the manifest inside the
signed application archive.

## Validation

The normal Node suite checks provisioning, integrity failures and model-output
validators without downloading weights. The computationally intensive suite is
separate: [real model nightly tests](local-model-nightly-tests.md) downloads and
executes every published model through the desktop bridge. It checks useful,
nonempty outputs; audio must be finite, audible and different from its input.
These checks establish execution, not recognition or restoration quality.
