# anvuew dereverb_room ONNX conversion record

BS-RoFormer dereverberation model (mono, 44.1 kHz), converted to an owned
opset-17 ONNX neural core plus owned pre/post DSP, with CPU parity and
operability evidence for the milestone-7 catalog (docs/dereverb-plan.md,
Track B; selection evidence in docs/dereverb-bakeoff-evidence.md). Executed
2026-09-02 on the owner workstation in a session scratch directory ($C below;
the de-reverb bake-off's scratch assets are $B). This is an external run
record in the style of docs/milestone-7-model-conversion-reproduction.md; it
does not by itself authorize a production catalog entry — the register rows
stay pending-external until the locked `soundscaper-model-conversion-v1`
toolchain reproduces it and the catalog is externally signed. Every digest,
command, and DSP constant needed to reproduce the run is recorded here.

## Source artifacts

| artifact | bytes | sha256 |
|---|---|---|
| `dereverb_room_anvuew_sdr_13.7432.ckpt` (HF anvuew/dereverb_room) | 118128452 | `2edec521f09e26341c1923dc82c8c52dbc86478b42b9999f679535743c970cb3` |
| `dereverb_room_anvuew.yaml` (same repo) | 1991 | `c37e3039521d79cd1daff129857f69fa80c6a1f383a0fe8cda757f2dfc5032f8` |

Both taken from `$B/downloads/anvuew_room/` (downloaded during the bake-off;
digests re-verified this run). Model architecture per the yaml: BS-RoFormer,
dim 128, depth 16, mono (`stereo: false`), 1 stem (`noreverb` target),
`chunk_size` 384000, `n_fft` 2048, `stft_hop_length` 512, `num_overlap` 2.

## Exporter provenance

- Exporter: `github.com/ZFTurbo/MSS_ONNX_TensorRT`, commit
  `43d939e7671d8ff6cf1922f98c2f2e4b56908e47` (2025-06-17), cloned to
  `$C/MSS_ONNX_TensorRT`. Its `export_to_onnx.py` splits BS-RoFormer at the
  spectrogram boundary: the graph is the neural core from
  `models_without_stft/bs_roformer_no_stft.py` (band split -> 16 axial
  time/freq transformer layers -> mask estimator); STFT before and
  mask-multiply + ISTFT after remain outside the graph (its
  `models/preprocess.py` `BS_roformer_processor`), because ONNX has no ISTFT.
- PyTorch source of truth for parity: `ZFTurbo/Music-Source-Separation-Training`
  commit `0e5f1159fc5ea87fc13b957584e178b4977e5dd3` at `$B/msst` (the bake-off
  runner), `utils.model_utils.demix` generic mode.
- The checkpoint state_dict loads into the exporter's no-STFT module with a
  strict `load_state_dict` (exporter `utils.load_start_checkpoint`,
  `weights_only=True`), which pins architecture equivalence with MSST.

### Command and recorded deviations

Driver: `$C/export_room.py`, run as

```sh
env/bin/python export_room.py            # => dereverb_room_anvuew_core.onnx
```

It invokes the upstream `ModelExporter.export` (equivalent verbatim invocation:
`python export_to_onnx.py --model_type bs_roformer --config_path
dereverb_room_anvuew.yaml --checkpoint_path dereverb_room_anvuew_sdr_13.7432.ckpt
--output_path dereverb_room_anvuew_core.onnx --opset_version 17`), with three
recorded deviations, each commented in the driver:

1. Import shims: upstream `utils.py` imports `tensorrt`/`pycuda` and
   `models/preprocess.py` imports `demucs` at module top level; none are used
   on the bs_roformer path. Stub modules (with proper `__spec__`) are injected
   so the unmodified exporter code imports.
2. Mono dummy input: upstream `_get_input_shape()` hardcodes `(1, 2,
   chunk_size)` (stereo) and its own `BS_roformer_processor.stft` asserts
   channels == 1 for a mono model, so the verbatim script cannot export this
   checkpoint. The subclass returns `(1, num_channels=1, chunk_size)`.
3. Legacy TorchScript exporter forced (`dynamo=False`). torch 2.13 defaults to
   the dynamo exporter, which refuses opset 17 (implements >= 18; its 18->17
   down-conversion fails on a ReduceX axes adapter) and writes weights to an
   external `.onnx.data` that ORT 1.29 then fails to shape-infer
   (`Cannot parse data from external tensors ... val_0`). The TorchScript path
   — the default on the exporter's own documented torch versions (>= 2.0.1,
   pre-2.9) — emits a true single-file opset-17 graph.

