# Local assistance architecture

Local assistance is an optional, desktop-only workflow layer shared by
Soundscaper and Framescaper. It proposes edits from media the user explicitly
selected; it is not required for deterministic editing, project portability,
or delivery. Removing every model and helper leaves a complete editor.

Inference never runs in the browser. Web builds can retain and edit accepted
ordinary project state and authenticated transcript references, but cannot
install models or start analysis. The model manager and every assistance
workflow are reached through menus and loaded lazily; there is no permanent
toolbar, panel, badge, account, hosted inference service, or implicit download.

The machine-readable catalog, runtime manifests, licensing register, security
matrix, and project schema remain the executable authorities. This document
explains how those contracts fit together. Model selection and evidence are
listed in [local-model provenance](../reference/local-model-provenance.md).

## Runtime boundary

All native inference is main-owned and pathless from the renderer. Main
authenticates the exact runtime, model, platform, and file grants before it
starts work. A dedicated inference worker is the only context that imports
native code; the renderer receives opaque job, claim, stream, and progress
identities rather than filesystem or module paths.

| Runtime family | Current responsibility |
| --- | --- |
| Sherpa ONNX | Parakeet speech recognition, Silero voice-activity detection, and the pyannote/ERes2Net diarization pair |
| ONNX Runtime CPU | Alignment, enhancement, separation, tagging, beats, accurate shots, detection, saliency, OCR, and text/image embeddings |
| whisper.cpp | Multilingual Whisper recognition through a fixed-argument, no-shell CLI |
| llama.cpp | Optional Qwen editorial generation with grammar-constrained JSON |
| Kokoro offline G2P | Frozen, authenticated pronunciation preprocessing for local text-to-speech |
| External FFmpeg | Model-free fast shot detection through the separately admitted `scdet` command and live canary |

Target packages generate and authenticate Sherpa ONNX 1.13.5, CPU-only ONNX
Runtime 1.29.0, whisper.cpp v1.9.3, and llama.cpp b10509 closures for the five
maintained desktop targets: macOS ARM64, Linux x64 and ARM64, and Windows x64
and ARM64. The Windows ARM64 Sherpa addon and Kokoro G2P closure are built as
package inputs. DirectML, CoreML, CUDA, WebGPU, and other GPU execution
providers are not admitted by the current contract.

Each runtime family is lazy and isolated. Main owns its utility process,
heartbeat, background scheduling priority, cancellation deadline, RSS
observation, crash quarantine, and idle retirement. A quiet family unloads
after two minutes; an intentional unload is not a crash. Battery or serious
thermal pressure can defer a new job for a bounded period, but never pauses a
job already running. Process separation contains crashes; it is not an
operating-system sandbox, and native helper code remains trusted code.

Large inputs cross a digest- and byte-length-bound `MessagePort` reservation
into main-private staging. Main captures regular-file identity and hashes the
staged media and model artifacts; the worker rechecks identity, size, and
SHA-256 before use. Results return as authenticated JSON claims over the
reverse data plane. Large bodies never ride the control wire.

Preprocessing belongs to the adapter, not the model. The complete workflow
preserves 16 kHz speech, 48 kHz channel-preserving DeepFilterNet, 44.1 kHz
channel-preserving TIGER, 32 kHz PANNs, and 22.05 kHz Beat This inputs. Long
DeepFilterNet and TIGER jobs spool bounded chunks while remaining under one
whole-selection fence. Both ASR choices consume the reviewed VAD stage;
automatic-language Whisper runs wav2vec2 alignment only after English is
detected.

Every invocation is abortable. Whisper, ONNX Runtime, llama.cpp, and pipelined
stages propagate cancellation to the owned process or next safe chunk boundary.
Termination must satisfy the registered cancellation p95 of at most two
seconds. A hung or malformed runtime is terminated and quarantined rather than
retried through another model.

## Catalog and availability

The versioned, digest-pinned catalog is the authority for what Model Manager
may offer. It binds each model id and version to its upstream revision,
distributable artifacts, byte lengths, SHA-256 values, supported platforms,
memory floor, licensing-evidence row, and immutable EU R2 object identity.

Catalog presence permits authenticated installation and custody, not
execution. A workflow becomes available only when all of these agree:

1. the canonical catalog entry and licensing-evidence digest;
2. every installed model artifact and its content hash;
3. the selected target's authenticated runtime closure;
4. platform and memory admission;
5. project, selection, source, range, timing, and link authority;
6. explicit consent for the requested stages; and
7. any separate machine authority, such as the external-FFmpeg canary.

A missing or mismatched condition returns a typed unavailable result. It never
causes an upstream fetch, implicit installation, substitute model, substitute
runtime, fabricated result, or optimistic capability flag. Catalog
publication, artifact digest, runtime/platform compatibility, selected-media
authority, storage integrity, consent, and result authentication stay fail
closed when the feature is used.

The catalog currently offers 22 published model identities. Models and native
engines remain outside ASAR, auto-update payloads, the Pages bundle, and
JavaScript chunks. The full catalog is not installed with the application.

## Model lifecycle

Models live in a content-addressed store in a user-settable filesystem
directory, defaulting to `<userData>/models` on macOS and Windows and
`$XDG_DATA_HOME/Soundscaper/models` on Linux (or
`~/.local/share/Soundscaper/models` when unset). Per-model manifests point at
plain `blobs/sha256-<hex>` files that users can inspect and delete. Model
bytes never live in browser storage or the installation directory.

