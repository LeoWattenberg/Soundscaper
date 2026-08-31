# Third-party browser runtime notices

## Soundscaper professional-native desktop payload

Stable Soundscaper desktop packages carry a closed, target-specific notice
inventory under `licenses/professional-native/`. The exact filenames, byte
lengths, SHA-256 digests, source targets, and selected license arms are recorded
in [`config/soundscaper-professional-native-notices.json`](config/soundscaper-professional-native-notices.json):

- Electron 43.1.1 Node-API headers — MIT; all five targets
- JUCE 9.0.1 — AGPL-3.0-only selected; all five targets
- CLAP 1.2.4 — MIT; all five targets
- VST3 SDK 3.8.0 build 66 — MIT; all five targets
- ASIO SDK 2.3.4 — GPL-3.0-only selected; Windows x64 and ARM64 only
- LV2 1.18.10 — ISC; Linux x64 and ARM64 only

The Stable release inventory includes the exact six authenticated upstream
source archives and a canonical compliance receipt binding them to all five
packaged runtime manifests and their source-authentication receipts. No
Framescaper video-codec source enters that inventory. This checked technical
inventory does not claim legal, trademark, or patent clearance beyond the
recorded owner review.

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

## libFLAC 1.5.0 WebAssembly

Soundscaper distributes one exact memory-only Emscripten build of libFLAC
1.5.0 under the BSD-3-Clause license in the Web and Electron renderer. The same
bytes are also staged as the desktop bundled `.flac` encode/decode provider on
Linux x64/ARM64, macOS ARM64, and Windows x64/ARM64. macOS x64 is unsupported.

- upstream: <https://github.com/xiph/flac/tree/1.5.0>
- pinned commit: `1507800de4b70e21be71f38caa0d9079d0bc6e45`
- source archive SHA-256: `f2c1c76592a82ffff8413ba3c4a1299b6c7ab06c734dee03fd88630485c2b920`
- retained license: [`licenses/FLAC.txt`](src/common/editor/flac/licenses/FLAC.txt)
- detailed notice: [`NOTICE.md`](src/common/editor/flac/NOTICE.md)
- source/build manifest: [`source-manifest.json`](src/common/editor/flac/source-manifest.json)
- exact `flac.wasm`: 153,076 bytes; SHA-256 `0f703571f95e37c24ad68577163ea56b4a9dd7d5576760700b482369e924f986`

The build contains the libFLAC stream encoder/decoder core and exposes only a
bounded memory ABI. File access, Ogg framing, metadata mutation,
architecture-specific SIMD, and threads are disabled. Desktop staging and
startup recheck the artifact length and digest, and startup runs an
encode/decode canary before registering the provider. The decoder validates
bounded STREAMINFO geometry and relies on libFLAC's frame CRC and stream MD5
checks. Encoding clamps float32 input to the unit PCM range and quantizes it to
signed 24-bit PCM; the resulting FLAC is lossless over that explicit integer
representation, not float-exact. The BSD-3-Clause license and technical review
do not establish absence of patent exposure or patent clearance.

## libopus 1.6.1 and libogg 1.3.6 WebAssembly

Soundscaper distributes one exact memory-only Emscripten build of libopus
1.6.1 and libogg 1.3.6 in the Web and Electron renderer. The same bytes are also
staged as the desktop bundled Ogg Opus encode/decode provider on Linux
x64/ARM64, macOS ARM64, and Windows x64/ARM64. macOS x64 is unsupported.

- libopus upstream: <https://github.com/xiph/opus/tree/v1.6.1>
- pinned libopus commit: `22244de5a79bd1d6d623c32e72bf1954b56235be`
- libopus source archive SHA-256: `6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1`
- libogg upstream: <https://github.com/xiph/ogg/tree/v1.3.6>
- pinned libogg commit: `be05b13e98b048f0b5a0f5fa8ce514d56db5f822`
- libogg source archive SHA-256: `5c8253428e181840cd20d41f3ca16557a9cc04bad4a3d04cce84808677fa1061`
- retained terms: [`OPUS.txt`](src/common/editor/opus/licenses/OPUS.txt) and
  [`OGG.txt`](src/common/editor/opus/licenses/OGG.txt)
- detailed notice: [`NOTICE.md`](src/common/editor/opus/NOTICE.md)
- source/build manifest: [`source-manifest.json`](src/common/editor/opus/source-manifest.json)
- exact `opus.wasm`: 385,789 bytes; SHA-256
  `c4c9f7ac85071b24b2545f966943c4319fff023a65c899146cfcb016ae0a8853`

The admitted public profile is Ogg Opus at the mandatory 48 kHz presentation
rate, mapping family 0 mono or stereo, zero output gain, fixed 20 ms packets,
and 16–256 kbit/s encoding. A strict bounded parser verifies Ogg CRC, serial,
sequence, lacing, continuation, BOS/EOS, OpusHead/OpusTags, packet duration,
pre-skip, and final granule trimming. Valid wider profiles fall through;
malformed streams are terminal. Staging and startup independently recheck the
artifact length and digest, and startup runs a lossy encode/parse/decode canary.
Opus preserves the declared frame geometry through pre-skip and final-granule
trimming but is not sample-exact.

