/**
 * TabOrderContext
 *
 * Manages global tab order across the entire application based on accessibility profile.
 * This hijacks the browser's default tab order to ensure consistent behavior across profiles.
 */

import React, { createContext, useContext, useRef, useCallback, ReactNode } from 'react';
import { useAccessibilityProfile } from './AccessibilityProfileContext';

interface TabOrderContextValue {
  /**
   * Register an element in the global tab order
   * Returns the tabIndex value for this element
   */
  registerElement: (groupId: string, itemIndex: number, totalItems: number) => number;
}

const TabOrderContext = createContext<TabOrderContextValue | undefined>(undefined);

interface TabOrderProviderProps {
  children: ReactNode;
}

/**
 * Provider that manages global tab order based on accessibility profile
 */
export function TabOrderProvider({ children }: TabOrderProviderProps) {
  const { activeProfile } = useAccessibilityProfile();

  // Counter for sequential tab indices in flat mode
  const sequentialCounterRef = useRef(1);

  const registerElement = useCallback(
    (groupId: string, itemIndex: number, totalItems: number): number => {
      const groupConfig = activeProfile.config.tabGroups[groupId];

      if (!groupConfig) {
        // No config found - default to tabIndex 0
        return 0;
      }

      if (groupConfig.tabindex === 'sequential') {
        // Flat navigation: every element gets a sequential tabIndex
        // For now, we'll use 0 for all (browser default sequential)
        // But we could assign 1, 2, 3, etc. for strict control
        return 0;
      } else {
        // Roving tabindex: only first element in group gets 0, others get -1
        return itemIndex === 0 ? 0 : -1;
      }
    },
    [activeProfile]
  );

  return (
    <TabOrderContext.Provider value={{ registerElement }}>
      {children}
    </TabOrderContext.Provider>
  );
}

/**
 * Hook to access tab order context
 */
export function useTabOrder(): TabOrderContextValue {
  const context = useContext(TabOrderContext);

  if (!context) {
    throw new Error('useTabOrder must be used within TabOrderProvider');
  }

  return context;
}
