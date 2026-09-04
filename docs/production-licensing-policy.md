# Production licensing and provenance policy

This policy defines the engineering evidence required before Soundscaper or
Framescaper distributes third-party code, data, fonts, WebAssembly, native
runtimes, plug-ins, codecs, or models. The machine-readable inventory is
[`config/production-licensing-matrix.json`](../config/production-licensing-matrix.json).
It records the concrete artifact and distribution state; it is not legal advice, a
patent opinion, or a declaration that any component is legally cleared for
every product, territory, or distribution channel.

Human licensing checks inform the repository owner's release decision. An
unresolved notice, source-delivery, license, or patent issue must be recorded
and the affected component must not ship, but no evidence register turns that
judgment into a separate admission process. Machine artifact identity, payload
presence, platform compatibility, containment, consent, and resource checks
remain fail closed at the point of use. A missing implementation or machine
payload therefore remains unavailable for its exact technical reason.

## Owner licensing notes

[`legalchecklist.md`](legalchecklist.md) is an editable worksheet for the
repository owner. It is not hashed, attested, signed, counted, or interpreted by
CI. The machine-readable matrix instead verifies concrete facts it can actually
check: dependency closure, source and notice files, artifact identity,
distribution surfaces, and whether a blocked component is absent.

The application remains AGPL-3.0-only and no separate EULA is selected. The
matrix records current copyright, copyleft, notice, corresponding-source,
patent-risk, trademark, native-audio, plug-in-hosting, local-model, capture, Web
VCR, retention, export-control, and operational-privacy positions. Open web
notice and versioned-asset delivery work stays visible in the relevant rows.
The refused-model review and all named
future-only reviews remain not satisfied.

The current distribution choice is provider-conditional: WebCodecs,
operating-system providers, and user-installed FFmpeg are allowed, while FFmpeg
or a bundled native FFmpeg media host is not redistributed. Consequently every
native FFmpeg tuple stays blocked despite the broader codec and patent-risk notes.
The Spleeter, Demucs, TransNetV2, PANNs, and other model records preserve their
documented upstream licence ambiguities as factual limitations. No missing
converted artifact, parity result, mirror read-back, catalog signature, notice,
or runtime evidence is fabricated or inferred from a recorded requirement.

The repository owner records licensing judgment as editable notes.
Package-content, payload-identity, source, notice, and isolation checks remain
technical safeguards and cannot turn those notes into legal approval.

## Dependency closure

The npm production closure is derived from package-lock version 3, not copied
from the direct dependency list. Every `packages` entry beneath
`node_modules/` whose `dev` flag is not `true` must have exactly one matrix row
with its locked version, lockfile license metadata, direct/transitive role,
notice marker, and artifact surfaces. Lockfile license metadata is evidence to
review; it does not replace the package's license text or resolve conflicts
between package metadata, bundled files, and upstream statements.

Electron is an explicit exception to that closure calculation. It is declared
as a development dependency because it is a packaging tool input, but the
downloaded Electron runtime, Chromium, and Node.js are shipped in desktop
products. Electron therefore has its own shipped-development-dependency row.
Electron's npm download helpers, electron-builder, `@electron/fuses`, and icon
build tools are not runtime rows: the package configuration excludes
`node_modules`, while Electron itself supplies the desktop runtime and its
embedded notices.

Any dependency or lockfile update must update the matrix and notices in the
same change. Removing a dependency also requires removing any statement that
it is currently packaged. Transitive production entries are covered even when
they contain only types or other build metadata; their matrix role records
whether bytes reach a production artifact.

## Distribution surfaces

The matrix treats these as separate distributions:

- the Cloudflare Pages application bundle;
- optional versioned web runtime assets, including FFmpeg;
- the desktop-specific Electron renderer, whose composition excludes the Web
  FFmpeg wrapper and core;
