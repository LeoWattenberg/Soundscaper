/**
 * useTimeSelection Hook
 *
 * Provides time selection dragging functionality for audio track editors.
 * Handles mouse events to create time selections by clicking and dragging across the canvas.
 * Supports resizing selection by dragging edges.
 */

import { useEffect, useRef, useState, useCallback, RefObject } from 'react';
import {
  TimeSelection,
  TimeSelectionDragState,
  TimeSelectionConfig,
  pixelsToTime,
  timeToPixels,
  yToTrackIndex,
  clampTrackIndex,
  getTrackRange
} from '@audacity-ui/core';
import { CLIP_CONTENT_OFFSET } from '../constants';

type DragMode = 'create' | 'resize-start' | 'resize-end' | null;

interface ExtendedDragState extends TimeSelectionDragState {
  mode: DragMode;
  initialSelection?: TimeSelection | null;
  initialSelectedTracks?: number[];
  startedInsideClip?: boolean; // Track whether drag started inside a clip
  fixedTimeBounds?: { startTime: number; endTime: number }; // Fixed time bounds from spectral conversion
}

export interface UseTimeSelectionOptions extends TimeSelectionConfig {
  /** Ref to the container element that receives mouse events */
  containerRef: RefObject<HTMLElement>;
  /** Current time selection (for edge detection) */
  currentTimeSelection: TimeSelection | null;
  /** Currently selected track indices (for preserving during resize) */
  currentSelectedTracks: number[];
  /** Callback when time selection changes */
  onTimeSelectionChange: (selection: TimeSelection | null) => void;
  /** Callback when time selection is finalized (on mouse up) */
  onTimeSelectionFinalized?: (selection: TimeSelection | null) => void;
  /** Callback when selected track indices change */
  onSelectedTracksChange: (trackIndices: number[]) => void;
  /** Callback when focused track changes */
  onFocusedTrackChange: (trackIndex: number | null) => void;
  /** Callback to clear spectral selection when time selection starts */
  onClearSpectralSelection?: () => void;
  /** Callback to convert time selection to spectral selection when dragged inside clip bounds - returns true if conversion happened */
  onConvertToSpectralSelection?: (startTime: number, endTime: number, trackIndex: number, clipId: number, currentX: number, currentY: number) => boolean;
  /** Whether time selection is enabled */
  enabled?: boolean;
  /** Edge detection threshold in pixels */
  edgeThreshold?: number;
  /** Clip header height (for detecting clip body) */
  clipHeaderHeight?: number;
  /** Whether in spectrogram mode */
  spectrogramMode?: boolean;
}

export interface UseTimeSelectionReturn {
  /** Whether a time selection drag is in progress */
  isDragging: boolean;
  /** Cursor style to apply to the container */
  cursorStyle: string;
  /** Function to start a time selection drag - call from container's onMouseDown */
  startDrag: (x: number, y: number, allowConversionToSpectral?: boolean, fixedTimeBounds?: { startTime: number; endTime: number }) => void;
  /** Function to handle mouse move for cursor updates - call from container's onMouseMove */
  handleMouseMove: (x: number, y: number) => void;
  /** Function to check if we just finished dragging (to prevent click events) */
  wasJustDragging: () => boolean;
}

/**
 * Hook for handling time selection dragging and resizing
 */