Additionally `use_torch_checkpoint` (training-time gradient checkpointing,
numerically identity) is disabled on the constructed module before tracing.

Upstream's built-in check asserts only rtol 5e-1 / atol 1e-1; the driver also
records a tight comparison: max abs diff torch-vs-ORT mask on a fixed random
chunk = **2.17e-05** (`export_record.json`).

## Converted output

| file | bytes | sha256 |
|---|---|---|
| `dereverb_room_anvuew_core.onnx` | 119025277 | `8fe6620a716019092525e569bd4bef7d1aa368e11a7c85549cd6b2408ae5d6b8` |

Graph: ir_version 8, single opset import `ai.onnx` **17**, no custom domains,
no external tensor data, producer `pytorch 2.13.0`, 7344 nodes, **fixed shape**
(chunk_size 384000 baked in; batch 1):

| tensor | direction | dtype | shape | meaning |
|---|---|---|---|---|
| `input` | input | float32 | (1, 751, 2050) | complex STFT of one 384000-sample chunk, packed per frame as `[Re(f0), Im(f0), Re(f1), Im(f1), ...]` (f-major, 1025 bins x 2) |
| `output` | output | float32 | (1, 1, 1025, 751, 2) | complex mask (stem, freq, frame, re/im); estimate = mask * spectrogram |

## Environment

- Machine: AMD Ryzen 9 9900X (24 threads), 68 GB RAM, Linux (WSL2). All
  conversion/parity/operability runs CPU-only; no CUDA provider anywhere.
- Export/parity venv `$C/env` (uv, CPython 3.11.16): torch 2.13.0+cpu,
  onnx 1.22.0, onnxscript 0.7.1, onnxruntime **1.29.0** (CPU package;
  providers Azure/CPU only), numpy 2.4.6, einops 0.8.2,
  rotary-embedding-torch 0.6.5, beartype 0.18.5, ml-collections 1.1.0,
  omegaconf 2.3.1, soundfile 0.14.0, soxr 1.1.0, librosa 0.11.0,
  loralib 0.1.2. einops/rotary/beartype pinned to the same versions as the
  bake-off MSST env so the traced module matches the reference numerics.
- PyTorch fp32 CPU reference runs: the bake-off env `$B/envs/anvuew`
  (torch 2.13.0+cu130 executed with `--device cpu`; the `torch.cuda.amp.autocast`
  wrapper is inert on CPU tensors, so these are fp32).
- Node: v26.5.0, onnxruntime-node **1.29.0** installed in `$C` only
  (`npm init -y && npm i onnxruntime-node`); the Soundscaper repo has no
  onnxruntime-node (only sherpa-onnx), and the repo was not touched.

## Owned DSP specification (what TypeScript must implement)

Validated against torch.stft/istft to 4.5e-15 / 6.9e-17 max abs diff
(`selfcheck_dsp.py`); reference implementation `dsp_room.py` (numpy only).

Constants: `N_FFT = WIN = 2048`, `HOP = 512`, `CHUNK = 384000`,
`NUM_OVERLAP = 2`, `STEP = CHUNK/NUM_OVERLAP = 192000`,
`BORDER = CHUNK - STEP = 192000`, `FADE = CHUNK/10 = 38400`,
`FREQS = 1025`, `FRAMES = CHUNK/HOP + 1 = 751`.

Window: periodic Hann, `w[n] = 0.5 - 0.5*cos(2*pi*n/2048)`, n = 0..2047
(`torch.hann_window(2048)`).

STFT of a 384000-sample chunk: reflect-pad 1024 samples each side (no edge
repeat); 751 frames at starts `t*512` in the padded signal; each frame
windowed then rFFT (2048 -> 1025 bins, not normalized, onesided).

Graph input packing: `input[0, t, 2*f + c]` = Re (c=0) / Im (c=1) of bin f at
frame t.

Mask application: `est_spec[f, t] = complex(output[0,0,f,t,0], output[0,0,f,t,1])
* spec[f, t]`.

