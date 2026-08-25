# Milestone 7 and 8A activation plan

## Outcome

- Complete and activate every baseline Milestone 7 workflow for both desktop
  products. Accepted edits remain readable and editable on the web, while new
  inference remains desktop-only.
- Activate Framescaper capture for standalone web and desktop on the final
  selected Framescaper schema.
- Treat owner-lab, reference-device, and other manual qualification as
  nonblocking. Record implementation as active and qualification as pending or
  unqualified in diagnostics and documentation without adding a user-facing
  preview or qualification warning.
- Keep licensing, artifact integrity, explicit consent, selected-media
  authority, runtime compatibility, storage durability, and security checks
  fail-closed.

## Model supply chain and native runtime

- Enable only the `local-models` future-distribution gate. An offered model
  must have `distributionStatus: permitted`, complete evidence, exact runtime
  compatibility, and mirrored artifact pins. All other future gates remain
  disabled.
- Introduce signed catalog V2: Ed25519 over canonical JSON, pinned current and
  next public keys, repository-external release private keys, and explicit
  rotation. Separate upstream source artifacts from distributable artifacts.
  Reproducible conversions record source digests, locked build environment,
  recipe and version, output digest, notices, and parity evidence.
- Keep Spleeter and Demucs as historical blocked evidence rows and remove them
  from the offered catalog. Use these admitted replacements:
  - Default separation: TIGER-DnR at code pin `9f18d4a10a7137e1ce8052cfb62215179f1287b6`
    and official model revision `b7a59560bbca10febbcd46fb01600f868e587f57`,
    labeled Dialogue / Music / Effects. Export the neural core reproducibly to
    ONNX and keep STFT, ISTFT, and overlap-add in owned DSP.
  - HQ music stems: MERL Embracing Cacophony at
    `767e9a5b97a57b94d6ef752a757a561e8bdcf2cc`, converted reproducibly to
    ONNX and offered only on Linux x64 with CUDA 12 after runtime warm-up and
    memory admission. Outputs are vocals, bass, drums, and other.
  - Accurate shot cuts: TransNetV2 at
    `85cef72af9a916bdfd7cc94a670c9cdfbf12d1ed`, using its official
    TensorFlow-to-PyTorch conversion followed by a project-owned ONNX export.
    TensorFlow, PyTorch, and ORT logits and boundaries must pass parity.
  - Excitement tagging: official PANNs Cnn10, converted to ONNX with the
    AudioSet class map and CC-BY attribution.
  - Beats and downbeats: Beat This! `small0.ckpt` as the CPU default and
    `final0.ckpt` as an optional quality pack, both exported reproducibly to
    ONNX with official preprocessing and postprocessing.
  - Editorial generation: the first-party Qwen3-4B Q4_K_M GGUF through pinned
    llama.cpp in non-thinking, schema-grammar mode with a 16 GiB RAM floor.
- Complete the baseline catalog with the official wav2vec2 English aligner
  needed for Whisper timing. Extra low-disk Whisper, GTCRN, and RNNoise tiers
  are catalog variants, not activation gates.
- Package authenticated, isolated runtime families: Sherpa, CPU ONNX Runtime
  for all five release targets, a fixed-argument/no-shell Whisper CLI, and a
  separately bounded llama.cpp helper. Optional DirectML, CoreML, and CUDA
  providers require their own manifest and runtime canary; WebGPU is not
  admitted.
- Finish capacity preflight, resumable and cancellable downloads,
  external-deletion reconciliation, copy-verify-swap model-directory
  relocation, offline pre-seeded installs, garbage collection, and installed
  model notices.
- Publish immutable `models/<id>/<version>/<file>` objects to the existing EU
  R2 bucket through scoped credentials, GET/HEAD Range CORS, and digest/readback
  verification. Model bytes stay outside ASAR and the Pages bundle.

## Project state and public interfaces

- Serialize schema work as Soundscaper V29 to V30, then Framescaper V28 to V31.
  Add each selected generation everywhere its predecessor participates in
  inherited schema predicates, controllers, storage handshakes, archives,
  libraries, and compatibility reports.
- Add a bounded top-level `assistanceAssets` collection and register
  `org.soundscaper.capability.assistance-assets` for both selected products on
  web and desktop. Initially admit only closed `transcript-v1` references with
  a content-addressed key, MIME type, size, SHA-256, source ID/digest/range,
  optional video timing digest, recipe/version, and exact model-artifact
  digests.
- Store canonical word timing, confidence, language, and speaker data in
  authenticated external transcript bodies. Whole reruns replace the relevant
  transcript set. History, reopen, duplicate, managed handoff, and `.scape`
  custody retain the bodies; a missing or corrupt body disables that result
  without blocking the project. AUP4 reports transcript omission explicitly.
- Keep embeddings, OCR/tag indexes, shot tables, saliency/tracker state, and
  ranking checkpoints in a project-isolated disposable derivative repository.
  Accepted reframes use the existing crop/transform/keyframe authority and 9:16
  export path; enhancement and stems remain ordinary derived audio sources.
