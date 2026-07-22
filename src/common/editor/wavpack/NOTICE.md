# WavPack PCM runtime notices

Soundscaper includes a WebAssembly build of WavPack 5.9.0 for lossless
compression of persisted 32-bit floating-point PCM chunks.

- Upstream: <https://github.com/dbry/WavPack>
- Release: `5.9.0`
- Commit: `5803634a030e2a11dba602ba057b89cc34486c67`
- License: BSD-3-Clause (see `licenses/WAVPACK.txt`)

The `native/soundscaper_wavpack.c` file is a Soundscaper-owned in-memory ABI
bridge distributed under AGPL-3.0-only. The remaining files in `native/` are
unaltered files from the pinned WavPack commit.

The checked-in `wavpack.wasm` artifact is built with Emscripten 3.1.64. The
reproducible source manifest and audit intentionally exclude WavPack tags,
filename/file-system access, DSD, pre-4.0 legacy decoding, seek APIs,
architecture assembly/SIMD, and threading.
