# De-reverb bake-off evidence (2026-09-02)

Empirical head-to-head of seven open dereverberation candidates plus the
already-cataloged DeepFilterNet3, run on the owner workstation (RTX 3090,
24 GB; Linux/WSL2) against a purpose-built corpus. This document records the
methodology, the aggregate numbers, and the caveats; it is the evidence base
for docs/dereverb-plan.md. Raw per-item metrics, runner reports with artifact
digests, and the corpus manifest were produced in the session scratchpad; the
methodology below is sufficient to regenerate them.

## Corpus

46 reverberant test items with time-aligned dry references where applicable:

- **Speech (27 items, 48 kHz mono):** VCTK utterances (CC-BY-4.0, multiple
  speakers) convolved with MIT IR Survey room impulse responses (short /
  medium / long RT60) and a deterministic synthetic plate ("plugin-style")
  condition. RIR direct-path peak aligned to t=0; wet truncated to dry length.
- **Music (16 items, 44.1 kHz stereo):** MUSDB18-HQ vocal stems and full
  mixes (research license, local evaluation only) under the same real-RIR and
  plate conditions.
- **Real (3 items, 48 kHz):** genuinely reverberant station-PA speech
  recordings, no reference — scored with no-reference metrics only.

## Candidates and measured runtime cost

RTF = seconds of compute per second of audio (median). CPU numbers on the
same workstation; hosted-CI-class hardware will be slower.

| Candidate | Artifact | RTF GPU | RTF CPU |
| --- | --- | --- | --- |
| WPE (nara_wpe, taps 10, delay 3, 5 iter) | none (pure DSP) | — | 0.045 |
| GTCRN (DNS3 ckpt, 16 kHz round-trip) | 0.6 MB | — | 0.021 |
| DeepFilterNet3 (0.5.6) | ~10 MB | — | 0.017 |
| MossFormer2_SE_48K (ClearerVoice) | 222 MB (sha256 03692b9f…) | 0.029 | 0.129 |
| SGMSE+ EARS-Reverb 48 k (N=30, pc/ald) | **1.30 GB** (sha256 9be62a3d…) | 3.68 | **187.7** (one clip) |
| anvuew dereverb_room (BS-RoFormer, mono) | 118 MB (sha256 2edec521…) | 0.048 | **4.47** |
| anvuew dereverb mel-band RoFormer (19.17 ckpt) | 913 MB | 0.105 | not measured |
| UVR-DeEcho-DeReverb (FoxJoy) | 224 MB | 0.397 | (recorded 0.002 — implausible, treat as unmeasured) |

Provenance notes: the SGMSE+ checkpoint was fetched from a community HF
mirror whose source pointer matches the official sp-uhh Google Drive folder;
an official-source fetch and digest is required before any catalog use. The
SGMSE+ size corrects the research-phase "~450 MB class" estimate.

## Speech results (27 items, means; ↑ better except LSD ↓)

| candidate | SI-SDR dB | PESQ-WB | STOI | ESTOI | LSD dB | ViSQOL | SIGMOS-REVERB | SIGMOS-OVRL | DNSMOS-OVRL |
|---|---|---|---|---|---|---|---|---|---|
| unprocessed | -8.72 | 1.57 | 0.716 | 0.445 | 7.66 | 2.60 | 2.53 | 2.58 | 2.35 |
| wpe | -8.59 | 1.61 | 0.729 | 0.468 | 7.56 | 2.65 | 2.63 | 2.63 | 2.41 |
| gtcrn | -8.38 | 1.72 | 0.715 | 0.467 | 8.65 | 2.00 | 3.48 | 3.01 | 2.65 |
| dfn3 | -7.93 | 1.82 | 0.713 | 0.492 | 8.03 | 2.66 | 3.81 | 3.35 | 2.77 |
| mossformer2 | -8.39 | 1.68 | 0.740 | 0.505 | 7.21 | 2.63 | 2.90 | 2.98 | 2.72 |
| sgmse | -11.53 | 1.70 | 0.777 | 0.584 | **6.10** | **3.37** | 4.21 | 2.89 | 2.59 |
| anvuew-mel | -8.72 | 1.57 | 0.716 | 0.445 | 7.72 | 2.59 | 2.56 | 2.64 | 2.35 |
| **anvuew-room** | **-4.29** | **2.89** | **0.907** | **0.783** | 7.21 | 2.84 | **4.46** | 3.34 | **3.07** |
| uvr-deecho-dereverb | -8.41 | 1.70 | 0.721 | 0.466 | 7.48 | 2.58 | 2.76 | 2.77 | 2.56 |

By condition (SI-SDR / PESQ / ESTOI): anvuew-room wins both — real-RIR
-4.37/3.05/0.809 and plate -3.65/1.61/0.573 (baseline: -8.26/1.61/0.475 and
-12.41/1.22/0.204). It is the only candidate whose advantage *grows* on the
plugin-style condition.

