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

`scape-archive-structure-integrity` is **partial**. Import rejects unsafe and duplicate entry names, checks manifest shape, and verifies declared sizes and SHA-256 digests after extraction. Inspection does not yet share the full import envelope, and descriptor-to-entry ownership is not one-to-one for all extra and reserved entries.

`scape-archive-expansion` is **release-blocked** for production qualification. Import currently caps entry count and rolls back tested storage failures, but manifest and project JSON can be materialized before a byte cap. Central-directory expanded sizes, aggregate expansion, encryption/overlap, compression behavior, and descriptor-size agreement are not preflighted. Archive import/export/inspection do not accept a task `AbortSignal`, video extraction materializes a complete `Blob`, and PCM chunk framing needs safe arithmetic and a bounded pending buffer.

Promotion requires all control IDs recorded by the matrix gate: central-directory preflight; bounded manifest and project JSON; cumulative expanded-byte limits; descriptor/entry size agreement; encrypted, overlapping, alias, reserved, and extra-entry rejection; inspection/import validation parity; abort propagation with rollback; and safe PCM frame arithmetic. Tests must prove rejection occurs before staging and that cancellation leaves project/source inventory unchanged.

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

`long-job-cancellation` is **partial**. Controller task generations and `AbortSignal` guards prevent tested stale UI publication, but the native project service does not pass the signal through `.scape`, AUP4, storage, and desktop file operations. Rejecting a late UI result is not cancellation if I/O, storage writes, or a process continues.

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
