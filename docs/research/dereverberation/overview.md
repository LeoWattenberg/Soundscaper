# Dereverberation

Soundscaper has one implemented high-quality dereverberation route and one
unimplemented deterministic design:

- **Reduce Reverb** is an optional desktop local-assistance workflow backed by
  the cataloged `dereverb-room` model. It renders a derived source for audition
  and explicit placement; the original remains untouched.
- A first-party WPE-style selection effect for web and desktop remains a
  research proposal. No product or roadmap commitment follows from the design
  below.

The selection followed a local seven-candidate empirical comparison. Full
measurements and caveats are in the [bake-off record](bakeoff.md), and the
selected model's reproducible export is in the
[ONNX conversion record](onnx-conversion.md).

## Product boundary

Dereverberation removes room reflections from already-recorded speech or music.
It is an offline operation, not acoustic echo cancellation or realtime
monitoring. Model inference is local, optional, consent-gated, and desktop-only.
It follows the common [local-assistance architecture](../../architecture/local-assistance.md)
and [model provenance policy](../../reference/local-model-provenance.md).

No non-commercial or research-only weights are admitted. The selected
`dereverb-room` weights declare GPL-3.0; the inference framework and converter
carry their separately recorded terms. License texts, source directions,
artifact identity, conversion recipe, parity evidence, and catalog publication
must remain bound through the ordinary model supply-chain registers.

## What the bake-off established

The compared field included deterministic WPE, SGMSE+, MossFormer2,
`dereverb-room`, a larger mel-band RoFormer, unlicensed UVR variants, GTCRN, and
the already cataloged DeepFilterNet3 denoiser.

The decision-relevant results were:

1. `dereverb-room` was the only candidate to improve every measured intrusive
   speech metric family at once. Its advantage held for room and plugin-style
   reverberation, and its size and offline CPU cost fit the local-assistance
   derived-source workflow.
2. SGMSE+ produced strong perceptual scores but was too slow for the admitted
   CPU-only execution boundary and behaved as generative resynthesis rather
   than a faithful editor transform.
3. The larger community mel-band model was close to pass-through on plain
   speech and removed instruments from full mixes.
4. MossFormer2 did not demonstrate the hoped-for dereverberation behavior, and
   DeepFilterNet3 remained the more useful existing noise-enhancement route.
5. No model improved full-mix music consistently. The product therefore makes
   no general music-dereverberation claim.
6. Conventional WPE was honest but mild: useful as a deterministic floor, not
   as evidence for a headline effect by itself.

These are objective fixture results, not a substitute for blind listening or a
general claim about recordings outside the corpus.

## Implemented model route

The selected BS-RoFormer model is mono at 44.1 kHz and is applied per channel
for stereo media. The repository-owned signal layer performs the exact STFT,
normalization, chunking, overlap, and reconstruction expected by the exported
neural core. Its fixed-memory streaming geometry is cross-checked against the
conversion reference.

The owned opset-17 ONNX export runs under the selected ONNX Runtime CPU engine.
Conversion evidence measured close source-framework parity and an offline CPU
cost within the recorded stop line. Exact figures, artifact hashes, exporter
environment, and residual limits belong in the conversion record rather than
this architectural summary.

The desktop adapter is abortable and publishes only through the common
assistance custody, review, acceptance, and placement path. It can add the
derived result to the Project Bin or replace the selected range after explicit
acceptance. Network access after installation remains forbidden.

## Deterministic effect proposal

A future always-available effect could implement delayed linear prediction for
late-reverberation removal, followed by an optional spectral-suppression stage:

1. Transform the selection with a roughly 21 ms STFT window and 25% hop.
2. For each frequency bin, predict the late tail from delayed prior frames and
   subtract it. Joint stereo prediction is preferred when both channels are
   selected; mono remains supported.
3. Optionally estimate an exponentially decaying late-reverb spectrum and apply
   a smoothed Wiener-style gain with a dry-signal floor.
4. Process bounded overlapping regions so cancellation, progress, and memory
   use remain predictable.

The exposed parameter set should stay small: amount, approximate reverb-tail
length, and a dry-preservation floor. It would be an original first-party
selection effect, not an `audacity-*` effect and not a realtime rack processor.
It must be reachable through the existing noise-removal and repair menu.

Before implementation is accepted, deterministic fixtures must prove late-tail
reduction, stable output, dry-input restraint, channel geometry, bounded
processing, cancellation, and undo. Defaults must beat the reverberant speech
baseline without materially degrading the music corpus. If the added
suppression stage cannot meet that bar, the effect should remain absent rather
than ship a misleading control.

## Explicit non-goals

- cloud inference or implicit model downloads;
- realtime monitoring, acoustic echo cancellation, or microphone-array
  processing;
- non-commercial or weights without an affirmative license grant;
- a claim that current models restore general full-mix music; and
- a browser ML route under the present desktop-only local-assistance policy.
