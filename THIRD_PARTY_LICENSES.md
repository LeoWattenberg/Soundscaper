# Third-party browser runtime notices

## Audacity-derived native audio effects

Parts of `src/common/editor/audacity-effects/` are JavaScript translations and adaptations of native effect implementations from Audacity 3.7.7, exact commit `5ef610ed23260d6d648175735bb16b32536eb30b`:

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

## Audacity-derived waveform rendering

Parts of `src/common/editor/audacity-waveform-renderer.js`, the waveform-window adapters under `src/common/editor/design-system-adapters/`, and the canvas/recording-preview integration under `src/common/editor/ui/timeline/` are JavaScript and TypeScript translations and browser adaptations of Audacity waveform rendering at exact commit `908ad0a526e5bfdab68de780e893cebe172d27eb`:

- source: <https://github.com/audacity/audacity/tree/908ad0a526e5bfdab68de780e893cebe172d27eb>
- rendering-mode and sample-painter sources: `src/projectscene/view/tracksitemsview/au3/wavepainterutils.cpp`, `src/projectscene/view/tracksitemsview/au3/connectingdotspainter.cpp`, `src/projectscene/view/tracksitemsview/au3/samplespainterutils.cpp`, and `src/projectscene/view/tracksitemsview/au3/samplespainter.cpp`
- waveform-summary and bitmap-painter sources: `au3/libraries/au3-wave-track-paint/waveform/WaveDataCache.cpp` and `au3/libraries/au3-wave-track-paint/waveform/WaveBitmapCache.cpp`
- upstream license and notices: <https://github.com/audacity/audacity/blob/908ad0a526e5bfdab68de780e893cebe172d27eb/LICENSE.txt>
- selected GPLv3 terms: [`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt)

The cited Audacity files are GPL-2.0-or-later. GPL-3.0-only is selected for the adapted portions so they can be combined with this AGPL-3.0-only application under section 13 of both licenses. The Audacity-derived portions remain governed by GPLv3. Original code is copyright the Audacity Team and the individual authors named in the upstream source headers; the waveform cache sources credit Dmitry Vedenko.

The implementation was translated from C++ to JavaScript, adapted from Audacity's cached bitmap and painter infrastructure to browser canvas rendering, and integrated into Soundscaper on 2026-07-16. The distributed JavaScript source is the preferred form for modification.

## Audacity 4 parity and native AUP4 profile

The action-parity manifest, native AUP4 codec/profile implementation, compatibility fixtures, and StaffPad selection are pinned to Audacity commit `908ad0a526e5bfdab68de780e893cebe172d27eb`:

- source: <https://github.com/audacity/audacity/tree/908ad0a526e5bfdab68de780e893cebe172d27eb>
- AUP4 behavior sources: `au3/libraries/au3-project-file-io/ProjectSerializer.cpp`, `au3/libraries/au3-project-file-io/ProjectFileIO.cpp`, `au3/libraries/au3-project-file-io/SqliteSampleBlock.cpp`, and `au3/libraries/au3-realtime-effects/RealtimeEffectState.cpp`; native parameter names additionally follow the registered effect implementations under `src/effects/builtin_collection/` and `au3/libraries/au3-builtin-effects/`
- StaffPad source allowlist: `au3/libraries/au3-time-and-pitch`
- pinned Audacity-created fixtures: `src/project/tests/data/empty.aup4` SHA-256 `cb073217e4b224c4712c652d5559bc752e1d43df26114de6532fa2fb7c0def1d`, `src/project/tests/data/legacy_schema.aup4` SHA-256 `d726ad50c90df0472d567982e3706643799460e3bfb79256c30c9bd9431ef56b`, and the richer `src/trackedit/tests/data/testClipboard.aup4` SHA-256 `a8279b4573862579647b3826250d366af134ab9684fa20f409a03fd7227dba59`
- upstream license and notices: <https://github.com/audacity/audacity/blob/908ad0a526e5bfdab68de780e893cebe172d27eb/LICENSE.txt>
- selected GPLv3 terms: [`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt)

