# Desktop codec provider implementation plan

## Outcome

Desktop media operations resolve an exact operation through these providers, in
order:

1. reviewed codecs distributed with Soundscaper;
2. codecs supplied by the operating system;
3. an external `ffmpeg`/`ffprobe` installation selected by the user.

The browser build keeps its existing pinned FFmpeg WASM runtime. Desktop
packages contain no Soundscaper application-provider FFmpeg executable, libav
library, or FFmpeg WASM payload. Electron's separately verified alternate
framework libffmpeg remains Chromium infrastructure rather than a Soundscaper
provider tier. The supported desktop targets remain Windows x64/ARM64, macOS
ARM64, and Linux x64/ARM64. The retired macOS x64 target remains unsupported.

## Implementation status — 2026-08-25

The desktop audio broker, exact provider order, main-owned settings, and seven
reviewed compressed-audio WebAssembly payloads are implemented. All seven are
registered for linux-x64, linux-arm64, mac-arm64, win-x64, and win-arm64;
mac-x64 is rejected rather than treated as a compatibility alias:

- libFLAC 1.5.0, 153,044 bytes, SHA-256
  `34acff0d67e3ac7f34816217ed7f5f859bf9a1c70f33eb3c347049f5fdf0d443`,
  for bounded FLAC encode/decode through the reviewed signed-24-bit profile;
- libopus 1.6.1 with libogg 1.3.6, 385,789 bytes, SHA-256
  `c4c9f7ac85071b24b2545f966943c4319fff023a65c899146cfcb016ae0a8853`,
  for 48 kHz mono/stereo Ogg Opus encode/decode;
- libvorbis 1.3.7 with libogg 1.3.6, 523,227 bytes, SHA-256
  `c03037c33f35dbf85e1e963058156399b995b2dedb5479f6eb3f3b30148eeee5`,
  for 8–192 kHz mono/stereo Ogg Vorbis encode/decode;
- WavPack 5.9.0, 145,537 bytes, SHA-256
  `c547aca2d5584d643cea4a9d856f9672b9f621fae518ef99444d94500c31f908`,
  for 8–192 kHz, one-to-eight-channel float32 lossless `.wv`
  encode/decode at reviewed compression level 2 only;
- mpg123 1.33.7, 172,329 bytes, SHA-256
  `d2b5686a16141ec97dbeb4e4f2a1ce28b756dd3eaf6438b31379356c8dd958ae`,
  for feed-only float32 MPEG-1 Layer II/III decode at 32, 44.1, or 48 kHz,
  mono or stereo;
- LAME 4.0, 212,205 bytes, SHA-256
  `654d08f946851134755513c8c0cd4486e8c9d2024df2318dc48b262e4ad7a502`,
  for bounded CBR MPEG-1 Layer III encode at 32, 44.1, or 48 kHz, mono or
  stereo, with only the encoder's reviewed bitrate combinations admitted; and
- TwoLAME 0.4.0, 146,820 bytes, SHA-256
  `b4b166bed688504b548adcee02cda391d4d8b25a44aec914c3fe1082f466ed1b`,
  for bounded CBR MPEG-1 Layer II encode at 32, 44.1, or 48 kHz, mono or
  stereo, with invalid layer/channel/bitrate combinations rejected.

The specialized first-party WAV/BWF/BW64 and AIFF PCM implementations remain
the first choice for those containers. libsndfile is intentionally not added:
the current direct libFLAC provider and specialized PCM container owners cover
the admitted matrix without a redundant general-purpose file library or its
additional format surface.

Every bundled payload has a pinned upstream archive or revision, license and
notice closure, Emscripten 3.1.64 recipe, exact-byte staging audit, startup
identity check, bounded parser/output validation, and a codec canary. WavPack
also retains the strict block/checksum authority and independent stock decoder
witness described below. These codecs currently take and return whole buffers
through a 32 MiB request-input and 128 MiB response-output contract. Except for
the WavPack block loop, each codec invocation is one synchronous WASM call after
yielding to the main loop. Cancellation is checked before and after that call;
it cannot interrupt an active WASM invocation. The buffers, WASM linear memory,
codec working state, JavaScript copies, elapsed time, and process RSS do not
form one aggregate memory or CPU reservation.

A separate Linux x64 interoperability check built stock WavPack 5.9.0
`wvunpack` from the same pinned commit. It decoded a 1,240,560-byte,
three-channel, 48 kHz multi-block provider output into 2,362,380 bytes of raw
float32 PCM; expected and actual bytes both had SHA-256
`b7f8cd1d8e1a00374f618587eb2c5872fcd250d8686c9cbda0b46e00003ea40f`.
This is a narrow stock-decoder witness, not broad cross-version, cross-platform,
or producer interoperability qualification.

