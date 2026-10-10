# Editing performance boundaries

These boundaries guide extensions to existing optimizations. Re-profile the
current owning implementation before changing one, and begin with a regression
that demonstrates the remaining cost. Completed implementation inventories and
run receipts are available in Git history. The [performance guide](performance.md)
describes measurement and reproduction.

## Timeline and display

| Owner | Current boundary | Evidence needed for an extension |
| --- | --- | --- |
| [Waveform selection layers](../../src/common/editor/ui/timeline/TimelineCanvasRenderer.jsx) | Cached layers admit regular summary waveforms at unit horizontal backing scale. Sample, frequency, and scaled modes retain their original rendering. The shared 32 MiB cap covers retained RGBA layers; owner canvases, GPU allocations, and transient probes are separate. | Exact pixel parity in additional modes, cold and warm paint costs, and total retained/transient memory. |
| [Sample stems](../../src/common/editor/audacity-waveform-renderer.js) | Contiguous-color stems batch only at unit scale after a successful native raster probe. Connecting dots and unsupported raster states retain individual strokes. A cold probe owns and releases two 480 × 100 surfaces. | Native raster parity at joins, selection edges, alpha/composite/shadow/filter/dash settings, and measured canvas CPU. |
| [Spectrogram rasterization](../../src/common/editor/ui/timeline/spectrogram-image-data.ts) | Bulk ImageData requires integral physical rectangle boundaries. Arbitrary fractional antialiasing retains rectangle painting. | Exact seam/antialiasing parity before widening admission, plus paint time and bulk-path hit rate at fractional DPR. |
| [Spectrogram tiles](../../src/common/editor/ui/timeline/useSpectrogramPcmTiles.ts) | FFT columns are reusable only when viewport shifts preserve the same integer sample-center grid. Different anchor phases or fractional grids change spectral values. | Fewer repeated FFT/read operations with identical spectral values, bounded cache memory, and viewport completion time. |
| [Automation geometry](../../src/common/editor/ui/timeline/track-automation-overlay-projection.ts) | Absolute constant/linear curves use anchors; eased curves use bounded adaptive geometry. Musical curves retain authoritative two-CSS-pixel sampling because tempo mapping changes screen geometry. | Numerical pixel-error bounds, exact hold corners, tempo-change parity, and fewer path objects. |
| [Meter fills](../../src/common/editor/ui/workspace/MixerTelemetryMeters.tsx) | Solid peak/mixer fills use transforms. Gradient/EBU fills, RMS overlays, and markers keep geometry semantics. | Pixel parity for gradients and RMS scales, transition behavior, compositor memory, and per-tick layout/paint cost. |

## Rendering and storage

| Owner | Current boundary | Evidence needed for an extension |
| --- | --- | --- |
| [Bounded offline export](../../src/common/editor/export.js) | Faster-than-realtime rendering admits neutral stateless single-clip stereo graphs on positively identified Chromium/Electron and Gecko backends. Effects, fades, automation, routing, overlaps, transforms, non-unity mix, WebKit/iOS, and unknown or contradictory backends retain clocked capture. | Audio null comparisons, stateful boundary continuity, cancellation, peak RSS, and backend-specific parity. Generic overlap/fade rendering and native WebKit offline behavior need separate qualification. |
| [Speed PCM publication](../../src/common/editor/storage/source-write-repository.ts) | Raw canonical PCM publishes before optional compression; Consolidate creates verified WavPack generations explicitly. Automatic background compression remains open. Raw generations retained for Undo/COW cannot be replaced in place. | First-playable/result latency, background interference, crash/reopen durability, and exact raw/compressed PCM equality. |
| [WavPack input ownership](../../src/common/editor/storage/pcm-repository.ts) | Memory/migration paths retain recoverable raw input because encoder transfer detaches its buffers and a terminated worker cannot return them. | Lower copy cost with preserved mutation isolation, abort handling, and durable raw fallback. |
| [PCM checksums](../../src/common/editor/storage/pcm-repository.ts) | Speed raw and post-decode CRC run in a bounded worker. Memory-mode encode retains renderer CRC, and transport/fallback can retain copies. | Renderer long tasks, read/write latency, worker costs, and unchanged corruption detection. |
| [Generation fences](../../src/common/editor/storage/owned-source-pcm-read-session.ts) | Each packet still compares metadata for every retained ancestor. Removing those checks needs an authoritative cross-edit invalidation lease. | Metadata-query savings and replacement/release race tests across all ancestors. |
| [COW chunk owners](../../src/common/editor/storage/owned-source-pcm-read-session.ts) | Fresh key-only probes find the newest owner. Same-generation chunk insertion makes cached owner/absence answers unsafe. | A coherent invalidation contract, fewer repeated lookups, and exact sparse-edit precedence. |
| [OPFS sessions](../../src/common/editor/storage/opfs-repository.ts) | Only fresh sync positional readers are retained. Browser File snapshots are reacquired for each packet; provider reads remain fresh to detect same-path tampering. | Fewer admissions/handle acquisitions with preserved fresh-byte reads, rebound request signals, release, and provider-replacement behavior. |
| [Desktop codec copies](../../desktop/desktop-audio-codec-operation-contract.ts) | Buffered provider results snapshot once before contract/digest validation. Request normalization, public results, and Electron cloning retain trust-boundary isolation. | Copy/GC and IPC costs with caller-mutation and owner-revocation coverage. |