`Tools > Local Models > Manage Models...` is the only installation surface.
Installation is always a direct user action and performs capacity preflight,
bounded resumable range download, streamed hashing, digest verification, and
atomic publication. Downloads are cancellable and an interrupted partial does
not become an installed model. An authenticated offline preseed is supported;
there is no fallback to an unpinned upstream URL.

The first-party publisher records upstream identity separately from the
distributed artifact. It uses scoped credentials and requires public HEAD,
Range, CORS, and full SHA-256 read-back before catalog output is accepted.
Reproducibly derived ONNX artifacts additionally bind their source digest,
locked conversion environment, recipe, output digest, notices, and
source-framework parity.

Moving the model directory is copy-verify-swap. Startup reconciliation detects
external deletion or corruption without repairing it implicitly. Removing a
model removes its manifest and garbage-collects unreferenced blobs. An app
update may ship a new catalog and mark an installation stale, but it never
silently downloads, replaces, or removes model bytes.

Every installed blob carries its offline licence and attribution material.
After installation, inference performs zero network requests. The privacy
workload observes the complete workflow rather than trusting a JavaScript flag;
where the operating system supports outbound blocking it is an additional
defence, not the primary claim.

## Consent and job authority

`Analyze > Local Assistance` opens product-specific configuration and review
dialogs. The versioned `AssistanceWorkflow` contract owns the guided recipes
and all fifteen Advanced primitive recipes. Each recipe is a closed stage graph
with slotted inputs and outputs, exact model roles, versioned settings, progress,
and one main-owned consent decision.

One aggregate fence binds the job to the project revision, sequence, selected
occurrences, source ids and digests, source ranges, link membership, timing,
warp and retime authority, transcript body, settings, recipe version, model
artifacts, and permitted stage graph. The fence is checked before native work,
before proposal publication, and again before acceptance.

The helper can read only explicitly selected, already persisted media.
Unselected media bytes read must remain zero. Reverse retimes, ambiguous nested
sequences, multicamera ambiguity, live inputs, stale occurrences, changed
source bytes, or an invalid aggregate fence refuse rather than approximate.
VFR and monotonic forward retimes use source-time authority.

Assistance has no camera, microphone, display, picker, capture-grant, or device
permission authority. It cannot initiate capture or consume a live capture.
A stopped recording may be analyzed only after ordinary canonical publication
and a fresh user selection.

Reject, cancel, stale authority, runtime failure, corrupt custody, or review
failure releases staged claims and leaves canonical state unchanged. Jobs are
in-memory rather than restartable; expensive stages checkpoint only rebuildable,
project-isolated derivatives so a rerun can resume coarsely.

## Review and result publication

Every workflow follows **propose, then commit**. Proposals begin unselected and
review surfaces are mutation-free. Cleanup review retains original/result
audition, separation exposes each stem, and crop and highlight proposals remain
transport-backed and editable. Nothing touches the project until explicit
acceptance revalidates the aggregate fence.

Acceptance publishes through ordinary atomic, undoable commands:

- transcripts and captions become labels plus an authenticated external
  `transcript-v1` body containing canonical word timing, confidence, language,
  and speaker data;
- filler, silence, reaction, beat, tempo, and shot proposals use ordinary
  range, label, tempo, and annotation commands;
- enhancement and Dialogue/Music/Effects stems become ordinary derived audio;
- accepted crops and reframes use existing transform and keyframe authority;
- accepted highlights become editable sequences built from ordinary clips; and
- Qwen contributes only bounded, sanitized title, hook, chapter, and
  explanation fields chosen into an accepted proposal.

Transcript bodies are content-addressed and bind source id, digest, range,
optional video-timing digest, recipe/version, and exact model-artifact digests.
History, reopen, duplicate, managed handoff, and Scape archives retain them. A
missing or corrupt body disables that result without blocking the project;
AUP4 reports its omission explicitly.

Embeddings, OCR and tag indexes, shot tables, saliency and tracker state, and
ranking checkpoints are disposable derivatives. Accepted reframe evidence may
be retained for authenticated deterministic reuse without widening the Scape
schema. Raw, malformed, oversized, nonfinite, stale, unselected, or
wrong-role model output never enters project state; raw Qwen output never
enters `.scape`.

Accepted results remain readable and editable in web Soundscaper and
Framescaper because the browser sees ordinary project state, not an inference
dependency. The web tier exposes neither Model Manager nor a run command.

## Verification

The maintained checks cover catalog and artifact authentication, converted
model parity, runtime manifests, installation and relocation, external-deletion
reconciliation, notices, pathless IPC, malformed messages, crash quarantine,
output claims, consent, stale-fence refusal, proposal reject/accept/undo, and
web custody without inference.

The real-model manifest has 20 cases covering all 22 published model
identities. Nightly-with-tests installs the exact model and packaged runtime,
runs the real worker on that target, and validates typed output. A passing small
fixture proves that exact case, revision, and target; it is not a general model
quality, performance, or device claim. Unsupported combinations must report
typed unavailability.

The `m7-local-assistance-privacy` workload uses two selected and two deliberately
unselected assets and requires:

- `networkRequestsAfterInstall eq 0`;
- `unselectedMediaBytesRead eq 0`;
- `acceptedDigestMismatches eq 0`;
- `cancellationP95Ms lte 2000`; and
- `canonicalStateLosses eq 0`.

Speech and visual accuracy criteria remain registered separately from proof
that a corpus has been provisioned. Owner-device observations are optional QA,
nonblocking, and never grant runtime authority. No complete five-target
privacy/cancellation result or unrecorded owner observation may be inferred
from package construction, catalog publication, or another target's run.
