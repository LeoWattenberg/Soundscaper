# De-reverb plan: removing room reverberation from recorded audio

Status: research complete; empirical bake-off run on the owner workstation
(RTX 3090) with results recorded below; implementation not started. This plan
was requested as a standalone feature plan; it registers no roadmap row and
claims no milestone gate. Where it touches milestone-7 machinery it follows
that plan's decisions (docs/milestone-7-plan.md) rather than restating them.

## Purpose and scope

A **De-reverb** capability removes room reverberation and echo from
already-recorded audio — conference-room voice memos, untreated-room dialogue,
live music recordings, over-wet vocal stems. It is an offline, destructive (or
derived-source) operation on a selection; real-time monitoring de-reverb is a
non-goal. Both speech and music matter, at the editor's native 44.1/48 kHz,
mono and stereo.

Quality is the ranked-first criterion, per the owner's directive: a small fast
deterministic web algorithm is preferred *if* it is good enough, but a
multi-hundred-MB local ML model is acceptable when quality justifies it, up to
a ~2 GB ceiling.

The research (six-angle sweep, per-candidate license verification, and a local
seven-candidate empirical bake-off) supports a **two-track shape**, because no
single open implementation covers speech + music + full bandwidth + a
shippable license today:

- **Track A — a deterministic first-party web effect** (WPE-family late-reverb
  suppression, MIT-derived algorithm, no weights, runs everywhere the editor
  runs).
- **Track B — a high-quality ML tier through milestone-7 local assistance**
  (a cataloged dereverb model rendered as a derived source, the exact shape
  DeepFilterNet3 already has in 7A-4), Electron-only per the milestone-7
  platform decision.

## Relationship to existing scope fences

- **4A-5 explicitly fences "no new restoration DSP … no new restoration
  algorithm"** (docs/milestone-4a-soundscaper-production.md:843-846). Track A
  is exactly such a new algorithm, so it is *not* a 4A-5 extension; it is new
  scope with its own packet below. The 4A-5 fence stays intact.
- **Milestone 7 is Electron-only for inference** (docs/milestone-7-plan.md:117-155):
  no WASM ML ships in the web tier. Track B therefore lands as a 7A-4 sibling,
  and any future in-browser ML dereverb is a separately gated item under the
  `reviewed-web-effect-packages` template (docs/production-threat-model.md:1060),
  not an obligation of this plan.
- **The `audacity-*` effect namespace is provenance-locked**: every
  `audacity-*` type must cite a real upstream Audacity `.cpp`
  (`src/common/editor/audacity-effects/manifest.js:34`, enforced by
  tests/audacity-effects-manifest.test.js:61), and Audacity has no de-reverb
  effect. Track A must be an originally authored, non-`audacity-`-prefixed
  first-party effect type, following the `reviewed-utility-gain` precedent of a
  non-Audacity selection effect (`src/common/editor/reviewed-effects/selection-effect-contract.ts:8-22`)
  — but as ordinary repository-owned TypeScript, not a reviewed-WASM package
  (docs/production-licensing-policy.md:243-250 states that machinery is only
  for non-repository-owned packages).

## Licensing posture and one recorded decision point

