# Production threat model

This document records the production security baseline for Soundscaper's local-first Web and Electron editor. The machine-readable control register is
[`config/production-security-matrix.json`](../config/production-security-matrix.json). Its checked-in implementation and test references are the evidence for each current claim.

The model is grounded on 2026-07-28. It must be updated when a trust boundary, supported input, renderer bridge, worker ABI, native executable, plug-in surface, release channel, or long-job lifecycle changes.

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
| `renderer-to-electron-main` | Sandboxed renderer | Electron main process | Only the versioned, validated bridge reaches privileged handlers. |
| `electron-main-to-filesystem` | Protocol and IPC requests | User-selected files and packaged resources | Renderer code receives capabilities, not ambient paths or arbitrary filesystem access. |
| `untrusted-runtime-to-audio-engine` | User-authored Nyquist source | Editor PCM and effect results | Bound source, input, output, memory, time, and host imports. |
| `application-to-native-extension-surface` | Application requests | Future helper and native plug-in processes | No current channel exists; future authority needs an explicit protocol and process policy. |
| `controller-task-to-io` | Cancelled or superseded controller job | Readers, writers, workers, and project state | Cancellation reaches the work, closes resources, rolls back staging, and prevents late publication. |
| `dependency-to-release-artifact` | Registry, source archive, binary, and build inputs | Web assets and desktop packages | Shipped executable bytes match reviewed, pinned provenance and release policy. |

## Current risk register

### Malformed projects and media

`external-project-document-validation` is **partial**. Core project migration validates supported schemas and preserves newer schemas as read-only; AUP4 conversion sanitizes imported structure. Parser families do not yet share aggregate byte, node, depth, and time budgets, and the malformed-project regression corpus is incomplete.

`external-media-parser-bounds` is **partial**. WAV/ADM paths have explicit structural and expansion limits, and custom FFmpeg output arguments and protocols are constrained. Compressed audio/video still needs a broad malformed-input corpus, decode budgets, and—when native decoding arrives—a supervised crash-isolated process.

### Portable `.scape` projects

`scape-archive-structure-integrity` is **partial**. Import and inspection now share a strict TypeScript envelope that rejects unsafe or duplicate names, encrypted and directory entries, descriptor aliases, reserved-entry reuse, missing entries, and unreferenced extra entries. Descriptor sizes must match central-directory uncompressed sizes before project or asset extraction, and import still verifies size and SHA-256 after extraction. The remaining structural gap is a one-to-one check between migrated project source IDs and manifest asset source IDs.

`scape-archive-expansion` remains **release-blocked** for production qualification. Before reading manifest bytes, the shared envelope validates entry count, encryption state, and safe compressed/uncompressed metadata, and rejects more than 64 GiB of cumulative declared uncompressed data. Central-directory indexing also requires ZIP STORE with equal compressed and uncompressed sizes before local-header preflight or body reads, so a tested high-ratio DEFLATE archive cannot spend decompression work or reach storage. Canonical export pins and verifies the same STORE policy. The non-raiseable 4,096-entry ceiling bounds the quadratic pairwise layout pass, and export applies it before creating a destination. Manifest JSON is capped at 32 MiB and project JSON at 256 MiB by both metadata preflight and byte-counted text sinks. Descriptor sizes must match entry metadata before project JSON or asset extraction. One shared counter also charges bytes actually emitted into the manifest, project, and every extracted asset against the 64 GiB limit before an over-budget chunk is retained. PCM chunk headers and canonical project chunk geometry are validated before byte-length arithmetic or allocation, limiting parser-owned pending PCM storage to 16 MiB plus its four-byte header; one archive-wide 65,536-chunk ceiling deliberately bounds parser iterations and source-writer calls for the portable format. Export preflights that aggregate audio work before asset reads and rejects backing-store chunks that do not match the same geometry or final frame total. For the tested native `.scape` open/save path, one task `AbortSignal` now reaches incremental ZIP enumeration and extraction, source reads and writes, archive output, and file publication. Cancellation closes the archive reader, returns source iterators, aborts unpublished output and audio writers, deletes provisional media, and restores the previous project together with its retained revision history.

Every entry now receives a zip.js strict local-header and pairwise entry-range preflight before manifest extraction. This rejects tested local/central compression-method disagreements and nested entry ranges, but it is not complete ZIP-layout validation: zip.js accepts zero-valued local CRC and size fields when a data-descriptor flag has been cleared, and it does not compare entry ranges with the central-directory or end-record ranges. The remaining promotion gate therefore retains exact local-header/central-directory boundary validation and bounded streaming video extraction. Video extraction still materializes a complete `Blob`. Tests must prove those remaining failures stop before their working-set limits and leave project/source inventory unchanged.

