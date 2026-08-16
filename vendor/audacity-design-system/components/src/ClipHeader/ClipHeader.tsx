import React from 'react';
import type { ClipColor } from '../types/clip';
import { Icon } from '../Icon';
import '../assets/fonts/musescore-icon.css';
import './ClipHeader.css';

export type ClipHeaderState = 'default' | 'hover';

export interface ClipHeaderProps {
  /** Clip color from the 9-color palette */
  color?: ClipColor;
  /** Whether the parent clip is selected */
  selected?: boolean;
  /** Whether the clip is within a time selection */
  inTimeSelection?: boolean;
  /** Interaction state */
  state?: ClipHeaderState;
  /** Clip name to display */
  name?: string;
  /** Width in pixels */
  width?: number;
  /** Whether to show pitch indicator */
  showPitch?: boolean;
  /** Pitch value to display */
  pitchValue?: string;
  /** Whether to show speed indicator */
  showSpeed?: boolean;
  /** Speed value to display */
  speedValue?: string;
  /** Whether to show the time-stretch indicator (clock glyph + percent). */
  showStretch?: boolean;
  /** Stretch as a percent (e.g. 200 for 2× stretch). Rounded display. */
  stretchPercent?: number;
  /** Whether to show the menu button */
  showMenu?: boolean;
  /** Click handler for the header */
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Click handler for the menu button */
  onMenuClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Mouse enter handler */
  onMouseEnter?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Mouse leave handler */
  onMouseLeave?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Clip start time in seconds (for calculating time selection overlay position) */
  clipStartTime?: number;
  /** Clip duration in seconds (for calculating time selection overlay position) */
  clipDuration?: number;
  /** Time selection range (for calculating overlay position) */
  timeSelectionRange?: { startTime: number; endTime: number } | null;
  /** Pixels per second (timeline zoom level) */
  pixelsPerSecond?: number;
  /** Called when the user commits a new name via inline rename
   * (Enter / F2 / double-click on the name → input → Enter). */
  onRename?: (newName: string) => void;
}

/**
 * ClipHeader - The header section of an audio clip
 *
 * Displays the clip name, optional pitch/speed indicators, and a menu button.
 * Uses the Audacity 9-color clip palette with proper hover and selected states.
 */
export const ClipHeader: React.FC<ClipHeaderProps> = ({
  color = 'blue',
  selected = false,
  inTimeSelection = false,
  state = 'default',
  name = 'Clip',
  width = 272,
  showPitch = false,
  pitchValue = '4.04',
  showSpeed = false,
  speedValue = '112%',
  showStretch = false,
  stretchPercent = 100,
  showMenu = true,
  onClick,
  onMenuClick,
  onMouseEnter,
  onMouseLeave,
  clipStartTime = 0,
  clipDuration = 0,
  timeSelectionRange = null,
  pixelsPerSecond = 100,
  onRename,
}) => {
  const [isRenaming, setIsRenaming] = React.useState(false);
  const [renameDraft, setRenameDraft] = React.useState(name);
  const renameInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isRenaming) {
      const t = window.setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(t);
    }
  }, [isRenaming]);

  React.useEffect(() => {
    if (!isRenaming) setRenameDraft(name);
  }, [name, isRenaming]);

  const startRename = () => {
    if (!onRename) return;
    setRenameDraft(name);
    setIsRenaming(true);
  };
  const commitRename = () => {
    const next = renameDraft.trim();
    if (next && next !== name) onRename?.(next);
    setIsRenaming(false);
  };
  const cancelRename = () => {
    setRenameDraft(name);
    setIsRenaming(false);
  };
  const style = {
    // Clip background tiles use the same brand palette in both themes, so
    // the header text needs to stay dark in dark mode to keep contrast.
    // Hardcoded to match light theme's foreground.text.primary instead of
    // following the theme token (which flips to a light value in dark mode).
    '--clip-header-text': '#14151A',
  } as React.CSSProperties;

  const className = [
    'clip-header',
    `clip-header--${color}`,
    state === 'hover' && 'clip-header--hover',
    selected && 'clip-header--selected',
  ]
    .filter(Boolean)
    .join(' ');

  const handleMenuClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onMenuClick?.(e);
  };

  // Calculate time selection overlay position and width
  // Don't show time selection overlay when clip is selected (selected state takes priority)
  let timeSelectionOverlay: { left: number; width: number } | null = null;
  if (inTimeSelection && timeSelectionRange && !selected) {
    const clipEndTime = clipStartTime + clipDuration;
    const overlapStart = Math.max(clipStartTime, timeSelectionRange.startTime);
    const overlapEnd = Math.min(clipEndTime, timeSelectionRange.endTime);

    if (overlapStart < overlapEnd) {
      const selStartX = (overlapStart - clipStartTime) * pixelsPerSecond;
      const selWidth = (overlapEnd - overlapStart) * pixelsPerSecond;
      timeSelectionOverlay = { left: selStartX, width: selWidth };
    }
  }

  return (
    <div
      className={className}
      style={{ width: `${width}px`, position: 'relative', ...style }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-color={color}
      data-state={state}
      data-selected={selected}
    >
      {/* Time selection overlay */}
      {timeSelectionOverlay && (
        <div
          className="clip-header__time-selection-overlay"
          style={{
            position: 'absolute',
            left: `${timeSelectionOverlay.left}px`,
            width: `${timeSelectionOverlay.width}px`,
            top: 0,
            bottom: 0,
            backgroundColor: `var(--clip-${color}-time-selection-header)`,
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />
      )}
      <div className="clip-header__content">
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="clip-header__name-input"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
              }
            }}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Clip name"
          />
        ) : (
          <span
            className="clip-header__name"
            onDoubleClick={(e) => {
              e.stopPropagation();
              startRename();
            }}
          >
            {name}
          </span>
        )}

        <div className="clip-header__info">
          {showPitch && (
            <div className="clip-header__badge">
              <span className="clip-header__badge-icon">♪</span>
              <span className="clip-header__badge-value">{pitchValue}</span>
            </div>
          )}

          {showSpeed && (
            <div className="clip-header__badge">
              <span className="clip-header__badge-icon">⚡</span>
              <span className="clip-header__badge-value">{speedValue}</span>
            </div>
          )}

          {showStretch && (
            <div className="clip-header__badge">
              <span
                className="clip-header__badge-icon musescore-icon"
                aria-hidden="true"
              >
                {'\uF475'}
              </span>
              <span className="clip-header__badge-value">{Math.round(stretchPercent)}%</span>
            </div>
          )}

          {showMenu && (
            <button
              className="clip-header__menu-button"
              onClick={handleMenuClick}
              aria-label="Clip menu"
              type="button"
              tabIndex={-1}
            >
              <Icon name="menu" size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClipHeader;