- translation and separately admitted runtime assets staged beside that
  renderer, including exact reviewed libFLAC, libopus/libogg,
  libvorbis/libogg, WavPack, mpg123, LAME, and TwoLAME WebAssembly audio
  providers but excluding application-supplied FFmpeg/libav, FFmpeg
  WebAssembly, and unqualified WebM/AV1 payloads;
- the Electron shell with embedded Chromium and Node.js, including Electron's
  exact alternate framework libffmpeg for the selected target; and
- public desktop packages and their release/source archive set.

A package's presence in the install closure does not prove that its bytes occur
on every surface. Conversely, a development dependency can be a shipped
runtime, as Electron demonstrates. Each surface must deliver the notices and,
where applicable, corresponding source required for the actual artifact.
Desktop packages copy the repository license, `THIRD_PARTY_LICENSES.md`, and
the retained license directory. Desktop preparation, pre-pack, post-copy, and
release-inventory gates reject application-supplied FFmpeg/libav and the FFmpeg
WebAssembly runtime. Separately, electron-builder replaces stock Electron
43.1.1's Chromium media library with Electron's matching alternate release
asset, intended upstream to omit proprietary codec support, and afterPack
runs `scripts/lib/electron-alternate-ffmpeg.mjs` to verify its exact target,
file type, byte length, and SHA-256 against
`config/electron-alternate-ffmpeg-manifest.json` before package finalization.
Packaging also validates the aggregate notice.
In addition, desktop assembly copies and audits the 28 exact codec component
NOTICE, license, source-manifest, and shared toolchain-license files under the
codec license resource tree; the aggregate notice is not the only notice
artifact shipped for these payloads.
The current web application has no versioned route or deployed notice artifact
for `THIRD_PARTY_LICENSES.md`; web notice delivery therefore remains blocked
even though the repository notice exists.

## Provenance evidence

Runtime provenance must identify the precise input appropriate to the form of
the work:

- npm packages use the lock path, exact version, resolved archive/integrity
  evidence where present, package license files, and an upstream source link;
- translated or adapted sources retain upstream project, revision, source
  paths, authorship and modification notices;
- generated WebAssembly retains source manifests, license hashes, toolchain,
  build flags, artifact hashes, and a reproducible audit command;
- remotely downloaded translations or runtimes retain versioned manifests,
  hashes, upstream source and license material; and
- Electron packages retain Electron and Chromium notices in addition to the
  application notice set. The alternate Electron framework libffmpeg also has
  one exact five-target manifest covering Electron version, release archive,
  archive digest, installed library name, byte length, and library digest.

Seven desktop compressed-audio runtimes meet the generated-WebAssembly rule:
libFLAC 1.5.0; libopus 1.6.1 with libogg 1.3.6; libvorbis 1.3.7 with libogg
1.3.6; WavPack 5.9.0; mpg123 1.33.7; LAME 4.0; and TwoLAME 0.4.0. Each has a
pinned source archive or revision, license and notice closure, Emscripten
3.1.64 build recipe, exact artifact byte length and SHA-256, a fail-fast audit,
and exact-identity desktop staging and startup checks. The matrix records the
individual values and evidence paths rather than treating a family name as an
artifact identity. This is engineering provenance and exact-slice verification,
not a copyright-license, corresponding-source, or patent conclusion beyond the
facts separately recorded for each component.

An audit status of `documented` means that checked-in provenance material is
present and its existing automated audit remains enabled. It is not a legal
approval. `blocked` means a required review, source bundle, notice, or delivery
path is absent, so the affected component must not be distributed. It does not
disable engineering access to an implemented surface. A row may move from
`blocked` only when the missing material is checked in and its automated check
passes.

