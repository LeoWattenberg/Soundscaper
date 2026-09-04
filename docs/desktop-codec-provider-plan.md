# Desktop codec provider implementation plan

## Outcome

Desktop media operations resolve an exact operation through these providers, in
order:

1. reviewed codecs distributed with Soundscaper;
2. codecs supplied by the operating system;
3. an external `ffmpeg`/`ffprobe` installation selected by the user.

The production browser build contains no application-supplied FFmpeg runtime.
Desktop packages contain no Soundscaper application-provider FFmpeg executable, libav
library, or FFmpeg WASM payload. Electron's separately verified alternate
framework libffmpeg remains Chromium infrastructure rather than a Soundscaper
provider tier. The supported desktop targets remain Windows x64/ARM64, macOS
ARM64, and Linux x64/ARM64. The retired macOS x64 target remains unsupported.

## Implementation status — 2026-08-25

The desktop audio broker, exact provider order, main-owned settings, and seven
reviewed compressed-audio WebAssembly payloads are implemented. All seven are
registered for linux-x64, linux-arm64, mac-arm64, win-x64, and win-arm64;
mac-x64 is rejected rather than treated as a compatibility alias:

- libFLAC 1.5.0, 153,076 bytes, SHA-256
  `0f703571f95e37c24ad68577163ea56b4a9dd7d5576760700b482369e924f986`,
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
- LAME 4.0, 213,293 bytes, SHA-256
  `d624f2202ce5a560ca38bc156cb80441fe93ec799e59a35d0f9379a990256123`,
  for bounded MPEG-1 Layer III encode at 32, 44.1, or 48 kHz, mono or stereo,
  in Audacity's constant, average, variable, and preset bit-rate modes, with
  only the encoder's reviewed bitrate combinations admitted; and
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
identity check, bounded parser/output validation, and a codec canary. The
packaged runtime manifest authenticates each WASM file and the complete
transitive JavaScript module closure that can load it. Canary, preflight, and
execute each use a fresh, supervised Electron utility process; the main process
never imports or executes the codec modules. Startup canaries run in batches of
four, and at most four helper jobs may be active. Preflight and execute use
private sibling input/output scratch files, a 30-second default deadline with a
five-minute hard ceiling, cancellation that kills the helper, and a bounded
kill-completion deadline. Canary execution has a five-second ceiling. Helper
protocol, exit, output length, and output SHA-256 are checked before admission
or return. WavPack also retains the strict block/checksum authority and
independent stock decoder witness described below.

These codecs still take and return whole buffers through a 32 MiB request-input
and 128 MiB response-output contract. Except for the WavPack block loop, each
helper performs one synchronous WASM invocation internally. Process termination
can stop that invocation, but the buffers, WASM linear memory, codec working
state, JavaScript copies, elapsed time, and aggregate helper-process RSS and CPU
do not form one shared reservation.

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
workflow now builds the isolated Node-API codec addon target-native on mac-arm64,
win-x64, and win-arm64; it does not link the professional JUCE/device/plug-in
host. The build authenticates the exact Electron 43.1.1 headers and complete
repository source/build-plan identity, runs the native codec canaries, and
records the toolchain and payload digest. macOS applies and verifies only the
identity-free ad-hoc code seal required to execute the addon; it uses no
certificate or trust identity. Windows needs no corresponding seal.
Preparation, beforePack, afterPack, the package-content manifest, and startup
all bind the same exact manifest, payload, target, byte length, and SHA-256. A
supported package build fails closed if that matching target-native result is
absent or changes. Linux intentionally has no uniform OS tier and falls
straight through to external FFmpeg. mac-x64 is rejected at target selection,
build, staging, packaging, and runtime. This Linux development session cannot
execute the Windows/macOS native canaries; each target-native workflow records
what it built and tested and does not check native binaries into Git.

