import type React from 'react';

export type PreferencesPage =
  | 'general'
  | 'accounts'
  | 'appearance'
  | 'audio-settings'
  | 'playback-recording'
  | 'spectral-display'
  | 'editing'
  | 'plugins'
  | 'music'
  | 'cloud'
  | 'advanced-options'
  | 'shortcuts';

export interface PreferencesModalProps {
  /**
   * Whether the modal is open
   */
  isOpen: boolean;
  /**
   * Close handler
   */
  onClose: () => void;
  /**
   * Current page
   */
  currentPage?: PreferencesPage;
  /**
   * Page change handler
   */
  onPageChange?: (page: PreferencesPage) => void;
  /**
   * Operating system for platform-specific header controls
   * @default 'macos'
   */
  os?: 'macos' | 'windows';
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Zoom toggle preset 1 value
   */
  zoomToggleLevel1?: string;
  /**
   * Zoom toggle preset 1 change handler
   */
  onZoomToggleLevel1Change?: (value: string) => void;
  /**
   * Zoom toggle preset 2 value
   */
  zoomToggleLevel2?: string;
  /**
   * Zoom toggle preset 2 change handler
   */
  onZoomToggleLevel2Change?: (value: string) => void;
  /**
   * Reset warnings handler (for "Don't show again" checkboxes)
   */
  onResetWarnings?: () => void;
  /**
   * Open plugin manager handler
   */
  onOpenPluginManager?: () => void;
  /**
   * Render-slot for the Accounts page. The consumer supplies whatever
   * account / sign-in UI it wants (e.g. the sandbox supplies its MuseHub
   * account section bound to MuseHubContext). The slot is wrapped in the
   * standard preferences-page container so it inherits layout + spacing.
   */
  accountsContent?: React.ReactNode;
}
