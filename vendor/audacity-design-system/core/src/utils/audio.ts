/**
 * Audio DSP utilities for the Audacity Design System
 * Pure functions for audio processing - no rendering/canvas code
 */

/**
 * FFT Result containing real and imaginary components
 */
export interface FFTResult {
  real: number[];
  imag: number[];
}

/**
 * Fast Fourier Transform using Cooley-Tukey algorithm
 * @param samples - Input samples (must be power of 2 length)
 * @returns FFT result with real and imaginary components
 */
export function fft(samples: number[]): FFTResult {
  const n = samples.length;

  // Base case
  if (n <= 1) {
    return { real: [...samples], imag: new Array(n).fill(0) };
  }

  // Split into even and odd
  const even = samples.filter((_, i) => i % 2 === 0);
  const odd = samples.filter((_, i) => i % 2 === 1);

  // Recursive FFT
  const evenFFT = fft(even);
  const oddFFT = fft(odd);

  const real = new Array(n);
  const imag = new Array(n);

  // Combine results
  for (let k = 0; k < n / 2; k++) {
    const angle = -2 * Math.PI * k / n;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const tReal = cos * oddFFT.real[k] - sin * oddFFT.imag[k];
    const tImag = cos * oddFFT.imag[k] + sin * oddFFT.real[k];

    real[k] = evenFFT.real[k] + tReal;
    imag[k] = evenFFT.imag[k] + tImag;
    real[k + n / 2] = evenFFT.real[k] - tReal;
    imag[k + n / 2] = evenFFT.imag[k] - tImag;
  }

  return { real, imag };
}

/**
 * Calculate power spectrum from FFT result
 * @param fftResult - FFT result with real and imaginary components
 * @returns Power spectrum (magnitude of each frequency bin)
 */
export function getPowerSpectrum(fftResult: FFTResult): number[] {
  const n = fftResult.real.length;
  const power = new Array(n / 2);

  for (let i = 0; i < n / 2; i++) {
    power[i] = Math.sqrt(
      fftResult.real[i] * fftResult.real[i] +
      fftResult.imag[i] * fftResult.imag[i]
    );
  }

  return power;
}

/**
 * Apply Hann window to samples
 * @param samples - Input samples
 * @returns Windowed samples
 */
export function applyHannWindow(samples: number[]): number[] {
  const windowSize = samples.length;
  const windowed = new Array(windowSize);

  for (let i = 0; i < windowSize; i++) {
    const hannFactor = 0.5 * (1 - Math.cos(2 * Math.PI * i / (windowSize - 1)));
    windowed[i] = samples[i] * hannFactor;
  }

  return windowed;
}

/**
 * Extract frequency band energy from waveform samples
 * @param samples - Input waveform samples
 * @param startIdx - Starting index in samples array
 * @param windowSize - FFT window size (should be power of 2)
 * @param numBands - Number of frequency bands to extract
 * @returns Array of energy values for each frequency band
 */
export function getFrequencyBandEnergy(
  samples: number[],
  startIdx: number,
  windowSize: number,
  numBands: number
): number[] {
  // Extract window
  const window = new Array(windowSize);
  for (let i = 0; i < windowSize; i++) {
    const sampleIdx = startIdx + i;
    window[i] = sampleIdx < samples.length ? samples[sampleIdx] : 0;
  }

  // Apply Hann window
  const windowed = applyHannWindow(window);

  // Perform FFT
  const fftResult = fft(windowed);
  const powerSpectrum = getPowerSpectrum(fftResult);

  // Group into frequency bands
  const bandEnergies = new Array(numBands).fill(0);
  const samplesPerBand = Math.floor(powerSpectrum.length / numBands);

  for (let band = 0; band < numBands; band++) {
    let sum = 0;
    const start = band * samplesPerBand;
    const end = Math.min(start + samplesPerBand, powerSpectrum.length);

    for (let i = start; i < end; i++) {
      sum += powerSpectrum[i];
    }

    bandEnergies[band] = sum / samplesPerBand;
  }

  return bandEnergies;
}
