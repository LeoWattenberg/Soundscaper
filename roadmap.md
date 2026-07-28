# Soundscaper and Framescaper production roadmap

> Engineering roadmap, last grounded against the repository on 2026-07-28.
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

These labels describe the target contract. Milestone 1 must establish and prove
the browser matrix before **Web Core** becomes a release guarantee; current
end-to-end browser evidence covers Chromium only.

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
| Electron | **Implemented** | Hardened offline wrapper with native dialogs, capability-scoped reads, atomic chunked saves, menus, lifecycle handling, associations, packaged runtimes, and Windows system-audio selection. It is not yet a native media engine. |
| Automated evidence | **Implemented** | Broad Node coverage plus Chromium browser workflows, deterministic video-effect parity fixtures, desktop smoke tests, architecture limits, chunk-size checks, and reproducibility audits. |

Material constraints in the current foundation are also roadmap inputs:

- video uses the audio-sample timeline and a nominal 30 fps source value rather
  than a rational sequence timebase and probed frame metadata;
- video import depends on browser-native `<video>` decoding, and automatic
  export is capped at 1280x720 and 30 fps;
- FFmpeg WebAssembly is single-threaded, serialized through one worker, and
  returns complete in-memory outputs;
- source assets can already stream through parts of `.scape`, but normal project
  saves, desktop reads, several compressed imports, and final outputs still have
  reference-scale paths that materialize a whole `Blob` or byte array;
- browser storage remains quota- and eviction-bound;
- the two Electron products currently use separate persistent Chromium
  partitions rather than one desktop project library;
- no native codec worker, audio backend, effect host, or background job service
  exists; and
- browser end-to-end coverage currently proves Chromium only;
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
- **Shared — Planned:** pin reference hardware, browsers, media fixtures, project
  sizes, measurement procedure, and pass/fail thresholds for audio transport,
  recording, video preview, import, save, and render workloads.
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
  Its [policy regression](tests/project-compatibility-policy.test.js) keeps
  unimplemented future-archive and binary-opaque guarantees explicitly planned.
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
  controls and the release-blocked archive-expansion gate visible and prevents
  planned helper and plug-in surfaces from being treated as enabled.
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

- **Shared — Planned:** introduce a read-only `PlatformCapabilities` snapshot.
  Detect APIs and proven adapter support at runtime; never infer support from a
  user-agent string alone.
- **Shared — Planned:** define narrow, abortable ports for streaming media reads
  and writes, probing, decode/encode, render jobs, audio devices, and audio-effect
  hosts. Keep implementations out of the project domain and React UI.
- **Shared — Planned:** do **not** define MIDI events/devices or Framescaper
  capture contracts in this milestone. Generic adapters must not quietly commit
  either model ahead of milestone 8.
- **Shared / Web Core — Planned:** make internal `.scape`, import, proxy, and
  export processing bounded and streaming even when the browser must eventually
  assemble a download. Reuse existing streamed source/sink work; preflight the
  final-assembly fallback and reject safely above its documented limit.
- **Web Enhanced / Electron Enhanced — Planned:** stream reference-scale project
  saves and renders directly to a user-selected file or native target without a
  final renderer-sized `Blob`. A size-limited browser download remains the Web
  Core fallback when no streaming destination exists.
- **Web Core — Planned:** make storage estimates, persistence status, fallback
  mode, cache pressure, required free space, and cleanup actions visible before
  long imports, saves, proxies, and renders.
- **Web Enhanced — Planned:** move hot OPFS access into dedicated workers and use
  synchronous access handles only after capability detection. IndexedDB remains
  the correctness fallback.
- **Web Core — Planned:** provide an installable, versioned offline application
  shell and an explicit runtime-download/cache flow. Failed or partial runtime
  updates leave the previous verified version usable.
- **Shared — Planned:** add media digests, original/proxy relationships, cache
  budgets, relink state, and reproducible derivative descriptions without
  storing disposable previews in project history.
- **Electron Enhanced — Planned:** create one native project/media library shared
  by the two Electron products, with cross-process leases, atomic metadata,
  recovery journals, and an explicit "Edit in Soundscaper/Framescaper" handoff.
  Do not point two Chromium profiles at the same IndexedDB directory.
- **Electron Enhanced — Planned:** migrate each existing app library idempotently
  into the shared store. Record source identity and completion, merge without
  overwriting conflicts, retain both legacy libraries until verification, and
  provide a tested rollback/read-only recovery path.
- **Electron Enhanced — Planned:** support durable linked media through scoped
  path capabilities/bookmarks, relink, watch detection, copy/consolidate, and
  opt-in managed media. Portable `.scape` export still embeds everything needed.
- **Shared — Planned:** add a project feature-requirements manifest. Unknown or
  unavailable native features stay visible, bypassed when necessary, and
  round-trip unchanged alongside frozen/rendered fallbacks.

### Exit gate

- Import, autosave, proxy generation, and internal render/save pipelines have
  bounded memory behavior. Web Enhanced and Electron direct-file fixtures may
  exceed renderer memory; Web Core final-download fixtures either complete below
  their published limit or fail preflight without starting unsafe work.
- Killing a renderer or helper during each write path leaves either the previous
  committed state or a recoverable journal, never a half-published project.
- A mixed-media project hands off between both web products and both Electron
  products without copying managed media or losing history-visible state.
- Simultaneous opens across the two Electron apps serialize through the shared
  lease, and repeated migration, interrupted migration, conflict, rollback, and
  legacy-library recovery fixtures preserve both original libraries.
- Clearing a cache removes only reproducible derivatives, not originals,
  canonical PCM, or the last recoverable project revision.
- Opening a project with unavailable native features produces an actionable
  compatibility report and a faithful subsequent `.scape` round trip.

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
  streaming to paths, large archives, and additional professional deliverables
  that pass license and conformance review.
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
