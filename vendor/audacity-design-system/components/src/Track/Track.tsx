import React, { useRef, useEffect, useState } from 'react';
import { CLIP_CONTENT_OFFSET } from '../constants';
import './Track.css';

// Envelope rendering constants
const INFINITY_ZONE_HEIGHT = 1;

// dB to Y coordinate conversion (non-linear power curve)
function dbToYNonLinear(db: number, y: number, height: number): number {
  const minDb = -60;
  const maxDb = 12;
  const usableHeight = height - INFINITY_ZONE_HEIGHT;

  if (db === -Infinity || db < minDb) {
    return y + height;
  }

  const dbRange = maxDb - minDb;
  const linear = (db - minDb) / dbRange;
  const normalized = Math.pow(linear, 3.0);

  return y + usableHeight - normalized * usableHeight;
}

// Convert dB to linear gain multiplier
function dbToGain(db: number): number {
  if (db === -Infinity) return 0;
  return Math.pow(10, db / 20);
}

// Get gain at a specific time within a clip based on envelope points
function getGainAtTime(time: number, duration: number, envelopePoints: Array<{ time: number; db: number }> | undefined): number {
  if (!envelopePoints || envelopePoints.length === 0) {
    return 1.0; // Default to 0dB (unity gain)
  }

  // If time is before first point, use first point's value
  if (time <= envelopePoints[0].time) {
    return dbToGain(envelopePoints[0].db);
  }

  // If time is after last point, use last point's value
  if (time >= envelopePoints[envelopePoints.length - 1].time) {
    return dbToGain(envelopePoints[envelopePoints.length - 1].db);
  }

  // Find the two points we're between
  for (let i = 0; i < envelopePoints.length - 1; i++) {
    const p1 = envelopePoints[i];
    const p2 = envelopePoints[i + 1];

    if (time >= p1.time && time <= p2.time) {
      // Linear interpolation between the two points in dB space
      const t = (time - p1.time) / (p2.time - p1.time);
      const db = p1.db + t * (p2.db - p1.db);
      return dbToGain(db);
    }
  }

  return 1.0; // Fallback to unity gain
}