The checked-in FFmpeg runtime policy manifest is an engineering integrity gate,
not a license or patent approval. It binds installed runtime bytes to the
current notice, source descriptor, licensing matrix, and release policy, and
its distribution checks are derived from the matrix's fail-closed distribution
checks. Its
payload digest is an internal consistency check, not a human or release
approval. It governs the optional Web runtime: public packaging
rejects that runtime whenever its notice, corresponding-source, or patent rows
are blocked, while build and test publication continue to depend only on the
exact machine-verifiable runtime closure. Its legacy desktop-assembly
distribution check is not consumed by the
current production desktop entry points and does not override the separate
desktop codec policy, which requires those Web runtime and
application-provider bytes to be absent. It does not prohibit Electron's
separately inventoried alternate framework library.

## Copyleft and corresponding source

The preferred source, build scripts, local modifications, configuration, and
required notices for copyleft runtime artifacts must accompany the applicable
distribution through a durable, versioned delivery path. A build-repository
archive is not automatically complete corresponding source for the binary it
produces, especially when its build downloads additional libraries.

Each desktop release therefore emits and checksums
`Soundscaper-<version>-bundled-codecs-corresponding-source.zip` as the preferred
source delivery for its seven exact reviewed audio codec WebAssembly modules.
Before any upstream request, release assembly binds each source manifest and
build script by SHA-256, verifies its local wrappers, WavPack source snapshot,
licenses, build helpers, and exact shipped WebAssembly identity, and rejects
unknown, missing, symbolic, stale, or oversized inputs. It then fetches the
manifest-pinned FLAC, LAME, mpg123, Ogg, Opus, TwoLAME, and Vorbis source inputs
over HTTPS, verifies their exact digests and bounds (including mpg123's detached
signature and signing key), and emits a deterministic ZIP receipt covering
every included byte. The bundled scripts prefer those archived inputs and pin
Node.js 26.5.0 and the digest-qualified Emscripten 3.1.64 toolchain. The rebuild
and replacement instructions explain that each upstream library and
Soundscaper wrapper is statically linked only inside a separately replaceable
WebAssembly module, not Electron itself. This closes source delivery only for
those seven desktop modules; it does not close the Web FFmpeg enabled-library
gate, any OS or external provider, or any patent review.

The Web `@ffmpeg/core` configuration enables FFmpeg plus x264, x265,
libvpx, LAME, libtheora, libvorbis, libopus, zlib, libwebp, FreeType, FriBidi,
libass, and zimg. The existing corresponding-source manifest pins an FFmpeg
archive and an ffmpeg.wasm build-source archive, but it does not inventory and
pin complete source for every enabled library. The enabled-library
corresponding-source gate remains blocked. The manifest's existence must not be
treated as completion of that gate.

## Codec and patent review

Copyright-license compatibility and patent exposure are independent reviews.
The Web FFmpeg build enables codec implementations whose patent situation can
vary by codec, use, territory, and distribution method. No
jurisdiction-specific patent review is checked in for the enabled set. The
patent-review gate therefore remains blocked. This policy makes no patent
clearance or non-infringement representation for any codec, including a codec
described by an upstream project as open or royalty-free. A future review must
name the exact build, enabled and invoked codecs, products, territories,
distribution surfaces, reviewer, date, assumptions, and any resulting
disablement or licensing requirements.

The same separation applies to Electron's Chromium media library. Stock
Electron 43.1.1 includes proprietary codec support; packaging selects
Electron's alternate asset intended upstream to omit it. Exact digest
verification establishes the selected framework bytes, not a complete codec
inventory, observed codec behavior, absence of patent exposure, or patent
clearance.

The bundled providers' BSD or LGPL copyright licenses, exact artifact reviews,
codec canaries, and narrow interoperability witnesses likewise do not establish
absence of patent exposure, patent clearance, or non-infringement in any
territory. The same rule applies to an operating-system codec and to a
user-installed FFmpeg executable; moving execution or distribution ownership
does not itself answer a patent question.

## Notices

`THIRD_PARTY_LICENSES.md` is the canonical human-readable aggregate notice.
`scripts/check-third-party-notices.mjs` checks pinned versions against the
lockfile; component-specific source manifests and notice files keep their
existing stronger hash and reproducibility audits. The aggregate notice must
cover every package in the production closure and every separately shipped
runtime. Passing the version check does not prove that the notice text is
legally sufficient.

