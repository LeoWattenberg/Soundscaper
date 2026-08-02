# Production threat model

This document records the production security baseline for Soundscaper's local-first Web and Electron editor. The machine-readable control register is
[`config/production-security-matrix.json`](../config/production-security-matrix.json). Its checked-in implementation and test references are the evidence for each current claim.

The model is grounded on 2026-08-02. It must be updated when a trust boundary, supported input, renderer bridge, worker ABI, native executable, plug-in surface, release channel, or long-job lifecycle changes.

## Meaning of the statuses

- **Enforced** means every named control for a narrowly described current surface has implementation and automated verification evidence. Enforced does not mean risk-free, and it does not qualify a broader future surface.
- **Partial** means useful controls exist but documented attack paths or lifecycle requirements remain unqualified.
- **Planned** means the surface is unsupported and must remain disabled until its acceptance criteria are implemented and verified.
- **Release-blocked** means the named surface is not production-qualified while its recorded gate is pending. It does not claim that every development build is technically prevented from exercising the code.

Documentation, a roadmap entry, or a passing happy-path test is not by itself an enforced control. A control requires code plus relevant automated verification. Residual risks remain visible instead of being folded into a broad claim such as “sandboxed” or “secure.”

## Scope, assets, and actors

Protected assets are project and source integrity, user-selected files, local storage capacity, renderer and desktop-process availability, same-origin data, release provenance, and the authority of the user's operating-system account.

The attacker may provide a malformed project, archive, audio/video file, metadata block, Nyquist program, or future plug-in; compromise renderer content; or substitute a dependency or release input. Accidental corruption, interrupted writes, project switches, cancellation, and renderer/process crashes are treated as security-relevant fault cases because they can violate the same integrity and availability invariants.

The browser, Electron/Chromium runtime, operating system, and hardware are trusted to enforce their documented primitives. Local operating-system compromise is out of scope. A malicious native plug-in is not made safe merely by running in another ordinary user process.

## Trust boundaries

| Boundary | Untrusted or less-trusted side | Privileged or persistent side | Invariant |
| --- | --- | --- | --- |
| `external-input-to-parser` | User-selected files and collaborator-supplied bytes | Project, archive, media, and metadata parsers | Reject invalid structure and resource amplification before persistent publication. |
| `archive-reader-to-storage` | ZIP entries and migrated project records | IndexedDB/OPFS projects and sources | A failed or cancelled import does not publish a project or leave staged sources. |
| `renderer-to-electron-main` | Sandboxed renderer | Electron main process | Only the versioned, validated bridge, including bounded pathless linked-video, linked-WAV, and shared-project calls, reaches privileged handlers. |
| `electron-main-to-filesystem` | Protocol and IPC requests | User-selected files and packaged resources | Renderer code receives capabilities, not ambient paths or arbitrary filesystem access; persisted linked-video and linked-WAV paths remain main-private. |
| `electron-main-to-shared-project-library` | Soundscaper or Framescaper Electron main-process host | Product-neutral appData catalog, project-document tree, and managed-media tree | Only the current fenced lease may publish project state; exact-absent managed bodies receive point-in-time catalog and destination-capacity admission before body work, immutable bodies are complete and digest-bound before catalog publication, and recovery roots remain protected before host exposure. |
| `untrusted-runtime-to-audio-engine` | User-authored Nyquist source | Editor PCM and effect results | Bound source, input, output, memory, time, and host imports. |
| `application-to-native-extension-surface` | Application requests | Future helper and native plug-in processes | No current channel exists; future authority needs an explicit protocol and process policy. |
| `controller-task-to-io` | Cancelled or superseded controller job | Readers, writers, workers, and project state | Cancellation reaches the work, closes resources, rolls back staging, and prevents late publication. |
| `dependency-to-release-artifact` | Registry, source archive, binary, and build inputs | Web assets and desktop packages | Shipped executable bytes match reviewed, pinned provenance and release policy. |

## Current risk register

### Malformed projects and media

`external-project-document-validation` is **partial**. Core project migration validates supported schemas and preserves newer schemas as opaque read-only clones. Schema 9 normalizes its bounded declarative feature-requirements manifest into a deep-frozen clone, rejects duplicate requirement IDs, noncanonical feature IDs, unsupported dispositions, and invalid fallback source-kind references or digest syntax, and evaluates caller-declared availability without executing project-supplied identifiers or mutating requirement state. Current-schema, current-format `.scape` paths preserve the manifest and fallback-only source assets, including collision remapping. A stable selected-product capability registry treats only strict `true` as available and unregistered IDs as unknown; exact schema 9 is evaluated from the actual project history before activation, incompatible projects become intrinsically read-only, and an existing same-ID tab's stored read-only declaration wins over the ignored incoming document's flags. The report remains deep-frozen across per-tab session metadata clones and the document snapshot. After activation, the maintained active workspace persistently displays a non-dismissible document-level notice from only the active tab's unavailable and unknown report items. The frozen subset recomputes counts and shows bounded display names, stable feature IDs, availability, and declared dispositions while that active tab is selected. Available items are excluded, evaluator messages and fallback internals are not read, and the notice exposes no activation controls or generic runtime fallback or third-party-loading claim; the exact first-party audio and video fallback indicators are governed by the separate playback controls below. Compatible and future-schema null reports render no notice. Current-format `.scape` inspection receives the same selected-product evaluator as a provider-owned option that caller options cannot override; exact schema 9 is evaluated after archive and source validation but before project collision lookup and returns a deep-frozen report, while future schemas return `null` and `featureRequirements` is not traversed. Maintained workspace/UI file-open routes turn an incompatible exact-schema report into one closed decision: no-collision opens offer **Open read-only** or **Cancel**, and a combined incompatibility and ID collision offers **Open as read-only copy** or **Cancel** in a single decision. Cancel settles before import, persistence, or activation. Acceptance passes only the existing copy policy into native open; the controller then reevaluates the actual project history and enforces it as intrinsically read-only. The localized dialog shows bounded display names, stable feature IDs, availability, and declared disposition, defaults focus to Cancel, and supports Escape dismissal and focus restoration. A separate maintained-controller admission step now verifies exact-schema-9 raw and stored-project rendered fallbacks against referenced local bytes before activation side effects. It binds existing-tab work to a session-owned history token and, after verification, obtains one exclusive session activation reservation before the first side effect. The reservation rejects target history replacement, close/reopen, and competing active-project publication through synchronous session publication and is released in `finally`. Admission reads disable on-access PCM migration scheduling and retained-media digest claim/backfill, so verification does not publish storage maintenance. It hashes canonical audio under checked geometry and a cumulative 65,536-chunk ceiling, hashes genuine original-media Blob bodies through a non-raiseable 4 MiB window, and applies a non-raiseable 64 GiB cumulative claimed-byte ceiling before fallback body reads. It runs sequentially and is cooperatively cancellable through the maintained store. Read-only video-metadata preflight is raced against cancellation, so an injected signal-ignoring provider may continue after admission rejects; a provider-stalled fallback body read can instead delay cancellation settlement and iterator cleanup. Verification deduplicates matching claims and rejects conflicting claims before storage reads. Future schemas are not traversed. This is point-in-time admission, not verification for arbitrary direct store loads, continuous binding against later low-level source replacement, publisher authenticity, runtime fallback substitution by the admission control, future-schema preservation, affected-object placeholders, or per-feature bypass controls. The separate playback controls below implement only the exact first-party audio whole-mix and first-party video-effects full-render exceptions. Complete third-party activation gating remains a separate later surface rather than a prerequisite for the maintained first-party audio- and video-effect notices described below. AUP4 conversion sanitizes imported structure. Legacy `.aup` XML applies a format-specific structural budget: authoritative declared `File.size` and the independently measured UTF-8 byte length of returned text are each capped at 16 MiB, retained elements at 100,000, attributes at 400,000, and depth at 128 through non-raiseable production ceilings and lower-only test seams. Supported canonical, default-sized simple/silent `_data` materialization adds non-raiseable ceilings of 65,536 selected companion files and 65,536 materializing references, 2 MiB per referenced physical file, 1 MiB per AU sample payload, 524,288 decoded or silent frames per block, 512 MiB of authoritative unique referenced file bytes, and 512 MiB of retained Float32 PCM. Bounded exact/basename indexes prevent reference-by-file lookup multiplication. Positive block lengths, a 24-byte AU header minimum, and equal-length paired linked clips are required; repeated references, silence, and linked zero-fill are charged. Selected/reference, declared-byte, and retained-PCM admission precedes retained-PCM allocation or block reads, while payload/frame refusal precedes decoded-block allocation; actual returned bytes must match snapshotted authoritative `File.size`. Audacity native-endian AU headers and samples are accepted, each unique file is read and decoded once, and one preallocated output per physical clip limits the logically reachable parser-owned window beyond retained PCM to one 2 MiB encoded file plus one 2 MiB decoded block. Equal or admitted zero-padded linked channels reach conversion without channel-normalization copies. Structural or materialization refusal precedes conversion, project/source persistence, and imported-project publication. These format-specific controls do not qualify XML-tree or opaque-extension clone amplification, elapsed time or cancellation, aliases, customized Audacity block-size settings above policy ceilings, provider-internal copies or garbage-collection lag, downstream conversion/waveform/storage/persistence working sets, total renderer RSS, noncanonical AU padding, other project families, or streaming-scale legacy import. The cross-format malformed-project regression and fuzz corpus remains incomplete.

`maintained-project-publication-admission` narrows one local publication surface. Every maintained caller save entering `AudioEditorProjectStore.saveProject`, and every maintained project copy entering its create-only publication path, serializes the submitted snapshot once for admission with the canonical tagged-binary `.scape` project-document codec and rejects UTF-8 output above a non-raiseable 256 MiB ceiling, with a lower-only test seam, before repository save or create-only mutation. These paths cover queued controller saves and maintained direct callers including inactive-tab close, project switch, import, duplication, and Scape transaction save or rollback. After the actual backend resolves, including IndexedDB-to-memory fallback, each maintained save or duplicate admits exactly twice the canonical UTF-8 length as a deterministic gross proxy for one current-project payload plus one revision-project payload, with exact `ceil(10%)` policy headroom immediately before repository publication. Direct IndexedDB saves and duplicates obtain one normalized estimate and use the strict admission owner. Queued autosave, explicit flush, and terminal flush instead pass the controller's localized capacity callback into the store and reuse the store's sizing result without a second canonical serialization. A duplicate can already have published its fresh pathless linked-video aliases when admission runs; a known shortage publishes no project or revision and invokes exact alias compensation, preserving the source alias and any replacement destination binding. A known insufficient estimate rejects direct and queued writes, including terminal teardown, before repository mutation or controller success side effects; an unknown or malformed estimate and every resolved memory backend proceed. Ordinary save rejection leaves the snapshot dirty without save, active-ID, garbage-collection, or usage-refresh side effects and the serialized queue admits a successor; duplicate rejection leaves no maintained copy project or revision after successful compensation.

`project-publication-capacity-accounting` remains open. The twice-canonical planning amount is deterministic but is not an exact IndexedDB byte count: the local repository clones and compacts unreachable source metadata, then publishes structured-clone current and revision records with revision-wrapper fields. Browser record, key, property, transaction, journal, replacement, pruning, allocation-unit, and quota-accounting overhead remain unmeasured. The 256 MiB ceiling is evaluated after canonical serialization and does not bound the controller snapshot clone, already-materialized serializer string, heap, RSS, garbage collection, elapsed time, or backend write work. The capacity check covers maintained facade saves and the duplicate create-only project-publication path but is point-in-time and unreserved: estimates may lag, concurrent writers can oversubscribe, and write-time quota failure remains possible. Duplicate admission follows its separate alias transaction; the twice-canonical amount does not model alias-record overhead or reserve the later project transaction, although tested refusal performs exact alias compensation. Memory fallback and unknown estimates have no durable-capacity claim. For desktop shared projects the browser-side estimate covers only the local IndexedDB shadow. Exact-absent managed-media body publication separately validates prospective catalog geometry and performs same-store point-in-time managed-root admission before body or optional hard-link work. That control does not cover renderer/main IPC, main-process appData project-document staging, SQLite catalog or WAL allocation, filesystem allocation overhead, cross-store or cross-process coordination, whole-handoff reservation, later external allocation, or write-time success. An authoritative shared-project load can publish its local shadow outside the save facade. Capacity refusal during Scape rollback restoration can also surface an aggregated rollback failure after the prior row was removed. Directly constructed repository instances, pre-existing over-limit stored documents, and other route-specific controls remain outside this control.

For current schema 9, create, load, clone, and commit paths reconcile the reserved `soundscaper.audio-effects` requirement when maintained first-party effects occur in track, group, send, or master racks, including disabled effects and inactive racks. Publisher-authored audio-effects requirements take precedence, missing or foreign effects do not trigger the owned declaration, and reserved-ID conflicts reject. The same paths reconcile the reserved `soundscaper.video-effects` requirement for maintained first-party effects on timeline and Project Bin video clips, including disabled effects. Publisher-authored video-effects requirements take precedence, missing or foreign effects and stacks on non-video clips do not trigger the owned declaration, and reserved-ID conflicts reject. When exact schema 9 reports registered `audioEffects` as unavailable with declared `bypass` and effective `bypassed`, activation derives a bounded, non-persisted engine projection before activation side effects. Only active, enabled, not already bypassed maintained first-party effects in track, group, send, and master racks become minimal bypassed playback copies; the canonical project, history, source loading, and persistence remain unchanged. The lower-only 4,096-effect ceiling rejects instead of truncating, and inventory construction does not read effect `params`, `context`, or `state`. Deep-frozen per-tab and snapshot metadata drives one localized, noninteractive affected-object inventory under the first qualifying requirement. Unknown or third-party effects, rendered fallback, offline render or export behavior, and activation controls remain outside this audio slice.

First-party audio rendered-fallback playback is a separate exact schema 9 control. Exactly one item whose feature ID belongs to the explicit host-owned registered audio capability allowlist (`audioImport`, `audioPlayback`, `audioTimelineEditing`, `audioMixing`, `audioRecording`, `audioGenerators`, `audioEffects`, `audioSpectralEditing`, `audioAnalysis`, `audioMacros`, and `audioSampleEditing`) must be unavailable with declared and effective `rendered-fallback`, and its descriptor must match the canonical manifest. A mono or stereo source matching project rate and master width becomes one neutral whole-mix clip using its full frame range from frame zero; canonical audio paths and mixer/master processing are removed only from the transient playback projection, while video and label timing remain. The canonical project, history, persistence, save, export, and offline render stay unchanged. Initial activation and later engine reapplies share the same projection. Required stored metadata is rechecked; short sources are decoded and their buffer geometry must match exactly, while oversized sources must expose a streamable chunk provider. Readiness does not prefetch or revalidate streamed chunks, so later provider failure remains possible. Initial activation privately stages only the required fallback source before acquiring the session activation reservation or performing activation side effects. A decoded buffer or stream-provider candidate remains outside shared `sourceBuffers`, shared `sourceChunkProviders`, and engine chunk-source publication during this pre-reservation phase. Metadata, audio-context, and decoded-body operations race the controller-lifetime signal, reject cancellation promptly with its exact reason, and fence late settlement from publishing buffers, chunk providers, engine chunk sources, missing-source state, or status. A readiness or reservation failure discards the preparation and leaves the active project, tab, lock, and prior shared source identities unchanged. After preparation, activation rechecks fallback admission and session-owned history identity before reserving the target; later currentness checks fence engine entry and shared publication. Ordinary loading explicitly excludes the staged fallback source. Commit builds private buffer and provider snapshots from current shared state plus ordinary transient buffers, with the staged required source taking precedence over a conflicting transient. The engine receives those private snapshots first. After its callback returns, commit checks the signal and then runs the owning admission or canonical-project identity assertion synchronously at the publication boundary; no await intervenes before the required buffer or provider mutates shared state. Engine failure, cancellation, reservation or currentness failure, a publication-boundary identity failure, and a throwing cache publication preserve the prior shared identities; cache refusal removes rather than exposes a stale required representation. Commit ownership is single-use and discard is idempotent. Each canonical playback reapply owns one replaceable controller-lifetime task. A newer reapply or a successful project switch aborts stalled metadata, audio-context, or decoded-body source preparation with the exact reason; the switch does so before teardown. Late settlement is fenced from buffer, provider, engine-source, missing-source, and status publication. In the tested stalled-preparation race, only the newest source-ready projection enters the engine. Frozen per-tab and snapshot metadata and the localized source/component UI indicator remain bound to the exact feature ID and requirement ID without reading or exposing source identity or digest. The `audioSpectralEditing` composed Soundscaper-to-fresh-Framescaper activation witness transfers the manifest-only fallback beside editable original PCM, authenticates both managed bodies, verifies the fallback manifest digest before the transient projection, and preserves the exact canonical shadow. Digest admission is point-in-time, not a durable byte lease. An `engine.applyProject` or activation engine callback already entered is not abortable or transactional and may have taken effect even when its post-call publication-boundary assertion blocks shared publication; cancellation is observed only after that callback settles. Failure in a later activation step after successful engine and shared source publication is not rolled back. Ordinary-source loading remains outside this required-source publication transaction, and short-buffer retention after engine application remains subject to cache-fit policy. Streamed chunks are not prefetched or revalidated after readiness. ADM and surround playback remain outside this control. More than one qualifying registered audio fallback, including across different registered audio feature IDs, rejects as ambiguous, and video IDs never qualify for this audio projection. Generic fallback, freeze or proxy authoring, unknown or third-party activation, linked-only or unmanaged playback, future schemas, and earlier Soundscaper schemas remain outside this control. The source/component UI indicator is qualified, but packaged runtime or UI workflows, operating-system behavior, browser audio behavior, reference-scale evidence, and a durable byte lease are not.

Final audio rendered-fallback delivery is another narrow exact schema 9
control. Exactly one item whose feature ID belongs to the explicit host-owned
registered audio capability allowlist (`audioImport`, `audioPlayback`,
`audioTimelineEditing`, `audioMixing`, `audioRecording`, `audioGenerators`,
`audioEffects`, `audioSpectralEditing`, `audioAnalysis`, `audioMacros`, and
`audioSampleEditing`) must be unavailable with declared and effective
`rendered-fallback`, exactly match the canonical manifest, and be the only
rendered fallback in the report. The capability-evaluated service applies only
the audio projection to final mix delivery. It supports normalized mix mode
only; stems, BW64, and ADM reject before integrity verification or other export
work. The canonical project, history, persistence, and save state remain
unchanged.

