import React from 'react';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import { ContextMenuItem } from '../ContextMenuItem/ContextMenuItem';
import { useTheme } from '../ThemeProvider';
import './TimelineRulerContextMenu.css';

export interface TimelineRulerContextMenuProps {
  /**
   * Whether the menu is open
   */
  isOpen: boolean;

  /**
   * Callback when menu should close
   */
  onClose: () => void;

  /**
   * X position for the menu (in pixels)
   */
  x: number;

  /**
   * Y position for the menu (in pixels)
   */
  y: number;

  /**
   * Current time format ('minutes-seconds' | 'beats-measures')
   */
  timeFormat?: 'minutes-seconds' | 'beats-measures';

  /**
   * Callback when time format changes
   */
  onTimeFormatChange?: (format: 'minutes-seconds' | 'beats-measures') => void;

  /**
   * Whether "Update display while playing" is enabled
   */
  updateDisplayWhilePlaying?: boolean;

  /**
   * Callback for toggling "Update display while playing"
   */
  onToggleUpdateDisplay?: () => void;

  /**
   * Whether "Pinned play head" is enabled
   */
  pinnedPlayHead?: boolean;

  /**
   * Callback for toggling "Pinned play head"
   */
  onTogglePinnedPlayHead?: () => void;

  /**
   * Whether "Click ruler to start playback" is enabled
   */
  clickRulerToStartPlayback?: boolean;

  /**
   * Callback for toggling "Click ruler to start playback"
   */
  onToggleClickRulerToStartPlayback?: () => void;

  /**
   * Whether loop region is enabled
   */
  loopRegionEnabled?: boolean;

  /**
   * Callback for toggling loop region
   */
  onToggleLoopRegion?: () => void;

  /**
   * Callback for clearing loop region
   */
  onClearLoopRegion?: () => void;

  /**
   * Callback for setting loop region to selection
   */
  onSetLoopRegionToSelection?: () => void;

  /**
   * Callback for setting selection to loop
   */
  onSetSelectionToLoop?: () => void;

  /**
   * Whether "Creating a loop also selects audio" is enabled
   */
  creatingLoopSelectsAudio?: boolean;

  /**
   * Callback for toggling "Creating a loop also selects audio"
   */
  onToggleCreatingLoopSelectsAudio?: () => void;

  /**
   * Whether vertical rulers are shown
   */
  showVerticalRulers?: boolean;

  /**
   * Callback for toggling vertical rulers
   */
  onToggleVerticalRulers?: () => void;

  /**
   * Whether to auto-focus first menu item (when opened via keyboard)
   */
  autoFocus?: boolean;
}

/**
 * TimelineRulerContextMenu - Context menu for the timeline ruler
 * Shows options for time format, playback, loop regions, and ruler settings
 */
export const TimelineRulerContextMenu: React.FC<TimelineRulerContextMenuProps> = ({
  isOpen,
  onClose,
  x,
  y,
  timeFormat = 'minutes-seconds',
  onTimeFormatChange,
  updateDisplayWhilePlaying = false,
  onToggleUpdateDisplay,
  pinnedPlayHead = false,
  onTogglePinnedPlayHead,
  clickRulerToStartPlayback = false,
  onToggleClickRulerToStartPlayback,
  loopRegionEnabled = false,
  onToggleLoopRegion,
  onClearLoopRegion,
  onSetLoopRegionToSelection,
  onSetSelectionToLoop,
  creatingLoopSelectsAudio = false,
  onToggleCreatingLoopSelectsAudio,
  showVerticalRulers = false,
  onToggleVerticalRulers,
  autoFocus = false,
}) => {
  const { theme } = useTheme();

  const style = {
    '--timeline-ruler-context-menu-divider-bg': theme.border.divider,
  } as React.CSSProperties;

  return (
    <ContextMenu isOpen={isOpen} onClose={onClose} x={x} y={y} className="timeline-ruler-context-menu" autoFocus={autoFocus} style={style}>
      {/* Time format options */}
      <ContextMenuItem
        label="Minutes & seconds"
        onClick={() => {
          onTimeFormatChange?.('minutes-seconds');
          onClose();
        }}
        onClose={onClose}
        icon={timeFormat === 'minutes-seconds' ? <CheckIcon /> : null}
      />

      <ContextMenuItem
        label="Beats & measures"
        onClick={() => {
          onTimeFormatChange?.('beats-measures');
          onClose();
        }}
        onClose={onClose}
        icon={timeFormat === 'beats-measures' ? <CheckIcon /> : null}
      />

      {/* Divider */}
      <div className="timeline-ruler-context-menu-divider" />

      {/* Display options */}
      <ContextMenuItem
        label="Update display while playing"
        onClick={() => {
          onToggleUpdateDisplay?.();
          onClose();
        }}
        onClose={onClose}
        icon={updateDisplayWhilePlaying ? <CheckIcon /> : null}
      />

      <ContextMenuItem
        label="Pinned play head"
        onClick={() => {
          onTogglePinnedPlayHead?.();
          onClose();
        }}
        onClose={onClose}
        icon={pinnedPlayHead ? <CheckIcon /> : null}
      />

      {/* Click ruler to start playback */}
      <ContextMenuItem
        label="Click ruler to start playback"
        onClick={() => {
          onToggleClickRulerToStartPlayback?.();
          onClose();
        }}
        onClose={onClose}
        icon={clickRulerToStartPlayback ? <CheckIcon /> : null}
      />

      {/* Divider */}
      <div className="timeline-ruler-context-menu-divider" />

      {/* Loop region with submenu */}
      <ContextMenuItem
        label="Toggle loop region"
        onClick={() => {
          onToggleLoopRegion?.();
          onClose();
        }}
        onClose={onClose}
        icon={<LoopIcon />}
        hasSubmenu
      >
        <ContextMenuItem
          label="Clear loop region"
          onClick={() => {
            onClearLoopRegion?.();
            onClose();
          }}
        />
        <ContextMenuItem
          label="Set loop region to selection"
          onClick={() => {
            onSetLoopRegionToSelection?.();
            onClose();
          }}
        />
        <ContextMenuItem
          label="Set selection to loop"
          onClick={() => {
            onSetSelectionToLoop?.();
            onClose();
          }}
        />
        <div className="timeline-ruler-context-menu-divider" />
        <ContextMenuItem
          label="Creating a loop also selects audio"
          onClick={() => {
            onToggleCreatingLoopSelectsAudio?.();
            onClose();
          }}
          icon={creatingLoopSelectsAudio ? <CheckIcon /> : null}
        />
      </ContextMenuItem>

      {/* Divider */}
      <div className="timeline-ruler-context-menu-divider" />

      {/* Show vertical rulers */}
      <ContextMenuItem
        label="Show vertical rulers"
        onClick={() => {
          onToggleVerticalRulers?.();
          onClose();
        }}
        onClose={onClose}
        icon={showVerticalRulers ? <CheckIcon /> : null}
      />
    </ContextMenu>
  );
};

// Icon components
const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M14 4L6 12L2 8l1-1 3 3 7-7 1 1z" />
  </svg>
);

const LoopIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M13 4V2l3 3-3 3V6H5v4H4V5h9zM3 12v2l-3-3 3-3v2h8V6h1v6H3z" />
  </svg>
);
