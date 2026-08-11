/**
 * PreferencesContext
 *
 * Manages all user preferences with localStorage persistence
 */

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

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

const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);

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

  const updatePreference = <K extends keyof PreferencesState>(
    key: K,
    value: PreferencesState[K]
  ) => {
    setPreferences((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const resetPreferences = () => {
    setPreferences(defaultPreferences);
  };

  return (
    <PreferencesContext.Provider
      value={{
        preferences,
        updatePreference,
        resetPreferences,
      }}
    >
      {children}
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
