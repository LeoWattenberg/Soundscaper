/**
 * Spectrogram rendering utilities for canvas
 * Contains canvas-specific rendering logic for spectrograms
 */

import { getFrequencyBandEnergy } from '@audacity-ui/core';
import { normToFreq, type SpectrogramScale } from './spectrogramScales';

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
 * Get color for spectrogram intensity value
 * Uses the Roseus perceptual colormap.
 * @param intensity - Normalized intensity (0-1)
 * @returns RGBA color string
 */
export function getSpectrogramColor(intensity: number): string {
  // Roseus colormap by dofuuz/roseus (MIT), sampled at 256 steps.
  // https://github.com/dofuuz/roseus
  const roseus = '01010101020202020202030302030402040502050603060703070803080a03090c030a0e030c10030d11030e13020f1502101702111902121b02131e01142001152201162401172601182800192b001a2d001b2f001b32001c34001d36001e39001e3b011f3e01204001204302214503214804224a05234d06234f0823520924540b24560d25590f255b11255e1325601526631726651926681b266a1d266c1f266f2126712326732626762826782a267a2c267c2e267e3126803326823525843725863a25883c248a3e248b41248d43238f4523904823924a22934c22954f2196512197542098562099581f9a5b1f9b5d1e9c5f1d9d621d9e641c9f671c9f691ba06b1ba06e1aa1701aa17219a17519a27718a27918a27c17a27e17a28017a28316a18516a18716a18916a18c16a08e16a090169f92169f94169e96169d99169d9b179c9d179b9f179aa11899a31898a51997a71a96a91a95ab1b94ad1c93af1d92b11d91b31e90b51f8eb7208db8218cba228bbc2389be2488c02587c12785c32884c52982c62a81c82b80ca2d7ecb2e7dcd2f7bce307ad03278d13377d33475d43674d63772d73971d93a6fda3c6edb3d6ddd3f6bde406adf4268e14367e24565e34664e44863e54961e64b60e74d5ee94e5dea505ceb525bec5359ed5558ed5757ee5956ef5a54f05c53f15e52f26051f26150f3634ff4654ef5674df5694cf66b4bf66c4af76e4af87049f87248f87448f97647f97847fa7a46fa7c46fa7e46fb8046fb8245fb8446fb8646fb8846fc8a46fc8c46fc8e47fc9048fc9248fc9449fc964afb984bfb9a4cfb9c4dfb9e4efba050fba251faa453faa655faa857f9aa58f9ac5af8ae5df8b05ff8b261f7b463f7b666f6b868f6ba6bf5bc6ef4be70f4c073f3c276f3c379f2c57cf2c77ff1c983f0cb86f0cd89efcf8cefd090eed293eed497edd59aedd79eecd9a1ecdaa5ecdca9ecdeacebdfb0ebe1b4ebe2b7ebe4bbebe5bfebe6c2ece8c6ece9c9eceacdedecd0ededd4eeeed7efefdbf0f0def1f2e1f2f3e4f3f4e7f4f5eaf6f6edf7f7f0f9f8f2fbf9f5fdfaf7fefbf9';
  const index = Math.round(Math.max(0, Math.min(1, intensity)) * 255) * 6;
  return `#${roseus.slice(index, index + 6)}`;
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