The libopus license notice records upstream royalty-free patent-license
disclosures from Xiph.Org, Microsoft, and Broadcom. Those disclosures, the
BSD-style copyright licenses, and this technical review do not establish patent
clearance or non-infringement for any use or territory.

## libvorbis 1.3.7 and libogg 1.3.6 WebAssembly

Soundscaper distributes one exact memory-only Emscripten build of libvorbis
1.3.7 and libogg 1.3.6 under their retained BSD-style terms in the Web and
Electron renderer. The same bytes are also staged as the desktop bundled Ogg
Vorbis encode/decode provider on Linux x64/ARM64, macOS ARM64, and Windows
x64/ARM64. macOS x64 is unsupported.

- libvorbis upstream: <https://gitlab.xiph.org/xiph/vorbis/-/tree/v1.3.7>
- pinned libvorbis commit: `0657aee69dec8508a0011f47f3b69d7538e9d262`
- libvorbis source archive SHA-256: `b33cc4934322bcbf6efcbacf49e3ca01aadbea4114ec9589d1b1e9d20f72954b`
- libogg upstream: <https://gitlab.xiph.org/xiph/ogg/-/tree/v1.3.6>
- pinned libogg commit: `be05b13e98b048f0b5a0f5fa8ce514d56db5f822`
- libogg source archive SHA-256: `5c8253428e181840cd20d41f3ca16557a9cc04bad4a3d04cce84808677fa1061`
- retained terms: [`VORBIS.txt`](src/common/editor/vorbis/licenses/VORBIS.txt) and
  [`OGG.txt`](src/common/editor/vorbis/licenses/OGG.txt)
- detailed notice: [`NOTICE.md`](src/common/editor/vorbis/NOTICE.md)
- source/build manifest: [`source-manifest.json`](src/common/editor/vorbis/source-manifest.json)
- exact `vorbis.wasm`: 523,227 bytes; SHA-256
  `c03037c33f35dbf85e1e963058156399b995b2dedb5479f6eb3f3b30148eeee5`

The admitted public profile is a single Ogg Vorbis logical stream, mono or
stereo, at the contract's 8–192 kHz sample rates with integer quality settings
0–10. A strict bounded parser validates Ogg framing, CRC, continuity, headers,
comments, granules, EOS, and source geometry before libvorbisfile independently
probes and decodes the stream. Valid wider profiles fall through; malformed
streams are terminal. Staging and startup independently recheck the artifact
length and digest, and startup runs a lossy encode/parse/probe/decode canary.
Vorbis preserves decoded frame geometry but is not sample-exact. The BSD-style
copyright licenses and this technical review do not establish patent clearance
or non-infringement for any use or territory.

## LAME 4.0 WebAssembly

Soundscaper distributes one exact Emscripten build of the LAME 4.0
`libmp3lame` encoder under LGPL-2.0-or-later terms in the Web and Electron
renderer. The same bytes are also staged as the desktop bundled MP3 encode
provider on Linux x64/ARM64, macOS ARM64, and Windows x64/ARM64. macOS x64 is
unsupported. No LAME decoder, command-line frontend, filesystem, network,
thread, SIMD, or VBR support is included.

- official upstream release: <https://lame.sourceforge.io/>
- exact source archive: <https://downloads.sourceforge.net/project/lame/lame/4.0/lame-4.0.tar.gz>
- source archive SHA-256:
  `3df5124d5ad3a98312ffd7ba6a9b36230e4f8a3e66d3ce0f425e336c32d216eb`
- retained terms: [`LAME.txt`](src/common/editor/lame/licenses/LAME.txt) and
  [`LGPL-2.0.txt`](src/common/editor/lame/licenses/LGPL-2.0.txt)
- detailed notice: [`NOTICE.md`](src/common/editor/lame/NOTICE.md)
- source/build manifest: [`source-manifest.json`](src/common/editor/lame/source-manifest.json)
- exact `lame.wasm`: 212,205 bytes; SHA-256
  `654d08f946851134755513c8c0cd4486e8c9d2024df2318dc48b262e4ad7a502`

The admitted profile is MPEG-1 Layer III CBR at 32, 44.1, or 48 kHz, mono or
stereo, for the exact bitrate tuples accepted by the request preflight. A
strict bounded MPEG inspector validates every output frame and requires the
LAME gapless delay/padding tag. Run `npm run build:lame` to reproduce the
artifact and `npm run audit:lame` to recheck source identity, retained terms,
archive members, build constraints, WebAssembly authority, memory limits, and
the encode/decode canary. LAME-to-mpg123 interoperability tests verify the
decoded frame count and a bounded lossy signal-to-noise floor. These license,
identity, and technical checks do not establish patent clearance or
non-infringement for any use or territory.

## mpg123 1.33.7 WebAssembly

Soundscaper distributes one exact memory-fed Emscripten build of the reusable
libmpg123 decoder from mpg123 1.33.7 under LGPL-2.1-only terms in the Web and
Electron renderer. The same bytes are also staged as the desktop bundled
MPEG-1 Layer II (MP2) and Layer III (MP3) decode provider on Linux x64/ARM64,
macOS ARM64, and Windows x64/ARM64. macOS x64 is unsupported. No mpg123 encoder
is included.