Windows Media Foundation and macOS ARM64 AudioToolbox source adapters, exact
source inspectors, output validators, and live startup canaries are implemented
for 48 kHz stereo MP3 and AAC-LC/M4A decode, 48 kHz stereo 160 kbps AAC-LC/M4A
encode, and—on Windows only—48 kHz stereo 192 kbps MP3 encode. The production
native payload manifest nevertheless has all five target rows
`pending-external`, with no authenticated, signed target payload. Consequently
the production loader stages no OS codec helper and the entire OS tier fails
closed on every current package. Linux intentionally has no uniform OS tier.

External FFmpeg CLI support is implemented for matching `ffmpeg`/`ffprobe`
released versions from 4.4 through 9.x (`>=4.4.0`, `<10.0.0`). Main fingerprints
both programs and their declared file closure, probes exact capability sets,
quarantines identity changes, and admits only exact settings-correlated tuples.
Edit > Preferences > General shows the canonical location and status and owns
Browse, Clear, Rescan, and explicit Install actions. Installation uses the
exact WinGet package id `BtbN.FFmpeg.GPL.8.1` or an already installed Homebrew
binary with `brew install ffmpeg`; Soundscaper never bootstraps a package
manager, invokes `sudo`, or fetches/copies FFmpeg into its packages.

The bundled WebM/AV1 execution tier is not implemented. The repository has a
fail-closed AV1 qualification decision and correctly treats dav1d as the decode
candidate, SVT-AV1 as the primary encode candidate, and libaom as a conditional
Windows ARM64 encoder fallback. It has no libwebm/libvpx/dav1d/SVT-AV1/libaom
payload, no complete 12-case result on every supported target, and the desktop
bridge accepts audio operations only. WebM and AV1 therefore advertise no
bundled execution capability and fall closed rather than silently using the
browser FFmpeg runtime.

Copyright-license and technical evidence for these components is not patent
clearance or a non-infringement representation for any codec, use, provider,
territory, or distribution method.

## Provider boundary

- The strict-TypeScript coordinator and main broker currently own audio decode
  and encode. Probe, trim, conform, remux, timing, proxy, and video delivery have
  not been migrated to this bridge and must not be represented as bundled
  WebM/AV1 support.
- Select a provider for the exact codec/container/direction/profile/sample or
  pixel-format tuple. Only `unavailable` and `unsupported` preflight results may
  fall through. Cancellation, invalid input, security failure, execution
  failure, or partial output is terminal.
- Keep renderer requests pathless. Main owns executable discovery, file grants,
  scratch storage, process supervision, cancellation, and atomic publication.
- Record the chosen provider, implementation/version identity, capability
  generation, normalized settings, and input/output digests in each bounded
  in-memory receipt. Receipt timing is deliberately `null`; the current broker
  does not claim elapsed-time or padding measurement.

## Bundled provider

- Preserve the specialized WAV/BWF/BW64 and AIFF paths and use the direct
  libFLAC, libogg/libvorbis, and libogg/libopus payloads above. Do not add
  libsndfile unless a separately reviewed format gap makes that dependency and
  its broader parser surface necessary.
- Use mpg123 1.33.7 only for the admitted MPEG-1 Layer II/III decode subset,
  LAME 4.0 for the admitted MPEG-1 Layer III encode subset, and TwoLAME 0.4.0
  for the admitted MPEG-1 Layer II encode subset. Valid but unreviewed MPEG
  versions, layers, rates, or settings return `unsupported` and may reach a
  lower-priority provider; malformed input is terminal.
- Keep libwebm/libvpx WebM execution disabled until exact payloads, bounded
  bridge operations, conformance tests, notices, and five-target evidence are
  present.
- Keep dav1d 1.5.4, SVT-AV1 4.2.0, and libaom 3.14.1 as qualification
  candidates, not shipped providers. dav1d is the decoder candidate. SVT-AV1
  is the primary encoder candidate; encoder-only libaom may be selected only on
  Windows ARM64 after a complete same-target decision proves the stated
  fallback condition. Do not distribute rav1e initially.
- Qualify AV1 with identical 1080p/4K, 8/10-bit film, animation, and screen
  corpora. Compare decode CPU time and peak RSS, and compare encoder throughput
  only at matched bitrate and VMAF/SSIM points.
- Pin source archives, hashes, build recipes, notices, patent-license texts,
  SBOM entries, corresponding source, and five-target payload evidence. Codec
  admission remains fail-closed per operation/container/jurisdiction.

### AV1 implementation finding

`libaom` is the reference AV1 implementation and includes both encode and
decode paths; it is not one comparable "fastest project" for both directions.
VideoLAN's dav1d is decoder-only and explicitly optimized for speed, size, and
correctness. It remains the bundled software-decoder choice. The dav1d project
still describes its 1.5.4 release as the latest optimized decoder, but its
published blanket fastest claim dates to 2019, so admission must depend on the
five-target corpus above rather than that historical claim.

