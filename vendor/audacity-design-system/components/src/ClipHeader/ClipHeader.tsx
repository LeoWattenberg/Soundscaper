import React from 'react';
import type { ClipColor } from '../types/clip';
import { Icon } from '../Icon';
import { ClipHeaderBadge } from './ClipHeaderBadge';
import { clipSpeedLabel } from './clip-header-badge-labels';
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
  /** Playback speed as a percent, without rounding non-default speeds to 100%. */
  stretchPercent?: number;
  /** Localized accessible labels for the existing indicators. */
  pitchLabel?: string;
  speedLabel?: string;
  /** Opens clip properties at the corresponding control. */
  onPitchClick?: () => void;
  onSpeedClick?: () => void;
  /** Restores the corresponding clip property on double-click. */
  onPitchReset?: () => void;
  onSpeedReset?: () => void;
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
  /** One-shot request to start inline rename from the focused clip. */
  renameRequestId?: number;
  /** Called after an inline rename request finishes or is cancelled. */
  onRenameFinished?: () => void;
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
  pitchLabel = 'Clip pitch',
  speedLabel = 'Clip speed',
  onPitchClick,
  onSpeedClick,
  onPitchReset,
  onSpeedReset,
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
  renameRequestId,
  onRenameFinished,
}) => {
  const [isRenaming, setIsRenaming] = React.useState(false);
  const [renameDraft, setRenameDraft] = React.useState(name);
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const consumedRenameRequestRef = React.useRef<number | undefined>(undefined);
  // The callback a rename commits through is the one that existed when the
  // rename began. A host that withdraws onRename while the editor is busy
  // must not turn a rename the user already started into a silent no-op: the
  // captured callback is called and the host decides whether to refuse it.
  const renameCommitRef = React.useRef<((newName: string) => void) | undefined>(undefined);
  // Enter can synchronously publish the renamed clip and unmount this focused
  // input, which may deliver a trailing blur with a stale controlled value.
  // Only the first completion event belongs to a rename session.
  const renameSettledRef = React.useRef(true);

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

  React.useEffect(() => {
    if (renameRequestId === undefined || renameRequestId === consumedRenameRequestRef.current) return;
    consumedRenameRequestRef.current = renameRequestId;
    if (!onRename) {
      onRenameFinished?.();
      return;
    }
    renameCommitRef.current = onRename;
    renameSettledRef.current = false;
    setRenameDraft(name);
    setIsRenaming(true);
  }, [name, onRename, onRenameFinished, renameRequestId]);

  const startRename = () => {
    if (!onRename) return;
    renameCommitRef.current = onRename;
    renameSettledRef.current = false;
    setRenameDraft(name);
    setIsRenaming(true);
  };
  const commitRename = (rawValue = renameDraft) => {
    if (renameSettledRef.current) return;
    renameSettledRef.current = true;
    const next = rawValue.trim();
    const commit = renameCommitRef.current ?? onRename;
    renameCommitRef.current = undefined;
    if (next && next !== name) commit?.(next);
    setIsRenaming(false);
    onRenameFinished?.();
  };
  const cancelRename = () => {
    if (renameSettledRef.current) return;
    renameSettledRef.current = true;
    renameCommitRef.current = undefined;
    setRenameDraft(name);
    setIsRenaming(false);
    onRenameFinished?.();
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
  const speedPercent = Number.parseFloat(speedValue);
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
              if (e.nativeEvent?.isComposing) return;
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                const clip = e.currentTarget.closest<HTMLElement>('[data-clip-id]');
                commitRename(e.currentTarget.value);
                clip?.focus({ preventScroll: true });
              } else if (e.key === 'Escape') {
                e.preventDefault();
                const clip = e.currentTarget.closest<HTMLElement>('[data-clip-id]');
                cancelRename();
                clip?.focus({ preventScroll: true });
              }
            }}
            onBlur={(e) => commitRename(e.currentTarget.value)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Clip name"
          />
        ) : (
          <span
            className="clip-header__name"
            onMouseDown={(e) => {
              if (e.detail !== 2) return;
              e.preventDefault();
              e.stopPropagation();
              startRename();
            }}
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
            <ClipHeaderBadge
              label={pitchLabel}
              icon={<span className="clip-header__badge-icon" aria-hidden="true">♪</span>}
              value={pitchValue}
              onClick={onPitchClick}
              onReset={onPitchReset}
            />
          )}

          {showSpeed && speedPercent !== 100 && (
            <ClipHeaderBadge
              label={speedLabel}
              icon={<span className="clip-header__badge-icon" aria-hidden="true">⚡</span>}
              value={Number.isFinite(speedPercent) ? clipSpeedLabel(speedPercent) : speedValue}
              onClick={onSpeedClick}
              onReset={onSpeedReset}
            />
          )}

          {showStretch && stretchPercent !== 100 && (
            <ClipHeaderBadge
              label={speedLabel}
              icon={<span
                className="clip-header__badge-icon musescore-icon"
                aria-hidden="true"
              >
                {'\uF475'}
              </span>}
              value={clipSpeedLabel(stretchPercent)}
              onClick={onSpeedClick}
              onReset={onSpeedReset}
            />
          )}

          {showMenu && (
            <button
              className="clip-header__menu-button"
              onClick={handleMenuClick}
              aria-label="Clip menu"
              type="button"
              tabIndex={-1}
            >
              <Icon name="menu" size={14} color="var(--clip-header-text)" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClipHeader;