Delivery does not reuse activation-time byte admission. Under the owned
export-task signal, an operation-time selector binds the exact requirement ID,
feature ID, audio kind, source ID, and SHA-256 and verifies only that selected
PCM body; unrelated fallback storage is not read. It scans the full canonical
`audio-f32le-chunks-v1` sequence with exact PCM geometry under the existing
65,536-chunk ceiling and the selected target's share of the non-raiseable
64 GiB fallback-byte ceiling. The scan records 32 bytes per chunk in a digest
table bounded to 2 MiB, then returns one private provider with the admitted
source geometry.

For each requested stored chunk, the provider disables on-access migration,
copies tight `Float32Array` channels, validates the requested index and exact
frame and channel geometry, and compares the canonical chunk digest with the
admitted table. It observes the task signal and operation currentness before
the read, after the read, and before return. Missing, malformed, reordered,
wrong-geometry, replaced, or digest-mismatched chunks fail with the stable audio
fallback integrity identity instead of reaching the renderer. The full scan
and per-read checks provide operation-scoped integrity; they do not reserve or
freeze the backing storage binding.

Settings refusal and verification complete before the export plan, picker,
storage preflight, render, or output publication. The projected renderer sees
an empty private source-buffer map and the verified provider as its sole private
chunk source. Global source-buffer, source-provider, engine chunk-source, and
cache state remain unchanged, and committed time-pitch cache preparation is
skipped. This same private context reaches offline, realtime, and direct PCM
rendering. A stable integrity failure from an offline provider read is not
downgraded by retrying in realtime. Ordinary audio exports retain their
existing source maps, callback shape, cache preparation, and non-integrity
offline-to-realtime retry behavior.

`audioSpectralEditing` supplies the composed Soundscaper-to-fresh-Framescaper
witness. The canonical manifest, frozen playback metadata, and localized
source/component UI remain bound to the exact feature ID and requirement ID
without exposing fallback internals. Its operation-time export selector
cross-binds the exact requirement ID and feature ID with the audio kind, source
ID, and SHA-256. Corrupt recipient-local fallback PCM after activation triggers
tamper refusal and rejects delivery before render or download; exact repair
restores the exact PCM and expected fallback samples in successful WAV delivery
while the canonical project and stored shadow remain unchanged.

The full scan and per-read checks are not a durable storage-record or byte lease
and provide no cross-process immutability. Generic fallback is unqualified;
unknown or third-party IDs and video IDs never qualify. More than one qualifying
registered audio fallback, including across different registered audio feature
IDs, rejects as ambiguous. Authored fallback relationships, freeze or proxy
workflows, linked-only or unmanaged delivery, stems, BW64, ADM, surround
delivery, packaged runtime or UI workflows, browser audio behavior,
reference-scale evidence, future schemas, earlier Soundscaper schemas,
whole-handoff atomicity, and operating-system behavior remain unqualified.

When exact schema 9 reports registered `videoEffects` as unavailable with declared `bypass` and effective `bypassed`, activation derives a bounded, non-persisted preview-playback projection before activation side effects. Enabled maintained first-party effects on timeline and Project Bin video clips become minimal disabled copies for engine loading; the canonical project, history, source loading, persistence, save paths, offline render, and video export remain unchanged. The lower-only 4,096-effect ceiling, 256-character stable-ID ceiling, and 128-character effect-type ceiling reject instead of truncating, and inventory construction does not read effect `params`, `context`, `state`, or opaque payloads. Each placeholder entry in the deep-frozen per-tab and snapshot metadata records only Timeline or Project Bin location, clip ID, effect ID, and effect type and drives localized, control-free placeholders with canonical clip ownership. A cached selector removes only exact timeline clip ID, effect ID, and effect type matches before compositor rendering and active-effect counting; Project Bin inventory is not applied to the compositor. Future schemas return before clip or Project Bin traversal. Already-disabled, foreign, unknown, and third-party effects, rendered fallback, offline render or export behavior, activation controls, earlier Soundscaper schema compatibility, and complete third-party activation gating remain outside this video slice.

First-party video-effects rendered-fallback preview and playback is a separate exact schema 9 control. Exactly one registered first-party `videoEffects` item must be unavailable with declared and effective `rendered-fallback`, and its video descriptor must match the canonical manifest requirement. Existing controller admission fully reads the genuine immutable video Blob, verifies its exact admitted size and SHA-256 through non-raiseable 4 MiB digest windows before activation, and the project-switch path rechecks admission currentness after required-source activation and before transient engine entry. The fallback source must be the one exact video source named by the manifest. Project and source sample rates must be positive safe integers and equal; frame count, width, and height must be positive safe integers, and frame rate must be positive and finite. Missing, duplicated, wrong-kind, ambiguous, or drifted sources, unsafe geometry, and reserved synthetic track or clip IDs in the timeline or Project Bin reject. The transient full-length render begins at frame zero, replaces only timeline video tracks and clips, and preserves audio, labels, Project Bin, and sources; canonical document and history state stay unchanged. Initial activation and later playback reapply explicitly activate a required manifest-only video source before the transient engine project and preview. Preview lookup first asks the canonical clip surfaces; because the synthetic projected clip is not canonical, it then resolves the exact fallback source ID through canonical source lookup and never treats the synthetic clip ID as canonical state. Deeply frozen session and snapshot metadata drives the localized notice that the fallback is active during editor playback without exposing source identity or digest. This narrow playback control does not provide generic or third-party fallback, an authored proxy or freeze contract, future-schema behavior, offline render, packaged or browser-codec qualification, a durable byte lease, range protocol, or reference-scale evidence, and it makes no promise about embedded video audio extraction or playback. Maintained final-video fallback delivery is governed only by the separate control below.

The same maintained first-party relationship crosses explicit managed handoff in
one composed headless Framescaper-to-fresh-Soundscaper workflow. Retention roots
the fallback when its manifest is its only project reference; sender handoff
transfers its editable retained-video original and the fallback as two exact
managed video bodies. The empty recipient acquires both bodies and the exact
canonical shadow before the controller independently authenticates the
fallback declaration and activates the exact fallback Blob URL. Managed
transfer authenticates each descriptor and body digest, not the manifest
declaration. This point-in-time whole-Blob evidence is per binding and does not
claim whole-handoff atomicity, a durable playback lease, packaged UI, browser
codec playback, or reference-scale range transport.

Final video rendered-fallback delivery is another narrow exact schema 9
control. Exactly one registered first-party `videoEffects` item must be
unavailable with declared and effective `rendered-fallback`, exactly match the
canonical manifest, and be the only rendered fallback in the report. The
capability-evaluated service applies only the video delivery projection: the
full fallback replaces timeline video from frame zero while canonical audio is
retained, and audio fallback plus audio/video bypass projections are not
composed. Canonical project, history, and save state stay unchanged.

An active delivery does not reuse activation-time byte admission. Under the
owned export-task signal, the selector-mode verifier reselects the exact active
canonical video requirement, source, and digest and verifies only that target.
Unrelated inactive audio fallback storage is not read. Selector mismatch or
ambiguity rejects before storage. The verifier loads the selected local body
once, constructs a canonical native `Blob`, and size-checks and hashes that
same object with SHA-256 through non-raiseable 4 MiB windows. Its admission
returns that same verified object.
Export reuses it as the sole video input with no second fallback-store read,
eliminating the selected fallback's storage-reread TOCTOU between admission and
FFmpeg.

That verified `Blob` may then enter either the separately governed exact direct
MP4/WebM route or the legacy final-`Blob` route. Source digest verification and
the delivery projection remain owned by this rendered-fallback control; direct
target transport and commit are owned by their separate control.

Task, project-generation, and operation currentness are asserted before
verification and again after admission immediately before planning. The
export-task signal fences verifier work, separately staged canonical-audio
render, and FFmpeg. On the legacy prepared-`Blob` branch, post-encode
currentness precedes output-`Blob` construction. After prior-output cleanup is
awaited, cancellation and currentness are asserted again before download
publication, and the same export-task signal is passed through that publication
request. After publication returns,
cancellation and currentness are checked again. When that check refuses a late
result, its returned recoverable cleanup handle is awaited before refusal; this
does not make publication transactional or undo an external destination that
provides no such handle. FFmpeg maps canonical audio only from the separately
staged mix, so embedded audio in the fallback container is ignored. A stale
activation-time digest, missing managed body, wrong body, or digest mismatch
refuses before planning, FFmpeg, and either downstream publication route,
including download.

The composed fresh managed handoff test replaces the acquired fallback after
activation, proves that corrupt bytes cannot authorize delivery, restores the
exact acquired body, and then proves that body alone reaches a successful video
output while canonical state remains unchanged. The retained immutable `Blob`
supplies point-in-time bytes for this export, not a durable storage-record
lease. It does not qualify external writer or cross-process durability. It
makes no generic or third-party, simultaneous rendered-fallback, authored
fallback or proxy, linked-only, unmanaged, reference-scale, browser-codec,
packaged-runtime, whole-handoff atomicity, or broad preview/export parity
claim.

Descriptor validation alone does not hash or authenticate the referenced media bytes; the separate exact-schema-9 controller admission described above verifies referenced local bytes at its narrower boundary.

`external-media-parser-bounds` is **partial**. WAV/ADM paths have explicit structural and expansion limits, and custom FFmpeg output arguments and protocols are constrained. Compressed audio/video still needs a broad malformed-input corpus, decode budgets, and—when native decoding arrives—a supervised crash-isolated process.

### Portable `.scape` projects

`scape-archive-structure-integrity` is **enforced for the current portable format**. Import and inspection share a strict TypeScript envelope that rejects unsafe or duplicate names, encrypted and directory entries, descriptor aliases, reserved-entry reuse, missing entries, and unreferenced extra entries. Descriptor sizes must match central-directory uncompressed sizes before project or asset extraction, and import still verifies size and SHA-256 after extraction. Import configures zip.js with `checkSignature: true`, so extraction also enforces each entry CRC; a negative rollback test corrupts stored-asset CRC metadata, observes signature rejection, and leaves the target inventory unchanged. After project migration, a second shared boundary requires equal source/descriptor counts, unique exact case-sensitive source IDs, and matching audio/video kinds. Orphan, missing, duplicate, invalid, and kind-mismatched identities reject before collision handling, transaction creation, or any storage call; canonical export round trips preserve the same bijection.

Every project schema is structurally scanned before `JSON.parse` constructs its object graph under lower-only raw ceilings of 101,536 JSON values and depth 130. These raw maxima include exact schema 9's worst-case wire expansion for 256 tagged-binary payloads—six additional JSON values per payload and two additional depth levels—so lowered logical encode and decode limits remain round-trip closed. For exact schema 9 in the current format, opaque `Uint8Array`, offset-view, and `ArrayBuffer` bytes use one reserved, versioned JSON tag. Export copies the addressed bytes and independently applies non-raiseable ceilings of 256 payloads, 4 MiB per payload, 8 MiB aggregate bytes, 100,000 logical traversed nodes, and depth 128. Import and inspection validate the closed descriptor shape, unique positive IDs, canonical base64, exact byte lengths, tag collisions, and the complete decoded budget before decoded-byte allocation, collision lookup, transaction creation, or storage. Project-container accessors, callable container `toJSON` hooks, cycles, unsupported binary views, malformed tags, and ambiguous tags reject. Decode restores only the declared binary type; it does not interpret or activate the bytes. Other project schemas keep ordinary JSON values: tag-shaped future state is structurally scanned and counted but is not decoded or interpreted, and this control does not claim unchanged future-archive re-export.

For current-format exact schema 9 archives, every rendered-fallback claim is bound to its canonical asset descriptor before compatibility evaluation, collision lookup, or storage. Export snapshots the admitted project root and complete source records, serializes those same sources and the bounded normalized fallback manifest used for validation, rejects project-root/source-record accessors and callable `toJSON` hooks without invocation, hashes completed canonical asset output, and rejects a mismatch before manifest write or destination commit; import hashes each extracted asset body and verifies its size and SHA-256 before source or project publication. Inspection performs descriptor binding but does not hash asset bodies. Separately, maintained exact-schema-9 controller activation verifies the referenced local audio and video fallback bytes for the authoritative raw or stored activation project before activation side effects. Direct `store.loadProject()` calls, durable integrity after admission, runtime fallback use by activation admission itself, and future-schema `featureRequirements` remain outside that control. Runtime selection belongs only to the separate first-party audio and video playback controls plus their narrow operation-time-verified final-delivery controls above. These are internal digest-integrity checks, not publisher authenticity.

One narrow linked-WAV portable-archive control covers the current-format exact schema 9 path when the sender has no owned PCM. Export reads the maintained linked RIFF or RF64 PCM or IEEE-float WAV through the verified source reader and writes only canonical `audio-f32le-chunks-v1`; the external WAV container bytes and pathless locator identity are absent from the project, manifest, and complete archive. A fresh portless recipient imports ordinary owned PCM with zero linked bindings and reopens with exact samples and project state durably. The direct witness uses RIFF IEEE-float, while focused reader and import coverage owns the wider maintained RIFF/RF64 PCM and IEEE-float input boundary. This control does not qualify future-schema archive preservation, byte-exact WAV-container preservation, packaged executable or UI and operating-system behavior, relink or watch, other audio formats, or audio range playback.

`scape-archive-expansion` is **enforced for the current canonical STORE `.scape` import surface**. Before reading manifest bytes, the shared envelope validates entry count, encryption state, and safe compressed/uncompressed metadata, and rejects more than 64 GiB of cumulative declared uncompressed data. Central-directory indexing also requires ZIP STORE with equal compressed and uncompressed sizes before local-header preflight or body reads, so a tested high-ratio DEFLATE archive cannot spend decompression work or reach storage. Canonical export pins and verifies the same STORE policy. The non-raiseable 4,096-entry ceiling bounds the quadratic pairwise layout pass, and export applies it before creating a destination. Manifest JSON is capped at 32 MiB and project JSON at 256 MiB by both metadata preflight and byte-counted text sinks. Descriptor sizes must match entry metadata before project JSON or asset extraction. One shared counter also charges bytes actually emitted into the manifest, project, and every extracted asset against the 64 GiB limit before an over-budget chunk is retained. PCM chunk headers and canonical project chunk geometry are validated before byte-length arithmetic or allocation, limiting parser-owned pending PCM storage to 16 MiB plus its four-byte header; one archive-wide 65,536-chunk ceiling deliberately bounds parser iterations and source-writer calls for the portable format. Export preflights that aggregate audio work before asset reads and rejects backing-store chunks that do not match the same geometry or final frame total. For the tested native `.scape` open/save path, one task `AbortSignal` reaches incremental ZIP enumeration and extraction, source reads and writes, archive output, and file publication. Cancellation closes the archive reader, returns source iterators, aborts unpublished output and transactional source/media writers, deletes provisional media, and restores the previous project together with its retained revision history.

The separate `point-in-time-import-capacity-admission` control sums every validated manifest asset size with checked safe-integer arithmetic and adds exact `ceil(10%)` headroom. After the existing-project collision-cancel decision, but before copy remapping, transaction construction or capture, source metadata reads, writer creation, or asset extraction, import obtains exactly one storage estimate. An existing-ID cancel performs no estimate; copy and replace each charge the full incoming asset total without credit for replaced content. A missing or unknown estimate permits import, while known insufficient free space raises stable frozen `QUOTA_EXCEEDED` details. The maintained native-controller route exclusively supplies a decorated preflight callback with the raw asset-byte total and captures the composed import task signal. Its storage-capacity service derives the same exact headroom requirement, publishes `checking` followed by `ready`, `unknown`, or `insufficient` in the workspace `lastPreflight` snapshot, and returns the one normalized estimate that drives the Scape quota decision. Cancellation promptly abandons a signal-ignoring estimate, closes the reader, starts no writer or extraction, restores the prior settled preflight snapshot, consumes late provider resolution or rejection, and generation-fences older work from replacing newer state. Standalone undecorated imports retain the optional direct store estimator and do not update controller state. The authentic sparse witness pins 8,589,932,094 asset bytes and the exact 9,448,925,304-byte required-free threshold, with capacity estimation before its media writer. This remains a point-in-time advisory check: it does not reserve capacity, establish real browser or filesystem quota accuracy, qualify OPFS or IndexedDB durable 8 GiB persistence, account for browser-record or filesystem-allocation overhead beyond the policy headroom, guarantee write-time success, or serialize concurrent writers.

Default import and inspection run a bounded raw-layout preflight before constructing zip.js. It anchors exact classic or Zip64 end records without offset repair, walks exactly the declared central records under a shared non-raiseable 33 MiB cap, resolves required Zip64 fields in specification order, and compares every local header and signed or unsigned data descriptor with its central owner without extracting or hashing an entry body. The fixed ZIP end-record search can nevertheless overlap at most 65,557 bytes of a final payload tail before it anchors those structures. Checked entry ranges must exactly partition the bytes preceding, and never cross, the central directory; exact no-descriptor CRC/size checks close zip.js's zero-field exception. Export admission uses the same ceiling with a conservative per-entry allowance for the pinned writer's greater-than-4-GiB Zip64 offset field, preventing a canonical save from creating an archive that this control refuses. Focused fixtures cover repaired end-record offsets, unsafe Zip64 values, malformed extras and descriptors, zeroed local fields, overlap, gaps, and central-directory crossing, while cancellation and exact bounded reads remain enforced. zip.js strict local-header and pairwise overlap checks remain as defense in depth.

