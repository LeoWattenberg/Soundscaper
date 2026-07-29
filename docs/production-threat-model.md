# Production threat model

This document records the production security baseline for Soundscaper's local-first Web and Electron editor. The machine-readable control register is
[`config/production-security-matrix.json`](../config/production-security-matrix.json). Its checked-in implementation and test references are the evidence for each current claim.

The model is grounded on 2026-07-29. It must be updated when a trust boundary, supported input, renderer bridge, worker ABI, native executable, plug-in surface, release channel, or long-job lifecycle changes.

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

`external-project-document-validation` is **partial**. Core project migration validates supported schemas and preserves newer schemas as read-only; AUP4 conversion sanitizes imported structure. Legacy `.aup` XML applies a format-specific structural budget: authoritative declared `File.size` and the independently measured UTF-8 byte length of returned text are each capped at 16 MiB, retained elements at 100,000, attributes at 400,000, and depth at 128 through non-raiseable production ceilings and lower-only test seams. Supported canonical, default-sized simple/silent `_data` materialization adds non-raiseable ceilings of 65,536 selected companion files and 65,536 materializing references, 2 MiB per referenced physical file, 1 MiB per AU sample payload, 524,288 decoded or silent frames per block, 512 MiB of authoritative unique referenced file bytes, and 512 MiB of retained Float32 PCM. Bounded exact/basename indexes prevent reference-by-file lookup multiplication. Positive block lengths, a 24-byte AU header minimum, and equal-length paired linked clips are required; repeated references, silence, and linked zero-fill are charged. Selected/reference, declared-byte, and retained-PCM admission precedes retained-PCM allocation or block reads, while payload/frame refusal precedes decoded-block allocation; actual returned bytes must match snapshotted authoritative `File.size`. Audacity native-endian AU headers and samples are accepted, each unique file is read and decoded once, and one preallocated output per physical clip limits the logically reachable parser-owned window beyond retained PCM to one 2 MiB encoded file plus one 2 MiB decoded block. Equal or admitted zero-padded linked channels reach conversion without channel-normalization copies. Structural or materialization refusal precedes conversion, project/source persistence, and imported-project publication. These format-specific controls do not qualify XML-tree or opaque-extension clone amplification, elapsed time or cancellation, aliases, customized Audacity block-size settings above policy ceilings, provider-internal copies or garbage-collection lag, downstream conversion/waveform/storage/persistence working sets, total renderer RSS, noncanonical AU padding, other project families, or streaming-scale legacy import. The cross-format malformed-project regression and fuzz corpus remains incomplete.

`external-media-parser-bounds` is **partial**. WAV/ADM paths have explicit structural and expansion limits, and custom FFmpeg output arguments and protocols are constrained. Compressed audio/video still needs a broad malformed-input corpus, decode budgets, and—when native decoding arrives—a supervised crash-isolated process.

### Portable `.scape` projects

`scape-archive-structure-integrity` is **enforced for the current portable format**. Import and inspection share a strict TypeScript envelope that rejects unsafe or duplicate names, encrypted and directory entries, descriptor aliases, reserved-entry reuse, missing entries, and unreferenced extra entries. Descriptor sizes must match central-directory uncompressed sizes before project or asset extraction, and import still verifies size and SHA-256 after extraction. After project migration, a second shared boundary requires equal source/descriptor counts, unique exact case-sensitive source IDs, and matching audio/video kinds. Orphan, missing, duplicate, invalid, and kind-mismatched identities reject before collision handling, transaction creation, or any storage call; canonical export round trips preserve the same bijection.