- official upstream release: <https://www.mpg123.de/download.shtml>
- source archive SHA-256:
  `31d0e35a4ca567ec9b5ebda6c3062bb4435d6d3eacd6ef0d95cadd7854dc03ee`
- detached signature SHA-256:
  `48037de26dd56d479b5a54d91ba301d9958476bd03c1b135ee183c3b23c2793c`
- published signing-key fingerprint:
  `D021 FF8E CF4B E097 19D6 1A27 231C 4CBC 60D5 CAFE`
- retained terms: [`MPG123.txt`](src/common/editor/mpg123/licenses/MPG123.txt)
- detailed notice: [`NOTICE.md`](src/common/editor/mpg123/NOTICE.md)
- source/build manifest: [`source-manifest.json`](src/common/editor/mpg123/source-manifest.json)
- exact `mpg123.wasm`: 172,329 bytes; SHA-256
  `d2b5686a16141ec97dbeb4e4f2a1ce28b756dd3eaf6438b31379356c8dd958ae`

The build contains only the reusable libmpg123 memory-feed path and finite
interleaved float32 output. It contains no CLI, filesystem or network reader,
audio output, encoder, thread support, or SIMD implementation. The exact
Emscripten 3.1.64 build requires GnuPG to verify the official detached
signature and signing-key fingerprint before compilation. Run
`npm run build:mpg123` to reproduce it and `npm run audit:mpg123` to recheck
source, local files, archive members, imports, exports, memory limits, digest,
and the MP2/MP3 startup canaries.

The admitted public profile is raw MPEG-1 Layer II or III audio at 32, 44.1, or
48 kHz, mono or stereo. A strict bounded inspector checks every frame and exact
sample geometry; LAME Xing/Info delay and padding are honored when present.
Standards-valid lower MPEG versions, CRC-protected streams, tags, chained
geometry, and other unreviewed metadata profiles fall through to the next
provider. Malformed framing, bounds, or contradictory declared geometry fail
terminally. Stock mpg123/LAME and TwoLAME interoperability fixtures verify
exact decoded frame counts and PCM digests. Upstream's patent discussion is
explicitly not legal advice; the LGPL terms, technical review, and
interoperability results do not establish patent clearance or non-infringement
for any use or territory.

## TwoLAME 0.4.0 WebAssembly

Soundscaper distributes one exact Emscripten build of the TwoLAME 0.4.0
MPEG-1 Layer II encoder under LGPL-2.1-or-later terms in the Web and Electron
renderer. The same bytes are also staged as the desktop bundled MP2 encode
provider on Linux x64/ARM64, macOS ARM64, and Windows x64/ARM64. macOS x64 is
unsupported. No decoder, command-line frontend, filesystem, network, thread,
SIMD, or VBR support is included.

- official upstream release: <https://www.twolame.org/>
- exact source archive: <https://downloads.sourceforge.net/project/twolame/twolame/0.4.0/twolame-0.4.0.tar.gz>
- source archive SHA-256:
  `cc35424f6019a88c6f52570b63e1baf50f62963a3eac52a03a800bb070d7c87d`
- retained terms: [`TWOLAME.txt`](src/common/editor/twolame/licenses/TWOLAME.txt)
- detailed notice: [`NOTICE.md`](src/common/editor/twolame/NOTICE.md)
- source/build manifest: [`source-manifest.json`](src/common/editor/twolame/source-manifest.json)
- exact `twolame.wasm`: 146,820 bytes; SHA-256
  `b4b166bed688504b548adcee02cda391d4d8b25a44aec914c3fe1082f466ed1b`

The admitted profile is MPEG-1 Layer II CBR at 32, 44.1, or 48 kHz, mono or
stereo, for the exact bitrate tuples accepted by request preflight. TwoLAME
quantizes finite float input to signed 16-bit PCM and pads a final partial
1,152-sample frame; its output is therefore neither lossless nor gapless.
Run `npm run build:twolame` to reproduce the artifact and
`npm run audit:twolame` to recheck its closed authority and evidence. Stock
TwoLAME-to-mpg123 tests verify structural framing and a bounded lossy
signal-to-noise floor. These checks do not establish patent clearance or
non-infringement for any use or territory.

## WavPack 5.9.0 WebAssembly

Soundscaper distributes one exact Emscripten build of WavPack 5.9.0 under the
BSD-3-Clause license. It supports persisted float32 PCM chunks in the Web and
Electron renderer and is also staged unchanged as the desktop bundled
float32 `.wv` encode/decode provider on Linux x64/ARM64, macOS ARM64, and
Windows x64/ARM64. macOS x64 is unsupported.

- upstream: <https://github.com/dbry/WavPack/tree/5.9.0>
- pinned commit: `5803634a030e2a11dba602ba057b89cc34486c67`
- retained license: [`licenses/WAVPACK.txt`](src/common/editor/wavpack/licenses/WAVPACK.txt)
- detailed notice: [`NOTICE.md`](src/common/editor/wavpack/NOTICE.md)
- source/build manifest: [`source-manifest.json`](src/common/editor/wavpack/source-manifest.json)
- exact `wavpack.wasm`: 145,537 bytes; SHA-256 `c547aca2d5584d643cea4a9d856f9672b9f621fae518ef99444d94500c31f908`

