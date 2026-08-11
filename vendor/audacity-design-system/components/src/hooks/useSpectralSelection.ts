/**
 * useSpectralSelection Hook
 *
 * Manages spectral (frequency-range) selection interactions within clips
 * in spectrogram mode. Handles creating and resizing spectral selections.
 *
 * Coordinate System:
 * - Clips are positioned at `CLIP_CONTENT_OFFSET + clip.start * pixelsPerSecond`
 * - Mouse X/Y are relative to canvas container
 * - All boundary checks and coordinate conversions must account for CLIP_CONTENT_OFFSET
 */

import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { CLIP_CONTENT_OFFSET } from '../constants';
import { SpectralSelection } from '@audacity-ui/core';

export type { SpectralSelection };

interface SpectralTrack {
  id: number;
  clips: SpectralClip[];
  height?: number;
  viewMode?: 'waveform' | 'spectrogram' | 'split';
}

interface SpectralClip {
  id: number;
  start: number;
  duration: number;
}

export interface UseSpectralSelectionConfig {
  /** Ref to the container element */
  containerRef: RefObject<HTMLElement>;
  /** Current spectral selection */
  currentSpectralSelection: SpectralSelection | null;
  /** Tracks data */
  tracks: SpectralTrack[];
  /** Pixels per second - zoom level */
  pixelsPerSecond: number;
  /** Default track height */
  defaultTrackHeight: number;
  /** Track gap in pixels */
  trackGap: number;
  /** Initial gap at top */
  initialGap: number;
  /** Clip header height */
  clipHeaderHeight: number;
  /** Whether spectral selection is enabled (should be spectrogramMode) */
  enabled: boolean;
}

export interface UseSpectralSelectionCallbacks {
  /** Called when spectral selection changes */
  onSpectralSelectionChange: (selection: SpectralSelection | null) => void;
  /** Called when spectral selection is finalized (on mouse up) */
  onSpectralSelectionFinalized?: (selection: SpectralSelection | null) => void;
  /** Callback to clear time selection when spectral selection starts */
  onClearTimeSelection?: () => void;
  /** Callback to convert spectral selection to time selection when dragged out of bounds */
  onConvertToTimeSelection?: (startTime: number, endTime: number, trackIndices: number[], currentX: number, currentY: number, dragStartX: number, dragStartY: number, spectralSelection: SpectralSelection) => void;
}

type ResizeMode =
  | 'create'
  | 'move'
  | 'resize-left'
  | 'resize-right'
  | 'resize-top'
  | 'resize-bottom'
  | 'resize-tl'
  | 'resize-tr'
  | 'resize-bl'
  | 'resize-br';

interface DragState {
  isDragging: boolean;
  mode: ResizeMode;
  trackIndex: number;
  clipId: number; // The clip where the drag started (for initial clip reference)
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  initialSelection: SpectralSelection | null;
  converted?: boolean; // Track if we've temporarily converted to time selection (can revert)
}

/**
 * Hook for managing spectral selection interactions
 */