Raw admission and zip.js now consume one branded random-access byte-source contract. A provider may lower individual reads beneath the 33 MiB logical maximum, but cannot raise it; captured native typed-array operations validate actual internal byte length and publish a defensive copy. Validation retains private structural observations under an exact 69,271,649-byte canonical-writer-profile ceiling, including central comments. Conflicting overlaps reject, and later ZIP reads receive the admitted end, central, local-header, name/extra/comment, and descriptor bytes while the provider is called only for payload gaps. Standalone validation enforces the same ceiling, and the Blob path uses the same reader with parity coverage. The zip.js adapter uses a zero-high-water-mark payload stream, so overlap-only checks pull lazily instead of prefetching the start of a large entry. The strict renderer adapter snapshots the descriptor URL/declared size and fetch implementation, splits logical reads at the 16 MiB platform media-chunk ceiling, requires exact `206`, `Content-Range`, `Content-Length`, and body-byte agreement, and serializes requests until stream `done`. The first admitted abort or transport error best-effort cancels the response and terminally fences queued and future requests with one stable restorable reason; a request aborted only while queued neither fetches nor poisons the source. Desktop project-dialog and OS-association opens share one explicit router. A terminal case-insensitive `.scape` name reaches the range path only when the file service also requires the exact canonical Scape MIME type; browser `.scape` files continue through the Blob source, and Audacity and all other desktop project or media families retain their existing bounded materialization paths. The file service constructs the range source inside one awaited capability scope spanning inspection, any collision decision, and import, then releases the descriptor exactly once after the consumer settles on success, failure, user cancellation, or abort. The adapter deliberately has no descriptor ID or release authority; main-process release and retirement remain the authoritative native cleanup barrier. An inspection collision-cancel witness uses an exact 8 GiB sparse Zip64 current-schema `.scape` fixture through the real read-capability store, protocol handler, renderer adapter, structural inspection, and collision lookup before cancellation. It transfers less than 8 MiB in exact ranges, touches the huge body only in the at-most-65,557-byte suffix unavoidably overlapped by the ZIP end-record search, and does not hash that body. The authentic exact 8 GiB fixture binds its 8,589,932,094-byte all-zero asset to SHA-256 `7feeb1e9eacb6561f3c5afb4ebf3896c8237660a9b4ed8917d3275c79bed38be` and CRC-32 `2,909,126,900` (`0xad65c0f4`). zip.js extraction runs with `checkSignature: true` CRC enforcement, and the negative rollback regression described above proves a corrupted stored-asset CRC rejects before target publication. A separate full-import witness takes that entire asset through the real read-capability store, Node protocol handler shim, strict renderer adapter, file service, project service, and full import into an independent counting-SHA-256 transactional sink. The sink observes the authentic byte length and SHA-256 with at-most-4-MiB awaited writes and zero payload retention; its point-in-time capacity estimate precedes the media writer and admits exactly 9,448,925,304 required free bytes. The range route performs no Blob materialization, capability release occurs exactly once, and the pinned handle close occurs exactly once. That full-import witness remains verified reference evidence and is exposed as the opt-in portable reference-scale gate `npm run test:reference:scape-8gib`. Routine Node and coverage runs fast-skip it because a measured all-files coverage run passed but took 525 seconds. This scheduling does not demote or narrow the verified result; collision-cancel inspection and the corrupted-CRC negative rollback remain in routine coverage. Those two reference witnesses require sparse-file support and use a Node protocol shim rather than packaged UI. The counting sink is not OPFS or IndexedDB durable 8 GiB persistence and does not qualify real production browser or filesystem quota accuracy or reservation, write-time success under concurrent writers, browser heap or process RSS, whole-storage atomicity, or publisher authentication.

A separate maintained Soundscaper-only Linux x64 packaged smoke production-exports an exact-schema-9 project with one mono source, one track, and one clip: 16,384 Float32 frames at 48 kHz and a 65,540-byte framed PCM asset. Its archive is larger than the 65,557-byte ZIP end-search suffix and no larger than 96 KiB. The packaged executable receives that `.scape` as a positional argument under isolated user and application-data roots, exercising native OS-open argument extraction and the pending queue, a main-owned `scape-range-v1` descriptor, preload event delivery, the renderer router, range adapter and protocol, inspection and import into real packaged application storage, activation, exact project, track, and clip identities, and visible success without an alert or dialog. The harness observes the capability live before delivery and retired after open, and the closed sanitized result exposes no capability ID, URL, or filesystem path. This qualifies only the small current-schema packaged application path. It does not qualify installer or file-association registration, a shell launch, packaged 8 GiB or other reference scale, payload laziness or absence of whole materialization beyond the known range route, playback, persistent reopen or durability, crash or power loss, memory or RSS, quota accuracy, reservation, or concurrency, Windows, macOS, ARM, Framescaper, arbitrary third-party ZIP or effect semantics, or legacy Soundscaper schemas or libraries. Third-party activation gating and legacy Soundscaper compatibility are not current priorities; Audacity project interchange remains a separate boundary.

A second maintained Soundscaper-only Linux x64 packaged process extends that small-fixture path into an orderly process-restart persistence witness. The first process imports the exact 69,349-byte schema 9 revision 7 source-bearing archive under isolated user and application-data roots, verifies the archive unchanged, reaches a clean exit, removes the archive, and proves its absence through `ENOENT`. The second process launches the same executable against the same roots with no positional `.scape` and no read descriptor or capability; normal bootstrap automatically reopens the project. It rereads the canonical schema-9 revision-7 shared project and verifies exactly one source, track, and clip plus their ownership and source relations, the exact active project, track, and clip identities, and an Audacity PCM-backed waveform with no waveform error, alert, or dialog. The same second process proves that the known reopened fixture's stored PCM enters the editor playback graph. It requires exact enabled `Play` and `Stop` controls; `Play` exposes an active, pressed `Pause`, and during that same active interval the playhead advances and the master playback meter rises above its declared floor. Explicit `Stop` restores enabled, unpressed `Play` and resets the playhead to zero. The closed result contains no archive path, descriptor, capability, or private storage path. This qualifies only orderly process-restart automatic source-bearing persistence and reopen plus transport entry, playback-clock advancement, master-meter activity, and explicit stop and reset for that known current-schema fixture. It does not establish audible or device output because the harness passes `--mute-audio`, playback fidelity, dropout- or glitch-free playback, full-duration playback, mixer, routing, or effect correctness, storage durability, crash or power-loss behavior, fsync, eviction, quota accuracy, reservation, concurrency, Windows, macOS, ARM, Framescaper, cross-product transfer, arbitrary third-party ZIP or effect semantics, or legacy Soundscaper schemas or libraries. Third-party activation gating and legacy Soundscaper compatibility are not current priorities; Audacity project interchange remains separate.

Original video extraction no longer materializes the complete archive entry. zip.js is pinned to 4 MiB emissions; each emission is charged against the actual-byte budget, independently hashed, and awaited through a transactional media writer before the next emission. The writer independently snapshots and hashes storage bytes, enforces exact declared size and digest, and publishes metadata last. OPFS receives bounded writes, IndexedDB fallback stores source-owned native Blob chunks, and process-memory fallback rejects declared payloads above 64 MiB before extraction. The 64 MiB limit is payload admission for the degraded in-process backend, not a claim about total renderer heap or process RSS. Reference-scale cancellation, oversized emission, digest/metadata drift, and publication-failure tests leave prior project/source inventory unchanged.

IndexedDB schema v6 atomically strips the two newly reserved provenance fields from every pre-cutover retained-media row through a one-record-at-a-time cursor; a failed sanitization rolls the complete version change back. Markerless records do not expose an inherited SHA-256 as verified metadata. Their first load atomically installs a retryable version-zero claim with a Web-Crypto content token, validates stored size and chunk geometry, and hashes the stored Blob in bounded 4 MiB reads. A final compare-and-set merges version-one digest provenance only while the same payload token still owns the row, so a concurrent delete/replacement or failed publication cannot receive a stale digest. Cancellation is checked before claim, during bounded reads, after the final compare read, and before publication; an admitted final metadata put settles as the commit boundary. Internal claim/version fields never cross the public metadata API. Every retained-media load now registers synchronously, before its first await, with the same per-store lifecycle coordinator as streamed writes. Clear holds a temporary admission fence and close a permanent fence; both signal captured reads through cancellation linked with the caller and await terminal settlement before deleting data or closing the database. A digest already inside one non-raiseable 4 MiB Blob read observes cancellation when that read returns. The final metadata put remains the commit boundary: a put admitted before the fence settles before maintenance continues, while an abort observed earlier prevents version-one publication. Degraded memory close therefore cannot receive a provenance update after close settles.

Production `.scape` save now selects one user target before asynchronous flush and gives its destination factory the admitted archive maximum. Archive output is re-chunked to at most 4 MiB, awaited with backpressure, and counted independently by the ZIP boundary and file adapter; disagreement aborts before publication. File System Access and desktop outputs remain staged until the controller's final ownership check. FSA `close()` or desktop sync-and-rename is then one explicit non-cancellable commit boundary, so cancellation before it rolls back while cancellation after it cannot falsely report that a committed file was removed. Desktop adds acknowledged one-MiB IPC chunks and bounds writes by the project-specific admitted maximum. Chromium and Firefox workflow evidence reconstructs and reopens the streamed archive; this host cannot launch the pinned WebKit runtime because its system libraries are absent. Browser download remains a Web Core fallback with the non-raiseable 512 MiB final-Blob ceiling. Cross-context coordination for storage operations outside the generation-fenced streamed-media path remains an open lifecycle concern and does not expand the qualified archive bytes accepted by this control.

The first direct render-output slice is narrower than portable project saving: it admits one exact WAV, AIFF, BWF, or BW64 mix only when the export plan selects `realtime-stream` and names one output. WAV requires the exact `audio/wav` MIME type and `.wav` extension plus one positive safe-integer planned file byte count at or below 65 GiB. Classic WAV admission requires an explicit positive safe-integer sample rate no greater than 4,294,967,295, 1–32 channels, a nonnegative safe-integer frame count, non-array object metadata, a marker array, null-or-object iXML, and CART exactly null. Its canonical (`sampleFormat`, `bitDepth`, `floatingPoint`) tuples are (`int16`, 16, false), (`int20`, 20, false), (`int24`, 24, false), and (`float32`, 32, true). It rejects an explicit container, BEXT, ADM, `preDataChunks`, or `trailingChunks` before target selection. Admission recomputes `inspectWavLayout` with automatic container selection from the same sample rate, channel count, frame count, encoding, metadata, markers, and iXML used by streaming. Only RIFF or RF64 and exact agreement between the recomputed and planned bytes pass. Odd PCM RIFF data is word-padded. Layout-only witnesses allocate no PCM or output bytes while admitting the largest constructible RIFF at 4,294,967,302 bytes, observing the next mono int16 frame select RF64 at 4,294,967,340 bytes, and admitting the exact 69,793,218,560-byte (65 GiB) RF64 ceiling while rejecting the next frame. This is an admission ceiling, not WAV scale, package, heap, or RSS qualification. AIFF requires `audio/aiff` and the canonical `.aiff` extension plus an exact count at or below 4,294,967,303 bytes, its theoretical 32-bit FORM limit. Direct admission requires an explicit valid sample rate, 1–32 channels, from zero through 4,294,967,295 output frames, non-array object metadata, and one canonical (`sampleFormat`, `bitDepth`, `floatingPoint`) tuple: (`int16`, 16, false), (`int24`, 24, false), (`int32`, 32, false), or (`float32`, 32, true). It recomputes `inspectAiffLayout` from those same layout-affecting encoder options, requires AIFF for integer PCM or AIFF-C for float32, and requires its exact byte count to equal the plan. Malformed or stale fields and layouts reject before target selection. The 4,294,967,303-byte theoretical maximum is odd and unconstructible under the current aligned layout; a layout-only witness allocates no PCM or output bytes while admitting the largest current constructible 4,294,967,302-byte layout and rejecting its next mono int16 frame. Exact integer AIFF, AIFF-C float, odd PCM padding, and trailing ID3 metadata use that same encoder geometry. BWF requires `audio/wav` and the canonical `.wav` extension plus one positive safe-integer planned file byte count at or below 65 GiB. Admission requires an explicit valid sample rate, 1–32 channels, a nonnegative safe-integer frame count, object metadata, a marker array, and null-or-object iXML and CART. It recomputes the automatic RIFF/RF64 layout with `inspectWavLayout` from the same encoder options used by streaming: sample rate, channel count, frame count, integer precision, BEXT, metadata, markers, iXML, and CART. It rejects malformed fields or a planned-byte mismatch before target selection. Its plan and encoding must carry the same canonical normalized version-2 BEXT, and direct admission permits only integer int16, int20, or int24 PCM. It rejects a plan container, ADM, `preDataChunks`, and `trailingChunks`, keeping BW64 and opaque chunks outside the direct BWF variant; rich standard BWF metadata, markers, iXML, and CART remain eligible when their exact geometry agrees. A layout-only witness allocates no PCM or output bytes while admitting the exact constructible 69,793,218,560-byte (65 GiB) RF64 boundary and rejecting the next frame. This remains an admission ceiling, not BWF scale, heap, or RSS qualification. Authored BW64 requires format and container `bw64`, `audio/wav`, the canonical `.wav` extension, and an exact positive safe-integer layout recomputed by `inspectWavLayout` at or below 69,793,218,560 bytes (65 GiB). This is an admission ceiling, not an exercised scale claim. Only int16, int20, or int24 PCM with the same canonical normalized version-2 BEXT in the plan and encoding is admitted. Admission requires authored normalized ADM metadata for mono, stereo, or 5.1, with exact bed channel order and an identity preserve mapping. Canonical CHNA before PCM and AXML after PCM must be byte-identical in `plan.adm` and the top-level plan. Standard RIFF metadata, markers, iXML, and CART remain inside exact geometry. The separately admitted pristine-passthrough BW64 route is qualified only for metadata produced by the current BW64 importer and still accepted by the pristine planner: valid warning-free ADM, one unchanged neutral full-range source path at the import revision, and a nonempty complete `riffChunkSequence` whose aggregate complete nonstructural RIFF bytes, including headers and alignment bytes, do not exceed 16 MiB. Direct admission rechecks 1–32 channels of int16, int20, or int24 non-float PCM; exact rate, channel, frame, and precision geometry; zero tail and dither; full range; identity preserve mappings in plan and encoding; CHNA-derived channel order; exact compacted pre/post bytes, order, and placement in `plan.adm` and the top-level plan; and exact `inspectWavLayout` geometry under the same 65 GiB admission ceiling. A preserved BEXT is emitted only from the sequence; without one, plan and encoding must carry the same canonical normalized version-2 BEXT. Preserved cue/adtl, iXML, CART, ID3, or LIST/INFO chunks suppress their modeled plan fields, and collisions reject. Legacy `opaqueRiffChunks`-only metadata, incomplete capture, invalid or warning-bearing metadata, stale or edited projects, sequence drift, mapping or geometry drift, and loudness measurement reject before target selection. The byte-exact claim covers preserved nonstructural chunks only; structural BW64 and PCM bytes are rebuilt, so this is not whole-file bit identity or broad third-party BW64 qualification. A direct-eligible realtime BWF or BW64 request with `measureLoudness: true` fails closed before target, preflight, or render because bounded two-pass measurement is unimplemented; this makes no measured-loudness claim. Desktop save-choice policy permits `.wav`, `.aif`, and `.aiff`, while controller admission remains canonical `.wav` or `.aiff`. A dedicated `audio-pcm-mix` purpose can open that exact-size destination through direct File System Access or Electron writing.

The shared PCM route requests 16,384-frame chunks and derives the pending count from the render channel count, so pending planar Float32 PCM is bounded to 32 MiB; this does not bound resampler state, browser heap, or process RSS. Direct PCM adapters request suspension at one accepted chunk while retaining the hard crossover reserve. Realtime publication waits for every streamed clip to settle and fails closed with the first stable source-underrun identity before commit; interactive playback retains silence-on-underrun behavior. Realtime progress is propagated into the owned export task and UI. The qualified selection-only upmix resamples the smaller input set before duplicating selected channels, while matrix mixes and downmixes retain the general mapping order. The shared PCM adapter has bounded encoder-emission retention, coalesces PCM into at-most-4-MiB writes, and serially awaits one destination write at a time. Exact desktop `audio-pcm-mix` sessions negotiate that 4 MiB maximum; generic exact-size and project sessions remain at one MiB. Planned, encoder-finalized, destination-written, and committed-result byte counts must form a four-way agreement before the route reports success, without a final renderer `Blob`. BW64 passthrough outside the exact current-import contract, including legacy opaque-only metadata, plus other PCM containers, compressed audio, custom FFmpeg output, video, stems, non-realtime plans, and browser-download fallback remain on their existing paths. Explicit publication is a non-cancellable commit boundary: if task or project ownership is lost during commit, the controller returns the committed result without stale success UI publication, while a committed-result size disagreement is reported as a post-publication integrity failure, not as rollback. Focused Node AIFF evidence has four cases covering exact FORM and metadata geometry, closed admission across all four canonical encoding tuples, malformed and stale layout refusal before target selection, the exact 4,294,967,302-byte constructible boundary and next-frame refusal without PCM or output allocation, realtime direct publication, picker cancellation, and mid-stream rollback. Focused Node BWF evidence has five cases covering admission, exact layout and publication, loudness fail-closed behavior, four-way diagnostics, and mid-stream cancellation. Focused Node authored BW64 evidence has six cases covering closed admission, exact standard-metadata preparation, canonical ds64/BEXT/fmt/CHNA/data/AXML streaming, loudness fail-closed behavior, four-way diagnostics, and mid-stream cancellation. Seven focused pristine-passthrough BW64 cases cover the real current-import-to-planner route, preserved and generated BEXT branches, exact nonstructural chunk bytes/order/placement and publication, closed admission, modeled-metadata collision refusal, stale or edited planning refusal, and loudness fail-closed behavior; the full maintained Node suite remained green at 398 test files. Focused 12-case Node WAV evidence covers exact classic RIFF/RF64 admission and encoder geometry, all four canonical encoding tuples, rich metadata, markers, and iXML with correct odd PCM RIFF padding, malformed or stale route refusal before target selection, the exact RIFF-to-RF64 and 65 GiB boundaries without PCM or output allocation, realtime publication, bounded writes and queueing, Blob fallback, cancellation, four-way byte accounting, cleanup, and commit ownership. The wider WAV Node suite also covers cleanup failures, ownership races, and the commit boundary.

