/**
 * PreferencesContext
 *
 * Manages all user preferences with localStorage persistence
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';

export interface PreferencesState {
  // General
  showWelcomeDialog: boolean;
  checkForUpdates: boolean;
  operatingSystem: 'windows' | 'macos';

  // Appearance
  theme: 'light' | 'dark';
  clipStyle: 'classic' | 'colourful';

  // Audio Settings
  audioHost: string;
  recordingDevice: string;
  playbackDevice: string;
  recordingChannels: string;
  bufferLength: string;
  latencyCompensation: string;
  defaultSampleRate: string;
  defaultSampleFormat: string;

  // Playback/Recording
  vblankMode: string;
  soloMode: 'multiple' | 'single';
  shortSkip: string;
  longSkip: string;
  rollInTime: string;
  showMicMetering: boolean;
  enableInputMonitoring: boolean;

  // Plugins
  groupEffectsInMenus: boolean;
  vst3PluginLocation: string;
  vstPluginLocation: string;
  lv2PluginLocation: string;
  ladspaPluginLocation: string;
  audioUnitsPluginLocation: string;

  // Cloud
  cloudMixdownMode: 'never' | 'always' | 'every';
  cloudMixdownInterval: string;
  showSaveDialog: boolean;
  cloudTempLocation: string;
  cloudTempRetentionDays: string;

  // Debug
  /** How track focus interacts with track selection.
   *  - 'classic': focus and selection are independent (today's behaviour).
   *  - 'follows-focus': moving focus replaces the selection with the focused
   *    track; explicit modifiers (Shift, Option/Alt) are required to extend
   *    or toggle a non-contiguous selection. */
  trackSelectionMode: 'classic' | 'follows-focus';

  // Spectral Display
  enableSpectralSelection: boolean;
  spectralScale: string;
  spectralGain: string;
  spectralRange: string;
  spectralHighBoost: string;
  spectralScheme: string;
  spectralAlgorithm: string;
  spectralWindowSize: string;
  spectralWindowType: string;
  spectralZeroPadding: string;
}

const defaultPreferences: PreferencesState = {
  // General
  showWelcomeDialog: true,
  checkForUpdates: true,
  operatingSystem: 'windows',

  // Appearance
  theme: 'light',
  clipStyle: 'colourful',

  // Audio Settings
  audioHost: 'core-audio',
  recordingDevice: 'default',
  playbackDevice: 'default',
  recordingChannels: '2-stereo',
  bufferLength: '100',
  latencyCompensation: '-130',
  defaultSampleRate: '44100',
  defaultSampleFormat: '32-bit-float',

  // Playback/Recording
  vblankMode: 'none',
  soloMode: 'multiple',
  shortSkip: '5 seconds',
  longSkip: '15 seconds',
  rollInTime: '3 seconds',
  showMicMetering: true,
  enableInputMonitoring: false,

  // Plugins
  groupEffectsInMenus: true,
  vst3PluginLocation: '/Users/Username/Library/Application Support/audacity',
  vstPluginLocation: '/Users/Username/Library/Application Support/audacity',
  lv2PluginLocation: '/Users/Username/Library/Application Support/audacity',
  ladspaPluginLocation: '/Users/Username/Library/Application Support/audacity',
  audioUnitsPluginLocation: '/Users/Username/Library/Application Support/audacity',

  // Cloud
  cloudMixdownMode: 'never',
  cloudMixdownInterval: '5 saves',
  showSaveDialog: true,
  cloudTempLocation: '/Users/Username/Library/Application Support/audacity/cloud-temp',
  cloudTempRetentionDays: '30',

  // Debug
  trackSelectionMode: 'classic',

  // Spectral Display
  enableSpectralSelection: true,
  spectralScale: 'mel',
  spectralGain: '20 dB',
  spectralRange: '80 dB',
  spectralHighBoost: '20 dB/dec',
  spectralScheme: 'inverse-grayscale',
  spectralAlgorithm: 'frequencies',
  spectralWindowSize: '32768',
  spectralWindowType: 'blackman-harris',
  spectralZeroPadding: '2',
};

interface PreferencesContextValue {
  preferences: PreferencesState;
  updatePreference: <K extends keyof PreferencesState>(
    key: K,
    value: PreferencesState[K]
  ) => void;
  resetPreferences: () => void;
}

