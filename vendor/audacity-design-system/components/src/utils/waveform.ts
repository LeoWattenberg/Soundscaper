/**
 * Waveform generation utilities for Storybook stories and testing
 *
 * Rendering is resolution-independent: consumers (Clip/TrackNew) derive the
 * sample rate from array length, so density beyond ~10-20 samples per rendered
 * pixel is visually identical and only costs generation + redraw time.
 */

// This package's tsconfig has no Node types; the typeof guard makes the
// runtime access safe, and the literal `process.env.NODE_ENV` form stays
// statically replaceable by bundlers (Vite/esbuild define).
declare const process: { env: { NODE_ENV?: string } };

/** Warn (dev only) when a generated waveform is large enough to stall the main thread. */
const OVERSIZED_WAVEFORM_SAMPLES = 100_000;

const warnIfOversized = (fnName: string, sampleCount: number): void => {
  if (
    sampleCount > OVERSIZED_WAVEFORM_SAMPLES &&
    typeof process !== 'undefined' &&
    process.env.NODE_ENV !== 'production'
  ) {
    console.warn(
      `${fnName}: generating ${sampleCount.toLocaleString()} samples. ` +
        `Rendering derives sample rate from array length, so this density is rarely needed — ` +
        `pass a smaller samplesPerSecond argument (consumers render identically at ~500-2000).`
    );
  }
};

/** mulberry32 — tiny deterministic PRNG for seeded waveform variation */
const createSeededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export interface SpeechWaveformOptions {
  /**
   * Seed for deterministic output. Same duration + samplesPerSecond + seed
   * always yields the same array; omit for Math.random()-based variation.
   */
  seed?: number;
}

/**
 * Generate realistic speech-like waveform data
 * Creates waveform with syllable-like patterns and voice formants
 * Matching the prototype demo appearance
 *
 * @param duration Duration of the clip in SECONDS (not a seed — for
 *   deterministic variation between clips, pass `options.seed`)
 * @param samplesPerSecond Sample density (default: 1000). Peaks render
 *   identically at any density ≥ ~10-20 samples per rendered pixel; only pass
 *   a larger value if you truly need denser data.
 * @param options Optional `{ seed }` for deterministic output
 * @returns Array of normalized waveform values (-1 to 1)
 */
export const generateSpeechWaveform = (
  duration: number,
  samplesPerSecond: number = 1000,
  options: SpeechWaveformOptions = {}
): number[] => {
  const sampleCount = Math.floor(duration * samplesPerSecond);
  warnIfOversized('generateSpeechWaveform', sampleCount);
  const random =
    options.seed !== undefined ? createSeededRandom(options.seed) : Math.random;
  const waveform: number[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleCount;

    // Speech envelope: syllable-like patterns with sentence-level variation
    const speechEnvelope =
      Math.abs(Math.sin(t * Math.PI * 3 + random() * 0.5)) *
      (0.3 + Math.abs(Math.sin(t * Math.PI * 0.5)) * 0.7) *
      (0.5 + random() * 0.5);

    // High-frequency content (voice formants)
    const voiceContent =
      Math.sin(t * Math.PI * 200 + random() * 2) * 0.4 +
      Math.sin(t * Math.PI * 500 + random() * 3) * 0.3 +
      Math.sin(t * Math.PI * 1200 + random() * 5) * 0.2 +
      (random() - 0.5) * 0.3;

    const value = voiceContent * speechEnvelope;
    waveform.push(Math.max(-1, Math.min(1, value)));
  }

  return waveform;
};

/**
 * Generate simple decaying sine wave waveform
 * Useful for simple demonstrations
 *
 * @param duration Duration in SECONDS
 * @param samplesPerSecond Number of samples per second (default: 2000)
 * @returns Array of normalized waveform values (-1 to 1)
 */
export const generateDecayingSineWave = (
  duration: number = 1,
  samplesPerSecond: number = 2000
): number[] => {
  const sampleCount = Math.floor(duration * samplesPerSecond);
  warnIfOversized('generateDecayingSineWave', sampleCount);
  const data: number[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleCount;
    // Create a decaying sine wave pattern
    const decay = Math.exp(-t * 2);
    const wave = Math.sin(t * 20 * Math.PI) * 0.8 * decay;
    data.push(wave);
  }

  return data;
};

/**
 * Generate simple sine wave waveform
 *
 * @param duration Duration in SECONDS
 * @param frequency Frequency in Hz
 * @param samplesPerSecond Sample density (default: 1000) — see
 *   generateSpeechWaveform for why higher densities are rarely needed
 * @returns Array of normalized waveform values (-1 to 1)
 */
export const generateSineWave = (
  duration: number = 1,
  frequency: number = 440,
  samplesPerSecond: number = 1000
): number[] => {
  const sampleCount = Math.floor(duration * samplesPerSecond);
  warnIfOversized('generateSineWave', sampleCount);
  const data: number[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const t = i / samplesPerSecond;
    const wave = Math.sin(2 * Math.PI * frequency * t) * 0.8;
    data.push(wave);
  }

  return data;
};
