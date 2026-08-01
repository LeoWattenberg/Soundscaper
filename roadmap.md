# Soundscaper and Framescaper production roadmap

> Engineering roadmap, last grounded against the repository on 2026-08-01.
> Milestones are ordered by dependency and close only when their exit gates pass;
> they are not release-date promises.

Soundscaper and Framescaper are two focused products over one local-first,
mixed-media editor and one canonical `.scape` project format. This roadmap takes
them from the current capable editor to complete professional editorial
workflows on the web and in Electron. "Full" means that recording, editing,
mixing, picture editorial, finishing, and delivery can be completed end to end.
It does not mean copying every feature of every specialist creative suite.

MIDI and Framescaper recording are intentionally the final product capabilities.
In particular, Soundscaper will not invent an interim MIDI schema or UI while
Audacity's MIDI design is still pending.

Through milestones 1–7, the following fences are normative:

- `export-midi`, `midi-device-info`, and `local://midi-track` remain disabled or
  excluded and inert;
- no MIDI schema fields, ports, capability flags, dependencies, imports,
  exports, UI placeholders, event input, instruments, device enumeration, or
  prototypes are added; and
- no new Framescaper recording capability flag, command, schema, adapter, IPC,
  permission expansion, or UI is added. Existing Soundscaper microphone and
  desktop/system-audio recording remains supported and may be maintained.

## Product boundaries and invariants

- Editing remains local-first, usable without an account, and offline after the
  application and any optional runtime assets have been installed or cached.
- `.scape` remains the lossless cross-product project format. AUP4 remains an
  audio-only Audacity interchange format rather than a Soundscaper backup.
- The web and Electron products share the project domain, commands, migrations,
  and as much UI as practical. Native services sit behind narrow adapters and
  never fork the canonical project model.
- Unsupported native effects, routes, or codecs are preserved as opaque state.
  Freeze, bounce, or proxy media provides an audible/visible fallback when a
  project crosses to a less capable platform.
- Electron keeps its sandboxed renderer, disabled Node integration, validated
  IPC, CSP, and fuse hardening. Native helpers do not expose unrestricted paths,
  processes, or plug-in code to the renderer.
- Large codec and model runtimes stay out of the Cloudflare Pages bundle.
  Preserve the 25 MiB Pages asset ceiling, the 500,000-byte JavaScript chunk
  ceiling, exact source hashes, corresponding-source archives, and notices.
- Accessibility, keyboard operation, deterministic history, bounded working
  sets, interruption recovery, and migration safety are release requirements,
  not later polish.

The following are not completion requirements:

- mandatory cloud accounts, hosted collaboration, or hosted AI;
- score engraving and notation-suite parity;
- live-performance clip launching;
- After Effects/Fusion-class deep node compositing or a 3D suite;
- capture-card, SDI, deck-control, or live-broadcast switching workflows;
- AAX hosting; or
- proprietary codecs or plug-ins whose distribution terms have not passed a
  documented licensing and patent review.

## Status and platform notation

Status labels have an evidence requirement:

| Status | Meaning |
| --- | --- |
| **Implemented** | Present in the maintained product and covered by the relevant automated gate. |
| **In progress** | Active work exists, but it has not yet passed the maintained-product gate. |
| **Planned** | Accepted scope whose prerequisite milestone is not yet complete. |
| **Blocked** | Accepted scope waiting on a named external decision or dependency. |
| **Optional** | Valuable work that does not block the definition of full functionality. |

Every roadmap item also carries one or more platform labels:

| Label | Contract |
| --- | --- |
| **Shared** | Canonical domain, schema, command, or UI work used by both products and platforms. |
| **Web Core** | Must work on the supported evergreen Chromium, Firefox, and Safari matrix without relying on a limited-availability API. Electron inherits this tier. |
| **Web Enhanced** | Enabled only after runtime capability detection; a documented Web Core fallback is mandatory. |
| **Electron Enhanced** | The same user outcome exists on the web, but a sandboxed native service improves scale, latency, codec coverage, or reliability. |
| **Electron Only** | Depends on an OS/native facility unavailable to a normal web origin. Projects must still open safely on the web. |

These labels describe the target contract. The maintained functional suite now
targets Playwright Chromium, Firefox, and WebKit. Those engine runs remain
provisional and do not by themselves qualify Safari or the fixed-GPU
performance budgets required before **Web Core** becomes a release guarantee.

"Electron Only" is a product-support boundary, not a claim that equivalent
computation is theoretically impossible in WebAssembly. It is used where the
web cannot promise the required device access, latency, background lifetime,
codec availability, storage size, or fault isolation.

## Current foundation

The roadmap builds on what exists instead of re-planning it.

| Area | Status | Current foundation |
| --- | --- | --- |
| Shared project core | **Implemented** | One mixed-media schema, revisioned commands/history, autosave, project locks, Project Bin, `.scape` portability, and shared browser handoff between products. |
| Storage and scale | **Implemented** | Immutable chunked PCM, OPFS with IndexedDB fallback, bounded source caches, streamed large WAV paths, retained media originals, disposable derivatives, and storage-capacity preflight. |
| Soundscaper | **Implemented** | Multitrack and routed recording, mono/stereo clips, sample and spectral editing, clip envelopes, buses and sends, master/track effects, macros, analysis, surround/ADM beds, broad audio export, legacy `.aup` and `.aup3` import, and `.aup4` import/export. |
| Framescaper | **Implemented** | MP4/M4V/WebM ingest, linked A/V lanes, Project Bin placement, layered video tracks, trim/split/stretch domain operations, ripple edits, two-clip linear crossfades, WebGL preview, and MP4/WebM rendering. Its product profile disables recording and its recording shortcuts are inert. |
| Video effects batch 1 | **Implemented** | Color Adjust, Pixelate, Vignette, Gaussian Blur, Sharpen, and RGB Split with ordered stacks, undo, WebGL preview, and allowlisted FFmpeg export. |
| Video effects batch 2 | **Implemented** | Chroma Key, Luma Key, Spill Suppression, Glow, Outline, and Drop Shadow, including new controls, project migration, preview/export parity, and benchmarks. |
| Electron | **Implemented** | Hardened offline wrapper with native dialogs, capability-scoped reads, atomic chunked saves, menus, lifecycle handling, associations, packaged runtimes, Windows system-audio selection, and a product-neutral current-schema latest-project library. It is not yet a native media engine. |
| Automated evidence | **Implemented** | Broad Node coverage plus a maintained Playwright Chromium/Firefox/WebKit functional matrix, deterministic video-effect parity fixtures, desktop smoke tests, architecture limits, chunk-size checks, and reproducibility audits. |

Material constraints in the current foundation are also roadmap inputs:

- video uses the audio-sample timeline and a nominal 30 fps source value rather
  than a rational sequence timebase and probed frame metadata;
- video import depends on browser-native `<video>` decoding, and automatic
  export is capped at 1280x720 and 30 fps;
- FFmpeg WebAssembly is single-threaded, serialized through one worker, and
  returns complete in-memory outputs;
- `.scape` now streams to selected File System Access and desktop targets.
  Main assigns immutable desktop-read profiles before publication: Audacity and
  other materialized inputs retain a 512 MiB per-owner aggregate ceiling, while
  canonical native-dialog and OS-associated `.scape` files use a separate
  range profile with at most four pending/live capabilities and 65 GiB of
  admitted bytes globally and per committed-document owner. The range protocol
  permits one active request globally and only exact closed `GET` ranges of at
  most 16 MiB. One shared router and awaited file-service scope span inspection,
  any open decision, and import without assembling a renderer `Blob`, then
  release the descriptor exactly once. One exact 8 GiB sparse Zip64 witness now
  keeps current-schema inspection and collision cancellation payload-lazy with
  less than 8 MiB transferred. A separate witness imports the authentic pinned
  asset through that real range pipeline into a counting independent-SHA
  transactional sink with zero retained payload, bounded emissions, project
  publication, and exact release/close. Import now also checks the validated
  manifest asset-byte sum plus ten-percent rounded-up headroom against any known
  store estimate before extraction. Those reference-scale Node witnesses do not
  qualify their 8 GiB path in packaged Electron UI, real browser quota behavior,
  durable OPFS/IndexedDB storage, reserved or
  write-time capacity under concurrent imports, renderer/browser heap,
  main/renderer RSS, whole-archive storage atomicity, or publisher
  authentication. A separate maintained packaged Soundscaper Linux x64 smoke
  production-exports an exact-schema-9 project with one mono source, track, and
  clip: 16,384 Float32 frames at 48 kHz and a 65,540-byte framed PCM asset in an
  archive larger than the 65,557-byte ZIP end-search suffix and no larger than
  96 KiB. Passing that `.scape` positionally to the packaged executable now
  qualifies native open-argument extraction and pending dispatch, the main-owned
  `scape-range-v1` descriptor, preload delivery, renderer routing and range
  protocol, inspection/import into real packaged application storage, activation,
  exact visible identities and success, plus a capability observed live before
  delivery and retired after open. Its sanitized result exposes no capability ID,
  URL, or path. The aggregate gate now verifies the archive unchanged, cleanly
  exits that first process, removes the archive, and starts the same package with
  the same isolated roots but no positional `.scape`, read descriptor, or
  capability. Normal bootstrap automatically reopens the source-bearing project,
  including its exact source/track/clip relations and a PCM-backed waveform. This
  same second process proves that the known reopened fixture's stored PCM enters
  the editor playback graph. It requires exact enabled `Play` and `Stop` controls;
  `Play` exposes an active, pressed `Pause`, and during that same active interval
  the playhead advances and the master playback meter rises above its declared
  floor. Explicit `Stop` restores enabled, unpressed `Play` and resets the playhead
  to zero. This qualifies only orderly process-restart automatic source-bearing
  persistence and reopen plus transport entry, playback-clock advancement,
  master-meter activity, and explicit stop and reset for that known current-schema
  fixture. This is not installer/file-association registration or a shell launch,
  reference-scale packaged import, or proof of payload laziness beyond the known
  range route. It does not qualify audible or device output because the harness
  passes `--mute-audio`, playback fidelity, dropout- or glitch-free playback,
  full-duration playback, mixer, routing, or effect correctness, storage
  durability or crash/power-loss/fsync behavior, eviction, quota/reservation/
  concurrency, heap/RSS, another OS/architecture/product, Windows/macOS/ARM,
  Framescaper, cross-product transfer, arbitrary third-party ZIP/effect coverage,
  or legacy Soundscaper compatibility.
  Third-party gating and legacy compatibility are not current priorities;
  Audacity project interchange remains separate. Browser `.scape` files retain
  their Blob source. Several
  compressed imports and browser-download fallback retain bounded or
  reference-scale paths that materialize a whole `Blob` or byte array. Final
  render formats and routes outside the narrow exact-size, realtime
  WAV/AIFF/BWF/BW64
  direct-save slice described below retain that limitation as well;
- browser storage remains quota- and eviction-bound;
- the two Electron products retain separate Chromium partitions for their
  product-local revision, source, and media shadows, while exact-schema-9 latest
  project metadata is shared through the main-process library; source and media
  bytes are not yet cross-product desktop storage;
- no native codec worker, audio backend, effect host, or background job service
  exists; and
- the maintained browser suite targets all three Playwright engines, while
  Safari release qualification and fixed-GPU performance evidence remain open;
- shared web and Electron policies permit the microphone/display access used by
  Soundscaper, while camera access is explicitly denied; and
- Framescaper does not expose any recording workflow despite preserving shared
  audio/video project state.

## Milestone sequence

Milestones 1 and 2 establish shared contracts. Soundscaper and Framescaper then
advance in parallel through milestones 3 and 4. Native services consume those
contracts in milestone 5, and professional delivery closes in milestone 6.
Milestone 7 is optional and may be skipped. Milestone 8 is deliberately the last
feature milestone: Framescaper capture lands there, and MIDI is its final
sub-phase. Milestone 9 requalifies the complete system.

Earlier milestones may ship independently. The roadmap as a whole is not
complete until milestones 8 and 9 close.

## 1. Baseline contracts and quality budgets

**Goal:** turn "professional" and every platform tier into reproducible,
reviewable gates before expanding the schema or native boundary.

### Deliverables

- **Shared — Implemented:** maintain a checked-in
  [capability inventory](config/production-capabilities.json) for each product,
  platform tier, supported OS/architecture, import/export family, and project
  feature, kept aligned with product profiles by the
  [inventory contract test](tests/production-capability-inventory.test.js).
- **Web Core — Implemented (provisional):** the maintained
  [Playwright project matrix](playwright.config.mjs) runs the functional suite
  against Chromium, Firefox, and WebKit in the pinned
  [quality workflow](.github/workflows/quality.yml). Its
  [configuration regression](tests/playwright-config.test.js) prevents an
  engine or desktop verification install from disappearing. Cross-engine media
  and pointer fixtures preserve the same assertions without product skips;
  Safari and performance qualification remain governed by the quality budget.
- **Shared — In progress:** the versioned
  [quality-budget contract](config/quality-budgets.json) pins browser and tool
  revisions, named fixtures, project sizes, measurement procedure, and numeric
  thresholds for milestones 1–9. Its fail-closed
  [evaluator](scripts/quality-budget-evaluator.mjs),
  [regression](tests/quality-budgets.test.ts), and
  [operator procedure](docs/quality-budgets.md) reject missing metrics,
  environment mismatches, and software rendering for hardware gates. The fixed
  GPU host remains explicitly unprovisioned, so no workload is yet recorded as
  production-qualified and this deliverable's exit gate remains open.
- **Shared — Implemented:** the pinned
  [Audacity action inventory](src/common/editor/audacity-action-parity.js) maps
  every action through a focused
  [roadmap disposition policy](src/common/editor/audacity-action-roadmap.ts).
  The [audit regression](tests/audacity-action-parity.test.js) keeps relevant
  project, selection, alignment, sorting, spectral, recording, and raw-import
  gaps planned and retains explicit reasons for every justified exclusion.
- **Shared — Implemented:** the versioned
  [project compatibility matrix](config/project-compatibility.json) and
  [compatibility contract](docs/project-compatibility.md) define forward
  read-only behavior, type-specific opaque preservation, the minimum retained
  migrations, freeze/proxy fallback requirements, and schema-retirement rules.
  Its [policy regression](tests/project-compatibility-policy.test.js) keeps the
  unimplemented future-archive guarantee explicitly planned while verifying the
  bounded current-schema binary-opaque `.scape` contract.
- **Shared — Implemented:** the machine-readable
  [severity policy](config/release-severity-policy.json) and its
  [release, waiver, and recovery procedure](docs/release-policy.md) fail closed
  for data loss, A/V drift, audio dropout, dropped video frames, inaccessible
  workflows, security boundary failures, and license/provenance failures. The
  [policy regression](tests/release-severity-policy.test.js) requires zero open
  critical or high defects and prevents waivers from redefining quality budgets.
- **Shared — Implemented:** the versioned
  [security control matrix](config/production-security-matrix.json) and
  [production threat model](docs/production-threat-model.md) cover malformed
  projects/media, archive expansion, native helpers, third-party plug-ins, path
  capabilities, job cancellation, and release provenance. The
  [security regression](tests/production-security-matrix.test.js) keeps partial
  controls visible, verifies the satisfied current-surface archive-expansion
  gate, and prevents planned helper and plug-in surfaces from being treated as
  enabled. Within the still-partial project-document risk, the format-specific
  legacy [`.aup` XML parser](src/common/editor/aup-legacy-xml.ts) now caps both
  authoritative declared size and the independently measured UTF-8 byte length
  of returned text at 16 MiB, retained elements at 100,000, attributes at
  400,000, and depth at 128
  through non-raiseable ceilings with lower-only test seams. Structural
  rejection occurs before any `_data` block read, conversion, project or source
  persistence, or imported-project publication, as covered by the focused
  [parser](tests/audio-editor-aup-legacy.test.js) and
  [import-boundary](tests/audio-editor-aup-legacy-import-boundary.test.ts)
  regressions. The legacy
  [block/PCM budget](src/common/editor/aup-legacy-block-budget.ts) now also caps
  selected companion files and materializing simple/silent references at
  65,536 each, referenced physical files at 2 MiB, AU sample payloads at 1 MiB,
  decoded or silent blocks at 524,288 frames, authoritative unique referenced
  bytes at 512 MiB, and retained Float32 PCM at 512 MiB. Checked lower-only
  admission charges repeated references, silence, and linked-track zero-fill;
  requires positive block lengths, a complete AU header, and equal paired
  linked-channel lengths; and rejects retained-PCM geometry before allocation
  or block reads. AU payload/frame rejection precedes decoded-block allocation,
  and returned bytes must equal snapshotted `File.size`. Bounded exact/basename
  indexes prevent reference-by-file lookup multiplication. Native-endian
  Audacity AU data is supported, each unique block is read and decoded once,
  and preallocated clip outputs limit the logically reachable parser-owned
  window beyond retained PCM to one 2 MiB encoded file and one 2 MiB decoded
  block. Equal or admitted zero-padded linked channels reach conversion without
  normalization copies. The focused
  [block regressions](tests/audio-editor-aup-legacy-block-budget.test.ts),
  [compatibility regressions](tests/audio-editor-aup-legacy-block-compatibility.test.ts),
  and late-failure import-boundary fixture prove refusal before conversion,
  project/source persistence, or imported-project publication. This control is
  intentionally scoped to canonical default-sized blocks: customized Audacity
  block sizes above the policy ceilings remain unsupported. The tier also
  leaves XML/opaque clone amplification, elapsed time and cancellation,
  aliases, provider-internal copies and garbage-collection lag, downstream
  conversion, waveform, storage, and persistence working sets, total renderer
  RSS, noncanonical AU padding, other project families, streaming-scale legacy
  import, and cross-format malformed/fuzz corpus coverage open.
  Controlled FFmpeg publication, desktop staging, pre-pack and
  packaged-resource verification, and the current Soundscaper public
  desktop-release assembler now share one
  [checked-in policy manifest](config/ffmpeg-runtime-manifest.json) with
  [offline invalid-preflight/post-stage-tamper](tests/ffmpeg-runtime-manifest.test.js)
  and [post-copy package-tamper](tests/desktop-packaged-ffmpeg-runtime.test.js)
  regressions. This closes repository-owned publication admission and the
  Electron extra-resource copy boundary. The milestone-2 control below now adds
  bounded browser pointer/manifest/asset verification and two-version rollback;
  independently authenticated approval, publisher-to-pointer authenticity,
  conditional remote creation, and read-back qualification remain planned.
- **Shared — Implemented:** the
  [licensing and provenance matrix](config/production-licensing-matrix.json)
  derives the exact production lockfile closure and separates every web,
  runtime, and desktop distribution surface. Its
  [policy](docs/production-licensing-policy.md) and
  [regression](tests/production-licensing-matrix.test.js) keep web notice
  delivery, complete FFmpeg corresponding source, and codec patent review
  blocked until their missing evidence is delivered; future plug-in, codec,
  package, and model surfaces remain disabled.
- **Soundscaper — Blocked (fence implemented):** leave every MIDI action,
  including MIDI export, disabled. The
  [action contract](src/common/editor/audacity-action-parity.js) points to
  milestone 8B and the pending Audacity design, not to an interim local design.
- **Soundscaper — Blocked (fence implemented):** the
  [MIDI action fence](tests/audacity-action-parity.test.js) and
  [capability/dependency fence](tests/production-capability-inventory.test.js)
  snapshot `export-midi`, `midi-device-info`, and `local://midi-track` as inert
  through milestone 7 so a menu, shortcut, dependency, or experimental surface
  cannot bypass the fence.

The in-progress 12-effect 1280x720 preview benchmark becomes a permanent gate
when that batch lands: on a hardware renderer its p95 frame interval remains at
or below 33.34 ms and retained JavaScript heap growth remains at or below 1 MiB
after its measured frame window and forced collection. Later benchmark changes
must document the hardware, driver, browser, fixture, and reason.

### Exit gate

- Capability, compatibility, security, licensing, browser, and OS matrices are
  versioned and linked from this document.
- Each later milestone has named fixtures and machine-readable thresholds rather
  than subjective "works well" criteria.
