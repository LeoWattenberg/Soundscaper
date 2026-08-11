/**
 * Accessibility Profiles
 *
 * Predefined accessibility profiles for different keyboard navigation patterns
 */

import { AccessibilityProfile } from './types';

/**
 * Audacity 4 style navigation
 * - Tab moves between groups (toolbars, sidebar, content, footer)
 * - Arrow keys navigate within groups
 * - Only one element per group is in tab order
 */
export const AU4_TAB_GROUPS_PROFILE: AccessibilityProfile = {
  id: 'au4-tab-groups',
  name: 'Audacity 4 (Tab Groups)',
  description: 'Tab moves between groups, arrow keys navigate within groups',
  config: {
    focusManagement: 'roving',
    tabNavigation: 'hierarchical',

    tabGroups: {
      // Transport toolbar (play, pause, stop, record)
      'transport-toolbar': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Tool toolbar (selection, envelope, etc.)
      'tool-toolbar': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Selection toolbar (bottom toolbar with timecodes)
      'selection-toolbar': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Project toolbar (Home, Project, Export tabs)
      'project-toolbar': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Project toolbar center content (Audio setup, Share, Get effects)
      'project-toolbar-actions': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Project toolbar right content (Workspace, Undo/Redo)
      'project-toolbar-workspace': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Add track button
      'add-track': {
        tabindex: 'roving',
        arrows: false,
        wrap: false,
      },

      // Effects panel (left sidebar with track and master effects)
      'effects-panel': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Preferences sidebar navigation
      'preferences-sidebar': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Preferences content area
      'preferences-content': {
        tabindex: 'roving',
        arrows: true,
        wrap: false,
      },

      // Audio Settings - Inputs and Outputs section
      'inputs-outputs': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Audio Settings - Buffer and Latency section
      'buffer-latency': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Audio Settings - Sample Rate section
      'sample-rate': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Playback/Recording - Playback Performance section
      'playback-performance': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Playback/Recording - Cursor Movement section
      'cursor-movement': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Playback/Recording - Recording Behavior section
      'recording-behavior': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Playback/Recording - Solo Behavior radio group
      'solo-behavior-tab': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Spectral Display - Colours section
      'spectral-colours': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Spectral Display - Algorithm section
      'spectral-algorithm': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Export Modal - Export Type section
      'export-type': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Export Modal - File section (filename, folder, format)
      'file': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Export Modal - Audio Options section (channels, sample rate, encoding)
      'audio-options': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Export Modal - Rendering section
      'rendering': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Export Modal - Footer buttons (Edit metadata, Cancel, Export)
      'footer': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },

      // Dialog/modal footer buttons
      'dialog-footer': {
        tabindex: 'roving',
        arrows: true,
        wrap: true,
      },
    },

    // Single source of truth for tab ordering.
    // Each group ID maps to its numeric tabIndex value.
    tabOrder: {
      'file-menu':                 1,
      'project-toolbar':           2,
      'project-toolbar-actions':   3,
      'project-toolbar-workspace': 4,
      'tool-toolbar':              5,
      'effects-panel':             6,
      'add-track':                98,
      'timeline-ruler':           99,
      'tracks':                  100, // base — stride 4 per track: container +0, panel +1, clips +2, ruler +3
      'selection-toolbar':        200,
    },

    // Keyboard shortcuts configuration
    keyboardShortcuts: {
      clips: {
        shiftArrowExtend: true,
        cmdShiftArrowReduce: true,
        cmdArrowMove: true,
        cmdUpDownTrackMove: true,
      },
      labels: {
        shiftArrowExtend: true,
        cmdShiftArrowReduce: true,
        cmdArrowMove: true,
        deleteKey: true,
      },
    },
  },
};

/**
 * Standard WCAG flat navigation
 * - Tab moves sequentially through all elements
 * - No arrow key navigation within groups
 * - All interactive elements are in tab order
 */
export const WCAG_FLAT_PROFILE: AccessibilityProfile = {
  id: 'wcag-flat',
  name: 'WCAG 2.1 (Flat Navigation)',
  description: 'Sequential tab order through all elements, no grouping',
  config: {
    focusManagement: 'sequential',
    tabNavigation: 'sequential',

    tabGroups: {
      'transport-toolbar': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'tool-toolbar': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'selection-toolbar': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'project-toolbar': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'project-toolbar-actions': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'project-toolbar-workspace': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'add-track': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'preferences-sidebar': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'preferences-content': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'inputs-outputs': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'buffer-latency': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'sample-rate': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'playback-performance': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'cursor-movement': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'recording-behavior': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'solo-behavior-tab': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'spectral-colours': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'spectral-algorithm': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'export-type': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'file': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'audio-options': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'rendering': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'footer': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },

      'dialog-footer': {
        tabindex: 'sequential',
        arrows: false,
        wrap: false,
      },
    },

    // Empty — flat mode uses tabIndex 0 for everything
    tabOrder: {},

    // Keyboard shortcuts configuration - all disabled for exploration
    keyboardShortcuts: {
      clips: {
        shiftArrowExtend: false,
        cmdShiftArrowReduce: false,
        cmdArrowMove: false,
        cmdUpDownTrackMove: false,
      },
      labels: {
        shiftArrowExtend: false,
        cmdShiftArrowReduce: false,
        cmdArrowMove: false,
        deleteKey: false,
      },
    },
  },
};

/**
 * All available accessibility profiles
 */
export const ACCESSIBILITY_PROFILES: AccessibilityProfile[] = [
  AU4_TAB_GROUPS_PROFILE,
  WCAG_FLAT_PROFILE,
];

/**
 * Get a profile by ID, with fallback to default
 */
export function getProfileById(id: string): AccessibilityProfile {
  return ACCESSIBILITY_PROFILES.find(p => p.id === id) || WCAG_FLAT_PROFILE;
}
