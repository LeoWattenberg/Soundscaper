# Desktop codec provider implementation plan

## Outcome

Desktop media operations resolve an exact operation through these providers, in
order:

1. reviewed codecs distributed with Soundscaper;
2. codecs supplied by the operating system;
3. an external `ffmpeg`/`ffprobe` installation selected by the user.

The browser build keeps its existing pinned FFmpeg WASM runtime. Desktop
packages contain no FFmpeg executable, libav library, or FFmpeg WASM payload.
The supported desktop targets remain Windows x64/ARM64, macOS ARM64, and Linux
x64/ARM64. The retired macOS x64 target remains unsupported.

## Provider boundary

- Add a strict-TypeScript desktop coordinator around the existing probe,
  decode, and encode ports, plus a transform port for trim, conform, remux,
  timing, proxy, and video delivery operations.
- Select a provider for the exact codec/container/direction/profile/sample or
  pixel-format tuple. Only `unavailable` and `unsupported` preflight results may
  fall through. Cancellation, invalid input, security failure, execution
  failure, or partial output is terminal.
- Keep renderer requests pathless. Main owns executable discovery, file grants,
  scratch storage, process supervision, cancellation, and atomic publication.
- Record the chosen provider, implementation/version identity, capability
  generation, normalized settings, timing/padding, and input/output digests in
  each operation receipt.

## Bundled provider

- Preserve the specialized WAV/BWF/BW64 and AIFF paths. Add libsndfile with
  libFLAC, libogg, libvorbis, and libopus for the wider native audio matrix.
- Use mpg123 for MPEG Layers I/II/III decode, LAME for MP3 encode, and TwoLAME
  for MP2 encode. Use native libwavpack for public WavPack import/export.
- Use libwebm with libvpx for VP8/VP9 WebM and Opus/Vorbis audio.
- Use dav1d 1.5.4 for AV1 decode on every supported target. Prefer SVT-AV1
  4.2.0 for AV1 encode on Windows x64, macOS ARM64, and Linux x64/ARM64.
  Qualify native SVT-AV1 on Windows ARM64; use encoder-only libaom 3.14.1 on
  that target only if SVT-AV1 fails the correctness or matched-quality
  performance gate. Do not distribute rav1e initially.
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

- On Windows, use Media Foundation Source Reader and Sink Writer directly.
  Enumerate Microsoft-supplied transforms, instantiate the exact tuple, and run
  a deterministic canary before advertising it. Missing Windows N components
  and optional codec packs degrade without affecting bundled codecs.
- On macOS ARM64, use AudioToolbox/Extended Audio File Services for standalone
  audio, and AVAssetReader/AVAssetWriter plus VideoToolbox for MOV/MP4. Select
  Apple implementations explicitly and canary exact settings.
- Linux has no uniform OS provider and falls from bundled codecs directly to
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
- Invoke runtime jobs without a shell, with fixed argument templates,
  `-nostdin`, local protocols only, no network, bounded time/RSS/output, opaque
  input/output grants, cancellation, and atomic publication. Custom FFmpeg
  export remains explicit, external-only, and path/protocol constrained.

## Migration and acceptance

- Split desktop and browser media composition at build time. Route all desktop
  imports, exports, probes, conform/trim/proxy work, and video deliveries
  through the coordinator before deleting desktop FFmpeg WASM staging.
- Replace the Framescaper FFmpeg-linked host with the product-neutral codec
  host so both desktop products share the same policy and payloads.
- Add resolver, codec round-trip, OS conformance, CLI-version, installer-broker,
  quarantine, cancellation, IPC, and package-inventory tests. Cover all five
  supported target rows; keep macOS x64 rejection tests.
- Desktop startup and bundled formats must work offline without external
  FFmpeg. Unavailable last-resort formats must show an actionable reason in the
  existing import/export UI.
- Final package audits must prove that desktop artifacts contain only admitted
  native codec payloads and no FFmpeg/libav/WASM runtime, while browser tests
  continue to verify the pinned browser runtime.
- Update licensing/security/payload/source-offer/threat-model evidence, sync
  derived policy narratives, repin digest-bound evidence, and pass native tests,
  `npm test`, `npm run build`, `npm run check`, and the full browser suite.
