/**
 * Spectrogram rendering utilities for canvas
 * Contains canvas-specific rendering logic for spectrograms
 */

import { getFrequencyBandEnergy } from '@audacity-ui/core';
import { normToFreq, type SpectrogramScale } from './spectrogramScales';
import { getSpectrogramColor } from './roseus-colormap';

export { getSpectrogramColor } from './roseus-colormap';

export type { SpectrogramScale };

/**
 * Spectrogram rendering options
 */
export interface SpectrogramOptions {
  /** Number of frequency bands to display */
  frequencyBands?: number;
  /** FFT window size (should be power of 2) */
  fftWindowSize?: number;
  /** Color intensity multiplier */
  intensityMultiplier?: number;
  /** Skip every N pixel columns for performance (1 = render all, 2 = render every other, etc) */
  pixelSkip?: number;
  /** Frequency scale to use for y-axis mapping */
  scale?: SpectrogramScale;
  /** Minimum frequency in Hz */
  minFreq?: number;
  /** Maximum frequency in Hz */
  maxFreq?: number;
}

/**
 * Render mono spectrogram to canvas
 * @param ctx - Canvas 2D context
 * @param waveformData - Audio waveform samples
 * @param x - X position to start rendering
 * @param y - Y position to start rendering
 * @param width - Width to render
 * @param height - Height to render
 * @param options - Rendering options
 */
export function renderMonoSpectrogram(
  ctx: CanvasRenderingContext2D,
  waveformData: number[],
  x: number,
  y: number,
  width: number,
  height: number,
  options: SpectrogramOptions = {}
): void {
  const {
    frequencyBands = 256,
    fftWindowSize = 2048,
    intensityMultiplier = 1.5,
    pixelSkip = 1,
    scale = 'mel',
    minFreq = 10,
    maxFreq = 22050,
  } = options;

  const samplesPerPixel = waveformData.length / width;

  for (let px = 0; px < width; px += pixelSkip) {
    const sampleIndex = Math.floor(px * samplesPerPixel);
    if (sampleIndex >= waveformData.length) break;

    const bandEnergies = getFrequencyBandEnergy(
      waveformData,
      sampleIndex,
      fftWindowSize,
      frequencyBands
    );
    const maxEnergy = Math.max(...bandEnergies, 0.0001);

    // Draw each pixel row using the selected frequency scale
    for (let py = 0; py < height; py++) {
      // Map this pixel row to a normalised 0–1 position (0=bottom, 1=top)
      const norm = 1 - py / height;
      // Convert to Hz using the chosen scale
      const hz = normToFreq(norm, minFreq, maxFreq, scale);
      // Find which FFT band this frequency falls in
      const band = Math.floor((hz / maxFreq) * frequencyBands);
      const clampedBand = Math.max(0, Math.min(frequencyBands - 1, band));

      const rawIntensity = bandEnergies[clampedBand] / maxEnergy;
      const intensity = Math.min(1, Math.sqrt(rawIntensity) * intensityMultiplier);

      ctx.fillStyle = getSpectrogramColor(intensity);
      ctx.fillRect(x + px, y + py, pixelSkip, 1);
    }
  }
}

/**
 * Render stereo spectrogram to canvas (split into L and R channels)
 * @param ctx - Canvas 2D context
 * @param waveformLeft - Left channel waveform samples
 * @param waveformRight - Right channel waveform samples
 * @param x - X position to start rendering
 * @param y - Y position to start rendering
 * @param width - Width to render
 * @param height - Height to render
 * @param channelSplitRatio - Ratio of height for left channel (0-1, default 0.5)
 * @param options - Rendering options
 */
export function renderStereoSpectrogram(
  ctx: CanvasRenderingContext2D,
  waveformLeft: number[],
  waveformRight: number[],
  x: number,
  y: number,
  width: number,
  height: number,
  channelSplitRatio: number = 0.5,
  options: SpectrogramOptions = {}
): void {
  const {
    frequencyBands = 256,
    fftWindowSize = 2048,
    intensityMultiplier = 1.5,
    pixelSkip = 1,
    scale = 'mel',
    minFreq = 10,
    maxFreq = 22050,
  } = options;

  const lChannelHeight = height * channelSplitRatio;
  const rChannelHeight = height * (1 - channelSplitRatio);

  // Render L channel (top)
  const samplesPerPixelL = waveformLeft.length / width;
  for (let px = 0; px < width; px += pixelSkip) {
    const sampleIndex = Math.floor(px * samplesPerPixelL);
    if (sampleIndex >= waveformLeft.length) break;

    const bandEnergies = getFrequencyBandEnergy(waveformLeft, sampleIndex, fftWindowSize, frequencyBands);
    const maxEnergy = Math.max(...bandEnergies, 0.0001);

    for (let py = 0; py < lChannelHeight; py++) {
      const norm = 1 - py / lChannelHeight;
      const hz = normToFreq(norm, minFreq, maxFreq, scale);
      const band = Math.max(0, Math.min(frequencyBands - 1, Math.floor((hz / maxFreq) * frequencyBands)));
      const intensity = Math.min(1, Math.sqrt(bandEnergies[band] / maxEnergy) * intensityMultiplier);
      ctx.fillStyle = getSpectrogramColor(intensity);
      ctx.fillRect(x + px, y + py, pixelSkip, 1);
    }
  }

  // Render R channel (bottom)
  const dividerY = y + lChannelHeight;
  const samplesPerPixelR = waveformRight.length / width;
  for (let px = 0; px < width; px += pixelSkip) {
    const sampleIndex = Math.floor(px * samplesPerPixelR);
    if (sampleIndex >= waveformRight.length) break;

    const bandEnergies = getFrequencyBandEnergy(waveformRight, sampleIndex, fftWindowSize, frequencyBands);
    const maxEnergy = Math.max(...bandEnergies, 0.0001);

    for (let py = 0; py < rChannelHeight; py++) {
      const norm = 1 - py / rChannelHeight;
      const hz = normToFreq(norm, minFreq, maxFreq, scale);
      const band = Math.max(0, Math.min(frequencyBands - 1, Math.floor((hz / maxFreq) * frequencyBands)));
      const intensity = Math.min(1, Math.sqrt(bandEnergies[band] / maxEnergy) * intensityMultiplier);
      ctx.fillStyle = getSpectrogramColor(intensity);
      ctx.fillRect(x + px, dividerY + py, pixelSkip, 1);
    }
  }
}
