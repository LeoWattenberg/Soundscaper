# Milestone 7 plan: optional local assistance

> Owning source for milestone-7 sequencing, the runtime and model-catalog
> decisions, the assistance-lifecycle invariants, and the bounded work
> packets. The [roadmap](../roadmap.md#7-optional-local-assistance) owns
> scope and status; the licensing policy, threat model, and quality budgets
> own their claims. Grounded against the repository, the kw.media WASM
> post-mortem, and the August 2026 local-model landscape on 2026-08-11
> (five repo briefs with file:line verification, four externally sourced
> model-landscape briefs). Model licenses and sizes cited here were
> source-verified on 2026-08-11 and must be re-verified against the pinned
> artifact when each model is actually cataloged.

**Activation status (2026-08-27):** the complete optional workflow layer is
implemented on selected Soundscaper S30 and Framescaper F31. A versioned
`AssistanceWorkflow` contract supplies a closed workflow ID, aggregate fence,
slotted claims, exact model bindings, guided recipes, all fifteen Advanced
primitive recipes, main-owned consent, stage progress, strict semantic review,
disposable derivative custody, and ordinary undoable publishers. Existing
authenticated Parakeet, Silero, diarization, cleanup, and model-free fast-shot
routes stay active. Conditional workers and owned deterministic stages cover
Whisper/wav2vec2 alignment, enhancement, TIGER separation, PANNs reactions,
Beat This, TransNetV2, nomic/SigLIP embeddings, OCR, subject/saliency reframe,
deterministic highlights, and bounded optional Qwen editorial JSON.

Both ASR choices consume the exact reviewed VAD stage. Automatic-language
Whisper preserves the optional alignment stage and the worker admits wav2vec2
only after detecting English. Long DeepFilterNet/TIGER media is spooled through
bounded channel-preserving chunks under one whole-selection fence. Review
assets are incrementally hashed and bound to their exact stage and slot;
cleanup audition is mutation-free, reframe/highlight crops are editable, and
accepted reframe evidence, indexes, saliency/tracker state, and ranking
checkpoints remain available for authenticated deterministic reuse. Accepted
Qwen augmentation is reduced to bounded inert title/hook/chapter/explanation
metadata; raw and unselected output never enters `.scape`.

That is conditional implementation, not a packaged production-activation
claim. A hash-locked CPython 3.12 conversion/parity runner now exists for
TIGER, PANNs, Beat This `small0`, and TransNetV2, but no converted artifacts or
live parity evidence are retained; their externally signed catalog entries do
not exist.
Every target payload for ONNX Runtime 1.29.0, whisper.cpp v1.9.3, and llama.cpp
b10509 is `pending-external`, and Sherpa still lacks a Windows-arm64 Node
addon. Live EU R2 publication/full-digest public read-back, five-target
packaged canaries, and owner-lab qualification are also absent. Each affected
workflow fails closed only when its exact signed catalog entry, model artifact,
runtime payload, platform, selected-media authority, storage, consent, or
external-FFmpeg machine admission is unavailable; no substitute inference or
implicit download is allowed. Licensing and owner-lab review are reported by
milestone 9 and block stable 1.0 admission, not build, packaging, catalog
visibility, or testing.
Low-disk Whisper, GTCRN/RNNoise, CUDA Cacophony, GPU execution providers, and a
fine-tuned highlight classifier remain research/watch items outside this
delivery, not hidden prerequisites.

## Goals and ordering principle

1. **Primary: users must not hit trouble.** No network request after a
   model is installed, no bytes read from media the user did not select, no
   AI result applied without an explicit accept, no license-trapped weight
   distributed, no model download that bricks storage or rides an app
   update, no hallucinated caption or cut silently committed, and no
   degradation of deterministic editing when assistance is absent, removed,
   or crashed.
2. **Secondary: assistance never becomes a dependency.** Milestone 7 stays
   `optional` (docs/quality-budgets.md:42) and skippable (roadmap.md:195).
   Every feature lands as a proposal surface over the ordinary command and
   derived-asset models; deleting every model leaves a complete editor.

Work is ordered by trust, not by demo value. The irreversible decisions —
which weights we may legally redistribute, where multi-gigabyte files
live, and how untrusted native inference is isolated — land first, once,
under review, before any feature packet begins. This mirrors the
milestone-3 discipline of serializing the foundation and parallelizing the
features (docs/milestone-3-plan.md:76-85).

## What the kw.media experiment settled

The sibling project kw.media shipped whisper.cpp compiled to WASM in the
browser (`src/lib/tools/whisper-subtitle-generator.js`,
`public/whisper-transcription-worker.js`). The post-mortem identified the
failure modes this plan is required to eliminate, not merely soften:

- **Model load took forever.** The 60 MB model streamed through JS arrays
  into an Emscripten MEMFS copy on every page load — ~120 MB of transient
  buffers before inference began, even warm. Native runtimes mmap model
  files from disk; a warm load is sub-second and a resident helper process
  makes repeat jobs free.
- **Transcription ran slower than the media.** Pthread WASM required
  cross-origin isolation (a header-forging service worker plus a forced
  page reload), thread count was never configured, and no GPU path
  existed. Native inference with real threads is an order of magnitude
  faster on CPU; Metal/Vulkan/CUDA are additionally available.
- **Only the tiny-model tier was viable, and its output was unusable.**
  The web version hardcoded `ggml-base-q5_1` (~60 MB) with a 30-minute
  input cap. Once download-once and native speed exist, the 0.5–1.5 GB
  quality tier becomes the default and quality stops being the compromise.
- Structural defects to design out, not repeat: results scraped from
  stdout instead of a segment API, no cancellation message in the job
  protocol, no transcription progress, runtime fetched from a CDN at
  inference time despite an offline privacy claim, and missing third-party
  attribution for the model and runtime.

**Decided by the user on 2026-08-11:** downloaded models are stored
persistently in a **user-settable directory on the real filesystem** —
plain, individually deletable, inspectable files. Browser storage
(localStorage, IndexedDB, OPFS) is explicitly rejected as a model store.
The user also set the platform direction: with model sets this large,
milestone 7 is expected to be Electron-only in practice.

## Platform decision: Electron-first

Roadmap §7 claimed **Web Enhanced / Electron Enhanced — Optional** until
2026-08-11, when the user approved this plan's re-scope and the
re-tiering to **Electron Only — Optional** landed (roadmap.md:754).
Electron Enhanced is deliberately not claimed: that tier presupposes a
web outcome a native adapter merely improves (roadmap.md:149), and this
plan ships no web inference at all:

- Inference runs natively in an Electron helper process. No WASM inference
  ships in the web tier in milestone 7. The Web Enhanced obligation of a
  documented Web Core fallback (roadmap.md:148) is deliberately dropped;
  the Electron Only contract — "projects still open safely on web"
  (roadmap.md:150) — is supported structurally by the S30/F31 reference
  schemas and result-domain primitives. Explicit acceptance of a reviewed
  Parakeet transcript now publishes only an ordinary label-track command and a
  strict external-body reference that the web products can retain and edit like
  other project state; the web products cannot run new analysis.
- The user-settable model directory requires arbitrary filesystem access
  no web origin has, and the model tiers worth shipping (0.5–2.5 GB) are
  outside sane browser-storage budgets. The kw.media post-mortem shows the
  browser path fails on speed and quality even when storage is solved.
- **Roadmap edit, deliberate and bounded — landed 2026-08-11:** the tier
  label (roadmap.md:754), the §7 dependency note recording the
  helper-contract convergence stance below, and the plan-delegation
  lines in "How to use this roadmap" and §7 all landed with this plan,
  preserving the `#7-optional-local-assistance` anchor, which is
  referenced by `config/quality-budgets.json:828,1059` and
  `config/production-licensing-matrix.json:342` (roadmap.md:961) and
  verified by `tests/roadmap-guidance.test.js`. Dropping a promised
  platform tier is a scope revision and follows the milestone-2
  precedent of an explicitly user-approved revision (roadmap.md:285-288);
  the user approved on 2026-08-11. WP-7.0.0 retains the licensing
  enactment.
- A future web tier is not foreclosed: the threat model already templates
  WASM inference under `reviewed-web-effect-packages`
  (docs/production-threat-model.md:1004). It would be a new, separately
  gated milestone item, not a milestone-7 obligation.

### Rejected alternatives across all decisions (recorded to prevent re-litigation)

| Alternative | Why rejected |
| --- | --- |
| In-renderer WASM inference (whisper.cpp WASM, transformers.js, onnxruntime-web) | kw.media post-mortem: COI service-worker tax, no thread control, model double-buffering, tiny-model quality ceiling, CDN fetch at inference time. Fails the load-time, speed, and quality bars simultaneously. |
| Python sidecar (faster-whisper, WhisperX, pyannote.audio) | A second language runtime to package, sign, and sandbox on three OSes; no repo precedent; every capability it uniquely offers has a native-or-ONNX equivalent. |
| Native inference in `worker_threads` | A native crash in a worker thread kills the whole editor; Electron history is littered with context-aware addon failures. Helper processes contain crashes by construction. |
| Bundling models into the installer | Violates the separately-downloaded rule (roadmap.md:760-761) and the bundle ceilings (roadmap.md:101-103); breaks the removable/opt-in contract; bloats auto-update. |
| Browser storage as the model store | Rejected by the user 2026-08-11 ("not the black box that is localstorage"); quota- and eviction-bound; invisible to the user. |
| Cloud inference as the default path | "Mandatory cloud accounts … or hosted AI" are outside completion requirements (roadmap.md:109); selected media must remain on-device (roadmap.md:764). Descript's cloud-only architecture is the counter-precedent, and its forums ask for exactly the local mode we are building. |
| One multimodal audio-LLM for everything (Voxtral-Mini class) | Below realtime on laptop CPU and emits no word-level timestamps — disqualifying for filler removal and caption karaoke. |
| CrisperWhisper for verbatim/filler detection | Exactly our use case, but CC-BY-NC / paid commercial license. Replaced by Parakeet v2's community-verified filler retention and native word timestamps plus a filler lexicon, gated by a planted-filler fixture. |

## Runtime decision

The plan evaluated four inference runtimes, staged so no packet integrates more
than one new runtime at a time. Sherpa remains production-admitted for exact
Parakeet speech recognition, Silero VAD, and paired pyannote/ERes2Net
diarization. The other three families now have isolated conditional hosts,
workers, authentication, memory admission, crash quarantine, and termination
cancellation; none is package-admitted until its exact five-target payload row
closes. GTCRN/RNNoise and GPU execution providers are excluded. Admitted
external FFmpeg fast-shot execution is a separate model-free editor runtime,
not a fifth inference family:

1. **sherpa-onnx-node (Apache-2.0)** — the speech pipeline: Silero VAD,
   Parakeet ASR with per-token timestamps, speaker diarization
   (segmentation + embedding + clustering), GTCRN enhancement, and source
   separation, behind one actively maintained N-API addon with prebuilt
   darwin-x64/arm64, linux-x64/arm64, and win-x64 packages. Its model
   catalog is republished as versioned, unauthenticated GitHub release
   assets — the cleanest digest-pinnable source in the field. Known gap:
   **no win-arm64 prebuild** (onnxruntime-node and node-llama-cpp both
   have one); Windows-on-ARM either gets a self-built binary or reports
   the capability as unavailable.
2. **whisper.cpp via spawned per-platform `whisper-cli` (MIT)** — the
   multilingual long tail (~99 languages) through the pinned v1.9.3 CPU
   baseline. Spawning the CLI is chosen over the
   binding ecosystem deliberately: the best-designed binding
   (smart-whisper) is abandoned, and a CLI segfault cannot take a process
   we own with it. whisper.cpp 1.9.0 added Parakeet support (PR #3735)
   and integrates Silero VAD (the VAD model is a separate download), so a
   future consolidation to fewer runtimes is plausible — re-verify its
   maturity at pickup.
3. **onnxruntime-node (MIT)** — the CPU vision/audio stack (shots, faces, persons,
   saliency, SigLIP 2, OCR) and the wav2vec2 aligner. N-API, so no
   electron-rebuild. Only the CPU execution provider is admitted by this
   delivery; package installation must suppress any CUDA-provider download.
4. **llama.cpp (MIT)** — the optional Qwen editorial tier, pinned to b10509,
   with no renderer use and grammar-constrained JSON. Nomic embeddings use the
   cataloged ONNX export, so transcript and visual search do not depend on this
   optional 16 GiB-RAM family.

### Process architecture

- All inference runs in an **assistance helper** started as an Electron
  `utilityProcess` — full Node with native addons, crash containment (an
  `exit` event, not a dead editor), and `MessagePortMain` wiring for
  progress streams. Each Sherpa, ONNX Runtime, whisper.cpp, and llama.cpp
  family is lazy and isolated; main authenticates the exact runtime and model
  closure before spawning it, and a dedicated inference worker is the only
  context that imports native code. Model-free fast shots instead use the
  separately admitted fixed-command external-FFmpeg runtime; that route grants
  no generic subprocess authority. Main owns the helper lifecycle,
  heartbeats, cancellation deadline, RSS sampling, and exact file grants; no
  renderer receives spawn, binary, or filesystem-path authority. The threat
  model retains `native-helper-processes` as partial because process separation
  is crash containment rather than an operating-system sandbox and external
  qualification remains open.
- **IPC data discipline:** selected input bytes cross the renderer boundary
  through a digest- and byte-length-bound MessagePort reservation into a
  main-private staging file. The renderer sees only opaque job/claim/stream
  identities. Main captures and hashes exact regular-file grants for the
  staged audio and authenticated model artifacts; the inference worker checks
  device/inode identity, size, and SHA-256 again before use. Results return as
  authenticated JSON claims over the reverse pathless data plane. Filesystem
  paths remain private to main and the helper.
- **Consent boundary:** the helper receives read access only to the
  specific persisted media the user selected for a job — mirroring the
  read-capability discipline the desktop protocol already enforces
  (bounded, path-verified, user-mediated reads; `desktop/main.mjs:384-403`,
  `desktop/preload.mjs:269-279`) — satisfying "assistance consumes only
  imported or persisted media" (roadmap.md:762-763) measurably:
  `assistance.unselectedMediaBytesRead eq 0`
  (config/quality-budgets.json:1053-1057).
- **Cancellation:** every model invocation must be abortable mid-run
  (whisper.cpp abort callback, ORT run termination, llama.cpp abort,
  chunk-boundary aborts for pipelined stages) because the budget pins
  `assistance.cancellationP95Ms lte 2000`. The existing conventions carry
  over: AbortSignal end-to-end and progress-reset deadlines via the worker
  request broker pattern (`src/common/editor/worker-request-broker.ts`).
- **Etiquette:** every assistance helper — the Sherpa speech process and each
  lazy runtime family — is dropped to background scheduling priority as soon as
  it exists, so CPU-only inference yields to the editor the user is driving. The
  runtime-family router additionally holds a new job while the machine runs on
  battery or reports serious or critical thermal pressure, resuming it when the
  condition clears and reporting a typed `power-deferred` result once the bounded
  hold budget elapses. A hold never touches a job that already started, and a
  power reading the host cannot supply admits rather than stalls. A family that
  has been quiet for two minutes releases its utility process, so nothing keeps
  gigabytes warm for a job that is not coming; the next job spawns it again, and
  an intentional unload is never recorded as a crash. Scrub-time throttling and
  user-facing pause controls remain future adapter work.

## Model catalog decision

This answers "what local models are we using." The application is
AGPL-3.0-only, so the selection criterion is not "permissive at any
cost": AGPL-compatible copyleft is legally acceptable, and the real bars
are (a) redistribution without additional restrictions — non-commercial
and research-only weights are excluded outright, since such terms cannot
ride inside an AGPL distribution — and (b) a stable, unauthenticated,
digest-pinnable source. Permissive weights are still *preferred* so the
model packs stay portable outside the AGPL boundary, and every entry
below is permissive or CC-BY. Each is a separately downloadable,
individually removable pack. Sizes are the shipped (quantized) artifacts.

The signed catalog is the authority for what the current product may offer. It
currently contains thirteen permitted entries: Silero VAD; Parakeet v2 and v3;
Whisper large-v3-turbo; pyannote segmentation; ERes2Net; DeepFilterNet3;
YuNet; D-FINE; U²-Net-P; PP-OCRv4 mobile; nomic-embed-text; and SigLIP 2.
Catalog presence permits authenticated install and custody, not execution.
The two Parakeet entries match the active Sherpa recognition adapter, Silero
matches the active VAD adapter, and pyannote segmentation plus ERes2Net form the
admitted diarization pair. Whisper, DeepFilterNet3, and the current
vision/semantic entries have conditional adapters, but those routes refuse with
typed unavailability until their authenticated target runtime payloads exist;
catalog presence alone never activates execution. The six supply candidates
additionally await external catalog signing, and the four converted candidates
await retained artifact/parity evidence. Fast shot detection is model-free and
relies on separately admitted external FFmpeg authority. The catalog's mirror
URLs and publisher describe the authorized distribution path, but this plan
does not claim the remote R2 objects have been uploaded or read back durably.

### Speech (7A primary)

| Task | Model | Disk | License |
| --- | --- | --- | --- |
| VAD / silence | Silero VAD v6.x (ONNX) | ~3 MB | MIT (pin commit; do not confuse with the CC-BY-NC silero-models repo) |
| ASR, English default | Parakeet-TDT-0.6b-v2 int8 (ONNX) | ~650 MB | CC-BY-4.0 |
| ASR, 25 European languages | Parakeet-TDT-0.6b-v3 int8 (ONNX) | ~640 MB | CC-BY-4.0 |
| ASR, ~99-language long tail | Whisper large-v3-turbo q5_0 (GGML) | ~550 MB | MIT |
| ASR, low-disk draft tier | Excluded from this delivery; no small/base model is cataloged | — | — |
| Word-timing realignment (EN, Whisper output only) | wav2vec2-base-960h (ONNX) | ~360 MB | Apache-2.0 |
| Diarization segmentation | pyannote segmentation-3.0 (ONNX, sherpa mirror) | ~6 MB | MIT (upstream HF-gated; mirror the sherpa asset, never the gated URL) |
| Speaker embeddings | 3D-Speaker ERes2Net | ~30 MB | Apache-2.0 |

Parakeet is the primary, not Whisper: ~10–20x realtime on laptop CPU
(a 3-hour VOD in ~10–15 minutes) and **native word/segment timestamps**.
Community testing also shows the English v2 model retains disfluencies
("um", "uh") — undocumented by NVIDIA, and not reliably true of v3's
polished multilingual output — so a planted-filler fixture gates which
models 7A-2 may run against. Whisper is trained non-verbatim — it drops
the very filler words 7A-2 needs to find — and its DTW word timings
jitter 100–400 ms; it remains the long-tail language fallback with the
wav2vec2 aligner cleaning up English word timing when karaoke-grade
output is needed from it.

### Cleanup and music (7A)

| Task | Model | Disk | License |
| --- | --- | --- | --- |
| Denoise, 48 kHz quality | DeepFilterNet3 (ONNX) | ~10 MB | MIT/Apache-2.0 dual |
| Denoise, lower-cost alternatives | GTCRN and RNNoise are excluded from this delivery | — | — |
| Stem separation, default | TIGER-DnR neural cores (ONNX) with owned STFT/ISTFT/overlap-add; Dialogue/Music/Effects | pending converted artifacts | MIT code and weights |
| Refused historical separators | Spleeter and Demucs v4 `htdemucs` | — | unresolved weight grants; absent from offered catalog |
| Audio tagging (laughter/applause/cheer) | PANNs Cnn10 (ONNX) with pinned 527-class AudioSet map | pending converted artifact | Apache-2.0 code / CC-BY-4.0 weights |
| Beat/downbeat | Beat This `small0` CPU baseline; optional `final0` quality pack | pending converted artifacts | MIT code and weights |

### Vision and semantics (7B)

Reviewed, pinned and verified on 2026-08-13; the review, the departures
from the candidates first listed here, and the verification method are in
`docs/milestone-7-video-model-evidence.md`. Sizes below are the pinned
upstream bytes, not estimates.

| Task | Model | Disk | License | State |
| --- | --- | --- | --- | --- |
| Shot cuts, fast mode | ffmpeg scene score (`scdet`) | 0 (pinned ffmpeg) | existing posture | no model needed |
| Shot cuts, accurate mode | TransNetV2 | pending converted artifact | MIT upstream | owned TF→PyTorch→ONNX runner exists; live three-runtime parity and catalog signing pending |
| Face detection | YuNet 2026may (ONNX) | 0.22 MiB | MIT | pinned |
| Person/object detection | D-FINE-N COCO (ONNX) | 14.6 MiB | Apache-2.0 | pinned |
| Track interpolation | ByteTrack/OC-SORT (algorithm port, no weights) | 0 | MIT code | no weights |
| Saliency fallback | U²-Net-P (ONNX) | 4.4 MiB | Apache-2.0 | pinned |
| Semantic tags + frame search | SigLIP 2 base patch16-224 int8 (ONNX, ungated) | 393.3 MiB both towers with tokenizer | Apache-2.0 | pinned |
| On-screen text (overlays, game UI) | PP-OCRv4 mobile via RapidOCR (ONNX) | 15.5 MiB with dictionary | Apache-2.0 | pinned |
| Transcript embeddings | nomic-embed-text-v1.5 (ONNX, not GGUF) | 131.6 MiB | Apache-2.0 | pinned |

Pinning the first-party ONNX export of the embedding model rather than its
GGUF build takes llama.cpp off the semantic-search path; the optional
editorial LLM below still needs a GGUF runtime at 7B-4.

### Optional editorial LLM (7B-4, separate opt-in pack)

| Task | Model | Disk | License |
| --- | --- | --- | --- |
| Titles, hooks, chapter names, highlight re-ranking with schema-constrained JSON | Qwen3-4B Q4_K_M (GGUF) | 2.5 GB | Apache-2.0 |

Gated to ≥16 GB RAM machines; Gemma 4 E4B (Apache-2.0 since April 2026)
is the fast-follow alternative. Evidence stance: the Rhapsody study
(arXiv 2505.19429) found zero-shot frontier LLMs weak at highlight
*ranking* — GPT-4o landed at the level of a frequency baseline, and even
the best zero-shot model trailed a small fine-tuned classifier by a wide
margin — so the always-available ranking engine is heuristics +
embeddings and the LLM pack earns its disk with *generation* (titles,
hooks, chapters) and explanation. A small
fine-tuned highlight classifier is the research-grade follow-up, recorded as a
watch item, not a dependency.

### Excluded weights (license traps, recorded so nobody re-imports them)

InsightFace/SCRFD/ArcFace weights (non-commercial despite MIT code),
CrisperWhisper (NC), Meta MMS forced aligner and every ONNX re-export
(CC-BY-NC), NVIDIA Sortformer diarization (CC-BY-NC), original canary-1b
(CC-BY-NC; the -flash/-v2 refreshes are CC-BY-4.0 but unneeded), madmom
models and BeatNet (CC-BY-NC-SA), Open-Unmix umxhq/umxl weights
(CC-BY-NC-SA), Essentia models (CC-BY-NC weights; their AGPL code alone
would be compatible), TEN VAD (Agora non-compete clause), BS-RoFormer
community checkpoints (no per-file licenses), BEATs checkpoints
(OneDrive-only hosting, unilm per-model license precedent), Gemma 3
(custom terms with remote-restriction clause; only Gemma 4 is Apache),
Llama 3.2 (gated download, naming/attribution/AUP flow-down, EU
distributor exclusion on multimodal), NV-Embed/SFR embeddings (NC).
`enableRequires` on the `local-models` gate demands per-model license and
provenance records (config/production-licensing-matrix.json:339-342);
this table is the seed of that review, not its substitute.

**Ultralytics YOLO is deliberately not in that list.** Its AGPL-3.0
dual-licensing is the industry's canonical trap for closed-source apps,
but this application is itself AGPL-3.0-only, so YOLO code and weights
are license-compatible and usable in principle. It is not chosen on
technical grounds: D-FINE-class Apache detectors match it at equal or
lower CPU cost with ONNX-ready first-party exports and no Python export
toolchain, and permissive weights keep the model packs reusable outside
the AGPL boundary without leaning on Ultralytics' legally untested
weights-are-derivatives theory. Recorded so the exclusion is not
re-litigated as a license question.

## Model lifecycle decision

This answers "how are we shipping them."

- **Store:** a content-addressed blob store in a **user-settable models
  directory** — default `<userData>/models`, changeable in settings, shown
  as a plain path the user can open, with per-model folders/manifests and
  `blobs/sha256-<hex>` files (the Ollama layout). Moving the directory is
  a supported operation (copy-verify-swap, never silent re-download).
  Models never live in the asar, the install directory, or any
  auto-update channel; an app update ships a new catalog, never model
  bytes. Manifest compatibility keys (GGUF version, ORT opset) let an app
  update mark a model stale instead of silently breaking it.
- **Catalog:** a versioned, signed catalog manifest ships with the app:
  model id → version, download URL, byte size, SHA-256, license id,
  attribution text, capability requirements (RAM floor, platform), and
  the licensing-evidence pointers milestone-9 stable 1.0 admission reports.
  Machine activation depends on the signed entry, exact artifact, platform,
  and runtime compatibility, not completion of that human review. The catalog
  is data, so adding a model is a catalog change, not a code change.
- **Downloads:** user-action-only, size-bounded, digest-verified,
  resumable (HTTP Range + streamed SHA-256, atomic rename on completion),
  cancellable, with capacity preflight — the exact pattern the verified
  Web FFmpeg runtime download already established
  (docs/production-threat-model.md:1336-1354;
  `src/common/offline/ffmpeg-runtime-cache.ts` is the transactional
  precedent, rebuilt for multi-GB bounds and filesystem storage; desktop
  statfs preflight precedent in `desktop/project-library-media-capacity.ts`).
  Known residuals from that review (no independent authenticity root,
  hard-coded versions) are narrowed rather than inherited: the catalog is
  the version authority, digests pin every blob, and the catalog's own
  signing scheme (authority, pinned verification key, rotation) is a
  named WP-7.0.1 design item — at minimum it inherits the application's
  signing chain.
- **Hosting target:** an artifact may be published to a first-party bucket
  behind our domain (Cloudflare R2: zero egress, Range support) only through
  the separately credentialed, digest/read-back-verified publisher. The current
  activation records intended object identities but no accepted durable R2
  upload/read-back evidence. Upstream
  Hugging Face `resolve/{commit}` and GitHub release URLs are provenance
  sources recorded in the catalog, never the shipped download path —
  HF gates, renames, and CDN-host changes make it a source, not a
  distribution channel.
- **Removal:** per-model Remove deletes the manifest and garbage-collects
  unreferenced blobs; removing the last model leaves the editor complete.
  "Removable" is user-visible: the files are inspectable and deletable in
  a file manager without breaking the app.
- **Notices:** each blob carries its license text next to it; the About /
  licenses surface lists every installed model with its attribution
  (CC-BY-4.0 entries — the Parakeet and PANNs weights — have a hard
  attribution duty). This is the versioned offline notice delivery
  the licensing policy demands (docs/production-licensing-policy.md:148-149,
  157-171), and it fixes the attribution debt kw.media never paid.
- **Offline:** after install, zero network use. No JS-level flag can
  bind native code, so this is enforced, not asserted: the privacy
  workload observes `assistance.networkRequestsAfterInstall eq 0`, the
  pinned runtimes' network behavior is audited in supply-chain review,
  outbound blocking applies where an OS mechanism exists, and the
  residual — helper code is trusted code, not a sandbox
  (docs/production-threat-model.md:998) — is recorded in the WP-7.0.2
  threat-model revision.

## Assistance results model

- **Propose, then commit.** Every feature produces a reviewable proposal
  (ranked candidate clips, a cut list grouped by type, a label set, a
  crop path). Nothing touches the document until the user accepts;
  accepting commits ordinary commands through the single mutation path
  (`src/common/editor/controller/project-mutation-service.ts:140-161`),
  so AI edits are inspectable in history and undo like any other edit
  (`src/common/editor/history.js`). Precedents to reuse, not reinvent:
  `persistNyquistLabels` commits a label batch
  (`src/common/editor/controller/nyquist-host-service.ts:234-259`);
  `prepareDisjointRangeDeleteCommand` merges N ranges into one
  right-to-left simulated ripple batch
  (`src/common/editor/commands/range-runtime.js:234-257`) — exactly the
  filler-cut shape; three-point `edit/insert`/`edit/overwrite` placements
  are the clip-assembly shape (`src/common/editor/commands/protocol.ts:249-270`).
- **Two persistence classes.** *Derived assets* (transcripts with
  word-level timing, speaker turns, confidence) are user-valuable and
  persist through the derived-source/derived-record machinery
  (`src/common/editor/controller/derived-source-service.ts:52-60`),
  following the digest-bound external-asset pattern the VFR timing
  contract established for bulk data that must not bloat the document.
  *Disposable derivatives* (frame/transcript embedding indexes, shot
  tables, saliency maps) are rebuildable and live under the existing
  derivative eviction policy
  (`src/common/editor/storage/derivative-cache-policy.ts:22-26`). Any new
  persisted document state registers a capability atomically with both
  product profiles initially unavailable, per the standing rule
  (docs/milestone-3b-work-packets.md:38-42; schema-addition duties at
  roadmap.md:922-924). Availability of these document types is then
  keyed to reading and editing the persisted results — a workflow both
  products can pass on both platforms — never to inference being
  runnable; otherwise assistance-touched projects would open read-only
  on web, contradicting the platform decision.
- **Where results land today vs. later.** Transcription lands as label
  tracks now — labels already round-trip SRT/VTT/TXT
  (`src/common/editor/label-io.js`) — and re-targets the milestone-4
  styled caption schema (roadmap.md:611-612) when it exists; word-level
  timing and speakers ride the transcript derived asset either way, so no
  data is lost by landing before milestone 4. Shot markers use timeline
  annotations, which exist but are Soundscaper-only today
  (`src/framescaper/product.js:26`); enabling them for Framescaper is a
  pickup contract for 7B-1 (the trackFolders per-product activation is
  the precedent). Reframe output stays proposal-side — no spatial
  transform primitive exists today ("transform, crop" is milestone-4
  document scope, roadmap.md:601-602) — and drives the 7B-5 export crop
  stage directly; it migrates onto milestone-4 transforms and keyframes
  when those land.
- **Discovery:** every assistance feature is reachable through menus,
  gated behind capabilities defaulting off, with no new always-visible
  surface (AGENTS.md:8-11; menu model + product filter in
  `src/common/editor/ui/application-menus.js`,
  `application-menu-product-filter.js`). The model manager itself is a
  menu-reached dialog. Assistance jobs surface through the existing task
  progress coordinator with a new task kind
  (`src/common/editor/controller/task-progress.ts:3-12`).

## Feature compositions

This answers "how do the models combine." Each composition is a pipeline
of the catalog above; every stage names its packet.

### Livestream clip maker (flagship, 7B-4)

Long VOD in, ranked short-clip proposals out, TikTok-shaped export.

1. Audio extraction to 16 kHz mono (pinned ffmpeg; the milestone-5 native
   FFmpeg helper later removes the wasm speed ceiling for multi-hour
   VODs) — 7A-1.
2. VAD → Parakeet transcription with word timestamps → optional
   diarization for speaker turns — 7A-1/7A-3.
3. Excitement signals: PANNs laughter/applause/cheering scores over 1 s
   windows, plus loudness/energy dynamics from the existing DSP analyzer
   (`src/common/editor/analysis.js`) — 7B-4.
4. Candidate segmentation and ranking: heuristic features (hook shape,
   speaker turns, question–answer structure, audio excitement, semantic
   self-containedness and novelty via nomic-embed) — deterministic,
   always available — 7B-4.
5. Optional LLM pass: Qwen3-4B re-ranks the top candidates and generates
   titles/hooks as schema-constrained JSON — 7B-4, optional pack.
6. Boundary snapping: TransNetV2 shot cuts and transcript sentence
   boundaries, so no clip starts mid-cut or mid-word — 7B-1.
7. Review: ranked proposals with transport preview; accepting builds a
   new sequence per clip through ordinary placement commands, with the
   transcript segment attached as labels — 7B-4.
8. Reframe to 9:16: YuNet faces + D-FINE persons + ByteTrack
   interpolation, U²-Net-P saliency where no people are found, AutoFlip's
   published logic (shots → signals → stationary/pan/track choice →
   smoothed crop) reimplemented in TS — per-shot crops carried as
   proposal data into the 7B-5 export stage first, persisted transforms
   and keyframed paths at milestone 4 — 7B-3.
9. Export: range-restricted MP4 via the existing export plan today
   (≤720p, `src/common/editor/video-export.js:21-23`); the vertical
   canvas and crop stage are bought early by 7B-5, and caption burn-in
   and platform presets remain milestone-6 delivery scope
   (roadmap.md:720-726).

### Podcast filler and silence cleanup (7A-2)

1. Parakeet v2 transcript with word timestamps (community testing shows
   v2 retains the fillers Whisper drops by training; the planted-filler
   fixture in 7A-1 gates which models qualify).
2. Disfluency detection: per-language filler lexicon ("um", "uh", "like",
   "you know"), immediate word repetitions, and VAD-measured silences and
   long pauses over thresholds.
3. Proposal list grouped by type with per-item audition and global
   sensitivity controls; nothing auto-applies.
4. Accept → one `prepareDisjointRangeDeleteCommand` ripple batch —
   inspectable, undoable in one step. Micro-fades at cut points are a
   pickup contract for the slice.

### Further compositions, each a thin layer over the same stages

- **Auto-captions and chapters (7A-1):** labels → SRT/VTT sidecar export
  exists today; Podcast 2.0 chapters JSON already exports from labels
  (`src/common/editor/label-io.js:63-97`).
- **Speaker labels (7A-3):** diarization turns → labeled regions;
  transcript segments gain speaker attribution.
- **Dialogue cleanup and stems (7A-4):** DeepFilterNet3 denoise and
  Spleeter/htdemucs stems render as ordinary derived sources the user
  swaps in — never destructive, and distinct from milestone-4's
  deterministic dialogue-cleanup chain, which remains complete without AI
  (roadmap.md:613-614, 678-679).
- **Semantic search (7A-5/7B-2):** "find where I said X / find the
  whiteboard shot" — transcript + frame embeddings in a local vector
  index (disposable derivative), fused into the existing palette search
  (`src/common/editor/search.js`), results as jump targets.
- **Beat suggestions (7A-6):** Beat This! beats/downbeats land as a label
  track for cut-to-music editing. No MIDI schema, no tempo-map rewrite by
  default — a tempo-map suggestion is a separate reviewed command, and
  the MIDI fence stays intact (roadmap.md:117-130).
- **Shot/silence detection (7B-1/7A-2):** the same VAD and shot stages,
  exposed directly as "mark silences / mark cuts" menu actions.

## Delivered so far

The current branch activates the bounded foundation rather than treating
manual sign-off as an execution switch:

| Area | Current implementation |
| --- | --- |
| Catalog and licensing | The authenticated Ed25519 catalog V2 retains thirteen admitted entries. Supply candidates now pin wav2vec2 and Qwen sources plus conversion recipes for TIGER, PANNs, Beat This, and TransNetV2, but none joins the executable catalog before converted-artifact/parity closure, versioned-download notices and hashes, and external signing. Unknown keys and artifact drift fail closed. Owner human licensing review is recorded in `config/production-legal-review.json`; the remaining artifact-specific gates are reported to milestone 9 and block stable 1.0 admission only. |
| Model lifecycle | A user-settable, content-addressed filesystem store supports capacity preflight, explicit resumable install, cancellation after quiescence, preseed, relocation by copy/verify/swap, removal, garbage collection, notices, and reconciliation after external deletion. **Tools > Local Models > Manage Models…** is lazy and desktop-only. No model is installed or repaired implicitly. |
| Native runtime | Sherpa ONNX 1.13.5 remains authenticated on linux-x64, linux-arm64, mac-arm64, and win-x64; its Windows-arm64 Node addon is pending. Isolated, supervised CPU-only family contracts, workers, memory admission, crash quarantine, and termination cancellation exist for ONNX Runtime 1.29.0, whisper.cpp v1.9.3, and llama.cpp b10509, but every five-target payload row remains `pending-external`. Fast shots retain the separately admitted external-FFmpeg path. |
| Job and data boundary | `AssistanceWorkflow` adds a closed workflow graph, one aggregate fence, versioned settings, slotted claims, exact model roles, stage progress, one main-owned consent authority, strict frame-pack/embedding formats, bounded semantic reviewers, and project-isolated disposable custody over all guided and fifteen Advanced recipes. Review media is incrementally hashed and bound to its exact stage/slot claim before native execution. Adapter-owned preprocessing preserves each model's required sample rate/channels; long media remains under one whole-selection fence. VFR and monotonic forward retimes use source-time authority; reverse, ambiguous nested, multicamera, and live inputs refuse. |
| Product state | Guided recipes and lazy review surfaces are menu-reached; Advanced exposes validated one-stage primitive recipes. Acceptance starts unselected, revalidates the aggregate fence, and reuses ordinary transcript, label, derived-source, annotation, tempo, sequence, crop, and keyframe commands. Disposable indexes, accepted reframe evidence, saliency/tracker state, and ranking checkpoints support deterministic reuse without a schema change. Raw/unselected Qwen output never enters `.scape`; only bounded sanitized editorial metadata belonging to an accepted proposal may be retained. |
| Implemented feature domains | Workers, deterministic preprocess/postprocess, reviewers, and publishers cover the full planned transcription/alignment, cleanup/diarization, enhancement/separation, reactions, beats, cuts, search/OCR, reframe, highlight, and editorial workflow set. Both ASRs consume reviewed VAD; auto-language alignment admits only detected English; long DeepFilter/TIGER runs spool bounded chunks; cleanup/audio/visual review is mutation-free and editable. Existing Sherpa and fast-shot routes are production-admitted; each new model-backed route remains unavailable in packages until its exact converted model, signed catalog entry, and authenticated target runtime arrive. |

Activation has four explicit boundaries:

1. **Implementation is not payload admission.** The full guided workflow and
   adapter layer exists, while verified Sherpa and model-free fast shots remain
   the only currently package-admitted execution baseline. A new route requires
   its exact externally signed catalog entry and authenticated target payload;
   absent evidence returns the corresponding typed unavailable result without
   substituting a model, runtime, or result.
2. **Catalog publication metadata is not upload evidence.** The mirror
   publisher streams upstream bodies to disk, stages large objects with
   resumable multipart upload, and requires HEAD, Range, and full public
   SHA-256 read-back before catalog output for external signing. This branch
   records no live R2 write or read-back. Explicit preseed remains a supported
   zero-network path; a missing object never permits an unpinned upstream fetch.
3. **Qualification is open but nonblocking.** The owner-qualified fixed-GPU
   environment remains unprovisioned for the M7 workload and there is no
   accepted external result. That state is disclosed as documentary evidence;
   it does not disable the bounded optional foundation or weaken any hard
   admission check.
4. **No result applies itself.** Assistance can read only explicitly selected
   persisted media under the aggregate fence. Every proposal starts unselected;
   acceptance revalidates source/range/timing/transcript/settings/model authority
   and commits an ordinary atomic project edit. Reject, cancel, stale authority,
   or failure produces no canonical mutation. Deterministic editing remains
   complete when runtimes, models, or assistance state are absent.

## Phase structure

| Phase | Mode | Content |
| --- | --- | --- |
| 7.0 | Serialized (one work stream) | Roadmap re-tiering, licensing enactment for the first model set, model manager and storage, assistance helper substrate, job/progress/consent integration, privacy evidence harness |
| 7A | Parallel track | Soundscaper-surface assistance: transcription, cleanup proposals, diarization, enhancement/stems, semantic search, beats |
| 7B | Parallel track | Framescaper-surface assistance: shots, frame semantics, reframe, clip maker, vertical-delivery lookahead |

The activation decision admits implemented 7A/7B slices once their hard
authenticity, artifact, selected-media, compatibility, and consent checks pass;
it does not wait for licensing, manual, or owner-lab review. An incomplete adapter
still refuses rather than bypassing those checks. The speech stack is shared:
7A owns the speech services and 7B consumes them read-only through their
published service interfaces; ownership stays file-disjoint per the
coordination rules below.

## Work packets

The 7.0 foundation packets are fully decomposed here; 7A/7B packets are
summarized against the same five fields (exit-evidence packets excepted)
and are decomposed into slice docs by the implementing agent at pickup,
before code, following the milestone-3 pattern
(docs/milestone-3-plan.md:467-470).

### WP-7.0.0 — Platform re-tiering and policy enactment

The licensing half is delivered in
[7.0.0a — local model evidence records](milestone-7-local-model-evidence.md),
implemented in commit `556fb258` on 2026-08-13: the gate's four
`enableRequires` slugs became the mandatory key set of a per-model
record, `blockedBy` and `distributionStatus` are derived from the
recorded statuses, the audio launch set and two upstream-ambiguous
models are recorded, and eleven refused weights are named with reasons. Later
evidence work completed every mandatory row for the thirteen models now in the
signed catalog; those rows derive `distributionStatus: permitted`, while
refused and incomplete candidates remain uncataloged. Versioned notice and hash
evidence authorizes distribution but is not proof that the catalog's R2 objects
were uploaded.

- **Outcome:** The roadmap re-tiering, dependency-note revision, and
  plan-delegation lines landed with this plan on 2026-08-11
  (user-approved). This packet owns the licensing evidence record: the
  `local-models` gate's per-model record covers weights and code license
  review, training-data provenance, model card and use restrictions, and
  versioned download notices and hashes
  (config/production-licensing-matrix.json:339-342). The human fields feed
  milestone-9 release admission, while signed catalog identity and artifact
  hashes remain machine-verifiable activation requirements. The first records
  authored for the launch set (Silero VAD, Parakeet v2/v3, Whisper
  turbo, pyannote segmentation, ERes2Net, DeepFilterNet3, Spleeter).
- **Invariants:** The `#7-optional-local-assistance` anchor is preserved
  (roadmap.md:961). Unknown, conflicting, or incomplete human license evidence
  is surfaced in milestone 9 and blocks stable 1.0 admission, never current
  catalog visibility or testing. No loader or capability flag bypasses signed
  catalog identity, exact artifact digest, runtime, platform, storage, or
  consent checks.
- **Acceptance:** Licensing matrix tests cover accept/reject paths for
  model evidence records; the landed roadmap edit keeps
  `tests/roadmap-guidance.test.js` green (verified 2026-08-11); notices
  render for a cataloged model in the About surface offline, which
  7.0.0a defers to the first slice that mirrors an artifact.
- **Non-goals:** No download code, no runtime, no UI beyond notices.
- **Stop condition:** Stop stable 1.0 admission if a launch-set model fails
  license review. Stop current execution only when signed catalog, artifact,
  runtime, platform, storage, consent, or selected-media checks fail.

### WP-7.0.1 — Model manager and storage

**Current status:** active. The outcome below is implemented, including the
signed-catalog rotation successor, complete lifecycle controls, and the lazy
desktop menu dialog. Remote mirror availability remains external to this
activation; explicit preseed is the authenticated offline path.

- **Outcome:** The user-settable models directory (default
  `<userData>/models`, settings-exposed, relocatable via
  copy-verify-swap); the content-addressed blob store with per-model
  manifests; the signed catalog; resumable digest-verified downloads with
  capacity preflight; per-model install/remove; a menu-reached model
  manager dialog listing state, size, license, and attribution per model.
  The catalog signing scheme — signing authority, pinned verification
  key, rotation — is a named design item of this packet.
- **Invariants:** Models are plain files the user can inspect and delete
  externally; the app self-heals from external deletion by re-marking the
  model uninstalled. Download is user-action-only and never implicit
  (docs/production-threat-model.md:1336-1354). Model bytes never enter
  the asar, the install dir, or auto-update. Digest mismatch quarantines
  the blob and reports; it never repairs silently
  (`assistance.acceptedDigestMismatches eq 0`).
- **Acceptance:** Kill/resume mid-download leaves either a resumable
  partial or nothing; a tampered blob is rejected with a typed error; a
  catalog with a missing or invalid signature is rejected with a typed
  error;
  relocation preserves every installed model or aborts whole; removal
  reclaims bytes and leaves the editor complete; offline installs from a
  pre-seeded directory work with zero network.
- **Non-goals:** No inference, no model execution of any kind, no
  auto-selection of models.
- **Stop condition:** Stop if any flow needs browser storage for model
  bytes, needs a network request outside an explicit user download
  action, or needs the store to rewrite a blob in place.

### WP-7.0.2 — Assistance helper substrate

**Current status:** active for verified Sherpa speech, VAD, and diarization,
plus the separately admitted model-free external-FFmpeg fast-shot route.
Utility-process supervision, runtime authentication, exact file grants,
progress, cancellation, Parakeet transcription, Silero speech ranges, and
pyannote/ERes2Net speaker turns exist. Whisper, wav2vec2, DeepFilterNet/TIGER,
the ONNX vision/semantic stack, and Qwen now have bounded conditional family
workers and deterministic adapters; every affected package route remains typed
unavailable until its exact signed model and authenticated target payload are
admitted. Long enhancement/separation processing uses bounded spooled chunks,
and cancellation terminates the worker/process rather than waiting for whole
media completion. Background scheduling priority applies to every assistance
helper; the runtime-family router additionally holds new jobs under battery or
serious thermal pressure and releases a family that has been quiet for two
minutes, while the bounded Sherpa speech paths keep the priority drop without
the hold.
External FFmpeg is user-configured and hard-admitted; it is not a bundled
assistance runtime or authority for other operations.

- **Outcome:** The assistance `utilityProcess` helper implementing the
  milestone-5 helper contract's first slice: versioned bounded IPC,
  explicit per-job capabilities (which model, which media, which output),
  heartbeats, structured progress, cancellation acknowledgement, crash
  quarantine and restart, low-priority scheduling with battery/thermal
  pause. sherpa-onnx-node integrated as the first runtime with Silero
  VAD as the proof model; spawned `whisper-cli` as the second runtime
  behind the same job protocol. The threat model's
  `native-helper-processes` section and the security matrix are revised
  in the same change that enables the surface — versioned protocol,
  binary verification, least-privilege platform policy, supervision,
  quarantine, malformed-message tests, and the new job channel claimed
  under the renderer IPC boundary (docs/production-threat-model.md:998).
  Each runtime and per-platform binary lands with its licensing-matrix
  row, pinned provenance manifest (exact version, artifact hashes,
  upstream source), and third-party notices in the same change
  (docs/production-licensing-policy.md:69-71). The desktop staging fix
  for the packaged `.ts`-import crash is this packet's first task.
- **Invariants:** The helper makes no network use — observed by the
  privacy workload, audited in runtime supply-chain review, and blocked
  at the OS where a mechanism exists, never merely asserted; it reads
  only job-granted media paths; a helper crash never corrupts the last
  project revision (roadmap.md:647-649); renderer and main survive any helper
  death; native inference never runs in `worker_threads` or the renderer.
  Malformed helper output is rejected by wire validation, never trusted.
- **Acceptance:** Malformed-input, timeout, cancel-under-load (p95
  ≤ 2000 ms), kill-mid-job, restart, and quarantine suites pass; a CI
  fixture transcribes a short known asset deterministically and asserts
  real segments (the kw.media suite never tested inference; this one
  does); Electron packaging carries the runtimes as extraResources with
  per-platform binaries verified at pack time (the ffmpeg runtime staging
  precedent, `scripts/desktop-prepare.mjs`).
- **Non-goals:** No product feature, no persistence of results, no GPU
  enablement (CPU EPs only in this packet).
- **Stop condition:** Stop if the helper protocol would need to diverge
  from the milestone-5 contract shape (that is a milestone-5 design
  conversation, not a milestone-7 workaround), or if any runtime demands
  renderer-side native code.

### WP-7.0.3 — Job, consent, and evidence integration

**Current status:** the versioned workflow/data contracts, aggregate fence,
main-private and disposable custody, one-workflow consent, stage progress,
semantic reviewers, guided/Advanced menu surfaces, and result publishers are
implemented across S30/F31. Existing Parakeet/Silero/diarization/cleanup and
fast-shot paths remain admitted; new model-backed workflows are conditional on
their exact catalog/runtime gates. Reviewed results can publish the ordinary
transcript, labels, edits, derived sources, tempo, annotations, indexes,
crop/keyframes, and secondary sequences named by their recipe. The registered
privacy workload now has a runnable fail-closed local collector for authenticated
real-path trace evidence. It has no accepted owner-lab or five-target packaged
result and remains documentary rather than an activation switch.

- **Outcome:** The `assistance` task kind in the progress coordinator;
  the consent surface (per-job media selection, explicit model choice);
  the assistance capability registration (both products initially
  unavailable); the privacy evidence harness implementing the
  `m7-local-assistance-privacy` collectors — network requests after
  install, unselected-media bytes read, digest mismatches, cancellation
  p95, canonical-state losses (config/quality-budgets.json:1047-1060) —
  runnable locally even while the owner-qualified fixed-GPU host does not
  admit the M7 workload.
- **Invariants:** `optional` status semantics hold: no other milestone's
  gate depends on any of this (status rule docs/quality-budgets.md:42;
  never-blocks semantics roadmap.md:744). Evidence
  stays honest — local evidence never widens the active host's workload
  admission (the milestone-3 pending-external precedent,
  docs/milestone-3b-work-packets.md:15-17).
- **Acceptance:** The collectors produce the five workload metrics
  against the fixture's two selected and two deliberately unselected
  media assets (config/quality-budgets.json:820-828); menu gating
  verified — assistance absent from menus until a model is installed and
  the capability enabled. New capability registrations prove same-schema
  unknown-capability degradation separately from future-schema handling,
  per the milestone-3 registration discipline
  (docs/milestone-3-plan.md:405-433).
- **Non-goals:** No feature UIs beyond the consent/progress plumbing.
- **Stop condition:** Stop if any collector needs product code to
  special-case "measurement mode" — measurement must observe the real
  path.

### 7A packets (Soundscaper track; slice docs at pickup)

- **7A-1 — Transcription and captions-as-labels.** Outcome: VAD +
  Parakeet (+ Whisper long-tail) produce a transcript derived asset
  (words, timings, confidence, language) and land cues as label tracks
  with SRT/VTT export; chapter export reuses the Podcast 2.0 path.
  Invariants: transcripts are digest-bound derived assets, never
  document-embedded bulk; a re-run replaces whole, never merges.
  Acceptance: known-fixture word-error-rate (WER) bound, word-timing
  sanity bounds, a planted-filler fixture recording per shipped ASR
  model whether fillers survive transcription, cancellation, label
  round-trip. Non-goals: no styled captions
  (milestone 4), no live/streaming transcription (capture is fenced).
  Stop: stop if word timing would need a non-commercial aligner.
  **Current implementation:** the guided recipe orchestrates VAD into an
  explicitly selected Parakeet v3 or Whisper path and retains atomic transcript
  replacement plus owned caption labels. The exact reviewed VAD output is fed
  into either ASR. Automatic-language Whisper keeps the optional wav2vec2 stage,
  but the alignment worker loads it only for detected English and returns no
  fabricated alignment for other languages. Parakeet is admitted today;
  Whisper/alignment remain typed unavailable until their signed catalog/runtime
  payload evidence is admitted.
  The word-error-rate and word-timing bounds are registered as
  `m7-local-assistance-speech-accuracy`; measuring them against a real model,
  packaged cancellation, and owner-lab evidence remain open.
- **7A-2 — Filler and silence cleanup proposals.** Outcome: disfluency +
  silence proposal list with audition; accept commits one disjoint-range
  ripple batch. Invariants: proposals are session state; only accepted
  ranges mutate the document; the batch is one undo step. Acceptance:
  planted-filler fixture achieves bounded precision/recall; A/V-linked
  material ripples correctly (the linked-lane expansion already in range
  deletes). Non-goals: no auto-apply mode. Stop: stop if no cataloged ASR
  model passes the planted-filler fixture for the target language — the
  feature scopes to passing models (English Parakeet v2 initially)
  rather than degrading silently.
  **Current bounded slice:** after explicit review of an authenticated English
  Parakeet result, the Local Assistance dialog presents deterministic filler
  and repetition proposals, initially unselected. Silence is proposed only
  from exact reviewed Silero VAD data retained for the same full selection
  fence in that dialog session; transcript word gaps are not relabeled as VAD.
  Explicit subset acceptance commits one link-aware disjoint ripple batch and
  undo step. Reject, cancel, stale authority, and an empty subset make no
  mutation. Mutation-free audition and Conservative/Balanced/Aggressive recipe
  settings are implemented. Balanced retains the established defaults;
  Conservative uses 1.5 s/100 ms/0.8 confidence and Aggressive uses
  300 ms/30 ms/0 confidence. The planted-fixture precision and recall bounds are
  registered as `m7-local-assistance-speech-accuracy`; running the fixture and
  manual qualification remain open.
- **7A-3 — Diarization and speaker labels.** Outcome: speaker turns as
  labeled regions; transcript segments gain speakers. Invariants: local
  clustering only; speaker names are user-editable labels, never claimed
  identities. Acceptance: two-plus-speaker fixture diarization-error-rate
  (DER) bound; stable labels across re-runs on unchanged media.
  Non-goals: no voice ID across projects. Stop: stop if quality demands
  a gated or non-commercial model.
  **Current bounded slice:** exact installed pyannote segmentation and ERes2Net
  embedding bindings execute together independent of UI selection order.
  Authenticated turns are semantically reviewed; explicit acceptance can replace
  the same digest-bound transcript with anonymous speaker attribution and its
  owned label track in one batch. Cross-project voice identity is absent. The
  diarization-error-rate and label-stability criteria are registered as
  `m7-local-assistance-speech-accuracy`; measuring them and the owner-lab run
  remain open.
- **7A-4 — Enhancement and stems as derived sources.** Outcome: denoise
  (DeepFilterNet3/GTCRN) and separation (Spleeter; htdemucs behind its
  legal gate) render derived sources the user swaps in; original media
  untouched. Invariants: derived sources follow existing retention and
  disposal; milestone-4's deterministic cleanup path remains complete
  without these. Acceptance: null-test bounds on pass-through regions;
  capacity preflight before render. Non-goals: no realtime monitoring
  effects (that is milestone-4/5 effect-host territory). Stop: stop if a
  stem model's weights cannot clear the licensing gate — the feature
  ships with fewer models, not with a trapped one.
  **Current implementation:** DeepFilterNet3 and TIGER have authenticated
  geometry-exact WAV workers, 48 kHz/44.1 kHz channel-preserving preparation,
  bounded chunk spooling under one whole-selection fence, capacity preflight,
  original/result or stem audition, and atomic Project Bin, range-replacement,
  or initially-muted D/M/E placement publishers. The existing DeepFilterNet
  artifact may be admitted independently; TIGER remains unavailable until its
  converted graph/parity and signed catalog/runtime evidence lands.
- **7A-5 — Semantic transcript search.** Outcome: transcript embeddings
  (nomic-embed) in a local disposable index; palette-integrated "find
  where I said…" jumping to timestamps. Invariants: index is rebuildable,
  evictable, and never required. Acceptance: recall on a seeded phrase
  set; index rebuild determinism. Non-goals: no cross-project search.
  Stop: stop if the index would need to persist inside the document.
  **Current implementation:** deterministic overlapping transcript chunks,
  nomic document/query prefixes, strict Float32 matrices, disposable index
  custody, expiring main-authorized query sessions, stale-query cancellation,
  rank fusion, and exact timeline jumps are implemented. Project/source/range,
  timing, recipe/settings, and model digests key deterministic rebuilds; retained
  indexes never alter `.scape`. Packaged execution is conditional on the pending
  ONNX Runtime payload closure.
- **7A-6 — Beat and tempo suggestions.** Outcome: Beat This! beats and
  downbeats as a label track; optional reviewed tempo-map suggestion
  command. Invariants: the MIDI fence is untouched; no automatic
  tempo-map rewrite. Acceptance: beat-grid fixture tolerance; label
  round-trip. Non-goals: no MIDI anything (roadmap.md:117-124). Stop:
  stop if any madmom-derived weight would enter the tree.
  **Current implementation:** Beat This preprocessing/postprocessing, ordered
  beat/downbeat review, an owned Beats label track, and separately selected
  exactly representable held-tempo diffs are implemented. The MIDI/signature
  fence remains untouched. `small0` is the exact CPU default and `final0` is an
  optional quality pack with no substitution between them. Converted artifacts,
  live parity, catalog signing, and runtime payload evidence still block
  packaged execution.
- **7A-7 — Exit evidence.** The privacy workload run end-to-end on the
  full 7A surface, results recorded without relabeling pending rows.

### 7B packets (Framescaper track; slice docs at pickup)

The complete 7B workflow, review, and publication layer is implemented. Fast
shots remain the admitted model-free baseline; accurate shots and the other
model-backed routes stay conditionally unavailable until their exact catalog
entries and ONNX Runtime payloads pass release admission.

- **7B-1 — Shot detection and markers.** Outcome: ffmpeg scene scores
  (fast) and TransNetV2 (accurate) produce shot boundaries as timeline
  annotations; "mark cuts" menu action. Pickup contract: enabling
  timeline annotations for Framescaper (per-product activation precedent:
  trackFolders). Invariants: markers are ordinary annotations, ripple
  with edits; the slice doc records the Framescaper availability flip in
  the roadmap and capability register the way the trackFolders
  activation did. Acceptance: cut-detection F1 on a fixture reel including
  dissolves (documenting the fast mode's known miss class). Non-goals: no
  auto-cutting. Stop: stop if annotation activation would demand a schema
  revision beyond the capability flip.
  **Current bounded slice:** selected F31 video can run the fast scene-score
  path without a model through an admitted user-configured external FFmpeg.
  Exact authenticated boundaries receive semantic review; explicit acceptance
  commits ordinary timeline annotations, and reject, stale authority, or an
  empty result does not fabricate cuts. Accurate mode has an owned TransNetV2
  adapter and the same canonical boundary publisher, but its converted graph,
  three-runtime parity, signed catalog entry, and payload remain pending.
- **7B-2 — Frame semantics: tagging and search.** Outcome: shot-aware
  sampled SigLIP 2 embeddings and tags; OCR of overlays on shot keyframes
  as searchable text; palette-integrated visual search fused with 7A-5's
  transcript hits. Invariants: disposable index; sampling is shot-aware
  (1–3 frames per shot), never dense. Acceptance: retrieval hit-rate on a
  seeded fixture; index size bound per hour of video. Non-goals: no
  face *recognition* of any kind. Stop: stop if per-frame cost forces
  dense sampling to be acceptable.
  **Current implementation:** fixed shot-duration sampling, SigLIP embeddings
  and non-biometric tags, PP-OCR text, disposable storage, transcript/visual/OCR
  reciprocal-rank fusion, cancellable queries, and exact jumps are implemented.
  Normalized shot tables and index claims are revalidated against the complete
  live aggregate fence before and after disposable publication. Packaged
  inference is conditional on authenticated ONNX Runtime payloads.
- **7B-3 — Subject tracking and reframe proposals.** Outcome: YuNet +
  D-FINE + ported ByteTrack + U²-Net-P produce per-shot subject boxes and
  a proposed crop per shot for a target aspect; review overlay; accepted
  crops persist as an assistance derived asset that drives the 7B-5
  export crop stage. Invariants: no spatial transform primitive exists
  today — "transform, crop" is milestone-4 document scope
  (roadmap.md:601-602) — and this packet does not fabricate one: crops
  stay out of the project document until they migrate onto milestone-4
  transforms and keyframes when those land; every crop is user-editable
  before export. Acceptance: subject-retention metric on a fixture set;
  degenerate cases (no subject) fall back to saliency then center.
  Non-goals: no persisted document schema for crops, no continuous
  keyframed paths yet; no InsightFace-anything. Stop: stop if quality
  demands per-frame detection everywhere (detector cadence + tracker
  interpolation is the design), or if a persisted crop schema becomes
  unavoidable before milestone 4 — that is a bought-early milestone-4
  slice to declare explicitly, not to smuggle.
  **Current implementation:** fixed 2 fps plus shot-anchor sampling, YuNet and
  D-FINE detections, deterministic ByteTrack interpolation, U²-Net-P/centre
  fallback, bounded aspect settings, editable overlay/keyframe review, and
  existing crop/composition command publication are implemented. Accepted
  subject/saliency/tracker evidence is retained with strict source, range,
  timing, model, settings, and crop-authority provenance and can be reused by
  highlights; edited keyframes deliberately replace model provenance with
  reviewed centre authority. Production availability and subject-retention
  qualification await runtime payloads and packaged fixtures.
- **7B-4 — Highlight assembly: the clip maker.** Outcome: the full
  composition above — excitement + heuristic + embedding ranking,
  optional LLM re-rank/titles, boundary snapping, proposal review,
  accepted clips as new sequences with labels. Invariants: ranking is
  deterministic given identical inputs and settings; the LLM pack is
  optional and its absence changes ranking quality, never availability;
  LLM output is schema-validated and never executes as anything but
  text. Acceptance: end-to-end on a long fixture VOD within a time
  budget; proposal determinism; accept/undo round-trip. Non-goals: no
  cloud ranking; no auto-publish anywhere. Stop: stop if ranking quality
  is argued to require shipping a fine-tuned classifier now (that is the
  recorded watch item, not launch scope).
  **Current implementation:** deterministic candidate construction, fixed v1
  ranking/overlap rules, speechless renormalization, initially-unselected review,
  transport preview, trim/title/crop edits, retained ranking checkpoints, and
  atomic secondary-sequence publication are implemented. Crop planning reuses
  an exact accepted reframe derivative when available and otherwise follows the
  authenticated fallback chain. Optional Qwen can only rerank known candidates
  and emit bounded grammar-constrained JSON. Raw/unselected output is discarded;
  an accepted proposal may retain only sanitized inert title, hook, chapter, and
  explanation metadata. PANNs and Qwen remain unavailable until exact model,
  runtime, catalog, and package evidence passes.
- **7B-5 — Vertical delivery lookahead.** Outcome: the render plan gains
  a crop stage and an explicit vertical canvas (1080×1920-class,
  deliberately above today's 1280×720 default ceiling,
  `src/common/editor/video-export.js:21-23`) so accepted 9:16 clips
  export without padding letterbox; a deliberately bought-early slice of
  milestone-6 delivery on the retrofit-cost logic the milestone-3 plan
  used for its interchange buys (docs/milestone-3-plan.md:434), with a
  roadmap §6 note landing in this packet and milestone 6 retaining
  acceptance ownership of canvas/aspect delivery. Invariants: plan versioning
  follows the export-plan pin discipline (the version is pinned in more
  places than the planner — the 3B-2b trap); no preset system is built
  (milestone 6 owns presets, roadmap.md:735-736). Acceptance:
  crop-correct golden frames at 9:16; existing exports byte-stable when
  no crop is requested. Non-goals: no caption burn-in (milestone 6), no
  platform preset catalog. Stop: stop if this grows toward a preset
  system or hardware encode (milestone 5/6 scope).
  **Current implementation:** reframe/highlight acceptance uses existing crop,
  keyframe, composition, and sequence commands; no assistance-only project
  schema was added. Crop-correct 9:16 golden export and five-target package
  evidence remain qualification work rather than inferred success.
- **7B-6 — Exit evidence.** Privacy workload over the 7B surface,
  including the clip maker end-to-end, recorded honestly.

## Quality-budget and evidence duties

- The workload is already registered: `m7-local-assistance-privacy`
  (config/quality-budgets.json:1047-1060) with fixture
  `m7-local-assistance-privacy-v1` (two selected, two deliberately
  unselected media assets — config/quality-budgets.json:820-828) and
  thresholds `networkRequestsAfterInstall eq 0`,
  `unselectedMediaBytesRead eq 0`, `acceptedDigestMismatches eq 0`,
  `cancellationP95Ms lte 2000`, `canonicalStateLosses eq 0`. WP-7.0.3
  supplies the checked-in collector at
  `npm run quality:collect:m7-assistance-privacy -- --measurement <record.json>`;
  7A-7/7B-6 retain actual packaged and owner-lab runs. The collector accepts only
  one warm-up plus five fresh no-retry runs, exact package/catalog/runtime/model
  and media digests, whole-workflow post-install network observation, two selected
  plus two unselected assets, and bounded acceptance/canonical/cancellation
  ledgers. It writes raw and aggregate development evidence as `pending-external`
  or `failed`; it has no accepted-evidence mode and synthesizes no model or
  platform result.
- The accuracy each model-backed route owes is registered rather than left in
  prose: `m7-local-assistance-speech-accuracy` carries the word-error-rate,
  word-timing, filler precision/recall, diarization-error-rate, label-stability,
  search-recall, index-rebuild, and beat/downbeat bounds, and
  `m7-local-assistance-visual-accuracy` carries the accurate and fast
  cut F-measures, retrieval hit rate, index size per video hour,
  subject retention, degenerate-fallback, highlight real-time factor and
  determinism, vertical golden-frame, and byte-stable unchanged-export bounds
  (config/quality-budgets.json, docs/quality-budgets.md#milestone-7-local-assistance-accuracy-criteria).
  Both are `planned` with specified rather than provisioned corpora and no
  collector: registering a criterion states what a route owes, and is never
  evidence that it is met.
- The named environment `owner-qualified-windows-x64-rtx3090-01` retains
  historical earlier-workload diagnostics but is currently unprovisioned and
  does not admit `m7-local-assistance-privacy`.
  Local runs produce development evidence; a formal M7 profile and accepted
  run may later qualify the surface but do not control activation. Missing
  evidence is recorded as unqualified and is never simulated with a software
  renderer. No benchmark retry converts a failure into a pass
  (docs/quality-budgets.md:102-104).
- Bundle gates are untouched by design: no model or runtime byte enters
  the Pages bundle or any JS chunk (roadmap.md:101-103;
  docs/quality-budgets.md:33-36). Desktop runtimes ship as verified
  extraResources like the existing ffmpeg core.
- Every packet's browser-reachable UI keeps the canonical check green;
  file-size ratchets are raised in the feature commit per precedent, and
  new command types bump the registry-count pin.

## Two-agent coordination rules

- Phase 7.0 is one work stream. 7A and 7B start only after 7.0's
  acceptance passes, then run file-disjoint: 7A owns the speech services,
  audio-side proposal UIs, and label integrations; 7B owns the vision
  services, video-side proposal UIs, and the clip maker. 7B consumes 7A's
  transcript/diarization services read-only through their published
  interfaces.
- Spine files stay serialized with one owner per edit, rebase before
  push: the model catalog and licensing matrix, the helper IPC protocol,
  command protocol and domain registries, the capability register,
  application menus, task-kind and search integrations, the i18n catalog,
  and the maintainability allowlist. A spine edit and its ratchet or
  count updates land in one commit.
- Schema revisions remain serialized product-wide: at most one in flight,
  owned by one agent, landing atomically with validators and fixtures.
  Expected milestone-7 revisions are small: the transcript derived-asset
  reference and the assistance capability registrations.
- Shared fate: one agent's red main stalls both; keep the canonical check
  green on every push.

## Known constraints this plan absorbs

- **No restartable job queue exists** (milestone 5/6 scope); milestone-7
  jobs are in-memory, die with the app, and must be cheap to re-run.
  Long-VOD analysis therefore checkpoints per stage into disposable
  derivatives so a re-run resumes coarse-grained.
- **Selected S30 and F31 own the assistance reference schema, while accepted
  results use ordinary state.** Every planned workflow adapter and reviewer now
  exists, but that implementation does not admit missing model/runtime bytes.
  Transcript bodies use the assistance reference schema; enhancement, stems,
  labels, tempo, shots, crops/keyframes, and highlight sequences publish through
  existing commands. Disposable indexes and retained ranking/reframe evidence
  do not widen `.scape`. A conditional route stays unavailable until its exact
  artifact, signed catalog entry, and target payload pass their own hard gates.
- **The browser has custody but no inference.** Web Soundscaper and
  Framescaper preserve the schema-defined ordinary project state, while new
  model execution and the filesystem model manager remain Electron-only. The
  current desktop UI can accept every reviewed workflow result whose exact
  runtime/model gates are admitted into ordinary project state; web routes
  retain and edit that state but cannot run new inference.
- **Remote model availability is not established here.** A real R2 upload and
  read-back require the separately scoped publisher credentials and evidence;
  the product continues to fail closed or use explicit authenticated preseed
  when mirror objects are absent.

## Watch items (not gates yet)

- ONNX Runtime's native WebGPU EP maturing out of experimental — the
  intended successor to DirectML (maintenance mode) for Windows GPU.
- sherpa-onnx win-arm64 prebuild gap; Snapdragon-class Windows machines.
- Qwen3.5 small series and Gemma 4 E4B as LLM-pack upgrades; re-verify
  GGUF/llama.cpp support at 7B-4 pickup.
- Voxtral-Mini-4B-Realtime for a future live-caption feature (GPU-class
  sizing keeps it out of scope now; active 8A capture grants no live-input
  authority to assistance, so a separate consent and custody design is still
  required).
- A small fine-tuned highlight classifier (the Rhapsody recipe) as the
  ranking upgrade that would leapfrog zero-shot LLM quality.
- pyannote `community-1` (CC-BY-4.0) as the segmentation upgrade.
- Adding a formal M7 profile and owner-host workload admission as documentary
  qualification evidence without turning it into an activation switch.
- whisper.cpp's Parakeet support consolidating the ASR stack to fewer
  runtimes.

## Non-goals and fences

- The remaining deferred-capability fences hold through milestone 7: no MIDI
  schema, ports, flags, dependencies, or UI — beat suggestions emit labels,
  nothing else. Milestone 8A capture is separately active, but assistance may
  consume a selected recording only after canonical publication makes it
  ordinary persisted media. No assistance helper may initiate capture, reuse a
  capture grant, receive live device input, or gain camera, microphone, display,
  picker, or permission authority.
- No cloud or hosted AI, no accounts, no telemetry of media, transcripts,
  embeddings, or usage. Selected media and results remain on-device
  (roadmap.md:764).
- No auto-apply mode for any proposal; no assistance result mutates a
  document without an explicit accept.
- No face recognition or cross-project voice identification.
- No weight or runtime enters a stable 1.0 release without its milestone-9
  licensing-evidence record; pending review does not block authenticated local
  build, packaging, or testing. No gated-download URL (Hugging Face auth walls)
  is ever a distribution source.
- Deterministic non-AI editing and delivery remain complete without this
  milestone (roadmap.md:766-767); removing every model and the helper
  binary leaves a fully functional editor.
