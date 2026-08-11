/**
 * Waveform generation utilities for Storybook stories and testing
 */

/**
 * Generate realistic speech-like waveform data
 * Creates waveform with syllable-like patterns and voice formants
 * Matching the prototype demo appearance
 *
 * @param duration Duration in seconds
 * @param samplesPerSecond Number of samples per second (default: 50000 for solid appearance)
 * @returns Array of normalized waveform values (-1 to 1)
 */
export const generateSpeechWaveform = (
  duration: number,
  samplesPerSecond: number = 50000
): number[] => {
  const sampleCount = Math.floor(duration * samplesPerSecond);
  const waveform: number[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleCount;

    // Speech envelope: syllable-like patterns with sentence-level variation
    const speechEnvelope =
      Math.abs(Math.sin(t * Math.PI * 3 + Math.random() * 0.5)) *
      (0.3 + Math.abs(Math.sin(t * Math.PI * 0.5)) * 0.7) *
      (0.5 + Math.random() * 0.5);

    // High-frequency content (voice formants)
    const voiceContent =
      Math.sin(t * Math.PI * 200 + Math.random() * 2) * 0.4 +
      Math.sin(t * Math.PI * 500 + Math.random() * 3) * 0.3 +
      Math.sin(t * Math.PI * 1200 + Math.random() * 5) * 0.2 +
      (Math.random() - 0.5) * 0.3;

    const value = voiceContent * speechEnvelope;
    waveform.push(Math.max(-1, Math.min(1, value)));
  }

  return waveform;
};

/**
 * Generate simple decaying sine wave waveform
 * Useful for simple demonstrations
 *
 * @param duration Duration in seconds
 * @param samplesPerSecond Number of samples per second (default: 2000)
 * @returns Array of normalized waveform values (-1 to 1)
 */
export const generateDecayingSineWave = (
  duration: number = 1,
  samplesPerSecond: number = 2000
): number[] => {
  const sampleCount = Math.floor(duration * samplesPerSecond);
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
 * @param duration Duration in seconds
 * @param frequency Frequency in Hz
 * @param samplesPerSecond Number of samples per second (default: 2000)
 * @returns Array of normalized waveform values (-1 to 1)
 */
export const generateSineWave = (
  duration: number = 1,
  frequency: number = 440,
  samplesPerSecond: number = 2000
): number[] => {
  const sampleCount = Math.floor(duration * samplesPerSecond);
  const data: number[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const t = i / samplesPerSecond;
    const wave = Math.sin(2 * Math.PI * frequency * t) * 0.8;
    data.push(wave);
  }

  return data;
};
