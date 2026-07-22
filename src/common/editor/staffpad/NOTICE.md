# StaffPad WebAssembly notices

This directory contains a browser adaptation of Audacity's StaffPad time-and-pitch engine. It deliberately includes no `au3` UI, preferences, logging, plug-in, audio-device, cloud/audio.com, SBSMS, SoundTouch, or SoX code.

## Audacity StaffPad

- Source: <https://github.com/audacity/audacity/tree/908ad0a526e5bfdab68de780e893cebe172d27eb/au3/libraries/au3-time-and-pitch>
- Exact revision: `908ad0a526e5bfdab68de780e893cebe172d27eb`
- Upstream license: GPL-2.0-or-later where an individual file does not state narrower terms. The GPLv3 option is selected when combined with this AGPLv3 application.
- Copyright: the Audacity Team and the authors retained in individual source headers.

Modifications made for the browser build on 2026-07-13:

- removed `FormantShifter` file logging and desktop preference dependencies;
- forced StaffPad's scalar vector implementation;
- added a bounded C ABI for one- or two-channel planar PCM;
- retained Audacity's FFT sizing, imaging reduction, formant cutoff, latency handling, and 1024-frame maximum block size.

The repository bundles the selected GPLv3 terms at `LICENSES/GPL-3.0.txt`. Audacity is a registered trademark; this project is not affiliated with or endorsed by Audacity or Muse Group.

## PFFFT

The scalar FFT implementation is PFFFT revision `09796885cd5b`, with the exact Audacity/Muse dependency patch at muse_deps revision `adcefed921921cb090110b4a71a91966c1306889`. Its complete required notice is in [`licenses/PFFFT.txt`](licenses/PFFFT.txt).

## Emscripten-linked runtime

The reproducible artifact is linked with Emscripten `3.1.64`. Emscripten compiler/runtime code and its bundled libc/libc++ components retain their upstream permissive notices:

- [`licenses/EMSCRIPTEN.txt`](licenses/EMSCRIPTEN.txt)
- [`licenses/MUSL.txt`](licenses/MUSL.txt)
- [`licenses/LIBCXX.txt`](licenses/LIBCXX.txt)
- [`licenses/LIBCXXABI.txt`](licenses/LIBCXXABI.txt)
- [`licenses/COMPILER_RT.txt`](licenses/COMPILER_RT.txt)

Exact toolchain source: <https://github.com/emscripten-core/emscripten/tree/3.1.64>.

Build inputs, hashes, archive URLs, and toolchain pinning are machine-readable in [`source-manifest.json`](source-manifest.json). Run `node scripts/audit-staffpad-wasm.mjs` before distributing the artifact.