A separate opt-in desktop-threshold witness streams an exact 385 MiB silent float payload into a 403,701,804-byte RIFF with pinned SHA-256 through the production planner, export controller, real 16-packet PCM queue at its 32-channel, 32 MiB cap, passthrough streaming resampler, WAV stream encoder, and counting direct target. It requests 193 16,384-frame packets with a half-sized final packet, observes at most 16 pending packets, and makes 98 destination writes including the header with a 4,194,304-byte maximum. Its conservative 41,943,384-byte path-owned binary maximum stays below the planned 64 MiB buffered-binary limit with zero PCM payload retention at the target. A second run cancels after the first coalesced 4 MiB PCM destination write and aborts without close or commit, leaving no partial publication. Renderer heap and process RSS remain unqualified because this Node witness derives a structural ownership bound rather than measuring browser or process memory.

Maintained Chromium and Firefox WAV, AIFF, BWF, and BW64 coverage now comprises ten aggregate format/engine cases with an injected File System Access target and simulated mobile planner profile to drive the maintained UI through the production realtime route. The WAV case validates structurally valid RIFF bytes and exact written-byte accounting without retaining the output; the AIFF case validates FORM, COMM, and SSND geometry plus exact written-byte accounting. The BWF case retains a 2 KiB prefix and validates RIFF, bext, fmt, and data geometry, the authored description, a 64-bit TimeReference, and a two-row CodingHistory. The authored BW64 case uses a 33.1-second stereo source and 384 kHz 16-bit output. Its 101,683,200-byte float-plan geometry exceeds 96 MiB but is not a final-file or scale qualification. A bounded 2 KiB prefix and 8 KiB suffix validate BW64, ds64, BEXT, fmt, canonical stereo CHNA, data, and trailing AXML. The pristine-passthrough case imports a synthetic 5.1, 48 kHz, 16-bit BW64 with 4,210,688 frames; its 101,056,512-byte float-plan geometry also exceeds 96 MiB without qualifying final-file scale. Bounded 2 KiB prefix and 4 KiB suffix retention proves exact source JUNK padding, BEXT v2, and CHNA bytes/order before PCM plus PEAK padding and AXML bytes/order after PCM. Visible realtime progress precedes completed close, commit, and publication without Object URL or browser-download fallback. A second export cancels after nonzero PCM reaches the target and observes one abort without close, commit, or publication. All destination writes are at most 4 MiB and serial. The authored BW64 case passed focused Chromium and Firefox runs in 42.2 and 45.8 seconds; the pristine-passthrough case passed in 1.7 and 1.8 minutes respectively. The six earlier cases were not freshly rerun together. This qualifies current-import application-path browser plumbing, selected preserved nonstructural chunk bytes/order/placement, publication, and pre-commit rollback, not arbitrary third-party or legacy opaque-only BW64, edited projects, whole-file bit identity, native-picker availability, the 65 GiB ceiling at scale, packaged behavior, heap or RSS, crash, power loss, or durability. WebKit remains unqualified because its pinned runtime cannot launch on this host without the missing system libraries.

The 385 MiB Node witness remains WAV-only. Packaged completion evidence covers WAV, integer AIFF, BWF, and first-party authored BW64 at the current Soundscaper Linux x64 fixture scales, while packaged cancellation and staging-cleanup evidence remains WAV-only. BWF and BW64 have no packaged 65 GiB scale qualification. Packaged BWF completion only has no packaged visible-progress, cancellation, rollback, staging-cleanup, or commit-race qualification and does not qualify loudness, int20 or int24 PCM, RF64 or the 65 GiB boundary at scale, rich metadata variants, or third-party interoperability. Packaged authored BW64 completion has no packaged visible-progress, cancellation, rollback, staging-cleanup, or commit-race qualification and does not qualify loudness, int20 or int24 PCM, other ADM layouts or metadata variants, passthrough or third-party interoperability, or the 65 GiB boundary at scale. Packaged AIFF has no native-picker, visible-progress, cancellation, rollback, staging-cleanup, commit-race, heap, RSS, AIFF-C float, int24, int32, metadata, padding-variant, 4,294,967,302-byte boundary-scale, or other-platform qualification. The 65 GiB BWF and BW64 ceilings are admission only, not scale qualification.

Packaged Soundscaper Linux x64 completion acceptance covers WAV, integer AIFF, BWF, and first-party authored BW64 and drives the maintained UI and controller through Electron 43, preload IPC, and `AtomicSaveManager`. A 48 kHz, two-channel encoded input with 792,000 frames was observed after import/decode as a 791,999-frame project range and produced 6,335,992 signed-16-bit frames at 384 kHz and 16 channels. The planner's 405,503,488-byte float geometry exceeds the 384 MiB threshold. The completed classic RIFF/WAV is 202,751,788 bytes. Its independent verifier streams through EOF in reads no larger than one MiB, retains at most the 31 bytes below one 32-byte PCM frame, compares all 95,039,880 non-primary channel samples with their primary sample and observes zero mismatches, and applies tolerant non-silence, positive/negative, zero-crossing, peak, mean, and RMS bounds. The same packaged sequence selects the exact AIFF option, reselects 16-bit PCM after the format default is applied, validates the application's canonical `.aiff` suggestion and combined `WAV and AIFF audio mix` filter with `wav`, `aif`, and `aiff` extensions, and completes a 202,751,798-byte classic AIFF. Its independent verifier requires a regular non-symbolic file with stable identity and size; uses reads no larger than one MiB; validates exact FORM/AIFF, 18-byte COMM, 16-channel, 6,335,992-frame, 16-bit, 384-kHz 80-bit-rate, and 202,751,752-byte SSND geometry with zero offset and block size; and proves that 202,751,744 bytes of big-endian PCM start at byte 54 with no pad or trailing bytes. It retains at most the observed 10-byte partial-frame carry, compares all 95,039,880 non-primary channel samples with zero mismatches, and applies the same tolerant signal bounds. The sequence then selects the exact BWF option, reselects 16-bit PCM after the format default, restores the custom 16-channel mapping after the BWF stereo default, retains 384 kHz, validates the canonical `.wav` suggestion and the same combined `WAV and AIFF audio mix` filter, and completes a 202,752,510-byte RIFF/WAVE BWF. Electron receives the same `wav`, `aif`, and `aiff` filter extensions rather than BWF-specific File System Access `types`. Its independent verifier requires a regular non-symbolic file with stable identity and size and uses reads no larger than one MiB. It validates a 689-byte bext payload at byte 12 with one-byte pad and 698-byte total chunk; a 40-byte extensible fmt at byte 710 with 16 channels, 384 kHz, signed 16-bit PCM, and the PCM GUID; and a 202,751,744-byte data payload whose PCM starts at byte 766 with no data pad or trailing bytes. It retains at most the 31-byte partial-frame carry, compares all 95,039,880 non-primary channel samples with zero mismatches, and applies the same tolerant signal bounds. The deterministic BEXT carries description `Soundscaper packaged BWF smoke`, originator `Soundscaper`, reference `PACKAGED-BWF-0001`, date 2026-07-30, time 12:34:56, input TimeReference 6,000 scaled to 48,000, version 2, a deterministic nonempty 64-byte UMID whose normalized 128 lowercase hexadecimal digits are pinned and whose 64 payload bytes are compared exactly, loudness sentinels, and two-row CodingHistory naming 48,000-Hz input and 384,000-Hz output. A separate first-party authored BW64 fixture uses a 44-second, six-channel, 2,112,000-frame source at 48 kHz and produces 16,896,000 frames at 384 kHz, six channels, and signed 16-bit PCM. Its 405,504,000-byte Float32 render geometry exceeds the 402,653,184-byte direct threshold, and the completed BW64 is exactly 202,755,508 bytes. The bounded verifier uses reads no larger than one MiB and validates exact BW64/ds64/BEXT/fmt/CHNA/data/AXML structure and placement, a 202,752,000-byte PCM payload, and canonical 5.1 CHNA and ADM metadata. It performs 84,480,000 channel comparisons with zero mismatches and observes at most 8 carry bytes, 16,894,241 nonzero frames, 8,447,121 positive frames, 8,447,120 negative frames, 19,359 crossings, peak 9,830, and RMS 6,950.862. All four whole-file SHA-256 values remain diagnostic and are not pinned; the exact BW64 BEXT, CHNA, and AXML payload hashes are pinned by the verifier. A WAV-only cancellation run independently observed a 33,554,476-byte staging file through a prefix no larger than 65,536 bytes, validated its RIFF geometry and nonzero payload, then observed removal of both the unpublished destination and every staging file. No browser download was visible after the packaged sequence. CI runs this packaged sequence only for Soundscaper Linux x64. The harness validates the application save choices and `audio-pcm-mix` purpose before supplying isolated targets ahead of `dialog.showSaveDialog`, so it bypasses and does not qualify the native OS picker. It also does not directly observe exact-size session negotiation or the negotiated four-MiB destination-write limit; separate shared-route controls cover those contracts. This is not a 65 GiB WAV, BWF, or BW64 run or a 4,294,967,302-byte AIFF run, and does not qualify browser heap, renderer or main-process RSS, quota, filesystem or parent-directory durability, crash or power-loss behavior, Windows, macOS, ARM, installers, Framescaper, AIFF-C float, other integer AIFF precisions, AIFF metadata or padding variants, other BWF or BW64 precisions or metadata variants, passthrough or third-party BW64, or other formats. Packaged AIFF does not qualify visible progress, cancellation, rollback, staging cleanup, or commit races. Packaged BWF does not qualify visible progress, cancellation, rollback, staging cleanup, commit races, loudness, RF64, or scale. Packaged authored BW64 does not qualify visible progress, cancellation, rollback, staging cleanup, commit races, loudness, passthrough or third-party interoperability, or 65 GiB scale. The exact decode and frame geometry is pinned-runtime-specific and must be revisited on Electron upgrades. Actual-device mobile behavior remains unqualified. The injected-File-System-Access direct-WAV browser case stalls the selected writer's non-cancellable close after commit admission; maintained Chromium and Firefox each return the cancelled task to the Start-export state before release, then observe exactly one complete destination publication with zero aborts and no stale success status, output link, Object URL, or browser download. That qualifies only this application-path classic-WAV commit race; AIFF, BWF, BW64, WebKit, native-picker, actual-device, reference-scale, packaged, crash, power-loss, and durability commit races remain unqualified.

The direct ZIP32 stem slice is deliberately separate from the direct mix claim
and owns archive publication rather than native-container or codec conformance.
Its native-PCM branch admits only WAV, AIFF, and BWF plans whose output list and
ZIP entries have identical names, order, and exact sizes and whose full ZIP32
geometry is recomputed before target selection. Closed positive admission
covers canonical WAV and BWF with `audio/wav` and `.wav`, and AIFF with
`audio/aiff` and `.aiff`.

The compressed branch admits the seven canonical built-in formats—MP3, FLAC,
Ogg Vorbis, Opus, WavPack, MP2, and AAC/M4A—only for canonical
`realtime-stream` stems. Admission takes one owned plan snapshot and binds its
fingerprint through publication. Each entry receives a per-entry maximum of
`max(outputBytesPerRender, 1 MiB)`, where `outputBytesPerRender` is one raw
Float32 render payload. A synthetic maximum ZIP32 layout is checked before
target selection. That cap is a refusal boundary only: it does not qualify a
codec expansion bound, codec conformance, or scale.

A native prepared exact-size or compressed prepared maximum-size Web/Electron
streaming destination is selected and opened before render. Native
temporary-storage preflight remains the largest sequential intermediate. The
compressed preflight is only one raw Float32 render payload; it excludes WAV
framing, encoded bytes, and the aggregate legacy staging claim. Compressed
publication then retains a complete staged WAV `Blob`, the complete worker
MEMFS output, and one complete encoded result at a time. It derives the actual
entry sizes, recomputes the actual ZIP32 layout, preserves entry order, and
requires actual, emitted, destination-written, and committed byte counts to
agree. The shared writer still reads a non-Blob source in at-most-64-KiB slices,
awaits sink backpressure, and closes before the explicit commit. There is no
final ZIP `Blob`, and neither direct branch invokes the download publisher.

The compressed service witness names `01-Voice.mp3` and `02-Music.mp3`,
preflights eight raw bytes instead of the 16-byte aggregate legacy claim,
applies a 1,048,576-byte maximum to each entry and a 2,097,406-byte maximum
ZIP32 destination, then streams three- and five-byte injected encoded bodies
into a recomputed 262-byte actual ZIP32 archive. This proves transport and
accounting, not actual FFmpeg execution. The native witness retains its
four-byte preflight, two ordered four-byte WAV markers, exact 268-byte archive,
64 KiB source slicing, and 272-byte Blob-fallback preflight. Those marker bytes
remain archive-protocol evidence rather than WAV conformance vectors.

Plan or fingerprint drift, empty output, an over-cap result, reported/actual
size disagreement, layout drift, failure, or cancellation cleans the current
owned intermediate, aborts an unpublished destination exactly once, and does
not commit or publish. Prepared Blob mode still declines the direct route and
keeps the legacy Blob/download fallback. Offline compressed stems, custom
FFmpeg stems, 7z, BW64 stems, video, and inexact or reordered archives remain
outside direct admission. The Node fixture does not qualify File System Access,
Electron filesystem or native-picker behavior, actual FFmpeg codec execution,
codec conformance or expansion, worker MEMFS allocation, renderer heap, process
RSS, garbage-collection, CPU or elapsed-time behavior, packaged UI, browsers or
operating systems, reference scale, quota, crash, power loss, or durability.

The direct compressed whole-mix slice admits only the seven canonical built-in
FFmpeg formats: MP3, FLAC, Ogg Vorbis, Opus, WavPack, MP2, and AAC/M4A, with
their exact descriptor MIME values, extensions, normalized settings, channel
mappings, and metadata. Codec-qualified Vorbis and Opus result MIME values use
base `audio/ogg` only as the picker hint, while MP3 and MP2 share `audio/mpeg`;
canonical format identity and extension therefore remain part of admission.
The `realtime-stream` branch still requires its maintained memory reason and
exact four-byte-per-output-sample plan. The centrally admitted offline branch
accepts only one canonical mix with exact range, tail, output geometry, input
width, mapping, planner thresholds, pre-roll, and reported graph latency, and
whose complete central offline-output admission recomputes exactly. Its
non-raiseable 256 MiB ceiling
covers the exact useful-binary context and crop output only; it is not an
end-to-end memory bound for sources, graph state, staging, heap, RSS, or GC.

Realtime rendering maps and resamples PCM before staging and gives FFmpeg
preserve geometry. Offline rendering resamples first, validates exact
`Float32Array` input-channel and frame geometry, stages the unmapped input
width, and gives FFmpeg the canonical mapping, so mapping is applied exactly
once on either route. FLAC stages an integer 16- or 24-bit WAV and gives
requested dither to the staging encoder. Every non-FLAC format stages Float32
WAV. FFmpeg dither is enabled exactly when the normalized sample format is not
`float32`, dither is not `none`, and the format is not FLAC; this covers integer
WavPack and explicitly dither-enabled lossy settings, while float WavPack
disables it. Realtime preflight retains its output-width Float32 payload claim.
Offline preflight takes the maximum of the plan's required temporary bytes and
a raw staging PCM payload: input channels times frames times requested FLAC
integer bytes, or four bytes for the other six formats. That count excludes WAV
framing and padding and is not an exact staged-file size or storage reservation.

The service selects a prepared target before render but keeps its exact writer
unopened until after successful FFmpeg execution and a safe nonnegative stat.
Only an ordinary offline renderer failure may reuse that same unopened target
through the realtime branch; cancellation, fallback-integrity or currentness
loss, and every post-render failure do not retry. A maintained first-party
rendered fallback reaches this route only after projection and fresh private
provider verification; its canonical project and global buffers, providers,
and caches remain unchanged. Each complete staged WAV is mounted through
WORKERFS, and the complete encoded output remains in worker MEMFS. The patched
worker returns exact monotonic ranges of at most one MiB, with one read and one
awaited destination write at a time under sink backpressure and no whole-output
`readFile` transfer into the renderer. Exact stat, emitted, and
destination-written counts precede destination close and explicit commit; the
committed-result size is checked afterward. The direct route creates no final
renderer compressed-audio `Blob` and makes no download publication. Prepared
Blob mode retains the legacy whole-read, final-Blob, and download path.

Cancellation and currentness checks surround target preparation, rendering,
resampling, synchronous offline WAV construction, FFmpeg execution, stat, range
transfer, destination operations, staging cleanup, and commit admission for all
seven formats. Synchronous WAV construction cannot be interrupted while it is
running, but checks immediately before and after it fence cancellation,
currentness loss, and plan drift before FFmpeg. Cancellation during FFmpeg
execution terminates the runtime; any pre-commit failure aborts the unpublished
destination exactly once, including when its underlying abort throws
synchronously. Output deletion, WORKERFS unmount, and mount-directory deletion
are all attempted, and a cleanup failure terminates the runtime and remains
observable with an earlier primary failure. Ownership loss during the
non-cancellable commit returns the committed file without stale success UI;
committed-size drift is a post-publication integrity failure, not rollback.
All-seven service cases use a mock five-byte output. The virtual
269,484,049-byte, 258-range Node case proves transport arithmetic and
backpressure only. Offline staging materializes a complete WAV byte array and
Blob, and the complete worker MEMFS output, staged-input residency, and native
or WASM codec memory remain unbounded. Renderer or browser heap, GC, RSS, CPU,
elapsed time, actual codec execution and conformance, and reference-scale
behavior are unqualified. Actual browser, operating-system, native-picker,
packaged, quota, durability, crash, and power-loss behavior are also
unqualified, as are custom FFmpeg, compressed stems, video, and other
noncanonical delivery. A desktop prepared target has a 900,000-millisecond
TTL, so long offline packaged elapsed-time behavior is specifically not
qualified.

The direct MP4 and WebM final-video slice admits only a canonical version 4
descriptor-bound plan and unchanged full-plan fingerprint. MP4 binds `mp4`,
`.mp4`, `video/mp4`, `libx264`, optional `aac`, `yuv420p`, and `+faststart`;
WebM binds `webm`, `.webm`, `video/webm`, `libvpx-vp9`, optional `libopus`, and
`yuv420p`. Those encoder and muxer arguments are command facts, not codec or
container conformance. Both use purpose `video` and a safe canonical suggested
name. Any first-party rendered-fallback verification and projection finish
before planning and target selection; their separate control owns the source
digest and verified `Blob` while this control owns only downstream direct
publication.