The source and binary audit pins every compiled upstream file, the local
in-memory ABI bridge, the Emscripten 3.1.64 toolchain, imports, exports, memory
limits, license files, and exact artifact hash. Desktop staging rechecks the
regular file, byte length, and SHA-256; startup rechecks byte length and SHA-256
and requires an encode/parse/decode canary before registering the provider. The
desktop provider accepts only lossless float32 WavPack encode/decode, one to
eight channels, 8–192 kHz, and compression level 2, which maps to the reviewed
`CONFIG_FAST_FLAG` ABI. Its strict parser bounds blocks, frames, metadata,
channels, and output and rejects unsupported profiles, correction streams,
extensions, malformed geometry, truncation, and checksum faults.

An independent implementation check built stock WavPack 5.9.0 `wvunpack` from
the same pinned upstream commit and decoded a 1,240,560-byte, three-channel,
48 kHz multi-block `.wv` emitted by this provider. The 2,362,380-byte decoded
float32 result matched the expected raw PCM at SHA-256
`b7f8cd1d8e1a00374f618587eb2c5872fcd250d8686c9cbda0b46e00003ea40f`.
That is a narrow stock-decoder interoperability witness, not qualification of
other WavPack versions, profiles, platforms, or producers. The BSD-3-Clause
license, exact review, and interoperability result do not establish absence of
patent exposure or patent clearance.

## Retained legacy FFmpeg WebAssembly publication and audit tooling

The upstream single-thread `@ffmpeg/core` 0.12.10 package, the MIT-licensed
`@ffmpeg/ffmpeg` 0.12.15 wrapper, and its `@ffmpeg/types` 0.12.4 definitions
are now development-only dependencies retained for historical publication
manifests, audit tooling, fixtures, and development parity checks. They are not
members of the npm production closure. The production browser bundle audit
rejects the packages, core JavaScript or WebAssembly, runtime loader, asset URL,
and legacy cache seam; no browser or desktop application artifact imports,
packages, publishes, or fetches this core. The combined core remains
GPL-2.0-or-later, so its exact provenance and terms remain recorded while the
legacy evidence is retained.

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

That upstream build enables GPL components and the following separately licensed libraries: x264 and x265 (GPL-2.0-or-later), libvpx (BSD-3-Clause), LAME (LGPL-2.0-or-later), libtheora and libvorbis (BSD-3-Clause), libopus (BSD-3-Clause), zlib (Zlib), libwebp (BSD-3-Clause), FreeType (FTL or GPL-2.0-only), FriBidi (LGPL-2.1-or-later), libass (ISC), and zimg (WTFPL-2.0). The upstream build recipe identifies their licenses and preferred source locations, but fetches dependency sources during the build and does not vendor the exact complete source snapshot used for the npm core. This missing provenance blocks any future reactivation of the legacy publication tooling. The combined core is offered under GPL-2.0-or-later; the repository's AGPL-3.0-only application is compatible with that selected GPL option.

The npm core artifacts themselves are unpatched. Historical integration modules
and tests remain reviewable in the repository, but current browser composition
uses dedicated codec modules, browser WebCodecs, and a dedicated container
writer. The production build gate scans every emitted browser file and service
worker after static and offline-shell generation and fails if the wrapper, core,
core asset names, loader, public runtime URL, or cache namespace re-enters the
artifact.

`desktop/ffmpeg-corresponding-source.json` currently pins an FFmpeg source
archive and the `v12.15` ffmpeg.wasm build-source archive. It does not inventory
or pin complete corresponding source for every enabled external library.
The retained legacy publication tooling validates those descriptors, and the
checked-in runtime policy manifest hashes them to reject provenance drift, but
neither check establishes corresponding-source completeness. Any future
reactivation therefore remains blocked by the licensing matrix. The descriptor
name is historical; neither it nor its referenced archives are copied into a
browser bundle, desktop package, or desktop release set.

## Desktop codec execution and external FFmpeg

The desktop build has a separate application codec composition. Its renderer
audit, staging gate, application-resource gate, and release-inventory gate
reject application-supplied FFmpeg and libav executables or libraries, the
`@ffmpeg/core` JavaScript and WebAssembly payload, and the historical static
FFmpeg media host. The desktop application therefore does not redistribute an
FFmpeg/libav application codec provider or FFmpeg WebAssembly runtime.

Electron itself is a distinct framework dependency. Stock Electron 43.1.1
includes a Chromium `libffmpeg` media library with proprietary codec support.
Desktop packaging sets electron-builder's `downloadAlternateFFmpeg` option so
the stock library is replaced with Electron's matching alternate release asset,
which upstream intends to omit proprietary codec support. Every packaged
library is then checked by
[`scripts/lib/electron-alternate-ffmpeg.mjs`](scripts/lib/electron-alternate-ffmpeg.mjs)
against
[`config/electron-alternate-ffmpeg-manifest.json`](config/electron-alternate-ffmpeg-manifest.json):

- Linux x64 and ARM64 use `libffmpeg.so`;
- macOS ARM64 uses `libffmpeg.dylib`; macOS x64 is unsupported and has no row;
- Windows x64 and ARM64 use `ffmpeg.dll`.

