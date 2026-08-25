# Soundscaper bundled codec corresponding source

This archive is the preferred corresponding-source delivery for the standalone
WebAssembly codec modules shipped by the same Soundscaper desktop release. It
contains the exact reviewed upstream source archives, Soundscaper C wrappers,
the in-tree WavPack source snapshot, build configuration and scripts, and the
applicable license and notice files for FLAC, LAME, mpg123, Ogg Opus, TwoLAME,
Ogg Vorbis, and WavPack. It contains no compiled codec module.

`BUNDLE-MANIFEST.json` binds every file in this ZIP by byte length and SHA-256
and records the exact shipped WebAssembly identity to which each codec's source
corresponds. Each `src/common/editor/<codec>/source-manifest.json` records the
upstream revision or release, archive digest, local changes, build switches,
compiled-source closure, toolchain, and expected output digest. The mpg123
source archive, detached signature, and pinned signing key are all included.
The shared libogg archive is stored once.

## Rebuild

Use Node.js 26.5.0 with `tar` and Emscripten 3.1.64. The reviewed compiler
container is:

```text
emscripten/emsdk:3.1.64@sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc
```

The mpg123 build also requires `gpg` so that its detached signature can be
checked against the bundled key. From the extracted archive root, run:

```sh
mkdir -p rebuilt
export SOUNDSCAPER_CODEC_SOURCE_DIRECTORY="$PWD/upstream"
node scripts/build-flac-wasm.mjs --output rebuilt/flac.wasm
node scripts/build-lame-wasm.mjs --output rebuilt/lame.wasm
node scripts/build-mpg123-wasm.mjs --output rebuilt/mpg123.wasm
node scripts/build-opus-wasm.mjs --output rebuilt/opus.wasm
node scripts/build-twolame-wasm.mjs --output rebuilt/twolame.wasm
node scripts/build-vorbis-wasm.mjs --output rebuilt/vorbis.wasm
node scripts/build-wavpack-wasm.mjs --output rebuilt/wavpack.wasm
```

The first six scripts prefer the bundled `upstream/` files selected by
`SOUNDSCAPER_CODEC_SOURCE_DIRECTORY`; every input is still checked against the
source manifest's exact size/signature/digest policy. With the variable unset,
the scripts retain their reviewed HTTPS acquisition path. WavPack is rebuilt
from its complete digest-pinned `src/common/editor/wavpack/native/` snapshot.
Every build fails if the result differs from its source manifest's expected
WebAssembly digest.

For the containerized build, mount this extracted directory at a stable path,
set it as the working directory, and invoke the same commands with the immutable
container reference above. The scripts set the codec-specific
`SOURCE_DATE_EPOCH`, UTC timezone, C locale, deterministic prefix maps, and
reviewed feature switches.

## Modify, rebuild, and replace

Each codec implementation and Soundscaper wrapper is statically linked only
inside its own standalone WebAssembly module; it is not linked into Electron or
a Soundscaper native executable. To use a modified LGPL codec, edit the source
or wrapper, update the owning source manifest deliberately, rebuild the module,
and replace `src/common/editor/<codec>/<codec>.wasm` in a Soundscaper source
checkout before running the normal desktop build/package workflow. Package
signatures and the runtime manifest must then be regenerated for the new bytes.
No relink of Electron itself is required.

Soundscaper wrapper changes are licensed under AGPL-3.0-only; the full text is
included at `LICENSES/Soundscaper-AGPL-3.0.txt`. Upstream license texts and
notices are stored beside each codec. This delivery concerns copyright source
availability and makes no patent-clearance or non-infringement representation.