For the browser branch, target preparation follows planning but occurs before
storage preflight, ordinary source loading, optional canonical-audio rendering,
and FFmpeg. Its writer remains unopened until FFmpeg has finalized the output
and returned one safe nonnegative stat. For the desktop branch, preparation is
deferred inside sink open after that stat because a selected main-owned save
target has a 900,000-millisecond TTL. Avoiding target expiry during a long
encoding is the design reason for this ordering, not a platform or long-duration
qualification. Source-video `Blob` inputs and the optional staged WAV `Blob`
remain WORKERFS inputs, and the complete final output remains in worker MEMFS.
After one stat, the patched worker transfers exact monotonic ranges of at most
one MiB with at most one read and one awaited write active. Sink close seals the
exact count before explicit non-cancellable commit; stat, emitted,
destination-written, and committed-result counts must agree. The direct path
uses no output `readFile`, final renderer video `Blob`, Object URL, or download.
Prepared Blob mode retains the legacy whole-read and final-Blob publication
path.

The owned signal and currentness checks surround verification, planning,
selection, preflight, source and audio work, FFmpeg, stat, every range and
write, sink close, cleanup, and pre-commit admission. Cancellation during
FFmpeg terminates the runtime. Any pre-commit refusal aborts the unpublished
destination exactly once; late desktop chooser cancellation returns silently
without opening a writer or publishing. Output deletion, WORKERFS unmount, and
mount-directory deletion are attempted, and cleanup failure terminates the
runtime and remains visible with an earlier failure through `AggregateError`.
Ownership lost during commit returns the committed result without stale success
UI; committed-size drift is a post-publication integrity failure, not rollback.
The focused transport body is 2,097,169 bytes in three ranges of 1,048,576,
1,048,576, and 17 bytes with one stat and zero output `readFile` calls. Worker
MEMFS, source-video and staged-audio `Blob` residency, codec execution and
conformance, native or WASM codec memory, renderer or browser heap, GC, RSS,
CPU, elapsed time, browser, operating-system, native-picker, packaged,
reference-scale, quota, durability, crash, and power-loss behavior all remain
unqualified.

### Electron renderer, IPC, and filesystem capabilities

`electron-renderer-ipc-boundary` is **enforced for the current v1 bridge only**. The window uses sandboxing, context isolation, no Node integration, sender/root-document checks, denied navigation and new-window paths, and a frozen input-validating preload API. Shared-project methods are bounded pathless list, read, bundle, commit, delete, and managed-media transfer operations for the closed canonical-PCM and retained-original-video encodings; main independently sanitizes their values, caps transfer bodies at 64 GiB and chunks at 4 MiB, and permits at most four active uploads and four active reads across the bridge service. Linked-video load requests are closed pathless DTOs with a mandatory Boolean mode: whole-Blob materialization requires `playback: false`, while ranged playback requires `playback: true` and a non-null exact locator revision. Main and preload independently validate that mode, the returned revision, and the profile-bound descriptor, and they retire a descriptor that cannot be returned safely. Upload capacity remains charged through publication or abort settlement, and service disposal waits for finishing publications. Upload session IDs and linked-video reads remain bound to their renderer owner for authorization and revocation. Navigation, renderer loss, and window close revoke the owner, fence new work, abort its uploads, and drain admitted operations and playback reads. No renderer receives a filesystem path. This does not qualify a future helper or plug-in channel.

`desktop-static-resource-paths` is **enforced for the current application protocol**. Decoding, realpath containment, method restrictions, range handling, and the Electron CSP are covered by protocol tests, including escaping symlinks.

`desktop-read-path-capabilities` is **enforced for the current versioned materialized, Scape range, and linked-video playback range profiles**. Main assigns an immutable `materialized-v1`, `scape-range-v1`, or `linked-video-range-v1` profile after user selection or exact linked-locator admission and before descriptor publication; the renderer supplies neither the path nor the profile. The store, frozen descriptor, canonical capability URL, and request lease all carry the same profile. Every pending or published capability is also bound to the opaque main-owned identity of the currently committed main-frame document, and all three profiles share the per-owner ceiling of 128 pending/live capabilities reserved before file open. `materialized-v1` retains its non-raiseable 512 MiB per-owner aggregate declared-byte ceiling. A terminal `.scape` project with the exact canonical MIME type instead uses `scape-range-v1`, whose independent admission allows at most four capabilities and 65 GiB of aggregate declared bytes both globally and per owner. Count is reserved before open and bytes are charged after stat but before descriptor publication. A cleanup failure retains the range charge and fences later range admission. Wrong-owner release refuses without mutating the capability. Explicit release, expiry for the expiring profiles, main-frame non-same-document navigation, renderer loss, actual window close, and shutdown synchronously invalidate lookup before admitted opens and handle closes drain. A delayed dialog, open, or stat result for a revoked owner closes without publication, and partial multi-file failure drains every prior descriptor rollback and reports primary plus cleanup failures. Serialized OS-open dispatch keeps a deduplicated visible queue head: four Scape descriptors can consume the global range count, the fifth remains unopened, and one acknowledged release redispatches it; a renderer-send failure releases its just-created descriptor before reporting and removing the queue head. Temporary count or aggregate-byte pressure is retryable and never evicts an existing handle; an individually oversized file is not retried. Cleanup failure rejects the drain after every close is attempted.

The `scape-range-v1` protocol accepts only `GET` with one closed `bytes=start-end` range of at most 16 MiB wholly inside the declared file and always responds `206`; full-file, `HEAD`, suffix, open-ended, multiple, oversized, and end-of-file-overrun requests refuse. Profile parsing, descriptor/profile comparison, and range validation happen before acquisition, so malformed or mismatched requests cannot renew the inactivity TTL. The store repeats the expected-profile comparison before renewal and lease creation. One shared Scape admission gate permits only one active range request globally, not merely one per capability. A successful Web response body retains its request through `done` and then preserves the pinned handle for a later request. Body cancellation, request abort, or inner stream failure retires the whole capability, waits for native stream close and pinned handle close, and only then settles the renderer-facing cleanup barrier. Explicit release, expiry, owner revocation, and shutdown join the same retirement. Failed retirement remains visible only to the correct owner until owner or store teardown; raw handle state is not exposed through descriptor lookup. Preload validation repeats exact profile, name, MIME type, profile-specific size, and canonical URL-path binding with no query or fragment. The renderer repeats those profile rules: generic materialization rejects Scape and range descriptors, while the strict archive adapter performs exact serialized range reads, validates the complete partial-response contract and bytes through `done`, snapshots the descriptor URL/declared size and fetch implementation, preserves the first admitted terminal error across active, queued, and future reads, and exposes no release operation. Project-dialog selection and OS-association delivery share the same explicit router. One awaited file-service scope owns inspection, any collision decision, and import and releases the capability exactly once after that consumer settles on success, failure, user cancellation, or abort; an invalid or mismatched renderer route is also released before refusal. Main-process release joins retirement and remains the authoritative cleanup barrier. Browser Blob opens and materialized Audacity or other project and media reads are unchanged.

The separately admitted `linked-video-range-v1` playback profile requires a closed bridge request carrying the exact current locator revision. Before capability publication, main requires the current pathname stat to match the persisted device, inode, size, modification-time, and change-time identity; it then opens a handle and independently requires that handle to match the same identity. This closes the pathname-replacement race through admission and keeps the admitted handle stable if the pathname is later moved, deleted, or replaced. One capability is limited to 512 MiB. A dedicated gate admits at most 128 capabilities and 64 GiB of declared bytes globally and per owner, plus at most 16 active range requests globally; count reserves before open and bytes charge after handle stat. Playback capabilities deliberately have no wall-clock expiry while their renderer-document owner remains live. The protocol admits `HEAD` and one start-based closed or open-ended `GET` range, caps every returned range at 4 MiB, and rejects a full-body `GET`, suffix or multiple ranges, oversized ranges, and end-of-file overrun. A successful response or ordinary seek cancellation drains only that request slot and preserves the pinned capability; an inner stream failure retires it. Explicit renderer release, owner revocation, navigation, renderer loss, window close, and shutdown remove it from lookup and drain its request and handle. Main and preload validate the mandatory mode, exact revision, video MIME, profile, name, safe size, and canonical pathless URL and roll back a descriptor that cannot cross the boundary. The renderer port repeats those closed descriptor checks. Before exposing the media URL, the resolver verifies the exact byte length and MIME, hashes the entire admitted handle sequentially with exact at-most-4-MiB `206` responses, validates `Accept-Ranges`, `Content-Range`, `Content-Length`, `Content-Type`, and body length, and then rereads the exact project/source binding and CAS fence. Cancellation, metadata drift, malformed responses, digest mismatch, binding replacement, and admission failure release the capability once; a simultaneous verification and cleanup failure is preserved as an aggregate error.

The `materialized-v1` tier still creates one whole `Blob` below 512 MiB, excludes Scape and linked-video range descriptors, repeats declared `Content-Length`, emitted-byte, and final `Blob`-size agreement, splits retained parts at 16 MiB, forwards the caller's `AbortSignal`, and never calls `response.blob()`. Its bound covers active raw selected-file bytes, not decoder amplification or whole-process RSS.

`desktop-write-path-capabilities` is **partial**. Save targets are high-entropy, expiring, single-use tokens. Generic exact-size output and project-only maximum-bounded output negotiate acknowledged sequential one-MiB chunks; exact-size `audio-pcm-mix` sessions alone negotiate four-MiB chunks. All use a private same-directory temporary file, file sync, atomic rename, and abort cleanup. The dedicated `audio-pcm-mix` target grants only exact-size WAV, AIFF, canonical BWF, or admitted BW64 publication; desktop choice policy permits `.wav`, `.aif`, and `.aiff` without extending maximum-bounded streaming to generic audio targets. Every target and derived session is bound to an opaque main-owned identity for one committed main-frame document; the renderer bridge neither supplies nor observes that identity. Main-document navigation, renderer loss, and actual window close synchronously fence that owner's admission and invalidate unused targets, including a save-dialog result that returns after revocation. Cleanup then drains admitted begin, chunk, finish, and abort operations, permits an already-admitted finish to cross its sync-and-rename commit boundary, and aborts remaining staging. Fresh-owner session admission waits for prior owner drains, preventing an older admitted rename from overtaking a replacement save to the same destination. Navigation cleanup failures are reported; application shutdown additionally waits for all save work and rejects its failure-aware barrier on an unacknowledged handle close or staging unlink, so the process cannot report a clean exit. Fault-injection tests stall open, write, sync, and rename independently and force both cleanup failures. Admission now enforces 16 outstanding product-wide save targets, 4 pending or live save sessions, and 65 GiB per-save and aggregate admitted bytes, covering the canonical 64 GiB expanded `.scape` envelope plus its bounded STORE/ZIP overhead. Global count and byte reservations are installed synchronously before the first await, and production ceilings expose lower-only test seams. Main fail-closes malformed, failed, or insufficient BigInt `statfs` available-space results before staging open. This preflight is a point-in-time check, not an operating-system reservation, so later external disk use can still make a write fail safely. Reservation charges release only when no staging was acquired, cleanup is acknowledged, or commit completes; a staging cleanup failure leaves the count and bytes charged. An active chunk cannot be preempted inside its filesystem write, and parent-directory/per-platform durability still needs fault qualification.

`shared-desktop-project-library-integrity` is **partial**. A main-process host owns a product-neutral appData library under a fenced lease. A fresh filesystem library scope `v2` ignores rather than migrates the prior shared `v1` scope; SQLite database schema 3 at the `v2` path rejects schemas 1 and 2 instead of implicitly migrating, adopting, or backfilling them. Metadata schema 2 binds a separate opaque library entry ID to project identity, exact schema 9, project revision, bounded byte length, SHA-256, and a derived immutable revision-and-digest path. The project store uses the canonical tagged-binary codec, accepts opaque binary state, enforces a non-raiseable 256 MiB document ceiling with a lower-only test seam, and validates the persistence root's schema, ID, title, and revision. Before `JSON.parse` constructs an object graph, the codec structurally scans every schema under a raw ceiling of 101,536 JSON values and depth 130, including worst-case binary-descriptor expansion. Exact schema 9 then receives independent decoded-codec and structural-validator ceilings of 100,000 logical nodes and depth 128 per phase. The main-owned editor service exposes lower-only seams for these limits across renderer input, loaded commit results, stored reads, and response serialization. An over-budget renderer input rejects before host commit and therefore before project staging. A loaded commit result may be rejected after the host has already published it, but neither that result nor an over-budget stored read reaches a renderer response. The lexical preflight, decoded-codec traversal, validator admission, and response serialization reset their counters; they are not one aggregate CPU, elapsed-time, cancellation, allocation, or RSS budget. This structural admission is qualified for canonical JSON-derived production graphs and ordinary direct objects, not arbitrary in-realm proxies or malicious injected hosts or providers. Within that scope, accessors, callable `toJSON` hooks, method-shadowed arrays, hidden or symbol data, cycles, exotic containers, and non-JSON scalars reject without invoking application accessors. The main-owned editor service parses that bounded document and runs the strict exact-schema-9 maintained-persistence-domain validator before calling host commit and therefore before project staging; it validates the loaded commit result and stored reads again before returning a renderer response. Core project, document, media, and graph structures are strictly checked by that validator. All audio effects must be cloneable and carry their generic identity, enabled, and parameter structure; type-specific semantic checks cover missing-effect compatibility metadata and parametric EQ, while other first- and third-party effect payload semantics are intentionally not gated. Adversarial service fixtures reject invalid collection shapes, duplicate identities, dangling source or clip references, over-node and deeply nested shapes, non-enumerable or accessor-backed ordinary properties, array method shadows, non-JSON scalar values, and invalid loaded commit results. Input-side failures do not reach a host commit or project file. A packaged-runtime fixture proves the validator and structural admission are emitted and active. Publication reserves the canonical path and one unique random attempt in lease- and fencing-token-bound authoritative project and stage inventories in the same immediate transaction before exclusive stage creation. When exact-lease cleanup is acknowledged, an exclusive-open failure retires only the registration without unlinking the path, while an error after exclusive creation targets that registered random stage for removal. Lost-lease or failed cleanup leaves the registration for takeover. Successful materialization requires the exact metadata and stage paths, lease ID, and fencing token, then atomically renames and syncs the file, marks the canonical row materialized, and removes the stage row under before-and-after lease checks. It then reverifies length, digest, schema, ID, and revision. Every catalog reference must have a materialized row before an exact plus-one journaled catalog commit. Lease ownership is checked before staging, before publication, and transactionally at catalog commit, so tested observers see an old or new complete file-and-catalog pair and a stale fencing token cannot publish. The host serializes commits and continues lease renewal while close fences new work and drains admitted work.

After recovery and before host exposure, a main-only immutable-document collector walks the authoritative project and stage inventories by monotonic row IDs, captures independent cycle high-waters, persists both cursors plus an alternating schedule, and scans at most 100,000 total rows per invocation in at-most-64-row batches. Each destructive batch holds an immediate SQLite writer transaction and validates the exact unexpired lease before and after filesystem work. A current exact-lease stage remains live; a stale registered regular stage is unlinked, a missing attempt retires, and a non-regular target or non-direct parent stays untouched and inventoried. Canonical rows owned by the current lease or referenced by an outstanding stage stay ineligible. Stage-cycle completion persists and consumes a canonical rescan flag in the same transaction, restarting the canonical high-water whenever retired attempts could have unblocked rows already passed by its cursor. Canonical batches rebuild portable case-folded reachability from the integrity-checked current catalog plus both previous and next snapshots of pending prepared or committed journals. An unreachable registered canonical regular immutable file is renamed to a deterministic noncatalogable quarantine and unlinked while catalog writers remain excluded; a crash-left quarantine remains retryable. Unregistered stage-looking, canonical, forged quarantine, and foreign files do not consume inventory budget and remain untouched. A real 100,001-row fixture proves successive bounded passes reach the suffix, while later inserts wait for the next high-water cycle. Low- and mixed-cap fixtures prove persisted alternation and post-stage canonical rescanning. A higher fencing token cannot inherit stale mutation authority. Batches yield for renewal and cancellation, and stale takeover fails before mutation. A tested reclamation failure during startup stops renewal and releases its still-owned lease; any cleanup failure is reported. The collector rejects a static symlinked project root, skips symlinked entry directories, and leaves malformed names, non-regular entries, unregistered stage-looking files, and managed media untouched. Focused prepared, committed, update, delete, higher-token path-reuse, corruption, case-alias, inventory progress, quarantine, stage-crash, symlink, and startup-cleanup fixtures qualify this cooperative-writer control without adding renderer IPC.

The shared-project surface of the identity service, frozen preload, and owner-scoped IPC exposes only bounded, pathless list, read, bundle, commit, delete, and managed-source transfer operations. Main and preload independently enforce the 256 MiB document, 4 KiB identity, 10,000-summary, 64 GiB source-body, 4,094-bundle-descriptor, and 4 MiB chunk ceilings; renderer transfer code separately caps the project at 4,094 reachable logical sources before source-body or bridge-body I/O. Main additionally permits at most four active source uploads and four active source reads across the bridge service. Upload capacity remains charged through publication or abort settlement, and disposal waits for finishing publications. Catalog summaries omit entry IDs, main-owned catalog/filesystem paths, digests, product preferences, raw `updatedAtMs` fields, leases, and fencing tokens. Managed bundle descriptors expose only immutable binding IDs, source identities and storage keys, source kind, the matching closed `audio-f32le-chunks-v1` or `video-original-v1` encoding, byte lengths, and SHA-256 digests. Owner revocation fences new work, aborts owned upload sessions, and drains admitted operations. The renderer repository repeats maintained-persistence-domain exact-schema-9 validation and canonical reserialization before local mutation, retains revision history plus source and media data in a product-local shadow, treats the shared latest document and summary list as authoritative, and fails closed on an incomplete desktop bridge. A composed source-free editor fixture creates and autosaves in Soundscaper, discovers and bootstrap-reopens the same identity and revision from a fresh Framescaper-local store, publishes the next revision under a higher fencing token, and leaves the shared media catalog empty.

