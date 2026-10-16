# Building the desktop local-model runtimes

Users install model weights from **Tools → Model Manager** and access operations
through their menus. Installing a model also downloads its required engine
archive. If weights were preseeded or installed with an older application,
the required engine downloads on first use. Users do not need Node.js, Python,
CMake, or an inference server.

Windows installations also need the Microsoft Visual C++ Redistributable for
their architecture (x64 or ARM64), required by the native ONNX libraries. Use
[Microsoft's supported redistributable download](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170).

`npm run desktop:prepare` builds and authenticates the inference engines for the
selected product and target, then creates five archives for that target. It
places only their pinned distribution manifest in the application and removes
the engine files from the installer staging tree. The same preparation is used
for both Soundscaper and Framescaper release packages and nightly-with-tests.
Preparation fails when an engine cannot be built or authenticated.

## Build prerequisites

Use the repository's Node.js 26.5.0 and npm 12.0.1. Install dependencies with
`npm ci`. Building Sherpa, the ONNX and G2P GPU bindings, whisper.cpp, and
llama.cpp also requires CMake, Python 3, and a C/C++ compiler:

- Linux: `build-essential`, `cmake` (3.22.1 or later), `pkg-config`, and
  `python3`; the desktop CI jobs install them.
- macOS: Xcode command-line tools and CMake. Build the macOS ARM64 package on
  Apple Silicon.
- Windows: Visual Studio 2022 or later with the C++ build tools, Python 3,
  and CMake 3.26 or later for ARM64 loader assembly support.
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

All 22 catalog models have a GPU option on every maintained desktop target.
Existing menu-invoked operations automatically try the installed runtime's
authenticated GPU providers, followed by CPU fallback. ONNX Runtime and Sherpa
use CoreML or native WebGPU on macOS ARM64, and native WebGPU on Windows and
Linux x64/ARM64. GPU availability depends on the machine's compatible graphics
hardware, drivers, and memory. Native WebGPU runs in the desktop worker;
these recipes do not add browser inference.

The shared ONNX Runtime 1.29.0 core comes from the exact npm archives and file
hashes in `config/assistance-onnx-runtime-payloads.json`. The WebGPU plugin and
its C API headers are pinned in `config/assistance-onnx-webgpu-plugin.json`.
Packaging authenticates the reviewed plugin binary, MIT license, and complete
third-party notices. All five generic ONNX archives rebuild the Node-API binding from the locked
source and patches in `config/assistance-onnx-node-api-build.json` to register
that plugin; the stable ORT core is reused and macOS retains CoreML support.
An authenticated device probe isolates WebGPU initialization failures before
the resident worker loads the GPU backend. No npm lifecycle install script runs. Windows includes the pinned
DXC shader compiler libraries and their upstream notices. DirectML and CUDA
are not packaged.

whisper.cpp comes from the pinned source archive recorded in
`scripts/lib/desktop-assistance-whisper-runtime.mjs`. The macOS ARM64 Whisper and
llama.cpp recipes enable Metal with embedded shader source while retaining the
CPU backend. Windows and Linux x64/ARM64 builds produce a portable CPU
executable and a separate Vulkan executable under `gpu/`; both are authenticated
in the same archive. The CPU executable has no Vulkan loader dependency. Workers
prefer the authenticated GPU companion and fall back to CPU for unavailable
loaders/devices or backend execution failures. Vulkan requires the system loader
(`vulkan-1.dll` on Windows or `libvulkan.so.1` on Linux) and a compatible vendor
graphics driver. These host dependencies are not bundled or authenticated by the
runtime archive. CUDA, DirectML, and host-specific CPU tuning remain disabled.

The Vulkan toolchain is built from the source hashes in
`config/desktop-assistance-vulkan-sources.json`: Vulkan Headers/Loader plus
shaderc and its pinned glslang, SPIRV Headers, and SPIRV Tools dependencies.
The shader compiler runs on the build host; the loader import library targets the
package architecture, including Windows ARM64. Packaging requires this toolchain
to build successfully and never substitutes a host SDK or silently omits the GPU
executable. Embedded shaders need no separate download. Build provenance retains
the source/toolchain identities, and `VULKAN_NOTICES.txt` accompanies the runtime.

A small source-checked Whisper patch routes JSON
through inherited stdout without reopening `CON` or `/dev/stdout`, which do not
work with every Electron/Node process pipe. This preserves the existing
bounded-output worker. Build provenance records the original source, patch,
recipe, tools and resulting files. The MIT license accompanies the executable.

Sherpa is rebuilt for all five targets using the source pins, provider patches,
Node headers, and Node-API inputs in `config/assistance-sherpa-gpu-build.json`.
The build links the shared reviewed ORT core and packages its WebGPU plugin,
then authenticates the generated addon, C/C++ libraries, notices, and build
provenance. Parakeet recognition, Silero VAD, pyannote segmentation, and ERes2Net
speaker embedding all receive the installed archive's provider selection.
GPU construction or inference failures can retry the same authenticated model
on CPU after the native call finishes and supported release hooks run.
Cancellation, invalid inputs or outputs, and authentication failures remain
terminal. Previously published CPU archives remain compatible as legacy
fallback; every new target build must include GPU support.

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
do not install Python. Its English pronunciation path includes learned spaCy
Tok2Vec/tagger models. Their original weights, tokenization, lexical features,
and Misaki rules are unchanged: a Thinc numeric backend offloads matrix
products through the authenticated ORT WebGPU shim in
`config/assistance-kokoro-g2p-gpu-build.json`, with CPU fallback. The G2P archive
seals that shim, its isolated device probe, the reviewed ORT core/plugin, and
upstream notices under `_internal/scape-gpu/`. Windows ARM64 retains its x64
frozen Python helper and uses matching x64 GPU libraries in that process.
Other language paths use the existing dictionary/rule frontends. The imported
CPU PyTorch dependency does not run the Kokoro synthesis model because G2P
uses `model=False`; actual speech synthesis uses the accelerated ONNX engine.
The packaged nightly nine-language text-to-WAV case establishes whether that
target build performs speech generation; a recipe alone is not a passing
inference result.

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
product package jobs. The internal Desktop test artifact workflow uses committed
snapshots of previously published target handoffs. Its package jobs download
the exact public archives without rebuilding them. Desktop package workflows
verify staged archives against their published immutable URLs before packaging.

Changes to these GPU recipes require a manual **Update AI assets** run before
release. Download that run's `assistance-runtime-handoff-*` artifacts, run
`node scripts/refresh-desktop-test-runtime-snapshots.mjs <downloaded-artifacts-directory>`,
and commit the refreshed snapshot register and compressed files. Desktop test
artifacts continue to use the committed snapshots until that refresh; building
or testing source changes does not publish new runtimes.

On request, the main process downloads a pinned archive, checks its compressed
digest, extracts only the listed regular files, checks every file digest, and
installs the closure under `<userData>/runtime/assistance/` on macOS and Windows.
Linux installs under `$XDG_DATA_HOME/Soundscaper/runtime/assistance/` and caches
archives under `$XDG_CACHE_HOME/Soundscaper/runtime-archives/`, defaulting to
`~/.local/share` and `~/.cache` respectively. Framescaper uses the same layout
under `Framescaper`. Main and the inference worker authenticate
engine bytes again before execution. Missing, extra or altered files fail
authentication; a missing runtime cannot execute while offline.

For Developer ID macOS releases, preparation signs every Mach-O engine file
before archiving it and repins the signed bytes in the manifests. The existing
package signing hook signs the remaining application files and verifies the
packaged copy. Follow [the signing setup guide](../signing.md) for
the release credentials. Windows package signing covers the application and
its pinned archive manifest; downloaded engine files are checked against that
manifest before execution.

## Validation

The normal Node suite checks provisioning, integrity failures and model-output
validators without downloading weights. The computationally intensive suite is
separate: [real model nightly tests](nightly-tests.md) downloads and
attempts every published model through the desktop bridge. Kokoro's required
case checks one published voice in each of its nine language variants and fails
if its G2P helper is missing, altered, or unable to produce a valid WAV. The suite
checks useful, nonempty outputs; audio must be finite and audible. Audio
transformation outputs must also differ from their input. These checks establish
execution, not recognition or restoration quality.