## Music results (16 items)

| candidate | SI-SDR dB ↑ | LSD dB ↓ | MR-STFT ↓ | ViSQOL ↑ |
|---|---|---|---|---|
| unprocessed | -10.15 | 9.48 | 6.39 | 3.17 |
| wpe | -12.12 | **9.19** | **5.95** | 3.26 |
| gtcrn | -12.44 | 16.90 | 14.84 | 1.54 |
| dfn3 | -16.65 | 18.41 | 13.96 | 2.31 |
| mossformer2 | -12.37 | 13.05 | 9.07 | 2.82 |
| sgmse | -18.48 | 10.70 | 8.61 | **3.28** |
| anvuew-mel | -13.57 | 15.89 | 15.26 | (n/a) |
| anvuew-room | -10.77 | 15.54 | 10.54 | 3.22 |
| uvr-deecho-dereverb | **-10.08** | 9.97 | 7.77 | 3.08 |

## Real recordings (3 items, no reference)

| candidate | SIGMOS-REVERB | SIGMOS-OVRL | DNSMOS-OVRL | DNSMOS-BAK |
|---|---|---|---|---|
| unprocessed | 2.73 | 1.72 | 1.34 | 1.29 |
| wpe | 2.87 | 1.74 | 1.31 | 1.27 |
| gtcrn | 2.88 | 2.18 | 2.25 | 3.58 |
| dfn3 | 3.42 | **2.52** | **2.58** | **3.79** |
| mossformer2 | **3.60** | 2.50 | 2.52 | 3.27 |
| sgmse | 3.26 | 2.18 | 1.46 | 1.55 |
| anvuew-room | 3.24 | 1.83 | 1.80 | 1.93 |
| uvr-deecho-dereverb | 2.73 | 1.69 | 1.45 | 1.40 |

These real items carry heavy noise as well as reverb, which favors the
denoisers (DFN3, MossFormer2) on OVRL/BAK; anvuew-room removes reverb but not
noise.

## What the numbers say

1. **anvuew dereverb_room is the clear speech winner** — the only candidate
   that transforms every intrusive metric family at once (SI-SDR +4.4 dB,
   PESQ +1.32, ESTOI +0.34, SIGMOS-REVERB +1.93 over baseline), on real *and*
   plugin reverb, at 118 MB and a tolerable CPU cost (RTF ≈ 4.5).
2. **SGMSE+ is perceptually strong but operationally disqualifying**: best
   LSD/ViSQOL/ESTOI-after-room, but SI-SDR *below baseline* (generative
   resynthesis penalty — it invents a waveform rather than restoring one) and
   RTF 3.7 GPU / ~188 CPU. Under milestone-7's CPU-only execution-provider
   decision it is unshippable.
3. **The community-favorite anvuew mel-band model is a no-op on plain speech**
   (output ≈ input, max sample diff ~0.001) and destructive on full mixes (it
   is a vocal-stem separator; it strips instruments). Its reputation lives
   entirely on isolated vocal stems.
4. **Nobody wins on music.** Every ML candidate degrades full mixes
   (instrument stripping, spectral damage); the only "improvements" are WPE's
   marginal LSD/MR-STFT/ViSQOL gains. The published-literature gap ("no
   validated open music dereverb model") is confirmed empirically.
5. **MossFormer2's implied dereverb ability is weak** (SIGMOS-REVERB 2.90 vs
   baseline 2.53) — the training-data-composition theory did not cash out.
   DFN3, already cataloged, is a better no-reference improver than MossFormer2
   on speech and needs no new catalog entry.
6. **WPE at conventional settings is honest but mild** (ΔSIGMOS-REVERB +0.10,
   ΔESTOI +0.02 on speech) — a safe deterministic floor, not a headline
   effect. Late-suppression post-processing (unbenchmarked here) is where a
   deterministic Track A must earn its keep.

## Caveats

- Objective metrics only; **no blind listening happened**. VoiceFixer's
  literature shows objective/subjective rank inversions are possible.
  Audition before shipping defaults.
- The VCTK "dry" references are studio-dry, not anechoic; ceiling effects
  compress all speech deltas.
- Baseline SI-SDR is very low (wet corpus by design); absolute values matter
  less than deltas.
- The UVR CPU RTF record (0.002) is implausible and treated as a logging
  artifact; its GPU figure (0.397, n=4) is also thin.
- Real-recording set is n=3 and noise-confounded.
- SGMSE+ ran at N=30 steps (repo default guidance for the 48 k checkpoint);
  N=50 might score slightly better and ~1.7× slower.
- anvuew-mel music aggregates mix vocal-stem items (where it is in-domain)
  with full mixes (where it is not); its full-mix numbers dominate the mean.
- ViSQOL failed on some anvuew-mel items (NaN); its music column has holes.