const PreferencesContext = /* @__PURE__ */ createContext<PreferencesContextValue | undefined>(undefined);

export interface GeneralPrefsValue {
  operatingSystem: PreferencesState['operatingSystem'];
  showWelcomeDialog: boolean;
  checkForUpdates: boolean;
  updatePreference: PreferencesContextValue['updatePreference'];
}

const GeneralPrefsContext = /* @__PURE__ */ createContext<GeneralPrefsValue | undefined>(undefined);

export interface AppearancePrefsValue {
  theme: PreferencesState['theme'];
  clipStyle: PreferencesState['clipStyle'];
  updatePreference: PreferencesContextValue['updatePreference'];
}

const AppearancePrefsContext = /* @__PURE__ */ createContext<AppearancePrefsValue | undefined>(undefined);

export interface EditingBehaviorPrefsValue {
  trackSelectionMode: PreferencesState['trackSelectionMode'];
  updatePreference: PreferencesContextValue['updatePreference'];
}

const EditingBehaviorPrefsContext = /* @__PURE__ */ createContext<EditingBehaviorPrefsValue | undefined>(undefined);

interface PreferencesProviderProps {
  children: ReactNode;
}

const STORAGE_KEY = 'audacity-preferences';

export function PreferencesProvider({ children }: PreferencesProviderProps) {
  const [preferences, setPreferences] = useState<PreferencesState>(() => {
    // Try to load from localStorage
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...defaultPreferences, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.error('Failed to load preferences from localStorage:', e);
    }
    return defaultPreferences;
  });

  // Persist to localStorage whenever preferences change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch (e) {
      console.error('Failed to save preferences to localStorage:', e);
    }
  }, [preferences]);

  const updatePreference = useCallback(
    <K extends keyof PreferencesState>(key: K, value: PreferencesState[K]) => {
      setPreferences((prev) => ({
        ...prev,
        [key]: value,
      }));
    },
    []
  );

  const resetPreferences = () => {
    setPreferences(defaultPreferences);
  };

  const generalValue = useMemo<GeneralPrefsValue>(
    () => ({
      operatingSystem: preferences.operatingSystem,
      showWelcomeDialog: preferences.showWelcomeDialog,
      checkForUpdates: preferences.checkForUpdates,
      updatePreference,
    }),
    [preferences.operatingSystem, preferences.showWelcomeDialog, preferences.checkForUpdates, updatePreference]
  );

  const appearanceValue = useMemo<AppearancePrefsValue>(
    () => ({
      theme: preferences.theme,
      clipStyle: preferences.clipStyle,
      updatePreference,
    }),
    [preferences.theme, preferences.clipStyle, updatePreference]
  );

  const editingBehaviorValue = useMemo<EditingBehaviorPrefsValue>(
    () => ({
      trackSelectionMode: preferences.trackSelectionMode,
      updatePreference,
    }),
    [preferences.trackSelectionMode, updatePreference]
  );

  return (
    <PreferencesContext.Provider
      value={{
        preferences,
        updatePreference,
        resetPreferences,
      }}
    >
      <GeneralPrefsContext.Provider value={generalValue}>
        <AppearancePrefsContext.Provider value={appearanceValue}>
          <EditingBehaviorPrefsContext.Provider value={editingBehaviorValue}>
            {children}
          </EditingBehaviorPrefsContext.Provider>
        </AppearancePrefsContext.Provider>
      </GeneralPrefsContext.Provider>
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);

  if (!context) {
    throw new Error('usePreferences must be used within PreferencesProvider');
  }

  return context;
}

export function useGeneralPrefs(): GeneralPrefsValue {
  const context = useContext(GeneralPrefsContext);

  if (!context) {
    throw new Error('useGeneralPrefs must be used within PreferencesProvider');
  }

  return context;
}

export function useAppearancePrefs(): AppearancePrefsValue {
  const context = useContext(AppearancePrefsContext);

  if (!context) {
    throw new Error('useAppearancePrefs must be used within PreferencesProvider');
  }

  return context;
}

export function useEditingBehaviorPrefs(): EditingBehaviorPrefsValue {
  const context = useContext(EditingBehaviorPrefsContext);

  if (!context) {
    throw new Error('useEditingBehaviorPrefs must be used within PreferencesProvider');
  }

  return context;
}