External FFmpeg CLI support is implemented for matching `ffmpeg`/`ffprobe`
released versions from 4.4 through 9.x (`>=4.4.0`, `<10.0.0`). Main fingerprints
the exact two executable files, probes exact capability sets, quarantines
identity changes, and admits only exact settings-correlated tuples. This
executable-pair identity does not claim to authenticate dynamically loaded
libraries or any other dependency closure.
Edit > Preferences > General shows the canonical location and status and owns
Browse, Clear, Rescan, and explicit Install actions. Installation uses the
exact WinGet package id `BtbN.FFmpeg.GPL.8.1` or an already installed Homebrew
binary with `brew install ffmpeg`; Soundscaper never bootstraps a package
manager, invokes `sudo`, or fetches/copies FFmpeg into its packages.

The external tier also implements the closed desktop keyed-RGBA delivery path:
H.264/AAC in MP4 through `libx264`/`aac`, and VP9/Opus in WebM through
`libvpx-vp9`/`libopus`. Capability tokens are only a prerequisite. Each exact
format must also pass a live, one-frame 16x16 RGBA plus 48 kHz stereo-audio
canary. The resulting finite MP4 or WebM structure must validate, then the exact
admitted `ffprobe` must report exactly two streams at indices 0 and 1: 16x16
`yuv420p` H.264 plus 48 kHz stereo AAC for MP4, or 16x16 `yuv420p` VP9 plus
48 kHz stereo Opus for WebM, before the format is exposed.
Renderer requests remain pathless and owner-scoped. Main binds video to private
descriptor 3 and optional audio to descriptor 4, creates private scratch and
the output path, and accepts or returns IPC ranges of at most 1 MiB. Admission
allows no more than two sessions globally and one per renderer owner. Fixed
arguments, exact input byte counts, duration/log/output ceilings, executable
identity checks, cancellation, cleanup, bounded output reads, container
validation, and digest-bound output evidence guard publication.

Bundled and operating-system video execution are not implemented. There is no
libwebm/libvpx/dav1d/SVT-AV1/libaom payload or AV1 execution path. The external
WebM delivery above is VP9, not AV1. AV1, bundled WebM, Media Foundation video,
and VideoToolbox video therefore advertise no execution capability and fail
closed rather than silently using the browser FFmpeg runtime. Historical AV1
candidate comparisons below are research notes, not a release matrix or a
machine qualification decision.

Copyright-license and technical evidence for these components is not patent
clearance or a non-infringement representation for any codec, use, provider,
territory, or distribution method.

## Provider boundary

- The strict-TypeScript coordinator and main broker own audio decode and encode.
  A separate closed session bridge owns exact keyed-RGBA H.264/AAC MP4 and
  VP9/Opus WebM delivery through external FFmpeg. Probe, trim, conform, remux,
  timing, proxy, general composed-video operations, bundled video, and
  operating-system video have not been migrated to that bridge.
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
  present. External VP9/Opus WebM availability does not clear this bundled gate.
- Treat dav1d 1.5.4, SVT-AV1 4.2.0, and libaom 3.14.1 only as research
  candidates, not shipped providers. Any future implementation must add real
  correctness and interoperability tests before it can expose an operation.
- Compare performance on representative media when implementation work begins;
  measurements are diagnostics and do not certify a provider or release.
- Pin source archives, hashes, build recipes, notices, patent-license texts,
  SBOM entries, corresponding source, and target payloads for any implementation.

### AV1 implementation finding

`libaom` is the reference AV1 implementation and includes both encode and
decode paths; it is not one comparable "fastest project" for both directions.
VideoLAN's dav1d is decoder-only and explicitly optimized for speed, size, and
correctness. These observations are historical candidate research only. A
future implementation must be selected from current correctness,
interoperability, and diagnostic results rather than a predeclared matrix.

SVT-AV1 is encoder-only and its current 4.2.0 release continues target-specific
speed/quality and memory work. It and libaom 3.14.1 remain possible future
encoder implementations rather than a default/fallback decision. There is no
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
- Admission is decided by the file, not by what the host says about it. The
  canary reads the AudioSpecificConfig out of the M4A itself on both targets
  and holds the media type to agreeing with it, rather than trusting an
  `audioProfileLevelIndication` an ordinary M4A need not carry, a sample
  description blob whose layout is not pinned, or the brand the container is
  written under. A refusal names the layer that produced it so an unattended
  target reports which rule it applied.
