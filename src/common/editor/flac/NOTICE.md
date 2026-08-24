# Bundled FLAC runtime notice

Soundscaper's bundled desktop FLAC runtime contains a WebAssembly build of
libFLAC 1.5.0 from Xiph.Org, pinned to commit
`1507800de4b70e21be71f38caa0d9079d0bc6e45`. The upstream source archive is
`https://downloads.xiph.org/releases/flac/flac-1.5.0.tar.xz`, pinned by
SHA-256 in `source-manifest.json`.

Only the native FLAC stream encoder/decoder core is compiled. Soundscaper's
narrow ABI exposes memory buffers only; it exposes no file, Ogg, or metadata
mutation entry points and uses no architecture-specific SIMD or threads.

Encoding accepts interleaved `f32` input, clamps it to FLAC's unit PCM range,
and deterministically quantizes it to signed 24-bit PCM. The FLAC bitstream is
lossless over that explicit 24-bit conversion; it is not a float-exact PCM
round trip. Soundscaper's wrapper is AGPL-3.0-only. libFLAC is redistributed
under the BSD-3-Clause terms reproduced in `licenses/FLAC.txt`.