Notice delivery is evaluated per surface. A repository file, external privacy
page, or desktop-only resource does not satisfy delivery for the web bundle or
its optional runtime origin. Web delivery remains blocked until the built site
contains a stable, accessible notice artifact linked from both products and
the runtime publication process verifies that the matching notice accompanies
each versioned runtime.

## Future distribution gates

The reviewed-effect catalog currently contains only Utility Gain, a repository-
owned inline WebAssembly conformance artifact distributed as application source
under the repository's AGPL-3.0-only license. Its literal artifact bytes,
release-catalog digest, and executable reference vectors are checked in; it
does not introduce a third-party package, transitive dependency, or separate
third-party notice. This narrow provenance record does not satisfy the gate for
adding externally authored or non-repository-owned effect packages.

The following capabilities may be implemented, built, packaged, and tested
before their human matrix requirements are complete. Their exact machine
dependencies still gate execution, and the recorded human requirements must be
resolved before the affected capability is distributed:

- externally authored or non-repository-owned reviewed web effect packages need
  a complete transitive inventory, immutable artifact/source pins, notice
  delivery, and sandbox/ABI review;
- native plug-ins need per-format and per-platform license and redistribution
  rules, user-installation policy, isolation, notices, and source delivery where
  required;
- native audio needs an authenticated JUCE/SDK source closure, an explicit
  license selection for each dual-licensed input, platform-API and ASIO
  trademark review, target notices, and representative owner QA on available
  devices;
- additional bundled video codec execution needs an exact codec/license
  inventory, corresponding source, package notices, target payload and
  verification, and distribution-specific patent review; and
- local models need licenses for code and weights, training-data provenance,
  model cards and use restrictions, exact hashes, and versioned offline notice
  delivery.

### Native audio, plug-in format, and codec policy rows

Electron's alternate framework libffmpeg is part of the Electron/Chromium
shell, not this provider system. It is distributed in each desktop package and
verified against `config/electron-alternate-ffmpeg-manifest.json` for exactly
Linux x64, Linux ARM64, macOS ARM64, Windows x64, and Windows ARM64; there is no
macOS x64 target. Renderer or Chromium use of that framework library does not
make it a bundled, operating-system, or external Soundscaper provider tier.

The desktop codec provider order is bundled implementation, operating-system
service, then user-installed external FFmpeg. That order is a selection policy,
not a general availability, legal, or performance claim. The specialized
first-party WAV/BWF/BW64 and AIFF PCM paths remain ordinary application code.
libsndfile is not bundled because those owners plus the direct libFLAC provider
cover the admitted matrix without adding a redundant general-purpose file
parser and its broader format surface.

Seven exact compressed-audio WebAssembly providers are supported on Linux x64,
Linux ARM64, macOS ARM64, Windows x64, and Windows ARM64, never macOS x64:
libFLAC 1.5.0 for signed-24-bit FLAC encode/decode; libopus 1.6.1 plus libogg
1.3.6 for 48 kHz mono/stereo Ogg Opus encode/decode; libvorbis 1.3.7 plus
libogg 1.3.6 for 8–192 kHz mono/stereo Ogg Vorbis encode/decode; WavPack 5.9.0
for the float32, compression-level-2 slice; mpg123 1.33.7 for feed-only
MPEG-1 Layer II/III decode at 32, 44.1, or 48 kHz, mono or stereo; LAME 4.0 for
the admitted MPEG-1 Layer III constant, average, variable, and preset
encode combinations at those rates; and
TwoLAME 0.4.0 for the supported MPEG-1 Layer II CBR encode combinations at
those rates. The matrix pins every payload's exact byte length and SHA-256.
Valid but unreviewed settings fall through; malformed input, validation failure,
security failure, execution failure, cancellation, or partial output is
terminal. WavPack retains its independent stock `wvunpack` 5.9.0 witness; that
witness verifies no other WavPack profile, version, or producer.