That manifest binds Electron 43.1.1, the exact five release-archive names and
archive SHA-256 values, and each unpacked library's byte length and SHA-256.
The after-pack verifier re-hashes the exact framework location before final
package assembly. The library remains part of Electron/Chromium and its notices; it
is not a Soundscaper codec-provider tier, is not invoked through the desktop
codec broker, and is not a separately distributed Soundscaper runtime. The
alternate asset name, upstream intent, and digest verification do not prove a
complete enabled-codec inventory, codec behavior, absence of patent exposure,
or patent clearance.

The maintained first-party PCM container readers remain application source.
The exact libFLAC 1.5.0 signed-24, libopus 1.6.1 plus libogg 1.3.6 Ogg Opus,
libvorbis 1.3.7 plus libogg 1.3.6 Ogg Vorbis, and WavPack 5.9.0 float32
providers described above are the supported bundled compressed-codec runtimes
in the shipped desktop composition. Every other
bundled compressed-codec candidate provides policy and tuple contracts only
and fails closed as unavailable. Operating-system codecs remain limited to
their separately verified exact target profiles.

As the final provider tier, the desktop application may execute an FFmpeg
program already installed on the user's system after bounded discovery or an
explicit file choice. With explicit confirmation it may ask Windows Package
Manager or Homebrew to install FFmpeg into the user's system package-manager
prefix. The confirmed package-manager process performs any network fetch and
system installation; Soundscaper does not itself fetch or copy FFmpeg bytes,
package them, sublicense them, or redistribute that external executable or its
libraries; it is separate from Electron's packaged alternate framework
library. The discovery, probe,
version-admission, and bounded command contracts do not establish codec
conformance for every accepted version, availability on any platform, or
patent clearance for any codec, provider, use, or territory.

## Boost.Multiprecision exact-retime build headers

Boost.Multiprecision 1.92.0 is pinned as build-only C++20 header input for the
candidate exact video-retime ordinal executor. It is distributed under the
Boost Software License 1.0 (BSL-1.0). The official source archive is
<https://archives.boost.io/release/1.92.0/source/boost_1_92_0.tar.bz2> (199,030,664
bytes; SHA-256 `5c1d40cb8e19adbf740a4ec2da35b3e58f3f5804b1dce44deb53df72193cbc6c`).

[`config/boost-multiprecision-source-manifest.json`](config/boost-multiprecision-source-manifest.json)
pins the conservative 254-file syntactic include closure rooted at
`boost/multiprecision/cpp_int.hpp`. The closure is compile-time source, not a
separately loaded runtime binary, and its presence does not claim that any
native media-host or OpenFX-host payload has been built, self-tested, or
shipped.

## Framescaper native FFmpeg source candidate

The dormant Framescaper media-host candidate pins FFmpeg 9.0.1 “Lei” from
<https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz> (12,036,420 bytes; SHA-256
`cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635`).
FFmpeg is available under LGPL-2.1-or-later, or GPL-2.0-or-later when GPL
components are enabled; the pinned candidate recipe selects the GPL mode,
disables network support and external libraries, and admits codec/container
flags only after their licensing rows clear.

[`native/framescaper-media-host/source-manifest.json`](native/framescaper-media-host/source-manifest.json)
and the host-local notice pin the candidate source and five build recipes.
[`config/framescaper-media-host-payload-manifest.json`](config/framescaper-media-host-payload-manifest.json)
contains no payloads: every target is `pending-external`. This source record
does not activate the development-only legacy `@ffmpeg/core` 0.12.10 / FFmpeg
5.1.4 evidence above and does not authorize native codec distribution.

## OpenFX 1.5.1 source candidate

The dormant Framescaper scanner/runtime-host candidate pins the signed OpenFX
tag `OFX_Release_1.5.1`, requested commit prefix `ab77951` (full commit
`ab779510b2655b4d11a7e01e5c521f9aa8c88976`), under BSD-3-Clause. The pinned
commit archive is 9,837,777 bytes with SHA-256
`7f4fcde6c4bff3ee1f95a0b73a805e662a3e030999523165b40cfbe76c1ab9f5`.

[`native/framescaper-openfx-host/source-manifest.json`](native/framescaper-openfx-host/source-manifest.json)
and its host-local notice retain the tag, signature identity, source digest,
and five build recipes. Framescaper does not redistribute user-installed OFX
plug-ins, and
[`config/framescaper-openfx-host-payload-manifest.json`](config/framescaper-openfx-host-payload-manifest.json)
contains no scanner or runtime-host payload. All targets remain unavailable
until their licensing, isolation, conformance, payload, and target checks pass.

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
- FFmpeg filter behavior used as a documentation reference for independently
  authored plans, without shipping the development-only legacy
  `@ffmpeg/core` `0.12.10` above:
  <https://ffmpeg.org/ffmpeg-filters.html>.

MLT and GStreamer are catalog and behavior references only. Any future reuse
or close translation of their source, modules, shaders, metadata, or plug-ins
requires a new per-file copyright and license audit, retained notices, exact
source pinning, and an update to this document before distribution.

## Desktop runtime and build tooling