export function useTimeSelection({
  containerRef,
  currentTimeSelection,
  currentSelectedTracks,
  pixelsPerSecond,
  leftPadding,
  tracks,
  defaultTrackHeight,
  trackGap,
  initialGap,
  onTimeSelectionChange,
  onTimeSelectionFinalized,
  onSelectedTracksChange,
  onFocusedTrackChange,
  onClearSpectralSelection,
  onConvertToSpectralSelection,
  enabled = true,
  edgeThreshold = 6,
  clipHeaderHeight = 20,
  spectrogramMode = false,
}: UseTimeSelectionOptions): UseTimeSelectionReturn {
  const dragStateRef = useRef<ExtendedDragState | null>(null);
  const wasDraggingRef = useRef<boolean>(false);
  const [cursorStyle, setCursorStyle] = useState<string>('default');

  /**
   * Check if mouse is near an edge of the time selection
   */
  const getEdgeProximity = useCallback((x: number): 'start' | 'end' | null => {
    if (!currentTimeSelection) return null;

    const startX = timeToPixels(currentTimeSelection.startTime, pixelsPerSecond, 0);
    const endX = timeToPixels(currentTimeSelection.endTime, pixelsPerSecond, 0);

    if (Math.abs(x - startX) <= edgeThreshold) {
      return 'start';
    }
    if (Math.abs(x - endX) <= edgeThreshold) {
      return 'end';
    }
    return null;
  }, [currentTimeSelection, pixelsPerSecond, leftPadding, edgeThreshold]);

  /**
   * Find which clip (if any) contains the given position
   * Includes both clip header and clip body for conversion detection
   */
  const findClipAtPosition = useCallback((x: number, y: number): { trackIndex: number; clipId: number } | null => {
    let currentY = initialGap;

    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
      const track = tracks[trackIndex] as any;
      const trackHeight = track.height || defaultTrackHeight;

      // Check if y is within this track (including both header and body)
      if (y >= currentY && y < currentY + trackHeight) {
        // Check each clip in this track
        if (track.clips) {
          for (const clip of track.clips) {
            const clipStartX = CLIP_CONTENT_OFFSET + clip.start * pixelsPerSecond;
            const clipEndX = clipStartX + clip.duration * pixelsPerSecond;

            // Use > for left boundary (not >=) to require being INSIDE the clip, not just at the edge
            if (x > clipStartX && x <= clipEndX) {
              return { trackIndex, clipId: clip.id };
            }
          }
        }
      }

      currentY += trackHeight + trackGap;
    }

    return null;
  }, [tracks, pixelsPerSecond, leftPadding, defaultTrackHeight, trackGap, initialGap, clipHeaderHeight]);

  /**
   * Handle mouse move for cursor updates and dragging
   */
  const handleMouseMove = useCallback((x: number, y: number) => {
    if (!enabled) return;

    // If dragging, don't update cursor
    if (dragStateRef.current) return;

    // Check edge proximity for cursor style
    const edge = getEdgeProximity(x);
    if (edge) {
      setCursorStyle('ew-resize');
    } else {
      setCursorStyle('default');
    }
  }, [enabled, getEdgeProximity]);

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const container = containerRef.current;

    // Handle mouse move during drag
    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!dragStateRef.current || !container) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const { mode, initialSelection, initialSelectedTracks } = dragStateRef.current;

      if (mode === 'resize-start' && initialSelection) {
        // Resizing start edge - allow inverting by dragging past end edge
        const newStartTime = Math.max(0, pixelsToTime(x, pixelsPerSecond, CLIP_CONTENT_OFFSET));

        // If dragged past the end, swap start and end
        if (newStartTime > initialSelection.endTime) {
          onTimeSelectionChange({
            startTime: initialSelection.endTime,
            endTime: newStartTime,
          });
        } else {
          onTimeSelectionChange({
            startTime: newStartTime,
            endTime: initialSelection.endTime,
          });
        }
      } else if (mode === 'resize-end' && initialSelection) {
        // Resizing end edge - allow inverting by dragging past start edge
        const newEndTime = Math.max(0, pixelsToTime(x, pixelsPerSecond, CLIP_CONTENT_OFFSET));

        // If dragged past the start, swap start and end
        if (newEndTime < initialSelection.startTime) {
          onTimeSelectionChange({
            startTime: newEndTime,
            endTime: initialSelection.startTime,
          });
        } else {
          onTimeSelectionChange({
            startTime: initialSelection.startTime,
            endTime: newEndTime,
          });
        }
      } else if (mode === 'create') {
        dragStateRef.current.currentX = x;

        // Only create time selection if drag distance exceeds threshold (prevents accidental selection on click)
        const dragDistance = Math.abs(x - dragStateRef.current.startX);
        if (dragDistance <= 5) {
          // Not enough movement yet - don't create selection
          return;
        }

        // Use fixed time bounds if they exist (from spectral conversion), otherwise calculate from mouse position
        let startTime: number;
        let endTime: number;

        if (dragStateRef.current.fixedTimeBounds) {
          // Use fixed time bounds from spectral conversion - these don't change during drag
          startTime = dragStateRef.current.fixedTimeBounds.startTime;
          endTime = dragStateRef.current.fixedTimeBounds.endTime;
        } else {
          // Normal behavior - calculate from mouse positions
          startTime = pixelsToTime(dragStateRef.current.startX, pixelsPerSecond, CLIP_CONTENT_OFFSET);
          endTime = pixelsToTime(x, pixelsPerSecond, CLIP_CONTENT_OFFSET);
        }

        // Update selected tracks based on drag range
        const currentTrackIndex = yToTrackIndex(y, tracks, initialGap, trackGap, defaultTrackHeight);
        const startTrackIndex = dragStateRef.current.startTrackIndex;

        // Clamp indices to valid track range
        const clampedStartTrack = clampTrackIndex(startTrackIndex, tracks);
        const clampedCurrentTrack = clampTrackIndex(currentTrackIndex, tracks);

        // Get all tracks in the range
        const selectedIndices = getTrackRange(clampedStartTrack, clampedCurrentTrack);

        // If the drag started inside a clip (i.e., converted from spectral selection),
        // check if we should convert back to spectral when entering a spectral clip
        if (dragStateRef.current.startedInsideClip && spectrogramMode && onConvertToSpectralSelection) {
          const clipAtPosition = findClipAtPosition(x, y);

          if (clipAtPosition) {
            const { trackIndex, clipId } = clipAtPosition;

            // Check if this track has spectral view enabled
            const track = tracks[trackIndex] as any;
            const hasSpectralView = track.viewMode === 'spectrogram' || track.viewMode === 'split';

            if (hasSpectralView) {
              // Convert back to spectral selection using the fixed time bounds
              const converted = onConvertToSpectralSelection(startTime, endTime, trackIndex, clipId, x, y);
              if (converted) {
                // Clear the time selection and drag state
                onTimeSelectionChange(null);
                dragStateRef.current = null;
                return;
              }
            }
          }
        }

        // Normal time selection behavior
        onTimeSelectionChange({
          startTime: Math.min(startTime, endTime),
          endTime: Math.max(startTime, endTime),
        });
        onSelectedTracksChange(selectedIndices);
      }
    };

    // Handle mouse up - end drag
    const handleDocumentMouseUp = (e: MouseEvent) => {
      if (!dragStateRef.current || !container) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const { mode, startX } = dragStateRef.current;

      // Only set wasDragging flag if we actually moved the mouse (not just a click)
      const didActuallyDrag = Math.abs(x - startX) > 5; // 5px threshold for accidental movement

      if (didActuallyDrag) {
        // Set flag to prevent click handlers from firing immediately after drag
        wasDraggingRef.current = true;

        // Clear the flag after a short delay (longer than click event propagation)
        setTimeout(() => {
          wasDraggingRef.current = false;
        }, 50);

        // Only set focused track if we actually dragged (creating or resizing selection)
        // Determine focused track based on where mouse was released
        const releasedTrackIndex = yToTrackIndex(y, tracks, initialGap, trackGap, defaultTrackHeight);

        // If released beyond last track, focus the last track
        if (releasedTrackIndex >= tracks.length) {
          onFocusedTrackChange(tracks.length - 1);
        } else if (releasedTrackIndex >= 0 && releasedTrackIndex < tracks.length) {
          onFocusedTrackChange(releasedTrackIndex);
        }
      }

      // Call finalized callback with current selection before clearing drag state
      if (onTimeSelectionFinalized && currentTimeSelection) {
        onTimeSelectionFinalized(currentTimeSelection);
      }

      // Clear drag state
      dragStateRef.current = null;

      // Update cursor based on mouse position (x and y already calculated above)
      handleMouseMove(x, y);
    };

    // Add document-level event listeners for dragging beyond container bounds
    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    enabled,
    containerRef,
    currentTimeSelection,
    currentSelectedTracks,
    pixelsPerSecond,
    leftPadding,
    tracks,
    defaultTrackHeight,
    trackGap,
    initialGap,
    onTimeSelectionChange,
    onTimeSelectionFinalized,
    onSelectedTracksChange,
    onFocusedTrackChange,
    handleMouseMove,
    spectrogramMode,
    onConvertToSpectralSelection,
    findClipAtPosition,
  ]);

  /**
   * Start a time selection drag or edge resize
   * Call this from the container's onMouseDown handler
   */
  const startDrag = (x: number, y: number, allowConversionToSpectral?: boolean, fixedTimeBounds?: { startTime: number; endTime: number }) => {
    if (!enabled) return;

    // Check if clicking on an edge
    const edge = getEdgeProximity(x);

    if (edge === 'start') {
      // Start resizing from start edge - preserve selected tracks
      dragStateRef.current = {
        startX: x,
        currentX: x,
        startTrackIndex: 0,
        mode: 'resize-start',
        initialSelection: currentTimeSelection,
        initialSelectedTracks: currentSelectedTracks,
      };
      setCursorStyle('ew-resize');
    } else if (edge === 'end') {
      // Start resizing from end edge - preserve selected tracks
      dragStateRef.current = {
        startX: x,
        currentX: x,
        startTrackIndex: 0,
        mode: 'resize-end',
        initialSelection: currentTimeSelection,
        initialSelectedTracks: currentSelectedTracks,
      };
      setCursorStyle('ew-resize');
    } else {
      // Start creating new selection
      const trackIndex = yToTrackIndex(y, tracks, initialGap, trackGap, defaultTrackHeight);

      // Set focus where we start dragging
      // Don't change selection here - let the click handler handle it (to support Shift+Click)
      if (trackIndex >= 0 && trackIndex < tracks.length) {
        onFocusedTrackChange(trackIndex);
        // onSelectedTracksChange([trackIndex]); // REMOVED: Let click handler manage selection
      }

      // Check if starting inside a spectral-enabled clip (or explicitly allowed via parameter)
      // Only allow conversion to spectral if we started in a spectral clip or if explicitly converting from spectral
      let startedInsideClip = false;
      if (allowConversionToSpectral !== undefined) {
        // Explicit conversion from spectral selection
        startedInsideClip = allowConversionToSpectral;
      } else {
        // Check if we started inside a spectral-enabled clip
        const clipAtStart = findClipAtPosition(x, y);
        if (clipAtStart && spectrogramMode) {
          const track = tracks[clipAtStart.trackIndex] as any;
          const hasSpectralView = track.viewMode === 'spectrogram' || track.viewMode === 'split';
          startedInsideClip = hasSpectralView;
        }
      }

      dragStateRef.current = {
        startX: x,
        currentX: x,
        startTrackIndex: trackIndex,
        mode: 'create',
        startedInsideClip,
        fixedTimeBounds, // Store the fixed time bounds from spectral conversion
      };

      // Clear any existing time selection UNLESS we're converting from spectral
      // (indicated by allowConversionToSpectral being true and a selection existing)
      // This allows the user to drag the time selection back into the clip
      if (!(allowConversionToSpectral && currentTimeSelection)) {
        onTimeSelectionChange(null);
      }

      // Clear any existing spectral selection
      if (onClearSpectralSelection) {
        onClearSpectralSelection();
      }

      setCursorStyle('text');
    }
  };

  return {
    isDragging: dragStateRef.current !== null,
    cursorStyle,
    startDrag,
    handleMouseMove,
    wasJustDragging: () => wasDraggingRef.current,
  };
}
