/**
 * Coordinate conversion utilities for spectral selection
 */

import { CLIP_CONTENT_OFFSET } from '../../constants';

export interface CoordinateConfig {
  pixelsPerSecond: number;
  trackHeights: number[];
  trackGap: number;
  initialGap: number;
  clipHeaderHeight: number;
  tracks?: any[]; // Optional tracks array for split view detection and channel split ratio
}

/**
 * Convert time to X pixel position
 * Clips and selections are positioned with CLIP_CONTENT_OFFSET for visual alignment
 */
export function timeToX(time: number, config: CoordinateConfig): number {
  return CLIP_CONTENT_OFFSET + time * config.pixelsPerSecond;
}

/**
 * Convert normalized frequency (0-1) to Y pixel position
 * For split view, only uses the top half (spectrogram area)
 * For stereo tracks, accounts for channel split ratio
 */
export function frequencyToY(
  frequency: number,
  trackIndex: number,
  config: CoordinateConfig,
  channelOffset: 'none' | 'L' | 'R' = 'none'
): number {
  let trackY = config.initialGap;
  for (let i = 0; i < trackIndex; i++) {
    trackY += config.trackHeights[i] + config.trackGap;
  }

  const trackHeight = config.trackHeights[trackIndex];
  const clipBodyY = trackY + config.clipHeaderHeight;
  const clipBodyHeight = trackHeight - config.clipHeaderHeight;

  // For split view, spectral area is only the top half
  const track = config.tracks?.[trackIndex];
  const isSplitView = track?.viewMode === 'split';
  const isSpectrogramMode = track?.viewMode === 'spectrogram';
  const spectralAreaHeight = isSplitView ? clipBodyHeight / 2 : clipBodyHeight;

  // For stereo tracks with channel offset, scale within the specific channel
  if (channelOffset !== 'none') {
    const channelSplitRatio = track?.channelSplitRatio ?? 0.5;
    // In both split view and spectrogram mode, we use the spectral area height
    // (which is half the clip body in split view, full clip body in spectrogram mode)
    const lChannelHeight = spectralAreaHeight * channelSplitRatio;
    const rChannelHeight = spectralAreaHeight * (1 - channelSplitRatio);

    if (channelOffset === 'L') {
      // L channel displays frequencies 0.5-1.0 in the stereo spectrogram
      // But the frequency values passed in are already normalized to 0-1 for this channel
      // So we just map the 0-1 frequency to the L channel height
      const yInLChannel = (1 - frequency) * lChannelHeight;
      return clipBodyY + yInLChannel;
    } else {
      // R channel displays frequencies 0-0.5 in the stereo spectrogram
      // But the frequency values passed in are already normalized to 0-1 for this channel
      // So we just map the 0-1 frequency to the R channel height, offset by L channel height
      const yInRChannel = (1 - frequency) * rChannelHeight;
      return clipBodyY + lChannelHeight + yInRChannel;
    }
  }

  // Default: map to full spectral area
  // Invert: 1 = top, 0 = bottom
  const yInSpectralArea = (1 - frequency) * spectralAreaHeight;

  return clipBodyY + yInSpectralArea;
}

/**
 * Calculate selection bounds in pixels
 */
export interface SelectionBounds {
  leftX: number;
  rightX: number;
  topY: number;
  bottomY: number;
  centerY: number;
  width: number;
  height: number;
}

export function getSelectionBounds(
  startTime: number,
  endTime: number,
  minFrequency: number,
  maxFrequency: number,
  trackIndex: number,
  config: CoordinateConfig,
  channelOffset: 'none' | 'L' | 'R' = 'none'
): SelectionBounds {
  const leftX = timeToX(startTime, config);
  const rightX = timeToX(endTime, config);
  const topY = frequencyToY(maxFrequency, trackIndex, config, channelOffset);
  const bottomY = frequencyToY(minFrequency, trackIndex, config, channelOffset);

  return {
    leftX,
    rightX,
    topY,
    bottomY,
    centerY: (topY + bottomY) / 2,
    width: rightX - leftX,
    height: bottomY - topY,
  };
}