// Simple FFT for spectrogram analysis (Cooley-Tukey algorithm)
function fft(samples: number[]): { real: number[]; imag: number[] } {
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

// Calculate power spectrum from FFT result
function getPowerSpectrum(fftResult: { real: number[]; imag: number[] }): number[] {
  const n = fftResult.real.length;
  const power = new Array(n / 2);

  for (let i = 0; i < n / 2; i++) {
    power[i] = Math.sqrt(fftResult.real[i] * fftResult.real[i] + fftResult.imag[i] * fftResult.imag[i]);
  }

  return power;
}

// Extract frequency band energy from waveform samples
function getFrequencyBandEnergy(samples: number[], startIdx: number, windowSize: number, numBands: number): number[] {
  // Extract window and apply Hann window
  const window = new Array(windowSize);
  for (let i = 0; i < windowSize; i++) {
    const sampleIdx = startIdx + i;
    const sample = sampleIdx < samples.length ? samples[sampleIdx] : 0;
    // Hann window
    const hannFactor = 0.5 * (1 - Math.cos(2 * Math.PI * i / (windowSize - 1)));
    window[i] = sample * hannFactor;
  }

  // Perform FFT
  const fftResult = fft(window);
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

export interface TrackClip {
  id: string | number;
  name: string;
  start: number;
  duration: number;
  selected?: boolean;
  waveform?: number[];
  waveformLeft?: number[]; // Left channel waveform for stereo tracks
  waveformRight?: number[]; // Right channel waveform for stereo tracks
  envelopePoints?: Array<{ time: number; db: number }>;
}

export interface TrackProps {
  /**
   * Array of clips on this track
   */
  clips: TrackClip[];

  /**
   * Track height in pixels
   * @default 114
   */
  height?: number;

  /**
   * Track index (used for color theming)
   */
  trackIndex: number;

  /**
   * Whether to display spectrogram view
   */
  spectrogramMode?: boolean;

  /**
   * Whether to display split view (waveform + spectrogram)
   */
  splitView?: boolean;

  /**
   * Whether envelope editing mode is active
   */
  envelopeMode?: boolean;

  /**
   * Hidden envelope point indices for the current drag operation
   * Map of clipId to array of hidden point indices
   */
  envelopeHiddenPointIndices?: Map<string | number, number[]>;

  /**
   * Whether the track is selected
   */
  isSelected?: boolean;

  /**
   * Whether the track has focus (shows focus border)
   */
  isFocused?: boolean;

  /**
   * Pixels per second (zoom level)
   * @default 100
   */
  pixelsPerSecond?: number;

  /**
   * Width of the track in pixels
   */
  width: number;

  /**
   * Y offset for rendering (used when part of a track list)
   */
  yOffset?: number;

  /**
   * Background color for canvas
   * @default '#212433'
   */
  backgroundColor?: string;

  /**
   * Callback when a clip is clicked
   */
  onClipClick?: (clipId: string | number) => void;

  /**
   * Callback when a clip header is clicked
   */
  onClipHeaderClick?: (clipId: string | number, clipStartTime: number) => void;

  /**
   * Callback when track background is clicked
   */
  onTrackClick?: () => void;

  /**
   * Channel split ratio for stereo tracks (0-1, default 0.5)
   * Controls the vertical distribution between L and R channels
   */
  channelSplitRatio?: number;

  /**
   * Callback when channel split divider is dragged (for stereo tracks)
   */
  onChannelSplitChange?: (newSplitRatio: number) => void;

  /**
   * Callback when channel resize drag starts
   */
  onChannelResizeStart?: () => void;

  /**
   * Callback when channel resize drag ends
   */
  onChannelResizeEnd?: () => void;
}

/**
 * Track component - renders a single audio track with clips on a canvas
 */
export const Track: React.FC<TrackProps> = ({
  clips,
  height = 114,
  trackIndex,
  spectrogramMode = false,
  splitView = false,
  envelopeMode = false,
  envelopeHiddenPointIndices,
  isSelected = false,
  isFocused = false,
  pixelsPerSecond = 100,
  width,
  yOffset = 0,
  backgroundColor = '#212433',
  onClipClick,
  onClipHeaderClick,
  onTrackClick,
  channelSplitRatio = 0.5,
  onChannelSplitChange,
  onChannelResizeStart,
  onChannelResizeEnd,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cursorStyle, setCursorStyle] = useState<string>('default');
  const [isHoveringDivider, setIsHoveringDivider] = useState<boolean>(false);
  const [channelResizeDrag, setChannelResizeDrag] = useState<{
    startY: number;
    startSplitRatio: number;
    clipY: number;
    clipHeight: number;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // HiDPI: size backing store to device pixels, keep CSS box at logical pixels,
    // then scale the drawing context so the rest of this effect can draw in logical px.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // Draw track background
    ctx.fillStyle = isSelected ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(0, 0, width, height);

    // Note: Focus borders are rendered via CSS wrapper, not on canvas

    // Draw clips
    clips.forEach(clip => {
      const clipX = CLIP_CONTENT_OFFSET + clip.start * pixelsPerSecond;
      const clipWidth = clip.duration * pixelsPerSecond;
      const clipHeaderHeight = 20;

      // Clip background (dark for spectrogram, colored for waveform)
      const clipBgColor = spectrogramMode
        ? '#1a1d2e'
        : getClipBackgroundColor(trackIndex, clip.selected || false);
      ctx.fillStyle = clipBgColor;
      ctx.fillRect(clipX, clipHeaderHeight, clipWidth, height - clipHeaderHeight);

      // Clip header
      const clipHeaderColor = getClipHeaderColor(trackIndex, clip.selected || false);
      ctx.fillStyle = clipHeaderColor;
      ctx.fillRect(clipX, 0, clipWidth, clipHeaderHeight);

      // Clip border
      ctx.strokeStyle = clip.selected ? '#ffffff' : '#000000';
      ctx.lineWidth = 1;
      ctx.strokeRect(clipX, 0, clipWidth, height);

      // Clip name
      ctx.fillStyle = clip.selected ? '#14151A' : '#14151A';
      ctx.font = '12px Inter, sans-serif';
      ctx.fillText(clip.name, clipX + 8, 14);

      // Draw waveform or spectrogram if available
      const hasWaveform = (clip.waveform && clip.waveform.length > 0) ||
                          (clip.waveformLeft && clip.waveformLeft.length > 0 && clip.waveformRight && clip.waveformRight.length > 0);

      if (hasWaveform) {
        const waveformAreaTop = clipHeaderHeight;
        const waveformAreaHeight = height - clipHeaderHeight;

        if (splitView) {
          // Draw split view: spectrogram on top, waveform on bottom
          const splitY = waveformAreaTop + waveformAreaHeight / 2;
          const halfHeight = waveformAreaHeight / 2;
          const isStereo = clip.waveformLeft && clip.waveformRight;

          // Draw dark background for spectrogram section
          ctx.fillStyle = '#1a1d2e';
          ctx.fillRect(clipX, waveformAreaTop, clipWidth, halfHeight);

          // Draw spectrogram in top half
          const frequencyBands = 32; // Fewer bands for split view

          if (isStereo) {
            // Stereo: L spectral channel on top quarter, R spectral channel on second quarter
            const quarterHeight = halfHeight / 2;

            // Draw L channel spectrogram (top quarter)
            const samplesPerPixelL = clip.waveformLeft!.length / clipWidth;
            const fftWindowSize = 256; // Must be power of 2 - larger window for better frequency resolution

            for (let px = 0; px < clipWidth; px++) {
              const sampleIndex = Math.floor(px * samplesPerPixelL);
              if (sampleIndex >= clip.waveformLeft!.length) break;

              // Get real frequency band energies via FFT
              const bandEnergies = getFrequencyBandEnergy(clip.waveformLeft!, sampleIndex, fftWindowSize, frequencyBands);

              // Find global max for better normalization
              const maxEnergy = Math.max(...bandEnergies, 0.0001);

              for (let band = 0; band < frequencyBands; band++) {
                // Boost intensity and use log scale for better visibility
                const rawIntensity = bandEnergies[band] / maxEnergy;
                const intensity = Math.min(1, Math.sqrt(rawIntensity) * 1.5);

                let r, g, b;
                if (intensity < 0.5) {
                  r = 0;
                  g = Math.floor(intensity * 2 * 255);
                  b = Math.floor(255 - intensity * 2 * 255);
                } else {
                  r = Math.floor((intensity - 0.5) * 2 * 255);
                  g = 255;
                  b = 0;
                }

                const alpha = Math.max(0.3, intensity);
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                const y = waveformAreaTop + (1 - (band / frequencyBands)) * quarterHeight;
                const bandHeight = Math.max(1, quarterHeight / frequencyBands);
                ctx.fillRect(clipX + px, y, 1, bandHeight);
              }
            }

            // Draw separator line between L and R spectral
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(clipX, waveformAreaTop + quarterHeight);
            ctx.lineTo(clipX + clipWidth, waveformAreaTop + quarterHeight);
            ctx.stroke();

            // Draw R channel spectrogram (second quarter)
            const samplesPerPixelR = clip.waveformRight!.length / clipWidth;
            for (let px = 0; px < clipWidth; px++) {
              const sampleIndex = Math.floor(px * samplesPerPixelR);
              if (sampleIndex >= clip.waveformRight!.length) break;

              // Get real frequency band energies via FFT
              const bandEnergies = getFrequencyBandEnergy(clip.waveformRight!, sampleIndex, fftWindowSize, frequencyBands);

              // Find global max for better normalization
              const maxEnergy = Math.max(...bandEnergies, 0.0001);

              for (let band = 0; band < frequencyBands; band++) {
                // Boost intensity and use log scale for better visibility
                const rawIntensity = bandEnergies[band] / maxEnergy;
                const intensity = Math.min(1, Math.sqrt(rawIntensity) * 1.5);

                let r, g, b;
                if (intensity < 0.5) {
                  r = 0;
                  g = Math.floor(intensity * 2 * 255);
                  b = Math.floor(255 - intensity * 2 * 255);
                } else {
                  r = Math.floor((intensity - 0.5) * 2 * 255);
                  g = 255;
                  b = 0;
                }

                const alpha = Math.max(0.3, intensity);
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                const y = waveformAreaTop + quarterHeight + (1 - (band / frequencyBands)) * quarterHeight;
                const bandHeight = Math.max(1, quarterHeight / frequencyBands);
                ctx.fillRect(clipX + px, y, 1, bandHeight);
              }
            }
          } else {
            // Mono: single spectral channel in top half
            const waveformDataForSpectrogram = clip.waveform || [];
            const samplesPerPixel = waveformDataForSpectrogram.length / clipWidth;
            const fftWindowSize = 256;

            for (let px = 0; px < clipWidth; px++) {
              const sampleIndex = Math.floor(px * samplesPerPixel);
              if (sampleIndex >= waveformDataForSpectrogram.length) break;

              // Get real frequency band energies via FFT
              const bandEnergies = getFrequencyBandEnergy(waveformDataForSpectrogram, sampleIndex, fftWindowSize, frequencyBands);

              // Find global max for better normalization
              const maxEnergy = Math.max(...bandEnergies, 0.0001);

              for (let band = 0; band < frequencyBands; band++) {
                // Boost intensity and use log scale for better visibility
                const rawIntensity = bandEnergies[band] / maxEnergy;
                const intensity = Math.min(1, Math.sqrt(rawIntensity) * 1.5);

                let r, g, b;
                if (intensity < 0.5) {
                  r = 0;
                  g = Math.floor(intensity * 2 * 255);
                  b = Math.floor(255 - intensity * 2 * 255);
                } else {
                  r = Math.floor((intensity - 0.5) * 2 * 255);
                  g = 255;
                  b = 0;
                }

                const alpha = Math.max(0.3, intensity);
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                const y = waveformAreaTop + (1 - (band / frequencyBands)) * halfHeight;
                const bandHeight = Math.max(1, halfHeight / frequencyBands);
                ctx.fillRect(clipX + px, y, 1, bandHeight);
              }
            }
          }

          // Draw separator line between spectrogram and waveform
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(clipX, splitY);
          ctx.lineTo(clipX + clipWidth, splitY);
          ctx.stroke();

          // Draw waveform in bottom half
          if (isStereo) {
            // Stereo: split bottom half into L (top) and R (bottom)
            const stereoHeight = halfHeight / 2;
            const lChannelY = splitY + stereoHeight / 2;
            const rChannelY = splitY + stereoHeight + stereoHeight / 2;

            // Draw L channel (top of waveform area)
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
            ctx.lineWidth = 1;
            ctx.beginPath();

            const samplesPerPixelL = clip.waveformLeft!.length / clipWidth;
            for (let px = 0; px < clipWidth; px++) {
              const sampleIndex = Math.floor(px * samplesPerPixelL);
              if (sampleIndex >= clip.waveformLeft!.length) break;

              const sample = clip.waveformLeft![sampleIndex];
              const amplitude = Math.abs(sample);
              const waveformHeight = amplitude * (stereoHeight / 2) * 0.9;

              const x = clipX + px;
              const yTop = lChannelY - waveformHeight;
              const yBottom = lChannelY + waveformHeight;

              ctx.moveTo(x, yTop);
              ctx.lineTo(x, yBottom);
            }
            ctx.stroke();

            // Draw separator line between L and R
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(clipX, splitY + stereoHeight);
            ctx.lineTo(clipX + clipWidth, splitY + stereoHeight);
            ctx.stroke();

            // Draw R channel (bottom of waveform area)
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
            ctx.lineWidth = 1;
            ctx.beginPath();

            const samplesPerPixelR = clip.waveformRight!.length / clipWidth;
            for (let px = 0; px < clipWidth; px++) {
              const sampleIndex = Math.floor(px * samplesPerPixelR);
              if (sampleIndex >= clip.waveformRight!.length) break;

              const sample = clip.waveformRight![sampleIndex];
              const amplitude = Math.abs(sample);
              const waveformHeight = amplitude * (stereoHeight / 2) * 0.9;

              const x = clipX + px;
              const yTop = rChannelY - waveformHeight;
              const yBottom = rChannelY + waveformHeight;

              ctx.moveTo(x, yTop);
              ctx.lineTo(x, yBottom);
            }
            ctx.stroke();
          } else {
            // Mono: single waveform centered in bottom half
            const waveformCenterY = splitY + halfHeight / 2;
            const monoWaveform = clip.waveform || [];
            const samplesPerPixelMono = monoWaveform.length / clipWidth;

            ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
            ctx.lineWidth = 1;
            ctx.beginPath();

            for (let px = 0; px < clipWidth; px++) {
              const sampleIndex = Math.floor(px * samplesPerPixelMono);
              if (sampleIndex >= monoWaveform.length) break;

              const sample = monoWaveform[sampleIndex];
              const amplitude = Math.abs(sample);
              const waveformHeight = amplitude * (halfHeight / 2) * 0.9;

              const x = clipX + px;
              const yTop = waveformCenterY - waveformHeight;
              const yBottom = waveformCenterY + waveformHeight;

              ctx.moveTo(x, yTop);
              ctx.lineTo(x, yBottom);
            }
            ctx.stroke();
          }

        } else if (spectrogramMode) {
          // Draw spectrogram view
          const isStereo = clip.waveformLeft && clip.waveformRight;

          if (isStereo) {
            // Stereo spectrogram: L channel on top, R channel on bottom, split by channelSplitRatio
            const splitRatio = channelSplitRatio;
            const lChannelHeight = waveformAreaHeight * splitRatio;
            const rChannelHeight = waveformAreaHeight * (1 - splitRatio);
            const frequencyBands = 64;
            const fftWindowSize = 256;

            // Draw L channel spectrogram (top portion based on splitRatio)
            const samplesPerPixelL = clip.waveformLeft!.length / clipWidth;
            for (let px = 0; px < clipWidth; px++) {
              const sampleIndex = Math.floor(px * samplesPerPixelL);
              if (sampleIndex >= clip.waveformLeft!.length) break;

              // Get real frequency band energies via FFT
              const bandEnergies = getFrequencyBandEnergy(clip.waveformLeft!, sampleIndex, fftWindowSize, frequencyBands);
              const maxEnergy = Math.max(...bandEnergies, 0.0001);

              for (let band = 0; band < frequencyBands; band++) {
                const rawIntensity = bandEnergies[band] / maxEnergy;
                const intensity = Math.min(1, Math.sqrt(rawIntensity) * 1.5);

                let r, g, b;
                if (intensity < 0.5) {
                  r = 0;
                  g = Math.floor(intensity * 2 * 255);
                  b = Math.floor(255 - intensity * 2 * 255);
                } else {
                  r = Math.floor((intensity - 0.5) * 2 * 255);
                  g = 255;
                  b = 0;
                }

                const alpha = Math.max(0.3, intensity);
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                const y = waveformAreaTop + (1 - (band / frequencyBands)) * lChannelHeight;
                const bandHeight = Math.max(1, lChannelHeight / frequencyBands);
                ctx.fillRect(clipX + px, y, 1, bandHeight);
              }
            }

            // Draw separator line between L and R
            const dividerY = waveformAreaTop + lChannelHeight;

            // Draw hover/drag highlight
            if (isHoveringDivider || channelResizeDrag) {
              const HIGHLIGHT_HEIGHT = 8;
              ctx.fillStyle = 'rgba(112, 181, 255, 0.4)';
              ctx.fillRect(clipX, dividerY - HIGHLIGHT_HEIGHT / 2, clipWidth, HIGHLIGHT_HEIGHT);
            }

            // Draw divider line (solid black)
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(clipX, dividerY);
            ctx.lineTo(clipX + clipWidth, dividerY);
            ctx.stroke();

            // Draw R channel spectrogram (bottom portion based on splitRatio)
            const samplesPerPixelR = clip.waveformRight!.length / clipWidth;
            for (let px = 0; px < clipWidth; px++) {
              const sampleIndex = Math.floor(px * samplesPerPixelR);
              if (sampleIndex >= clip.waveformRight!.length) break;

              // Get real frequency band energies via FFT
              const bandEnergies = getFrequencyBandEnergy(clip.waveformRight!, sampleIndex, fftWindowSize, frequencyBands);
              const maxEnergy = Math.max(...bandEnergies, 0.0001);

              for (let band = 0; band < frequencyBands; band++) {
                const rawIntensity = bandEnergies[band] / maxEnergy;
                const intensity = Math.min(1, Math.sqrt(rawIntensity) * 1.5);

                let r, g, b;
                if (intensity < 0.5) {
                  r = 0;
                  g = Math.floor(intensity * 2 * 255);
                  b = Math.floor(255 - intensity * 2 * 255);
                } else {
                  r = Math.floor((intensity - 0.5) * 2 * 255);
                  g = 255;
                  b = 0;
                }

                const alpha = Math.max(0.3, intensity);
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                const y = dividerY + (1 - (band / frequencyBands)) * rChannelHeight;
                const bandHeight = Math.max(1, rChannelHeight / frequencyBands);
                ctx.fillRect(clipX + px, y, 1, bandHeight);
              }
            }
          } else {
            // Mono spectrogram
            const waveformData = clip.waveform || [];
            const samplesPerPixel = waveformData.length / clipWidth;
            const frequencyBands = 64;
            const fftWindowSize = 256;

            for (let px = 0; px < clipWidth; px++) {
              const sampleIndex = Math.floor(px * samplesPerPixel);
              if (sampleIndex >= waveformData.length) break;

              // Get real frequency band energies via FFT
              const bandEnergies = getFrequencyBandEnergy(waveformData, sampleIndex, fftWindowSize, frequencyBands);
              const maxEnergy = Math.max(...bandEnergies, 0.0001);

              for (let band = 0; band < frequencyBands; band++) {
                const rawIntensity = bandEnergies[band] / maxEnergy;
                const intensity = Math.min(1, Math.sqrt(rawIntensity) * 1.5);

                let r, g, b;
                if (intensity < 0.5) {
                  r = 0;
                  g = Math.floor(intensity * 2 * 255);
                  b = Math.floor(255 - intensity * 2 * 255);
                } else {
                  r = Math.floor((intensity - 0.5) * 2 * 255);
                  g = 255;
                  b = 0;
                }

                const alpha = Math.max(0.3, intensity);
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                const y = waveformAreaTop + (1 - (band / frequencyBands)) * waveformAreaHeight;
                const bandHeight = Math.max(1, waveformAreaHeight / frequencyBands);
                ctx.fillRect(clipX + px, y, 1, bandHeight);
              }
            }
          }
        } else {
          // Draw traditional waveform
          // Check if stereo waveforms are available
          const isStereo = clip.waveformLeft && clip.waveformRight;

          if (isStereo) {
            // Stereo: L channel on top, R channel on bottom, split by channelSplitRatio
            const splitRatio = channelSplitRatio; // Default to 50/50 split
            const lChannelHeight = waveformAreaHeight * splitRatio;
            const rChannelHeight = waveformAreaHeight * (1 - splitRatio);
            const lChannelCenterY = waveformAreaTop + lChannelHeight / 2;
            const rChannelCenterY = waveformAreaTop + lChannelHeight + rChannelHeight / 2;

            // Draw L channel
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
            ctx.lineWidth = 1;
            ctx.beginPath();

            const samplesPerPixelL = clip.waveformLeft!.length / clipWidth;
            for (let px = 0; px < clipWidth; px++) {
              const sampleIndex = Math.floor(px * samplesPerPixelL);
              if (sampleIndex >= clip.waveformLeft!.length) break;

              const sample = clip.waveformLeft![sampleIndex];
              const time = (px / clipWidth) * clip.duration;
              const gain = getGainAtTime(time, clip.duration, clip.envelopePoints);
              const amplitude = Math.abs(sample) * gain;
              const waveformHeight = amplitude * (lChannelHeight / 2) * 0.9;

              const x = clipX + px;
              const yTop = lChannelCenterY - waveformHeight;
              const yBottom = lChannelCenterY + waveformHeight;

              ctx.moveTo(x, yTop);
              ctx.lineTo(x, yBottom);
            }
            ctx.stroke();

            // Draw separator line between L and R channels
            const dividerY = waveformAreaTop + lChannelHeight;

            // Draw hover/drag highlight
            if (isHoveringDivider || channelResizeDrag) {
              const HIGHLIGHT_HEIGHT = 8; // 4px above and below
              ctx.fillStyle = 'rgba(112, 181, 255, 0.3)'; // Blue highlight
              ctx.fillRect(clipX, dividerY - HIGHLIGHT_HEIGHT / 2, clipWidth, HIGHLIGHT_HEIGHT);
            }

            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(clipX, dividerY);
            ctx.lineTo(clipX + clipWidth, dividerY);
            ctx.stroke();

            // Draw R channel
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
            ctx.lineWidth = 1;
            ctx.beginPath();

            const samplesPerPixelR = clip.waveformRight!.length / clipWidth;
            for (let px = 0; px < clipWidth; px++) {
              const sampleIndex = Math.floor(px * samplesPerPixelR);
              if (sampleIndex >= clip.waveformRight!.length) break;

              const sample = clip.waveformRight![sampleIndex];
              const time = (px / clipWidth) * clip.duration;
              const gain = getGainAtTime(time, clip.duration, clip.envelopePoints);
              const amplitude = Math.abs(sample) * gain;
              const waveformHeight = amplitude * (rChannelHeight / 2) * 0.9;

              const x = clipX + px;
              const yTop = rChannelCenterY - waveformHeight;
              const yBottom = rChannelCenterY + waveformHeight;

              ctx.moveTo(x, yTop);
              ctx.lineTo(x, yBottom);
            }
            ctx.stroke();
          } else {
            // Mono: single waveform centered
            const waveformCenterY = waveformAreaTop + waveformAreaHeight / 2;

            ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
            ctx.lineWidth = 1;
            ctx.beginPath();

            const samplesPerPixel = clip.waveform!.length / clipWidth;
            for (let px = 0; px < clipWidth; px++) {
              const sampleIndex = Math.floor(px * samplesPerPixel);
              if (sampleIndex >= clip.waveform!.length) break;

              const sample = clip.waveform![sampleIndex];
              const time = (px / clipWidth) * clip.duration;
              const gain = getGainAtTime(time, clip.duration, clip.envelopePoints);
              const amplitude = Math.abs(sample) * gain;
              const waveformHeight = amplitude * (waveformAreaHeight / 2) * 0.9;

              const x = clipX + px;
              const yTop = waveformCenterY - waveformHeight;
              const yBottom = waveformCenterY + waveformHeight;

              ctx.moveTo(x, yTop);
              ctx.lineTo(x, yBottom);
            }
            ctx.stroke();
          }
        }
      }

      // Draw envelope line and control points after waveform (if envelope mode is active)
      if (envelopeMode) {
        const hiddenIndices = envelopeHiddenPointIndices?.get(clip.id) || [];
        drawEnvelopeLine(ctx, clip, clipX, clipHeaderHeight, clipWidth, height - clipHeaderHeight, hiddenIndices);
      }
    });

    // Helper function to draw envelope line and control points
    function drawEnvelopeLine(
      ctx: CanvasRenderingContext2D,
      clip: TrackClip,
      x: number,
      y: number,
      clipWidth: number,
      clipHeight: number,
      hiddenPointIndices: number[] = []
    ) {
      const points = clip.envelopePoints || [];
      // Filter out hidden points (points being "eaten" during drag)
      const visiblePoints = points.filter((_, index) => !hiddenPointIndices.includes(index));
      const envelopeLineColor = '#ff0000'; // Red line
      const zeroDB_Y = dbToYNonLinear(0, y, clipHeight);

      // Draw line segments
      ctx.strokeStyle = envelopeLineColor;
      ctx.lineWidth = 2;
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      ctx.beginPath();

      if (visiblePoints.length === 0) {
        // No visible control points - draw default line at 0dB
        ctx.moveTo(x, zeroDB_Y);
        ctx.lineTo(x + clipWidth, zeroDB_Y);
      } else {
        // Start from first visible point
        const startY = dbToYNonLinear(visiblePoints[0].db, y, clipHeight);
        ctx.moveTo(x, startY);

        // Draw through all visible points
        visiblePoints.forEach((point) => {
          const px = x + (point.time / clip.duration) * clipWidth;
          const py = dbToYNonLinear(point.db, y, clipHeight);
          ctx.lineTo(px, py);
        });

        // Extend to end of clip
        const lastPoint = visiblePoints[visiblePoints.length - 1];
        if (lastPoint.time < clip.duration) {
          const endY = dbToYNonLinear(lastPoint.db, y, clipHeight);
          ctx.lineTo(x + clipWidth, endY);
        }
      }

      ctx.stroke();

      // Draw hit area visualization (semi-transparent overlay showing interactive zones)
      const ENVELOPE_LINE_FAR_THRESHOLD = 8; // 8 pixels above and below the line

      ctx.fillStyle = 'rgba(255, 0, 0, 0.1)'; // Very light red overlay

      if (visiblePoints.length === 0) {
        // No visible control points - show hit area around default 0dB line
        ctx.fillRect(x, zeroDB_Y - ENVELOPE_LINE_FAR_THRESHOLD, clipWidth, ENVELOPE_LINE_FAR_THRESHOLD * 2);
      } else {
        // Draw hit area for each segment
        const startY = dbToYNonLinear(visiblePoints[0].db, y, clipHeight);

        // First segment: from clip start to first point
        const firstPx = x + (visiblePoints[0].time / clip.duration) * clipWidth;
        const firstPy = dbToYNonLinear(visiblePoints[0].db, y, clipHeight);

        ctx.beginPath();
        ctx.moveTo(x, startY - ENVELOPE_LINE_FAR_THRESHOLD);
        ctx.lineTo(firstPx, firstPy - ENVELOPE_LINE_FAR_THRESHOLD);
        ctx.lineTo(firstPx, firstPy + ENVELOPE_LINE_FAR_THRESHOLD);
        ctx.lineTo(x, startY + ENVELOPE_LINE_FAR_THRESHOLD);
        ctx.closePath();
        ctx.fill();

        // Segments between control points
        for (let i = 0; i < visiblePoints.length - 1; i++) {
          const point1 = visiblePoints[i];
          const point2 = visiblePoints[i + 1];
          const px1 = x + (point1.time / clip.duration) * clipWidth;
          const py1 = dbToYNonLinear(point1.db, y, clipHeight);
          const px2 = x + (point2.time / clip.duration) * clipWidth;
          const py2 = dbToYNonLinear(point2.db, y, clipHeight);

          ctx.beginPath();
          ctx.moveTo(px1, py1 - ENVELOPE_LINE_FAR_THRESHOLD);
          ctx.lineTo(px2, py2 - ENVELOPE_LINE_FAR_THRESHOLD);
          ctx.lineTo(px2, py2 + ENVELOPE_LINE_FAR_THRESHOLD);
          ctx.lineTo(px1, py1 + ENVELOPE_LINE_FAR_THRESHOLD);
          ctx.closePath();
          ctx.fill();
        }

        // Last segment: from last point to clip end
        const lastPoint = visiblePoints[visiblePoints.length - 1];
        if (lastPoint.time < clip.duration) {
          const lastPx = x + (lastPoint.time / clip.duration) * clipWidth;
          const lastPy = dbToYNonLinear(lastPoint.db, y, clipHeight);

          ctx.beginPath();
          ctx.moveTo(lastPx, lastPy - ENVELOPE_LINE_FAR_THRESHOLD);
          ctx.lineTo(x + clipWidth, lastPy - ENVELOPE_LINE_FAR_THRESHOLD);
          ctx.lineTo(x + clipWidth, lastPy + ENVELOPE_LINE_FAR_THRESHOLD);
          ctx.lineTo(lastPx, lastPy + ENVELOPE_LINE_FAR_THRESHOLD);
          ctx.closePath();
          ctx.fill();
        }
      }

      // Draw control points (only visible points) - on top of hit area
      visiblePoints.forEach((point) => {
        const px = x + (point.time / clip.duration) * clipWidth;
        const py = dbToYNonLinear(point.db, y, clipHeight);

        const outerRadius = 5;
        const innerRadius = 3;

        // Draw donut/ring shape with transparent center
        ctx.save();

        // Draw outer circle
        ctx.fillStyle = envelopeLineColor;
        ctx.beginPath();
        ctx.arc(px, py, outerRadius, 0, Math.PI * 2);
        ctx.fill();

        // Cut out inner circle to create transparent center
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(px, py, innerRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      });
    }
  }, [clips, height, trackIndex, spectrogramMode, splitView, envelopeMode, envelopeHiddenPointIndices, isSelected, isFocused, pixelsPerSecond, width, backgroundColor, channelSplitRatio, isHoveringDivider, channelResizeDrag]);

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Clip header height (should match the value used in rendering)
    const CLIP_HEADER_HEIGHT = 20;
    const DIVIDER_HIT_ZONE = 4; // Pixels above and below divider line

    // Handle active channel resize drag
    if (channelResizeDrag) {
      const deltaY = y - channelResizeDrag.startY;
      const newSplitRatio = Math.max(0.1, Math.min(0.9,
        channelResizeDrag.startSplitRatio + (deltaY / channelResizeDrag.clipHeight)
      ));
      onChannelSplitChange?.(newSplitRatio);
      return;
    }

    // Check if hovering over a clip header or channel divider
    let overClipHeader = false;
    let overChannelDivider = false;

    for (const clip of clips) {
      const clipX = CLIP_CONTENT_OFFSET + clip.start * pixelsPerSecond;
      const clipWidth = clip.duration * pixelsPerSecond;

      if (x >= clipX && x < clipX + clipWidth) {
        // Check if over clip header
        if (y <= CLIP_HEADER_HEIGHT) {
          overClipHeader = true;
          break;
        }

        // Check if over channel divider (for stereo clips)
        const isStereo = clip.waveformLeft && clip.waveformRight;
        if (isStereo && y > CLIP_HEADER_HEIGHT) {
          const waveformAreaTop = CLIP_HEADER_HEIGHT;
          const waveformAreaHeight = height - CLIP_HEADER_HEIGHT;
          const dividerY = waveformAreaTop + waveformAreaHeight * channelSplitRatio;

          if (Math.abs(y - dividerY) <= DIVIDER_HIT_ZONE) {
            overChannelDivider = true;
            break;
          }
        }
      }
    }

    // Update cursor style and hover state
    setIsHoveringDivider(overChannelDivider);
    if (overChannelDivider) {
      setCursorStyle('ns-resize');
    } else if (overClipHeader) {
      setCursorStyle('pointer');
    } else {
      setCursorStyle('default');
    }
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const CLIP_HEADER_HEIGHT = 20;
    const DIVIDER_HIT_ZONE = 4;

    // Check if clicking on a channel divider
    for (const clip of clips) {
      const clipX = CLIP_CONTENT_OFFSET + clip.start * pixelsPerSecond;
      const clipWidth = clip.duration * pixelsPerSecond;

      if (x >= clipX && x < clipX + clipWidth) {
        // Check if over channel divider (for stereo clips)
        const isStereo = clip.waveformLeft && clip.waveformRight;
        if (isStereo && y > CLIP_HEADER_HEIGHT) {
          const waveformAreaTop = CLIP_HEADER_HEIGHT;
          const waveformAreaHeight = height - CLIP_HEADER_HEIGHT;
          const dividerY = waveformAreaTop + waveformAreaHeight * channelSplitRatio;

          if (Math.abs(y - dividerY) <= DIVIDER_HIT_ZONE) {
            // Start channel resize drag
            setChannelResizeDrag({
              startY: y,
              startSplitRatio: channelSplitRatio,
              clipY: waveformAreaTop,
              clipHeight: waveformAreaHeight,
            });
            onChannelResizeStart?.();
            event.preventDefault();
            event.stopPropagation(); // Prevent event from bubbling to container
            return;
          }
        }
      }
    }
  };

  const handleMouseUp = () => {
    if (channelResizeDrag) {
      setChannelResizeDrag(null);
      onChannelResizeEnd?.();
    }
  };

  // Add global mouse handlers for dragging outside the canvas
  useEffect(() => {
    if (!channelResizeDrag) return;

    const handleGlobalMouseMove = (event: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const y = event.clientY - rect.top;

      const deltaY = y - channelResizeDrag.startY;
      const newSplitRatio = Math.max(0.1, Math.min(0.9,
        channelResizeDrag.startSplitRatio + (deltaY / channelResizeDrag.clipHeight)
      ));
      onChannelSplitChange?.(newSplitRatio);
    };

    const handleGlobalMouseUp = () => {
      setChannelResizeDrag(null);
      onChannelResizeEnd?.();
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [channelResizeDrag, onChannelSplitChange]);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Clip header height (should match the value used in rendering)
    const CLIP_HEADER_HEIGHT = 20;

    // Check if a clip header was clicked
    let clipClicked = false;
    for (const clip of clips) {
      const clipX = CLIP_CONTENT_OFFSET + clip.start * pixelsPerSecond;
      const clipWidth = clip.duration * pixelsPerSecond;

      // Only select clip if click is within the header area (top 20px of the clip)
      if (x >= clipX && x < clipX + clipWidth && y <= CLIP_HEADER_HEIGHT) {
        event.stopPropagation(); // Prevent canvas click handler from firing
        onClipClick?.(clip.id);
        onClipHeaderClick?.(clip.id, clip.start);
        clipClicked = true;
        break;
      }
    }

    // If no clip header was clicked, select the track
    if (!clipClicked) {
      onTrackClick?.();
    }
  };

  return (
    <div className={`track-wrapper ${isFocused ? 'track-wrapper--focused' : ''}`}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        className="track-canvas"
        style={{ cursor: cursorStyle }}
      />
    </div>
  );
};

// Helper functions for clip colors (matching Figma design tokens)
function getClipBackgroundColor(trackIndex: number, selected: boolean): string {
  const colors = {
    track1: { normal: '#6DB9FF', selected: '#C0D9FF' },
    track2: { normal: '#C1BFFE', selected: '#D5D3FE' },
    track3: { normal: '#ECA0D9', selected: '#EFD1EA' },
  };

  const trackKey = `track${(trackIndex % 3) + 1}` as keyof typeof colors;
  return selected ? colors[trackKey].selected : colors[trackKey].normal;
}

function getClipHeaderColor(trackIndex: number, selected: boolean): string {
  const colors = {
    track1: { normal: '#3FA8FF', selected: '#DEEBFF' },
    track2: { normal: '#ADABFC', selected: '#E9E8FF' },
    track3: { normal: '#E787D0', selected: '#F6E8F4' },
  };

  const trackKey = `track${(trackIndex % 3) + 1}` as keyof typeof colors;
  return selected ? colors[trackKey].selected : colors[trackKey].normal;
}

export default Track;