Ordinary shared-project saves remain document-only. Managed canonical PCM and retained original video are published only through the explicit project-handoff action after the current project flushes. Before any source body read or bridge call, the sender enumerates at most 4,094 reachable logical sources, deduplicates compatible same-kind physical bindings, rejects conflicting aliases, and preflights one aggregate 64 GiB audio-and-video byte budget plus the audio-only 65,536-chunk budget. It performs two full validating reads of every admitted source; when a binding is absent, the second read also uploads bounded sequential chunks. Changed PCM, video bytes, or trusted video metadata abort completion. Main revalidates the exact current project revision and requested reachable source kind, identity, geometry, and closed `audio-f32le-chunks-v1` or `video-original-v1` encoding before accepting a body, derives the catalog document SHA-256 rather than accepting it from the renderer, and the serialized host repeats exact revision-and-document-digest validation at publication. The immutable binding includes project identity, exact revision, exact document digest, and storage-key/media geometry, so a prior-revision row or same-revision document variant is neither advertised nor accepted as present; exact-present reuse requires the declared length and SHA-256 and reverifies the regular body. When that exact content already has another same-kind canonical binding, main may first fully verify the donor and create a private random staged hard link, verify it again, and promote it exclusively to the distinct revision-bound target. Opaque or corrupt donor rows are skipped, an exhausted donor link count can try another donor, a winning target race is never overwritten, known unsupported hard-link behavior falls back to the normal bounded upload, and other operational failures propagate. New uploads use a private regular stage, are digest-verified and synced, are atomically renamed inside the fixed managed-media root, and are directory-synced before catalog publication. Short, overlong, oversized, digest-mismatched, conflicting, symlinked-scope, and non-regular bodies fail closed. Catalog publication failure can leave a verified materialized immutable body from an upload or linked reuse. Its exact retry reverifies and publishes it without a renderer body upload and does not consume another offered stream; a retry whose inventory remains planned must register and consume a new stage/body attempt. For one managed-media store instance, an exact-absent audio or video binding first validates the prospective catalog, including same-instance pending descriptors, against non-raiseable 50,000-row and 4 MiB serialized-metadata ceilings with lower-only test seams. It synchronously reserves one row and the declared body bytes under a non-raiseable aggregate 64 GiB pending-byte ceiling before awaiting point-in-time BigInt `statfs` for the managed-media root. Failed, malformed, or known-insufficient capacity results reject before managed-media directory work, body iteration, or optional hard-link work. The reservation remains held through descriptor-publication settlement, and final publication rereads the catalog and revalidates lower-only and hard catalog ceilings. Exact-present bindings bypass new-publication capacity admission but still receive immutable descriptor and body verification. The schema-3 managed-media canonical and stage-attempt inventories bind the exact descriptor, project identity, revision, document digest, storage key, state, lease ID, and fencing token. After point-in-time capacity admission for an exact-absent binding, main commits its exact canonical row and random upload or reuse stage before body or optional hard-link work and before directory or stage creation. Materialization accepts only the exact registered stage, verifies it is regular, atomically renames it, syncs the directory, advances the canonical row to materialized, and removes the stage row under persisted before-and-after lease checks. Catalog preparation requires every recognized managed descriptor to have an exact materialized or published row, and catalog commit marks those rows published in the same SQLite transaction as metadata. This optimization is not a universal copy-free guarantee: optional hard-link reuse is conservatively charged the full declared body and can reject a feasible link. Capacity admission is store-instance and point-in-time, not an operating-system, cross-instance or cross-process, whole-handoff, or renderer-session reservation; `DesktopSharedProjectMediaService.beginSourceWrite` can return ready before asynchronous host/store refusal surfaces. Main appData project-document and SQLite/WAL allocation, filesystem allocation overhead, later external allocation, write-time success, and UI state remain unqualified. Startup-bounded tracked-inventory reclamation is a separate control; continuous runtime cleanup, rows beyond 100,000 until a later startup, unregistered or legacy content, empty directory cleanup, and SQLite/WAL space reclamation remain unqualified.

After metadata-journal recovery and project-file reclamation, and before host exposure, a separate main-only managed-media collector walks authoritative canonical and stage-attempt inventories. Each descriptor row binds project identity, exact revision, document digest, storage key, state, and the live lease and fencing token. For each tracked catalog row whose exact current project tuple no longer exists, it logically retires that row; unmanaged or untracked rows are preserved. The normal fenced metadata journal is settled before physical deletion, and a current recognized descriptor without exact materialized or published inventory fails startup before managed-media filesystem mutation. Physical reclamation uses persisted independent high-waters and an alternating schedule for stage and canonical cycles, scans at most 100,000 total inventory rows per startup in at-most-64-row batches, and revalidates the exact unexpired lease before and after filesystem work. Current exact-lease stages, current catalog descriptors, and canonical rows with an outstanding stage are protected. Stale registered regular stages are removed, missing attempts retire, and non-direct parents remain untouched and inventoried. Stage cleanup and logical retirement restart the canonical cycle when they can change eligibility. Eligible exact registered canonical bodies move through deterministic noncatalogable quarantine before unlink, making crash-left promotion, quarantine, missing, and hard-link-name states retryable. Unregistered and legacy lookalikes, symlinks, non-regular targets, foreign files, and unmanaged catalog rows are neither adopted nor removed, remain untouched, and do not consume the inventory budget. Snapshot counts expose bounded completion, and startup failure releases the still-owned lease. This is startup-only cooperative-writer reclamation: more than 100,000 tracked rows wait for a later startup, while empty directory cleanup, SQLite/WAL space reclamation, and continuous runtime cleanup remain unqualified. Validation is exact-reference and bounded-batch rather than an eager hostile third-party database scan. The compiled desktop runtime and staging inventory include the collector without qualifying packaged UI or source-bearing workflows.

A maintained dedicated Linux x64 CI job builds two separate unpacked packages and executes Soundscaper → Framescaper → Soundscaper sequentially. The processes share only an isolated appData root, use separate product profiles, and the final stage reuses the Soundscaper profile. After a renderer-ready signal, each packaged executable uses the pathless preload IPC, exact-SHA-256 verifies its expected canonical source-free schema 9 document, commits revisions 1, 2, and 3, and validates both the renderer summary and main-only catalog row. Every stage requires clean recovery, no stale takeover, a higher fencing token, an increasing catalog revision, and the expected preferred product. The runner awaits process exit and lease release before continuing. Combined with the composed editor fixture, this closes only the generic packaged source-free preload/IPC/multi-process/executable lifecycle gap. It does not qualify packaged controller autosave or tab activation; source-bearing bytes, playback, or managed media; concurrent opens; crash or stale takeover; interruption or power loss; parent-, database-, or project-root path identity; installers or file associations; or Windows, macOS, or ARM64. Third-party activation gating and legacy Soundscaper library migration remain deliberately outside this slice.

For a latest authoritative exact-schema-9 source-bearing load, recipient-local admission collects at most 4,094 reachable timeline, Project Bin, and fallback sources and, before source bodies are read, deduplicates compatible same-kind physical bindings, rejects conflicts, and preflights the same aggregate 64 GiB audio-and-video byte ceiling plus the audio-only 65,536-chunk ceiling. A fresh recipient first acquires matching managed canonical-PCM and retained-original-video descriptors through exact bounded reads into staged product-local audio-source or media-asset writers. Descriptor identity, kind and storage key, exact byte length, and SHA-256 must match before atomic if-absent publication, and canonical audio byte geometry must also match the project. Retained original video is admitted as opaque exact bytes and is not decoded or probed for media geometry at this boundary. A writer that loses the absence race deletes only its own staging and preserves the winner. Partial transfers, later pre-shadow failures, and recipient-local binding conflicts roll back only exact acquisition-owned audio records or owned video publications and their source-token, path, or media-chunk payloads; a concurrent replacement with a different record identity or token is preserved. Sources not acquired this way still require the pre-existing latest recipient-local exact-schema-9 snapshot of the same project to bind logical identity, kind, storage key, MIME type, and kind-specific media geometry before any source or media read. Compatible same-kind physical-key aliases are body-verified once and conflicts reject. A successful unmanaged body qualification captures selected metadata before and after that body. Audio consumes the exact sequential chunk count and ordered Float32Array PCM with exact chunk, channel, and frame geometry; any supplied index or frame count must match. Video requires a syntactically valid trusted recipient-local SHA-256 before any video body read, then fully reads and hashes the genuine exact-size Blob with SHA-256 through 4 MiB windows, and the body digest must match. Legacy PCM-on-read migration and media-digest backfill are disabled during shared admission. Digestless legacy video fails closed before its body is read, local shadow save, or activation; ordinary local loading must complete trusted digest backfill before retry. Source integrity, availability, binding, geometry, budget, body, and digest failures detected before shadow publication preserve the recipient's prior local shadow and prevent activation. Cancellation first observed after the exact shadow is durable rejects the load before activation but retains the exact shadow and acquired audio and video it references. The later controller-owned rendered-fallback-declaration digest check instead follows repository shadowing. A source-free latest load performs zero source or media I/O. Bootstrap passes its lifetime signal, one repository instance keeps latest load, save, and delete serialized per project, and publication and retention protect physical storage keys. The maintained headless composed mixed-media fixture publishes exact PCM plus one retained original video from Soundscaper, closes its host and local store, acquires both into a fresh Framescaper-local store before activation, reports no missing sources, feeds exact PCM to the playback engine, exposes exact video bytes through a shared Blob URL to the timeline and Project Bin, exercises play and stop state, edits and saves in Framescaper, and returns to the original Soundscaper profile. On the tested Linux filesystem the revision-bound audio and video catalog rows are distinct while each exact body retains one inode; reopening the original profile preserves its local revision history and requires no bridge or shared-library body read or upload. This is controller/headless evidence, not packaged Electron UI or browser video-codec qualification.

Two narrower one-way headless fixtures root exact-schema first-party fallbacks
whose manifests are their only project references. The audio fixture transfers
the original and whole-mix PCM into a fresh Framescaper shadow before separate
controller manifest verification and exact-sample activation. The video fixture
transfers an editable retained-video original and full-render fallback from
Framescaper into a fresh Soundscaper shadow before separate controller manifest
verification and activation of the exact fallback Blob URL. Managed acquisition
verifies transfer descriptors and body digests; it does not authenticate either
manifest declaration. These fixtures add no packaged UI, browser-codec,
embedded-video-audio, durable-lease, range, or whole-handoff atomicity claim.

One narrow linked-WAV managed-handoff exception is Electron-injected and
point-in-time. It admits a main-private RIFF or RF64 WAV no larger than 512 MiB
when its sample payload uses a maintained PCM or IEEE-float encoding. The raw
path and device, inode, size, modification-time, and change-time tuple stay in
the private locator registry; project state retains only canonical source
geometry and a pathless local binding. The whole external WAV snapshot is
materialized and digest-verified before canonical reads, while the sender has
no owned PCM record or chunk. Explicit managed handoff performs the normal two
canonical Float32 PCM passes and transfers only the resulting
`audio-f32le-chunks-v1` body. A fresh recipient with no locator port acquires an
ordinary owned canonical PCM source and reopens without the original locator.
The external container bytes and locator identity do not cross the managed-media
bridge or enter its catalog. The composed witness directly exercises RIFF
IEEE-float; focused reader and import evidence owns the wider maintained
RIFF/RF64 PCM and IEEE-float dialect boundary.

This exception does not qualify packaged executable or UI behavior,
operating-system file-dialog or path durability, relink or watch behavior,
broader audio formats, audio ranges, or generic linked-audio support. The stat
tuple and full-body digest remain sequential point-in-time observations rather
than a durable path, immutable same-inode lease, or cross-process guarantee.

The linked retained-video slice persists a schema-1 closed product-local binding keyed by exact project and source identity. It contains only a pathless opaque locator ID, an opaque locator-revision fence, an independent repository-owned CAS binding token, storage key, canonical video MIME, exact source geometry, byte length, lowercase SHA-256, and canonical bind time; no filesystem path, URL, handle, or linked body enters project state or the binding store. The maintained Electron chooser accepts exactly one non-empty regular allowed video no larger than 512 MiB. Main records at most 128 locators and 64 GiB of aggregate referenced bytes in an atomically replaced private schema-1 JSON file under product-local `userData`; the registry itself is capped at 1 MiB. Only that main-owned file contains each raw absolute path and its device, inode, size, modification-time, and change-time identity. Main and preload return only validated random 64-hex locator and revision tokens with bounded display metadata. An ordinary locator load verifies the recorded stat identity before and after minting a fresh owner-scoped `materialized-v1` descriptor. A playback load instead requires the exact locator revision, verifies the current pathname identity, and requires the newly opened owner-scoped `linked-video-range-v1` handle to match that same identity before publication. Moving, deleting, or replacing the selected pathname before admission therefore fails closed, while replacement after admission cannot retarget the pinned handle. Renderer-owner revocation fences that owner's operation and ephemeral read descriptors but does not erase the persistent locator. Explicit locator release is a serialized exact locator-ID-and-revision CAS: a missing, stale, or already-revoked pair returns false without a registry write, while success retires only locator metadata and never deletes the external file. Failed persistence restores only in-memory state and does not prove durable on-disk rollback. Owner revocation after a deletion write attempts a second persisted restore; a failed restore is surfaced with an indeterminate on-disk outcome.

The selection and import adapter consumes and releases its fresh descriptor through the existing whole-Blob materializer. Choice failure or cancellation after locator publication uses a closed exact locator ID-and-revision CAS release; a missing, malformed, or accessor revision never authorizes cleanup. The capability-gated Project Bin action passes one materialized selection and its pathless locator to the maintained video importer. The importer skips owned retained-original publication, constructs the exact video source, and binds and completely hashes the locator body before visual activation and canonical command publication. Failures before the canonical source lands release the unused exact locator revision, conditionally unlink the just-published binding, and remove import-owned audio and disposable derivatives. Once the canonical source has landed, a later publication or reporting failure retains its binding, locator, audio, and previews with that canonical state instead of attempting destructive rollback. Poster and thumbnail cache access derives provenance from the normalized exact linked binding and checks that binding around save, list, and load; those bodies remain disposable, noncanonical, and nonportable.

Bind and whole-Blob resolve validate project ID, source ID, storage key, MIME type, and every geometry field before privileged platform I/O. Resolve supplies the expected locator revision, requires exact length and complete SHA-256 through non-raiseable 4 MiB windows, and rereads the exact binding and CAS fence before returning a pathless point-in-time Blob snapshot. Maintained desktop visual activation first attempts a separate ranged playback lease. It supplies the exact binding revision, requires matching byte length and MIME, hashes the complete pinned handle sequentially in non-raiseable 4 MiB ranges, rereads the exact binding and CAS fence, and returns only the media URL and one-shot release operation; it does not construct another original-video Blob. The visual service owns that lease together with its disposable Object URLs. Cancellation, activation failure, source supersession, project-generation replacement, visual replacement, project switch, source cleanup, project deletion, local-data clear, and controller disposal use asynchronous cleanup. Candidate and stored leases are released once, all bulk cleanup is attempted, primary and cleanup failures are preserved, and a media-element failure can compare the exact media URL before revoking so a stale error cannot release a newer visual. A failed ranged admission does not silently retry through whole-Blob resolution; the whole-Blob path remains only for a platform port without the optional playback lease.

Each linked-enabled shared load or handoff builds a fresh per-operation alias session authenticated by a module-private WeakMap, so a structurally forged proof is rejected. The session inspects every complete reachable video alias group before any linked body read and rejects conflicting geometry, incomplete aliases, different locator or content identity, and sibling binding replacement. The maintained acquisition, availability, and handoff paths finish group, metadata, and aggregate budget preflight before lazy first body resolution. Storage key alone never authorizes a source: an authentic session must also bind every exact project/source identity and geometry plus matching MIME, length, and digest metadata. Import creates no durable product-owned original-video copy or media row. Binding, descriptor-free shared admission, and visual activation likewise create no durable product-owned copy; only explicit managed handoff feeds the verified Blob into the maintained managed sender. A bounded same-store/process lifecycle coordinator serializes binding mutations, project deletion and whole-store clear. It inventories at most 100,000 binding rows and 128 unique exact locator/revision pairs and deduplicates aliases. The local commit completes before exact metadata release; it then re-inventories so a live alias prevents release. Release rejection cannot undo the committed local mutation: it reports a committed cleanup error and retains a bounded pending retry that rechecks aliases on a later serialized operation. A fulfilled false result denotes a stale or missing locator and settles cleanup. The external target remains untouched. Source-level reachability within a surviving project remains open; separate store or process activity is not serialized, crash and persistence durability are not qualified, and packaged executable/UI and operating-system behavior remain unqualified.

`maintained-save-kindful-linked-original-binding-reachability` narrows maintained
save-triggered kindful linked-original binding reachability. The controller's
queued autosaves, flushes, inactive-tab saves, and project-switch or analysis
explicit saves collect authoritative roots from every live Undo/Redo history,
the clipboard's media kind, audio recording, and render-cache state only when
the queued write executes. The resulting kindful audio/video reference array is
frozen and deduplicated. A direct unqualified save skips destructive cleanup.
The same textual source ID remains kind-distinct, a wrong-kind root does not
retain a binding, and `protectedLinkedVideoSourceIds` remains a compatibility
facade for direct callers.

After admission, the current exact schema 9 project and at most 64 retained
revisions provide timeline, Project Bin, and all feature-fallback declarations
without publisher gating. The pass admits at most 100,000 aggregate roots,
100,000 closed binding rows, and 128 exact locator references. Desktop waits for
the remote acknowledgement and keeps the latest-mutation lock through the
atomic local binding transaction. Bounded transient bind-before-project
protection remains until the durable or authoritative live graph acknowledges
the source; suppressed or failed maintenance retains one-save transient
protection. A post-commit prune failure is report-only, so the save succeeds and
a later maintained save retries. Release re-inventories every same-store alias
before exact locator retirement.

A memory and IndexedDB witness proves a no-owned-PCM linked WAV whose last
durable revision has aged out stays canonically readable while a live audio root
exists. When the last root disappears, the next maintained save releases the
exact locator once and leaves the external WAV untouched. This remains one live
store and renderer control: separate stores, profiles, renderers, or processes,
abrupt crash or power loss, hostile IndexedDB, and hostile renderer authority
remain unqualified. Project publication, the local binding transaction, and main
locator retirement are separate. Cross-store/process coordination, relink or
watch, audio range playback, packaged executable or operating-system behavior,
third-party activation gating, and legacy private libraries remain outside the
claim.