SVT-AV1 is encoder-only and its current 4.2.0 release continues target-specific
speed/quality and memory work. It is therefore the default encoder candidate;
libaom 3.14.1 is an encoder fallback, not a dav1d replacement. There is no
single useful encoder-speed result without fixing preset, bitrate, quality
metric, bit depth, content class, CPU, thread count, and memory ceiling. Keep
the Windows ARM64 fallback closed until the same corpus shows that libaom meets
correctness and beats or is required in place of SVT-AV1 at matched quality.

Primary references: [dav1d project and release](https://images.videolan.org/projects/dav1d.html),
[dav1d 1.5.4 announcement](https://images.videolan.org/news.html),
[SVT-AV1 releases](https://gitlab.com/AOMediaCodec/SVT-AV1/-/releases), and
[libaom changelog](https://aomedia.googlesource.com/aom/+/refs/heads/master/CHANGELOG).

## Operating-system provider

- The Windows sources use Media Foundation directly for the exact MP3/AAC
  tuples above. A target-native build must instantiate the Microsoft path and
  pass the deterministic canary before it advertises a tuple. Missing Windows
  N components and optional codec packs degrade without affecting bundled
  codecs.
- The macOS ARM64 sources use AudioToolbox/Extended Audio File Services for the
  exact MP3/AAC tuples above. macOS has no admitted MP3 encoder. AVFoundation
  and VideoToolbox video work remains outside the audio-only bridge.
- All production payload rows are pending, so these sources currently prove
  build intent and portable validation only, not executable package support.
  Linux has no uniform OS provider and falls from bundled codecs directly to
  external FFmpeg.

## External FFmpeg

- Use isolated CLI subprocesses rather than loading libav. Admit released
  versions `>=4.4.0` and `<10.0.0`, require a matching `ffmpeg`/`ffprobe` pair,
  enumerate capabilities, and cache deterministic canaries by executable and
  dependency-closure digest.
- Discover a user-selected executable first, then a prior managed installation,
  package-manager prefixes/aliases, and system `PATH`. Identity changes return
  the candidate to quarantine until it is reprobed and reconfirmed.
- Put the displayed canonical location, version/status, Browse, Clear, Rescan,
  and Install actions in a new desktop-only General page under Edit >
  Preferences. Move the existing desktop language setting to that page. Do not
  add a separate Codecs page or Tools-menu entry.
- Persist external FFmpeg state in the main-owned desktop settings store, never
  in project/editor preferences. The renderer receives sanitized status and
  action methods, not executable paths with execution authority.
- Run user-confirmed installs through a separate, closed main-process broker:
  exact-ID WinGet packages on Windows and `brew install ffmpeg` on macOS/Linux.
  Never bootstrap Homebrew, invoke `sudo`, install at startup, or silently
  accept changed package agreements.
- Invoke audio runtime jobs without a shell, with fixed argument templates,
  `-nostdin`, a local protocol allowlist, a curated environment, private
  scratch files, bounded duration/log/output, cancellation, and output
  validation. The runner hashes the admitted executable again before path-based
  spawn, but does not hold an executable file descriptor across spawn; a
  time-of-check/time-of-use replacement remains possible. It has no operating-
  system RSS or CPU sandbox. The argument protocol allowlist constrains
  cooperative FFmpeg behavior, not a malicious user-selected executable, which
  retains its ordinary account and network authority. Publication beyond the
  in-memory audio response remains owned by the caller. Custom FFmpeg export
  remains explicit, external-only, and path/protocol constrained.

## Migration and acceptance

- Desktop and browser media composition is split at build time, and desktop
  FFmpeg WASM staging is absent. Audio import/export reaches the coordinator;
  migration of probes, conform/trim/proxy work, and video delivery remains a
  separate prerequisite for desktop WebM/AV1 execution.
- Replace the Framescaper FFmpeg-linked host with the product-neutral codec
  host so both desktop products share the same policy and payloads.
- Add resolver, codec round-trip, OS conformance, CLI-version, installer-broker,
  quarantine, cancellation, IPC, and package-inventory tests. Cover all five
  supported target rows; keep macOS x64 rejection tests.
- Desktop startup and bundled formats must work offline without external
  FFmpeg. Unavailable last-resort formats must show an actionable reason in the
  existing import/export UI.
- Final package audits must prove that desktop artifacts contain only the seven
  admitted audio codec payloads above and no application-supplied FFmpeg/libav
  or FFmpeg WASM runtime, while browser tests continue to verify the pinned
  browser runtime.
- Update licensing/security/payload/source-offer/threat-model evidence, sync
  derived policy narratives, repin digest-bound evidence, and pass native tests,
  `npm test`, `npm run build`, `npm run check`, and the full browser suite.
