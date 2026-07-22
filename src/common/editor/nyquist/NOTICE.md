# Nyquist WebAssembly notices

This directory contains a browser adaptation of Audacity 3.7.7's Nyx/Libnyquist interpreter. It evaluates Nyquist Lisp and SAL against in-memory planar PCM. It deliberately provides no host filesystem, shell, terminal input, MIDI, audio-device, libsndfile, liblo, PortAudio, or AUD-DO bridge.

## Audacity Nyx, Nyquist, and XLISP

- Source: <https://github.com/audacity/audacity/tree/5ef610ed23260d6d648175735bb16b32536eb30b/lib-src/libnyquist>
- Exact Audacity revision: `5ef610ed23260d6d648175735bb16b32536eb30b` (Audacity 3.7.7)
- Libnyquist authors: Dominic Mazzoni, in cooperation with Roger B. Dannenberg
- Nyquist copyright: Roger B. Dannenberg and contributors
- XLISP copyright: David Michael Betz and contributors
- STK-derived instrument classes retain the Perry R. Cook and Gary P. Scavone authorship notices in the pinned upstream source.

The complete upstream Libnyquist notice and Nyquist/XLISP license are reproduced in [`licenses/LIBNYQUIST.txt`](licenses/LIBNYQUIST.txt) and [`licenses/NYQUIST-XLISP.txt`](licenses/NYQUIST-XLISP.txt). Audacity is a registered trademark; Soundscaper is not affiliated with or endorsed by Audacity or Muse Group.

Browser adaptations made on 2026-07-15:

- added a bounded C ABI for one interpreter session per worker, planar PCM input, rendered PCM output, labels, strings, and numbers;
- embedded the pinned read-only Lisp/SAL runtime and replaced its initialization entry points for a fileless browser host;
- made `SYSTEM`, terminal input, directory listing, environment access, and sound-file import/export unavailable;
- replaced the desktop current directory with the logical, read-only `/runtime/` path used only to resolve embedded resources;
- omitted libsndfile and PortAudio translation units and supplied erroring file-I/O stubs;
- capped captured output, source size, channels, caller-selected render length, and linear memory.

The Soundscaper bridge, stubs, browser runtime adaptations, build script, and audit script are licensed under AGPL-3.0-only as part of this application. The selected AGPLv3/GPLv3 terms are bundled at the repository root.

## Emscripten-linked runtime

The reproducible artifact is linked with Emscripten `3.1.64`. Emscripten and the bundled libc/libc++ components retain their permissive notices in the existing shared runtime notice directory:

- [`../staffpad/licenses/EMSCRIPTEN.txt`](../staffpad/licenses/EMSCRIPTEN.txt)
- [`../staffpad/licenses/MUSL.txt`](../staffpad/licenses/MUSL.txt)
- [`../staffpad/licenses/LIBCXX.txt`](../staffpad/licenses/LIBCXX.txt)
- [`../staffpad/licenses/LIBCXXABI.txt`](../staffpad/licenses/LIBCXXABI.txt)
- [`../staffpad/licenses/COMPILER_RT.txt`](../staffpad/licenses/COMPILER_RT.txt)

Build inputs, hashes, runtime allowlists, ABI exports, import allowlists, memory limits, and toolchain pinning are machine-readable in [`source-manifest.json`](source-manifest.json). Run `node scripts/audit-nyquist-wasm.mjs` before distributing the artifact.
