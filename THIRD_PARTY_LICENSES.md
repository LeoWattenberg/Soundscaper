# Third-party browser runtime notices

## Audacity-derived native audio effects

Parts of `src/lib/tools/audio-editor/audacity-effects/` are JavaScript translations and adaptations of native effect implementations from Audacity 3.7.7, exact commit `5ef610ed23260d6d648175735bb16b32536eb30b`:

- source: <https://github.com/audacity/audacity/tree/Audacity-3.7.7>
- upstream license and notices: <https://github.com/audacity/audacity/blob/Audacity-3.7.7/LICENSE.txt>
- bundled GPLv3 terms: [`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt)

Audacity is distributed under GPLv3. Many individual source files are GPL-2.0-or-later; the GPLv3 option is selected for the adapted portions so they can be combined with this AGPLv3 application under section 13 of both licenses. The Audacity-derived portions remain governed by GPLv3. Upstream authorship, source paths, and modification notices are retained in the corresponding JavaScript source files.

Original code is copyright the Audacity Team and the individual authors named in the retained source-file headers. The SimpleCompressor portion retains its separate notice below.

The implementations were translated from C/C++ to JavaScript, separated from Audacity's application and UI construction, and integrated into the kw.media browser audio editor on 2026-07-13. The distributed source code is the preferred form for modification.

Audacity's Compressor and Limiter incorporate SimpleCompressor code:

- SimpleCompressor — Copyright © 2019 Daniel Rudrich; GPL-3.0-only; source: <https://github.com/DanielRudrich/SimpleCompressor>

The port deliberately includes no SoX/libsoxr, SoundTouch, or SBSMS code. Reverb is a repository-owned browser adaptation using a Schroeder topology, and all time/pitch processing uses the separately noticed StaffPad engine below.

The effect registry covers Audacity's menu-visible native processors and browser adaptations. Generate-menu modules (DTMF, Chirp, Noise, Silence, and Tone) and Analyze operations are implemented as separate editor operations rather than processor plug-ins.

## Audacity 4 parity and native AUP4 profile

The action-parity manifest, native AUP4 codec/profile implementation, compatibility fixtures, and StaffPad selection are pinned to Audacity commit `908ad0a526e5bfdab68de780e893cebe172d27eb`:

- source: <https://github.com/audacity/audacity/tree/908ad0a526e5bfdab68de780e893cebe172d27eb>
- AUP4 behavior sources: `au3/libraries/au3-project-file-io/ProjectSerializer.cpp`, `au3/libraries/au3-project-file-io/ProjectFileIO.cpp`, `au3/libraries/au3-project-file-io/SqliteSampleBlock.cpp`, and `au3/libraries/au3-realtime-effects/RealtimeEffectState.cpp`; native parameter names additionally follow the registered effect implementations under `src/effects/builtin_collection/` and `au3/libraries/au3-builtin-effects/`
- StaffPad source allowlist: `au3/libraries/au3-time-and-pitch`
- pinned Audacity-created fixtures: `src/project/tests/data/empty.aup4` SHA-256 `cb073217e4b224c4712c652d5559bc752e1d43df26114de6532fa2fb7c0def1d`, `src/project/tests/data/legacy_schema.aup4` SHA-256 `d726ad50c90df0472d567982e3706643799460e3bfb79256c30c9bd9431ef56b`, and the richer `src/trackedit/tests/data/testClipboard.aup4` SHA-256 `a8279b4573862579647b3826250d366af134ab9684fa20f409a03fd7227dba59`
- upstream license and notices: <https://github.com/audacity/audacity/blob/908ad0a526e5bfdab68de780e893cebe172d27eb/LICENSE.txt>
- selected GPLv3 terms: [`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt)