export function useSpectralSelection(
  config: UseSpectralSelectionConfig,
  callbacks: UseSpectralSelectionCallbacks
) {
  const {
    containerRef,
    currentSpectralSelection,
    tracks,
    pixelsPerSecond,
    defaultTrackHeight,
    trackGap,
    initialGap,
    clipHeaderHeight,
    enabled,
  } = config;

  const { onSpectralSelectionChange, onSpectralSelectionFinalized, onClearTimeSelection, onConvertToTimeSelection } = callbacks;

  const dragStateRef = useRef<DragState | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [cursorStyle, setCursorStyle] = useState('default');
  const wasDraggingRef = useRef(false);
  const justConvertedRef = useRef(false);

  /**
   * Check if a position is within a clip that supports spectral selection
   * Returns true if position is on a clip with spectrogram or split view
   */
  const isPositionOnSpectralClip = useCallback((x: number, y: number): boolean => {
    let currentY = initialGap;

    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
      const track = tracks[trackIndex];
      const trackHeight = track.height || defaultTrackHeight;
      const clipBodyY = currentY + clipHeaderHeight;
      const clipBodyHeight = trackHeight - clipHeaderHeight;

      // Check if Y is within this track's clip body area
      if (y >= clipBodyY && y < clipBodyY + clipBodyHeight) {
        // Check if track has spectral view enabled
        if (track.viewMode !== 'spectrogram' && track.viewMode !== 'split') {
          return false; // Track doesn't support spectral selection
        }

        // For split view, check if click is in spectral area (top half)
        if (track.viewMode === 'split') {
          const splitY = clipBodyY + clipBodyHeight / 2;
          if (y > splitY) {
            return false; // Click in waveform area of split view
          }
        }

        // Check if X is within any clip in this track
        for (const clip of track.clips) {
          // Clips are rendered WITH CLIP_CONTENT_OFFSET for visual alignment
          const clipStartX = CLIP_CONTENT_OFFSET + clip.start * pixelsPerSecond;
          const clipEndX = clipStartX + clip.duration * pixelsPerSecond;

          if (x >= clipStartX && x <= clipEndX) {
            return true; // Position is on a spectral-enabled clip
          }
        }

        return false; // Position is in track but not on a clip
      }

      currentY += trackHeight + trackGap;
    }

    return false; // Position not in any track
  }, [tracks, pixelsPerSecond, defaultTrackHeight, trackGap, initialGap, clipHeaderHeight]);

  const EDGE_THRESHOLD = 6; // pixels from edge to detect resize
  const CORNER_SIZE = 6; // size of corner handle areas

  /**
   * Find which clip (if any) is at the given position
   * For split view, only returns clip if position is in spectral area (top half)
   */
  const findClipAtPosition = useCallback((x: number, y: number): { trackIndex: number; clip: SpectralClip } | null => {
    let currentY = initialGap;

    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
      const track = tracks[trackIndex];
      const trackHeight = track.height || defaultTrackHeight;

      // Check if y is within this track
      if (y >= currentY && y < currentY + trackHeight) {
        // Check each clip in this track
        for (const clip of track.clips) {
          // Clips are rendered WITH CLIP_CONTENT_OFFSET for visual alignment
          const clipStartX = CLIP_CONTENT_OFFSET + clip.start * pixelsPerSecond;
          const clipEndX = clipStartX + clip.duration * pixelsPerSecond;
          const clipBodyY = currentY + clipHeaderHeight;
          const clipBodyHeight = trackHeight - clipHeaderHeight;

          // Check if position is within clip body (not header)
          if (
            x >= clipStartX &&
            x <= clipEndX &&
            y >= clipBodyY &&
            y < clipBodyY + clipBodyHeight
          ) {
            // Only create spectral selection if track has spectral view enabled
            // (either 'spectrogram' or 'split' view mode)
            if (track.viewMode !== 'spectrogram' && track.viewMode !== 'split') {
              // Track is in waveform mode - don't create spectral selection
              return null;
            }

            // For split view, only allow spectral selection in top half (spectrogram area)
            if (track.viewMode === 'split') {
              const splitY = clipBodyY + clipBodyHeight / 2;
              if (y > splitY) {
                // Click was in bottom half (waveform area) - don't create spectral selection
                return null;
              }
            }
            return { trackIndex, clip };
          }
        }
      }

      currentY += trackHeight + trackGap;
    }

    return null;
  }, [tracks, pixelsPerSecond, defaultTrackHeight, trackGap, initialGap, clipHeaderHeight]);

  /**
   * Check if Y position is outside the track bounds
   * We allow the cursor to be in the header area (to select full frequency range)
   * but return true if cursor goes outside the track entirely (into another track or empty space)
   * Includes hysteresis (resistance) when dragging DOWN to prevent accidental conversion
   * No resistance when dragging UP (clip header provides natural buffer)
   */
  const isYOutsideClipBounds = useCallback((y: number, trackIndex: number): boolean => {
    const HYSTERESIS_THRESHOLD_DOWN = 15; // pixels of resistance when dragging down to next track
    const SPLIT_LINE_HYSTERESIS = 20; // resistance for split line - matches clip header height

    let trackY = initialGap;
    for (let i = 0; i < trackIndex; i++) {
      trackY += (tracks[i].height || defaultTrackHeight) + trackGap;
    }

    const track = tracks[trackIndex];
    const trackHeight = track.height || defaultTrackHeight;

    // Check boundaries with hysteresis only for downward direction
    // Up: immediate conversion (no resistance - header provides natural buffer)
    // Down: requires HYSTERESIS_THRESHOLD_DOWN pixels beyond boundary
    if (y < trackY || y > trackY + trackHeight + HYSTERESIS_THRESHOLD_DOWN) {
      return true;
    }

    // In split view, spectral selection is only valid in top half (spectrogram area)
    // Use smaller hysteresis for split line since it's a clear visual boundary
    if (track.viewMode === 'split') {
      const clipBodyY = trackY + clipHeaderHeight;
      const clipBodyHeight = trackHeight - clipHeaderHeight;
      const splitY = clipBodyY + clipBodyHeight / 2;
      return y > splitY + SPLIT_LINE_HYSTERESIS; // Below the split line (+ small resistance)
    }

    return false;
  }, [tracks, defaultTrackHeight, trackGap, initialGap, clipHeaderHeight]);

  /**
   * Check if X position is outside the clip bounds (in pixel space)
   * This matches the Y boundary check - no hysteresis, immediate detection
   */
  const isXOutsideClipBounds = useCallback((x: number, trackIndex: number, clipId: number): boolean => {
    const track = tracks[trackIndex];
    const clip = track.clips.find(c => c.id === clipId);
    if (!clip) return true;

    // Clips are rendered WITH CLIP_CONTENT_OFFSET for visual alignment
    const clipStartX = CLIP_CONTENT_OFFSET + clip.start * pixelsPerSecond;
    const clipEndX = clipStartX + clip.duration * pixelsPerSecond;

    // Check if X is outside the clip bounds
    // Use <= for left edge to trigger conversion when exactly at boundary (prevents visual sticking)
    // Use > for right edge to match existing behavior
    return x <= clipStartX || x > clipEndX;
  }, [tracks, pixelsPerSecond]);

  /**
   * Clamp time to be within clip boundaries
   */
  const clampTimeToClip = useCallback((time: number, trackIndex: number, clipId: number): number => {
    const track = tracks[trackIndex];
    const clip = track.clips.find(c => c.id === clipId);
    if (!clip) return time;

    const clipStart = clip.start;
    const clipEnd = clip.start + clip.duration;

    return Math.max(clipStart, Math.min(clipEnd, time));
  }, [tracks]);

  /**
   * Convert Y position within clip body to normalized frequency (0-1)
   * In split view, only uses the top half (spectrogram area)
   */
  const yToFrequency = useCallback((y: number, trackIndex: number): number => {
    let trackY = initialGap;
    for (let i = 0; i < trackIndex; i++) {
      trackY += (tracks[i].height || defaultTrackHeight) + trackGap;
    }

    const track = tracks[trackIndex];
    const trackHeight = track.height || defaultTrackHeight;
    const clipBodyY = trackY + clipHeaderHeight;
    const clipBodyHeight = trackHeight - clipHeaderHeight;

    // In split view, only use top half for frequency calculation
    const spectralAreaHeight = track.viewMode === 'split' ? clipBodyHeight / 2 : clipBodyHeight;
    const spectralAreaTop = clipBodyY;
    const spectralAreaBottom = spectralAreaTop + spectralAreaHeight;

    // Clamp Y to spectral area bounds to prevent dragging into waveform area
    const clampedY = Math.max(spectralAreaTop, Math.min(spectralAreaBottom, y));

    // Y position within spectral area (0 = top, spectralAreaHeight = bottom)
    const yInSpectralArea = clampedY - spectralAreaTop;

    // Normalize to 0-1, then invert (0 = bottom/low freq, 1 = top/high freq)
    const frequency = 1 - (yInSpectralArea / spectralAreaHeight);

    return Math.max(0, Math.min(1, frequency));
  }, [tracks, defaultTrackHeight, trackGap, initialGap, clipHeaderHeight]);

  /**
   * Convert X position to time
   * NOTE: Clips are positioned WITHOUT leftPadding (see Track.tsx line 118)
   * Mouse X is also relative to the canvas container (no leftPadding offset)
   */
  const xToTime = useCallback((x: number): number => {
    return (x - CLIP_CONTENT_OFFSET) / pixelsPerSecond;
  }, [pixelsPerSecond]);

  /**
   * Convert time to X position
   * NOTE: Clips are positioned WITHOUT leftPadding
   */
  const timeToX = useCallback((time: number): number => {
    return CLIP_CONTENT_OFFSET + time * pixelsPerSecond;
  }, [pixelsPerSecond]);

  /**
   * Convert normalized frequency to Y position
   * In split view, only uses the top half (spectrogram area)
   */
  const frequencyToY = useCallback((frequency: number, trackIndex: number): number => {
    let trackY = initialGap;
    for (let i = 0; i < trackIndex; i++) {
      trackY += (tracks[i].height || defaultTrackHeight) + trackGap;
    }

    const track = tracks[trackIndex];
    const trackHeight = track.height || defaultTrackHeight;
    const clipBodyY = trackY + clipHeaderHeight;
    const clipBodyHeight = trackHeight - clipHeaderHeight;

    // In split view, only use top half for frequency positioning
    const spectralAreaHeight = track.viewMode === 'split' ? clipBodyHeight / 2 : clipBodyHeight;
    const spectralAreaTop = clipBodyY;

    // Invert: 1 = top, 0 = bottom
    const yInSpectralArea = (1 - frequency) * spectralAreaHeight;

    return spectralAreaTop + yInSpectralArea;
  }, [tracks, defaultTrackHeight, trackGap, initialGap, clipHeaderHeight]);

  /**
   * Check if the spectral selection spans the full frequency range
   * Returns true if BOTH top and bottom edges are at or beyond the clip body boundaries
   * (meaning the selection covers all frequencies = equivalent to time selection)
   */
  const isSelectionFullFrequencyRange = useCallback((minFreq: number, maxFreq: number, trackIndex: number): boolean => {
    let trackY = initialGap;
    for (let i = 0; i < trackIndex; i++) {
      trackY += (tracks[i].height || defaultTrackHeight) + trackGap;
    }

    const track = tracks[trackIndex];
    const trackHeight = track.height || defaultTrackHeight;
    const clipBodyY = trackY + clipHeaderHeight;
    const clipBodyHeight = trackHeight - clipHeaderHeight;

    // In split view, only use top half for spectral area
    const spectralAreaHeight = track.viewMode === 'split' ? clipBodyHeight / 2 : clipBodyHeight;

    // Convert frequency bounds to Y positions
    const topY = frequencyToY(maxFreq, trackIndex);
    const bottomY = frequencyToY(minFreq, trackIndex);

    const spectralAreaTop = clipBodyY;
    const spectralAreaBottom = clipBodyY + spectralAreaHeight;

    // Check if selection spans the full frequency range
    // Top edge at or above the top boundary AND bottom edge at or below the bottom boundary
    const topAtBoundary = topY <= spectralAreaTop;
    const bottomAtBoundary = bottomY >= spectralAreaBottom;

    return topAtBoundary && bottomAtBoundary;
  }, [tracks, defaultTrackHeight, trackGap, initialGap, clipHeaderHeight, frequencyToY]);

  /**
   * Detect resize mode based on position relative to current selection
   */
  const detectResizeMode = useCallback((x: number, y: number): ResizeMode | null => {
    if (!currentSpectralSelection) return null;

    const { trackIndex, startTime, endTime, minFrequency, maxFrequency, clipId } = currentSpectralSelection;

    // Convert selection bounds to pixel coordinates
    const leftX = timeToX(startTime);
    const rightX = timeToX(endTime);
    const topY = frequencyToY(maxFrequency, trackIndex);
    const bottomY = frequencyToY(minFrequency, trackIndex);

    // Check if position is within selection bounds (with some tolerance)
    let withinX = x >= leftX - EDGE_THRESHOLD && x <= rightX + EDGE_THRESHOLD;
    let withinY = y >= topY - EDGE_THRESHOLD && y <= bottomY + EDGE_THRESHOLD;

    // For stereo tracks, also check the mirrored channel bounds
    const track = tracks[trackIndex];
    const clip = track.clips.find(c => c.id === clipId);
    const isStereo = clip && (clip as any).waveformLeft && (clip as any).waveformRight;
    const isSpectrogramMode = track.viewMode === 'spectrogram';
    const isSplitView = track.viewMode === 'split';

    if ((isSpectrogramMode || isSplitView) && isStereo) {
      // Determine if selection is in L or R channel
      const isInLChannel = minFrequency >= 0.5;
      const isInRChannel = maxFrequency <= 0.5;

      // Calculate mirrored frequency range
      let mirroredMinFreq: number, mirroredMaxFreq: number;
      if (isInLChannel) {
        // Mirror L channel (0.5-1.0) to R channel (0-0.5)
        mirroredMinFreq = (minFrequency - 0.5) * 2;
        mirroredMaxFreq = (maxFrequency - 0.5) * 2;
      } else if (isInRChannel) {
        // Mirror R channel (0-0.5) to L channel (0.5-1.0)
        mirroredMinFreq = minFrequency / 2 + 0.5;
        mirroredMaxFreq = maxFrequency / 2 + 0.5;
      } else {
        // Selection spans both channels, no mirroring needed
        mirroredMinFreq = minFrequency;
        mirroredMaxFreq = maxFrequency;
      }

      // Check mirrored bounds
      const mirroredTopY = frequencyToY(mirroredMaxFreq, trackIndex);
      const mirroredBottomY = frequencyToY(mirroredMinFreq, trackIndex);
      const withinMirroredY = y >= mirroredTopY - EDGE_THRESHOLD && y <= mirroredBottomY + EDGE_THRESHOLD;

      // Allow interaction on either the original or mirrored channel
      withinY = withinY || withinMirroredY;
    }

    if (!withinX || !withinY) return null;

    // Check corners first (priority over edges)
    const onLeft = Math.abs(x - leftX) <= CORNER_SIZE;
    const onRight = Math.abs(x - rightX) <= CORNER_SIZE;
    const onTop = Math.abs(y - topY) <= CORNER_SIZE;
    const onBottom = Math.abs(y - bottomY) <= CORNER_SIZE;

    if (onLeft && onTop) return 'resize-tl';
    if (onRight && onTop) return 'resize-tr';
    if (onLeft && onBottom) return 'resize-bl';
    if (onRight && onBottom) return 'resize-br';

    // Check center line (horizontal line at middle of selection)
    const centerY = (topY + bottomY) / 2;
    const nearCenterLine = Math.abs(y - centerY) <= EDGE_THRESHOLD;
    const insideX = x >= leftX + EDGE_THRESHOLD && x <= rightX - EDGE_THRESHOLD;

    if (nearCenterLine && insideX) return 'move';

    // Check edges
    const nearLeft = Math.abs(x - leftX) <= EDGE_THRESHOLD;
    const nearRight = Math.abs(x - rightX) <= EDGE_THRESHOLD;
    const nearTop = Math.abs(y - topY) <= EDGE_THRESHOLD;
    const nearBottom = Math.abs(y - bottomY) <= EDGE_THRESHOLD;

    if (nearLeft) return 'resize-left';
    if (nearRight) return 'resize-right';
    if (nearTop) return 'resize-top';
    if (nearBottom) return 'resize-bottom';

    return null;
  }, [currentSpectralSelection, timeToX, frequencyToY, EDGE_THRESHOLD, CORNER_SIZE]);

  /**
   * Get cursor style based on resize mode
   */
  const getCursorForMode = useCallback((mode: ResizeMode | null): string => {
    if (!mode) return 'default';

    switch (mode) {
      case 'move':
        return 'move';
      case 'resize-left':
      case 'resize-right':
        return 'ew-resize';
      case 'resize-top':
      case 'resize-bottom':
        return 'ns-resize';
      case 'resize-tl':
      case 'resize-br':
        return 'nwse-resize';
      case 'resize-tr':
      case 'resize-bl':
        return 'nesw-resize';
      default:
        return 'default';
    }
  }, []);

  /**
   * Start spectral selection drag
   * @returns true if drag started, false otherwise
   */
  const startDrag = useCallback((x: number, y: number): boolean => {
    if (!enabled) return false;
    if (justConvertedRef.current) return false; // Don't start new drag right after conversion

    // First check if we're resizing an existing selection
    const resizeMode = detectResizeMode(x, y);
    if (resizeMode && currentSpectralSelection) {
      // Find which clip we're resizing from (if selection spans multiple clips, use the one under cursor)
      const clipAtCursor = findClipAtPosition(x, y);
      if (!clipAtCursor) return false;

      dragStateRef.current = {
        isDragging: true,
        mode: resizeMode,
        trackIndex: currentSpectralSelection.trackIndex,
        clipId: clipAtCursor.clip.id,
        startX: x,
        startY: y,
        currentX: x,
        currentY: y,
        initialSelection: { ...currentSpectralSelection },
      };
      setIsDragging(true);
      return true;
    }

    // Otherwise, start creating a new selection
    const clipAtPosition = findClipAtPosition(x, y);
    if (!clipAtPosition) return false;

    const { trackIndex, clip } = clipAtPosition;

    dragStateRef.current = {
      isDragging: true,
      mode: 'create',
      trackIndex,
      clipId: clip.id,
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
      initialSelection: null,
    };

    // Clear any existing time selection when creating new spectral selection
    if (onClearTimeSelection) {
      onClearTimeSelection();
    }

    setIsDragging(true);
    return true;
  }, [enabled, detectResizeMode, currentSpectralSelection, findClipAtPosition, onClearTimeSelection]);

  /**
   * Update spectral selection during drag
   */
  const handleMouseMove = useCallback((x: number, y: number) => {
    if (!dragStateRef.current?.isDragging) return;
    if (justConvertedRef.current) return; // Don't process if we just converted to time selection

    dragStateRef.current.currentX = x;
    dragStateRef.current.currentY = y;

    const { trackIndex, clipId, startX, startY, mode, initialSelection } = dragStateRef.current;

    if (mode === 'create') {
      // Check if cursor is outside bounds - convert to time selection if:
      // - Y is in a different track (allow horizontal spanning of multiple clips on same track)
      const yOutsideBounds = isYOutsideClipBounds(y, trackIndex);
      const wasConverted = dragStateRef.current.converted === true;

      // If we previously converted but are now back in bounds, revert to spectral selection
      if (wasConverted && !yOutsideBounds) {
        // Back in spectral area - clear conversion flag and continue with spectral selection
        dragStateRef.current.converted = false;
        // Clear the time selection by passing null spectral selection to the conversion callback
        // This will clear the time selection overlay
        if (onClearTimeSelection) {
          onClearTimeSelection();
        }
      }

      // Convert if we're in another track (allow horizontal spanning across clips)
      if (yOutsideBounds && !wasConverted && onConvertToTimeSelection) {
        // First, save the current spectral selection state before converting
        // Calculate the current selection bounds
        const rawStartTime = xToTime(startX);
        const rawEndTime = xToTime(x);

        // Clamp times to clip boundaries for the visual marquee
        const clampedStartTime = clampTimeToClip(rawStartTime, trackIndex, clipId);
        const clampedEndTime = clampTimeToClip(rawEndTime, trackIndex, clipId);
        const clampedSelStartTime = Math.min(clampedStartTime, clampedEndTime);
        const clampedSelEndTime = Math.max(clampedStartTime, clampedEndTime);

        // Calculate frequencies
        let freq1 = yToFrequency(startY, trackIndex);
        let freq2 = yToFrequency(y, trackIndex);

        // Apply stereo channel constraints if needed
        const track = tracks[trackIndex];
        const clip = track.clips.find(c => c.id === clipId);
        const isStereo = clip && (clip as any).waveformLeft && (clip as any).waveformRight;
        const isSpectrogramMode = track.viewMode === 'spectrogram';
        const isSplitView = track.viewMode === 'split';

        if ((isSpectrogramMode || isSplitView) && isStereo) {
          const startedInLChannel = freq1 >= 0.5;
          if (startedInLChannel) {
            freq1 = Math.max(0.5, Math.min(1.0, freq1));
            freq2 = Math.max(0.5, Math.min(1.0, freq2));
          } else {
            freq1 = Math.max(0.0, Math.min(0.5, freq1));
            freq2 = Math.max(0.0, Math.min(0.5, freq2));
          }
        }

        const minFrequency = Math.min(freq1, freq2);
        const maxFrequency = Math.max(freq1, freq2);

        // Determine origin channel for stereo tracks
        let originChannel: 'L' | 'R' | 'mono' | undefined;
        if ((isSpectrogramMode || isSplitView) && isStereo) {
          const startedInLChannel = freq1 >= 0.5;
          originChannel = startedInLChannel ? 'L' : 'R';
        } else if (!isStereo) {
          originChannel = 'mono';
        }

        // Create the spectral selection object (no clipId - can span multiple clips)
        const spectralSelectionToKeep: SpectralSelection = {
          trackIndex,
          startTime: clampedSelStartTime,
          endTime: clampedSelEndTime,
          minFrequency,
          maxFrequency,
          originChannel,
        };

        // Update the spectral selection so it remains visible on the clip
        onSpectralSelectionChange(spectralSelectionToKeep);

        // Get all selected track indices (just the current track for spectral selection)
        const trackIndices = [trackIndex];

        // Use unclamped times for the time selection (can extend beyond clip)
        const startTime = Math.min(rawStartTime, rawEndTime);
        const endTime = Math.max(rawStartTime, rawEndTime);
        // Convert to time selection, passing the spectral selection to preserve
        onConvertToTimeSelection(
          startTime,
          endTime,
          trackIndices,
          x,
          y,
          startX,
          startY,
          spectralSelectionToKeep
        );

        // Mark as converted but keep drag state alive so we can revert if user drags back
        dragStateRef.current.converted = true;
        return;
      }

      // Only render spectral selection if not currently converted to time selection
      if (!wasConverted) {
        // Creating new selection - allow spanning across multiple clips on the same track
        const rawStartTime = xToTime(startX);
        const rawEndTime = xToTime(x);

      // Don't clamp to clip boundaries - allow spanning multiple clips
      const startTime = Math.min(rawStartTime, rawEndTime);
      const endTime = Math.max(rawStartTime, rawEndTime);

      // Convert Y positions to frequencies (automatically clamped to clip bounds)
      let freq1 = yToFrequency(startY, trackIndex);
      let freq2 = yToFrequency(y, trackIndex);

      // For stereo spectrogram/split, constrain frequencies to stay within the channel where drag started
      const track = tracks[trackIndex];
      const clip = track.clips.find(c => c.id === clipId);
      const isStereo = clip && (clip as any).waveformLeft && (clip as any).waveformRight;
      const isSpectrogramMode = track.viewMode === 'spectrogram';
      const isSplitView = track.viewMode === 'split';

      if ((isSpectrogramMode || isSplitView) && isStereo) {
        // Determine which channel the drag started in based on startY frequency
        // L channel (top): 0.5-1.0, R channel (bottom): 0.0-0.5
        const startedInLChannel = freq1 >= 0.5;

        if (startedInLChannel) {
          // Constrain to L channel (0.5-1.0)
          freq1 = Math.max(0.5, Math.min(1.0, freq1));
          freq2 = Math.max(0.5, Math.min(1.0, freq2));
        } else {
          // Constrain to R channel (0.0-0.5)
          freq1 = Math.max(0.0, Math.min(0.5, freq1));
          freq2 = Math.max(0.0, Math.min(0.5, freq2));
        }
      }

      const minFrequency = Math.min(freq1, freq2);
      const maxFrequency = Math.max(freq1, freq2);

      // Determine origin channel for stereo tracks
      let originChannel: 'L' | 'R' | 'mono' | undefined;
      if ((isSpectrogramMode || isSplitView) && isStereo) {
        const startedInLChannel = freq1 >= 0.5;
        originChannel = startedInLChannel ? 'L' : 'R';
      } else if (!isStereo) {
        originChannel = 'mono';
      }

        // Call callback to update selection during drag
        // Don't include clipId - allow selection to span multiple clips
        onSpectralSelectionChange({
          trackIndex,
          startTime,
          endTime,
          minFrequency,
          maxFrequency,
          originChannel,
        });
      }
    } else if (initialSelection) {
      // Resizing existing selection
      let startTime = initialSelection.startTime;
      let endTime = initialSelection.endTime;
      let minFrequency = initialSelection.minFrequency;
      let maxFrequency = initialSelection.maxFrequency;

      const currentTime = xToTime(x);

      // Check if Y is outside clip bounds (pixel-space check) BEFORE converting to frequency
      const yOutsideBounds = isYOutsideClipBounds(y, trackIndex);

      // Check if X is outside clip bounds (pixel-space check)
      const xOutsideBounds = isXOutsideClipBounds(x, trackIndex, clipId);

      // Clamp the current position to stay within clip bounds during resize
      // (We don't want to convert to time selection when resizing, only when creating)
      const currentFreq = yToFrequency(y, trackIndex);

      // Calculate center frequency for inverse resizing
      const centerFreq = (initialSelection.minFrequency + initialSelection.maxFrequency) / 2;

      // Update based on resize mode
      switch (mode) {
        case 'move':
          // Move entire selection both horizontally and vertically
          const deltaTime = currentTime - xToTime(startX);
          let newStartTime = initialSelection.startTime + deltaTime;
          let newEndTime = initialSelection.endTime + deltaTime;

          // Get clip boundaries
          const track = tracks[trackIndex];
          const clip = track.clips.find(c => c.id === clipId);
          if (clip) {
            const clipStart = clip.start;
            const clipEnd = clip.start + clip.duration;
            const selectionDuration = initialSelection.endTime - initialSelection.startTime;

            // Clamp the movement so the entire selection stays within clip bounds
            if (newStartTime < clipStart) {
              newStartTime = clipStart;
              newEndTime = clipStart + selectionDuration;
            } else if (newEndTime > clipEnd) {
              newEndTime = clipEnd;
              newStartTime = clipEnd - selectionDuration;
            }
          }

          startTime = newStartTime;
          endTime = newEndTime;

          const startYFreq = yToFrequency(startY, trackIndex);
          const deltaFreq = currentFreq - startYFreq;
          let newMinFreq = initialSelection.minFrequency + deltaFreq;
          let newMaxFreq = initialSelection.maxFrequency + deltaFreq;

          // Preserve selection height when clamping - don't allow it to resize when hitting boundaries
          const freqHeight = initialSelection.maxFrequency - initialSelection.minFrequency;

          // Clamp to 0-1 range while maintaining height
          if (newMinFreq < 0) {
            newMinFreq = 0;
            newMaxFreq = freqHeight;
          } else if (newMaxFreq > 1) {
            newMaxFreq = 1;
            newMinFreq = 1 - freqHeight;
          }

          minFrequency = newMinFreq;
          maxFrequency = newMaxFreq;
          break;
        case 'resize-left':
          startTime = currentTime;
          break;
        case 'resize-right':
          endTime = currentTime;
          break;
        case 'resize-top':
          // Move top edge and bottom edge inversely around center
          const topDelta = currentFreq - initialSelection.maxFrequency;
          maxFrequency = currentFreq;
          minFrequency = initialSelection.minFrequency - topDelta;
          break;
        case 'resize-bottom':
          // Move bottom edge and top edge inversely around center
          const bottomDelta = currentFreq - initialSelection.minFrequency;
          minFrequency = currentFreq;
          maxFrequency = initialSelection.maxFrequency - bottomDelta;
          break;
        case 'resize-tl':
          // Corner resize - only resize the edges being dragged
          startTime = currentTime;
          maxFrequency = currentFreq;
          break;
        case 'resize-tr':
          // Corner resize - only resize the edges being dragged
          endTime = currentTime;
          maxFrequency = currentFreq;
          break;
        case 'resize-bl':
          // Corner resize - only resize the edges being dragged
          startTime = currentTime;
          minFrequency = currentFreq;
          break;
        case 'resize-br':
          // Corner resize - only resize the edges being dragged
          endTime = currentTime;
          minFrequency = currentFreq;
          break;
      }

      // Clamp frequencies to 0-1 range
      minFrequency = Math.max(0, Math.min(1, minFrequency));
      maxFrequency = Math.max(0, Math.min(1, maxFrequency));

      // For stereo spectrogram or split view, constrain frequencies to stay within the channel of the initial selection during resize
      const track = tracks[trackIndex];
      const clip = track.clips.find(c => c.id === clipId);
      const isStereo = clip && (clip as any).waveformLeft && (clip as any).waveformRight;
      const isSpectrogramMode = track.viewMode === 'spectrogram';
      const isSplitView = track.viewMode === 'split';

      if ((isSpectrogramMode || isSplitView) && isStereo && initialSelection) {
        // Determine which channel the selection was in based on initial frequencies
        // L channel (top): 0.5-1.0, R channel (bottom): 0.0-0.5
        const wasInLChannel = initialSelection.minFrequency >= 0.5 || initialSelection.maxFrequency > 0.5;

        if (mode === 'move') {
          // For move operations, preserve selection height when hitting channel boundaries
          const freqHeight = maxFrequency - minFrequency;

          if (wasInLChannel) {
            // Constrain to L channel (0.5-1.0) while maintaining height
            if (minFrequency < 0.5) {
              minFrequency = 0.5;
              maxFrequency = 0.5 + freqHeight;
            } else if (maxFrequency > 1.0) {
              maxFrequency = 1.0;
              minFrequency = 1.0 - freqHeight;
            }
          } else {
            // Constrain to R channel (0.0-0.5) while maintaining height
            if (minFrequency < 0.0) {
              minFrequency = 0.0;
              maxFrequency = 0.0 + freqHeight;
            } else if (maxFrequency > 0.5) {
              maxFrequency = 0.5;
              minFrequency = 0.5 - freqHeight;
            }
          }
        } else {
          // For resize operations, allow edges to hit boundaries independently
          if (wasInLChannel) {
            // Constrain to L channel (0.5-1.0)
            minFrequency = Math.max(0.5, Math.min(1.0, minFrequency));
            maxFrequency = Math.max(0.5, Math.min(1.0, maxFrequency));
          } else {
            // Constrain to R channel (0.0-0.5)
            minFrequency = Math.max(0.0, Math.min(0.5, minFrequency));
            maxFrequency = Math.max(0.0, Math.min(0.5, maxFrequency));
          }
        }
      }

      // Clamp times to clip boundaries
      startTime = clampTimeToClip(startTime, trackIndex, clipId);
      endTime = clampTimeToClip(endTime, trackIndex, clipId);

      // Ensure proper ordering
      if (startTime > endTime) {
        [startTime, endTime] = [endTime, startTime];
      }
      if (minFrequency > maxFrequency) {
        [minFrequency, maxFrequency] = [maxFrequency, minFrequency];
      }

      // Call callback to update selection during drag
      onSpectralSelectionChange({
        trackIndex,
        clipId,
        startTime,
        endTime,
        minFrequency,
        maxFrequency,
        originChannel: initialSelection?.originChannel, // Preserve original channel when resizing/moving
      });
    }
  }, [xToTime, yToFrequency, isYOutsideClipBounds, isXOutsideClipBounds, onSpectralSelectionChange, onConvertToTimeSelection]);

  /**
   * Update cursor based on hover position (for when not dragging)
   */
  const updateCursor = useCallback((x: number, y: number) => {
    if (isDragging) return;

    const resizeMode = detectResizeMode(x, y);
    const cursor = getCursorForMode(resizeMode);
    setCursorStyle(cursor);
  }, [isDragging, detectResizeMode, getCursorForMode]);

  /**
   * End spectral selection drag
   */
  const endDrag = useCallback(() => {
    if (dragStateRef.current?.isDragging) {
      const { startX, startY, currentX, currentY, mode } = dragStateRef.current;

      // Only set wasDragging flag if we actually moved the mouse (not just a click)
      const deltaX = Math.abs(currentX - startX);
      const deltaY = Math.abs(currentY - startY);
      const didActuallyDrag = deltaX > 2 || deltaY > 2; // 2px threshold for accidental movement

      if (didActuallyDrag) {
        // Set flag to prevent click handlers from firing immediately after drag
        wasDraggingRef.current = true;

        // Clear the wasDragging flag after a short delay
        setTimeout(() => {
          wasDraggingRef.current = false;
        }, 10);

        // Notify that selection is finalized (only if we actually dragged)
        if (onSpectralSelectionFinalized && currentSpectralSelection) {
          onSpectralSelectionFinalized(currentSpectralSelection);
        }
      } else {
        // Was just a click (not a drag)
        // If we were creating a new selection, clear the spectral selection
        if (mode === 'create') {
          onSpectralSelectionChange(null);
        }
        // If we were resizing, keep the selection as is (it's already been updated)
      }

      dragStateRef.current = null;
      setIsDragging(false);
    }
  }, [currentSpectralSelection, onSpectralSelectionFinalized, onSpectralSelectionChange]);

  // Add global mouse up listener to end drag
  useEffect(() => {
    const handleMouseUp = () => {
      endDrag();
    };

    if (isDragging) {
      window.addEventListener('mouseup', handleMouseUp);
      return () => window.removeEventListener('mouseup', handleMouseUp);
    }
  }, [isDragging, endDrag]);

  return {
    startDrag,
    handleMouseMove,
    updateCursor,
    endDrag,
    isDragging,
    cursorStyle,
    isPositionOnSpectralClip,
    wasJustDragging: () => wasDraggingRef.current,
    isCreating: isDragging && dragStateRef.current?.mode === 'create',
  };
}