The desktop audio wire caps each input at 32 MiB and each returned output at
128 MiB. The compressed providers retain whole input and output buffers. Their
WASM and complete transitive JavaScript module closures are exact-byte and
SHA-256 authenticated from the packaged runtime manifest. Main does not import
those codec modules: every canary, preflight, and execute starts a fresh,
supervised Electron utility process. Startup canaries use batches of four and
the runner admits at most four concurrent helper jobs. Preflight and execute use
private sibling scratch files, a 30-second default and five-minute hard execution
ceiling, cancellation by helper termination, bounded kill completion, and exact
helper-protocol and output-digest checks; canaries have a five-second ceiling.
Other than WavPack's block loop, a helper still performs one synchronous WASM
invocation internally. Terminating the utility can stop that work, but the
contract is not an aggregate bound on JavaScript copies, WASM linear memory,
codec working state, helper-process RSS, CPU time, or elapsed time. Operation
receipts retain bounded provider identity, settings, capability generation, and
input/output digests, but their timing is `null` and makes no timing or padding
measurement claim.

Windows Media Foundation and macOS ARM64 AudioToolbox source adapters, bounded
source inspection, output validation, and live startup canaries exist for exact
48 kHz stereo MP3/AAC decode and AAC-LC/M4A encode; the AAC encoder tuple is
160 kbps and Windows additionally has a 192 kbps MP3 encoder tuple. macOS has
no supported MP3 encoder. A repository-owned codec-only Node-API addon is built
on target-native CI for macOS ARM64, Windows x64, and Windows ARM64. The build
authenticates pinned Electron headers and the repository source/build plan,
runs the exact native canaries, and records the toolchain and output digest.
macOS applies and verifies an ad-hoc execution seal before hashing; Windows has
no code-seal step. Release preparation and package/startup verification bind one
exact per-target manifest and payload and reject missing, changed, wrong-target,
duplicate, foreign, or non-executable macOS bytes. No codec library
is copied from the operating system into the package. Linux has no uniform OS
provider, and macOS x64 has no supported build or compatibility alias. These
controls verify only the enumerated tuples on a package whose target-native
build has passed; they do not establish general OS availability, patent
clearance, or non-infringement.

Bundled and operating-system video remain disabled. The application contains
no libwebm, libvpx, dav1d, SVT-AV1, or libaom payload and has no AV1 execution
path. It also has no supported Media Foundation or VideoToolbox video
operation. Historical candidate notes do not enable execution or select a
provider. The external WebM path described below uses VP9, not AV1. AV1 plus
bundled and operating-system WebM execution therefore remain disabled.

The final tier executes an FFmpeg program already installed on the user's
machine, whether found by bounded discovery, chosen explicitly, or installed
into the system package-manager prefix by Windows Package Manager or Homebrew
after explicit confirmation. The confirmed package-manager process performs
any network fetch and system installation; the application does not itself
fetch or copy FFmpeg bytes, package them, sublicense them, or redistribute that
program or its libraries, so those external bytes are outside the production
artifact closure. They are distinct from Electron's packaged alternate
framework library. Edit > Preferences > General displays the canonical
location and probe status and provides Browse, Clear, Rescan, and Install. The
Windows plan is the exact WinGet id `BtbN.FFmpeg.GPL.8.1`; the macOS and Linux
plan invokes `brew install ffmpeg` only through an already installed trusted
Homebrew executable. Neither plan bootstraps a package manager, invokes `sudo`,
runs at startup, or silently accepts changed package agreements.

