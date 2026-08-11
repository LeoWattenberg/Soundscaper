/**
 * useLabelKeyboardHandling
 *
 * Custom hook for handling keyboard shortcuts on label markers
 * Respects accessibility profile keyboard shortcut configuration
 */

import { useCallback } from 'react';
import { useAccessibilityProfile } from '../contexts/AccessibilityProfileContext';

export interface Label {
  id: number;
  time: number;
  endTime?: number;
  text: string;
}

export interface UseLabelKeyboardHandlingProps {
  /**
   * The label being handled
   */
  label: Label;

  /**
   * Index of this label in the track
   */
  labelIndex: number;

  /**
   * Total number of labels in the track
   */
  totalLabels: number;

  /**
   * Tab index for the track (for managing focus)
   */
  trackTabIndex: number;

  /**
   * Callback to update label properties
   */
  onLabelUpdate: (updates: Partial<Label>) => void;

  /**
   * Callback to focus next/previous label
   */
  onLabelFocus?: (direction: 'next' | 'previous') => void;
}

/**
 * Hook that returns a keyboard event handler for label markers
 */
export function useLabelKeyboardHandling({
  label,
  labelIndex,
  totalLabels,
  trackTabIndex,
  onLabelUpdate,
  onLabelFocus,
}: UseLabelKeyboardHandlingProps) {
  const { activeProfile } = useAccessibilityProfile();

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Move label with Cmd+Arrow keys
      if ((e.metaKey || e.ctrlKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey) {
        if (!activeProfile.config.keyboardShortcuts?.labels?.cmdArrowMove) return;
        e.preventDefault();

        const moveAmount = 0.1; // Move by 0.1 seconds
        const delta = e.key === 'ArrowRight' ? moveAmount : -moveAmount;
        const newTime = Math.max(0, label.time + delta);

        if (label.endTime !== undefined) {
          // Region label: maintain duration while moving
          const duration = label.endTime - label.time;
          onLabelUpdate({ time: newTime, endTime: newTime + duration });
        } else {
          // Point label: just update time
          onLabelUpdate({ time: newTime });
        }
        return;
      }

      // Trim label with Shift+Arrow keys
      // shift + left = move left edge left (EXTEND)
      // shift + right = move right edge right (EXTEND)
      // cmd + shift + left = move right edge left (REDUCE)
      // cmd + shift + right = move left edge right (REDUCE)
      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const isReducing = e.metaKey || e.ctrlKey;
        const shortcutEnabled = isReducing
          ? activeProfile.config.keyboardShortcuts?.labels?.cmdShiftArrowReduce
          : activeProfile.config.keyboardShortcuts?.labels?.shiftArrowExtend;
        if (!shortcutEnabled) return;

        e.preventDefault();
        const trimAmount = 0.1; // Trim by 0.1 seconds

        if (label.endTime !== undefined) {
          // Region label only
          if (e.key === 'ArrowLeft') {
            if (isReducing) {
              // Cmd+Shift+Left: move right edge left (REDUCE)
              const newEndTime = Math.max(label.time + 0.1, label.endTime - trimAmount);
              onLabelUpdate({ endTime: newEndTime });
            } else {
              // Shift+Left: move left edge left (EXTEND)
              const newTime = Math.max(0, label.time - trimAmount);
              onLabelUpdate({ time: newTime });
            }
          } else {
            // ArrowRight
            if (isReducing) {
              // Cmd+Shift+Right: move left edge right (REDUCE)
              const newTime = Math.min(label.endTime - 0.1, label.time + trimAmount);
              onLabelUpdate({ time: newTime });
            } else {
              // Shift+Right: move right edge right (EXTEND)
              const newEndTime = label.endTime + trimAmount;
              onLabelUpdate({ endTime: newEndTime });
            }
          }
        }
        return;
      }

      // Note: Arrow key navigation between labels is handled in Canvas.tsx
      // because it requires DOM manipulation for focus management
    },
    [label, labelIndex, totalLabels, trackTabIndex, onLabelUpdate, activeProfile]
  );

  return handleKeyDown;
}