ISTFT: per frame irFFT (2048), multiply by the same window, overlap-add at
`t*512`; divide each sample by the overlap-added squared window where that
envelope > ~1e-11; take samples `[1024, 1024+384000)`.

Chunking (port of MSST `demix` generic mode, batch 1):

1. Given mono 44.1 kHz signal of length L: if `L > 2*BORDER` (i.e. > 384000),
   reflect-pad by BORDER on both ends.
2. Chunks start at `i = 0, STEP, 2*STEP, ...` while `i < padded_length`.
   Each chunk `x[i : i+CHUNK]`; a short tail chunk of length `n` is
   reflect-padded to CHUNK when `n > CHUNK/2`, else zero-padded.
3. Per chunk apply STFT -> graph -> mask -> ISTFT, then overlap-add the first
   `n` samples weighted by a fade window: ones with linear ramps 0->1 over the
   first FADE samples and 1->0 over the last FADE samples
   (`linspace(0,1,38400)`), except the first chunk keeps its head at 1 and the
   final chunk (the one after whose step `i >= padded_length`) keeps its tail
   at 1. Accumulate `sum(out*w)` and `sum(w)`; divide; NaN -> 0.
4. Strip the BORDER padding if applied in step 1.

Item-level protocol (identical to the bake-off runner): inputs resampled to
44.1 kHz with soxr VHQ (float64); stereo processed per channel through the
mono pipeline; output resampled back to the source rate with soxr VHQ, trimmed
or zero-padded to the exact source length, clipped to [-1, 1].

## Parity evidence

Pipeline under test: `run_onnx_room.py` = ONNX core (Python onnxruntime 1.29.0,
CPUExecutionProvider) + the owned numpy DSP above, consuming the bake-off's
prepared 44.1k inputs (`$B/work/anvuew/in_room`) and writing PCM_24 like the
reference runner. Comparison: `parity_compare.py` (max abs sample diff and
SI-SDR(pytorch_out, onnx_out) per channel). Six items, 3 speech48 + 3 music44,
mixed RIRs.

Against the bake-off PyTorch reference (`$B/out/anvuew-room`, GPU with fp16
autocast — the catalog bake-off artifacts) [`parity_vs_bakeoff_gpu.json`]:

| item | max abs diff | SI-SDR dB (per ch) |
|---|---|---|
| s01__mit-medium | 4.70e-04 | 53.28 |
| s02__mit-long | 7.95e-04 | 46.31 |
| s09__plate | 5.17e-04 | 41.60 |
| m01__plate | 3.50e-04 | 42.32 / 43.45 |
| m02__mit-medium | 8.36e-04 | 56.76 / 57.55 |
| m03__mit-long | 2.38e-03 | 51.14 / 49.20 |

Against a PyTorch fp32 CPU reference (same MSST code, `--device cpu`;
`$C/torch_cpu_ref`, two items reused from the bake-off's own CPU verification,
four generated this run) [`parity_vs_torch_cpu_fp32.json`]:

| item | max abs diff | SI-SDR dB (per ch) |
|---|---|---|
| s01__mit-medium | 3.73e-04 | 54.41 |
| s02__mit-long | 7.95e-04 | 46.51 |
| s09__plate | 4.07e-04 | 43.50 |
| m01__plate | 3.44e-04 | 44.40 / 47.22 |
| m02__mit-medium | 4.66e-04 | 66.50 / 65.75 |
| m03__mit-long | 4.43e-04 | 58.74 / 57.04 |

Target (SI-SDR > 40 dB or max abs diff < 1e-3): **met on every item against
both references** — SI-SDR is above 40 dB everywhere (worst 41.6 dB vs the
fp16-autocast reference, 43.5 dB vs fp32). Against fp32 the max abs diff is
also < 1e-3 on every item; the single 2.38e-03 outlier (m03 vs the GPU
reference) is fp16-autocast noise in that reference, not conversion error —
the same output vs the fp32 reference is 4.43e-04. The remaining fp32 residual
(~44-66 dB rather than bit-exactness) is fp32 reassociation between ORT and
torch kernels through 16 transformer layers; the graph itself reproduces the
traced module to 2.17e-05 (mask domain).

## CPU operability and RTF

Stop line: 30x realtime. PyTorch CPU measured ~1.9-7.1x in the bake-off.