- Electron 43.1.1 — MIT; source: <https://github.com/electron/electron/tree/v43.1.1>. Packaged desktop applications include Electron's license and `LICENSES.chromium.html`, which carries Chromium and bundled component notices.
- electron-builder 26.15.6 — MIT; build-time packaging tool, not part of the application runtime; exact npm source package: <https://registry.npmjs.org/electron-builder/-/electron-builder-26.15.6.tgz> (`sha512-jxlHRjqYrlTgLVo/aoACGpiki3QFYv8s4f2djsqaEbwTBZ9PcTBK03Tj/HMa65kiE0hdZxxbZdmVFo22eou2wA==`); upstream repository: <https://github.com/electron-userland/electron-builder>.
- `@electron/fuses` 2.1.3 — MIT; build-time hardening tool used to disable unsafe Electron runtime switches during package finalization; source: <https://github.com/electron/fuses/tree/v2.1.3>.
- `@resvg/resvg-js` 2.6.2 — MPL-2.0; unmodified build-time rasterizer used only to derive platform icons from the existing Soundscaper SVG mark; source: <https://github.com/yisibl/resvg-js/tree/v2.6.2>.
- `wawoff2` 2.0.1 — MIT; pinned build-time WebAssembly compiler used only to derive the browser-delivery `MusescoreIcon.woff2` from the retained upstream TTF; source: <https://github.com/fontello/wawoff2/tree/2.0.1>.

Electron and its embedded Chromium/Node.js runtime are shipped only in desktop
artifacts. Build-only packaging and icon tools are not shipped. Soundscaper does
not modify these packages; their installed license files and upstream source are
available from the pinned links above.

## Nightly-with-tests diagnostic tooling

The opt-in `nightly-with-tests` CI artifact is a diagnostic test runner, not a
normal desktop package or public release. It additionally distributes the
following pinned tools solely so the extracted application can run its bundled
browser workflows without an npm installation:

- `@playwright/test` 1.62.1, `playwright` 1.62.1, and `playwright-core` 1.62.1 — Apache-2.0; Copyright Microsoft Corporation; source: <https://github.com/microsoft/playwright/tree/v1.62.1>
- `@axe-core/playwright` 4.12.1 and `axe-core` 4.12.1 — MPL-2.0; Copyright Deque Systems, Inc.; source: <https://github.com/dequelabs/axe-core/tree/v4.12.1>
- WinLDD `PrintDeps.exe` (Playwright revision 1007) — MIT; Copyright (c) 2020 Julien Waechter; source and embedded license header: <https://github.com/microsoft/playwright/blob/v1.62.1/browser_patches/winldd/PrintDeps.cpp>; binary-only archive recipe: <https://github.com/microsoft/playwright/blob/v1.62.1/browser_patches/winldd/archive.sh>; bundled terms: [`LICENSES/Playwright-winldd-MIT.txt`](LICENSES/Playwright-winldd-MIT.txt)
- `esbuild` 0.28.1 — MIT; Copyright (c) 2020 Evan Wallace; source: <https://github.com/evanw/esbuild/tree/v0.28.1>; the browser specs compile the TypeScript sources they serve to each engine. Each package targets exactly one platform, so the artifact carries only the `@esbuild/<platform>-<architecture>` 0.28.1 binary package its own target runs, under the same MIT terms and the `esbuild` `LICENSE.md` staged beside it
- `typescript` 6.0.3 — Apache-2.0; Copyright Microsoft Corporation; source: <https://github.com/microsoft/TypeScript/tree/v6.0.3>

Playwright's pinned browser inventory for that artifact identifies
Chrome for Testing 151.0.7922.34 (Playwright revision 1234),
Firefox 153.0 (Playwright revision 1538), and
WebKit 26.5 (Playwright revision 2336). Platform-specific revision
overrides remain recorded in the distributed `playwright-core/browsers.json`.
The downloaded archives retain the license and notice material they provide,
including Chromium's component notices and Playwright's LGPL-2.1 FFmpeg copy;
the corresponding Playwright browser patches and build scripts are at
<https://github.com/microsoft/playwright/tree/v1.62.1/browser_patches>.

The artifact also retains each staged npm package's installed `LICENSE`,
`NOTICE`, and third-party-notice files. This deliberately broader diagnostic
distribution does not change the dependency surface of the normal Soundscaper
or Framescaper desktop executables.

## Interchange conformance reference implementations

The opt-in interchange reference tests execute these pinned Python packages as
independent readers. They are not bundled, linked, shipped, or redistributed
with Soundscaper or Framescaper:

- `opentimelineio 0.18.1` — Apache-2.0; source: <https://github.com/AcademySoftwareFoundation/OpenTimelineIO/tree/v0.18.1>
- `otio-cmx3600-adapter 1.0.0` — Apache-2.0; source: <https://github.com/OpenTimelineIO/otio-cmx3600-adapter/tree/v1.0.0>
- `otio-fcpx-xml-adapter 1.0.0` — Apache-2.0; source: <https://github.com/OpenTimelineIO/otio-fcpx-xml-adapter/tree/v1.0.0>

Exact package versions and wheel SHA-256 verification rules are recorded in
[`config/interchange-conformance-tools.json`](config/interchange-conformance-tools.json).

## Packaged browser dependencies

The browser tools can distribute the following pinned browser-side packages as part of the site build:

- Audacity design system (vendored in-tree at `vendor/audacity-design-system/`) — `@dilsonspickles/components` 0.10.1, `@audacity-ui/core` 0.1.0, `@audacity-ui/tokens` 0.1.0 — declared MIT in each package manifest (the upstream repository ships no LICENSE file); vendored from tag `components-v0.10.1`, commit `ad34f2195ce401179ec0f365f186150f05b8181c`; source: <https://github.com/DilsonsPickles/audacity-design-system/tree/components-v0.10.1/packages>; local modifications are recorded in `vendor/audacity-design-system/README.md` and the pinned upstream revision in `vendor/audacity-design-system/UPSTREAM` (verified by `check:notices`)
- Roseus colormap — MIT; Copyright © dofuuz; the 256-entry colormap table embedded in `vendor/audacity-design-system/components/src/utils/spectrogram.ts`; source: <https://github.com/dofuuz/roseus>
- `@fontsource/inter` 5.3.0 — SIL Open Font License 1.1; self-hosted WOFF/WOFF2 distribution of Inter, Copyright 2016 The Inter Project Authors; source metadata and font files: <https://github.com/fontsource/font-files/tree/main/fonts/google/inter>; upstream font source: <https://github.com/rsms/inter>; full license text is retained in the installed package's `LICENSE` file
- `@fontsource/ubuntu` 5.3.0 — Ubuntu Font Licence 1.0; self-hosted WOFF/WOFF2 distribution of Ubuntu, Copyright 2010-2011 Canonical Ltd.; source metadata and font files: <https://github.com/fontsource/font-files/tree/main/fonts/google/ubuntu>; upstream font source: <https://launchpad.net/ubuntu-font-family>; full license text is retained in the installed package's `LICENSE` file
- `@sqlite.org/sqlite-wasm` 3.53.0-build1 — official SQLite WebAssembly distribution; SQLite core is dedicated to the public domain; source and blessing: <https://sqlite.org/wasm/doc/trunk/index.md> and <https://sqlite.org/copyright.html>
- `@zip.js/zip.js` 2.8.33 — BSD-3-Clause; Copyright © 2023 Gildas Lormeau; source and license: <https://github.com/gildas-lormeau/zip.js/tree/v2.8.33>
- `@noble/hashes` 2.2.0 — MIT; Copyright © 2022 Paul Miller; source and license: <https://github.com/paulmillr/noble-hashes/tree/2.2.0>
- `fflate` 0.8.3 — MIT; source: <https://github.com/101arrowz/fflate>
- `@echogarden/pffft-wasm` 0.4.2 — UCAR/NCAR permissive license; SIMD WebAssembly build of PFFFT used by spectrograms, spectral editing, and FFT-based effects; source: <https://github.com/echogarden-project/pffft-wasm>
- `mediabunny` 1.55.3 — MPL-2.0; unmodified pure-TypeScript browser media toolkit used for browser-native AAC and MP4/WebM container generation; exact npm archive: <https://registry.npmjs.org/mediabunny/-/mediabunny-1.55.3.tgz> (`sha512-kpBhMiJHGmerizzObAT1XLZDyImO4ZEKXaxjjfxGVkycQ0U5of/xlLepm1Izp3P+3jlaedFSRI5fJnv3Q5xV6A==`); upstream source: <https://github.com/Vanilagy/mediabunny>
- `@types/dom-mediacapture-transform` 0.1.12 — MIT; transitive compile-time definitions required by Mediabunny, represented in the npm production closure but not emitted as runtime JavaScript; exact npm archive: <https://registry.npmjs.org/@types/dom-mediacapture-transform/-/dom-mediacapture-transform-0.1.12.tgz> (`sha512-d7/QsLRwF864A5mgIM/YrfiglHoYn7zgCcAoJgW404r+2DwnNr7EBbLnCWpmOMgH8y0te73L1AV6H1bmauaWFw==`); source: <https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/dom-mediacapture-transform>
- `@types/dom-webcodecs` 0.1.13 — MIT; transitive compile-time WebCodecs definitions required by Mediabunny, represented in the npm production closure but not emitted as runtime JavaScript; exact npm archive: <https://registry.npmjs.org/@types/dom-webcodecs/-/dom-webcodecs-0.1.13.tgz> (`sha512-O5hkiFIcjjszPIYyUSyvScyvrBoV3NOEEZx/pMlsu44TKzWNkLVBBxnxJz42in5n3QIolYOcBYFCPZZ0h8SkwQ==`); source: <https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/dom-webcodecs>
- `react` 19.2.7 — MIT; Copyright © Meta Platforms, Inc. and affiliates; source and license: <https://github.com/facebook/react/tree/v19.2.7/packages/react>
- `react-dom` 19.2.7 — MIT; Copyright © Meta Platforms, Inc. and affiliates; source and license: <https://github.com/facebook/react/tree/v19.2.7/packages/react-dom>
- `scheduler` 0.27.0 — MIT; transitive React scheduler runtime; Copyright © Meta Platforms, Inc. and affiliates; source and license: <https://github.com/facebook/react/tree/v19.2.7/packages/scheduler>
- `sql.js` 1.14.1 — MIT; source: <https://github.com/sql-js/sql.js> (retained for unrelated legacy tools; AUP4 uses the official SQLite WASM package)