`scape-archive-expansion` is **enforced for the current canonical STORE `.scape` import surface**. Before reading manifest bytes, the shared envelope validates entry count, encryption state, and safe compressed/uncompressed metadata, and rejects more than 64 GiB of cumulative declared uncompressed data. Central-directory indexing also requires ZIP STORE with equal compressed and uncompressed sizes before local-header preflight or body reads, so a tested high-ratio DEFLATE archive cannot spend decompression work or reach storage. Canonical export pins and verifies the same STORE policy. The non-raiseable 4,096-entry ceiling bounds the quadratic pairwise layout pass, and export applies it before creating a destination. Manifest JSON is capped at 32 MiB and project JSON at 256 MiB by both metadata preflight and byte-counted text sinks. Descriptor sizes must match entry metadata before project JSON or asset extraction. One shared counter also charges bytes actually emitted into the manifest, project, and every extracted asset against the 64 GiB limit before an over-budget chunk is retained. PCM chunk headers and canonical project chunk geometry are validated before byte-length arithmetic or allocation, limiting parser-owned pending PCM storage to 16 MiB plus its four-byte header; one archive-wide 65,536-chunk ceiling deliberately bounds parser iterations and source-writer calls for the portable format. Export preflights that aggregate audio work before asset reads and rejects backing-store chunks that do not match the same geometry or final frame total. For the tested native `.scape` open/save path, one task `AbortSignal` reaches incremental ZIP enumeration and extraction, source reads and writes, archive output, and file publication. Cancellation closes the archive reader, returns source iterators, aborts unpublished output and transactional source/media writers, deletes provisional media, and restores the previous project together with its retained revision history.

Default import and inspection run a bounded raw-layout preflight before constructing zip.js. It anchors exact classic or Zip64 end records without offset repair, walks exactly the declared central records under a shared non-raiseable 33 MiB cap, resolves required Zip64 fields in specification order, and compares every local header and signed or unsigned data descriptor with its central owner without reading payload bytes. Checked entry ranges must exactly partition the bytes preceding, and never cross, the central directory; exact no-descriptor CRC/size checks close zip.js's zero-field exception. Export admission uses the same ceiling with a conservative per-entry allowance for the pinned writer's greater-than-4-GiB Zip64 offset field, preventing a canonical save from creating an archive that this control refuses. Focused fixtures cover repaired end-record offsets, unsafe Zip64 values, malformed extras and descriptors, zeroed local fields, overlap, gaps, and central-directory crossing, while cancellation and exact bounded Blob reads remain enforced. zip.js strict local-header and pairwise overlap checks remain as defense in depth.

Original video extraction no longer materializes the complete archive entry. zip.js is pinned to 4 MiB emissions; each emission is charged against the actual-byte budget, independently hashed, and awaited through a transactional media writer before the next emission. The writer independently snapshots and hashes storage bytes, enforces exact declared size and digest, and publishes metadata last. OPFS receives bounded writes, IndexedDB fallback stores source-owned native Blob chunks, and process-memory fallback rejects declared payloads above 64 MiB before extraction. The 64 MiB limit is payload admission for the degraded in-process backend, not a claim about total renderer heap or process RSS. Reference-scale cancellation, oversized emission, digest/metadata drift, and publication-failure tests leave prior project/source inventory unchanged.

IndexedDB schema v6 atomically strips the two newly reserved provenance fields from every pre-cutover retained-media row through a one-record-at-a-time cursor; a failed sanitization rolls the complete version change back. Markerless records do not expose an inherited SHA-256 as verified metadata. Their first load atomically installs a retryable version-zero claim with a Web-Crypto content token, validates stored size and chunk geometry, and hashes the stored Blob in bounded 4 MiB reads. A final compare-and-set merges version-one digest provenance only while the same payload token still owns the row, so a concurrent delete/replacement or failed publication cannot receive a stale digest. Cancellation is checked before claim, during bounded reads, after the final compare read, and before publication; an admitted final metadata put settles as the commit boundary. Internal claim/version fields never cross the public metadata API. Every retained-media load now registers synchronously, before its first await, with the same per-store lifecycle coordinator as streamed writes. Clear holds a temporary admission fence and close a permanent fence; both signal captured reads through cancellation linked with the caller and await terminal settlement before deleting data or closing the database. A digest already inside one non-raiseable 4 MiB Blob read observes cancellation when that read returns. The final metadata put remains the commit boundary: a put admitted before the fence settles before maintenance continues, while an abort observed earlier prevents version-one publication. Degraded memory close therefore cannot receive a provenance update after close settles.

