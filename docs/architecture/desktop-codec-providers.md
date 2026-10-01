# Desktop codec providers

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

## Current implementation

The desktop audio broker, exact provider order, main-owned settings, and seven
reviewed compressed-audio WebAssembly payloads are implemented. All seven are
registered for linux-x64, linux-arm64, mac-arm64, win-x64, and win-arm64;
mac-x64 is rejected rather than treated as a compatibility alias:

- libFLAC 1.5.0, 154,763 bytes, SHA-256
  `6246c5d6979f25b733e399383004a6a861478802c376d59885a7b2c7130a1584`,
  for bounded FLAC encode/decode through the reviewed signed-24-bit profile;
- libopus 1.6.1 with libogg 1.3.6, 388,526 bytes, SHA-256
  `cc5577fa2a6c74781b7eb57bd754f7d9b50b2355a83d85b0f0cfe96415607dce`,
  for 48 kHz mono/stereo Ogg Opus encode/decode in Audacity's constant,
  variable, and constrained-variable bit-rate modes;
- libvorbis 1.3.7 with libogg 1.3.6, 526,926 bytes, SHA-256
  `cfa42717394ce29f8af676fb0ad7bff632306f75e536211eb85b7cc5aaf09aa0`,
  for 8–192 kHz mono/stereo Ogg Vorbis encode/decode;
- WavPack 5.9.0, 148,868 bytes, SHA-256
  `5197fb8fd8e6cbef210acad11eb2a9dd8395a519b5fd64ba14a1b4978041b0c5`,
  for 8–192 kHz, one-to-eight-channel float32 lossless `.wv`
  encode/decode at reviewed compression level 2 only;
- mpg123 1.33.7, 173,764 bytes, SHA-256
  `1aa30e6e25a9503be94ce3720ce6c4af649b2412c191a6f800f36dd619270bc2`,
  for feed-only float32 MPEG-1 Layer II/III decode at 32, 44.1, or 48 kHz,
  mono or stereo;
- LAME 4.0, 214,198 bytes, SHA-256
  `e8ca1786d95a56ead1fc2294be98ea68d31eed5837abd79d2a3322a0af946c6f`,
  for bounded MPEG-1 Layer III encode at 32, 44.1, or 48 kHz, mono or stereo,
  in Audacity's constant, average, variable, and preset bit-rate modes, with
  only the encoder's reviewed bitrate combinations admitted; and
- TwoLAME 0.4.0, 148,312 bytes, SHA-256
  `8b89b6a12eab302c92960865c6b1c7d33df86d6d8760c8549a8ee38a99ef2b30`,
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

The existing canary and small-buffer operations retain their 32 MiB request-input
and 128 MiB response-output contract. Bundled MP3, MP2, Opus, Vorbis, 24-bit FLAC,
and float32 lossless WavPack file exports also have a separate
continuous-session route: the renderer stages bounded PCM packets through the
main process, and a fresh authenticated utility process reads at most 16,384
frames per invocation. The same codec instance persists through the entire file.
Encoded packets and final header patches are at most 1 MiB each, and the main
process owns the scratch files and serves bounded output ranges. This route
admits up to one hour and 1,000,000,000 final file bytes, with a one-hour execution
deadline, cancellation, progress, and final codec geometry/checksum validation.
Neither input PCM nor encoded output accumulates in one JavaScript or WASM buffer.

The small-buffer helpers still perform synchronous WASM calls internally. Their
buffers, codec working state, JavaScript copies, and elapsed time do not form one
shared reservation for aggregate helper-process RSS and CPU.

A separate Linux x64 interoperability check built stock WavPack 5.9.0
`wvunpack` from the same pinned commit. It decoded a 1,240,560-byte,
three-channel, 48 kHz multi-block provider output into 2,362,380 bytes of raw
float32 PCM; expected and actual bytes both had SHA-256
`b7f8cd1d8e1a00374f618587eb2c5872fcd250d8686c9cbda0b46e00003ea40f`.
This is a narrow stock-decoder witness, not broad cross-version, cross-platform,
or producer interoperability qualification.

The continuous-session reference additionally generates 172,800,000 frames of
48 kHz stereo silence one packet at a time, writes the final MP3 and FLAC files
to disk, validates them with bounded file reads, then checks their codec,
channels, sample rate, and 3,600-second duration with stock FFprobe and decodes
each entire file with stock FFmpeg. The observed maximum retained PCM packet was
131,072 bytes. MP3's maximum encoded packet was 8,640 bytes and its final file
86,401,152 bytes; FLAC's corresponding sizes were 134 and 757,294 bytes. Run the
reference from the source checkout with:

```sh
SCAPE_LONG_AUDIO_ENCODE_REFERENCE=1 node --test tests/audio-editor-long-compressed-export-reference.test.ts
```

The test pins its stock decoder image by digest and verifies exact MP3 gapless
sample counts and FLAC frame CRCs before invoking the independent decoder.

Windows Media Foundation and macOS ARM64 AudioToolbox source adapters, exact
source inspectors, output validators, and live startup canaries are implemented
for 48 kHz stereo MP3 and AAC-LC/M4A decode, 48 kHz stereo 160 kbps AAC-LC/M4A
encode, and—on Windows only—48 kHz stereo 192 kbps MP3 encode. The production
workflow now builds the isolated Node-API codec addon target-native on mac-arm64,
win-x64, and win-arm64; it does not link the professional JUCE/device/plug-in
host. The build authenticates the exact Electron 43.7.7 headers and complete
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
identity changes, and admits only exact settings-correlated tuples. The runner
hashes both files immediately before and after path-based spawn but does not hold
their file descriptors across spawn, so time-of-check/time-of-use replacement
remains possible. The executable-pair identity does not authenticate dynamically
loaded libraries or any other dependency closure. Fixed no-shell commands,
protocol allowlists, a curated environment, private scratch, and resource bounds
constrain cooperative execution; they are not an operating-system filesystem,
network, RSS, or CPU sandbox. A malicious selected executable retains its
ordinary account and network authority.

Desktop external FFmpeg audio imports and exports and keyed video exports have
no fixed file-size cap. Audio selections use bounded file ranges; audio
operations still retain whole input/output buffers and therefore require enough
memory and scratch storage. Large audio requests bypass the 32 MiB input and
128 MiB output utility tiers. Explicit caller output bounds remain enforced,
and browser publication keeps its existing limits.

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
arguments, exact input byte counts, duration/log ceilings, executable
identity checks, cancellation, cleanup, bounded output reads, container
validation, and digest-bound output evidence guard publication.

Bundled and operating-system video execution are not implemented. There is no
libwebm/libvpx/dav1d/SVT-AV1/libaom payload or AV1 execution path. The external
WebM delivery above is VP9, not AV1. AV1, bundled WebM, Media Foundation video,
and VideoToolbox video therefore advertise no execution capability and fail
closed rather than silently using the browser FFmpeg runtime.

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