## Assistance and controller publication

| Owner | Current boundary | Evidence needed for an extension |
| --- | --- | --- |
| [Kokoro output](../../desktop/assistance-onnx-kokoro-worker.ts) | Borrowed ONNX waveforms become owned PCM16 chunks immediately, but encoded chunks remain resident until inference finishes. Sentence-by-sentence writes to the reserved WAV sink remain open. | Peak RSS and publication latency with exact WAV headers, samples, digests, and cancellation behavior. |
| [G2P runtime](../../desktop/assistance-kokoro-g2p-runtime.ts) | Resident TTS threads reuse an immutable parsed manifest for a bounded lifetime, keyed by freshly read SHA-256. Closure hashing and the one-shot subprocess remain. Mutable package paths cannot authorize skipping file authentication. | An authoritative immutable closure capability, fewer hashes/process starts, and tamper/replacement tests. |
| [Detached project views](../../src/common/editor/controller/document/document-snapshot.ts) | Full validation, branch-owned drafts, and final detachment remain. Wider structural sharing needs a private immutable authored-project ownership contract; public inputs can be mutable or untrusted. | Fewer copied/visited nodes, bounded retention, and mutation/validation isolation. |
| [Presentation transactions](../../src/common/editor/controller/composition/presentation-state.ts) | Synchronous analysis/generation/ordinary Apply transitions batch within scopes. Scopes never span an await; progress and partial results remain observable. Nyquist and macro transitions are not all batched. | Fewer snapshots/notifications with preserved busy-first paint, progress, exception release, cancellation, and stale-owner behavior. |
| [Analysis persistence](../../src/common/editor/controller/analysis/analysis-service.ts) | Computed levels display before cache persistence, but task completion still awaits the write for deterministic disposal and failure handling. | Completion latency under slow storage with tracked writes, flush/disposal, ownership, and retry/error handling. |

## Changes requiring a broader design

These proposals need new protocols or representative evidence before an
implementation can be justified.

| Area | Prerequisite |
| --- | --- |
| [Streaming compressed decode](../../src/common/editor/desktop-audio-codec-runtime.ts) | A reviewed continuation/finish decoder ABI, decode-capable pathless ownership protocol, bounded staged PCM publication, and codec/gapless conformance. Independent requests over the full-buffer ABI cannot provide a genuine decode stream. |
| [Decoded PCM projection](../../src/common/editor/desktop-audio-codec-result.ts) | A measured off-renderer design with exact output parity. Typed-view loop substitutions previously regressed in warm helper probes; repeat representative import measurements before changing the DataView path. |
| [Direct assistance PCM custody](../../src/common/editor/controller/assistance/internal/audio/local-assistance-audio-preparation.ts) | A two-phase producer/sealing capability across IPC. Current closed data requests cannot carry renderer functions or give unsealed output a final digest. |
| [Resident Whisper](../../desktop/assistance-whisper-cpp-worker.ts) | A verified persistent/batch native protocol with fresh model admission and corresponding source/runtime publication. The one-shot CLI has no supervised session seam. |
| [Resident llama and prefix reuse](../../desktop/assistance-llama-cpp-worker.ts) | An authenticated offline service with explicit job/project state reset and runtime closure publication. Cross-project KV state must remain isolated. |
| [Inference thread budgets](../../desktop/assistance-onnx-worker-common.ts) | Per-task real-model throughput, UI/playback contention, and memory measurements across thread settings. One synthetic graph cannot justify a global default. |
| [DeepFilter channel pipelining](../../desktop/assistance-onnx-enhancement-separation-worker.ts) | A verified batched model graph or admitted analysis-worker pipeline with channel/seam parity. Promise concurrency does not parallelize synchronous DSP; extra sessions multiply weight, thread, and memory budgets. |

Resident Whisper/llama services and other engine-closure changes require a
manual **Update AI assets** run and refreshed desktop test-runtime snapshots.
A model graph publication follows its separate weight/catalog process unless
an engine closure also changes.
