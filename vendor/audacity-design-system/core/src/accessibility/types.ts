/**
 * Accessibility Profile Types
 *
 * Defines types for configurable accessibility profiles that control
 * keyboard navigation, focus management, and tab order behavior
 */

/**
 * Tab index management strategy
 * - 'roving': Only one element has tabindex="0", others have tabindex="-1"
 * - 'sequential': All elements have tabindex="0"
 */
export type TabIndexStrategy = 'roving' | 'sequential';

/**
 * Focus management strategy
 * - 'roving': Single tab stop per group, arrow keys navigate within
 * - 'sequential': Each element is a tab stop
 */
export type FocusManagementStrategy = 'roving' | 'sequential';

/**
 * Tab navigation pattern
 * - 'hierarchical': Tab moves between groups
 * - 'sequential': Tab moves through all elements in DOM order
 */
export type TabNavigationPattern = 'hierarchical' | 'sequential';

/**
 * Configuration for a tab group (toolbar, sidebar, etc.)
 */
export interface TabGroupConfig {
  /**
   * Strategy for managing tabindex values
   */
  tabindex: TabIndexStrategy;

  /**
   * Whether arrow keys navigate within this group
   */
  arrows: boolean;

  /**
   * Whether navigation wraps from last to first item
   */
  wrap: boolean;
}

/**
 * Keyboard shortcuts configuration
 */
export interface KeyboardShortcutsConfig {
  /**
   * Clip keyboard shortcuts
   */
  clips?: {
    /**
     * Enable Shift+Arrow for extending clip edges
     */
    shiftArrowExtend?: boolean;

    /**
     * Enable Cmd+Shift+Arrow for reducing clip edges
     */
    cmdShiftArrowReduce?: boolean;

    /**
     * Enable Cmd+Arrow for moving clips horizontally
     */
    cmdArrowMove?: boolean;

    /**
     * Enable Cmd+Up/Down for moving clips between tracks
     */
    cmdUpDownTrackMove?: boolean;
  };

  /**
   * Label keyboard shortcuts
   */
  labels?: {
    /**
     * Enable Shift+Arrow for extending label edges
     */
    shiftArrowExtend?: boolean;

    /**
     * Enable Cmd+Shift+Arrow for reducing label edges
     */
    cmdShiftArrowReduce?: boolean;

    /**
     * Enable Cmd+Arrow for moving labels horizontally
     */
    cmdArrowMove?: boolean;

    /**
     * Enable Delete/Backspace for deleting labels
     */
    deleteKey?: boolean;
  };
}

/**
 * Complete accessibility profile configuration
 */
export interface AccessibilityProfileConfig {
  /**
   * Overall focus management strategy
   */
  focusManagement: FocusManagementStrategy;

  /**
   * Tab navigation pattern
   */
  tabNavigation: TabNavigationPattern;

  /**
   * Configuration for each tab group in the application
   */
  tabGroups: {
    [groupId: string]: TabGroupConfig;
  };

  /**
   * Maps tab group IDs to their numeric tabIndex values.
   * In hierarchical mode, each group gets a unique positive tabIndex so Tab
   * visits them in the specified order.  In sequential (flat) mode this
   * record is typically empty — every element uses tabIndex 0.
   */
  tabOrder: Record<string, number>;

  /**
   * Keyboard shortcuts configuration
   */
  keyboardShortcuts?: KeyboardShortcutsConfig;
}

/**
 * Accessibility profile definition
 */
export interface AccessibilityProfile {
  /**
   * Unique identifier for this profile
   */
  id: string;

  /**
   * Display name
   */
  name: string;

  /**
   * Description of the profile's behavior
   */
  description: string;

  /**
   * Configuration settings
   */
  config: AccessibilityProfileConfig;
}