Production `.scape` save now selects one user target before asynchronous flush and gives its destination factory the admitted archive maximum. Archive output is re-chunked to at most 4 MiB, awaited with backpressure, and counted independently by the ZIP boundary and file adapter; disagreement aborts before publication. File System Access and desktop outputs remain staged until the controller's final ownership check. FSA `close()` or desktop sync-and-rename is then one explicit non-cancellable commit boundary, so cancellation before it rolls back while cancellation after it cannot falsely report that a committed file was removed. Desktop adds acknowledged one-MiB IPC chunks and bounds writes by the project-specific admitted maximum. Chromium and Firefox workflow evidence reconstructs and reopens the streamed archive; this host cannot launch the pinned WebKit runtime because its system libraries are absent. Browser download remains a Web Core fallback with the non-raiseable 512 MiB final-Blob ceiling. Cross-context coordination for storage operations outside the generation-fenced streamed-media path remains an open lifecycle concern and does not expand the qualified archive bytes accepted by this control.

### Electron renderer, IPC, and filesystem capabilities

`electron-renderer-ipc-boundary` is **enforced for the current v1 bridge only**. The window uses sandboxing, context isolation, no Node integration, sender/root-document checks, denied navigation and new-window paths, and a frozen input-validating preload API. This does not qualify a future helper or plug-in channel.

`desktop-static-resource-paths` is **enforced for the current application protocol**. Decoding, realpath containment, method restrictions, range handling, and the Electron CSP are covered by protocol tests, including escaping symlinks.

`desktop-read-path-capabilities` is **enforced for the current bounded materialization surface**. A user-selected regular file is opened before a high-entropy expiring token is returned, avoiding raw renderer paths and limiting symlink time-of-check/time-of-use exposure. Pending and published capabilities are bound to the opaque main-owned identity of the currently committed main-frame document. For each committed-document owner, admission reserves one of at most 128 pending/live slots before file open, and authoritative main-process publication limits that owner's aggregate active declared selected-file bytes to 512 MiB. Wrong-owner release refuses without mutating the capability. Explicit release, expiry, main-frame non-same-document navigation, renderer loss, actual window close, and shutdown synchronously invalidate the affected lookup before admitted opens and handle closes are drained. A delayed dialog, open, or stat result for a revoked owner closes without publication; partial multi-file failure drains every prior descriptor rollback and reports primary plus cleanup failures; serialized OS-open dispatch keeps one deduplicated queue head visible until a current ready owner receives it; count or byte exhaustion refuses rather than evicts; and cleanup failure rejects the drain after every close is attempted. The preload sanitizes the declared size against the same non-raiseable ceiling. The renderer materializer repeats admission before fetch, requires exact declared `Content-Length`, emitted-byte, and final `Blob`-size agreement, consumes only the response body stream, and copies and splits retained parts at the non-raiseable 16 MiB platform media-chunk limit. It forwards a caller-supplied `AbortSignal`, promptly races and cancels a stalled body read with the exact reason, and never calls `response.blob()`. Scoped descriptor use releases every capability after success, failure, or cancellation, and a protocol request abort destroys its file stream. This tier still creates one whole `Blob` below the ceiling. The bound covers active raw selected-file bytes, not decoder amplification or whole-process RSS; larger range-backed reads are not yet qualified and fail admission rather than starting unsafe materialization.