`same-store-linked-video-project-duplication` narrows the maintained stored-project copy path. It duplicates only the loaded current project snapshot at revision zero; it does not copy the source project's revision history. Reachability is derived from current timeline clips, Project Bin clips, and exact-schema fallback declarations under the portable-format ceiling of 4,094 reachable source identities. Before any alias write, the alias repository validates a complete inventory of at most 100,000 closed binding rows and 128 unique exact locator/revision pairs, rejects malformed rows and conflicting revisions, rejects any pre-existing destination binding, charges the prospective row count, and requires every copied source binding to match the reachable video source's storage key, canonical MIME, and complete video geometry. Only an existing source-project binding for a reachable video source becomes a destination alias. Each alias preserves the exact locator, locator revision, length, digest, and source shape but receives a fresh cryptographic binding token and bind time. The memory path performs its preflight before a synchronous rollback-capable batch; IndexedDB performs the inventory, preflight, and alias writes in one readwrite binding-store transaction. This operation does not invoke the platform locator port: it does not load, stat, hash, materialize, release, or otherwise touch the external video body or private path.

Aliases publish before the copy document so a published project cannot initially lack an alias that the source snapshot possessed. The subsequent create-only repository operation refuses a destination with a current project, the exact revision key, or any revision row. It writes only the compacted current project and its revision-zero record through one IndexedDB transaction or one compensating synchronous memory batch and deliberately leaves unrelated pending source and media rows unchanged. A fresh creation fence is stored with the revision record and associated only with the exact returned snapshot in that repository instance. Exact compensation therefore requires both the complete current snapshot and its creation fence; an identical later save or any replacement blocks deletion. Project collision, known capacity refusal, shadow-document drift, and tested prepublication or transaction failures invoke a second bounded full-inventory alias pass. Missing aliases settle, but any replaced token or changed alias rejects before deleting any member of the rollback batch. The alias and project publications are separate transactions, not one crash-atomic commit. Same-instance duplication and binding operations are serialized by the linked-original lifecycle coordinator; this is not a cross-store or cross-process transaction.

Desktop shared duplication reads the authoritative canonical source document without resolving or admitting its media. After the exact local aliases exist, it performs a remote destination preflight, creates an exact revision-zero local shadow only if absent, and requires the complete canonical shadow serialization to equal the intended copy before calling the existing shared-project commit. An exact acknowledgement succeeds. If commit or acknowledgement handling fails, one authoritative reread classifies the outcome: an exact remote document is treated as committed and retains the local shadow and aliases; an absent remote document permits creation-fence-bound local shadow compensation followed by exact alias rollback. A divergent remote document, an unreadable recovery result, or failure to remove the exact local creation is reported as `ProjectDuplicationIndeterminateError` and deliberately retains the local shadow and aliases. Recovery never deletes a divergent remote project or a replacement alias. This distinguishes known refusal from a possibly committed or superseded remote outcome without claiming one atomic transaction across renderer IndexedDB and the main-owned shared catalog.

Abrupt renderer or process death between the alias, local project, and Desktop remote phases is not qualified. On a later successful durable bootstrap, the existing bounded cooperative reconciliation can remove a binding whose project ID is absent from the authoritative catalog and can subsequently retire startup locator metadata, but it recognizes only project-ID membership and is not a duplication journal. It does not remove a hidden local Desktop shadow or its revisions, prove whether an ambiguous remote commit occurred, or automatically unblock retry of the same destination identity. Memory fallback has no restart recovery. The creation-fence capability is repository-instance-local and is intentionally unavailable after restart. Separate stores, profiles, renderer processes, or main processes are not serialized across the complete duplicate; the focused concurrency witness covers one store instance. Power loss, IndexedDB durability boundaries, filesystem or SQLite durability, automatic indeterminate-state repair, cancellation, packaged UI behavior, and cross-product or cross-device duplication are unqualified. Startup source-level reachability within a catalog-live project also remains open. These residuals do not weaken the narrower point-in-time guarantee that a settled maintained same-store copy reuses pathless exact aliases without external media body I/O.

The privileged service now rejects a compromised renderer's over-budget or maintained-domain-invalid exact-schema-9 input before it can call the host or stage a project, rejects maintained-domain-invalid or structurally over-budget loaded commit results and stored documents before a renderer response, and the renderer repository repeats validation before local mutation. Loaded-result refusal is a response boundary, not a rollback guarantee: a host commit may already be published before its returned object is rejected. This closes the earlier privileged-domain-validation residual and qualifies per-phase project-shape node and depth ceilings for the maintained shared persistence path, but `shared-project-parse-budget` remains open for execution and allocation. The 256 MiB input ceiling, 101,536-value/depth-130 raw preflight, and per-phase 100,000-node/depth-128 exact-V9 decode and validator admissions do not combine into one consumable end-to-end work budget. CPU or elapsed time, cancellation, scalar and string work, IPC and JSON/string allocation, semantic normalization and clone amplification, provider-internal allocation, garbage-collection lag, and total main-process RSS remain unqualified. Remaining project families also lack complete aggregate byte, node, depth, and elapsed-time budgets. Unmanaged recipient admission remains a bounded sequential readability check, not an atomic snapshot, publisher authentication, or a durable byte lease. Selected metadata is reread around each body, but body reads are not transactionally bound to it; same-metadata replacement during the sequential observations can go undetected, and replacement or deletion afterward is not fenced. Unmanaged audio is not authenticated against a prior content digest; injected non-cooperative providers may continue after rejection; shadow save is not abort-atomic once begun; and separate repository instances or processes are not serialized. Explicit managed handoff now closes the maintained headless composed Soundscaper-to-Framescaper edit/save/return path for canonical PCM and retained original video. Separate one-way headless fixtures also close managed transfer and fresh-recipient activation for manifest-only exact-schema first-party audio whole-mix and video-effects fallbacks with their editable originals; each transfer authenticates its descriptors and body digests before the controller independently verifies the manifest declaration. The audio fixture additionally corrupts recipient-local fallback PCM after activation and proves final delivery refuses before render or download, then restores the exact PCM and obtains expected fallback samples in WAV output without canonical mutation. Exact-absent managed publication now has same-store point-in-time prospective catalog and managed-root admission before body or optional hard-link work. Startup-bounded tracked managed-media reclamation, orphan recovery, and logical catalog-row retirement are implemented. Continuous runtime cleanup, more than 100,000 tracked rows until a later startup, unregistered or legacy foreign content, empty directory cleanup, and SQLite/WAL space reclamation remain open. Linked retained video now has a maintained product-local chooser, validated main/preload boundary, whole-Blob selection/import adapter, exact-binding import, closed exact locator ID-and-revision CAS release, owner-scoped exact-revision ranged visual playback, and binding-scoped disposable previews in source and component tests. Raw paths remain in a private main-owned registry while renderer and project state remain pathless. Its persisted device, inode, size, modification-time, and change-time identity is a point-in-time check, not an operating-system bookmark or watch/relink handle. A moved, deleted, or stat-changed target fails the next admission, and pathname replacement after playback admission cannot retarget the opened handle. Same-inode external mutation during or after sequential digest verification is not fenced, however, so the owner-scoped handle is not an immutable, durable, or cross-process byte snapshot. Locator selection, binding, whole-Blob resolution, availability, and handoff still materialize the complete body under the 512 MiB tier. Maintained visual activation instead verifies and plays through at-most-4-MiB ranges without constructing another original-video Blob. Neither bound constrains decoder or codec amplification, renderer or main-process RSS, browser caching, or garbage-collection headroom, and the ranged path has no reference-scale evidence. Bounded same-store/process project-delete and clear cleanup is implemented: the local commit of project-and-binding deletion completes before metadata release, live aliases remain protected, and a pending retry follows any reported committed cleanup failure. A bounded cooperative startup pass uses a point-in-time authoritative project-ID catalog of at most 10,000 exact canonical IDs, validates those IDs before one readwrite binding-store transaction scans at most 100,000 closed rows and 128 unique exact locator/revision pairs, and atomically deletes absent-project bindings only after its complete scan while a live alias retains its locator. Binding validation, conflict, bound, or deletion failure rolls back before IPC; the resulting frozen positive inventory then enters the existing reconciliation path. Source-level reachability within a surviving project remains open. The catalog snapshot, binding transaction, and main registry write are not one cross-boundary atomic operation; main cannot authenticate a hostile renderer's inventory completeness; separate store, profile, or process activity is not serialized; and general continuous cleanup beyond same-store project deletion and clear remains open. The source/component slice is not qualified in a packaged executable or across operating-system file-dialog and identity behavior. Beyond the narrow linked-WAV managed-handoff exception, linked audio, broader unmanaged originals, authored-proxy relationships, and generic or third-party rendered-fallback authoring, acquisition, and handoff, plus packaged first-party video-effects fallback workflows, relink and watch behavior, general consolidation, external-writer mutation, exact allocation, whole-handoff, renderer-session, cross-store, cross-process, and write-time capacity behavior remain open. Browser `<video>` codec behavior and packaged Electron UI source-bearing workflows remain open. Cross-platform hard-link availability and crash or power-loss behavior during reuse also remain unqualified; the bounded upload fallback preserves availability only for recognized unsupported-link failures. The Linux x64 source-free packaged lifecycle is qualified, but the remaining platform and fault matrix stays open: per-platform power-loss, parent- and database-path identity, Windows directory-sync and deny-delete behavior, junction, time-of-check/time-of-use, and interrupted foreign collisions at registered random stage paths are not covered. Unregistered or legacy pre-inventory stage-looking files remain foreign and are not adopted or deleted. Existing V1-V8 raw-project migrations remain maintained. Compatibility beyond those retained raw-document migration paths—especially migration from the prior shared `v1` scope or product-private Soundscaper libraries—is deliberately deferred and unsupported rather than a current required control. Audacity project interchange remains a separate boundary.

The bounded cooperative startup reconciliation pass above is implemented at the
main/renderer durability boundary. After durable IndexedDB opens and before
project loading, the maintained renderer obtains a point-in-time authoritative
catalog of at most 10,000 exact canonical project IDs. It validates every ID
against the exact linked-binding identity contract before opening the binding
transaction; an invalid or duplicate project ID rejects bootstrap without that
transaction. Memory fallback returns before catalog listing, binding mutation,
or IPC. A durable platform port without reconciliation can still evaluate the
catalog but performs no binding mutation or IPC.

One IndexedDB readwrite binding-store transaction then validates at most 100,000
closed rows and at most 128 unique exact locator/revision pairs across live and
absent-project bindings. Malformed rows, conflicting revisions, exceeded record
or locator bounds, and any binding deletion failure abort and roll back that
transaction before IPC. Only after the complete scan does the transaction
delete bindings whose project ID is absent from the catalog. Any live alias in a
catalog project keeps the locator live. The transaction returns a frozen sorted
positive inventory, which the maintained bootstrap submits through the existing
closed preload/IPC path.

The authoritative membership check is limited to project IDs. It does not parse
the sources of a surviving project or reconcile source-level binding
reachability within that project. The catalog snapshot, binding transaction,
and main registry write are not one cross-boundary atomic operation. A successful
binding deletion commits before the separate main operation, so a later main
rejection can leave locator metadata to be retired on retry. Main serializes its
pass with locator mutations and removes only startup-loaded metadata absent from
the submitted inventory; runtime-created records are not candidates. A failed
pass can retry, and at most one successful pass completes per store/process.
Unknown or stale references reject before mutation. A failed first registry
write restores the in-memory inventory. Owner revocation after a successful
deletion write attempts a second persisted restore; failure of that restore is
surfaced and its on-disk outcome is indeterminate. The pass never stats or
deletes external video bytes.

On the next successful full bootstrap, this retires a locator left before
binding publication and metadata whose last binding row was durably deleted or
removed as an absent-project binding. Any live alias in a catalog project keeps
the locator in the positive inventory.

Current-process abandoned records wait for a later main-process restart. Main
validates DTO shape and exact revisions but cannot authenticate inventory
completeness: a compromised renderer can omit live references and retire their
startup metadata. Separate store, profile, or process activity is not serialized
with this reconciliation. The pass is cooperative first-party lifecycle
housekeeping, not a renderer-compromise integrity control. The composed restart
witness uses orderly close, dispose, and reopen; abrupt process death,
persistence write boundaries, fsync, and power loss are not qualified.
Source-level and general continuous cleanup beyond same-store project deletion and clear, plus a total cloned-byte or process-RSS bound for one hostile IndexedDB row, remain open.

The rendered-fallback limitation in the preceding residual is narrowed by two
maintained editor exceptions. Exact-schema first-party audio whole-mix PCM remains
reachable when its feature manifest is the only reference, crosses explicit
managed handoff with its editable original, and is acquired with the exact
canonical shadow by a fresh recipient. Managed transfer authenticates its own
descriptor and body digest; after shadow publication, the controller separately
authenticates the project fallback declaration before read-only transient
playback activation with the exact samples. The fixture then corrupts the
recipient-local fallback PCM after activation and proves final delivery refuses
before render or download; restoring the exact PCM produces the expected
fallback samples in WAV output while canonical project state remains unchanged.
Separately, an exact-schema registered first-party `videoEffects` fallback can
activate one exact, locally available,
controller-digest-admitted full render for transient preview and playback even
when the manifest is its only project reference. It also crosses explicit managed
handoff with its editable retained-video original from Framescaper into a fresh
Soundscaper exact shadow; transfer authenticates the two descriptors and body
digests before the controller separately authenticates the manifest declaration
and activates the exact fallback Blob URL. That video slice does not qualify
packaged fallback handoff, browser codec playback, or a durable playback lease.
Authored proxies plus generic or third-party rendered-fallback relationships
remain open, as do unknown and third-party activation.

Path tokens are capabilities. Their required lifecycle is: explicit user selection, validation and handle acquisition in the main process, opaque token issuance, least-authority operations, bounded use, and deterministic revocation appropriate to the token's declared lifetime. Ordinary desktop reads enforce document-owner release, expiry, navigation, renderer-destruction, cancellation, and shutdown lifecycle separately for the 512 MiB `materialized-v1` whole-Blob tier and the four-capability, 65 GiB aggregate `scape-range-v1` tier. Linked-video playback adds an independently admitted `linked-video-range-v1` tier with at most 128 capabilities, 64 GiB of aggregate declared bytes globally and per owner, 512 MiB per capability, 16 active requests, and 4 MiB per response. Its capability has no wall-clock expiry while its renderer-document owner and visual remain live; visual release, owner revocation, navigation, renderer loss, window close, and shutdown retire its handle. Save targets and sessions enforce committed-document ownership, bounded admission, and teardown separately. A linked-video locator remains deliberately different persistent product-local metadata: raw path and stat identity stay main-private across restart, import or whole-Blob resolution mints a fresh owner-scoped `materialized-v1` capability, visual playback mints a fresh exact-revision ranged capability, and a closed exact ID-and-revision CAS release retires metadata without deleting the external file. Same-store project deletion and clear commit local records before exact release, preserve live locator aliases, and retain a bounded pending retry after reported cleanup failure. A successful maintained cooperative bootstrap may retire startup-loaded locator metadata absent from its catalog-pruned durable-binding inventory; this pruning recognizes only project-ID membership and does not inspect source-level reachability within a surviving project. The locator has no operating-system bookmark or watch/relink repair semantics, and the playback handle does not prevent same-inode mutation or provide an immutable cross-process byte lease. The sparse 8 GiB witness qualifies structural inspection and collision cancellation through the Scape range transport, not payload or memory-scale linked import. Active-chunk cancellation and parent-directory durability gaps keep the desktop-write risk partial.

### Untrusted code, future helpers, and plug-ins

`nyquist-untrusted-code-runtime` is **enforced for the current Nyquist surface only**. Source, PCM input/output, parameters, protocol messages, WebAssembly memory, and run time are bounded; abort/timeout terminates the worker; file-I/O C entry points are disabled; and bundled plug-ins are source-pinned and audited. Web Workers provide fault isolation, not an operating-system security boundary. This control does not establish a general third-party package ABI.

`reviewed-web-effect-packages` is **planned and surface-disabled**. A future Web package must be pure WebAssembly instantiated in a dedicated worker through a minimal allowlisted host ABI. Arbitrary third-party JavaScript must not be imported into the application origin. Hash/signature policy, revocation, resource limits, and malformed-ABI tests are required before a loader is exposed.

`native-helper-processes` is **planned and surface-disabled**. The current preload API has no helper or process-spawn channel. A future decoder/render helper needs a versioned bounded protocol, binary verification, least-privilege platform policy, process supervision, timeouts, cancellation acknowledgement, crash quarantine, and malformed-message/output tests. Process separation alone is not a hostile-code sandbox.

`native-plugin-hosting` is **planned and surface-disabled**. Native plug-ins execute arbitrary code with the user account's authority unless a specific operating-system sandbox demonstrably removes that authority. Discovery, consent, allow/deny policy, signing and compatibility metadata, per-platform packaging, supervised hosting, network/filesystem minimization, crash recovery, scanning, and revocation must be designed and tested before VST3, CLAP, AU, LV2, OFX, or another native format is enabled.

### Cancellation and late publication