## PipeWire public headers

The native helper addon reaches PipeWire through `dlopen` and never links or
redistributes the library. Its public headers are vendored under
`vendor/pipewire-headers/` because the SPA format builders the addon needs are
static inline functions in the headers rather than exported symbols, so runtime
symbol resolution alone cannot reach them.

- `pipewire` 1.0.5 — MIT; source:
  <https://gitlab.freedesktop.org/pipewire/pipewire/-/archive/1.0.5/pipewire-1.0.5.tar.gz>
  (`c5a5de26d684a1a84060ad7b6131654fb2835e03fccad85059be92f8e3ffe993`).
  Vendored scope is the two public include trees, unmodified, plus the
  meson-generated `pipewire/version.h` pinned to the same tag. The upstream
  licence text is retained at `vendor/pipewire-headers/COPYING`.

## Optional local assistance runtime

The optional on-device assistance features load their speech runtime from
`sherpa-onnx-node`, declared as an optional dependency so the editor installs,
builds, and runs without it. The authenticated 1.13.5 closure is admitted for
macOS arm64, Linux x64/arm64, and Windows x64. Windows arm64 remains excluded
until an authenticated Node-API addon and complete package closure exists.
The upstream optional-dependency closure also contains macOS x64 and Windows
ia32 packages; they are listed for notice completeness, not as Milestone 7
release targets.

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

Upstream publishes no `win32-arm64` Node prebuild, so Windows on ARM reports
the Sherpa-backed models as unavailable rather than installing a binary that
cannot load.

Three additional CPU runtime families have reviewed source/version identities
and isolated host code, but every target payload row remains
`pending-external`; these candidates are not yet redistributed:

- `onnxruntime-node` 1.29.0 — MIT; source and license:
  <https://github.com/microsoft/onnxruntime/tree/v1.29.0>
- whisper.cpp v1.9.3 — MIT; source and license:
  <https://github.com/ggml-org/whisper.cpp/tree/v1.9.3>
- llama.cpp revision `b10509` — MIT; source and license:
  <https://github.com/ggml-org/llama.cpp/tree/b10509>

The Milestone 7 supply-candidate register pins upstream identities for
wav2vec2-base-960h, TIGER-DnR, PANNs Cnn10 and its AudioSet map, Beat This
small0/final0, TransNetV2, and Qwen3-4B Q4_K_M. Those pins are conversion and
review inputs, not a redistribution notice. TIGER, PANNs, Beat This, and
TransNetV2 now have a repository-owned CPython 3.12 conversion/parity runner.
Its direct environment (`einops`, `huggingface-hub`, `librosa`, `numpy`,
`onnx`, `onnx2torch`, `onnxruntime`, `protobuf`,
`rotary-embedding-torch`, `safetensors`,
`scipy`, `soundfile`, `soxr`, `tensorflow-cpu`, `tf2onnx`, `torch`,
`torchaudio`, `torchlibrosa`, and `torchvision`) and transitive artifacts are
version- and hash-locked in the conversion tool's `pyproject.toml` and
`uv.lock`. These are external conversion-lab tools, not dependencies or bytes
distributed in the Soundscaper/Framescaper application, runtime packs, model
packs, Pages bundle, or ASAR. A retained external run must archive the exact
environment's applicable licenses and notices before its evidence can be
admitted. No converted artifact or live parity result is checked in, and none
of these six tasks has the required new externally signed production catalog
entry; they are deliberately absent from the cataloged inventory below.

Model weights are separately downloaded, never bundled, and each is recorded in
`config/production-licensing-matrix.json`. A model is listed below only once its
artifacts, notices, and signed-catalog identity are pinned. The checked-in
digests authenticate install and preseed bytes; they are not evidence that an
EU R2 object was uploaded or read back from its public URL.

### Mirrored assistance models

Each model below has an immutable catalog key and exact artifact digests. No
accepted live R2 publication/full-SHA-256 public read-back record is checked in;
remote availability must not be inferred from this notice.
The heading is retained as the signed catalog's stable notice anchor; "mirrored"
here names that catalog distribution identity, not evidence of a completed live
bucket publication.

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
the vendored tag). The browser uses the deterministic 71,168-byte WOFF2
derivative (SHA-256
`d219299ccffce6c9d35b50aaa2f6cfd6f511264a23ec4eee79cf4e20bac0822d`),
generated by pinned `wawoff2` 2.0.1; the unchanged TTF remains as provenance.
Upstream does not provide separate font license metadata at that tag, so both
forms are covered here by the package's declared MIT metadata under the
project's chosen license-review policy.

The browser editor also ports the MuseScore framework icon-code inventory from
`framework/ui/view/iconcodes.h` at MuseScore framework commit
`3e6bfd62701992303dc22f1bae6f81bde1670ef9` (GPL-3.0-only). The port retains the
upstream notice and source hash in
`src/common/editor/audacity-iconcodes.js`.

Except for identified third-party portions under compatible licenses, the repository is distributed under AGPL-3.0-only. Before deploying the FFmpeg core, the release process must archive the exact corresponding source and build configuration alongside the deployed version and verify the enabled codec libraries and their notices.