`tests/fixtures/aup4-native-empty.js`, `tests/fixtures/aup4-native-legacy.js`, `tests/fixtures/aup4-native-rich.js`, `tests/fixtures/aup4-binary-xml-oracle.js`, and `tests/fixtures/aup4-sampleblock-oracle.js` contain the compressed Audacity-created empty/legacy/rich projects and compact interoperability data derived from the pinned Audacity sources. The rich fixture exercises two tracks, five clips, group state, stretch-to-tempo state, Float32 block reuse, and byte-exact Audacity-created summaries through an Audacity-created fixture → browser decode → browser write → browser reopen cycle. That fixture-codec audit does not execute Audacity's compiled native loader or writer. The separate compiled-native round-trip release gate is recorded as pending, with its required evidence, in `tests/fixtures/aup4-interop-gate.json`; `npm run audit:aup4-interop:release` fails closed until that evidence is produced. The browser codec is a clean JavaScript adaptation with typed opaque-node preservation; no QML, wxWidgets, or other `au3/` UI code is included.

## Audacity 4 translation catalogs

Soundscaper can load selected user-interface translations from Audacity 4's Qt
TS catalogs. The catalogs are maintained by Audacity's translators through
Transifex and published by Audacity's translation workflow:

- upstream repository and workflow:
  <https://github.com/audacity/audacity/blob/master/.github/workflows/translate_tx_pull_to_s3.yml>
- upstream license: GNU GPL version 3, preserved as `LICENSE.txt` beside every
  published source artifact