- Current fixtures run repeatably in CI or in an explicitly documented,
  reproducible benchmark job.
- Every Audacity action has an implemented, planned, blocked, or justified
  excluded disposition.

## 2. Shared platform, storage, and media foundation

**Depends on:** milestone 1.

**Goal:** make large, capability-varying projects safe before adding new editing
models or native implementations.

### Deliverables

- **Shared — Implemented:** the read-only
  [`PlatformCapabilities` snapshot](src/common/editor/platform-capabilities.ts)
  separates detected APIs from affirmative initialized-adapter probes and
  reports Web Core, Web Enhanced, Electron Enhanced, and Electron Only status
  without user-agent inference. Its
  [contract regression](tests/audio-editor-platform-capabilities.test.ts)
  clamps claims to prerequisites, verifies the exact desktop bridge groups,
  deep-freezes every snapshot, and keeps deferred MIDI and Framescaper capture
  fields absent.
- **Shared — Implemented:** focused strict-TS owner modules under
  [`platform/`](src/common/editor/platform/) define narrow, abortable ports for
  bounded streaming media reads/writes, probe, decode/encode, render jobs, audio
  devices, and audio-effect hosts. The
  [port regression](tests/audio-editor-platform-ports.test.ts) requires an
  `AbortSignal` on every long-running operation, validates transfer hard limits,
  and prevents a broad barrel or domain/UI implementation dependency.
- **Shared — Implemented (fence):** the
  [platform contract policy](src/common/editor/platform/contract-policy.ts)
  keeps MIDI events/devices and Framescaper capture contracts explicitly
  blocked for milestones 8B and 8A; generic adapters cannot quietly commit
  either model ahead of its entry gate.
- **Shared / Web Core — In progress:** internal `.scape` import and inspection
  now share a strict-TS
  [archive envelope](src/common/editor/scape-archive-envelope.ts) that bounds
  metadata and declared expansion with non-raiseable hard limits, rejects
  encrypted/extra/aliased entries, and verifies descriptor ownership before
  storage writes. After project migration, a strict-TS
  [source/asset index](src/common/editor/scape-project-assets.ts) also requires
  equal source and descriptor counts, unique exact IDs, and identical media
  kinds before collision handling, transaction creation, or any storage call.
  Its focused
  [identity regression](tests/audio-editor-scape-project-assets.test.ts) and
  [archive workflow regression](tests/audio-editor-scape-archive-envelope.test.ts)
  cover reordered canonical descriptors plus orphan, missing, duplicate,
  invalid, and kind-mismatched identities. The portable format's structural
  integrity gate is therefore enforced for its current surface. One shared
  [actual-byte budget](src/common/editor/scape-expanded-byte-budget.ts) charges
  manifest, project, and every extracted asset chunk before retention, while
  checked PCM geometry keeps its framing buffer to 16 MiB plus four bytes.
  Non-raiseable ceilings of 4,096 archive entries and 65,536 PCM chunks per
  archive also bound pairwise layout comparisons and semantic writer work;
  export preflights the same ceilings before destination or asset work and
  rejects noncanonical or truncated backing-store PCM. Central-directory
  indexing now requires ZIP STORE with equal compressed and uncompressed sizes
  before local-header preflight or body reads, and canonical export pins the
  same policy. Before zip.js allocation or enumeration, a bounded strict-TS
  [raw-layout validator](src/common/editor/scape-archive-layout.ts) now anchors
  exact classic/Zip64 end and central-directory records, resolves required
  Zip64 fields in order, compares each local header and signed or unsigned data
  descriptor with its central owner, and requires checked entry ranges to
  partition the payload region without overlap, gaps, or central-directory
  crossing. A shared non-raiseable 33 MiB central-directory ceiling applies
  before zip.js construction and to export admission; the conservative export
  bound includes the pinned writer's greater-than-4-GiB Zip64 local-offset
  field so a canonical save remains importable. Archive consumption now also
  shares a strict-TS bounded
  [random-access byte source](src/common/editor/scape-archive-byte-source.ts)
  across Blob and range transports. Providers may declare a lower read maximum
  beneath the 33 MiB logical ceiling; native typed-array slots enforce exact
  result length and defensive ownership. The strict-TS
  [desktop adapter](src/common/editor/desktop-scape-archive-byte-source.ts)
  snapshots the descriptor URL/declared size and fetch implementation, limits
  each provider request to the 16 MiB platform media-chunk ceiling, requires
  exact `206`, `Content-Range`, `Content-Length`, and emitted-body agreement, and
  serializes requests through response-body `done`. The first admitted abort or
  transport failure cancels best-effort and permanently fences queued/future
  reads with one stable restorable reason; a queued-only abort neither fetches
  nor poisons the source.
  The adapter exposes no descriptor ID or release authority. The
  [file service](src/common/editor/file-service.js) now constructs it inside one
  awaited capability scope that spans inspection, any open decision, and import,
  then releases the descriptor exactly once after success, failure, cancellation,
  or abort. One strict-TS
  [desktop project router](src/common/editor/ui/workspace/desktop-project-file-routing.ts)
  sends canonical `.scape` descriptors from both the native dialog and OS file
  associations through that scope, while browser-selected `.scape` files retain
  the Blob transport and Audacity or other project/media families retain bounded
  materialization. The scope's awaited main-process release/retirement remains
  the authoritative native drain. A
  [structural witness](src/common/editor/scape-archive-layout-witness.ts)
  retains at most 69,271,649 bytes for the canonical writer profile, including
  central comments, rejects inconsistent overlapping observations, and serves
  the admitted end/central/local/descriptor bytes unchanged while fetching only
  payload gaps. This deliberately qualifies canonical `.scape` structure, not
  arbitrary third-party ZIP local-extra expansion. This routing removes final
  renderer-Blob materialization for admitted canonical desktop `.scape` opens.
  A main-only selection service assigns `materialized-v1` or `scape-range-v1`
  from the trusted purpose and terminal path before opening the file. The Scape
  profile has an independent non-raiseable four-capability and 65 GiB aggregate
  ledger both globally and per committed-document owner, while both profiles
  share the existing 128-capability owner count. Profile identity is carried by
  the store entry, descriptor, URL, and request lease; a mismatch or malformed
  Scape request refuses before expiry renewal or request acquisition. Scape
  protocol requests are `GET`-only exact closed ranges no larger than 16 MiB,
  with one active Scape range request globally. Failed native cleanup retains
  its charge and fences new Scape range admission instead of claiming released
  capacity. The ZIP byte-source reader also makes payload streams consumption-
  driven, so overlap-only layout checks no longer trigger zip.js's eager 4 MiB
  payload pull.
  Its
  [layout regression](tests/audio-editor-scape-archive-layout.test.ts) covers
  offset repair attempts, unsafe Zip64 values, malformed extras/descriptors,
  zeroed no-descriptor fields, and boundary crossing with bounded cancellable
  reads. The focused
  [byte-source regression](tests/audio-editor-scape-archive-byte-source.test.ts)
  adds Blob parity, lower provider limits, exact cancellation, hostile typed
  arrays and Blob overrides, structural swaps, comment retention, body-gap
  range isolation, and a real greater-than-4-MiB regression that excludes eager
  payload prefetch before the unavoidable ZIP end-search suffix. The focused
  [desktop range regression](tests/audio-editor-desktop-scape-archive-byte-source.test.ts)
  adds exact 16 MiB HTTP splitting, descriptor/fetch snapshots, response and
  stream refusal, exact-EOF serialization, first-admitted-error preservation,
  prompt terminal cancellation, queued-abort non-poisoning, and primitive-reason
  restoration. The focused
  [file-service scope regression](tests/audio-editor-file-service-scape-ranges.test.ts)
  proves that one capability spans inspection, decision, and import; release is
  exact-once across success, cancellation, failure, and prompt abort; and visible
  abort does not bypass the authoritative release barrier. The
  [desktop routing regression](tests/audio-editor-desktop-project-file-routing.test.ts)
  proves `.scape` descriptors avoid whole-file materialization while Audacity
  descriptors retain it. The exact
  [8 GiB sparse range witness](tests/desktop-scape-sparse-range-integration.test.ts)
  follows the production project/asset/manifest order through the real
  capability store, protocol, range adapter, file service, router, and inspector.
  It admits exact at-most-16-MiB `206` responses, transfers less than 8 MiB,
  touches only the asset's final at-most-65,557-byte ZIP end-search suffix, and
  cancels an existing-ID collision before materialization or import; this
  inspection profile remains payload-lazy. The same fixture now pins its exact
  8,589,932,094-byte sparse-zero asset to SHA-256
  `7feeb1e9eacb6561f3c5afb4ebf3896c8237660a9b4ed8917d3275c79bed38be` and ZIP
  CRC-32 `2909126900`. The standalone
  [full-import witness](tests/desktop-scape-sparse-full-import-integration.test.ts)
  sends that archive through the real capability store, protocol, desktop range
  adapter, file service, project service, and importer into a transactional
  counting sink. Strict ZIP signature checking validates the authentic CRC, with
  the focused
  [corruption regression](tests/audio-editor-scape-streaming-video.test.ts)
  proving mismatch rejection; import validates the manifest SHA-256 while the
  sink independently rehashes and counts the full asset without retaining its
  payload. Every protocol response is an exact at-most-16-MiB `206`, every media
  emission is at most 4 MiB, project publication follows media commit, capability
  release and pinned-handle close are exact-once, and no whole-archive `Blob` is
  created. The strict-TS
  [import capacity admission](src/common/editor/scape-import-capacity.ts)
  checked-sums the validated manifest asset sizes and adds
  `ceil(assetBytes / 10)` before a transaction, asset writer, or extraction can
  begin. For this fixture, 8,589,932,094 asset bytes require exactly
  9,448,925,304 free bytes. The focused
  [helper](tests/audio-editor-scape-import-capacity.test.ts) and
  [import-order](tests/audio-editor-scape-import-capacity-admission.test.ts)
  regressions prove that an existing-ID collision cancellation performs no
  estimate, while copy and replace each charge the full incoming asset sum.
  An absent estimator or a null, partial, negative, or non-finite estimate lets
  import proceed; a known insufficient estimate refuses with stable frozen
  `QUOTA_EXCEEDED` details. Estimator rejection propagates unchanged. Maintained
  native-controller opens now supply one exclusive decorated preflight with the
  raw asset-byte total and the composed import-task signal. The
  [controller handoff](tests/audio-editor-native-scape-open-cancellation.test.ts)
  proves that exact signal and one raw-byte request reach the
  [storage-capacity service](src/common/editor/controller/storage-capacity-service.ts).
  Its focused
  [state regressions](tests/audio-editor-storage-capacity-service.test.ts) prove
  the same exact `ceil(10%)` requirement publishes `checking` followed by
  `ready`, `unknown`, or `insufficient` in the workspace `lastPreflight`
  snapshot. The maintained
  [browser workflow](tests/browser/audio-editor-scape-open-compatibility.spec.js)
  pins the activated app composition and visible ready import status. The
  service returns that one normalized estimate to the importer, so the stable
  Scape quota decision and visible status agree. Cancellation
  promptly wins a signal-ignoring estimate, restores the prior settled
  preflight snapshot, consumes late provider resolution or rejection, and
  generation-fences older work from replacing newer state. Standalone
  undecorated imports retain the optional direct store estimator and do not
  update controller state. This remains a point-in-time check with no byte
  reservation, so a later write or concurrent import can invalidate the
  estimate. The portable
  reference-scale gate runs explicitly with
  `npm run test:reference:scape-8gib`, or with
  `SOUNDSCAPER_RUN_REFERENCE_SCAPE_8GIB=1` for a direct Node-test invocation. It
  passed in an all-files coverage run, where the instrumented test took an
  observed 525 seconds; routine Node and coverage runs now report a fast skip
  naming the dedicated command without weakening the gate's assertions. This
  Node counting-sink evidence does not qualify the reference-scale path in
  packaged Electron UI, real browser quota availability or estimate accuracy,
  durable OPFS/IndexedDB
  persistence, allocation overhead beyond the policy headroom, write-time quota
  failure or concurrent capacity reservation, renderer/browser heap,
  main/renderer RSS, whole-archive storage atomicity, or publisher
  authentication. The
  [malicious-expansion regression](tests/audio-editor-scape-expansion.test.ts)
  proves cumulative overrun, a high-ratio DEFLATE package, unsafe PCM headers,
  local-method disagreement, and pairwise entry overlap fail without
  publication. The tested native open/save path also carries one controller
  task signal through incremental archive work, PCM source reads/writes,
  streamed archive output, and the
  file-publication boundary; its
  [cancellation regression](tests/audio-editor-scape-cancellation.test.ts)
  proves reader and iterator closure, unpublished-output abort, provisional
  source cleanup, and restoration of the prior project with its retained
  revisions. A strict-TS
  [save-admission plan](src/common/editor/scape-export-plan.ts) now serializes
  the project document once, snapshots source scalars and output classification
  before awaited storage work, computes exact canonical PCM plus chunk-framing
  bytes, reads only scalar retained-video sizes, and applies checked arithmetic
  to a conservative UTF-8 STORE/Zip64 envelope for the lockfile-pinned zip.js
  writer profile. Non-streaming saves whose upper bound exceeds the
  non-raiseable 512 MiB Web Core final-Blob ceiling reject before `BlobWriter`
  creation or audio/video payload reads. Admitted video is canonicalized once
  and must still match its metadata size before its stream is touched; the
  placeholder and final manifest have an invariant encoded length; and the
  finished Blob is checked again against both its admitted envelope and the
  hard ceiling. The focused
  [save-admission regression](tests/audio-editor-scape-export-estimate.test.ts)
  ties that envelope to the configured writer, covers UTF-8 names, path-safe
  generated source segments, and unsafe arithmetic, proves audio and video
  rejection ordering and video-size drift, and keeps explicit streaming
  destinations outside the Blob-only ceiling.
  This bounds final archive bytes, not total renderer heap or process RSS:
  current saves can retain admitted native video Blob handles, and the Web Core
  browser-download fallback still asks zip.js to assemble a bounded final Blob.
  Production File System Access and Electron saves now select their target
  before asynchronous flush, open a plan-aware destination with the admitted
  archive maximum, re-chunk output to at most 4 MiB, and compare independent
  exact byte counts before an explicit publication commit. Electron further
  splits output into acknowledged one-MiB IPC writes, permits maximum-bounded
  mode only for project capabilities, syncs and atomically renames staging, and
  binds every target and derived session to one opaque, main-owned committed
  document identity without expanding renderer IPC. Main-document navigation,
  renderer loss, or actual window close synchronously fences that owner,
  invalidates unused targets including delayed dialog results, drains admitted
  operations through any already-admitted sync-and-rename commit, and then
  aborts remaining staging. Replacement-owner session admission waits for that
  drain, so an older admitted commit cannot overtake a newer save to the same
  destination. Cancellation or project switching before FSA
  close/desktop rename aborts staging; a successful commit remains truthfully
  reported even if the task is cancelled immediately afterward. Public
  inspection now routes through a strict-TS
  [lifecycle service](src/common/editor/controller/scape-inspection-service.ts)
  that registers every generation before task creation or archive work, starts
  a distinct named task, snapshots options, composes caller cancellation with
  controller ownership, rejects late results after replacement, project
  switching, or disposal, and releases completed tasks in `finally`. A focused
  [quiescence coordinator](src/common/editor/controller/scape-inspection-quiescence.ts)
  retains current and superseded generations through archive-reader cleanup and
  any collision-provider settlement registered by the inspection boundary.
  Project-switch admission installs a reference-counted temporary fence,
  cancels captured work with one shared legacy supersession `AbortError` per
  admission, rejects new inspection admission, and waits for every captured
  generation up to its shared settlement deadline before project work;
  overlapping queued switches keep that fence until the last switch settles.
  Controller disposal installs a permanent fence with the exact lifetime reason
  and observes the same bounded wait before engine or storage teardown. Only
  rejection with the exact registration abort reason is benign; reader-cleanup
  failures reject after captured work settles or remain observable alongside a
  deadline failure. Public
  file opens add a higher-level
  [request service](src/common/editor/controller/scape-open-request-service.ts)
  whose replaceable task now spans inspection, the required open decision, and
  native open settlement. The same caller/task-composed signal reaches all three
  phases; replacement, caller cancellation, and disposal promptly reject even an
  abort-ignoring open with their exact reason, while native import rechecks that
  signal before switching projects or publishing status. Matching native-import
  cleanup clears and republishes the global busy flag even when project
  activation changed the original generation; an older owner cannot clear newer
  work. A React-independent
  [continuation owner](src/common/editor/ui/workspace/scape-open-decision-continuation.ts)
  publishes one opaque kind/file/inspection prompt, accepts only the closed
  choices for that kind, settles its exact identity once, rejects and clears
  stale prompts on replacement, switching, or disposal, and leaves explicit
  user Cancel as a normal result. The shared dialog shell adds safe initial
  focus, focus containment, Escape dismissal, and focus restoration, while
  expected lifecycle unwind is kept out of generic error UI. Focused
  [inspection](tests/audio-editor-scape-inspection-service.test.ts),
  [request](tests/audio-editor-scape-open-request-service.test.ts),
  [continuation](tests/audio-editor-scape-open-decision-continuation.test.ts),
  [quiescence](tests/audio-editor-scape-inspection-quiescence.test.ts),
  [public-controller](tests/audio-editor-scape-inspection-controller.test.ts),
  project-switch, and browser coverage preserve exact abort reasons, ignore
  stale or double choices, pin cancellation before awaited switch work, and
  prove the inspection promise closes its reader on disposal. Inspection now
  passes that owned signal into its project-collision read. The default store
  rejects before a pre-cancelled memory read, promptly races stalled database
  admission, and aborts and drains an active read-only IndexedDB transaction;
  the public service gives the read-only Scape boundary a narrow retention
  capability, and that boundary normalizes and registers an injected lookup
  with the same inspection admission in its synchronous read callback before
  returning the provider promise to the abort race. It still rejects a
  signal-ignoring store promptly, closes the archive reader, and suppresses its
  late result or failure. Focused
  [repository](tests/audio-editor-project-load-cancellation.test.ts),
  [store-forwarding](tests/audio-editor-storage-repositories.test.ts), and
  [inspection-storage](tests/audio-editor-scape-inspection-storage-cancellation.test.ts)
  regressions preserve the exact cancellation reason across those boundaries.
  Switching and disposal now join both coordinator-owned inspection cleanup
  and registered provider settlement. The coordinator applies frozen,
  lower-only production ceilings of eight active inspections and a 30-second
  settlement deadline. Admission reserves capacity synchronously before task
  creation or archive work; lifecycle cancellation, project-switch fencing,
  terminal close, and drain arm one absolute deadline per inspection, reused
  without reset by overlapping barriers. Expiry rejects the barrier with a
  typed non-benign timeout, preserves any observed cleanup failure alongside
  it, and leaves the inspection capacity-charged until its retained provider
  actually settles. Project switching therefore fails before project work,
  while disposal continues remaining engine and storage teardown before
  rejecting. Focused
  [bounds](tests/audio-editor-scape-inspection-quiescence-bounds.test.ts) and
  [project-switch](tests/audio-editor-project-switch-inspection-timeout.test.ts)
  and
  [controller](tests/audio-editor-scape-inspection-controller.test.ts)
  regressions pin those limits, admission order, shared deadlines, late
  capacity release, and disposal completion. This bounds first-party lifecycle
  waits without claiming termination of a signal-ignoring provider: such a
  provider can still consume resources after timeout, and stricter third-party
  execution gating remains deferred. The
  [direct-save unit regressions](tests/audio-editor-native-scape-save.test.ts),
  [destination regression](tests/audio-editor-scape-export-destination.test.ts),
  [desktop regressions](tests/desktop-save.test.js), focused
  [owner-lifecycle regression](tests/desktop-save-ownership.test.js), and
  [browser workflow](tests/browser/audio-editor-scape-direct-save.spec.js)
  reconstruct and reopen the streamed archive while preserving the 512 MiB
  fallback. The workflow passes Chromium and Firefox here; the pinned WebKit
  binary cannot launch on this host because required system libraries are
  absent. Video import now routes zip.js
  emissions, pinned to a non-raiseable 4 MiB, through a strict-TS
  [bounded extractor](src/common/editor/scape-archive-video.ts) that charges the
  actual-byte budget and independently hashes each emission before awaiting a
  transactional storage write. The writer snapshots and hashes storage bytes
  independently, verifies exact size and digest before metadata publication,
  and rolls staging back on cancellation or mismatch. OPFS receives bounded
  writes; IndexedDB fallback stores source-owned native Blob chunks; degraded
  process-memory fallback rejects declared payloads above 64 MiB before asset
  extraction. The
  [reference-scale regression](tests/audio-editor-scape-streaming-video.test.ts)
  covers a synthetic 32 GiB descriptor cancelled after one 4 MiB emission,
  actual zip.js chunk geometry, over-bound emissions, backpressure, digest and
  metadata drift, and unchanged inventory. The
  [archive-expansion security gate](config/production-security-matrix.json) is
  therefore satisfied for the current canonical STORE import surface.
  The 64 MiB fallback limit bounds admitted payload bytes, not total renderer
  heap or process RSS.