`tests/fixtures/aup4-native-empty.js`, `tests/fixtures/aup4-native-legacy.js`, `tests/fixtures/aup4-native-rich.js`, `tests/fixtures/aup4-binary-xml-oracle.js`, and `tests/fixtures/aup4-sampleblock-oracle.js` contain the compressed Audacity-created empty/legacy/rich projects and compact interoperability data derived from the pinned Audacity sources. The rich fixture exercises two tracks, five clips, group state, stretch-to-tempo state, Float32 block reuse, and byte-exact Audacity-created summaries through an Audacity-created fixture → browser decode → browser write → browser reopen cycle. That fixture-codec audit does not execute Audacity's compiled native loader or writer. The separate compiled-native round-trip release gate is recorded as pending, with its required evidence, in `tests/fixtures/aup4-interop-gate.json`; `npm run audit:aup4-interop:release` fails closed until that evidence is produced. The browser codec is a clean JavaScript adaptation with typed opaque-node preservation; no QML, wxWidgets, or other `au3/` UI code is included.

## StaffPad time-and-pitch WebAssembly

The committed scalar, single-threaded StaffPad module and its preferred source are in `src/lib/tools/audio-editor/staffpad/`:

- Audacity revision: `908ad0a526e5bfdab68de780e893cebe172d27eb`; GPL-2.0-or-later with GPLv3 selected for this distribution
- PFFFT revision: `09796885cd5b`; archive SHA-256 `fdc80563de8c31d6380886bc1ba0ffb897abde58611707ac94eb8edab850cbb`; UCAR/NCAR permissive license
- Audacity/Muse dependency patch: muse_deps revision `adcefed921921cb090110b4a71a91966c1306889`; patch SHA-256 `e1e44efe52192f9ae919442a8a282b32679ed94d8a6351b084f7a3a4d07e613c`
- Emscripten toolchain/runtime: `3.1.64`, including the retained musl, libc++, libc++abi, and compiler-rt notices
- committed `staffpad.wasm` SHA-256: `6b7e3fa86ddd90ddd6c358cf431742bd890fb76354509aa5732e4d3686791b7b`

The exact allowlist, per-file hashes, imports, exports, toolchain image, modifications, and license-file hashes are recorded in [`source-manifest.json`](src/lib/tools/audio-editor/staffpad/source-manifest.json). Detailed notices are in [`NOTICE.md`](src/lib/tools/audio-editor/staffpad/NOTICE.md). Rebuild with `npm run build:staffpad`; verify sources, binary imports, the absence of prohibited library symbols, and the artifact hash with `npm run audit:staffpad`.

Audacity is a registered trademark. This project is not affiliated with or endorsed by the Audacity project or Muse Group.

## FFmpeg WebAssembly export and import core

The editor lazily loads the upstream single-thread `@ffmpeg/core` 0.12.10 package through the MIT-licensed `@ffmpeg/ffmpeg` 0.12.15 wrapper. The combined core is GPL-2.0-or-later and is used for media decode fallback and FLAC, MP3, Ogg Vorbis, Opus, WavPack, MP2, AAC/M4A, and explicitly bounded custom output.

- package source and build scripts: <https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10>
- npm source archive: <https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz>
- npm archive integrity: `sha512-dzNplnn2Nxle2c2i2rrDhqcB19q9cglCkWnoMTDN9Q9l3PvdjZWd1HfSPjCNWc/p8Q3CT+Es9fWOR0UhAeYQZA==`
- Emscripten compiler/runtime reported by the artifact: `3.1.40` (`5c27e79dd0a9c4e27ef2326841698cdd4f6b5784`)
- packaged ESM `ffmpeg-core.wasm` SHA-256: `9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7`
- packaged ESM `ffmpeg-core.js` SHA-256: `67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3`

The exact configuration string embedded in the shipped core is:

```text
--target-os=none --arch=x86_32 --enable-cross-compile --disable-asm --disable-stripping --disable-programs --disable-doc --disable-debug --disable-runtime-cpudetect --disable-autodetect --nm=emnm --ar=emar --ranlib=emranlib --cc=emcc --cxx=em++ --objcc=emcc --dep-cc=emcc --extra-cflags='-I/opt/include -O3 -msimd128' --extra-cxxflags='-I/opt/include -O3 -msimd128' --disable-pthreads --disable-w32threads --disable-os2threads --enable-gpl --enable-libx264 --enable-libx265 --enable-libvpx --enable-libmp3lame --enable-libtheora --enable-libvorbis --enable-libopus --enable-zlib --enable-libwebp --enable-libfreetype --enable-libfribidi --enable-libass --enable-libzimg
```

That upstream build enables GPL components and the following separately licensed libraries: x264 and x265 (GPL-2.0-or-later), libvpx (BSD-3-Clause), LAME (LGPL-2.0-or-later), libtheora and libvorbis (BSD-3-Clause), libopus (BSD-3-Clause), zlib (Zlib), libwebp (BSD-3-Clause), FreeType (FTL or GPL-2.0-only), FriBidi (LGPL-2.1-or-later), libass (ISC), and zimg (WTFPL-2.0). Their copyright notices and preferred source are retained in the corresponding `v0.12.10` dependency source assembled by ffmpeg.wasm. The deployed combined core is offered under GPL-2.0-or-later; the repository's AGPL-3.0-only application is compatible with that selected GPL option.

The npm core artifacts themselves are unpatched. Local modifications are confined to `src/lib/tools/audio-editor/ffmpeg.js` and `media-export.js`: same-origin lazy loading, a serialized single-worker queue, abort handling, WORKERFS staging, codec-capability/error reporting, metadata/channel-map arguments, and rejection of extra inputs, network/file protocols, reports, and unbounded custom arguments. Vite only fingerprints and copies the package artifacts. The editor never invokes the enabled video encoders and includes no SBSMS, SoundTouch, SoX, or other time-stretch library in this core.

## Packaged browser dependencies

The browser tools can distribute the following pinned browser-side packages as part of the site build:

- `@dilsonspickles/components` 0.9.0 — declared MIT; tag `components-v0.9.0`, commit `8cb38db62436db0783cb3a7624306ab3bce19e0b`; source: <https://github.com/DilsonsPickles/audacity-design-system/tree/components-v0.9.0/packages/components>
- `@ffmpeg/ffmpeg` 0.12.15 — MIT; source: <https://github.com/ffmpegwasm/ffmpeg.wasm>
- `@ffmpeg/util` 0.12.2 — MIT; source: <https://github.com/ffmpegwasm/ffmpeg.wasm>
- `@ffmpeg/core` 0.12.10 — GPL-2.0-or-later; corresponding source and build scripts: <https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10>
- `@sqlite.org/sqlite-wasm` 3.53.0-build1 — official SQLite WebAssembly distribution; SQLite core is dedicated to the public domain; source and blessing: <https://sqlite.org/wasm/doc/trunk/index.md> and <https://sqlite.org/copyright.html>
- `fflate` 0.8.3 — MIT; source: <https://github.com/101arrowz/fflate>
- `sql.js` 1.14.1 — MIT; source: <https://github.com/sql-js/sql.js> (retained for unrelated legacy tools; AUP4 uses the official SQLite WASM package)

`@dilsonspickles/components` bundles `MusescoreIcon.ttf` from
`packages/components/src/assets/fonts/MusescoreIcon.ttf` in the tagged source
(SHA-256 `c96e13ba511bea3b12e809db0def48163a690f9e9439097d7867ae6bf04e8620`).
Upstream does not provide separate font license metadata at that tag, so it is
covered here by the package's declared MIT metadata under the project's chosen
license-review policy.

Except for identified third-party portions under compatible licenses, the repository is distributed under AGPL-3.0-only. Before deploying the FFmpeg core, the release process must archive the exact corresponding source and build configuration alongside the deployed version and verify the enabled codec libraries and their notices.