Python onnxruntime 1.29.0 CPU EP (24 threads, ORT defaults), full owned
pipeline end-to-end (`out_onnx/timings.json`; session load 1.1 s):

| item | audio s (mono-equivalent) | wall s | x realtime per mono audio s |
|---|---|---|---|
| s01__mit-medium | 4.06 | 10.2 | 2.51 |
| s02__mit-long | 8.37 | 19.9 | 2.38 |
| s09__plate | 4.40 | 17.8 | 4.04 |
| m01__plate | 20.0 (2 ch) | 118.2 | 5.91 (contended: overlapped the torch ref run) |
| m02__mit-medium | 20.0 (2 ch) | 67.3 | 3.37 (partially contended) |
| m03__mit-long | 20.0 (2 ch) | 60.0 | 3.00 (uncontended) |

Uncontended single-chunk graph run: Python ORT 6.49 s, Node ORT 6.45 s per
384000-sample chunk. Everything is far inside the 30x stop line, in the same
band as PyTorch CPU.

Node operability (decisive check, `node-check.mjs` + `make_node_fixture.py`):
onnxruntime-node 1.29.0, CPU EP, loads the 119 MB graph in 0.55 s, runs one
real chunk (chunk 0 of s01__mit-medium) in 6.45 s, and its output is
**bit-identical** (max abs diff 0.0) to Python ORT 1.29.0 on the same input
tensors — same upstream ORT build. Loads: yes. Runs: yes. Matches within
1e-4: yes (exactly).

## Files in this record ($C)

| file | role |
|---|---|
| `dereverb_room_anvuew_core.onnx` | converted graph (digest above) |
| `export_room.py`, `export.log`, `export_record.json` | export driver, log, machine-readable export record |
| `dsp_room.py` | owned DSP reference implementation (numpy) |
| `selfcheck_dsp.py` | STFT/ISTFT unit check vs torch |
| `run_onnx_room.py`, `out_onnx/` | full-pipeline runner, outputs + timings |
| `parity_compare.py`, `parity_vs_bakeoff_gpu.json`, `parity_vs_torch_cpu_fp32.json` | parity script and tables |
| `make_node_fixture.py`, `node-check.mjs`, `node_fixture/` | Node operability check (input/expected/node output .bin + descriptor) |
| `torch_cpu_ref/` | PyTorch fp32 CPU reference outputs + timings |
| `MSS_ONNX_TensorRT/` | exporter clone at the recorded commit |
| `env/`, `package.json`, `node_modules/` | pinned Python venv; onnxruntime-node 1.29.0 |

## Open residuals

1. The graph is fixed-shape (batch 1, chunk 384000). Fine for the runner
   design; a different chunk size requires re-export.
2. Parity is ~44-66 dB SI-SDR vs fp32 PyTorch, not bit-exact — fp32
   reassociation across ORT vs torch kernels. No indication of a structural
   defect (mask-domain export check 2.17e-05).
3. The exported opset-17 graph was produced by torch 2.13's deprecated
   TorchScript exporter path; a future toolchain re-run on torch >= 2.9 dynamo
   would land on opset 18 and external weights unless torch is pinned pre-2.9
   or the down-conversion bug is fixed upstream.
4. RTF measured on the owner-designated qualification host (Ryzen 9 9900X, 24
   threads). Hosted-CI-class hardware will be slower; margin to the 30x stop
   line is ~10x, so this is comfortable but unmeasured there.
5. Upstream MD5/SHA-1 for the checkpoint were not published; the SHA-256 above
   is the bake-off download's digest, re-verified locally this run.
6. This record was produced by the standalone driver in $C, not by the
   repository's `soundscaper-model-conversion-v1` locked module. The repo-side
   registers and tool support have since landed (`dereverb-room` rows in
   config/milestone-7-model-supply-candidates.json,
   config/milestone-7-model-parity-fixtures.json,
   config/milestone-7-model-conversion-execution.json, and the
   `soundscaper_m7_conversion` exporter/runner); the authoritative
   locked-toolchain re-run that fills the pending digests remains external.
   Note the locked toolchain pins rotary-embedding-torch 0.8.5 while this run
   used 0.6.5; the strict state_dict load pins the architecture either way,
   and the re-run will re-measure parity under the locked pin.