- Extend `soundscaperDesktop.v1` and `framescaperDesktop.v1` additively with
  model status/install/cancel/remove/relocate, staged input streaming,
  run/cancel, output claim/read/release, and correlated progress subscription.
  No renderer request contains a filesystem or module path.
- Use one closed operation union for transcription, VAD, alignment,
  diarization, enhancement, separation, tagging, beats, embeddings, OCR, shot
  detection, subject detection, saliency, and editorial generation. Large
  inputs and outputs travel through MessagePorts or digest-bound claims instead
  of the 64 KiB control wire.
- Bind every job to the exact project revision, sequence, selected occurrence,
  source digest/range, link membership, and timing/warp/retime authority.
  Revalidate before proposal publication and acceptance. Stale, reverse, or
  ambiguous nested/multicam cases refuse rather than approximate.
- Every workflow produces a session proposal. Reject and cancel make no
  mutation; accept commits ordinary commands and any transcript reference as
  one undoable batch, rolling back staged bodies on failure.

## Product workflows and rollout

- Add only menu-reached UI. `Tools -> Local Models -> Manage Models...` is
  always discoverable in desktop builds. `Analyze -> Local Assistance` opens
  lazy product-specific consent/configuration, proposal-review, and search
  dialogs. Downloads never begin implicitly, and no permanent toolbar, panel,
  badge, or qualification warning is added.
- Activate 7A in order: transcription/captions, filler and silence proposals,
  diarization, enhancement/separation, semantic transcript search, then beat
  and tempo suggestions.
- Activate 7B in order: FFmpeg and TransNet shot markers, SigLIP/OCR visual
  search, YuNet/D-FINE/ByteTrack/U2Net reframe proposals, deterministic
  highlight assembly with PANNs and embeddings, optional Qwen titles/reranking,
  and the existing vertical-delivery path.
- Framescaper acceptance uses V31 annotations, caption tracks, sequences,
  clips, and crop/keyframe commands. Soundscaper acceptance uses labels, range
  edits, tempo suggestions, and derived sources.
- Activate 8A after V31 lands: set `framescaperCapture` true in the Framescaper
  profile and production inventory; add
  `framescaperCaptureRouteSchemaVersion: 31`; admit V31 in the capture binding,
  composition, and runtime-probe predicates while retaining historical
  18/19/20 handling. Keep capture default-hidden and menu-opt-in, with no device
  enumeration or permission prompt before user action. Preserve standalone
  origin/focus/grant checks, embedded denial, exact source grants,
  pause/resume/stop/recovery, proxy scheduling, reopen, and cleanup.
- Leave `framescaperWebVcr` false. Assistance never consumes live capture;
  stopped and persisted capture may be analyzed later.
- Land atomic staged commits in this order: plan; model policy and manager; job
  and runtime substrate; S30 and 7A slices; F31 and 7B slices; M8A activation;
  evidence and documentation closure. Flip each slice only after automated hard
  gates pass; never consult manual qualification for admission.

## Verification and evidence

- Test signed-catalog admission, converted-artifact provenance, downloads and
  relocation, notices, helper containment, malformed messages,
  crash/restart/quarantine, output claims, and cancellation p95 at or below two
  seconds.
- Compare source-framework and ONNX outputs. Run packaged real-model smokes for
  Sherpa, ORT, Whisper, llama.cpp, and the Linux/CUDA HQ path; unsupported
  combinations must return typed unavailable states.
- Cover S29-to-S30 and F28-to-F31 reimport, strict validation, transcript body
  authentication and retention, history and `.scape` round trips, web read/edit
  without inference, orphan cleanup, and AUP4 omission reporting.
- Cover every 7A/7B proposal, reject/accept/undo, exact occurrence mapping,
  linked A/V ripple, VFR/retime mapping, stale-result refusal, search
  cancellation, crop-correct 9:16 output, and byte-stable unaffected exports.
- Restore and adapt the full capture browser suite to V31: default-hidden/menu
  opt-in, no implicit permission, embedded denial, all source combinations,
  four-stream recording, pause/resume/stop, background-origin refusal,
  source-ended recovery, proxy completion, import, reopen, and failure cleanup.
- Run the real M7 privacy fixture with two selected and two unselected assets;
  require zero post-install network requests, zero unselected bytes read, zero
  accepted digest mismatches, cancellation p95 at or below two seconds, and zero
  canonical-state losses.
- Keep M7 and M8A owner environments unprovisioned and qualification evidence
  pending; do not fabricate accepted evidence. Update roadmap, milestone plans,
  and policy registers truthfully. Run policy-narrative synchronization,
  documentation reference generation, and runtime-evidence repinning in that
  order before their checks.
- During development run `npm test` after helper work, `npm run build` after UI
  work, focused browser tests for each workflow, then `npm run test:browser` and
  canonical `npm run check` before final handoff.

## Fixed assumptions

- Full Milestone 7 means every 7A and 7B workflow is active with its selected
  baseline model. Optional size or acceleration tiers remain conditional on
  installation and hard hardware/runtime admission.
- Manual qualification remains visible only in documentation and diagnostics;
  users see ordinary availability, consent, integrity, and hardware errors.
- Existing user-owned work is preserved and reconciled rather than reset.