The application is AGPL-3.0-only. The milestone-7 catalog policy **excludes
non-commercial and research-only weights outright**
(docs/milestone-7-plan.md:260-271, 365-381). The owner's directive for this
feature stated CC-BY-NC-SA weights would be acceptable. As it turns out, **the
conflict is moot for every serious candidate**: the quality leaders are MIT
(SGMSE+, code and weights), Apache-2.0 (MossFormer2), GPL-3.0 (anvuew weights
— copyleft, AGPL-coexistent as a separately downloaded asset, and not an
"additional restriction" in the catalog-policy sense), and MIT-no-weights
(WPE). The only license-blocked candidates (FoxJoy's UVR models) are not NC —
they have **no license grant at all**, which fails under either policy.

**Decision recorded for the owner:** this plan ships with no NC weights and
leaves the milestone-7 exclusion untouched. If a future NC-licensed model is
ever wanted, that requires an explicit amendment to the milestone-7 catalog
policy (the "excluded weights" table and the licensing-matrix `local-models`
gate), not a quiet exception.

## Research summary: the open-source field

Full verified records (licenses fetched from primary sources, quality claims
traced to papers) live with the bake-off artifacts. The decision-relevant
digest — **pre-bake-off assessments**; the bake-off section below supersedes
the "verdict" column where they disagree:

| Candidate | Kind | License (code / weights) | Rate | Size | Verdict |
| --- | --- | --- | --- | --- | --- |
| WPE (nara_wpe) | Deterministic DSP | MIT / no weights | any | ~0 | Track A basis. Standard REVERB/CHiME baseline; removes late tail only; the one candidate portable to first-party TS/WASM by us. |
| SGMSE+ EARS-Reverb | Diffusion ML | MIT / MIT | 48 k | ~450 MB class | Quality ceiling. Only rigorous full-band dereverb benchmark in the field (EARS-Reverb: POLQA 1.75→3.61, MOS-Reverb 2.99→4.73). RTF ≈ 2 *on GPU*; diffusion sampler must be hand-ported for ONNX. |
| MossFormer2_SE_48K | Single-pass transformer | Apache-2.0 / Apache-2.0 | 48 k | 222 MB | The practical full-band candidate — if it actually dereverbs (trained with reverberant mixes; zero published reverb evals). The bake-off exists largely to answer this. |
| anvuew mel-band RoFormer dereverb | Attention ML | MIT framework / GPL-3.0 | 44.1 k | 913 MB | De-facto community standard for vocal/music dereverb; self-reported SDRs not cross-comparable; vocal-stem oriented. |
| anvuew dereverb_room (BS-RoFormer) | Attention ML | MIT framework / GPL-3.0 | 44.1 k | <120 MB | Room-reverb specialized, mono, small; ONNX exporter exists upstream (MSS_ONNX_TensorRT). |
| UVR-DeEcho-DeReverb (FoxJoy) | CNN+LSTM | informal MIT, no LICENSE file / **absent** | 44.1 k | 224 MB | Full-band music-capable, but weights have no license grant from anyone; evaluation-only, unshippable without a written grant. |
| GTCRN (DNS3 ckpt) | Tiny RNN | MIT / MIT | 16 k only | 0.6 MB | Cheap reference; dereverb via DNS3 RIR augmentation, unmeasured; 16 kHz cap disqualifies it as the headline effect. |
| DeepFilterNet3 | CRN denoiser | MIT/Apache dual | 48 k | ~10 MB | Already cataloged in milestone 7; included in the bake-off to measure whether the existing denoiser already helps on reverb. |
| StoRM | Diffusion ML | MIT / presumed MIT (unwritten) | 16 k only | ~28 M params | Beats SGMSE+ at 16 kHz with ~5× fewer steps, but no 48 kHz checkpoint — excluded from the bake-off; relevant only if someone retrains. |
| VoiceFixer | ML restorer | MIT / CC-BY-4.0 | 44.1 k | 625 MB | Consistently mid-pack since 2023 (UniAudio: PESQ 2.43 vs SGMSE+ 2.87); speech-only vocoder output; excluded from the bake-off. |

Ecosystem findings worth recording:

- **No open LADSPA/LV2/VST dereverb plugin exists anywhere**, and Audacity has
  never shipped one — a deterministic Track A effect would be novel in
  open-source audio, not a re-implementation of a solved problem.
- **No well-evidenced open music dereverberation model exists.** Every
  speech-track model has zero music validation and vice versa; all UVR-family
  SDR figures are author-self-reported on private sets (the same checkpoint
  scored 20.4 and 7.67 on two different sets).
- The commercial bar (iZotope RX De-reverb, Acon DeVerberate, Accentize DeRoom
  Pro, Adobe Podcast Enhance, Supertone) is dialogue-centric; reviewers call
  none of them good on music, and the reviewed leader (Adobe) re-synthesizes
  speech rather than restoring it. SGMSE+'s EARS-Reverb table is the honest
  open bar for true restoration.

## Empirical bake-off

Run locally on the owner workstation (RTX 3090, CUDA; CPU timings also
captured where feasible) over a shared corpus of dry/reverberant pairs:
48 kHz speech (multiple speakers) and 44.1 kHz music (vocal stems, full mixes,
solo instrument) convolved with real rooms from the MIT IR Survey (short,
medium, long RT60) plus a plugin-style synthetic reverb condition, and a small
set of real no-reference recordings. Metrics: SI-SDR, PESQ-WB (16 k), STOI/
ESTOI, log-spectral distance and multi-resolution STFT distance (music),
DNSMOS, SIGMOS (incl. its REVERB dimension), ViSQOL-audio where installable,
plus measured seconds-of-compute per second of audio on GPU and CPU. The
unprocessed reverberant input is scored as the baseline row.

Full tables, runtime costs, artifact digests, and caveats are recorded in
**docs/dereverb-bakeoff-evidence.md**. The findings that drive this plan:

1. **anvuew dereverb_room won speech decisively** — the only candidate
   improving every intrusive metric family at once (SI-SDR −8.72→−4.29 dB,
   PESQ 1.57→2.89, ESTOI 0.445→0.783, SIGMOS-REVERB 2.53→4.46), on real *and*
   plugin reverb, at 118 MB, CPU RTF ≈ 4.5.
2. **SGMSE+ is perceptually strong (best LSD/ViSQOL) but unshippable**: RTF
   3.7 on a 3090 and ~188 on CPU, and its generative resynthesis scores below
   baseline on SI-SDR.
3. **The community-favorite anvuew mel-band model is a near-no-op on plain
   speech** (output ≈ input) and strips instruments from full mixes — its
   reputation holds only for isolated vocal stems.
4. **No candidate improves full-mix music**; only WPE nudges LSD/MR-STFT/
   ViSQOL in the right direction. The literature gap is confirmed empirically.
5. **MossFormer2's hoped-for dereverb ability did not materialize**
   (SIGMOS-REVERB 2.90 vs baseline 2.53), and cataloged DFN3 already beats it
   as a no-reference improver on noisy reverberant speech.
6. **WPE is honest but mild at conventional settings** (ΔSIGMOS-REVERB +0.10
   on speech; best-of-field but small on music) — a deterministic floor, not
   a headline effect.

Objective metrics only — blind listening is still owed before defaults ship
(see evidence-doc caveats).

## Track A — first-party deterministic "De-reverb" effect (web + desktop)

An originally authored, repository-owned selection effect implementing
**WPE-style delayed linear prediction** (late-reverb removal) with an optional
**Lebart/Habets-style late-reverb spectral suppression** stage for stronger
settings. The bake-off measured plain WPE at conventional settings as mild
(ΔSIGMOS-REVERB +0.10 on speech, best-of-field but small on music), so the
suppression stage is where Track A earns its keep; implementation should
re-run the bake-off harness over its parameter space before fixing defaults. MIT-licensed algorithm lineage (nara_wpe is the reference
implementation; we port the math, not the code — and even code reuse would be
MIT-compatible), no weights, deterministic, sample-rate-agnostic.

### Algorithm sketch

1. STFT front end (~21 ms window, 25% hop; 1024/256 at 44.1/48 k).
2. Per-frequency-bin delayed linear prediction (WPE): predict the late tail
   from frames `delay..delay+taps` back, subtract the prediction; taps ≈ 10–20,
   delay ≈ 2–3 frames, 3–5 power-iteration rounds. Stereo processes as a joint
   two-channel prediction when both channels are selected (better than
   per-channel), falling back to per-channel.
3. Optional suppression stage: exponential-decay late-reverb PSD estimate from
   a user-facing tail-length control, Wiener-style gain with a spectral floor
   and temporal gain smoothing to avoid musical noise.
4. Block-wise processing (~10 s blocks, ~2 s overlap-add) so memory stays
   bounded and progress is reportable per block.

### Parameters (kept small)

- **Amount** (0–100): maps to prediction order/iterations and suppression depth.
- **Reverb tail** (short/medium/long or ms): maps to delay and decay model.
- **Preserve dry** (dB floor): spectral floor for the suppression stage.

### Integration points (from the code map; all verified against current tree)

- New modules in a new directory, e.g.
  `src/common/editor/first-party-effects/dereverb/` (STFT, WPE core,
  suppression, params) — **not** appended to existing files:
  `src/common/editor/effects.js` is at 598/600 lines and
  `src/common/editor/controller/effect-audio-service.ts` at 597/600, so only
  minimal glue may touch them, or they must first be split per the standing
  oversize-file policy.
- Definition merged into `AUDIO_SELECTION_EFFECT_DEFINITIONS`
  (`src/common/editor/effects.js:186-192`), the same merge point
  `reviewed-utility-gain` uses.
- Menu: append the new type to the `noiseRepair` group
  (`src/common/editor/ui/application-menu-model.js:7`, "Noise removal and
  repair"), category `repair`.
- **Selection-only by default**: add nothing to `LIVE_TYPES` or
  `AUDACITY_RACK_EFFECT_TYPES`; add one explanatory entry to
  `SELECTION_ONLY_REASONS` (`src/common/editor/audacity-effects/live-capabilities.js:35-48`).
  No `effect-rack.ts` changes.
- Worker execution through the existing persistent selection-effects worker
  (`src/common/editor/selection-effects-worker.js`), with block-chunked
  progress copied from `applyReviewedUtilityGainSelectionOffline`
  (`src/common/editor/reviewed-effects/selection-effect.ts:56-82`) — plain DSP
  effects report no progress today and a whole-selection spectral effect must.
- Param presentation branches in
  `src/common/editor/ui/inspector/effect-helpers.ts` and i18n catalog entries.
- No `config/versioned-boundary-registry.json` entry: pure in-process DSP with
  no versioned boundary contract.

### Acceptance

- Deterministic fixture tests (Node): convolve a dry fixture with a synthetic
  decaying IR under a fixed seed; assert late-tail energy reduction beyond a
  bound, near-null pass-through on anechoic input, bit-stable output across
  runs, stereo/mono geometry, malformed-input rejection.
- Browser spec: menu reachability, `data-effect-*` hooks, progress and
  cancellation, undo — modeled on the Noise Reduction cases in
  `tests/browser/audio-editor-effects.spec.js`.
- Quality gate: on the bake-off corpus, Track A must beat the unprocessed
  baseline on SI-SDR and SIGMOS-REVERB for speech and must not degrade music
  (LSD within bound of unprocessed) at default settings.
- Playback/export parity duties are unaffected (selection effects render
  destructively before playback).

### Non-goals for Track A

No real-time/rack variant, no multi-microphone array processing, no acoustic
echo cancellation (different problem), no automatic room-profile capture pass
in v1 (WPE needs none; a capture-style two-pass UX like Noise Reduction's
profile is available later if a suppression-stage room estimate wants it).

## Track B — ML quality tier via milestone-7 local assistance

A "Reduce reverb (high quality)" assistance recipe rendering a **derived
source** the user auditions and swaps in — exactly the DeepFilterNet3/TIGER
shape from 7A-4 (docs/milestone-7-plan.md:895-911): geometry-exact WAV worker,
channel-preserving preparation, capacity preflight, original/result audition,
atomic Project Bin or range-replacement placement, original media untouched.
Electron-only, consent-gated, optional, individually removable — assistance
never becomes a dependency.

### Model selection (settled by the bake-off)

**Selected: anvuew dereverb_room** (BS-RoFormer, mono, 44.1 kHz, 118 MB,
sha256 2edec521…, weights GPL-3.0 via HF card metadata, MIT inference
framework). It won speech outright on every intrusive metric family, its
advantage held on plugin-style reverb, and its measured CPU RTF (~4.5 on the
owner workstation) fits an offline derived-source render. Stereo is handled
per-channel (the MVSEP precedent for this exact model). Known duties before
catalog admission: obtain/record a proper license text (the HF repo has only
a metadata tag), owned ONNX export via the upstream MSST exporter with parity
evidence, and verification that its STFT/attention ops run under the admitted
onnxruntime-node CPU EP — if they do not, the fallback is a pinned
Python-free native runner decision, which would be a new runtime-family
question for the owner, not a quiet addition.

Disposition of the rest of the slate, measured:

| Model | Bake-off outcome | Disposition |
| --- | --- | --- |
| SGMSE+ EARS-Reverb (MIT, **1.30 GB**) | best LSD/ViSQOL on speech; SI-SDR below baseline (generative resynthesis); RTF 3.7 GPU / ~188 CPU | **not shippable** under the CPU-only EP decision; recorded as watch item. Revisiting the GPU-EP exclusion is an explicit owner decision this plan does not make. Distillation (see Track C) is the credible future route. |
| MossFormer2_SE_48K (Apache-2.0) | weak dereverb (SIGMOS-REVERB +0.37); good denoiser but DFN3 is already cataloged | dropped for dereverb; no catalog entry |
| anvuew mel-band (GPL-3.0, 913 MB) | near-passthrough on speech; strips instruments on mixes | dropped; vocal-stem niche only |
| UVR-DeEcho-DeReverb / Reverb HQ (FoxJoy) | ~no speech improvement; music ≈ baseline | **blocked anyway** — no weights license grant; enters the milestone-7 excluded-weights table ("no license grant; author uncredited in UVR") |
| GTCRN DNS3 | modest 16 kHz-capped gains | not cataloged; browser-proven but bandwidth-disqualified |
| Music mode (any) | no candidate improves full mixes | **no music model ships**; the gap is recorded, with Track C as the only credible path |

### Work items

1. **Catalog + licensing:** signed entry in `config/local-model-catalog.json`
   (id, version, digest, byte size, license id, attribution) for the selected
   model(s); per-model license/provenance record for the `local-models` gate in
   `config/production-licensing-matrix.json`; FoxJoy weights added to the
   milestone-7 excluded-weights table; first-party R2 publication through the
   digest/read-back-verified publisher (upstream HF URLs recorded as
   provenance, never the shipped download path).
2. **Conversion + parity:** owned ONNX export with retained artifacts and
   parity fixtures per docs/milestone-7-model-conversion-reproduction.md, the
   same duty TIGER/Beat This carry today; conversion evidence rows in
   `config/milestone-7-model-conversion-execution.json`.
3. **Adapter:** a dereverb worker in the assistance helper (onnxruntime-node
   family, CPU EP), chunked with overlap-add, abortable at chunk boundaries
   (assistance.cancellationP95Ms ≤ 2000), background priority, typed
   unavailability until its runtime payload evidence closes — identical
   lifecycle to the DFN3 enhancement worker.
4. **Recipe + UI:** a "Reduce reverb" entry beside denoise in the Local
   Assistance dialog, sharing the 7A-4 audition/placement publishers; menu
   reachability only, no new always-visible chrome.
5. **Evidence:** fixture with known reverberant/dry pairs bounding SI-SDR /
   LSD improvement per shipped model; null-test bounds on dry regions;
   capacity preflight; privacy workload rows unchanged
   (`assistance.networkRequestsAfterInstall eq 0`).

### Stop conditions

Stop (ship fewer models, not trapped ones) if: the selected model's weights
cannot clear the licensing gate (the GPL tag needs a recorded license text);
conversion parity cannot be demonstrated; or the exported graph cannot run
under the admitted CPU EP within a tolerable offline budget (the measured
PyTorch CPU RTF is ~4.5 on the owner workstation; treat worse than ~30× real
time on the qualification host as the stop line). The GPU-EP exclusion stays
unless the owner explicitly revises the milestone-7 runtime decision.

## Track C — optional: train or distill our own model

The bake-off and the training-literature review together make a
train-our-own program credible but strictly optional. Recorded so the option
is concrete when wanted, not to commit to it:

- **The paradigm is standard, the niche is real.** Supervised pair training
  (dry audio × RIRs) is how every candidate above was built. The unclaimed
  territory is (a) full-mix music dereverb — the MSRBench benchmark (arXiv
  2510.10995) shows current architectures fail it, matching our bake-off —
  and (b) one model validated on both speech and music, which no paper
  claims.
- **Fine-tune, never from scratch.** Every good community dereverb checkpoint
  is a days-scale single-GPU fine-tune of an open separation model in the
  MSST framework (GPL-3.0, AGPL-compatible); from-scratch RoFormer training
  is A100-cluster territory.
- **Train on plugin reverb, not only rooms.** ReverbFX (arXiv 2505.20533)
  measured ~0.4 PESQ generalization loss for real-RIR-trained models on
  algorithmic reverb; its 1,846 plugin IRs are CC0. Our winning model's
  plate-condition dominance is consistent with training-set breadth mattering.
- **Data licensing is the bottleneck for released weights.** Dry 48 kHz
  speech is clean (VCTK, HiFiTTS-2, CC-BY). Dry music corpora are all NC or
  bespoke; released weights would follow policy (b)/(c): clean or synthesized
  stems for shipped weights, NC data only for unreleased experiments,
  provenance documented either way — consistent with this plan's licensing
  posture and the milestone-7 catalog rules.
- **Distillation is the future SGMSE+ route.** SB-UFOGen (Interspeech 2025)
  distilled a 50-step 48 kHz diffusion teacher into a 1-step student at
  matching quality on 4×24 GB GPUs; that is the credible path to a
  CPU-shippable generative tier, several weeks of effort, contingent on
  Phase-1/2 appetite.

## Sequencing

1. **A1** — Track A DSP core + fixtures (new modules only, no UI).
2. **A2** — Track A wiring: definition, menu, worker dispatch, progress,
   browser spec. Ships the always-available web effect.
3. **B1** — catalog/licensing/exclusion-table changes for anvuew
   dereverb_room (license-text resolution first — it can stop the track).
4. **B2** — conversion + parity evidence, including CPU-EP operability of the
   exported graph.
5. **B3** — helper adapter + recipe UI + evidence, riding 7A-4 machinery.
6. Optional **C** — the train/distill program above, phased (vocal fine-tune
   → full-mix attempt → distilled fast student), only on explicit owner
   go-ahead. No music model ships before then; the measured gap is the
   record.

A1/A2 have no dependency on milestone-7 payload evidence and can land first;
B-track packets follow milestone-7's own gating and do not block A.

## Non-goals and fences

- No acoustic echo cancellation, no multi-channel array dereverb, no
  real-time monitoring effect, no cloud inference.
- No WASM ML inference in the web tier under this plan (milestone-7 platform
  decision stands; a future reviewed-WASM ML package is a separately gated
  item).
- No NC-licensed weights (recorded decision above).
- No `audacity-*` namespace use and no fabricated upstream provenance.
- The 4A-5 "no new restoration DSP" fence is respected: Track A lands as its
  own packet, not a 4A-5 amendment.
