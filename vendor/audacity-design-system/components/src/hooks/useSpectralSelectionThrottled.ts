/**
 * Throttled wrapper for spectral selection state updates
 *
 * This hook wraps the spectral selection callbacks to throttle state updates during drag,
 * significantly improving performance by reducing re-renders.
 */

import { useRef, useCallback } from 'react';
import { SpectralSelection } from '@audacity-ui/core';

export type { SpectralSelection };

export interface UseSpectralSelectionThrottledConfig {
  /** The actual callback to update spectral selection state */
  onSpectralSelectionChange: (selection: SpectralSelection | null) => void;
  /** Throttle interval in milliseconds (default: 50ms = 20fps) */
  throttleMs?: number;
}

/**
 * Hook that provides a throttled version of onSpectralSelectionChange
 * to dramatically reduce re-renders during spectral selection dragging
 */
export function useSpectralSelectionThrottled(config: UseSpectralSelectionThrottledConfig) {
  const { onSpectralSelectionChange, throttleMs = 50 } = config;

  const lastUpdateTimeRef = useRef<number>(0);
  const pendingSelectionRef = useRef<SpectralSelection | null>(null);
  const timeoutIdRef = useRef<number | null>(null);

  const throttledOnSpectralSelectionChange = useCallback((selection: SpectralSelection | null) => {
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateTimeRef.current;

    // Store the latest selection
    pendingSelectionRef.current = selection;

    // If enough time has passed, update immediately
    if (timeSinceLastUpdate >= throttleMs) {
      lastUpdateTimeRef.current = now;
      onSpectralSelectionChange(selection);
      pendingSelectionRef.current = null;

      // Clear any pending timeout
      if (timeoutIdRef.current !== null) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
    } else {
      // Otherwise, schedule an update for later (if not already scheduled)
      if (timeoutIdRef.current === null) {
        timeoutIdRef.current = window.setTimeout(() => {
          lastUpdateTimeRef.current = Date.now();
          onSpectralSelectionChange(pendingSelectionRef.current);
          pendingSelectionRef.current = null;
          timeoutIdRef.current = null;
        }, throttleMs - timeSinceLastUpdate);
      }
    }
  }, [onSpectralSelectionChange, throttleMs]);

  // Force immediate update (for mouse up)
  const flushPending = useCallback(() => {
    if (timeoutIdRef.current !== null) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
    if (pendingSelectionRef.current !== null) {
      onSpectralSelectionChange(pendingSelectionRef.current);
      pendingSelectionRef.current = null;
      lastUpdateTimeRef.current = Date.now();
    }
  }, [onSpectralSelectionChange]);

  return {
    throttledOnSpectralSelectionChange,
    flushPending,
  };
}
