# LibRaw decoder

Lightscaper's optional RAW decoder uses unmodified LibRaw 0.22.2, revision
`b93f6e45c194f5df9b02a43b1af9a54b4f41f33f`, from
[LibRaw](https://www.libraw.org/). This distribution selects upstream's
LGPL-2.1 license from its LGPL-2.1/CDDL-1.0 dual license. The original
[copyright and third-party notices](licenses/COPYRIGHT),
[LGPL text](licenses/LICENSE.LGPL), and [CDDL text](licenses/LICENSE.CDDL)
are retained unchanged.

The Soundscaper contributors wrote `native/libraw_wasm.cpp` and the surrounding
TypeScript integration in October 2026 under AGPL-3.0-only. The bridge fixes the
decode parameters, bounds native allocations, returns actual linear RGB16,
extracts embedded previews separately, and supplies a deterministic UTC hook
for Emscripten's standalone timestamp conversion. It does not modify upstream
LibRaw sources. Runtime instances are private to a worker and their memory is
wiped before retirement.

The Emscripten 3.1.64 compiler and linked support libraries retain their full
notices in `licenses/EMSCRIPTEN.txt`, `COMPILER_RT.txt`, `LIBCXX.txt`,
`LIBCXXABI.txt`, and `MUSL.txt`. Optional RawSpeed, Adobe DNG SDK, JPEG, zlib,
LCMS, external demosaic packs, threads, and SIMD are excluded from this build.
In particular, compressed DNG variants needing an excluded library are not
claimed as supported. JPEG embedded-preview passthrough does not decode JPEG.

The complete source release and exact reproduction commands are described in
[the RAW decoder build guide](../../../../docs/architecture/lightscaper-raw-decoder.md).
Preserve these notices, source directions, the pinned upstream source archive,
and the bridge/build sources with redistribution. Runtime publication must make
the corresponding source available alongside the versioned decoder. The
foundation commit does not claim that those external assets are published or
that the editor's RAW import menu is implemented.
