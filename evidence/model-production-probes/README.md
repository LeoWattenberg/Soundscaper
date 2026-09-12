# Actual production-worker smoke results

These observations use real model files and production TypeScript workers on
Linux x64 under WSL2. ONNX models ran with the packaged ONNX Runtime 1.29.0 CPU
engine. Qwen ran with the built llama.cpp b10509 CPU completion helper.
Inputs come from the licensed/synthesized fixtures used by the nightly model
suite. Retained outputs are observations, not golden predictions to which
future inference must match exactly.

The two Beat This results are retained together in
[`production-worker-smoke.json`](../milestone-7-model-conversion/beat-this/production-worker-smoke.json).
Both produce 32 beats within the 16-second fixture, eight downbeats, and a
120 BPM proposal after the selection-end regression was fixed.

Direct worker execution does not exercise signed-catalog admission, Model
Manager downloads, or Electron IPC. Those remain the job of the required
nightly-with-tests package cases. These records also do not establish accuracy,
perceptual quality, licensing permission, or cross-platform performance.

The audio smoke checks require preserved geometry, finite changed samples,
and non-silence for every expected output. Other checks use the same semantic
reviewers and bounds as the nightly cases. See the generated model guides and
`docs/local-model-nightly-tests.md` for their exact fixture and validation rules.
