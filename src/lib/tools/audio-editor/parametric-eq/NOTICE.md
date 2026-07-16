# Parametric EQ WebAssembly notices

Soundscaper's parametric EQ processor is repository-owned AGPL-3.0-only code.
It uses double-precision input-mixing trapezoidal SVF sections and accepts
semantic band parameters through a bounded C ABI. The native core performs the
matched design so it can apply log-domain one-pole smoothing and redesign TPT
targets every 16 samples without allocating in the audio callback.

## Signalsmith DSP design reference

- Source: <https://github.com/Signalsmith-Audio/dsp/tree/2d20161915e733f117545c6be8cd3275a739a1e3>
- Tag: `v1.7.1`
- Exact revision: `2d20161915e733f117545c6be8cd3275a739a1e3`
- Upstream license: MIT
- Copyright: 2021 Geraint Luff / Signalsmith Audio Ltd.

The minimal reference header in
[`native/vendor/signalsmith/vicanek_reference.h`](native/vendor/signalsmith/vicanek_reference.h)
contains only the matched peak, notch, low-pass, and high-pass design equations
needed to audit Soundscaper's independently implemented designer. Signalsmith's
direct-form audio processor and unrelated DSP modules are not bundled or used.
The full upstream terms are in
[`licenses/SIGNALSMITH-DSP.txt`](licenses/SIGNALSMITH-DSP.txt).

Soundscaper modifications made on 2026-07-16:

- extracted the required Vicanek design equations from `filters.h`;
- removed the direct-form processor and unrelated filter designs;
- calculate low-frequency denominator endpoints without subtractive cancellation;
- add matched two-pole shelving equations from Martin Vicanek's published work;
- convert designed SOS coefficients to a double-precision TPT/SVF realization;
- add fixed configuration banks, semantic smoothing, transition handling, and
  planar Web Audio I/O.

## Emscripten-linked runtime

The reproducible artifact is linked with Emscripten `3.1.64`. The Emscripten
compiler/runtime and bundled libc/compiler runtime retain their upstream
permissive terms. Their canonical copies already distributed with Soundscaper
are:

- [`../staffpad/licenses/EMSCRIPTEN.txt`](../staffpad/licenses/EMSCRIPTEN.txt)
- [`../staffpad/licenses/MUSL.txt`](../staffpad/licenses/MUSL.txt)
- [`../staffpad/licenses/LIBCXX.txt`](../staffpad/licenses/LIBCXX.txt)
- [`../staffpad/licenses/LIBCXXABI.txt`](../staffpad/licenses/LIBCXXABI.txt)
- [`../staffpad/licenses/COMPILER_RT.txt`](../staffpad/licenses/COMPILER_RT.txt)

Exact inputs, hashes, toolchain version, exports, and memory limits are recorded
in [`source-manifest.json`](source-manifest.json). Run
`node scripts/audit-parametric-eq-wasm.mjs` before distributing the artifact.