The CLI adapter admits a matching `ffmpeg`/`ffprobe` pair with a normalized
released version `>=4.4.0` and `<10.0.0`, fingerprints both programs and their
exact executable-pair identity, probes capability sets, and binds exact codec
settings. That identity covers only the two paths and executable-file SHA-256
digests; it does not authenticate dynamically loaded libraries or another
dependency closure. This command-contract support is not release qualification
of every version or codec tuple in that range. The audio runner uses fixed
argument templates,
`shell: false`, `-nostdin`, a local protocol allowlist, a curated environment,
private scratch files, duration/log/output limits, cancellation, and strict
output validation. It hashes both admitted executable files immediately before
and after path-based spawn but does not retain executable file descriptors
across spawn, leaving a time-of-check/time-of-use replacement window. It has no
operating-system RSS or CPU sandbox. Its protocol allowlist constrains
cooperative FFmpeg behavior, not a malicious user-selected executable, which
keeps its ordinary user-account and network authority. These limits are
security boundaries and residual risks, not evidence about the external
program's license or patent posture.

The external tier also has a closed, owner-scoped video-session contract for
exact keyed-RGBA H.264/AAC MP4 through `libx264`/`aac` and VP9/Opus WebM through
`libvpx-vp9`/`libopus`. Encoder/muxer tokens alone do not enable either tuple:
the current executable pair must complete a live one-frame 16x16 RGBA plus
48 kHz stereo-audio canary and produce a structurally valid finite container.
The exact admitted `ffprobe` must then report exactly two streams at indices 0
and 1: 16x16 `yuv420p` H.264 plus 48 kHz stereo AAC for MP4, or 16x16 `yuv420p`
VP9 plus 48 kHz stereo Opus for WebM. Renderer requests carry no filesystem
paths. Main owns fixed command construction,
private descriptor 3 for video, optional descriptor 4 for audio, private scratch
and output files, exact sequential input lengths, and output range reads. IPC
chunks are at most 1 MiB; no more than two sessions may exist globally and one
per renderer owner. Idle, duration, log, and output bounds, executable-identity
checks, cancellation, renderer revocation, shutdown draining, cleanup, container
validation, bounded track checks, and digest verification guard output
publication. The five-second, 64 KiB `ffprobe` inspection uses a private
cwd/HOME/TMP environment,
fixed shell-free arguments, and process-tree termination. These controls do not
put FFmpeg or its dynamically loaded dependencies inside the Soundscaper
artifact closure and do not establish a copyright, patent, availability, or
performance conclusion for a user's installation.

The matrix's `nativeFormatPolicies` register carries one fail-closed row for
the JUCE native-audio stack, one per operating-system backend (CoreAudio,
WASAPI, ASIO, PipeWire and ALSA), and one per plug-in format (VST3, CLAP, Audio
Units, LV2, OFX). The acquisition register pins the exact JUCE, CLAP, VST3,
ASIO and LV2 source inputs and the four external native codec libraries. A
verified archive hash proves source identity only: it does not supply notices,
corresponding source, platform compatibility, self-tests, or package verification.

Native professional media
uses a finer inventory: each software operation is a distinct
`operation`/`codec`/`container`/`profile` tuple. H.264 and HEVC decode have
separate MP4 and MOV rows; AV1 decode has separate MP4 and WebM rows; VP9,
ProRes, and DNxHR name their exact WebM, MOV, or MXF container. PNG, TIFF, and
OpenEXR each have independent decode and encode image-sequence rows. Every
encode profile—H.264/MP4, VP9/WebM, the two HEVC Main10 deliveries, three
ProRes/MOV profiles, DNxHR HQX/MXF, FFV1/Matroska, and the three still
sequences—also owns its own row. A generic profile spanning two containers
depends on both rows, so clearing one combination cannot authorize the other.

