/**
 * useTrackSelection Hook
 *
 * Handles track selection logic - when to select a track vs when to ignore clicks.
 * Works in conjunction with time selection to prevent unwanted track selection after dragging.
 */

import { useCallback } from 'react';

export interface UseTrackSelectionOptions {
  /** Function to check if we just finished dragging (to prevent click) */
  wasJustDragging: () => boolean;
  /** Callback when a track is selected */
  onTrackSelect?: (trackIndex: number) => void;
}

export interface UseTrackSelectionReturn {
  /** Handler for track clicks - returns true if click was handled */
  handleTrackClick: (trackIndex: number) => boolean;
}

/**
 * Hook for handling track selection with drag prevention
 */
export function useTrackSelection({
  wasJustDragging,
  onTrackSelect,
}: UseTrackSelectionOptions): UseTrackSelectionReturn {

  const handleTrackClick = useCallback((trackIndex: number): boolean => {
    // Prevent track selection if we just finished dragging/resizing a time selection
    if (wasJustDragging()) {
      return false;
    }

    onTrackSelect?.(trackIndex);
    return true;
  }, [wasJustDragging, onTrackSelect]);

  return {
    handleTrackClick,
  };
}
