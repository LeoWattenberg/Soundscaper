/**
 * useClipSelection Hook
 *
 * Handles clip selection logic - ensures clips are only selected when clicking on their header.
 * Works in conjunction with time selection to prevent unwanted clip selection after dragging.
 */

import { useCallback } from 'react';

export interface UseClipSelectionOptions {
  /** Function to check if we just finished dragging (to prevent click) */
  wasJustDragging: () => boolean;
  /** Callback when a clip is selected */
  onClipSelect?: (trackIndex: number, clipId: string | number) => void;
}

export interface UseClipSelectionReturn {
  /** Handler for clip clicks - returns true if click was handled */
  handleClipClick: (trackIndex: number, clipId: string | number) => boolean;
}

/**
 * Hook for handling clip selection with drag prevention
 */
export function useClipSelection({
  wasJustDragging,
  onClipSelect,
}: UseClipSelectionOptions): UseClipSelectionReturn {

  const handleClipClick = useCallback((trackIndex: number, clipId: string | number): boolean => {
    // Prevent clip selection if we just finished dragging/resizing a time selection
    if (wasJustDragging()) {
      return false;
    }

    onClipSelect?.(trackIndex, clipId);
    return true;
  }, [wasJustDragging, onClipSelect]);

  return {
    handleClipClick,
  };
}
