# @dilsonspickles/components

## 0.10.1 — 2026-07-23

### Fixed — dark mode

- **Add-new track button** no longer stuck on light-grey CSS fallbacks in dark mode (`TrackControlSidePanel` now wires `--tcsp-add-btn-bg-*` from a new `trackHeader.addButton` token; light theme keeps the original greys).
- **Dropdown** trigger and open menu backgrounds were hardcoded white; now sourced from `background.control.input.idle` (dark surface in dark mode, unchanged `#FFFFFF` in light).
- **SearchField** background was hardcoded white; same fix (themed input surface; light unchanged).
- **TimeCode** dark-variant chip background is now `#171F25` in dark mode (via the `background.control.timecode` token), `#212433` in light — unchanged.

All fixes keep light-theme output pixel-identical; only dark mode is affected. No API changes.

### Changed — BEHAVIORAL

- **`generateSpeechWaveform` default `samplesPerSecond` lowered 50,000 → 1,000; `generateSineWave` default lowered 2,000 → 1,000.** Waveform rendering derives the sample rate from array length, so rendered peaks are visually identical at any density above ~10–20 samples per rendered pixel — but the returned **array length changes** for callers that omit the argument (e.g. `generateSpeechWaveform(11)` now returns 11,000 floats instead of 550,000). Callers depending on the old array length must pass `samplesPerSecond` explicitly. Motivation: the 50k default caused multi-second synchronous main-thread stalls in downstream consumers; every internal call site already passed 500–1,800 explicitly.

### Added

- `generateSpeechWaveform` accepts an optional third argument `{ seed }` for deterministic output (same duration + samplesPerSecond + seed → identical array). The first parameter is duration in **seconds** — it was never a seed, despite downstream code repeatedly treating it as one.
- Dev-only `console.warn` when any waveform generator produces more than 100,000 samples, pointing at the `samplesPerSecond` argument (suppressed when `NODE_ENV === 'production'`).
