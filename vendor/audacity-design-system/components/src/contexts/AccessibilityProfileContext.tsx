/**
 * AccessibilityProfileContext
 *
 * Provides accessibility profile configuration throughout the application
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AccessibilityProfile, ACCESSIBILITY_PROFILES, getProfileById } from '@audacity-ui/core';

interface AccessibilityProfileContextValue {
  /**
   * Currently active profile
   */
  activeProfile: AccessibilityProfile;

  /**
   * All available profiles
   */
  profiles: AccessibilityProfile[];

  /**
   * Change the active profile
   */
  setProfile: (profileId: string) => void;
}

const AccessibilityProfileContext = createContext<AccessibilityProfileContextValue | undefined>(
  undefined
);

interface AccessibilityProfileProviderProps {
  /**
   * Initial profile ID (defaults to 'au4')
   */
  initialProfileId?: string;

  /**
   * Child components
   */
  children: ReactNode;
}

/**
 * Provider for accessibility profile configuration
 */
export function AccessibilityProfileProvider({
  initialProfileId = 'au4',
  children,
}: AccessibilityProfileProviderProps) {
  const [activeProfileId, setActiveProfileId] = useState(() => {
    // Try to read from localStorage first
    try {
      const stored = localStorage.getItem('audacity-accessibility-profile');
      if (stored) {
        return stored;
      }
    } catch (e) {
      // Ignore localStorage errors
    }
    return initialProfileId;
  });

  const activeProfile = getProfileById(activeProfileId);

  const setProfile = useCallback((profileId: string) => {
    setActiveProfileId(profileId);

    // Optionally persist to localStorage
    try {
      localStorage.setItem('audacity-accessibility-profile', profileId);
    } catch (e) {
      // Ignore localStorage errors
    }
  }, []);

  return (
    <AccessibilityProfileContext.Provider
      value={{
        activeProfile,
        profiles: ACCESSIBILITY_PROFILES,
        setProfile,
      }}
    >
      {children}
    </AccessibilityProfileContext.Provider>
  );
}

// Default profile used when no <AccessibilityProfileProvider> ancestor is
// present. We resolve the bundled 'au4' profile lazily so consumers that
// never wrap their tree still get a sensible (no-overrides) baseline.
const DEFAULT_PROFILE_ID = 'au4';
const DEFAULT_PROFILE_VALUE: AccessibilityProfileContextValue = {
  activeProfile: getProfileById(DEFAULT_PROFILE_ID),
  profiles: ACCESSIBILITY_PROFILES,
  // No-op setter — without a provider there's nowhere to persist a change.
  setProfile: () => {},
};

/**
 * Hook to access accessibility profile context.
 *
 * If no <AccessibilityProfileProvider> ancestor is present (e.g. when this
 * component library is consumed by a static marketing site), the hook
 * returns the default `au4` profile with a no-op setter so individual
 * components still render.
 */
export function useAccessibilityProfile(): AccessibilityProfileContextValue {
  const context = useContext(AccessibilityProfileContext);
  return context ?? DEFAULT_PROFILE_VALUE;
}
