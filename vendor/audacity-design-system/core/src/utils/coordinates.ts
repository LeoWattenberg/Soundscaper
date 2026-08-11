/**
 * Coordinate conversion utilities for time selection and track positioning
 */

import { Track } from '../types';

/**
 * Convert pixel X position to time in seconds
 * @param x - Pixel position on canvas
 * @param pixelsPerSecond - Zoom level (pixels per second)
 * @param leftPadding - Left padding before timeline starts (DEPRECATED - pass 0)
 * @returns Time in seconds
 */
export function pixelsToTime(x: number, pixelsPerSecond: number, leftPadding: number = 0): number {
  return (x - leftPadding) / pixelsPerSecond;
}

/**
 * Convert time in seconds to pixel X position
 * @param time - Time in seconds
 * @param pixelsPerSecond - Zoom level (pixels per second)
 * @param leftPadding - Left padding before timeline starts (DEPRECATED - pass 0)
 * @returns Pixel X position
 */
export function timeToPixels(time: number, pixelsPerSecond: number, leftPadding: number = 0): number {
  return time * pixelsPerSecond + leftPadding;
}

/**
 * Convert pixel Y position to track index
 * @param y - Pixel Y position
 * @param tracks - Array of tracks with height information
 * @param initialGap - Gap above first track
 * @param trackGap - Gap between tracks
 * @param defaultTrackHeight - Default height when track.height is undefined
 * @returns Track index (may be out of bounds if y is beyond tracks)
 */
export function yToTrackIndex(
  y: number,
  tracks: Track[],
  initialGap: number,
  trackGap: number,
  defaultTrackHeight: number
): number {
  let currentY = initialGap;

  for (let i = 0; i < tracks.length; i++) {
    const trackHeight = tracks[i].height ?? defaultTrackHeight;

    // Check if y is within this track
    if (y >= currentY && y < currentY + trackHeight) {
      return i;
    }

    // Move to next track position
    currentY += trackHeight + trackGap;
  }

  // Return index based on position (may be beyond last track)
  return Math.floor((y - initialGap) / (defaultTrackHeight + trackGap));
}

/**
 * Convert track index to pixel Y position (top of track)
 * @param trackIndex - Track index
 * @param tracks - Array of tracks with height information
 * @param initialGap - Gap above first track
 * @param trackGap - Gap between tracks
 * @param defaultTrackHeight - Default height when track.height is undefined
 * @returns Pixel Y position of track top
 */
export function trackIndexToY(
  trackIndex: number,
  tracks: Track[],
  initialGap: number,
  trackGap: number,
  defaultTrackHeight: number
): number {
  let y = initialGap;

  for (let i = 0; i < trackIndex && i < tracks.length; i++) {
    const trackHeight = tracks[i].height ?? defaultTrackHeight;
    y += trackHeight + trackGap;
  }

  return y;
}

/**
 * Get the height of a specific track
 * @param track - Track object
 * @param defaultTrackHeight - Default height when track.height is undefined
 * @returns Track height in pixels
 */
export function getTrackHeight(track: Track, defaultTrackHeight: number): number {
  return track.height ?? defaultTrackHeight;
}

/**
 * Clamp a track index to valid range [0, tracks.length - 1]
 * @param trackIndex - Track index to clamp
 * @param tracks - Array of tracks
 * @returns Clamped track index
 */
export function clampTrackIndex(trackIndex: number, tracks: Track[]): number {
  return Math.max(0, Math.min(tracks.length - 1, trackIndex));
}

/**
 * Get range of track indices between two indices (inclusive)
 * @param startIndex - Start track index
 * @param endIndex - End track index
 * @returns Array of track indices in range
 */
export function getTrackRange(startIndex: number, endIndex: number): number[] {
  const min = Math.min(startIndex, endIndex);
  const max = Math.max(startIndex, endIndex);
  const range: number[] = [];

  for (let i = min; i <= max; i++) {
    range.push(i);
  }

  return range;
}
