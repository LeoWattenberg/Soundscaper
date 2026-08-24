# Production licensing and provenance policy

This policy defines the engineering evidence required before Soundscaper or
Framescaper distributes third-party code, data, fonts, WebAssembly, native
runtimes, plug-ins, codecs, or models. The machine-readable inventory is
[`config/production-licensing-matrix.json`](../config/production-licensing-matrix.json).
It records evidence and fail-closed release state; it is not legal advice, a
patent opinion, or a declaration that any component is legally cleared for
every product, territory, or distribution channel.

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
- the Electron renderer copied from the web build;
- runtime assets staged beside that renderer;
- the Electron shell with embedded Chromium and Node.js; and
- public desktop packages and their release/source archive set.

A package's presence in the install closure does not prove that its bytes occur
on every surface. Conversely, a development dependency can be a shipped
runtime, as Electron demonstrates. Each surface must deliver the notices and,
where applicable, corresponding source required for the actual artifact.
Desktop packages copy the repository license, `THIRD_PARTY_LICENSES.md`, and
the retained license directory. Packaging revalidates the copied FFmpeg runtime
and aggregate notice against the checked-in policy before fuse or signing work.
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
  application notice set.

An audit status of `documented` means that checked-in provenance evidence is
present and its existing automated audit remains enabled. It is not a legal
approval. `blocked` means a required fact, review, source bundle, or delivery
path is absent. Gates may only move from `blocked` when the missing evidence is
checked in and an automated test verifies it.

The checked-in FFmpeg runtime policy manifest is an engineering integrity gate,
not a license or patent approval. It binds installed runtime bytes to the
current notice, source descriptor, licensing matrix, and release policy, and
its authorizations are derived from the matrix's fail-closed gates. Its review
marker and payload digest are self-declared consistency evidence, not an
independently authenticated approval. Local desktop assembly may use the
verified runtime for preview testing, while public runtime upload and the
current Soundscaper public desktop-release assembler remain blocked whenever
their notice, corresponding-source, or patent gates are blocked.

## Copyleft and corresponding source

The preferred source, build scripts, local modifications, configuration, and
required notices for copyleft runtime artifacts must accompany the applicable
distribution through a durable, versioned delivery path. A build-repository
archive is not automatically complete corresponding source for the binary it
produces, especially when its build downloads additional libraries.

The shipped `@ffmpeg/core` configuration enables FFmpeg plus x264, x265,
libvpx, LAME, libtheora, libvorbis, libopus, zlib, libwebp, FreeType, FriBidi,
libass, and zimg. The existing corresponding-source manifest pins an FFmpeg
archive and an ffmpeg.wasm build-source archive, but it does not inventory and
pin complete source for every enabled library. The enabled-library
corresponding-source gate remains blocked. The manifest's existence must not be
treated as completion of that gate.

## Codec and patent review

Copyright-license compatibility and patent exposure are independent reviews.
The FFmpeg build enables codec implementations whose patent situation can vary
by codec, use, territory, and distribution method. No jurisdiction-specific
patent review is checked in for the enabled set. The patent-review gate
therefore remains blocked, and this policy makes no representation that any
enabled codec is patent-free. A future review must name the exact build,
enabled and invoked codecs, products, territories, distribution surfaces,
reviewer, date, assumptions, and any resulting disablement or licensing
requirements.

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

The following broader capabilities remain disabled until their matrix
requirements are implemented:

- externally authored or non-repository-owned reviewed web effect packages need
  a complete transitive inventory, immutable artifact/source pins, notice
  delivery, and sandbox/ABI review;
- native plug-ins need per-format and per-platform license and redistribution
  rules, user-installation policy, isolation, notices, and source delivery where
  required;
- native audio needs an authenticated JUCE/SDK source closure, an explicit
  license selection for each dual-licensed input, platform-API and ASIO
  trademark review, target notices, signed packages, and provisioned device-lab
  evidence;
- native codecs need an exact codec/license inventory, corresponding source,
  package notices, and distribution-specific patent review; and
- local models need licenses for code and weights, training-data provenance,
  model cards and use restrictions, exact hashes, and versioned offline notice
  delivery.

### Native audio, plug-in format, and codec policy rows

The matrix's `nativeFormatPolicies` register carries one fail-closed row for
the JUCE native-audio stack, one per operating-system backend (CoreAudio,
WASAPI, ASIO, PipeWire and ALSA), and one per plug-in format (VST3, CLAP, Audio
Units, LV2, OFX). The acquisition register pins the exact JUCE, CLAP, VST3,
ASIO and LV2 source inputs and the four external native codec libraries. A
verified archive hash proves source identity only: it does not satisfy legal,
trademark, corresponding-source, signing, hardware, or activation review.

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
redistribution posture, and the named review still missing for that exact
tuple. Every codec tuple remains `blocked`; it additionally depends on the
blocked `codec-native-ffmpeg-current-set` row and the owning `native-codecs`
gate. This inventory does not change FFmpeg configure flags, publish a helper,
populate a payload manifest, or activate native media. Those remain separate
reviewed changes after corresponding source, notices, patent posture,
interoperability, signing, and five-target evidence clear. User-installed
third-party plug-in binaries are never redistributed by this project, so their
licenses never enter the production closure; the plug-in rows govern what the
application itself may ship and host.

### Local assistance model evidence

The four `local-models` enablement requirements are recorded per model in the
matrix rather than asserted once for the gate. Every entry in
`localModelEvidence` answers exactly those four requirement ids; a record that
omits one, or invents another, is refused by
`scripts/lib/local-model-evidence.mjs`.

Each requirement is `recorded`, `pending`, or `unresolved`, and only `recorded`
satisfies it. `pending` marks evidence this milestone cannot hold yet, naming
the stage that will produce it; `unresolved` marks upstream evidence that is
missing, conflicting, or unanswered and may never resolve. A model's
`blockedBy` list and its `distributionStatus` are derived from those statuses
and verified against the authored values, so an incomplete record cannot be
converted into a distributable one.

Recording a model does not enable the gate. Weights whose terms forbid
redistribution or commercial use are refused by pattern, and models this
product has already excluded are listed in `refusedLocalModels` with their
reason so they are not reintroduced later. Upstream locations belong in
`provenanceSources`; `evidence` holds repository paths only.

Opaque placeholders for unavailable native features do not authorize shipping
their implementation. Enabling a capability flag, adding a loader, or accepting
user-provided binaries must not bypass the relevant distribution gate.

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