- MP3 encoding on Windows goes through an ACM codec wrapper, which is optional
  and absent from the hosted Windows Server images the product is built on. The
  canary therefore admits either an exact 192 kbps frame chain or a fail-closed
  refusal that leaves no output behind, since the tuple is served by the
  bundled reviewed encoder first and what a given machine can do is settled by
  the runtime capability query rather than at build time.
- The macOS ARM64 sources use AudioToolbox/Extended Audio File Services for the
  exact MP3/AAC tuples above. macOS has no admitted MP3 encoder. Media
  Foundation video and AVFoundation/VideoToolbox video remain disabled; the
  closed video bridge currently admits only external FFmpeg.
- The target-native CI job builds only the codec addon on mac-arm64, win-x64,
  and win-arm64, authenticates pinned Electron headers and the source closure,
  runs `ctest`, and emits a canonical build result. macOS payload bytes are
  given only an identity-free ad-hoc code seal and verified before hashing; no
  Developer ID identity or credential is accepted. Package preparation requires
  that result, stages exactly one manifest and one addon, and
  beforePack/afterPack/content-manifest/startup verification reject missing,
  changed, unsealed-on-macOS, wrong-target, duplicate, or foreign bytes.
- Linux has no uniform OS provider and falls from bundled codecs directly to
  external FFmpeg. macOS x64 is unsupported and has no build or compatibility
  alias. The exact canaries qualify only their listed tuples and do not claim
  general operating-system codec availability or patent clearance.

## External FFmpeg

- Use isolated CLI subprocesses rather than loading libav. Admit released
  versions `>=4.4.0` and `<10.0.0`, require a matching `ffmpeg`/`ffprobe` pair,
  enumerate capabilities, and bind deterministic canaries to the exact paths
  and SHA-256 digests of those two executable files. Dynamically loaded
  libraries remain outside that identity and may change independently.
- Discover a user-selected executable first, then a prior managed installation,
  package-manager prefixes/aliases, and system `PATH`. Identity changes return
  the candidate to quarantine until it is reprobed. A saved selection starts
  quarantined and is automatically reprobed before the desktop service is
  exposed; an unsuccessful probe creates no runtime admission.
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
  validation. The runner hashes both admitted executable files immediately
  before and after path-based spawn, but does not hold executable file
  descriptors across spawn; a time-of-check/time-of-use replacement remains
  possible. It has no operating-system RSS or CPU sandbox. The argument
  protocol allowlist constrains
  cooperative FFmpeg behavior, not a malicious user-selected executable, which
  retains its ordinary account and network authority. Publication beyond the
  in-memory audio response remains owned by the caller. Custom FFmpeg export
  remains explicit, external-only, and path/protocol constrained.
- Invoke exact keyed-RGBA video jobs through owner-scoped, pathless sessions.
  Main binds fixed arguments to private descriptor 3 for RGBA and descriptor 4
  for optional float WAV audio, owns private scratch/output files, and limits
  renderer input and output ranges to 1 MiB. Admit at most two sessions globally
  and one per renderer owner; expire idle sessions, enforce exact input offsets
  and lengths, supervise time/log/output bounds, and terminate and drain work on
  cancel, renderer revocation, or shutdown. An exact H.264/AAC MP4 or VP9/Opus
  WebM tuple is available only after its live 16x16 one-frame RGBA plus 48 kHz
  stereo-audio canary and finite-container validation pass against the current
  executable-pair identity. A shell-free exact `ffprobe` inspection then
  requires two streams at indices 0 and 1 with 16x16 `yuv420p` H.264/AAC or
  VP9/Opus and 48 kHz stereo audio. That inspector runs in the canary's private
  working directory and HOME/TMP environment, with a five-second deadline,
  64 KiB aggregate output bound, cancellation, and process-tree termination.
  The downstream keyframe output reader revalidates structure and SHA-256
  evidence before publication. This WebM path uses VP9, not AV1.

## Migration and acceptance

- Desktop and browser media composition is split at build time, and desktop
  FFmpeg WASM staging is absent. Audio import/export reaches the coordinator and
  exact keyed-RGBA desktop delivery reaches the external FFmpeg session bridge.
  Migration of probes, conform/trim/proxy work, general composed-video paths,
  bundled or operating-system video, and AV1 remains separate work.
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
