/* SPDX-License-Identifier: AGPL-3.0-only */

// Input and result buffers coexist in the 256 MiB WASM heap. Capping each
// side at 96 MiB leaves space for Nyquist's Lisp heap and delayed DSP nodes.
export const NYQUIST_MAX_TOTAL_AUDIO_SAMPLES = 24 * 1024 * 1024;