- **Web Enhanced / Electron Enhanced — Implemented (`.scape`):** stream portable
  project saves directly to a user-selected File System Access or atomic native
  target without a final renderer-sized `Blob`. A size-limited browser download
  remains the Web Core fallback when no streaming destination exists.
- **Web Enhanced / Electron Enhanced — In progress:** the first bounded direct
  render slice is exactly one mix with format `wav`, `aiff`, `bwf`, or `bw64`,
  a `realtime-stream` render plan, and one output. WAV requires the exact MIME
  type and `.wav` extension plus an exact positive safe-integer planned file
  byte count at or below 65 GiB. Classic WAV admission requires an explicit
  positive safe-integer sample rate no greater than 4,294,967,295, 1–32
  channels, a nonnegative safe-integer frame count, non-array object metadata,
  a marker array, null-or-object iXML, and CART exactly null. Its canonical
  (`sampleFormat`, `bitDepth`, `floatingPoint`) tuples are (`int16`, 16, false),
  (`int20`, 20, false), (`int24`, 24, false), and (`float32`, 32, true). It
  rejects an explicit container, BEXT, ADM, `preDataChunks`, or
  `trailingChunks` before target selection. Admission recomputes
  `inspectWavLayout` with automatic container selection from the same sample
  rate, channel count, frame count, encoding, metadata, markers, and iXML used
  by streaming. Only RIFF or RF64 and exact agreement between the recomputed
  and planned bytes pass. Odd PCM RIFF data is word-padded. Layout-only
  witnesses allocate no PCM or output bytes while admitting the largest
  constructible RIFF at 4,294,967,302 bytes, observing the next mono int16
  frame select RF64 at 4,294,967,340 bytes, and admitting the exact
  69,793,218,560-byte (65 GiB) RF64 ceiling while rejecting the next frame.
  This is an admission ceiling, not WAV scale, package, heap, or RSS
  qualification. AIFF requires `audio/aiff` and the canonical
  `.aiff` extension plus an exact count at or below 4,294,967,303 bytes, its
  theoretical 32-bit FORM limit. Direct admission requires an explicit valid
  sample rate, 1–32 channels, from zero through 4,294,967,295 output frames,
  non-array object metadata, and one canonical (`sampleFormat`, `bitDepth`,
  `floatingPoint`) tuple: (`int16`, 16, false), (`int24`, 24, false),
  (`int32`, 32, false), or (`float32`, 32, true). It recomputes
  `inspectAiffLayout` from those same layout-affecting encoder options, requires
  AIFF for integer PCM or AIFF-C for float32, and requires the recomputed and
  planned byte counts to agree.
  Malformed or stale fields and layouts reject before target selection. The
  4,294,967,303-byte theoretical maximum is odd and unconstructible under the
  current aligned layout. A layout-only witness allocates no PCM or output
  bytes while admitting the largest current constructible 4,294,967,302-byte
  layout and rejecting its next mono int16 frame. Exact integer AIFF, AIFF-C
  float, odd PCM padding, and trailing ID3 metadata use that same encoder
  geometry. BWF requires `audio/wav` and the canonical `.wav` extension plus an
  exact positive safe-integer planned file byte count at or below 65 GiB.
  Admission requires an explicit valid sample rate, 1–32 channels,
  a nonnegative safe-integer frame count, object metadata, a marker array, and
  null-or-object iXML and CART. It recomputes the automatic RIFF/RF64 layout with
  `inspectWavLayout` from the same encoder options used by streaming: sample
  rate, channel count, frame count, integer precision, BEXT, metadata, markers,
  iXML, and CART. It rejects malformed fields or a planned-byte mismatch before
  target selection. Its plan and encoding must contain the same canonical
  normalized version-2 BEXT, and direct admission permits only integer int16,
  int20, or int24 PCM. It rejects a plan `container`, ADM, `preDataChunks`, and
  `trailingChunks`, keeping BW64 and opaque chunks outside the direct BWF variant;
  rich standard BWF metadata, markers, iXML, and CART remain eligible when their
  exact geometry agrees. A layout-only witness allocates no PCM or output bytes
  while admitting the exact constructible 69,793,218,560-byte (65 GiB) RF64
  boundary and rejecting the next frame; this remains an admission ceiling, not
  BWF scale, heap, or RSS qualification. A direct-eligible
  authored BW64 plan requires both format and container `bw64`, `audio/wav`,
  the canonical `.wav` extension, and an exact positive safe-integer layout
  recomputed by `inspectWavLayout` at or below 69,793,218,560 bytes (65 GiB).
  That is an admission ceiling, not an exercised scale claim. Admission permits
  only int16, int20, or int24 PCM with the same canonical normalized version-2
  BEXT in the plan and encoding. Admission requires authored normalized ADM metadata for
  mono, stereo, or 5.1, with exact bed channel order and an identity preserve
  mapping. Canonical CHNA before PCM and AXML after PCM must be byte-identical
  in `plan.adm` and the top-level plan. Standard RIFF metadata, markers, iXML,
  and CART remain inside the exact geometry calculation.

  The maintained pristine-passthrough BW64 route is qualified only for metadata
  produced by the current BW64 importer and still accepted by the pristine
  planner: valid warning-free ADM, one unchanged neutral full-range source path
  at the import revision, and a nonempty complete `riffChunkSequence`. Its
  aggregate complete nonstructural RIFF chunk bytes, including headers and
  alignment bytes, may not exceed 16 MiB. Direct admission rechecks 1–32
  channels of int16, int20, or int24 non-float PCM; exact sample-rate, channel,
  frame, and precision geometry; zero tail and dither; full range; identity
  preserve mappings in the plan and encoding; CHNA-derived channel order; exact
  compacted pre/post chunk bytes, order, and placement in both `plan.adm` and
  the top-level plan; and an `inspectWavLayout` byte count under the existing
  65 GiB admission ceiling. A preserved BEXT is emitted only from the sequence;
  without one, the plan and encoding must carry the same canonical normalized
  version-2 BEXT. Preserved cue/adtl, iXML, CART, ID3, or LIST/INFO chunks
  suppress their modeled plan fields, and collisions reject. Legacy
  `opaqueRiffChunks`-only metadata, incomplete capture, invalid or warning-bearing
  metadata, stale or edited projects, sequence drift, mapping or geometry drift,
  and loudness measurement reject before target selection. Byte exactness covers
  preserved nonstructural chunks only: BW64 structure and PCM are rebuilt, so
  this is not whole-file bit identity or broad third-party BW64 qualification.
  A direct-eligible
  realtime BWF or BW64 request with `measureLoudness: true` fails closed before
  target, preflight, or render because bounded two-pass measurement is
  unimplemented; this makes no measured-loudness claim. The desktop
  `audio-pcm-mix` policy permits `.wav`, `.aif`, and `.aiff` names, while
  controller admission remains canonical `.wav` or `.aiff`. A dedicated
  `audio-pcm-mix` target opens only
  through File System Access or Electron exact-size writing. The shared PCM
  route requests 16,384-frame chunks and derives the pending-chunk count from
  the render channel count. This bounds queued planar Float32 PCM to 32 MiB; it
  is a queue-payload bound, not a browser or process memory bound. Direct PCM
  adapters request suspension at one accepted chunk while retaining that hard
  crossover reserve. Realtime publication waits for every streamed clip to
  settle and fails closed with the first stable source-underrun identity before
  commit; interactive playback retains its existing silence-on-underrun policy.
  Focused [stream-settlement evidence](tests/audio-editor-realtime-stream-underrun.test.ts)
  covers the late-underrun failure, cancellation, sink-backpressure final resume,
  and the distinct interactive default. Realtime
  render progress now feeds the owned export task and its progress UI. For the
  qualified selection-only upmix, the streaming transform resamples the smaller
  input channel set before duplicating selected channels; matrix mixes and
  downmixes keep the general mapping order.
  The shared PCM adapter has bounded encoder-emission retention, coalesces PCM
  into at-most-4-MiB writes, and serially awaits one destination write at a time.
  Exact `audio-pcm-mix` Electron sessions negotiate the same 4 MiB maximum,
  while generic exact-size and project saves remain at one MiB. Planned,
  encoder-finalized, destination-written, and committed-result byte counts must
  form a four-way agreement. Explicit publication is a non-cancellable commit
  boundary: ownership lost during commit returns the committed result without
  stale success UI, and committed-result disagreement is a post-publication
  integrity failure, not rollback. This direct route completes without a final
  renderer-sized `Blob`. BW64 passthrough outside the exact current-import
  contract, including legacy opaque-only metadata, plus other PCM containers,
  compressed or custom audio, video, stems, and non-realtime renders retain
  their existing staging or in-memory paths. The Web Core
  browser-download fallback also retains its existing final `Blob`. Focused
  Node AIFF evidence has four cases covering exact FORM and metadata geometry,
  closed admission across all four canonical encoding tuples, malformed and
  stale layout refusal before target selection, the exact 4,294,967,302-byte
  constructible boundary and next-frame refusal without PCM or output
  allocation, realtime direct publication, picker cancellation, and mid-stream
  rollback. Focused Node BWF evidence has five cases covering admission, exact
  layout and publication, loudness fail-closed behavior, four-way diagnostics,
  and mid-stream cancellation. Focused Node authored BW64 evidence has six cases
  covering closed admission across mono, stereo, and 5.1 integer plans, exact
  standard-metadata preparation, canonical ds64/BEXT/fmt/CHNA/data/AXML
  streaming and publication, loudness fail-closed behavior, four-way
  diagnostics, and mid-stream cancellation. The full maintained Node suite
  also includes seven focused pristine-passthrough BW64 cases covering the real
  current-import-to-planner route, preserved and generated BEXT branches, exact
  nonstructural chunk bytes/order/placement and publication, closed admission,
  modeled-metadata collision refusal, stale or edited planning refusal, and
  loudness fail-closed behavior. It remained green at 398 test files. Focused
  12-case Node WAV evidence covers exact classic RIFF/RF64 admission
  and encoder geometry, all four canonical encoding tuples, rich metadata,
  markers, and iXML with correct odd PCM RIFF padding, malformed or stale route
  refusal before target selection, the exact RIFF-to-RF64 and 65 GiB
  boundaries without PCM or output allocation, realtime publication, bounded
  writes and queueing, Blob fallback, cancellation, four-way byte accounting,
  cleanup, and commit ownership. The wider WAV suite additionally covers
  cleanup failures, ownership races, and the commit boundary. A separate opt-in
  [desktop-threshold witness](tests/audio-editor-export-direct-wav-reference.test.ts)
  streams an exact 385 MiB silent float payload into a 403,701,804-byte RIFF
  with pinned SHA-256 through the production planner, controller, real
  16-packet PCM queue at its 32-channel, 32 MiB cap, passthrough resampler, WAV
  encoder, and counting direct target. It requests 193 16,384-frame packets
  (the last half-sized), observes at most 16 pending packets, and makes 98
  destination writes including the header, with no write above 4,194,304 bytes.
  Its conservative 41,943,384-byte path-owned binary maximum remains below the
  planned 64 MiB budget, with zero PCM payload retention at the target. It then
  cancels a second run after the first coalesced 4 MiB PCM destination write
  without close, commit, or partial publication. Renderer heap and process RSS
  remain unqualified because this deterministic Node witness is an ownership-
  bound correctness gate, not a browser/process memory measurement.
  Run it with `npm run test:reference:wav-385mib`; routine Node and coverage
  discovery fast-skips it. Maintained Chromium and Firefox WAV, AIFF, BWF, and
  BW64 coverage now comprises ten format/engine cases with an injected File
  System Access target and simulated mobile planner profile to drive the
  maintained export UI through the production realtime route. The WAV and AIFF
  cases retain only a bounded header prefix plus counters and validate RIFF or
  FORM, COMM, and SSND geometry. The BWF case retains a 2 KiB prefix and
  validates RIFF, bext, fmt, and data geometry, the authored description, a
  64-bit TimeReference, and a two-row CodingHistory. The authored BW64 case uses
  a 33.1-second stereo source and 384 kHz 16-bit output; its 101,683,200-byte
  float-plan geometry exceeds 96 MiB but is not a final-file or scale
  qualification. It retains only a 2 KiB
  prefix and 8 KiB suffix while validating BW64, ds64, BEXT, fmt, canonical
  stereo CHNA, data, authored trailing AXML, and exact post-PCM placement. All
  use at-most-4-MiB serial writes. The pristine-passthrough case imports a
  synthetic 5.1, 48 kHz, 16-bit BW64 with 4,210,688 frames; its 101,056,512-byte
  float-plan geometry exceeds 96 MiB but is not a final-file or scale
  qualification. Bounded 2 KiB prefix and 4 KiB suffix retention proves exact
  source JUNK padding, BEXT v2, and CHNA bytes/order before PCM plus PEAK padding
  and AXML bytes/order after PCM. Visible realtime progress precedes one
  completed close, commit, and publication with no Object URL or browser
  download. A second export cancels after nonzero PCM reaches the target and
  observes one abort without close, commit, or publication. The authored BW64
  case passed focused Chromium and Firefox runs in 42.2 and 45.8 seconds; the
  pristine-passthrough case passed in 1.7 and 1.8 minutes respectively. This
  does not claim a fresh combined rerun of the six earlier cases. These cases
  qualify application-path browser plumbing and pre-commit rollback, not native
  picker availability.
  WebKit remains unqualified because its pinned runtime cannot launch on this
  host without the missing system libraries. The passthrough case does not
  qualify arbitrary third-party or legacy opaque-only BW64 files, edited
  projects, whole-file bit identity, the 65 GiB ceiling at scale, packaged or
  native-picker behavior, browser heap, process RSS, crash, power loss, or
  durability.
  Packaged Soundscaper Linux x64 completion acceptance now covers WAV, integer
  AIFF, BWF, and first-party authored BW64, while packaged cancellation
  acceptance remains WAV only. It
  drives the maintained UI and controller through Electron 43, preload IPC,
  and `AtomicSaveManager`. Its encoded input is 792,000 stereo frames at 48 kHz;
  import/decode observed 791,999 project frames, producing 6,335,992 frames at
  384 kHz, 16 channels, and signed 16-bit PCM. The planner's corresponding
  405,503,488-byte float geometry exceeds the 384 MiB threshold. The completed
  classic RIFF/WAV is 202,751,788 bytes. Its independent verifier streams
  through EOF in at-most-1-MiB reads, retains at most the 31-byte partial-frame
  carry, compares all 95,039,880 duplicated-channel samples with zero
  mismatches, and enforces tolerant non-silence, polarity, crossing, peak,
  mean, and RMS bounds.

  The same packaged sequence selects the exact AIFF option, reselects exact
  16-bit PCM after the format change applies its default, and validates the
  application's canonical `.aiff` suggestion and the combined `WAV and AIFF
  audio mix` save filter with `wav`, `aif`, and `aiff` extensions. It completes
  a 202,751,798-byte classic AIFF. A separate verifier requires a regular,
  non-symbolic file with stable identity and size, then streams it through EOF
  in at-most-1-MiB reads. It validates an exact 202,751,798-byte FORM/AIFF,
  18-byte COMM with 16 channels, 6,335,992 frames, 16-bit PCM and the 384 kHz
  80-bit sample rate, plus a 202,751,752-byte SSND with zero offset and block
  size. Big-endian PCM starts at byte 54 and occupies exactly 202,751,744 bytes
  with no pad or trailing bytes. The verifier retains at most the observed
  10-byte partial-frame carry, compares all 95,039,880 duplicated-channel
  samples with zero mismatches, and applies the same tolerant signal bounds.

  The sequence then selects the exact BWF option, reselects exact 16-bit PCM,
  restores the custom 16-channel mapping after BWF applies its stereo default,
  and retains 384 kHz. It validates the canonical `.wav` suggestion and the
  same combined `WAV and AIFF audio mix` save filter with `wav`, `aif`, and
  `aiff` extensions. Electron receives that filter rather than BWF-specific
  File System Access `types`. It completes a 202,752,510-byte RIFF/WAVE BWF. A
  separate verifier requires a regular, non-symbolic file with stable identity
  and size, then streams it through EOF in at-most-1-MiB reads. It validates a
  689-byte bext payload at byte 12 with one pad byte and a 698-byte total chunk;
  a 40-byte WAVE_FORMAT_EXTENSIBLE fmt at byte 710 with 16 channels, 384 kHz,
  signed 16-bit PCM, and the PCM GUID; and a 202,751,744-byte data payload whose
  PCM starts at byte 766 with no data pad or trailing bytes. The verifier retains
  at most the 31-byte partial-frame carry, compares all 95,039,880
  duplicated-channel samples with zero mismatches, and applies the same tolerant
  signal bounds.

  Its deterministic BEXT carries description `Soundscaper packaged BWF smoke`,
  originator `Soundscaper`, reference `PACKAGED-BWF-0001`, date 2026-07-30,
  time 12:34:56, input TimeReference 6,000 scaled to 48,000, version 2 and a
  deterministic nonempty 64-byte UMID whose normalized 128 lowercase
  hexadecimal digits are pinned and whose payload bytes are compared exactly.
  Loudness sentinels and two-row CodingHistory name 48,000-Hz input and
  384,000-Hz output.

  A separate first-party authored BW64 fixture uses a 44-second, six-channel,
  2,112,000-frame source at 48 kHz and produces 16,896,000 frames at 384 kHz,
  six channels, and signed 16-bit PCM. Its 405,504,000-byte Float32 render
  geometry exceeds the 402,653,184-byte direct threshold, and the completed
  BW64 is exactly 202,755,508 bytes. The bounded verifier uses reads no larger
  than one MiB and validates exact BW64/ds64/BEXT/fmt/CHNA/data/AXML structure
  and placement, a 202,752,000-byte PCM payload, and canonical 5.1 CHNA and ADM
  metadata. It performs 84,480,000 channel comparisons with zero mismatches
  and observes a full-duration signal: at most 8 carry bytes,
  16,894,241 nonzero frames, 8,447,121 positive frames, 8,447,120 negative
  frames, 19,359 crossings, peak 9,830, and RMS 6,950.862. All four whole-file
  SHA-256 values are diagnostic rather than pinned; the exact BW64 BEXT, CHNA,
  and AXML payload hashes are pinned by the verifier.

  The WAV cancellation run independently observed a 33,554,476-byte staging
  file through an at-most-65,536-byte prefix, validated RIFF geometry plus
  nonzero payload, and then verified that the unpublished destination and every
  staging file were removed. No browser download was visible after the packaged
  sequence. The desktop preview/nightly workflow runs this packaged sequence
  only for Soundscaper Linux x64.

  The packaged harness validates the application's save choices and
  `audio-pcm-mix` purpose but then supplies isolated native targets before
  `dialog.showSaveDialog`, without exercising the OS picker. The 385 MiB Node
  witness remains WAV-only. Packaged completion evidence covers WAV, integer
  AIFF, BWF, and first-party authored BW64 at these fixture scales. Packaged BWF
  does not qualify visible progress, cancellation,
  rollback, staging cleanup, commit races, loudness, int20 or
  int24 PCM, rich metadata variants, RF64 or the 65 GiB boundary at scale, or
  third-party interoperability. Packaged authored BW64 does not qualify visible
  progress, cancellation, rollback, staging cleanup, commit races, loudness,
  int20 or int24 PCM, other ADM layouts or metadata variants, passthrough or
  third-party interoperability, or the 65 GiB boundary at scale. Packaged AIFF
  does not qualify visible progress,
  cancellation, rollback, staging cleanup, commit races, AIFF-C float, int24 or
  int32 PCM, metadata or padding variants, or the 4,294,967,302-byte
  constructible boundary at scale. The package harness also does not directly
  observe exact-size session negotiation or the four-MiB destination-write
  limit; separate shared-route controls cover those contracts. The 65 GiB BWF
  and BW64 ceilings are admission, not scale qualification. None of the four
  completed formats qualifies native-picker behavior, heap or RSS, quota,
  filesystem or parent-directory durability, crash or power-loss behavior,
  Windows, macOS, ARM, installers, Framescaper, or other formats. The exact
  decode and frame geometry is specific to the pinned Electron runtime and must
  be revisited on Electron upgrades; the completed-file hashes are deliberately
  not pinned.
  Reference-scale browser/device behavior remains unqualified. Maintained
  Chromium and Firefox qualify only the injected-File-System-Access direct-WAV
  commit race: cancellation while the selected writer's non-cancellable
  `close()` is stalled after commit admission leaves the destination
  unabortable; release completes exactly one full publication, while the
  cancelled task publishes no stale success status or output link.
  Native-picker, actual-device, packaged, AIFF, BWF, BW64, WebKit, durability,
  crash, and power-loss commit races remain unqualified.
- **Web Core — In progress:** the strict-TS
  [storage-capacity service](src/common/editor/controller/storage-capacity-service.ts)
  publishes usage, quota, free space, pressure, eviction protection, fallback
  availability, and the last operation's required headroom. The maintained
  [workspace panel](src/common/editor/ui/workspace/StorageCapacityPanel.tsx)
  exposes refresh, persistent-storage request, orphaned-temporary cleanup, and
  a separate reproducible-preview-cache cleanup action. The strict-TS
  [derivative policy](src/common/editor/storage/derivative-cache-policy.ts)
  plans deterministic oldest-first eviction against exact byte, entry, and age
  limits, rejects unsafe accounting, and uses compare-and-delete tokens so a
  stale cleanup cannot remove a concurrent replacement. Focused
  [service](tests/audio-editor-storage-capacity-service.test.ts),
  [runtime](tests/audio-editor-storage-capacity-runtime.test.ts), and
  [storage-safety](tests/audio-editor-video-storage.test.js) regressions prove
  exact preflight headroom, honest memory fallback, IndexedDB/OPFS disposal,
  and cleanup boundaries that preserve projects, revisions, originals,
  canonical PCM, and active writes. IndexedDB schema v3 adds a dedicated
  metadata-only derivative-cache companion store. Its exclusive version-change
  migration backfills each pre-v3 payload row through a one-at-a-time cursor and
  rolls schema, version, and records back together on projection or write
  failure. Save/replacement, trim, explicit delete, source cascade, retention
  prune, and clear now maintain payload and metadata rows in the same
  transaction; superseded or removed OPFS files are disposed only after commit.
  Cache inventory uses a finite start-of-scan key/count boundary and fresh,
  non-raiseable 64-record companion-store windows, while retention and source
  cascades no longer bulk-load derivative payload Blobs. Focused
  [schema](tests/audio-editor-derivative-cache-schema.test.ts),
  [consistency](tests/audio-editor-derivative-cache-consistency.test.ts),
  [retention](tests/audio-editor-derivative-cache-retention.test.ts), and
  [paging](tests/audio-editor-derivative-cache-paging.test.ts) regressions prove
  upgrade rollback/retry, paired-write rollback, stale-cleanup safety,
  post-commit disposal, finite page transactions, zero-Blob inventory pages,
  and fail-before-delete corruption handling; a real
  [browser migration](tests/browser/audio-editor-storage-migration.spec.js)
  exercises v2-to-v3 backfill in evergreen engines. The one-time legacy
  migration still reads one Blob-bearing row at a time. IndexedDB schema v4
  adds a dedicated token-indexed
  [media chunk store](src/common/editor/storage/media-asset-chunk-records.ts)
  plus token and cross-binary-path reference indexes without rewriting legacy
  media. Schema v5 adds a generation-fenced
  [staging owner store](src/common/editor/storage/media-asset-staging-repository.ts)
  with unique chunk-token and OPFS-path indexes and expiring leases; its
  additive migration preserves v4 media/chunks and rolls the store, sentinel,
  and version back together if initialization fails. The bounded
  [media writer](src/common/editor/storage/media-asset-write-repository.ts)
  coalesces emissions into at most 4 MiB source-owned native Blob rows, verifies
  SHA-256 and exact geometry during load, limits degraded process-memory payload
  admission to 64 MiB, and publishes immutable metadata last. A lease is now
  durable before any streamed payload exists; each chunk write and final
  metadata publication validates that lease in the same IndexedDB transaction
  as its mutation, while OPFS checks ownership before and after awaited I/O.
  Clear and close still block new admission, abort same-instance staging—including
  a stalled OPFS write—and wait for cleanup. Cross-instance clear atomically
  rotates the staging generation with record deletion, cleanup snapshots live
  ownership before inventory and reclaims expired/crashed staging, and disposal
  refuses to follow corrupted metadata into a foreign live lease. When durable
  IndexedDB coordination is unavailable, streamed assets remain in the bounded
  process-memory fallback instead of creating shared OPFS staging. Focused
  [storage](tests/audio-editor-streaming-media-storage.test.ts),
  [load-corruption](tests/audio-editor-media-asset-load.test.ts), and
  [same-instance lifecycle](tests/audio-editor-streaming-media-lifecycle.test.ts),
  [two-store lifecycle](tests/audio-editor-cross-context-media-lifecycle.test.ts),
  and [schema](tests/audio-editor-derivative-cache-schema.test.ts) regressions,
  plus the real [browser migration](tests/browser/audio-editor-storage-migration.spec.js),
  cover all three backends, shutdown admission, cancellation, publication
  ambiguity, migration rollback, live cleanup retention, clear fencing,
  expired-stage reclamation, and corrupted references. Every cache publication
  now enforces frozen 512 MiB binary-payload, 4,096-entry, and 30-day limits at
  the sole media-repository owner. Memory plans before mutation; IndexedDB
  replaces and evicts payload/companion pairs in one serialized transaction,
  validates each removal token against one payload at a time, fails closed on
  drift, and disposes superseded or evicted OPFS files only after commit. The
  focused
  [publication regressions](tests/audio-editor-derivative-cache-publication.test.ts)
  cover exact replacement accounting, byte/count/age eviction across memory,
  IndexedDB Blob, and OPFS backends, oversized replacement preservation, and
  corruption rollback. Publication inventory and the scalar eviction plan
  remain O(entries), and the byte threshold accounts exact derivative binary
  payload rather than browser-defined record overhead. A strict-TS
  [publication estimator](src/common/editor/publication-byte-estimates.ts) now
  applies checked arithmetic to exact post-encode derivative payloads and
  format-defined PCM output. The sole derivative publication owner consumes
  the exact encoded size. StaffPad cache quota admission uses the worst-case
  canonical OPFS container size, including header, per-chunk index, and footer;
  permanent pitch/speed render admission then accounts a second container plus
  the exact nine-level v4 waveform Float32 payload before permanent-source
  channel snapshots, writer creation, analysis, or history publication. Focused
  [estimator](tests/audio-editor-publication-byte-estimates.test.ts),
  [cache](tests/audio-editor-clip-time-pitch-cache.test.js), and
  [render](tests/audio-editor-clip-time-pitch-render-service.test.ts)
  regressions tie the bound to an all-raw canonical file, reject unsafe
  geometry, and prove that space between raw PCM and its container fails before
  StaffPad work. Browser-defined IndexedDB record/key overhead, OPFS allocation
  units, quota-estimate lag and concurrent writers remain outside this binary
  payload scope; the capacity service's headroom and transactional quota
  rollback remain necessary. StaffPad clip-cache work now has a separate
  strict-TS [render admission owner](src/common/editor/clip-time-pitch-render-admission.ts).
  Before quota inspection, source loading, worker dispatch, or writer creation,
  it applies checked arithmetic and a non-raiseable 256 MiB ceiling to the peak
  enumerated useful-binary phase. The first phase charges the complete source,
  not only the clip range: one input copy for transferred forward input or two
  for borrowed/reversed input. Every sequential phase also charges its complete
  client output, up to one output again in transferred chunks, one bounded
  accumulator chunk, one maximum 65,536-frame WASM read block, and the audited
  64 MiB StaffPad linear-memory maximum. The coordinator serializes distinct
  render jobs before source loading, worker dispatch, or writer creation.
  Exact-key callers still share one job, while a queued job cancelled by its
  last subscriber never reaches the loader or worker. Tight planar-array backing
  checks keep clone/transfer bytes equal to the charged geometry. The
  focused [admission](tests/audio-editor-clip-time-pitch-render-admission.test.ts)
  and [coordinator](tests/audio-editor-clip-time-pitch-cache.test.js) regressions
  pin the manifest memory maximum, exact ceiling, overflow rejection, ownership
  cases, serialized execution, and queued cancellation.

  This narrow useful-binary bound is not a browser heap, whole-process RSS, or
  GC-headroom claim, and its queue is coordinator-local rather than a
  product-wide reservation. Another coordinator or renderer can overlap it.
  The source cache, committed 32 MiB planar LRU, permanent render controller's
  `AudioBuffer` and channel snapshots, browser clone/message objects,
  persistence buffers, and runtime overhead can be additive.
  Separately, maintained Audacity selection-effect admission now consumes the
  same shared audited 64 MiB StaffPad WASM maximum instead of its former 16 MiB
  scratch allowance. The focused
  [dispatcher regression](tests/audacity-effects-dispatcher.test.js) binds the
  exact worker-peak formula to the pinned source manifest, so the existing
  controller and macro 256 MiB preflights no longer undercharge StaffPad by
  48 MiB. This is an estimator correction, not product-wide worker admission.
  Maintained spectral gain/delete selection now has a separate strict-TS
  [admission owner](src/common/editor/spectral-edit-admission.ts). Before
  storage preflight, dry rendering, worker dispatch, result retention, or
  persistence, the
  [controller](src/common/editor/controller/effect-audio-service.ts) applies
  checked arithmetic and a non-raiseable 256 MiB ceiling with a lower-only
  test seam to the conservative sequential useful-binary upper bound. Each
  target charges all earlier completed outputs plus its complete dry-render
  Float32 input, one equal transfer copy, one equal-shape output, two
  selection-sized Float64 accumulation and normalization arrays, the Hann,
  real, and imaginary Float64 arrays, and PFFFT input, output, and work
  interleaved-complex Float32 regions. The
  [worker boundary](src/common/editor/controller/selection-effect-worker-service.ts)
  independently validates and admits the actual input before
  FFT initialization, copying, or worker creation. It accepts 1–32 nonempty,
  equally sized Float32 channels with tight, distinct, non-shared,
  non-resizable `ArrayBuffer` backing and requires exact admitted channel and
  frame geometry for dry-render and worker/fallback results before retention.
  The controller supplies its task-and-project currentness assertion to
  persistence, which rechecks it around awaited buffer, source, and analysis
  work and immediately before the synchronous project commit.
  Focused [planner](tests/audio-editor-spectral-edit-admission.test.ts),
  [controller](tests/audio-editor-effect-audio-service.test.ts), and
  [worker-boundary](tests/audio-editor-selection-effect-worker-service.test.ts)
  regressions pin the phase formula, exact and one-past ceilings, checked
  overflow rejection, refusal ordering, and result validation.

  The claimed limit is only an upper bound on that enumerated useful-binary
  ownership model; cheaper fallback and zero-gain branches can omit charged
  allocations. It is not a browser-heap, process-RSS, GC-headroom, or
  product-wide reservation claim. Persistence buffers, `AudioBuffer` and
  channel copies, generic selection effects and spectral replacement, software
  or injected renderers, worker and structured-clone message objects, the
  PFFFT module heap and setup and retained transform plans beyond the charged
  regions, runtime overhead, and other concurrent spectral, effect, or render
  jobs remain outside and can overlap.
  Central `OfflineAudioContext` render output now has a separate strict-TS
  [admission owner](src/common/editor/engine/offline-render-admission.ts).
  After the no-context software-renderer fallback but before the context
  factory, checked arithmetic applies a non-raiseable 256 MiB ceiling with a
  lower-only test seam to the exact enumerated Float32 payload. It charges the
  context's complete channel-by-frame output plus the requested-frame crop
  copy only when warm-up or processing latency makes that copy coexist with
  the full rendered buffer. The created context's length and sample rate are
  checked before worklets, graph construction, or source scheduling. The
  rendered `AudioBuffer` must then match the admitted channel count, length,
  sample rate, and per-channel Float32 geometry before it can return or be
  cropped; mismatches fail closed. Focused
  [admission and engine regressions](tests/audio-editor-offline-render-admission.test.ts)
  pin both exact ceiling shapes, refusal before factory and graph work, strict
  result validation, and the unchanged oversized software-renderer fallback.

  The maintained `createExportPlan` path preserves its mobile, output-size, and
  live-PCM heuristics as an initial screen, then aligns each offline candidate
  with the central admission using project-rate requested frames, effective
  pre-roll, maximum mix or per-stem graph latency, and the actual render width.
  Known central-limit refusals are demoted to realtime streaming before offline
  render or context work, while the exact boundary is admitted. Direct engine
  callers retain the central no-context software-renderer fallback.

  This bound covers only one context output and the maintained crop copy. It
  does not account for source buffers, reverse-cache copies, streamed-source
  chunks, graph nodes, worklets, WASM or codec state, browser heap,
  whole-process RSS, or GC headroom. A context factory can allocate before its
  returned geometry is checked, caller cancellation does not prove that a
  native `startRendering()` has stopped, and concurrent calls on the same or
  separate engines and renderers can overlap without a product-wide
  reservation. Other render paths—including realtime capture beyond the
  maintained worklet-to-sink stream described next, generic selection effects
  and spectral replacement, software or injected renderers, FFmpeg/WASM
  encoding, and native hosts—remain outside this central offline control. The
  export strategy alignment is a per-plan decision, not a heap, RSS, GC, or
  product-wide reservation; other engines and renderers can still overlap, and
  direct engine callers retain the separate software-renderer fallback.

  Maintained realtime worklet-to-sink rendering now has a separate strict-TS
  [admission owner](src/common/editor/pcm-sink-admission.ts). Before an
  `AudioContext` is constructed, it accepts only 1–32 channels and 128–16,384
  frames per packet, caps a packet at 2 MiB, and derives a non-raiseable window
  of at most 512 packets, 8,388,608 pending frame positions, and 32 MiB of
  pending planar Float32 PCM. The default is the smaller of 64 packets and the
  exact byte-bound count for the admitted geometry. An explicit packet count
  may replace that default only within all count, frame, and byte ceilings;
  the derived half-window backpressure threshold is lower-only. The
  [capture worklet](src/common/editor/render-capture-worklet.js) consumes one
  admitted producer credit before transferring a packet and fails closed if a
  complete packet has no credit. The main-thread queue returns that credit only
  after the sink promise settles, pending count/frame/byte accounting is
  released, and its channel references are dropped. Full packets transfer
  their filled buffers directly and the final partial packet is copied once,
  so one render owns at most the admitted 32 MiB outstanding window plus one
  maximum 2 MiB staging or replacement packet. Strict
  [message validation](src/common/editor/engine/realtime-render-capture.ts)
  requires the admitted channel width, tight distinct non-shared fixed
  `ArrayBuffer` backing, exact declared frames, contiguous offsets, no output
  overrun, and exact completion geometry. Total streamed output remains
  uncapped by this working-set limit. Focused
  [admission and queue](tests/audio-editor-realtime-render-admission.test.ts),
  [worklet](tests/audio-editor-render-capture-worklet.test.ts), and
  [engine](tests/audio-editor-pcm-sink.test.js) regressions cover exact and
  one-past boundaries, pre-context refusal, hidden backing, producer-credit
  exhaustion and replenishment, sink settlement, malformed messages,
  cancellation, and the existing backpressure and streamed-underrun contract.

  This is a useful-binary ownership bound for one maintained realtime render,
  not a browser structured-clone/message-object, `AudioContext`, graph,
  source/cache, resampler, encoder, persistence, WASM, browser-heap,
  whole-process RSS, or GC-headroom bound. A sink that retains channel arrays
  after its promise settles owns those bytes outside the queue contract, and
  concurrent renders can overlap without a product-wide reservation. Browser
  scheduling can still exhaust producer credits; that render now fails closed
  instead of growing the `MessagePort` backlog.

  Disposable video-preview capture for imported-video posters and filmstrip
  thumbnails now has a separate strict-TS
  [capture admission owner](src/common/editor/video-preview-capture-admission.ts).
  After browser `loadedmetadata` supplies source geometry but before each seek
  or canvas allocation, checked arithmetic applies non-raiseable source
  ceilings of 16,384 by 16,384 pixels and 256 MiB of nominal source-RGBA bytes.
  Lower-only capture seams cannot request more than 640 by 360
  pixels, so the exact logical output RGBA payload is at most 921,600 bytes.
  Each extractor serializes its complete seek, canvas, and encoder section;
  cancellation before a queued turn or seek and after encoding fences the
  result. The completed `Blob.size` is checked exactly against a non-raiseable
  4 MiB ceiling before the frame can return to derivative publication. Import
  keeps the original video usable, skips all later disposable captures after a
  source-geometry refusal, and stops the remaining filmstrip after an encoded
  hard-cap refusal. Focused
  [admission](tests/audio-editor-video-preview-capture-admission.test.ts),
  [extractor](tests/audio-editor-video-media.test.js), and
  [import](tests/audio-editor-source-import.test.ts) regressions pin exact
  boundaries, refusal before seek/canvas work, per-extractor serialization,
  cancellation fencing, and no rejected derivative publication.

  This disposable-preview control is not a decoder, browser-heap,
  whole-process RSS, or GC-headroom bound. The object URL and `loadedmetadata`
  step precede source-geometry admission, browser-native decode surfaces and
  codec formats need not materialize the nominal RGBA payload, and canvas,
  encoder, driver, and browser overhead remain unknown. The complete encoded
  Blob exists before its size check; the fallback `toDataURL` path first
  materializes a base64 string and decoded bytes, so encode-time allocation is
  unbounded. An active browser encoder is not force-cancelled, and separate
  extractors can overlap without a product-wide reservation. Codec-family
  malformed-input corpora, decode and encode elapsed-time limits, and
  browser/device resident-set evidence remain open.
  Genuine editorial video proxies remain future work, including original and
  relink relationships and a pre-encode end-to-end working-set admission;
  disposable thumbnail derivatives are not editorial proxies. The direct
  `.scape` publication maximum and browser-download final-Blob bound are
  covered above.

  Canonical project-publication admission now applies at the maintained
  `AudioEditorProjectStore.saveProject` facade. The strict-TS
  [admission owner](src/common/editor/project-publication-admission.ts)
  serializes each submitted snapshot with the canonical tagged-binary `.scape`
  project-document codec and rejects UTF-8 output above a non-raiseable 256 MiB
  ceiling, with a lower-only test seam, before repository save. This central
  ceiling covers queued controller saves and maintained direct caller paths,
  including inactive-tab close, project switch, import, duplication, and Scape
  transaction save or rollback. Its focused
  [store regressions](tests/audio-editor-project-store-publication-admission.test.ts)
  prove refusal before current or revision mutation and pin the lower-only
  seam. Controller-owned queued autosave, explicit flush, and terminal flush
  additionally request capacity immediately before each serialized write. The
  request is exactly twice the submitted canonical UTF-8 length—a deterministic
  gross proxy for one current-project payload plus one revision-project
  payload—and the shared capacity service adds exact `ceil(10%)` policy
  headroom. A known insufficient IndexedDB estimate rejects even during terminal
  teardown and before repository or controller success side effects. An unknown
  normalized estimate, including every non-IndexedDB backend, proceeds. The
  focused
  [estimator](tests/audio-editor-project-publication-admission.test.ts),
  [queue](tests/audio-editor-project-save-publication-admission.test.ts),
  [capacity](tests/audio-editor-storage-capacity-service.test.ts), and
  [runtime](tests/audio-editor-storage-capacity-runtime.test.ts) regressions
  prove exact UTF-8 and checked twice-payload arithmetic, immediate serialized
  admission, dirty/no-save refusal, unknown memory fallback, and successor
  progress after a refused predecessor.

  The twice-canonical gross proxy is not an exact IndexedDB byte count. Local
  persistence clones and compacts unreachable source metadata before publishing
  structured-clone current and revision records with revision-wrapper fields;
  browser record, key, property, transaction, journal, replacement, pruning,
  allocation-unit, and quota-accounting overhead remain unmeasured. The 256 MiB
  ceiling is evaluated after canonical serialization and does not bound
  controller snapshot cloning, repeated queued and pre-store serializer
  allocation, heap, RSS, garbage collection, elapsed time, or backend write
  work. Quota preflight is point-in-time with no reservation, estimates may lag,
  concurrent writers and write-time quota failure remain possible, and direct
  store-facade saves do not receive this project-row capacity check; other
  route-specific controls remain separate. Memory fallback has no durable
  capacity claim. For desktop shared projects the estimate covers only
  the local IndexedDB shadow, not renderer/main IPC or the main-process appData
  project file and catalog. Directly constructed repository instances and
  pre-existing over-limit stored documents remain outside this qualification.
- **Web Enhanced — Planned:** move hot OPFS access into dedicated workers and use
  synchronous access handles only after capability detection. IndexedDB remains
  the correctness fallback.
- **Web Core — Implemented (provisional):** the production build now generates
  separate Soundscaper and Framescaper install manifests and icons plus one
  content-addressed [application-shell inventory](scripts/lib/offline-application-shell.mjs).
  Generation rejects symbolic entries, more than 4,096 assets, any asset above
  25 MiB, or an aggregate above 256 MiB, and records exact byte lengths and
  SHA-256 digests. A stable, no-store root
  [service worker](scripts/lib/offline-service-worker.mjs) recomputes the release
  identity, fetches only that allowlist, verifies every complete body before
  caching, and writes readiness last. Failed installation deletes only the new
  release; activation requires readiness and claims clients before retiring an
  older complete shell. Production HTTP(S) pages register without blocking app
  startup, while Electron, unsupported browsers, and non-HTTP documents remain
  unchanged. Focused [generation](tests/offline-application-shell-build.test.js),
  [worker](tests/offline-service-worker.test.js),
  [registration](tests/offline-application-shell-registration.test.ts), and
  [Chromium offline reload](tests/browser/offline-application-shell.spec.js)
  regressions cover exact identity, partial and altered installs, activation
  failure, product routes, product-aware fallbacks for unknown offline
  navigations, and offline reload of both editors.

  Web preferences also expose an explicit verified FFmpeg runtime download.
  The strict-TS [download boundary](src/common/offline/ffmpeg-runtime-cache.ts)
  accepts only the pinned production origin and versioned release layout,
  bounds the pointer to 64 KiB, manifest to 512 KiB, each runtime file to
  64 MiB, the aggregate to 65 MiB, and each streamed chunk to 4 MiB, and checks
  exact pointer-bound manifest and asset byte lengths and SHA-256 digests.
  Non-identity `Content-Encoding` makes the transport `Content-Length`
  advisory; the bounded decoded stream remains authoritative and cached
  responses are normalized around those verified bytes. The CacheStorage
  [transaction](src/common/offline/browser-runtime-store.ts) stages each
  candidate independently, then uses a cooperative same-origin Web Lock to
  serialize a fresh state read, complete final-cache copy, active-state commit,
  and cleanup. Candidate ownership is isolated, an already complete identical
  release is reused without replacement, and cleanup after the state commit is
  best effort so it cannot turn a successful publication into a reported
  failure. The store rechecks exact cached body lengths and SHA-256 digests and
  falls back to one previous complete release. Only state-committed active and
  previous descriptors are eligible at the service-worker boundary; their
  exact normalized cached responses pass through an incremental byte-count and
  SHA-256 verifier before the response body can complete. Cancellation, partial
  or encoded responses, altered bytes, final-cache failure, same-release retry,
  and concurrent cooperative commits retain a complete state. The editor loads
  an installed content-addressed release when one is ready and otherwise keeps
  the pinned network fallback. Focused
  [download](tests/offline-ffmpeg-runtime-cache.test.ts),
  [store](tests/offline-browser-runtime-store.test.ts),
  [manager](tests/offline-browser-ffmpeg-runtime.test.ts), and Chromium
  [update](tests/browser/offline-ffmpeg-runtime-download.spec.js) and
  [offline-use](tests/browser/offline-ffmpeg-runtime-service-worker.spec.js)
  regressions prove complete promotion, previous-version recovery, serialized
  publication, committed-only offline use, cached-body revalidation, orphan
  denial, and no implicit runtime download.

  This is a verified availability cache, not an authenticity root for a fully
  compromised asset host. The pointer path and release schema remain
  code-defined rather than bound to independently approved policy, and remote
  publication still lacks conditional creation, read-back verification, and
  authenticated pointer promotion. A malicious host able to replace the
  pointer can therefore nominate a new internally self-consistent release.
  CacheStorage quota or eviction can remove offline availability. Web Locks are
  cooperative: a browser without them reports runtime storage unsupported, and
  older or noncooperating application code is outside the serialized commit
  contract. A killed client can leave an unserved candidate or pre-commit final
  cache until later cleanup, and an arbitrary streaming consumer can observe a
  verified response prefix before a terminal digest error even though module or
  WASM loading cannot complete from that errored body. Runtime caching has no
  product-wide quota reservation, and the shell install still materializes one
  admitted asset body before caching it. Safari and Firefox service-worker
  workflows, storage-pressure recovery, actual-browser multi-tab updates,
  upgrade/downgrade drills, and actual-device offline behavior remain
  unqualified. This control does not discover or authorize third-party code.
- **Shared — In progress:** retained binary media originals now receive a
  lowercase SHA-256 computed from a canonical native Blob view shared with
  durable storage, so subclass reader overrides and caller metadata cannot
  substitute different bytes. The strict-TS
  [bounded digest](src/common/editor/storage/media-content-digest.ts) reads at
  most 4 MiB per chunk and preserves exact cancellation reasons.
  Memory, IndexedDB Blob fallback, and OPFS publication ignore caller-supplied
  hashes, remove staged files on pre-publication cancellation, and expose the
  same persisted digest; once the final metadata put begins, the write resolves
  as committed rather than reporting a false cancellation. Native `.scape`
  import passes its task signal into media publication and requires that stored
  digest to match the already-verified archive descriptor before project
  publication. Focused [digest](tests/audio-editor-media-content-digest.test.ts),
  [storage](tests/audio-editor-video-storage.test.js), and
  [archive](tests/audio-editor-scape-project.test.js) regressions cover bounded
  reads, all three storage backends, spoof resistance, cancellation boundaries,
  and mismatch rollback. IndexedDB schema v6 first sanitizes the two reserved
  provenance fields from every pre-cutover media row through an atomic
  one-record-at-a-time cursor, so legacy caller metadata cannot impersonate a
  verified record. Markerless retained-media rows then acquire an internal
  version-zero claim and Web-Crypto content token only when first loaded, hash
  the stored Blob through the same non-raiseable 4 MiB digest window, and
  publish the resulting lowercase SHA-256 with version-one provenance through
  a compare-and-set that cannot overwrite a deleted or replaced asset. Public
  metadata withholds inherited hashes until that publication commits;
  cancellation, malformed chunk geometry, size drift, or a failed metadata put
  leaves a retryable unverified claim. The focused
  [backfill regression](tests/audio-editor-media-digest-backfill.test.ts) covers
  memory, IndexedDB Blob, OPFS, and chunked records, concurrent migration,
  exact cancellation, and same-shaped stale-load replacement races. A focused
  [lifecycle regression](tests/audio-editor-media-digest-lifecycle.test.ts)
  stalls the second bounded hash read and proves that clear's temporary fence
  and close's permanent fence reject later loads, signal and drain the captured
  load before maintenance settles, and prevent a post-maintenance version-one
  update. It also proves that close joins an already admitted clear, concurrent
  close callers share the same terminal drain, and clear settles before close.
  Clear then reopens admission, while close keeps it terminal. A
  streamed-writer begin that passes synchronous argument and signal validation
  now reserves lifecycle admission before its first awaited backend or OPFS
  operation, attaches its prepared staging identity after preparation returns,
  and cannot return a live writer after a clear or close fence. The focused
  [writer-admission regression](tests/audio-editor-media-write-admission.test.ts)
  stalls both the first repository-backend await and OPFS directory acquisition
  before staging, proves maintenance waits for rollback, rejects later begins,
  and distinguishes clear's reopened admission from close's terminal state. A
  pre-return OPFS path or clean-fallback lease cleanup failure now rejects the
  maintenance barrier instead of reporting successful quiescence, with focused
  coverage in the
  [streamed-media lifecycle regression](tests/audio-editor-streaming-media-lifecycle.test.ts).
  Close also preserves an admitted clear's normal IndexedDB-availability memory
  fallback while joining it without reopening fallback for unrelated pending
  work when no clear is active, as pinned by the
  [store lifecycle regression](tests/audio-editor-storage-lifecycle.test.js). The
  [schema regression](tests/audio-editor-derivative-cache-schema.test.ts) covers
  cutover and rollback. Original/proxy relationships, relink state, bounded
  reproducible derivative descriptions, and total record-overhead accounting
  remain open without placing disposable previews in project history.
- **Electron Enhanced — In progress:** the product-neutral strict-TS
  [desktop library foundation](desktop/project-library.ts) uses a fixed
  application-data scope rather than either Chromium profile, size-bounded and
  digest-validated [metadata](desktop/project-library-contract.ts), atomic
  SQLite publication, expiring cross-process leases with monotonic fencing, and
  prepared/committed recovery journals. Its strict-TS
  [main-process host](desktop/project-library-host.ts) now opens the shared
  application-data library after Electron is ready, completes recovery before
  window creation, renews its lease, and suppresses intentional-close renewal
  races. One [shutdown barrier](desktop/application-lifecycle.ts) coordinates
  in-flight startup and awaits library, read-capability, and save-session
  disposal exactly once before process exit. Desktop read capabilities now
  reuse the opaque main-owned committed-document identity, reserve at most 128
  pending/live admissions per committed-document owner before file open, and
  bind every store entry, descriptor, URL, and lease to one main-assigned
  versioned profile. Materialized inputs enforce 512 MiB of owner-aggregate
  active declared bytes before publication. Canonical `.scape` range inputs use
  an independent four-capability and 65 GiB aggregate ledger globally and per
  owner; count is reserved before open, bytes after regular-file `stat`, and a
  cleanup failure retains the range charge and fences further range admission.
  Explicit
  release, expiry, non-same-document navigation, renderer loss, actual close,
  and shutdown synchronously invalidate lookup and drain admitted opens and
  handle closes; delayed dialog/open results for revoked owners cannot publish,
  partial multi-file rollback drains and aggregates every cleanup, serialized
  OS-open dispatch preserves one deduplicated queue head across owner
  replacement. Temporary count or aggregate-byte pressure now retains that
  head, and a successful capability release schedules redispatch without making
  its acknowledgement wait for the next file open; intrinsic oversize still
  reports instead of retrying. A renderer-send failure releases its descriptor
  before the error is reported. Count or byte exhaustion never evicts an
  existing handle, and cleanup failure is reported after every close is
  attempted. Each published token now admits one active protocol request from
  its pinned handle. Materialized requests retain their established method and
  range behavior; `scape-range-v1` accepts only exact closed `GET` ranges and
  shares one global active-request gate. Normal Web-body completion retains
  that handle for the next serialized request; cancellation, request abort,
  stream error, release,
  expiry, owner revocation, and shutdown instead join one retirement barrier
  that fences lookup, drains native stream close, and acknowledges pinned-handle
  close before settling. Failed cleanup remains visible only to the correct
  owner until owner or store teardown, token allocation cannot alias a live
  retirement, and renderer lookup never exposes the raw handle. The focused
  [read-capability regression](tests/desktop-read-capability-ownership.test.js)
  covers owner isolation, concurrent pending admission, exact count and byte
  boundaries, late completion, rollback aggregation, cleanup failure, and
  permanent shutdown. A dedicated
  [request-lease regression](tests/desktop-read-capability-leases.test.js)
  covers serialization, range-stream draining, tombstones, expiry, revocation,
  and disposal; the
  [desktop protocol regression](tests/desktop-protocol.test.js) covers
  replacement-renderer queue retry plus real-`FileHandle` reuse, unread-body
  exclusivity, cancellation retirement, abort-before-read, and paused-stream
  failure. The focused
  [association backpressure regression](tests/desktop-file-association-delivery.test.js)
  proves that four real Scape descriptors publish, a fifth stays at the queue
  head without opening a handle, release redispatches it, send failure cleans up
  before reporting, and release acknowledgement does not wait on subsequent I/O.
  The bounded materialization tier is also landed for Audacity and other
  selected inputs: preload sanitation and the
  strict-TS [renderer admission](src/common/editor/desktop-read-materialization.ts)
  repeat the 512 MiB ceiling before fetch, require exact `Content-Length`,
  emitted-byte, and final `Blob`-size agreement, and copy retained response
  parts at the non-raiseable 16 MiB platform media-chunk limit. The body reader
  forwards a caller-supplied abort signal without calling `response.blob()`, and
  scoped descriptor use releases every capability after success, failure, or
  cancellation. Protocol request abort destroys its file stream. This closes
  `whole-file-renderer-read` for the qualified bounded surface, but it does not
  bound decoder amplification or whole-process RSS. Canonical desktop `.scape`
  descriptors are excluded from this materialization profile and instead use
  the independent branded range scope described above. The exact 8 GiB sparse
  witnesses cover payload-lazy collision inspection and a full authentic-asset
  import into a non-retaining counting sink, but not packaged Electron UI, real
  browser quota behavior, durable application storage, reserved/write-time
  capacity under concurrency, or renderer/main-process memory budgets. Atomic
  save disposal now closes target and session admission synchronously, drains
  every `begin`, chunk,
  `finish`, or abort operation admitted before shutdown, lets an admitted
  `finish` settle through its sync-and-rename commit boundary, and then aborts
  any remaining or late-opened staging. Unacknowledged handle close or staging
  removal rejects the failure-aware shutdown barrier instead of reporting a
  clean exit. Each target and derived session also requires one opaque owner for
  the committed main-frame document. Navigation, renderer loss, and actual
  window close synchronously fence that owner before asynchronous drain and
  cleanup; unused targets and delayed dialog results are invalidated, admitted
  operations settle through any admitted commit, and remaining staging is
  aborted. Fresh-owner session admission waits for prior drains so an old commit
  cannot land after its replacement. The focused
  [document-generation](tests/desktop-renderer-save-owner.test.js)
  and [owner-teardown](tests/desktop-save-ownership.test.js) regressions prove
  stale-frame isolation, fresh-document reuse, target/session isolation, stalled
  operation drain, and cleanup-error reporting without adding an owner field to
  the renderer bridge; the existing
  [bridge-contract regression](tests/desktop-protocol.test.js) pins that payload.
  Save admission now enforces 16 outstanding product-wide save targets, 4
  pending or live save sessions, and 65 GiB per-save and aggregate admitted
  bytes, covering the canonical 64 GiB expanded `.scape` envelope plus its
  bounded STORE/ZIP overhead. Global count and byte reservations are installed
  synchronously before the first await, and production ceilings expose
  lower-only test seams. Main fail-closes malformed, failed, or insufficient
  BigInt `statfs` available-space results before staging open. The preflight is
  a point-in-time check, not an operating-system reservation, so later external
  disk use may still make a write fail safely. Charges release when no staging
  was acquired, cleanup is acknowledged, or commit completes; a staging cleanup
  failure keeps the count and bytes charged. The focused
  [save-capacity regression](tests/desktop-save-capacity.test.js) pins the exact
  count, byte, practical-size, and available-space boundaries, concurrent
  pending admission, lower-only seams, and cleanup accounting without changing
  the renderer IPC shape.
  Its focused
  [save-session regression](tests/desktop-save.test.js) injects stalls at open,
  sync, and rename plus close/unlink failures, proves disposal cannot overtake
  them, and rejects delayed target registration and session work. The
  desktop staging pipeline compiles this runtime to ESM, excludes raw TypeScript
  from the packaged app, and stages the pathless shared-project IPC helper. The
  [desktop regression](tests/desktop-project-library.test.ts) proves atomic
  cross-connection visibility, a real second-process lease holder, stale
  takeover, abortable bounded waiting, interrupted-write recovery, and
  fail-closed corruption; focused
  [host](tests/desktop-project-library-host.test.ts),
  [lifecycle](tests/desktop-application-lifecycle.test.ts), and
  [packaging](tests/desktop-project-library-packaging.test.js) regressions cover
  lease release/recovery, serialized failure-aware shutdown, isolated smoke
  data, and importable staged output. Metadata schema 2 now binds each
  product-neutral library entry to a separate bounded project identity, exact
  current project schema, project revision, byte length, SHA-256 digest, and
  derived immutable revision/digest path. A fresh product-neutral `v2` library
  scope ignores rather than migrates the prior shared `v1` scope, and a schema
  1 database found at the `v2` path is rejected. Database schema 2 adds
  authoritative monotonic
  [project-file](desktop/project-library-file-inventory.ts) and
  [project-stage](desktop/project-library-stage-inventory.ts) inventories. The strict-TS
  [project document store](desktop/project-library-projects.ts) reuses the
  canonical tagged-binary `.scape` codec, preserves opaque binary values,
  enforces the 256 MiB document ceiling with a lower-only test seam, validates
  persistence-root identity, and reserves every canonical path together with a
  unique random stage attempt under the exact lease in one SQLite transaction
  before exclusive stage creation. When exact-lease cleanup is acknowledged, an
  exclusive-create failure retires only the registration without unlinking the
  path, while an error after exclusive creation targets that registered random
  stage for removal. Lost-lease or failed cleanup leaves the registration for
  takeover. Successful materialization requires
  the exact metadata path, stage path, lease ID, and fencing token, then renames
  the synced bytes, syncs the directory, marks the canonical row materialized,
  and removes the stage row inside a SQLite writer transaction that checks the
  lease before and after filesystem work. Catalog preparation rejects any next
  project whose validated inventory row is not materialized. Reads then recheck
  length, digest, exact schema, project identity, and revision, so interruption
  or lease loss leaves the previous complete project/catalog pair authoritative
  or the new complete pair readable. After recovery and before host exposure, the
  strict-TS
  [immutable-document collector](desktop/project-library-reclamation.ts)
  captures independent cycle high-water IDs for both inventories and visits at
  most 100,000 total registered rows per startup through bounded keyset queries.
  A persisted schedule alternates at-most-64-row stage and canonical batches so
  either inventory makes progress under the shared cap. Each cursor advances in
  the same fenced transaction that reconciles its batch and resets only after
  reaching the frozen high water; later registrations wait for the next cycle
  instead of extending it. Each batch rechecks the exact live lease. A current
  exact-lease stage remains live; a stale registered regular stage is removed,
  a missing stage row retires, and a non-regular target or non-direct parent
  remains untouched and inventoried. Canonical rows owned by the current lease
  or still referenced by a stage attempt remain ineligible. When a completed
  stage cycle retires attempts that could unblock already-scanned parents, it
  persists a rescan requirement and atomically restarts the canonical high-water
  cycle before reporting completion. Canonical batches rebuild portable
  case-folded reachability from the current catalog plus the previous and next
  snapshots of pending prepared or committed journals. Unreachable regular
  immutable files first move to a deterministic noncatalogable quarantine;
  crash-left quarantines retry idempotently, missing planned rows retire, and a
  protected row keeps its only quarantine copy. Unregistered stage-looking or
  canonical-looking files and forged quarantine names are foreign v2 content;
  they neither consume the budget nor become eligible. Batches yield for renewal
  and cancellation. Static root symlinks and corrupt reference metadata fail
  closed, while malformed or foreign names, non-regular entries, symlinked
  entries, and managed media remain untouched.
  Focused [reclamation regressions](tests/desktop-project-library-reclamation.test.ts)
  cover prepared and committed recovery, completed updates and deletes,
  higher-token path reuse, portable case aliases, quarantine retry, symlinks,
  corruption, idempotence, and reclamation-failure lease release. Focused
  [inventory](tests/desktop-project-library-file-inventory.test.ts) and
  [continuation](tests/desktop-project-library-reclamation-progress.test.ts)
  regressions pin reserve/materialize fencing, publication admission, rejection
  of a schema-1 database placed at the fresh `v2` path, low-cap retained-prefix
  progress, frozen high-water inserts, exclusion of unregistered files,
  protected-quarantine preservation, and a real 100,001-row production-cap
  traversal. Focused
  [stage-lifecycle regressions](tests/desktop-project-library-stage-reclamation.test.ts)
  pin live-lease preservation, stale takeover, missing and regular stage
  retirement, rename/transaction crash recovery, shared-cap alternation,
  mixed-cap canonical rescanning, non-regular fail-closed behavior, and
  unregistered-file exclusion. Additional inventory/store fixtures prove stale
  discard fencing, atomic duplicate-registration rollback, and preservation of
  a pre-existing path when exclusive creation fails and same-lease cleanup
  completes. The compiled
  desktop-runtime inventory includes the collector without adding IPC. The
  main-owned editor service now applies the shared
  [strict exact-V9 maintained-persistence-domain validator](src/common/editor/project-v9-validation.ts)
  to a decoded renderer commit before host staging or catalog publication, then
  to the loaded commit result and stored project before returning either
  canonical document. The service threads one lower-only structural policy
  through those input, load, read, and response boundaries: every serialized
  project first receives a lexical preflight capped at 101,536 JSON values and
  depth 130 before `JSON.parse`, while each exact-V9 decoded codec traversal and
  maintained-domain validation phase is independently capped at 100,000 nodes
  and depth 128. The raw allowance includes the six-additional-value
  tagged-descriptor overhead for each of the 256 admitted opaque binary
  payloads, so lowering the policy preserves binary serialize/parse closure.
  Future-schema JSON receives the same structural preflight, but tag-shaped
  data is neither decoded nor interpreted. Renderer input refusal still
  precedes host mutation or staging;
  an over-budget loaded commit result is refused before the renderer response,
  although host publication may already have completed. Canonical JSON-derived
  graphs and ordinary direct objects also reject accessors, `toJSON` hooks,
  method-shadowed arrays, hidden or symbol data, cycles, exotic containers, and
  non-JSON scalars without invoking application accessors. Hostile proxies and
  prototype-polluted or exotic injected graphs remain outside that code-safety
  claim. These counters reset between the lexical, codec, validator, and
  serialization phases: they qualify per-phase shape, not aggregate work,
  CPU/elapsed time, scalar or string cost, transient allocation amplification,
  cancellation latency, garbage-collection lag, or resident memory. Focused
  [validator regressions](tests/audio-editor-project-v9-validation.test.ts)
  cover the maintained persistence-domain module closure, representative deep
  invalid document mutations, and exclusion of legacy migrations and executable
  effect or worker runtimes. All audio effects receive common structural and
  cloneability checks. Type-specific semantic checks cover missing-effect
  compatibility metadata and parametric EQ; other first- and third-party effect
  semantics and activation are intentionally not gated at this stage. The
  [service](tests/desktop-project-library-editor-service.test.ts) and
  [packaged-runtime](tests/desktop-project-library-packaging.test.js)
  regressions prove invalid input does not reach the commit boundary and invalid
  host or stored results do not escape through renderer responses.
  The main-only host serializes project commits and keeps renewing its lease
  while admitted work drains. A focused
  [host handoff regression](tests/desktop-project-library-handoff.test.ts)
  proves an orderly source-free Soundscaper → Framescaper → Soundscaper lease
  transfer in one product-neutral application-data library: each product
  acquires a higher fencing token without stale takeover and observes the same
  project identity and committed revision.
  A maintained [packaged probe](desktop/desktop-smoke.js),
  [three-stage runner](scripts/lib/desktop-project-library-handoff-smoke.mjs),
  [contract regression](tests/desktop-project-library-handoff-smoke.test.js),
  and dedicated Linux x64 CI job now build two separate unpacked packages and
  run the same source-free Soundscaper → Framescaper → Soundscaper sequence
  through packaged executables. The processes share only an isolated
  appData root, use separate product profiles while reusing the Soundscaper
  profile for the return stage, wait for renderer ready, and drive bounded
  pathless preload IPC. Every stage exact-hashes its expected canonical
  source-free schema-9 document, commits revisions 1, 2, and 3, checks the
  renderer summary and main-only catalog row, requires clean recovery without
  stale takeover, and observes higher fencing tokens, increasing catalog
  revisions, and the expected preferred product. The runner awaits each process
  exit and lease release. Combined with the composed editor regression, this
  qualifies the generic packaged source-free preload/IPC/multi-process/executable
  lifecycle on Linux x64 only. It does not qualify packaged controller autosave
  or tab activation, source-bearing bytes/playback/managed media, concurrent
  opens, crash or stale takeover, interruption or power loss, path identity,
  installers/file associations, Windows/macOS/ARM64, third-party activation
  gating, or legacy Soundscaper library migration.
  The strict-TS
  [identity service](desktop/project-library-editor-service.ts) and bounded
  [owner-scoped IPC](desktop/project-library-ipc.js) now expose only pathless
  list, read, commit, and delete operations. Main and preload independently
  enforce the 256 MiB UTF-8 document, 4 KiB identity, and 10,000-summary hard
  ceilings, strip catalog entry IDs, paths, digests, product preferences,
  raw `updatedAtMs` fields, leases, and fencing tokens, and fence new work while
  draining admitted operations when a renderer owner is revoked.
  The strict-TS
  [renderer repository](src/common/editor/storage/desktop-shared-project-repository.ts)
  repeats the same maintained-persistence-domain exact-V9 validation as defense
  in depth and canonically reserializes it before local mutation, treats shared
  latest documents and summary lists as authoritative, and retains revision
  history plus source/media data in a product-local shadow.
  Before shadowing an authoritative latest exact-V9 source-bearing document, the
  strict-TS
  [recipient-local admission](src/common/editor/storage/desktop-shared-project-source-availability.ts)
  collects at most 4,094 unique logical sources reachable from timeline clips,
  Project Bin clips, and rendered-fallback references. Every source must match
  the pre-existing latest recipient-local exact-V9 snapshot of the same project
  by logical ID, kind, physical storage key, MIME type, frame/sample geometry,
  and kind-specific descriptor; names and opaque extensions are not provenance.
  Compatible same-kind aliases of one physical storage key are body-verified
  once, while conflicting bindings reject and audio/video storage domains remain
  separate. Declared bodies are
  preflighted to 65,536 PCM chunks; one cumulative 64 GiB budget charges
  canonical PCM bytes, four framing bytes per audio chunk, and recipient-local
  video metadata sizes together. For a successfully qualified body, admission
  snapshots metadata before and after it, consumes the exact sequential
  PCM chunk count and `Float32Array` channel/frame geometry, requires any supplied
  index/frame fields to match, and requires a syntactically valid trusted
  recipient-local SHA-256 before any video body read. It then fully hashes the
  genuine exact-size video `Blob` through bounded 4 MiB windows and requires the
  body digest to match. Legacy PCM-on-read migration and media-digest backfill
  remain disabled during shared admission. Digestless legacy video therefore
  fails closed before body read, local shadow save, or activation; it must first
  use ordinary local loading to complete trusted digest backfill before the
  shared load is retried. Every failure raised by this recipient-local
  repository admission precedes local shadow save and controller activation;
  source-free latest loads perform zero source/media I/O.
  Bootstrap passes its lifetime signal through this work and preserves exact
  cancellation while admission reads are active. One repository instance
  serializes latest load, save, and delete per project, and publication plus
  retention resolve logical references to physical storage keys. Remote save
  failure still leaves an identical canonical retry in the shadow;
  same-revision identical commit remains a catalog no-op. Delete commits
  remotely first, with bounded reporting if local cleanup then fails.
  The real editor store selects this repository for a complete desktop bridge,
  fails closed on an incomplete bridge instead of reopening a private catalog,
  leaves web storage unchanged, and refreshes shared summaries after clearing a
  product-local shadow. A real-store
  [mixed-media regression](tests/audio-editor-desktop-shared-project-source-availability-integration.test.ts)
  qualifies a recipient whose pre-existing latest local snapshot binds audio and
  video bytes already present under nontrivial physical storage keys. The composed
  [editor handoff regression](tests/desktop-project-library-editor-handoff.test.ts)
  retains the source-free Soundscaper-to-Framescaper success path and now adds a
  source-bearing case with the same prior local descriptor but missing recipient
  PCM: bootstrap fails, the pre-existing revision/history remains unchanged, and no
  project activates. There is no positive source-bearing two-product byte
  transfer in that fixture.
  This is a bounded sequential admission-time readability check over already-
  present recipient-local bytes, not an atomic snapshot, media transfer,
  publisher authentication, or a durable byte lease. Audio is
  availability/geometry qualified but is not authenticated against a prior
  content digest. Selected metadata is reread around each body, but the
  check does not bind body reads to metadata, cannot detect every same-metadata
  replacement during its sequential observations, and does not fence replacement
  or deletion afterward. A cancellation racing non-abortable shadow save is not
  abort-atomic; injected non-cooperative providers may continue after rejection;
  and separate repository instances or processes are not serialized.
  Source-bearing saves and explicit local revision loads bypass this admission.
  A fresh recipient lacks both the prerequisite local descriptor snapshot and an
  automatic acquisition outcome. Managed-media copy/consolidation, relink,
  playback, packaged two-product source-bearing handoff, interrupted foreign
  collisions at registered random stage paths, parent- and database-path
  identity, and per-OS/architecture power-loss durability remain open.
  Activation-specific feature-capability
  evaluation and rendered-fallback digest verification remain controller-owned
  after repository shadowing but before activation side effects. Other first-
  and third-party effect semantics remain intentionally ungated at this stage.
  Existing V1–V8 raw-project migrations remain maintained. Compatibility beyond
  those retained raw-document migration paths—especially migration from the
  prior shared `v1` scope or product-private libraries—is not a current priority
  or milestone prerequisite and remains unsupported by this current-only
  contract. Audacity project interchange remains a separate roadmap boundary.
- **Electron Enhanced — In progress:** the strict
  [desktop `.scape` adapter](src/common/editor/desktop-scape-archive-byte-source.ts)
  now binds the shared archive byte-source contract to serialized, exact,
  16 MiB range fetches over a descriptor without exposing release authority.
  Canonical `.scape` descriptors from the native dialog and OS associations now
  share one strict router into that source. One awaited file-service capability
  scope spans inspection, any open decision, and import before exact-once
  release; browser `.scape` files retain their Blob path, and Audacity plus
  other project/media families retain bounded materialization. The separate
  main-assigned `scape-range-v1` admission profile and exact 8 GiB sparse Zip64
  witnesses are now landed without a final renderer `Blob`: collision-cancel
  inspection remains payload-lazy, while a standalone full import validates the
  authentic pinned CRC and manifest SHA through the real range/service/import
  path into a non-retaining counting independent-SHA transactional sink.
  Separately, a maintained packaged Soundscaper Linux x64 smoke now
  production-exports a
  current-schema source-bearing fixture with one mono source, track, and clip,
  passes it as a positional `.scape` argument, and observes the native pending
  queue, main-owned range descriptor, preload event, renderer router/range
  protocol, inspection/import into real packaged application storage, activation,
  exact visible project/track/clip identities and success, and exact capability
  retirement. This narrows the packaged-UI and application-storage gap for that
  small fixture. That first packaged-process result does not qualify persistent reopen or storage durability by itself.
  Installer/file-association registration and shell launch, the packaged 8 GiB
  reference path, payload laziness beyond the known range route, playback,
  crash/power-loss behavior, Windows/macOS/ARM or Framescaper, arbitrary
  third-party packages/effects, and legacy Soundscaper compatibility remain
  outside this slice. Third-party gating and legacy compatibility are not current
  priorities, while Audacity interchange remains separate. Real browser quota
  availability and estimate accuracy, capacity reservation,
  allocation overhead beyond the policy headroom, write-time failure under
  concurrency, renderer/browser heap, main/renderer RSS, whole-archive storage
  atomicity, and publisher authentication remain open.
  A second packaged Soundscaper Linux x64 process now extends the small-fixture path into an
  orderly process-restart persistence witness. Its first process imports the
  exact 69,349-byte current-schema-9 revision-7 source-bearing archive, verifies
  the archive unchanged, cleanly exits, removes it, and proves `ENOENT`. The
  second process starts the same executable with the same isolated user and
  application-data roots but no positional `.scape` and no read descriptor or
  capability; normal bootstrap automatically reopens the project. It rereads
  the canonical shared project, verifies the exact one-source/one-track/one-clip
  relations and exact active project/track/clip identities, and reaches an
  Audacity PCM waveform with no waveform error, alert, or dialog. The same second
  process proves that the known reopened fixture's stored PCM enters the editor
  playback graph. It requires exact enabled `Play` and `Stop` controls; `Play`
  exposes an active, pressed `Pause`, and during that same active interval the
  playhead advances and the master playback meter rises above its declared floor.
  Explicit `Stop` restores enabled, unpressed `Play` and resets the playhead to
  zero. This qualifies only orderly process-restart automatic source-bearing
  persistence and reopen plus transport entry, playback-clock advancement,
  master-meter activity, and explicit stop and reset for that known current-schema
  fixture. It does not qualify audible or device output because the harness passes
  `--mute-audio`, playback fidelity, dropout- or glitch-free playback,
  full-duration playback, mixer, routing, or effect correctness, storage
  durability or crash/power-loss/fsync behavior, eviction,
  quota/reservation/concurrency, Windows/macOS/ARM, Framescaper, cross-product
  transfer, arbitrary third-party ZIP/effect breadth, or legacy Soundscaper
  compatibility; those latter two areas are not current priorities, while
  Audacity project interchange remains separate. The materialized profile
  continues to fail above its independent 512 MiB ceiling rather than falling
  through to the Scape route.
- **Electron Enhanced — Deferred, not a current priority:** if meaningful legacy
  installations emerge, define compatibility beyond the retained V1–V8
  raw-document migration paths, especially an explicit migration from the prior
  shared `v1` scope or product-private app libraries into the shared store.
  Broader legacy expansion is not a milestone prerequisite. The shared store
  intentionally supports only the exact-schema-9 contract; Audacity project
  interchange remains independent.
- **Electron Enhanced — Planned:** support durable linked media through scoped
  path capabilities/bookmarks, relink, watch detection, copy/consolidate, and
  opt-in managed media. Portable `.scape` export still embeds everything needed.
- **Shared — In progress:** schema V9 adds a bounded, normalized, declarative
  root-level `featureRequirements` manifest; V1–V8 migration starts from its
  canonical empty publisher form; and a pure shared evaluator reports available,
  unavailable, and unknown requirements while retaining declared bypass or
  rendered-fallback dispositions separately from effective native, bypassed,
  or rendered-fallback dispositions against explicitly declared support.
  Exact-schema-V9 create, load, clone, and commit paths now reconcile the
  reserved `soundscaper.audio-effects` bypass declaration whenever a maintained
  first-party processor exists in a non-label or non-video track, mixer group,
  mixer send, or master rack, and the reserved `soundscaper.video-effects`
  bypass declaration whenever a maintained first-party video effect exists on a
  timeline or Project Bin video clip. Disabled effects and inactive audio racks
  still declare preservation; missing or foreign effect types and video-effect
  stacks on non-video clips do not. An explicit publisher declaration for the
  same capability wins without duplication, and conflicting use of either
  reserved requirement ID rejects. Retained-schema migration applies this same
  owned reconciliation after starting from the empty publisher manifest.
  Fallback descriptors independently root their source metadata through project and
  history compaction. Current-format schema V9 `.scape` export/open preserves
  the manifest and fallback-only source assets, while copy import rewrites known
  fallback source references with colliding source identities. The schema
  validates fallback descriptor source identity and kind plus digest syntax,
  not the referenced media bytes. Explicit stable broad feature IDs map
  one-to-one to the maintained selected-product capability keys; only strict `true` is
  available, registered non-true capabilities are unavailable, and unregistered
  IDs are unknown. Exact schema V9 is evaluated from the actual project history
  that will be activated before activation side effects; every report containing
  an unavailable or unknown requirement makes the project intrinsically read-only.
  When an existing same-ID tab wins, its stored read-only declaration also wins
  over the ignored incoming document's flags.
  The report is retained per tab, remains deeply frozen across session metadata
  clones, and is exposed on the document snapshot.
  For an incompatible active document, the maintained workspace now derives a
  separate frozen structured notice directly from that snapshot. Its persistent,
  non-dismissible document-level region recomputes unavailable and unknown
  counts and lists bounded display names, stable feature IDs, availability, and
  declared dispositions while the owning tab is active. Effective disposition
  remains structured metadata. The bounded scrolling region is keyboard
  focusable; it never reads evaluator messages or fallback descriptors, offers
  no activation controls, and makes no generic rendered-fallback-substitution or
  third-party-loading claim. Compatible and future-schema `null` reports render
  no notice, and tab switching follows the per-tab report without traversing
  future `featureRequirements` state.
  The maintained first-party audio-effect slice additionally projects only an
  exact-schema-V9 authoritative activation project whose registered
  `audioEffects` report item is unavailable with declared bypass and effective
  bypassed dispositions. Active, enabled, not-already-bypassed known processors
  in track, group, send, and master racks become minimal bypassed copies only for
  editor engine loading; inactive racks, disabled or already-bypassed effects,
  and missing or foreign effect types remain untouched. The canonical project,
  history, source loading, persistence, and save paths remain unchanged. Stable
  identifiers and effect types are bounded, a count above 4,096 rejects without
  truncation, and each frozen placeholder entry records only scope, owner ID,
  effect ID, and effect type without reading params, context, state, or other
  payloads. The active compatibility notice matches that metadata to
  one qualifying requirement and persistently renders localized, control-free
  affected-effect placeholders with maintained effect labels and canonical
  track, group, send, or master ownership. Future schemas return unchanged
  before rack traversal. This does not cover unknown or third-party effects,
  rendered-fallback substitution, offline render or export behavior, or
  per-feature activation controls.
  A separate maintained exact-schema-V9 first-party audio-effects rendered
  fallback slice activates only one registered unavailable `audioEffects` item
  with declared and effective rendered-fallback dispositions whose descriptor
  exactly matches the canonical manifest. Its source must be mono or stereo,
  use a safe positive frame range, and match project sample rate and master
  channel count; ADM, surround, ambiguity, descriptor drift, missing media,
  unsafe geometry, and reserved synthetic ID collisions reject. For editor
  playback the full source becomes one neutral whole-mix clip from frame zero.
  The transient projection removes canonical audio clips and tracks and
  neutralizes mixer and master processing, while retaining video and label
  timing. Initial activation and later engine reapplies share the same playback
  projection. Required stored metadata is rechecked; short decoded-buffer
  geometry must match exactly, while oversized sources must expose a streamable
  chunk provider. Stream chunks are not prefetched or revalidated at readiness, so a
  later provider failure remains possible. Initial activation stages only the
  required fallback source's decoded buffer or stream-provider candidate
  privately before obtaining the activation reservation, without changing
  shared buffer, provider, or engine chunk-source state. Metadata, audio-context,
  and decoded body stalls race the controller-lifetime signal; cancellation
  rejects promptly with that exact reason, and late settlement cannot publish
  buffers, chunk providers, engine chunk sources, missing-source state, or
  status. If post-preparation currentness or reservation fails, the stage is
  discarded and the prior buffer and provider identities, engine chunk-source
  state, active project, tab, and lock remain unchanged. After currentness and
  reservation succeed, ordinary-source loading excludes the required fallback.
  Ordinary transient buffers and the staged required representation are composed
  into private source-buffer and chunk-source snapshots; the staged required
  representation wins a conflicting transient before those snapshots reach the
  engine. After the engine callback succeeds and the lifetime signal remains
  active, commit runs its caller-supplied synchronous project-identity or
  activation-admission assertion immediately before shared publication, with no
  intervening await between that assertion and mutation of the shared source
  maps. Canonical project, history, persistence, save, export, and offline
  render remain unchanged. Frozen per-tab
  metadata drives a localized active-playback indicator without exposing the
  source ID or digest. Each canonical playback reapply owns one replaceable
  controller-lifetime task. A newer reapply or a successful project switch
  aborts stalled metadata, audio-context, and decoded-body preparation with the
  exact reason, and late settlement cannot publish a buffer, provider, engine
  source, missing-source state, or status. In the tested stalled-preparation
  race, only the newest source-ready projection enters the engine. An engine
  application already entered is not abortable or transactional and can leave
  engine-side effects after callback failure or cancellation. A later activation
  failure after a successful commit does not roll back committed shared source
  state or earlier activation effects. Ordinary-source loading remains outside
  this required-source staging transaction, and short-buffer retention after
  engine application remains subject to cache-fit policy. Streamed chunks are
  not prefetched or revalidated after readiness. This does not cover
  generic or video fallback, freeze/proxy authoring, ADM or surround playback,
  unknown or third-party activation, future schemas, or earlier Soundscaper
  project schemas.
  The maintained first-party video-effect slice similarly projects only an
  exact-schema-V9 authoritative activation project whose registered
  `videoEffects` report item is unavailable with declared bypass and effective
  bypassed dispositions. Enabled maintained effects on timeline and Project Bin
  video clips become minimal disabled copies in the transient activation
  projection. The WebGL preview filters exact affected effects from timeline
  stacks using the trusted projection metadata while preserving unchanged stack
  references; the canonical project, history, source loading, persistence,
  save, and export paths remain unchanged. Stable identifiers are bounded to 256
  characters, effect types to 128 characters, the combined count above 4,096
  rejects without truncation, and each frozen placeholder entry records only
  location, clip ID, effect ID, and effect type without reading params or other
  opaque payloads. The active compatibility notice matches one qualifying
  requirement and persistently renders localized,
  control-free affected-effect placeholders with maintained labels and
  canonical Timeline or Project Bin clip ownership. Future schemas return
  unchanged before clip or Project Bin traversal. This does not cover unknown
  or third-party effects, rendered-fallback substitution, offline render or
  export behavior, per-feature activation controls, or earlier Soundscaper
  project schemas.
  The same selected-product service now powers programmatic current-format
  `.scape` inspection: provider-owned capability evaluation cannot be replaced
  by caller options. After archive and source validation, every exact-schema-V9
  rendered-fallback claim is bound by source ID, kind, and SHA-256 to its
  canonical manifest asset before compatibility evaluation or collision lookup.
  Inspection returns a deeply frozen report but does not read or hash asset
  bodies and performs no import, persistence, or activation. Future project
  schemas return `null` without traversing `featureRequirements`.
  Maintained workspace/UI file opens now surface incompatible exact-schema-V9 reports
  before native import: no-collision opens require **Open read-only** or
  **Cancel**, while an ID collision is combined into one **Open as read-only
  copy** or **Cancel** decision. Cancel performs no import, persistence, or
  activation. The localized dialog lists bounded feature names, stable IDs,
  availability, and declared dispositions, defaults focus to Cancel, and keeps
  Escape focus restoration. Acceptance passes only the existing copy policy;
  the controller still evaluates the actual history before activation and
  enforces intrinsic read-only state. Export snapshots the admitted project root
  and complete source records before asynchronous asset work, serializes those
  same sources and the bounded normalized fallback manifest used for validation,
  rejects project-root/source-record accessors and callable `toJSON` hooks
  without invocation, hashes completed canonical asset output, and rejects a
  mismatch before manifest write or destination commit. Import binds
  claims before collision or storage, then hashes each extracted body against
  its descriptor before source or project publication; copy remapping changes
  the source ID without changing the digest. Exact-schema-V9 `.scape` export,
  import, and inspection now preserve `Uint8Array`, offset-view, and
  `ArrayBuffer` opaque native/effect state through one collision-safe tagged
  codec. The codec copies bytes, restores the explicit binary type without
  interpreting it, rejects project-container accessors, callable container
  `toJSON` hooks, cycles, reserved-tag collisions, malformed or noncanonical
  base64, length drift, duplicate IDs, and unknown descriptor fields, and
  applies lower-only ceilings of 256 payloads, 4 MiB per payload, 8 MiB
  aggregate bytes, 100,000 traversal nodes, and depth 128 before decoded-byte
  allocation or exact-V9 project work. Before native parsing, every project
  schema also receives a lexical structural preflight capped at 101,536 JSON
  values and depth 130; the extra allowance covers the descriptor representation
  of all admitted binary payloads so a document serialized under the logical
  limits remains parseable under the same lowered policy. Other buffer views
  reject. Future-schema tag-shaped state is structurally counted but is not
  decoded or interpreted, and this does not claim future-archive re-export
  compatibility. The lexical, binary-codec, validation, and serialization
  counters remain separate per-phase shape limits rather than one consumable
  end-to-end execution budget.
  Maintained raw- and stored-project controller activation now verifies every
  exact-schema-V9 rendered-fallback claim against its referenced local bytes
  before activation side effects. The authoritative activation project wins,
  including existing same-ID tab history. After verification and before the
  first activation side effect, the controller upgrades that history token—or
  the still-absent project ID—into one exclusive session activation
  reservation. It rejects target history replacement, close/reopen, and
  competing active-project publication through synchronous session publication,
  then releases in `finally`. Admission reads disable on-access PCM migration
  scheduling and retained-media digest claim/backfill, so verification does not
  publish storage maintenance. Audio verification hashes the
  canonical `audio-f32le-chunks-v1` sequence under the same checked geometry
  and cumulative 65,536-chunk ceiling as `.scape` export; video verification
  hashes the genuine immutable original-media `Blob` body through the
  non-raiseable 4 MiB digest window. Unique claimed audio bytes and admitted
  video sizes share a non-raiseable 64 GiB cumulative ceiling before body reads.
  Verification is sequential and cooperatively cancellable through the
  maintained store. Read-only video-metadata preflight is raced against
  cancellation, so an injected signal-ignoring provider may continue after the
  admission rejects. An already-started fallback body read from such a provider
  can instead delay cancellation settlement and iterator cleanup.
  Verification deduplicates matching claims, rejects conflicting digests
  before storage reads, and performs no asset reads or feature-manifest
  traversal for future schemas. This is an admission-time controller guarantee,
  not a guarantee for arbitrary direct `store.loadProject()` calls, continuous
  binding against later low-level source replacement, publisher authenticity,
  or substitution by the admission step itself. It is point-in-time, not a
  durable byte lease. The separate exact-V9 first-party audio whole-mix slice
  performs the narrow editor-playback substitution described above. Its initial
  required-source preparation stages the decoded buffer or stream-provider
  candidate privately and is lifetime-abortable before activation reservation
  and side effects. Signal-ignoring metadata, context, or decoded body work may
  continue internally, but late settlement is fenced from source and status
  publication. Failed currentness or reservation discards the stage without
  replacing prior shared source identities. After both succeed, the staged
  required representation and ordinary transients form private engine-input
  snapshots. After the engine callback succeeds while the lifetime remains
  active, commit runs a synchronous project-identity or activation-admission
  assertion immediately before shared publication, with no intervening await;
  only then do the shared source maps change. Each canonical playback reapply
  owns one replaceable controller-lifetime task; a newer reapply or a successful project switch
  aborts stalled metadata, audio-context, and decoded-body preparation with the
  exact reason and fences late buffer, provider, engine-source, missing-source,
  and status publication. Only the newest source-ready projection enters the
  engine in the tested stalled-preparation race. This is not a complete source
  or activation transaction: an engine call already entered is not abortable or
  transactional and may leave engine-side effects after failure or cancellation;
  a later activation failure does not roll back a successful commit; ordinary-
  source loading is outside the required-source stage; and short-buffer retention
  remains subject to cache-fit policy. Stream chunks are not prefetched or
  revalidated. Generic affected-object unavailable-feature
  placeholders and
  per-feature bypass controls beyond the bounded maintained first-party audio-
  and video-effect slices, generic or video rendered-fallback runtime use, and
  arbitrary future-schema archive preservation remain planned. Complete
  third-party discovery, loading, and isolation remain separate later surfaces
  rather than blockers for this first-party contract.

### Exit gate

- Import, autosave, proxy generation, and internal render/save pipelines have
  bounded memory behavior. Web Enhanced and Electron direct-file fixtures may
  exceed renderer memory; Web Core final-download fixtures either complete below
  their published limit or fail preflight without starting unsafe work.
- Killing a renderer or helper during each write path leaves either the previous
  committed state or a recoverable journal, never a half-published project.
- A mixed-media project hands off between both web products and both Electron
  products without copying managed media or losing history-visible state.
  The composed Electron editor-layer source-free autosave, discovery, reopen,
  and next-revision handoff is proven. Sequential admission of already-present,
  pre-bound recipient audio/video plus a composed missing-recipient-PCM refusal
  are also proven: bytes observed missing during that admission do not activate.
  There is still no atomic byte snapshot, fresh-recipient descriptor binding,
  positive source-bearing transfer, explicit acquisition, packaged two-product
  playback, or managed-media portability, so this gate remains open.
- Simultaneous opens across the two Electron apps serialize through the shared
  lease. The dedicated Linux x64 packaged source-free
  Soundscaper → Framescaper → Soundscaper preload/IPC/multi-process/executable
  lifecycle is qualified; the remaining platform and fault matrix stays open.
  Migration from the prior shared `v1` scope or product-private Soundscaper
  libraries is deliberately outside the current compatibility target rather
  than a milestone prerequisite.
- Clearing a cache removes only reproducible derivatives, not originals,
  canonical PCM, or the last recoverable project revision.
- Opening a project with unavailable native features now produces the actionable
  pre-open compatibility decision and persistent per-tab post-open document
  report. A maintained Soundscaper-to-Framescaper `.scape` handoff now proves the
  bounded first-party audio-effect engine bypass, and a maintained
  Framescaper-to-Soundscaper handoff proves first-party video-effect preservation
  and persistent control-free affected-effect placeholders. Exact-schema-V9
  first-party audio whole-mix editor playback through both the short decoded-source
  and oversized stream-provider paths, including its persistent active-fallback
  indicator, is browser-qualified. The oversized path keeps activation quiescent
  at the playback-protocol stream boundary, then uses one correlated stream from
  its full source descriptor through a demand-loaded source chunk and bounded
  packet to playback, with exact direct or device-rate-resampled geometry and no
  oversized `AudioBuffer` allocation.
  Unit evidence additionally qualifies private required-source staging before
  activation reservation, prompt lifetime cancellation of signal-ignoring
  metadata, audio-context, and decoded-body stalls with exact reason preservation
  and no late source or status publication, discard on failed currentness or
  reservation with prior shared identities intact, and private engine-input
  snapshots in which the staged fallback wins a conflicting transient. Shared
  source maps publish only after the engine callback succeeds while the lifetime
  remains active and a synchronous project-identity or activation-admission
  assertion runs immediately before publication with no intervening await. Each
  canonical playback reapply owns one replaceable
  controller-lifetime task; a newer reapply or a successful project switch
  aborts stalled source preparation, and only the newest source-ready projection
  enters the engine in the tested race. The direct stream-provider readiness
  boundary remains unit-qualified and does not prefetch or revalidate chunks after
  point-in-time admission. An entered engine call remains non-abortable and
  non-transactional; later activation failure does not undo a successful commit,
  ordinary-source loading is outside the required-source transaction, and
  short-buffer retention remains subject to cache-fit policy.
  This exit
  remains open for rendered-fallback runtime behavior
  beyond the maintained first-party audio whole-mix slice,
  generic unavailable-feature placeholder and bypass controls, and arbitrary
  future-schema archive preservation. Complete third-party activation is a
  deliberately separate later surface, not a milestone-2 prerequisite.

## 3. Parallel editorial foundations

**Depends on:** milestone 2.

**Goal:** establish professional time, arrangement, and editorial models before
adding broader production surfaces.

### Soundscaper track

- **Shared / Web Core — Planned:** replace the scalar tempo/time signature with
  ordered tempo and signature maps while preserving sample-accurate positions.
  Extend snapping, metronome, rulers, stretch, selection, import, export, and
  migration together.
- **Shared / Web Core — Planned:** expand the existing label and RIFF-marker
  foundations with first-class markers and named regions distinct from captions,
  including navigation, batch-range identity, and ripple rules.
- **Shared / Web Core — Planned:** add nested track folders whose edit, visibility,
  mute/solo, height, and routing behavior is deterministic and undoable.
- **Shared / Web Core — Planned:** add take lanes, cycle-recorded takes, audition,
  promotion, comp regions, flattening, and recovery of interrupted takes.
- **Shared / Web Enhanced — Planned:** add transient analysis, warp markers,
  beat-aware stretch, audio quantization, and groove strength with an exact
  offline render fallback.
- **Web Core — Planned:** expand the existing punch/overwrite and lead-in paths
  into complete punch/count-in workflows; add sound-activated recording,
  clip-boundary selection/navigation, content alignment, track sorting, spectral
  selection/brush, repeat-generator/analyzer, and other roadmap-approved
  Audacity gaps.

### Framescaper track

- **Shared / Web Core — Planned:** add a rational sequence rate independent of
  the audio sample rate, including integer and NTSC rates, drop/non-drop SMPTE,
  source timecode, frame stepping, frame snapping, and explicit rounding rules.
- **Shared / Web Core — Planned:** probe and preserve exact frame rate, VFR timing,
  duration, rotation, pixel aspect, field order, alpha, codec, color primaries,
  transfer, matrix, range, audio streams, and source timecode.
- **Web Core — Planned:** add source and program monitors, source in/out points,
  track targeting/patching, insert, overwrite, replace, lift, extract, match
  frame, and three-point editing.
- **Web Core — Planned:** add J/K/L shuttle, frame and edit-point navigation,
  roll/ripple/slip/slide/rate-stretch tools, track lock, picture visibility,
  linked-audio mute/solo, and keyboard-complete trim feedback.
- **Shared / Web Core — Planned:** promote the existing trim/stretch domain
  operations into explicit retiming and speed ramps; add reverse/freeze frames,
  nested/compound sequences, subsequence time mapping, and deterministic
  flattening.
- **Web Core — Planned:** add proxy generation/attachment, adaptive preview
  resolution, offline/relink workflows, and multicamera groups with synchronized
  angle switching.

### Shared exit gate

- Every new document type has migration, clone, validation, undo/redo, clipboard,
  `.scape`, future-schema, and cross-product preservation coverage.
- Audio edits remain sample-accurate across tempo changes and repeated
  save/reopen cycles.
- Video edits remain frame-accurate across integer, NTSC, VFR, nested, proxy,
  and source-timecode fixtures with no cumulative A/V drift.
- Long-form reference sessions meet the milestone 1 transport, seeking,
  scrolling, memory, and recovery budgets.
- Pointer, keyboard, screen-reader, and high-contrast workflows reach the same
  editorial outcomes.

## 4. Parallel production surfaces

**Depends on:** milestone 3.

**Goal:** complete the non-MIDI Soundscaper production surface and the
non-recording Framescaper finishing surface over the stable editorial models.

### Soundscaper track

- **Shared / Web Core — Planned:** generalize gain envelopes into automation
  lanes for gain, pan, mute, sends, buses, plug-in parameters, tempo-addressable
  values, and future extensibility. Support line/hold/curve interpolation.
- **Web Core — Planned:** add read, trim, touch, latch, and write modes with
  gesture coalescing, safe playback writes, visible ownership, and deterministic
  history commits.
- **Shared / Web Core — Planned:** support nested buses, multiple assignments,
  pre/post-fader sends, VCAs, cue/control-room mixes, hardware-output placeholders,
  arbitrary sidechain routes, channel mapping, and cycle validation.
- **Web Core — Planned:** make plug-in delay compensation cover tracks, buses,
  sends, sidechains, automation, monitoring, offline render, and freeze paths.
- **Shared / Web Core — Planned:** add freeze, unfreeze, commit, and rendered
  fallback state without losing the editable source or native-effect metadata.
- **Web Core — Planned:** expand restoration, phase/correlation/surround metering,
  loudness history, and scalable meter scheduling.
- **Web Core — Planned:** expose a constrained audio-effect ABI for reviewed
  WASM/AudioWorklet packages. Packages receive audio/control buffers and declared
  resources, not arbitrary same-origin application access.

### Framescaper track

- **Shared / Web Core — Planned:** add clip and layer position, scale, rotation,
  anchor, crop, fit/fill, opacity, blend mode, flip, and compositing order.
- **Shared / Web Core — Planned:** add keyframes with hold, linear, eased, and
  Bézier interpolation; consistent time remapping; multi-parameter editing; and
  copy/paste/preset semantics.
- **Shared / Web Core — Planned:** replace overlap-implied dissolves with explicit
  transition objects, duration/easing controls, handles, validation, and an
  extensible transition registry while migrating existing crossfades losslessly.
- **Web Core — Planned:** add vector and raster masks, track mattes, feathering,
  titles, text styles, shapes, solids, stills, generators, adjustment layers,
  effect presets, and a selection-aware Effects/Inspector panel.
- **Web Enhanced — Planned:** add LUTs, exposure/white balance, curves, wheels,
  qualifiers, waveform/vectorscope/histogram views, tracking, stabilization,
  denoise, and optical-flow tiers. Every enhanced path has a deterministic
  software or proxy fallback.
- **Web Core — Planned:** evolve label-backed captions into styled caption tracks
  with regions, speakers, safe-area preview, sidecar import/export, and later
  burn-in/mux delivery.
- **Web Core — Planned:** expose imported-audio clip gain/fades, automation,
  buses, dialogue cleanup, effects selected for video post, loudness targets,
  and mix export. Advanced restoration/mastering still hands off to Soundscaper.
- **Blocked until milestone 8:** do not expose camera, microphone, display, or
  voiceover recording controls in Framescaper during this milestone.

### Exit gate

- Automation, routing, freeze, compositing, keyframes, transitions, captions,
  and color state survive every edit primitive and cross-platform round trip.
- Real-time preview and final render are checked against deterministic audio
  vectors and calibrated video golden frames.
- Unsupported GPU operations visibly fall back without changing the project or
  silently omitting an export effect.
- A complete imported-media programme can be edited, mixed, captioned, graded,
  and exported from Framescaper without opening Soundscaper.
- No MIDI event model, instrument surface, device port, or Framescaper capture
  surface has been introduced early.

## 5. Electron-native services and extensibility

**Depends on:** milestones 2 through 4. Non-MIDI, non-Framescaper-capture helpers
may be researched after milestone 2, but product integration waits for the
owning shared contract.

**Goal:** make Electron materially more capable than the web without weakening
the renderer sandbox or creating a second editor engine.

### Native service architecture

- **Electron Enhanced — Planned:** run media, audio-device, render, and plug-in
  work in versioned utility/helper processes with authenticated MessagePorts or
  bounded IPC, explicit capability handles, cancellation, heartbeats, and
  structured progress/errors.
- **Electron Enhanced — Planned:** enforce per-job CPU, memory, file, duration,
  child-process, and network policy. A helper crash cannot crash the editor or
  corrupt the last project revision.
- **Electron Only — Planned:** scan audio-effect plug-in classes out of process;
  cache signed descriptors; quarantine crashes/timeouts; and isolate each active
  plug-in or trusted group according to the threat model. Instrument-class scan,
  inventory, and exposure remains blocked until milestone 8B.

### Soundscaper native tier

- **Electron Enhanced — Planned:** add low-latency backends appropriate to each
  OS, including ASIO/WASAPI on Windows, CoreAudio on macOS, and PipeWire/JACK/ALSA
  on Linux where available.
- **Electron Enhanced — Planned:** add exclusive/shared modes, real channel
  topology, arbitrary recording destinations, direct-monitoring metadata,
  aggregate-device guidance, latency calibration, underrun reporting, and safe
  fallback to the browser audio engine.
- **Electron Only — Planned:** host VST3 and CLAP audio effects cross-platform,
  Audio Units on macOS, and LV2 on Linux, subject to license and packaging gates.
  Preserve vendor UI state without granting vendor UI direct renderer access.
- **Blocked until milestone 8:** native MIDI devices, MPE, instrument plug-ins,
  MIDI control surfaces, MIDI clock, and MTC.

### Framescaper native tier

- **Electron Enhanced — Planned:** add native ffprobe and multithreaded FFmpeg
  workers, hardware decode/encode, zero-copy opportunities, bounded intermediates,
  and parity tests against the shared render plan.
- **Electron Enhanced — Planned:** add high-resolution and long-GOP decode,
  background proxy/transcode, 10-bit/HDR pipelines, color-management metadata,
  image sequences, alpha masters, and pro mezzanine formats when distributable.
- **Electron Only — Planned:** add persistent parallel render queues, external
  fullscreen/reference-monitor output, watch folders, managed scratch/cache
  volumes, and isolated OFX hosting.
- **Blocked until milestone 8:** add no new Framescaper capture IPC, permissions,
  entitlements, or UI in this milestone. Existing Soundscaper recording and the
  current narrowly scoped desktop loopback behavior remain unaffected.

### Exit gate

- Native helpers pass malformed-input, IPC-fuzz, timeout, memory-pressure,
  cancellation, renderer-restart, and helper-crash suites.
- Native and web render paths satisfy the same semantic render plans and
  deterministic tolerances.
- Plug-in absence/crash/quarantine never deletes state and always offers bypass
  or frozen playback.
- Packages pass Windows, macOS, and Linux x64/ARM64 gates applicable to each
  backend, plus signing/notarization and corresponding-source audits.
- Disabling all native helpers leaves a usable Web Core editor and a clear
  capability report.

## 6. Professional delivery and interchange

**Depends on:** milestones 4 and 5.

**Goal:** turn completed edits into reproducible masters, exchanges, archives,
and batches without hidden conversions.

### Soundscaper delivery

- **Blocked until milestone 8:** MIDI import/export is not part of this delivery
  milestone; `export-midi` remains inert.
- **Shared / Web Core — Planned:** add mastering sequences, named regions,
  per-region metadata, album/programme order, gaps, fades, and validation.
- **Web Core — Planned:** add queued mix, selection, loop, region, stem, alternate
  mix, loudness-normalized, and format-matrix jobs with pause/cancel/retry.
- **Web Core — Planned:** expand delivery reports, dither/channel mapping,
  restoration provenance, BWF/RF64/BW64/ADM conformance, and deterministic AUP4
  omission/conversion reporting.
- **Electron Enhanced — Planned:** add restartable background queues, direct
  streaming for render and delivery paths, reference-scale archive operations,
  and additional professional deliverables that pass license and conformance
  review.
- **Shared — Planned:** extend immersive delivery from current beds toward
  reviewed object/binaural workflows without weakening existing ADM passthrough.

### Framescaper delivery

- **Web Core — Planned:** expose canvas, resolution, rational frame rate, aspect,
  fit policy, background, bitrate/quality, audio layout, caption mode, range, and
  validated delivery presets.
- **Web Core — Planned:** support sidecar captions, burned captions, and muxed
  captions when the selected web container/codec combination supports them.
- **Web Enhanced — Planned:** use WebCodecs and a reviewed muxer for accelerated
  standard SDR outputs when encoder support is proven; keep FFmpeg WebAssembly
  or proxy-based rendering as the semantic fallback.
- **Electron Enhanced — Planned:** add 4K/HDR, 10-bit, hardware-accelerated, image
  sequence, alpha, mezzanine, and platform delivery presets with explicit codec
  availability and legal status.
- **Shared — Planned:** add EDL, OTIO, and FCPXML import/export profiles with
  compatibility reports, plus archive, consolidate, trim-media, relink, and
  checksum manifests.

### Shared exit gate

- Jobs are deterministic and cancellable and leave no published partial output.
  A checked backend/preset matrix requires either tested checkpoint resume or an
  atomic, verified restart-from-zero path; an unsupported resume cannot be
  presented as resumable.
- Every preset declares container, codecs, profile/level, color, audio, captions,
  metadata, legal availability, and fallback behavior.
- Reference masters pass decoder reopen, duration, sync, channel-map, loudness,
  frame-count, caption, metadata, and golden-output checks.
- Web-to-Electron and product-to-product `.scape` round trips preserve editable
  state plus all native placeholders and fallbacks.
- Exchange formats emit itemized conversion/omission reports and never claim
  losslessness where the target cannot represent the project.

## 7. Optional local assistance

**Depends on:** milestone 2. **Optional:** this milestone never blocks milestones
8 or 9 and can be omitted from a release.

- **Web Enhanced / Electron Enhanced — Optional:** on-device transcription,
  diarization, source separation, noise/dialogue cleanup, semantic media tags,
  scene/shot detection, silence detection, beat suggestions, and assistive
  search/edit proposals.
- Models are opt-in, separately downloaded, digest-pinned, removable, offline
  after installation, and covered by license/source/model-card notices.
- Before milestone 8A, assistance consumes only imported or already persisted
  media. It cannot introduce a live-device or hidden recording path.
- Inference receives only the media selected for the task. No content, prompt,
  model input, or result leaves the device.
- AI results are drafts or derived assets. Accepting them creates ordinary,
  inspectable commands; deleting a model never makes a project unreadable.
- Deterministic non-AI editing and delivery remain complete without this
  milestone.

## 8. Final deferred capability milestone

**Depends on:** milestones 1 through 6. This is the last feature milestone.
Capture is sub-phase 8A; MIDI is intentionally the final product sub-phase 8B.

### 8A. Framescaper recording setup

**Goal:** record ordinary cameras, microphones, and displays directly into the
same recoverable media/project model used by imported sources.

#### Recording surface

- **Web Core — Planned:** add a dedicated Recording Setup panel with explicit
  inactive, permission-pending, previewing, armed, recording, paused, finalizing,
  recovered, and failed states.
- **Web Core — Planned:** enumerate permitted cameras and microphones, preview
  them, choose devices, and expose supported camera resolution/frame-rate and
  microphone channel/gain/monitoring choices without storing labels or IDs before
  permission makes them available.
- **Web Enhanced — Planned:** request a user-selected screen, window, or browser
  tab for every display-capture session. Show supported system/tab-audio choices
  only after the browser reports them.
- **Shared — Planned:** support camera-only, microphone-only voiceover,
  screen-only, camera plus microphone, screen plus microphone, and camera plus
  screen plus microphone sessions. Preserve each source as a distinct stream so
  users can edit or mute it independently.
- **Shared — Planned:** model each recording as a capture session with a stable
  session ID, one shared monotonic clock, and independently recoverable camera,
  display, system-audio, and microphone assets.
- **Shared — Planned:** provide preview, input meters, monitoring controls,
  countdown, start, pause/resume, stop, elapsed time, dropped-frame/drift status,
  and destination selection between the Project Bin and linked timeline lanes.
- **Shared — Planned:** record per-packet source timestamps, publish
  alignment/drift metadata, and keep linked lanes synchronized without
  destructively resampling originals during capture.

#### Capture and persistence

- **Web Core — Planned:** use permission-gated `getUserMedia()` for cameras and
  microphones on supported browsers. Select a supported recording MIME type at
  runtime and retain the exact choice in source metadata.
- **Web Enhanced — Planned:** use `getDisplayMedia()` for display sources and
  expose system/tab audio only when the returned capabilities prove it. Camera
  and microphone recording remains the fallback when display capture is absent.
- **Web Core — Planned:** write bounded recording fragments incrementally into
  recoverable media assets. Finalization validates duration/timestamps, creates
  proxies/posters/waveforms asynchronously, and publishes one atomic project
  command only after required assets are durable.
- **Web Core — Planned:** recover finalized fragments after reload/crash, clearly
  distinguish an incomplete take, and allow recover, import-as-is, or delete.
- **Electron Enhanced — Planned:** add validated OS screen/window pickers, native
  capture/encoding when needed for stable long sessions, entitlement and privacy
  declarations, and capability-tested system-audio paths. Platform limitations
  remain explicit rather than being replaced with a silent audio-less stream.
- **Shared — Planned:** enable Framescaper recording commands and its product
  capability only when the complete setup is ready; there is no partially active
  record button or shortcut.
- **Web Core / Electron Enhanced — Planned:** update the current camera-denying
  web and desktop permission policies, Electron permission handlers, platform
  usage descriptions/entitlements, and packaging metadata only when consent,
  active-source indicators, device teardown, embedded-route policy, and
  automated privacy tests are complete.

#### Capture exit gate

- Permission denial, dismissal, revocation, device removal, source ending,
  background throttling, display switching, disk exhaustion, encoder failure,
  reload, helper crash, and application quit all reach a defined recoverable
  state and release devices promptly.
- Camera, screen, microphone, and available system audio remain aligned within
  the milestone 1 drift budget over the pinned long-recording fixture.
- Dropped frames, muted/dead audio tracks, and capability loss are surfaced
  during recording and retained in the recording report.
- No camera or microphone opens without a direct user action and visible preview
  or recording state; display permission is requested anew when required by the
  platform.
- The milestone 1 availability matrix has fixtures for every supported
  browser/OS source type and for each honest unsupported state; system audio is
  never promised as a uniform cross-platform capability.
- Recording Setup is completable by keyboard and screen reader, including
  permission failures, source previews, meters/status, arming, stop, recovery,
  and teardown.
- Devices stop, privacy indicators clear, and retained handles/listeners are
  released within the numeric teardown budget established in milestone 1.
- Recorded media supports the same relink, proxy, edit, `.scape`, handoff, and
  delivery paths as imported media.

### 8B. MIDI, strictly after Audacity design review

**Status:** **Blocked** until Audacity publishes a reviewable MIDI design.

No MIDI schema, event type, track type, device port, piano roll, instrument
surface, import/export implementation, or native MIDI bridge begins before all
of these entry conditions are met:

1. Audacity's relevant design and source revision are public and pinned here.
2. The design review covers its project model, event semantics, track/editor UX,
   tempo interaction, device routing, plug-in event delivery, and AUP4 form.
3. A written compatibility decision maps those concepts to the shared `.scape`
   model and identifies every deliberate divergence.
4. Migration and opaque-preservation plans are approved before a schema version
   is allocated.

Record the gate transition explicitly as **Blocked** → **upstream design pinned**
→ **compatibility design approved** → **implementation**. A branch, prototype,
or dependency addition does not skip a state.

After the entry gate:

- **Shared / Web Core — Planned:** implement the reviewed MIDI project, track,
  clip/event, selection, history, clipboard, tempo-map, quantization, and
  import/export semantics.
- **Web Core — Planned:** implement Audacity-aligned editor workflows, including
  the required piano-roll/event editing, velocity/controller editing, navigation,
  accessibility, and audio/MIDI bounce/freeze behavior.
- **Web Enhanced — Planned:** add capability-detected Web MIDI input/output with
  explicit permission/device-loss handling and a complete file/editor fallback
  when Web MIDI is unavailable.
- **Shared / Web Core — Planned:** add a focused reviewed built-in instrument and
  sampler path only after event and timing semantics are stable.
- **Electron Only — Planned:** add native MIDI input/output, MPE where supported,
  instrument plug-ins, MIDI-based control surfaces, MIDI clock, and MTC through
  isolated/versioned native services.
- **Shared — Planned:** preserve missing instruments and device routes as visible
  placeholders with frozen audio, while retaining all editable MIDI and plug-in
  state for a capable platform.

MIDI tests are derived from the pinned Audacity design rather than guessed now.
They must cover migrations, Audacity/AUP4 interchange, event ordering, tempo and
signature changes, quantization, loop boundaries, latency, offline bounce,
device loss, unsupported browsers, native devices, plug-in state, accessibility,
and deterministic save/reopen behavior.

#### MIDI exit gate

- The pinned-design compatibility matrix has no unresolved data-model question.
- Audacity interchange fixtures and `.scape` cross-platform fixtures retain all
  representable MIDI state and report every conversion.
- Audio and MIDI stay within the milestone 1 timing budget through live playback,
  record, tempo changes, loops, freeze, export, and reopen.
- Web without Web MIDI remains a complete file-based MIDI editor; Electron adds
  native devices and instruments without creating an incompatible project fork.

If Audacity's design is still unavailable, this sub-phase remains **Blocked**.
Earlier milestones may ship, but the roadmap must not relabel the full DAW goal
as complete or bypass the gate with a Soundscaper-specific interim design.

## 9. Final convergence and qualification

**Depends on:** milestones 1 through 6 and both sub-phases of milestone 8.

**Goal:** qualify the complete products as coherent systems rather than a set of
individually passing features.

- **Shared — Planned:** run every supported schema migration from its oldest
  retained fixture through current save/reopen, plus future-schema read-only and
  opaque-state round trips.
- **Web Core — Planned:** qualify current and previous supported releases of the
  Chromium family, Firefox, and Safari. Web Enhanced features run only where
  detected; every fallback is exercised.
- **Electron Enhanced — Planned:** qualify Windows, macOS, and Linux packages on
  the maintained x64/ARM64 matrix, including native helper absence, crash,
  upgrade, downgrade refusal, signing, notarization, and uninstall preservation.
- **Shared — Planned:** complete keyboard-only, screen-reader, zoom/reflow,
  high-contrast, reduced-motion, localization, RTL, and WCAG 2.2 AA reviews for
  all end-to-end workflows.
- **Shared — Planned:** run long-session audio, video, capture, MIDI, autosave,
  handoff, proxy, native plug-in, and render-queue soak fixtures under CPU,
  memory, storage, device, and helper pressure.
- **Shared — Planned:** provide local, exportable diagnostics for capabilities,
  storage, codecs, devices, plug-ins, underruns, dropped frames, drift, helpers,
  jobs, migrations, and compatibility decisions without telemetry or media
  content.
- **Shared — Planned:** publish recovery, compatibility, migration, keyboard,
  performance-tier, codec, plug-in, and project-backup documentation.

### Exit gate

- All required platform and workflow matrices pass with no open data-loss,
  corruption, security-boundary, accessibility-blocker, unreported conversion,
  or unexplained A/V synchronization defect.
- The benchmark ledger shows bounded memory and stable timing over every pinned
  long-session fixture.
- A representative project can start in either product on the web, hand off to
  either Electron product for native work, return to the web with fallbacks, and
  render deterministically without losing editable state.
- Release artifacts pass notices, hashes, source-provenance, codec/plugin license,
  package smoke, signature, and update/recovery gates.

## Interface and schema commitments

The roadmap commits to responsibilities and boundaries, not premature giant
interfaces. Exact symbols are specified in the owning milestone and implemented
as focused strict-TypeScript modules.

- `PlatformCapabilities` is immutable, runtime-derived, test-injectable, and
  distinguishes API presence from a successfully initialized adapter.
- Streaming source/sink, probe, codec, render-job, audio-device, and audio-effect
  host ports are abortable, bounded, progress-reporting, and independent of React.
- Electron IPC is versioned and least-privilege. Binary streams use bounded
  transfer or MessagePorts rather than unbounded invoke payloads.
- Project evolution covers rational video time, tempo/signature maps, markers,
  takes/comps, automation/keyframes, sequences, media links, native-effect state,
  feature requirements, and rendered fallbacks.
- Capture contracts and persistent recording metadata are designed only in
  milestone 8A.
- MIDI contracts, event schemas, device ports, and instrument event delivery are
  designed only after milestone 8B's Audacity review gate.
- Every schema addition defines validation, migration, future-version behavior,
  clone/serialization rules, command/history behavior, `.scape` representation,
  AUP4 disposition where relevant, and deletion/retention effects.

## Acceptance matrix

Each milestone narrows this matrix into concrete fixtures and commands. The
following scenarios remain mandatory throughout the roadmap:

| Scenario | Required evidence |
| --- | --- |
| Cross-product handoff | Same project identity and media on the web and shared Electron library; explicit locks; no copy or silent conversion. |
| Portable project | Deterministic `.scape` manifest, streaming save/open, digest validation, missing-feature report, and lossless opaque-state round trip. |
| Interrupted mutation | Kill/reload/abort at every persistence boundary; previous revision remains valid and staged data is recoverable or collectible. |
| Audio correctness | Sample-accurate vectors, routing/automation/PDC/freeze parity, dropout/underrun metrics, and bounded long-session memory. |
| Video correctness | Frame/timecode/VFR fixtures, preview/export golden frames, proxy/original equivalence, caption/color metadata, drift and dropped-frame metrics. |
| Native isolation | Malformed IPC/media/plug-ins, timeout, crash, quarantine, restart, permission revocation, and Web Core fallback. |
| Framescaper capture | Permission and privacy states, all supported source combinations, long-recording sync, device loss, partial-finalization recovery, and ordinary media handoff. |
| MIDI | Tests derived from the pinned Audacity design, including migrations, timing, device fallback, instruments, accessibility, `.scape`, and AUP4. |
| Accessibility | Keyboard and assistive-technology completion of every critical workflow at supported zoom, contrast, locale, and direction. |
| Distribution | Browser capability matrix; desktop OS/architecture matrix; licenses, notices, source hashes, signing/notarization, and package smoke. |

## Platform feasibility references

These references justify the platform split; revalidate them when the owning
milestone starts because browser and Electron capabilities change.

### Web platform

- [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
  provides the widely available low-latency browser DSP foundation.
- [Origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
  provides efficient origin-private storage, but it remains quota-bound and is
  deleted with site data.
- [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
  provides low-level accelerated codecs when a browser/device supports a chosen
  configuration; it does not supply container demuxing or muxing.
- [WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) is a
  capability-detected acceleration tier, not the Web Core renderer contract.
- [File System Access](https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker)
  improves user-visible file workflows where available; input and download or
  stream fallbacks remain required.
- [Camera and microphone capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
  requires a secure context, user permission, and visible browser privacy state.
- [Display capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
  requires direct user activation and a fresh user-selected source as required
  by the browser; system audio is platform-dependent.
- [Web MIDI](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API) is a
  limited-availability enhancement and remains deferred until milestone 8B.

### Electron platform

- [Native Node modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules/)
  make native backends possible but require Electron/OS/architecture-specific
  builds and packaging discipline.
- [Utility processes](https://www.electronjs.org/docs/latest/api/utility-process)
  provide a basis for isolated Node-enabled helpers; they do not replace the
  roadmap's authentication, validation, resource-limit, and crash policies.
- [Desktop capture](https://www.electronjs.org/docs/latest/api/desktop-capturer/)
  exposes screen/window sources with important OS and system-audio caveats that
  milestone 8A must test and report.

Repository-specific constraints and current behavior are documented in
`README.md`, `Technical_README.md`, `docs/architecture.md`, `public/_headers`,
the two product profiles, the desktop bridge, and the editor's storage, project,
audio, video, and browser-test modules.

## Maintaining this roadmap

- Update the grounding date whenever current-state claims are re-audited.
- Change a status only in the same change that links its evidence or explains
  the external blocker. Active work alone is not **Implemented**.
- Decompose a milestone into tracked work with product, platform, dependency,
  migration, security, licensing, and acceptance labels before implementation.
- New work must not weaken file-size, chunk-size, dependency, coverage, browser,
  reproducibility, or notice gates to make a milestone appear complete.
- If platform capabilities improve, promote a feature from Electron or Web
  Enhanced only after the supported-browser matrix proves the stronger contract.
- MIDI stays blocked until the Audacity design review entry conditions are met.
  Framescaper capture stays in milestone 8A even if isolated APIs are available
  earlier.