- selected GPL terms for this distribution:
  [`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt)

Each promoted release at
`https://translations.soundscaper.org/runtime/translations/audacity/4/releases/`
records the exact upstream workflow run, head commit, GitHub artifact ID, source
archive byte length and SHA-256 digest, conversion revision and date. The
verified original ZIP and its commit-specific Audacity license are mirrored
beside that manifest as the preferred source for the translated material. The
manifest itself also records the `GPL-3.0-only` SPDX identifier, upstream and
Soundscaper project URLs, the commit-specific license URL, and a stable
modification notice.

Soundscaper modifies the catalogs by selecting reviewed source/context/comment
mappings, excluding unfinished, vanished, obsolete, plural, fuzzy, ambiguous,
or brand-inappropriate entries, adapting reviewed placeholders and mnemonics,
and removing ellipsis punctuation from displayed translations. The resulting
per-locale JSON packs contain only strings mapped to Soundscaper catalog keys;
they are not complete Audacity catalogs. Audacity and its translators retain
copyright in the upstream translations, and those derived packs remain under
GPLv3. Soundscaper is not affiliated with or endorsed by Audacity or Muse Group.

The credential-free conversion job uses `saxes` 6.0.0 (ISC) and its
`xmlchars` 2.2.0 dependency (MIT) to parse Qt TS XML. Both are development-time tools and
are not included in the browser bundle. Their package sources and license texts
are available from <https://github.com/lddubeau/saxes/tree/v6.0.0> and
<https://github.com/lddubeau/xmlchars/tree/v2.2.0>.

## StaffPad time-and-pitch WebAssembly

The committed scalar, single-threaded StaffPad module and its preferred source are in `src/common/editor/staffpad/`:

- Audacity revision: `908ad0a526e5bfdab68de780e893cebe172d27eb`; GPL-2.0-or-later with GPLv3 selected for this distribution
- PFFFT revision: `09796885cd5b`; archive SHA-256 `fdc80563de8c31d6380886bc1ba0ffb897abde58611707ac94eb8edab850cbb`; UCAR/NCAR permissive license
- Audacity/Muse dependency patch: muse_deps revision `adcefed921921cb090110b4a71a91966c1306889`; patch SHA-256 `e1e44efe52192f9ae919442a8a282b32679ed94d8a6351b084f7a3a4d07e613c`
- Emscripten toolchain/runtime: `3.1.64`, including the retained musl, libc++, libc++abi, and compiler-rt notices
- committed `staffpad.wasm` SHA-256: `6b7e3fa86ddd90ddd6c358cf431742bd890fb76354509aa5732e4d3686791b7b`

The exact allowlist, per-file hashes, imports, exports, toolchain image, modifications, and license-file hashes are recorded in [`source-manifest.json`](src/common/editor/staffpad/source-manifest.json). Detailed notices are in [`NOTICE.md`](src/common/editor/staffpad/NOTICE.md). Rebuild with `npm run build:staffpad`; verify sources, binary imports, the absence of prohibited library symbols, and the artifact hash with `npm run audit:staffpad`.

Audacity is a registered trademark. This project is not affiliated with or endorsed by the Audacity project or Muse Group.

## FFmpeg WebAssembly export and import core

The editor lazily loads the upstream single-thread `@ffmpeg/core` 0.12.10 package through the MIT-licensed `@ffmpeg/ffmpeg` 0.12.15 wrapper. The combined core is GPL-2.0-or-later and is used for media decode fallback and FLAC, MP3, Ogg Vorbis, Opus, WavPack, MP2, AAC/M4A, and explicitly bounded custom output.

- package source and build scripts: <https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15>
- npm source archive: <https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz>
- npm archive integrity: `sha512-dzNplnn2Nxle2c2i2rrDhqcB19q9cglCkWnoMTDN9Q9l3PvdjZWd1HfSPjCNWc/p8Q3CT+Es9fWOR0UhAeYQZA==`
- Emscripten compiler/runtime reported by the artifact: `3.1.40` (`5c27e79dd0a9c4e27ef2326841698cdd4f6b5784`)
- packaged ESM `ffmpeg-core.wasm` SHA-256: `9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7`
- packaged ESM `ffmpeg-core.js` SHA-256: `67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3`

The exact configuration string embedded in the shipped core is:

```text
--target-os=none --arch=x86_32 --enable-cross-compile --disable-asm --disable-stripping --disable-programs --disable-doc --disable-debug --disable-runtime-cpudetect --disable-autodetect --nm=emnm --ar=emar --ranlib=emranlib --cc=emcc --cxx=em++ --objcc=emcc --dep-cc=emcc --extra-cflags='-I/opt/include -O3 -msimd128' --extra-cxxflags='-I/opt/include -O3 -msimd128' --disable-pthreads --disable-w32threads --disable-os2threads --enable-gpl --enable-libx264 --enable-libx265 --enable-libvpx --enable-libmp3lame --enable-libtheora --enable-libvorbis --enable-libopus --enable-zlib --enable-libwebp --enable-libfreetype --enable-libfribidi --enable-libass --enable-libzimg
```

That upstream build enables GPL components and the following separately licensed libraries: x264 and x265 (GPL-2.0-or-later), libvpx (BSD-3-Clause), LAME (LGPL-2.0-or-later), libtheora and libvorbis (BSD-3-Clause), libopus (BSD-3-Clause), zlib (Zlib), libwebp (BSD-3-Clause), FreeType (FTL or GPL-2.0-only), FriBidi (LGPL-2.1-or-later), libass (ISC), and zimg (WTFPL-2.0). The upstream build recipe identifies their licenses and preferred source locations, but fetches dependency sources during the build and does not vendor the exact complete source snapshot used for the npm core. This missing provenance is why desktop binary publication remains gated below. The combined core is offered under GPL-2.0-or-later; the repository's AGPL-3.0-only application is compatible with that selected GPL option.

The npm core artifacts themselves are unpatched. Local integration is confined to `src/common/editor/ffmpeg.js`, `media-export.js`, and `video-ffmpeg.js`: same-origin lazy loading, a serialized single-worker queue, abort handling, WORKERFS staging, codec-capability/error reporting, metadata/channel-map arguments, deterministic timeline composition, and rejection of extra inputs, network/file protocols, reports, and unbounded custom arguments. Vite only fingerprints and copies the package artifacts. Video export invokes the enabled x264 encoder for MP4 or libvpx-vp9 for WebM, with AAC or libopus audio respectively; it does not invoke x265. The editor includes no SBSMS, SoundTouch, SoX, or other time-stretch library in this core.

`desktop/ffmpeg-corresponding-source.json` currently pins an FFmpeg source
archive and the `v12.15` ffmpeg.wasm build-source archive. It does not inventory
or pin complete corresponding source for every enabled external library.
Release tooling validates those descriptors, and the checked-in runtime policy
manifest hashes them to reject provenance drift, but neither check establishes
corresponding-source completeness. Public desktop release and qualified Web
runtime distribution therefore remain blocked by the licensing matrix.

## Video-effect behavioral references

Soundscaper's clip video effects are independently authored AGPL-3.0-only
WebGL shaders and bounded FFmpeg filter plans. No MLT, GStreamer, frei0r,
OpenFX, or GStreamer plug-in source code or binaries are included.

The initial effect inventory and parameter behavior were researched against:

- MLT `v7.40.0`: <https://github.com/mltframework/mlt/tree/v7.40.0>;
  project license policy: <https://www.mltframework.org/docs/copyrightpolicy/>.
- GStreamer `1.28.5`: <https://gitlab.freedesktop.org/gstreamer/gstreamer/-/tree/1.28.5>;
  project licensing FAQ:
  <https://gstreamer.freedesktop.org/documentation/frequently-asked-questions/licensing.html>.
- FFmpeg filter behavior shipped through the separately noticed
  `@ffmpeg/core` `0.12.10` runtime above:
  <https://ffmpeg.org/ffmpeg-filters.html>.

MLT and GStreamer are catalog and behavior references only. Any future reuse
or close translation of their source, modules, shaders, metadata, or plug-ins
requires a new per-file copyright and license audit, retained notices, exact
source pinning, and an update to this document before distribution.

## Desktop runtime and build tooling

- Electron 43.1.1 — MIT; source: <https://github.com/electron/electron/tree/v43.1.1>. Packaged desktop applications include Electron's license and `LICENSES.chromium.html`, which carries Chromium and bundled component notices.
- electron-builder 26.15.6 — MIT; build-time packaging tool, not part of the application runtime; exact npm source package: <https://registry.npmjs.org/electron-builder/-/electron-builder-26.15.6.tgz> (`sha512-jxlHRjqYrlTgLVo/aoACGpiki3QFYv8s4f2djsqaEbwTBZ9PcTBK03Tj/HMa65kiE0hdZxxbZdmVFo22eou2wA==`); upstream repository: <https://github.com/electron-userland/electron-builder>.
- `@electron/fuses` 2.1.3 — MIT; build-time hardening tool used to disable unsafe Electron runtime switches before signing; source: <https://github.com/electron/fuses/tree/v2.1.3>.
- `@resvg/resvg-js` 2.6.2 — MPL-2.0; unmodified build-time rasterizer used only to derive platform icons from the existing Soundscaper SVG mark; source: <https://github.com/yisibl/resvg-js/tree/v2.6.2>.

Electron and its embedded Chromium/Node.js runtime are shipped only in desktop
artifacts. Build-only packaging and icon tools are not shipped. Soundscaper does
not modify these packages; their installed license files and upstream source are
available from the pinned links above.

## Nightly-with-tests diagnostic tooling

The opt-in `nightly-with-tests` CI artifact is a diagnostic test runner, not a
normal desktop package or public release. It additionally distributes the
following pinned tools solely so the extracted application can run its bundled
browser workflows without an npm installation:

- `@playwright/test` 1.61.1, `playwright` 1.61.1, and `playwright-core` 1.61.1 — Apache-2.0; Copyright Microsoft Corporation; source: <https://github.com/microsoft/playwright/tree/v1.61.1>
- `@axe-core/playwright` 4.12.1 and `axe-core` 4.12.1 — MPL-2.0; Copyright Deque Systems, Inc.; source: <https://github.com/dequelabs/axe-core/tree/v4.12.1>
- WinLDD `PrintDeps.exe` (Playwright revision 1007) — MIT; Copyright (c) 2020 Julien Waechter; source and embedded license header: <https://github.com/microsoft/playwright/blob/v1.61.1/browser_patches/winldd/PrintDeps.cpp>; binary-only archive recipe: <https://github.com/microsoft/playwright/blob/v1.61.1/browser_patches/winldd/archive.sh>; bundled terms: [`LICENSES/Playwright-winldd-MIT.txt`](LICENSES/Playwright-winldd-MIT.txt)
- `esbuild` 0.28.1 — MIT; Copyright (c) 2020 Evan Wallace; source: <https://github.com/evanw/esbuild/tree/v0.28.1>; the browser specs compile the TypeScript sources they serve to each engine. Each package targets exactly one platform, so the artifact carries only the `@esbuild/<platform>-<architecture>` 0.28.1 binary package its own target runs, under the same MIT terms and the `esbuild` `LICENSE.md` staged beside it
- `typescript` 6.0.3 — Apache-2.0; Copyright Microsoft Corporation; source: <https://github.com/microsoft/TypeScript/tree/v6.0.3>

Playwright's pinned browser inventory for that artifact identifies
Chrome for Testing 149.0.7827.55 (Playwright revision 1228),
Firefox 151.0 (Playwright revision 1532), and
WebKit 26.5 (Playwright revision 2311). Platform-specific revision
overrides remain recorded in the distributed `playwright-core/browsers.json`.
The downloaded archives retain the license and notice material they provide,
including Chromium's component notices and Playwright's LGPL-2.1 FFmpeg copy;
the corresponding Playwright browser patches and build scripts are at
<https://github.com/microsoft/playwright/tree/v1.61.1/browser_patches>.

The artifact also retains each staged npm package's installed `LICENSE`,
`NOTICE`, and third-party-notice files. This deliberately broader diagnostic
distribution does not change the dependency surface of the normal Soundscaper
or Framescaper desktop executables.

## Packaged browser dependencies

The browser tools can distribute the following pinned browser-side packages as part of the site build:

- Audacity design system (vendored in-tree at `vendor/audacity-design-system/`) — `@dilsonspickles/components` 0.9.0, `@audacity-ui/core` 0.1.0, `@audacity-ui/tokens` 0.1.0 — declared MIT in each package manifest (the upstream repository ships no LICENSE file); vendored from tag `components-v0.9.0`, commit `8cb38db62436db0783cb3a7624306ab3bce19e0b`; source: <https://github.com/DilsonsPickles/audacity-design-system/tree/components-v0.9.0/packages>; local modifications are recorded in `vendor/audacity-design-system/README.md` and the pinned upstream revision in `vendor/audacity-design-system/UPSTREAM` (verified by `check:notices`)
- Roseus colormap — MIT; Copyright © dofuuz; the 256-entry colormap table embedded in `vendor/audacity-design-system/components/src/utils/spectrogram.ts`; source: <https://github.com/dofuuz/roseus>
- `@fontsource/inter` 5.3.0 — SIL Open Font License 1.1; self-hosted WOFF/WOFF2 distribution of Inter, Copyright 2016 The Inter Project Authors; source metadata and font files: <https://github.com/fontsource/font-files/tree/main/fonts/google/inter>; upstream font source: <https://github.com/rsms/inter>; full license text is retained in the installed package's `LICENSE` file
- `@fontsource/ubuntu` 5.3.0 — Ubuntu Font Licence 1.0; self-hosted WOFF/WOFF2 distribution of Ubuntu, Copyright 2010-2011 Canonical Ltd.; source metadata and font files: <https://github.com/fontsource/font-files/tree/main/fonts/google/ubuntu>; upstream font source: <https://launchpad.net/ubuntu-font-family>; full license text is retained in the installed package's `LICENSE` file
- `@ffmpeg/ffmpeg` 0.12.15 — MIT; source: <https://github.com/ffmpegwasm/ffmpeg.wasm>
- `@ffmpeg/types` 0.12.4 — MIT; transitive type definitions used by the FFmpeg wrapper and not emitted as runtime JavaScript; source: <https://github.com/ffmpegwasm/ffmpeg.wasm>
- `@ffmpeg/core` 0.12.10 — GPL-2.0-or-later; build scripts and upstream source references: <https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15>; a complete corresponding-source snapshot for the exact npm binary remains required by the release gate above
- `@sqlite.org/sqlite-wasm` 3.53.0-build1 — official SQLite WebAssembly distribution; SQLite core is dedicated to the public domain; source and blessing: <https://sqlite.org/wasm/doc/trunk/index.md> and <https://sqlite.org/copyright.html>
- `@zip.js/zip.js` 2.8.33 — BSD-3-Clause; Copyright © 2023 Gildas Lormeau; source and license: <https://github.com/gildas-lormeau/zip.js/tree/v2.8.33>
- `@noble/hashes` 2.2.0 — MIT; Copyright © 2022 Paul Miller; source and license: <https://github.com/paulmillr/noble-hashes/tree/2.2.0>
- `fflate` 0.8.3 — MIT; source: <https://github.com/101arrowz/fflate>
- `@echogarden/pffft-wasm` 0.4.2 — UCAR/NCAR permissive license; SIMD WebAssembly build of PFFFT used by spectrograms, spectral editing, and FFT-based effects; source: <https://github.com/echogarden-project/pffft-wasm>
- `react` 19.2.7 — MIT; Copyright © Meta Platforms, Inc. and affiliates; source and license: <https://github.com/facebook/react/tree/v19.2.7/packages/react>
- `react-dom` 19.2.7 — MIT; Copyright © Meta Platforms, Inc. and affiliates; source and license: <https://github.com/facebook/react/tree/v19.2.7/packages/react-dom>
- `scheduler` 0.27.0 — MIT; transitive React scheduler runtime; Copyright © Meta Platforms, Inc. and affiliates; source and license: <https://github.com/facebook/react/tree/v19.2.7/packages/scheduler>
- `sql.js` 1.14.1 — MIT; source: <https://github.com/sql-js/sql.js> (retained for unrelated legacy tools; AUP4 uses the official SQLite WASM package)

## Optional local assistance runtime

The optional on-device assistance features load their speech runtime from
`sherpa-onnx-node`, declared as an optional dependency so the editor installs,
builds, and runs without it. It is not staged into any distributed package
today; when a milestone-7 slice stages its platform binaries, the matrix rows
gain their artifact surfaces and this notice gains the shipped file inventory.

- `sherpa-onnx-node` 1.13.5 — Apache-2.0; Next-gen Kaldi speech runtime;
  source and license: <https://github.com/k2-fsa/sherpa-onnx>
- `sherpa-onnx-darwin-arm64` 1.13.5 — Apache-2.0; prebuilt platform binary;
  source and license: <https://github.com/k2-fsa/sherpa-onnx>
- `sherpa-onnx-darwin-x64` 1.13.5 — Apache-2.0; prebuilt platform binary;
  source and license: <https://github.com/k2-fsa/sherpa-onnx>
- `sherpa-onnx-linux-arm64` 1.13.5 — Apache-2.0; prebuilt platform binary;
  source and license: <https://github.com/k2-fsa/sherpa-onnx>
- `sherpa-onnx-linux-x64` 1.13.5 — Apache-2.0; prebuilt platform binary;
  source and license: <https://github.com/k2-fsa/sherpa-onnx>
- `sherpa-onnx-win-ia32` 1.13.5 — Apache-2.0; prebuilt platform binary;
  source and license: <https://github.com/k2-fsa/sherpa-onnx>
- `sherpa-onnx-win-x64` 1.13.5 — Apache-2.0; prebuilt platform binary;
  source and license: <https://github.com/k2-fsa/sherpa-onnx>

Upstream publishes no `win32-arm64` prebuild, so Windows on ARM reports the
assistance models as unsupported rather than installing a binary that cannot
load.

Model weights are separately downloaded, never bundled, and each is recorded in
`config/production-licensing-matrix.json`. A model is listed below only once its
artifacts are mirrored and pinned; the rest remain undistributable and unlisted.

### Mirrored assistance models

Each model below is served from the product store at a versioned key and was verified byte for byte against these digests after publication.

- Silero VAD 6.2.1 — MIT; Copyright © Silero Team; voice activity detection;
  source and license: <https://github.com/snakers4/silero-vad/tree/7e30209a3e901f9842f81b225f3e93d8199902b1>.
  Not to be confused with the `silero-models` repository, which is a separate project under different terms and is not a source here.
  Mirrored artifacts:
  - `silero_vad.onnx`, 2,327,524 bytes, SHA-256
    `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`

- NVIDIA Parakeet TDT 0.6b v2 — CC-BY-4.0 (weights), Apache-2.0 (NeMo code); Copyright © NVIDIA Corporation; English speech recognition with word timestamps;
  source and license: <https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2>.
  Attribution to NVIDIA is required by CC-BY-4.0. ONNX export mirrored from <https://huggingface.co/istupakov/parakeet-tdt-0.6b-v2-onnx>.
  Mirrored artifacts:
  - `encoder.int8.onnx`, 652,184,296 bytes, SHA-256
    `a32b12d17bbbc309d0686fbbcc2987b5e9b8333a7da83fa6b089f0a2acd651ab`
  - `decoder.int8.onnx`, 7,257,753 bytes, SHA-256
    `b6bb64963457237b900e496ee9994b59294526439fbcc1fecf705b31a15c6b4e`
  - `joiner.int8.onnx`, 1,739,080 bytes, SHA-256
    `7946164367946e7f9f29a122407c3252b680dbae9a51343eb2488d057c3c43d2`
  - `tokens.txt`, 9,384 bytes, SHA-256
    `ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d`

- NVIDIA Parakeet TDT 0.6b v3 — CC-BY-4.0 (weights), Apache-2.0 (NeMo code); Copyright © NVIDIA Corporation; speech recognition across 25 European languages;
  source and license: <https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3>.
  Attribution to NVIDIA is required by CC-BY-4.0. ONNX export mirrored from <https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx>.
  Mirrored artifacts:
  - `encoder.int8.onnx`, 652,184,281 bytes, SHA-256
    `acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247`
  - `decoder.int8.onnx`, 11,845,275 bytes, SHA-256
    `179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e`
  - `joiner.int8.onnx`, 6,355,277 bytes, SHA-256
    `3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3`
  - `tokens.txt`, 93,939 bytes, SHA-256
    `d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d`

- OpenAI Whisper large-v3-turbo (GGML q5_0) — MIT; Copyright © OpenAI; multilingual speech recognition;
  source and license: <https://huggingface.co/openai/whisper-large-v3-turbo>.
  GGML conversion mirrored from <https://huggingface.co/ggerganov/whisper.cpp> (MIT).
  Mirrored artifacts:
  - `ggml-large-v3-turbo-q5_0.bin`, 574,041,195 bytes, SHA-256
    `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`

- pyannote segmentation 3.0 — MIT; Copyright © Hervé Bredin and contributors; speaker segmentation for diarization;
  source and license: <https://huggingface.co/pyannote/segmentation-3.0>.
  The upstream repository is access-gated, so the artifact is mirrored from the redistributed ONNX conversion at <https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0>; its LICENSE file is mirrored beside the weights.
  Mirrored artifacts:
  - `model.onnx`, 5,992,913 bytes, SHA-256
    `220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079`
  - `LICENSE`, 1,061 bytes, SHA-256
    `14d7016ad68e7394d6e6b78d96cc2ae431c905287b89674cfdf021e79e62b8ba`

- 3D-Speaker ERes2Net (VoxCeleb, 16 kHz) — Apache-2.0; Copyright © Alibaba Group; speaker embeddings for diarization clustering;
  source and license: <https://github.com/modelscope/3D-Speaker>.
  ONNX export mirrored from <https://huggingface.co/csukuangfj/speaker-embedding-models>.
  Mirrored artifacts:
  - `3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx`, 26,485,263 bytes, SHA-256
    `c59158379255ad66e161679cca6af8d52d51e389e3224ab7d7a7baae295c2db5`

- DeepFilterNet3 — MIT OR Apache-2.0; Copyright © Hendrik Schröter and contributors; full-band speech denoise;
  source and license: <https://github.com/Rikorose/DeepFilterNet>.
  ONNX export mirrored from <https://huggingface.co/soniqo/DeepFilterNet3-ONNX>.
  Mirrored artifacts:
  - `deepfilter.onnx`, 8,608,859 bytes, SHA-256
    `e1157049059434ae0d5857e32c812abea227b975e946b2eb64d001abbce156d3`
  - `deepfilter-auxiliary.bin`, 126,976 bytes, SHA-256
    `47e84480f823ab95bee69d9f8a2344074e3d8e7dbb4370d44785b91698a4dca1`
  - `config.json`, 370 bytes, SHA-256
    `0f1cbfa0a0a5b9770e905cbcacb7a03340daaf1498d34435a51916ef58439bb6`

- YuNet (2026may) — MIT; Copyright © Shiqi Yu; face detection for reframe proposals;
  source and license: <https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet>.
  The model directory carries its own MIT license, which governs these weights; the repository-wide Apache-2.0 covers the zoo's harness code.
  Used for detection only: no face recognition, identification, or clustering is built on it.
  Mirrored artifacts:
  - `face_detection_yunet_2026may.onnx`, 229,738 bytes, SHA-256
    `ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0`

- D-FINE-N (COCO) — Apache-2.0; Copyright © Yansong Peng and contributors; person and object detection;
  source and license: <https://github.com/Peterande/D-FINE>.
  Checkpoint conversion at <https://huggingface.co/ustc-community/dfine-nano-coco>; ONNX export mirrored from <https://huggingface.co/onnx-community/dfine_n_coco-ONNX>, which declares that conversion as its base model.
  Mirrored artifacts:
  - `model.onnx`, 15,258,358 bytes, SHA-256
    `0f684f409618ee8a822410e754a29caa817d1aa16283ce89cad936d0a48e2f35`
  - `config.json`, 6,597 bytes, SHA-256
    `a5c7533f3b72be6bb102b93e1b34ca3643af4e0590408a7881543cbb0aa80c4c`
  - `preprocessor_config.json`, 444 bytes, SHA-256
    `cd38cd59999e7a95d68e487fbe5132df3d4e5c32a0836add57e6126ba0c4eaf1`

- U²-Net-P — Apache-2.0; Copyright © Xuebin Qin and contributors; saliency fallback for reframe proposals;
  source and license: <https://github.com/xuebinqin/U-2-Net>.
  ONNX conversion redistributed by <https://github.com/danielgatis/rembg> (MIT), which credits the upstream work and adds no terms of its own to the weights.
  Mirrored artifacts:
  - `u2netp.onnx`, 4,574,861 bytes, SHA-256
    `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`

- PP-OCRv4 mobile — Apache-2.0; Copyright © PaddlePaddle Authors; on-screen text recognition;
  source and license: <https://github.com/PaddlePaddle/PaddleOCR>.
  ONNX conversions mirrored from <https://huggingface.co/SWHL/RapidOCR>; the character dictionary is taken from PaddleOCR at commit `2661c7c0ef5c613e8f93c6e93b2e052399f0f854`.
  Mirrored artifacts:
  - `text_detection.onnx`, 4,745,517 bytes, SHA-256
    `d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9`
  - `text_recognition.onnx`, 10,857,958 bytes, SHA-256
    `48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b`
  - `text_orientation.onnx`, 585,532 bytes, SHA-256
    `e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c`
  - `character_dictionary.txt`, 26,250 bytes, SHA-256
    `a1c84d9bdb9ab29043c58896224d32941783eb821629618416dcb08f12886492`

- nomic-embed-text-v1.5 — Apache-2.0; Copyright © Nomic AI; transcript embeddings for semantic search;
  source and license: <https://huggingface.co/nomic-ai/nomic-embed-text-v1.5>.
  The ONNX export is published by the licence holder alongside the original weights.
  Mirrored artifacts:
  - `model_quantized.onnx`, 137,296,292 bytes, SHA-256
    `b4342336debaea79de872370664b0aaeb67dea4605513d00ee236ea871a81f27`
  - `tokenizer.json`, 711,396 bytes, SHA-256
    `d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66`
  - `tokenizer_config.json`, 1,191 bytes, SHA-256
    `d7e0000bcc80134debd2222220427e6bf5fa20a669f40a0d0d1409cc18e0a9bc`
  - `special_tokens_map.json`, 695 bytes, SHA-256
    `5d5b662e421ea9fac075174bb0688ee0d9431699900b90662acd44b2a350503a`
  - `config.json`, 2,538 bytes, SHA-256
    `9ab00bd92cee80a569f708140b7b6c1661a65891ff3765b1519e181ba2f2c92b`

- SigLIP 2 base patch16-224 — Apache-2.0; Copyright © Google LLC; frame semantics and visual search;
  source and license: <https://huggingface.co/google/siglip2-base-patch16-224>.
  ONNX export mirrored from <https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX>, which declares the upstream repository as its base model.
  Mirrored artifacts:
  - `vision_model_int8.onnx`, 94,553,333 bytes, SHA-256
    `0dd31785a2713f1113ef2272472165c69d580473dae38d7b47568ac587795e70`
  - `text_model_int8.onnx`, 283,438,275 bytes, SHA-256
    `3a0603d3a00c05a80a6ded4743c16aaac7b1e62cdcc7e362e7ce418659b96400`
  - `tokenizer.json`, 34,363,039 bytes, SHA-256
    `cb9140fae3ac5122c972d37adf83e1248471a38147ad76f8215c8872c6fd8322`
  - `config.json`, 435 bytes, SHA-256
    `e43a9f7692d3819886a82cb2097048258d444f123c67d37ec825f9345b019cf2`
  - `preprocessor_config.json`, 394 bytes, SHA-256
    `9b36b57ebaf20f09bf4c22100ccc21877ea6bfe5aead0c00c59f8af8ccefacfc`

The vendored design system bundles `MusescoreIcon.ttf` at
`vendor/audacity-design-system/components/src/assets/fonts/MusescoreIcon.ttf`
(SHA-256 `c96e13ba511bea3b12e809db0def48163a690f9e9439097d7867ae6bf04e8620`,
byte-identical to `packages/components/src/assets/fonts/MusescoreIcon.ttf` at
the vendored tag). Upstream does not provide separate font license metadata at
that tag, so it is covered here by the package's declared MIT metadata under
the project's chosen license-review policy.

The browser editor also ports the MuseScore framework icon-code inventory from
`framework/ui/view/iconcodes.h` at MuseScore framework commit
`3e6bfd62701992303dc22f1bae6f81bde1670ef9` (GPL-3.0-only). The port retains the
upstream notice and source hash in
`src/common/editor/audacity-iconcodes.js`.

Except for identified third-party portions under compatible licenses, the repository is distributed under AGPL-3.0-only. Before deploying the FFmpeg core, the release process must archive the exact corresponding source and build configuration alongside the deployed version and verify the enabled codec libraries and their notices.