`long-job-cancellation` is **partial**. Controller task generations and
`AbortSignal` guards prevent tested stale UI publication, and native `.scape`
open/save passes the same task signal through the archive and tested
storage/file-publication boundaries with rollback. Public `.scape` inspection
now registers every generation before task creation or archive work, starts a
distinct named task, snapshots options, composes caller and controller
cancellation, and rejects signal-ignoring results after replacement, project
switching, or disposal. A controller-level coordinator retains current and
superseded generations through archive-reader cleanup. Project-switch admission
synchronously installs a reference-counted temporary fence, cancels captured
work with one shared legacy supersession `AbortError` per admission, and waits
for settlement up to the shared deadline before project work; overlapping
queued switches retain admission fencing until the last settles. Controller
disposal installs a permanent fence and observes the same bounded wait before
engine or storage teardown using the exact lifetime reason. Only the exact
registration abort reason is benign; cleanup failures reject after captured
work settles or remain observable alongside a deadline failure, while disposal
continues the remaining teardown before rejecting.
The coordinator now reserves a maximum of eight active admissions before task
creation or archive work. Cancellation, a temporary or permanent fence, and
drain arm one lower-only 30-second settlement deadline per admission;
overlapping barriers reuse the same deadline without extending it. Expiry is a
typed non-benign barrier failure, is aggregated with an already observed
cleanup failure, and does not remove the active record. A timed-out admission
therefore remains capacity-charged until its retained work actually settles.
Public file opens add one
replaceable request task spanning inspection, collision choice, and native-open
settlement. The UI
continuation owns one opaque prompt, settles its exact identity once, clears and
rejects it with the exact reason on replacement, switching, or disposal, and
keeps explicit user Cancel distinct from lifecycle cancellation. Matching native
import cleanup clears and republishes the global busy flag even when project
activation changed the original project generation; an older import owner cannot
clear newer work. Errors classified as expected lifecycle unwind are suppressed
from generic UI errors. Project switching now
cancels an active native save, inspection, or collision continuation before
awaited work;
direct save keeps its target staged through the last ownership check, aborts on
failure or supersession, and treats successful FSA close or desktop rename as
committed without publishing stale success UI. The exact direct-PCM WAV/AIFF/BWF/BW64 slice
follows the same publication rule: its plan, encoder-finalized, and
destination-written counts agree before commit;
pre-commit failure or cancellation aborts staging, but ownership loss during
the non-cancellable commit returns the committed result without installing
stale export state. Its fourth, committed-result size check can report a
post-publication integrity failure and is never described as rollback. Within
one project-store instance, retained-media loads register before their first
await, as do
streamed-writer begins that pass synchronous argument and signal validation.
Clear holds a temporary admission fence and close a permanent fence; both
reject later media work, signal and drain captured pre-staging begins and reads,
abort established chunk or OPFS sinks and active writers, and cannot settle
while an admitted begin could still return a live writer. A staged-path or
durable-lease cleanup failure rejects maintenance rather than reporting
successful quiescence. Clear establishes maintenance and captures its backend
admission before its first wait. Close installs the permanent media fence and
terminal facade state before its first await, joins an already admitted clear
before terminal teardown, and returns one shared cleanup promise to concurrent
callers; the admitted clear retains its normal memory fallback if IndexedDB
availability fails during that join, while an unrelated pending database
admission remains fenced when no clear is active. Across tabs or independent
store instances, IndexedDB v5 generation-fenced leases retain live unpublished
chunk/OPFS identities during cleanup, make clear invalidate old ownership
atomically, and prevent a fenced writer from publishing late; expired staging
is reclaimable, and degraded memory mode does not create shared streamed OPFS
staging. Inspection now passes its owned signal into the default project
collision lookup. That repository promptly races stalled database admission,
rejects before a pre-cancelled memory read, and aborts and drains an active
read-only IndexedDB transaction while preserving the exact reason. A defensive
public inspection service gives the read-only Scape boundary a narrow retention
capability. The boundary normalizes and registers an injected lookup with the
same inspection admission in its synchronous read callback before returning the
provider promise to the abort race, then still rejects a
signal-ignoring provider promptly, closes the archive reader, and suppresses a
late result or failure. Project switching and controller disposal now join both
coordinator-owned inspection cleanup and registered provider settlement up to
the admission's shared deadline. Project switching rejects before project work
on timeout; disposal records the timeout, completes remaining engine and
storage teardown, reaches its disposed phase, and then rejects. A provider that
ignores its signal can still consume resources after that timeout and retains
its capacity charge until settlement. The coordinator does not claim to
force-terminate or sandbox third-party provider code; stricter provider gating
remains deferred.
The StaffPad clip-cache coordinator has a narrower resource control. It
serializes distinct render jobs before source loading, worker dispatch, or
writer creation; exact-key callers deduplicate, and a queued job cancelled by
its last subscriber starts no PCM work. Each admitted render has a non-raiseable 256 MiB
useful-binary upper bound. Checked arithmetic covers complete source ownership
or cloning, full client output, cumulative transferred chunks, the accumulator
and maximum WASM read block, and the audited 64 MiB StaffPad linear-memory
maximum. Tight planar-array backing validation prevents a small view from
hiding a larger cloned or transferred buffer.

That admission is not a browser heap, process RSS, GC-headroom, or general
renderer limit. Its queue is coordinator-local rather than a product-wide
reservation, so another coordinator or renderer can overlap it. Source/cache
residency, permanent `AudioBuffer` and channel snapshots, message objects,
persistence buffers, and runtime overhead can be additive.
Maintained spectral gain/delete selection has a separate strict admission.
Before storage preflight, dry rendering, worker dispatch, result retention, or
persistence, the controller applies checked arithmetic. A non-raiseable 256 MiB
ceiling with a lower-only test seam covers the conservative sequential
useful-binary upper bound. Each target charges all earlier completed outputs
plus its complete dry-render Float32 input, one equal transfer copy, one
equal-shape output, two selection-sized Float64 accumulation and normalization
arrays, the Hann, real, and imaginary Float64 arrays, and PFFFT input, output,
and work interleaved-complex Float32 regions. The worker boundary independently
validates and admits the actual input before FFT initialization, copying, or
worker creation. It accepts 1–32 nonempty, equally sized Float32 channels with
tight, distinct, non-shared, non-resizable `ArrayBuffer` backing and requires
exact admitted channel and frame geometry for dry-render and worker/fallback
results before retention.
The controller supplies its task-and-project currentness assertion to
persistence, which rechecks it around awaited buffer, source, and analysis work
and immediately before the synchronous project commit.

The claimed limit is only an upper bound on that enumerated useful-binary
ownership model; cheaper fallback and zero-gain branches can omit charged
allocations. It is not a browser-heap, process-RSS, or GC-headroom bound. It is
not a product-wide reservation claim. Persistence buffers, `AudioBuffer` and
channel copies, generic selection effects and spectral replacement, software or
injected renderers, worker and structured-clone message objects,
the PFFFT module heap and setup and retained transform plans beyond the charged
regions, runtime overhead, and other concurrent spectral, effect, or render
jobs remain outside and can overlap.
Central `OfflineAudioContext` render output has a separate narrow admission.
After the no-context software-renderer fallback and before the context factory,
checked arithmetic applies a non-raiseable 256 MiB ceiling with a lower-only
test seam to the exact Float32 context output plus the requested-frame crop
copy when warm-up or processing latency makes both coexist. Created context
length and sample rate are checked before worklets, graph construction, or
source scheduling. The rendered buffer must match the admitted channel count,
length, sample rate, and per-channel Float32 geometry before return or crop;
mismatches fail closed. Oversized geometry can still use the no-context
software-renderer fallback.

The maintained `createExportPlan` path preserves its mobile, output-size, and
live-PCM heuristics as an initial screen, then aligns each offline candidate
with the central admission using project-rate requested frames, effective
pre-roll, maximum mix or per-stem graph latency, and the actual render width.
Known central-limit refusals are demoted to realtime streaming before offline
render or context work, while the exact boundary is admitted. Direct engine
callers retain the central no-context software-renderer fallback.

This is not a source-buffer, reverse-cache, streamed-chunk, graph, worklet,
WASM, codec, browser-heap, process-RSS, or GC-headroom bound. The factory can
allocate before returned context geometry is checked, a caller-side abort does
not prove that native `startRendering()` stopped, and concurrent calls on the
same or separate engines and renderers can overlap without a product-wide
reservation. Other render paths—including realtime capture beyond the
maintained worklet-to-sink stream described next, generic selection effects and
spectral replacement, software or injected renderers, FFmpeg/WASM encoding, and
native hosts—remain outside this central offline control. The export strategy
alignment is a per-plan decision, not a heap, RSS, GC, or product-wide
reservation; other engines and renderers can still overlap, and direct engine
callers retain the separate software-renderer fallback.

Maintained realtime worklet-to-sink rendering has a separate strict admission.
Before constructing an `AudioContext`, it accepts 1–32 channels and
128–16,384 frames per packet, caps a packet at 2 MiB, and derives a
non-raiseable window of at most 512 packets, 8,388,608 pending frame positions,
and 32 MiB of pending planar Float32 PCM. The default is the smaller of 64
packets and the byte-bound count for the admitted geometry. An explicit packet
count may replace that default only within all count, frame, and byte ceilings;
the derived half-window backpressure threshold is lower-only. The worklet
consumes one admitted
producer credit before transfer and fails closed when a complete packet has no
credit. Main returns one credit only after the sink promise settles, pending
count/frame/byte accounting is released, and queue-owned channel references are
dropped. Direct transfer of full packets and one copy for the final partial
packet keep one render's enumerated useful binary at no more than the 32 MiB
outstanding window plus one maximum 2 MiB staging or replacement packet. The
main boundary requires exact channel width, tight distinct non-shared fixed
`ArrayBuffer` backing, declared frames, contiguous offsets, output geometry,
and completion geometry. Total streamed output is not capped by this
working-set control.

This is not a bound on browser structured-clone or message objects,
`AudioContext`, graph, source/cache, resampler, encoder, persistence, WASM,
browser heap, process RSS, or GC headroom. A sink can retain channel arrays
after its promise settles outside the queue contract, and concurrent renders
can overlap without a product-wide reservation. Scheduling can still exhaust
producer credits; the render fails closed rather than retaining an unbounded
`MessagePort` backlog.

Disposable video-preview capture for imported-video posters and filmstrip
thumbnails now has a narrower control. After browser `loadedmetadata` supplies
geometry but before a seek or canvas allocation, checked arithmetic applies
non-raiseable source ceilings of 16,384 by 16,384 pixels and 256 MiB of nominal
source-RGBA bytes. Lower-only request dimensions cap the logical output RGBA
payload at 640 by 360 pixels, or exactly 921,600 bytes. One extractor serializes
its seek, canvas, and encoder section, and cancellation is checked before a
queued turn or seek and again after encoding. A completed encoded Blob is
checked exactly against a non-raiseable 4 MiB ceiling before it can return for
derivative publication. Source import retains the original video, stops later
captures after source-geometry refusal, and stops the remaining filmstrip after
an encoded hard-cap refusal.

`original-bound-disposable-video-preview-cache` is implemented for maintained
poster and thumbnail cache records. Before save, the repository resolves the
retained original by storage key and derives its repository-trusted current
SHA-256 and media-content token. The content-addressed key binds the
original storage key and digest, the closed poster or thumbnail type and
normalized non-negative source time, and the versioned recipe. Save computes
the derivative output SHA-256 and revalidates the original digest/token
immediately before publication; IndexedDB atomically publishes the payload and
scalar companion, while a failed publication removes any staged OPFS output.
On IndexedDB load, payload and companion binding scalars must match, and every
load verifies the stored output size and SHA-256. A well-formed record from an
older original generation is a cache miss even when the replacement has the
same digest; malformed pair or binding data and body-integrity failures still
reject. Legacy or unbound derivative records are also cache misses.

IndexedDB exact derivative deletion and media-asset cascade load every selected
payload and require full agreement with its scalar companion before deleting
any row. Only paths re-projected from validated payloads are disposed after the
transaction commits. A mismatch therefore aborts the transaction without
disposing any OPFS path, so a corrupt companion path cannot delete an unrelated
retained original. A deletion selector that names a recipe matches only that
normalized recipe ID and version; omitting the recipe keeps all revisions
eligible. New video source imports and maintained read-write `.scape` imports
persist `posterStorageKey` and `thumbnailStorageKey` as `null`, future read-only
imports remain opaque, maintained source-update commands cannot author those
locators, durable desktop recipient binding excludes legacy values, and managed
source declarations omit them. Those fields are no longer part of maintained
durable binding identity. This is disposable cache identity, not an editorial
proxy or relink relationship.

Neither control bounds decoder or codec allocations, browser heap, process
RSS, or GC headroom. Object-URL creation and `loadedmetadata` precede the source
gate; a native decode surface need not be the nominal RGBA representation.
Canvas, encoder, driver, and browser overhead are unknown. The encoded Blob
already exists when its size is checked, while the `toDataURL` fallback first
materializes base64 and decoded bytes, so encode-time allocation is unbounded.
Active browser encoding is not force-cancelled, multiple extractors can overlap
without a product-wide reservation, and codec-family malformed-input corpora
plus decode/encode elapsed-time evidence remain open.
Genuine editorial video proxies remain future work, including original/relink
relationships and pre-encode end-to-end working-set admission; disposable
thumbnail derivatives are not editorial proxies.
The bounded desktop materializer now forwards a supplied signal, destroys the
protocol stream, and releases its capability on abort, but current desktop open
and import orchestration does not consistently own or provide that signal.
AUP4, direct media/derivative writes, broad storage operations, and remaining
desktop transports also do not yet share the end-to-end contract. Rejecting a
late UI result is not cancellation if I/O, storage writes, or a process
continues.

The required cancellation contract is end-to-end: one signal flows from the user action or lifecycle event through parser, worker, archive reader, repository writer, filesystem transport, and future helper. Completion is acknowledged only after readers and workers are closed, temporary/staged data is rolled back, capabilities are released, and the job can no longer publish. Import/export workflows also need an accessible user cancel action.

### Dependency and release integrity

`runtime-supply-chain` remains **partial**. In-tree StaffPad, Nyquist, Parametric EQ, and WavPack modules retain their source/binary audits. Controlled FFmpeg publication, desktop staging, pre-pack verification, and the current Soundscaper public desktop-release assembler now validate one checked-in policy manifest that ties exact runtime bytes and base publication metadata to the current source descriptor, aggregate notice, licensing and security matrices, policies, threat model, and LF checkout rules. The publisher separately derives a full-manifest-SHA release prefix and no-store final pointer under fixed tested code, while the assembler requires exact Soundscaper product/target manifests and version-matched packages before network access. Invalid preflight never enters desktop assembly or invokes Wrangler, and staging/publication consume private verified byte snapshots. Electron Builder rejects staged runtime, summary, manifest, and notice drift present at its beforePack check, then reopens the copied extra-resource directory and revalidates the exact runtime inventory, manifest, assets, and notice in afterPack before fuse or signing work. The post-copy tamper regression proves that a mismatch cannot reach fuse application. The checked-in authorizations mirror the licensing matrix and currently block public runtime upload and desktop-release assembly.

The Web application shell now has a separate verified availability boundary.
The build inventories at most 4,096 regular assets, 25 MiB each and 256 MiB in
aggregate, and binds exact lengths and SHA-256 digests into one release identity
covering the service-worker template. Installation verifies that identity and
each complete allowlisted response before CacheStorage publication, writes a
release readiness marker last, and removes only the failed candidate.
Activation refuses an incomplete cache, claims clients before retiring prior
complete shell caches, and a failed takeover leaves the previous release
available. Registration is production-web-only and cannot reject application
startup. Generated product manifests and stable revalidated icons make both
Soundscaper and Framescaper installable; the tested Chromium workflow reloads
both editors offline.

The explicit Web FFmpeg download follows the no-store production pointer only
after a user action. It bounds the pointer to 64 KiB, manifest to 512 KiB, each
runtime file to 64 MiB, aggregate files to 65 MiB, and each streaming chunk to
4 MiB; restricts origin and content-addressed release paths; and verifies
pointer-bound manifest and runtime byte lengths and SHA-256 digests. For a
non-identity `Content-Encoding`, the transport `Content-Length` is advisory and
the bounded decoded body remains authoritative; cached bodies are normalized.
Candidate caches are isolated. A cooperative same-origin Web Lock serializes a
fresh state read, complete final-cache copy, active-state commit, and cleanup;
same-release retries reuse a complete referenced cache, and cleanup after the
state commit is best effort. The store rechecks cached body lengths and SHA-256
digests before reporting readiness and retains one previous complete release.
Only state-committed active and previous descriptors are eligible through the
service worker, which validates the bounded state and streams each normalized
cached body through an exact byte-count and SHA-256 verifier. Partial, altered,
cancelled, failed, or concurrently committed updates do not expose an
incomplete active state. The editor uses a ready installed release without
network access and otherwise retains its pinned network fallback; it does not
implicitly download a runtime.

These controls qualify repository-owned admission and consumer-side detection
of incomplete or pointer-inconsistent releases, not an independent authenticity
root. The checked-in manifest's review marker and payload digest are
self-declared, and a compromised asset host can replace the final pointer with
a new internally self-consistent release. The publisher layout and pointer
contract are not manifest fields, content-addressed writes are neither
conditional nor read back, and browser and release configuration still
hard-code the runtime version instead of proving agreement with reviewed
policy. Web Locks provide cooperative serialization only: browsers without them
report runtime storage unsupported, and older or noncooperating application
code remains outside the commit protocol. A killed client can leave an
unserved candidate or pre-commit final cache until later cleanup. The streamed
cache verifier prevents a module or WASM load from completing after a terminal
digest mismatch, but an arbitrary streaming consumer can observe prefix chunks
before that error. CacheStorage quota and eviction can remove availability, and
there is no product-wide cache reservation. Shell installation materializes one
admitted asset body before caching it. Safari and Firefox service-worker
workflows, storage-pressure recovery, actual-browser multi-tab updates,
downgrade drills, and actual-device offline behavior remain unqualified. Web
notice delivery, complete corresponding source for every enabled FFmpeg
library, and distribution-specific codec patent review remain blocked in the
licensing matrix. Desktop previews remain unsigned and do not qualify signing,
notarization, rollback, or key rotation.

The licensing/provenance matrix is a separate release control. Passing a security audit does not establish license or patent clearance, and provenance documentation alone does not establish runtime isolation.

## Review and release rules

Review this model and matrix when any of the following changes:

- a supported file family, archive field, codec, parser, expansion limit, or storage backend;
- an Electron preference, CSP directive, IPC channel, capability lifetime, protocol handler, or permission;
- a worker protocol, WebAssembly import/export, memory/output budget, or user-code surface;
- a helper executable, plug-in format, SDK, signing rule, process sandbox, or network/filesystem permission;
- cancellation, project switching, renderer teardown, recovery, or atomic-save behavior;
- a runtime binary, external asset host, dependency pin, desktop signing/update path, or release gate.

A status may be promoted only with the acceptance evidence named in the matrix. Planned surfaces stay absent from the renderer bridge and registries. Partial or release-blocked rows stay visible in release review even when their existing tests pass.
