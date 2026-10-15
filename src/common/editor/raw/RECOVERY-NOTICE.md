# LibRaw recovery decoder

Lightscaper's separate ABI 2 recovery decoder uses unmodified LibRaw 0.22.2,
revision `b93f6e45c194f5df9b02a43b1af9a54b4f41f33f`, from
[LibRaw](https://www.libraw.org/). This distribution selects upstream's
LGPL-2.1 license from its LGPL-2.1/CDDL-1.0 dual license. The original
[copyright and third-party notices](licenses/COPYRIGHT),
[LGPL text](licenses/LICENSE.LGPL), and [CDDL text](licenses/LICENSE.CDDL)
are retained unchanged.

The Soundscaper contributors wrote `native/libraw_recovery_wasm.cpp` and its
surrounding TypeScript integration in October 2026 under AGPL-3.0-only. The
bridge provides two fixed processing profiles: linear headroom and highlight
reconstruction. It captures signed linear RGB as Float32 before the usual
unsigned RGB conversion, applies the declared exposure normalization, bounds
native allocations and supplies a deterministic UTC hook for Emscripten's
standalone timestamp conversion. It does not modify upstream LibRaw sources.
Runtime instances are private to a worker; native memory is wiped before
retirement and scoped output is wiped after consumption.

The Emscripten 3.1.64 compiler and linked support libraries retain their full
notices in `licenses/EMSCRIPTEN.txt`, `COMPILER_RT.txt`, `LIBCXX.txt`,
`LIBCXXABI.txt`, and `MUSL.txt`. Optional RawSpeed, Adobe DNG SDK, JPEG, zlib,
LCMS, external demosaic packs, threads, and SIMD are excluded from this build.
Only the bounded regular RGB Bayer input subset described in
[the recovery decoder build guide](../../../../docs/architecture/lightscaper-raw-recovery.md)
is admitted. Broader RAW camera and compression support is not claimed.

The recovery artifact has a separate versioned path,
`runtime/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm`, and a separate
`corresponding-source.tar.gz` with its SHA-256 sidecar beside it. The build
guide gives the complete source inventory and reproduction commands. Preserve
these notices, the source directions, the pinned upstream archive and the
bridge/build sources with redistribution. Runtime publication must make that
corresponding source available alongside the decoder. This foundation does
not claim external publication or an implemented recovery control in Develop.
The existing ABI 1 decoder and its corresponding-source release are unchanged.