Each row records the upstream licensing form, the compatibility direction
into this AGPL-3.0-only work (the ASIO SDK's selected GPLv3 arm combines
one-way via GPLv3 section 13; the VST3 3.8.0 SDK and other permissive SDKs
combine trivially; operating-system APIs and
platform encoder services are linkage, not combined source), the
redistribution posture, and the concrete source, notice, implementation, or verification fact still missing for that exact
tuple. Every codec tuple remains `blocked`; it additionally depends on the
blocked `codec-native-ffmpeg-current-set` row and the owning `native-codecs`
gate. This inventory does not change FFmpeg configure flags, publish a helper,
populate a payload manifest, or activate native media. Those remain separate
implementation changes after corresponding source, notices,
interoperability, self-tests, and five-target verification are present. User-installed
external FFmpeg and third-party plug-in binaries are never redistributed by
this project, so their licenses never enter the production artifact closure;
the codec and plug-in rows govern what the application itself may ship and
host.

### Local assistance model evidence

The four `local-models` enablement requirements are recorded per model in the
matrix rather than asserted once for the gate. Every entry in
`localModelEvidence` answers exactly those four requirement ids; a record that
omits one, or invents another, is refused by
`scripts/lib/local-model-evidence.mjs`.

Each requirement is `recorded`, `pending`, or `unresolved`. `recorded` means
the named information is present; it is not a release approval. `pending`
names information or an artifact that has not been produced, while `unresolved`
marks upstream information that is missing, conflicting, or unanswered and may
never resolve. The Spleeter, Demucs, TransNetV2, and PANNs licence-information
requirements record the documented upstream ambiguities themselves without
representing that an upstream clarification occurred. A model's `blockedBy` list and its
`distributionStatus` are derived from the remaining statuses and verified
against the authored values, so an incomplete artifact record cannot be
presented as an available model.

The `local-models` inventory records whether each model is distributable.
That status is not runtime authority: an implemented
model route may be installed and executed for testing when its exact catalog
entry, notices, byte lengths, digests, converted artifact, platform support,
memory bound, and consent checks pass. Pending or refused distribution
notes do not disable that test route. Artifact
authentication remains mandatory immediately before execution. Weights whose
terms forbid redistribution or commercial use remain unavailable
by pattern, and models this product has already excluded are listed in
`refusedLocalModels` with their reason so they are not accidentally admitted to
the catalog. Upstream locations belong in `provenanceSources`; `evidence` holds
repository paths only.

A source pin, direct artifact digest, conversion recipe, parity-fixture shape,
or locally generated catalog candidate is not an executable machine payload.
The owner has completed the human license, training-data, and model-card review
for wav2vec2, TIGER-DnR, PANNs Cnn10, Beat This small0/final0, TransNetV2, and
Qwen3. Each row still records `versioned-download-notices-and-hashes` as pending.
TIGER-DnR, PANNs Cnn10, Beat This, and TransNetV2 remain technically unavailable
until their converted artifact digests and source-framework parity results are
recorded; wav2vec2 and Qwen remain candidates until executable catalog entries
land. Externally signed catalog entries and artifact notice/read-back checks
remain required before model publication. Cataloged byte lengths and hashes authenticate
downloads and offline preseed, but do not assert that an EU R2 write or public
read-back occurred. The release publisher must complete public HEAD, Range, and
full SHA-256 read-back before a catalog is handed to the external signer.

Opaque placeholders do not make an unimplemented native feature available, and
a loader must not accept a missing, changed, wrong-platform, uncontained, or
unconsented machine payload. Conversely, an incomplete human licensing row
must not disable an implemented, machine-authenticated test route; it controls
whether the affected bytes may be distributed.

## Change procedure

For every new or changed production artifact:

1. identify every distribution surface and derive the complete dependency
   closure;
2. pin the exact artifact and preferred source, including transitive build
   inputs;
3. collect and retain license, copyright, attribution, and modification
   notices;
4. perform separate license, security, export-control where applicable, and
   patent reviews without treating one as the other;
5. add or update a fail-closed machine-readable gate and automated evidence;
6. verify that notices and corresponding source are delivered with each actual
   artifact; and
7. update the matrix date only after grounding every changed claim against the
   repository.

Unknown, conflicting, or incomplete evidence blocks distribution of the
affected artifact. It must not be converted into an optimistic status or a
silent exception.