`desktop-write-path-capabilities` is **partial**. Save targets are high-entropy, expiring, single-use tokens. Exact-size output and project-only maximum-bounded output use acknowledged sequential one-MiB chunks, a private same-directory temporary file, file sync, atomic rename, and abort cleanup. Every target and derived session is bound to an opaque main-owned identity for one committed main-frame document; the renderer bridge neither supplies nor observes that identity. Main-document navigation, renderer loss, and actual window close synchronously fence that owner's admission and invalidate unused targets, including a save-dialog result that returns after revocation. Cleanup then drains admitted begin, chunk, finish, and abort operations, permits an already-admitted finish to cross its sync-and-rename commit boundary, and aborts remaining staging. Fresh-owner session admission waits for prior owner drains, preventing an older admitted rename from overtaking a replacement save to the same destination. Navigation cleanup failures are reported; application shutdown additionally waits for all save work and rejects its failure-aware barrier on an unacknowledged handle close or staging unlink, so the process cannot report a clean exit. Fault-injection tests stall open, write, sync, and rename independently and force both cleanup failures. Admission now enforces 16 outstanding product-wide save targets, 4 pending or live save sessions, and 65 GiB per-save and aggregate admitted bytes, covering the canonical 64 GiB expanded `.scape` envelope plus its bounded STORE/ZIP overhead. Global count and byte reservations are installed synchronously before the first await, and production ceilings expose lower-only test seams. Main fail-closes malformed, failed, or insufficient BigInt `statfs` available-space results before staging open. This preflight is a point-in-time check, not an operating-system reservation, so later external disk use can still make a write fail safely. Reservation charges release only when no staging was acquired, cleanup is acknowledged, or commit completes; a staging cleanup failure leaves the count and bytes charged. An active chunk cannot be preempted inside its filesystem write, and parent-directory/per-platform durability still needs fault qualification.

Path tokens are capabilities. Their required lifecycle is: explicit user selection, validation and handle acquisition in the main process, opaque token issuance to one renderer owner, least-authority operations, bounded use, and deterministic revocation on release, expiry, navigation, renderer destruction, cancellation, and shutdown. Desktop read capabilities enforce that lifecycle for the qualified 512 MiB bounded materialization tier, while save targets and sessions enforce its committed-document ownership, bounded admission, and teardown portion. Larger range-backed reads remain a planned capability rather than an unsafe fallback; active-chunk cancellation and parent-directory durability gaps keep the desktop-write risk partial.

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
work with one shared legacy supersession `AbortError` per admission, and drains
it before project work; overlapping queued switches retain admission fencing
until the last settles.
Controller disposal installs a permanent fence and drains before engine or
storage teardown using the exact lifetime reason. Only the exact registration
abort reason is benign; cleanup failures reject after all captured generations
settle, while disposal continues the remaining teardown before rejecting.
Public file opens add one
replaceable request task spanning inspection through collision choice. The UI
continuation owns one opaque prompt, settles its exact identity once, clears and
rejects it with the exact reason on replacement, switching, or disposal, and
keeps explicit user Cancel distinct from lifecycle cancellation. Request
ownership finishes before native open starts, and errors classified as expected
lifecycle unwind are suppressed from generic UI errors. Project switching now
cancels an active native save, inspection, or collision continuation before
awaited work;
direct save keeps its target staged through the last ownership check, aborts on
failure or supersession, and treats successful FSA close or desktop rename as
committed without publishing stale success UI. Within one project-store
instance, retained-media loads register before their first await, as do
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
coordinator-owned inspection cleanup and registered provider settlement. A
provider that ignores its signal can still consume resources until settlement,
and a never-settling provider can hold the lifecycle barrier indefinitely
because inspection providers have no deadline or admission cap.
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

This qualifies only repository-owned admission. The manifest's review marker and payload digest are self-declared and detect inconsistent edits, but do not authenticate independent approval; a protected or signed attestation remains required. The publisher layout and pointer contract are not yet manifest fields, content-addressed object writes are neither conditional nor read back, and the browser and release workflows still hard-code the runtime version instead of resolving or authenticating the pointer, comparing their path with the manifest, or retaining a last-known-good runtime. Web notice delivery, complete corresponding source for every enabled FFmpeg library, and distribution-specific codec patent review remain blocked in the licensing matrix. Desktop previews remain unsigned and do not qualify signing, notarization, rollback, or key rotation.

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