### Electron renderer, IPC, and filesystem capabilities

`electron-renderer-ipc-boundary` is **enforced for the current v1 bridge only**. The window uses sandboxing, context isolation, no Node integration, sender/root-document checks, denied navigation and new-window paths, and a frozen input-validating preload API. This does not qualify a future helper or plug-in channel.

`desktop-static-resource-paths` is **enforced for the current application protocol**. Decoding, realpath containment, method restrictions, range handling, and the Electron CSP are covered by protocol tests, including escaping symlinks.

`desktop-read-path-capabilities` is **partial**. A user-selected regular file is opened before a high-entropy expiring token is returned, avoiding raw renderer paths and limiting symlink time-of-check/time-of-use exposure. Capabilities are not yet bound to renderer destruction or aggregate session budgets, and renderer file reads currently materialize whole `Blob` values without end-to-end abort propagation.

`desktop-write-path-capabilities` is **partial**. Save targets are high-entropy, expiring, single-use tokens; writes use bounded sequential chunks, declared-size checks, a private same-directory temporary file, file sync, atomic rename, and abort cleanup. Sessions still need renderer-owner cleanup, practical and aggregate storage limits, in-flight cancellation qualification, and per-platform durability fault tests.

Path tokens are capabilities. Their required lifecycle is: explicit user selection, validation and handle acquisition in the main process, opaque token issuance to one renderer owner, least-authority operations, bounded use, and deterministic revocation on release, expiry, navigation, renderer destruction, cancellation, and shutdown. The current implementation only satisfies part of this lifecycle, which is why read and write capabilities remain partial.

### Untrusted code, future helpers, and plug-ins

`nyquist-untrusted-code-runtime` is **enforced for the current Nyquist surface only**. Source, PCM input/output, parameters, protocol messages, WebAssembly memory, and run time are bounded; abort/timeout terminates the worker; file-I/O C entry points are disabled; and bundled plug-ins are source-pinned and audited. Web Workers provide fault isolation, not an operating-system security boundary. This control does not establish a general third-party package ABI.

`reviewed-web-effect-packages` is **planned and surface-disabled**. A future Web package must be pure WebAssembly instantiated in a dedicated worker through a minimal allowlisted host ABI. Arbitrary third-party JavaScript must not be imported into the application origin. Hash/signature policy, revocation, resource limits, and malformed-ABI tests are required before a loader is exposed.

`native-helper-processes` is **planned and surface-disabled**. The current preload API has no helper or process-spawn channel. A future decoder/render helper needs a versioned bounded protocol, binary verification, least-privilege platform policy, process supervision, timeouts, cancellation acknowledgement, crash quarantine, and malformed-message/output tests. Process separation alone is not a hostile-code sandbox.

`native-plugin-hosting` is **planned and surface-disabled**. Native plug-ins execute arbitrary code with the user account's authority unless a specific operating-system sandbox demonstrably removes that authority. Discovery, consent, allow/deny policy, signing and compatibility metadata, per-platform packaging, supervised hosting, network/filesystem minimization, crash recovery, scanning, and revocation must be designed and tested before VST3, CLAP, AU, LV2, OFX, or another native format is enabled.

### Cancellation and late publication

`long-job-cancellation` is **partial**. Controller task generations and `AbortSignal` guards prevent tested stale UI publication, and native `.scape` open/save now passes the same task signal through the archive and tested storage/file-publication boundaries with rollback. Inspection still has no owned controller task, and AUP4, whole-file desktop reads, broad storage operations, and remaining desktop transports do not yet share that contract. Rejecting a late UI result is not cancellation if I/O, storage writes, or a process continues.

The required cancellation contract is end-to-end: one signal flows from the user action or lifecycle event through parser, worker, archive reader, repository writer, filesystem transport, and future helper. Completion is acknowledged only after readers and workers are closed, temporary/staged data is rolled back, capabilities are released, and the job can no longer publish. Import/export workflows also need an accessible user cancel action.

### Dependency and release integrity

`runtime-supply-chain` is **partial**. In-tree StaffPad, Nyquist, Parametric EQ, and WavPack modules have source/binary manifests and audit scripts; desktop preview packaging applies Electron fuses and checks ASAR integrity. External FFmpeg asset publication is not yet tied to one complete digest, corresponding-source, notice, and security gate. Desktop previews are unsigned and do not qualify production signing, notarization, update rollback, or key rotation.

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
