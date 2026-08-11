import React, { useState } from 'react';
import { useTheme } from '../ThemeProvider';
import { Button } from '../Button';
import { GhostButton } from '../GhostButton';
import { Icon } from '../Icon';
import { PanKnob } from '../PanKnob';
import { Slider } from '../Slider';
import { ToggleButton } from '../ToggleButton';
import { Dropdown } from '../Dropdown';
import { TrackMeter } from '../TrackMeter';
import './TrackControlPanel.css';

export interface TrackControlPanelProps {
  trackName: string;
  trackType?: 'mono' | 'stereo' | 'label' | 'midi';
  volume?: number; // 0-100
  pan?: number; // -100 to 100
  isMuted?: boolean;
  isSolo?: boolean;
  isFocused?: boolean;
  isMenuOpen?: boolean;
  onVolumeChange?: (volume: number) => void;
  onPanChange?: (pan: number) => void;
  onMuteToggle?: () => void;
  onSoloToggle?: () => void;
  onEffectsClick?: () => void;
  onAddLabelClick?: () => void;
  /** Available MIDI instruments (shown for MIDI tracks) */
  instruments?: Array<{ id: string; label: string }>;
  /** Currently selected instrument id */
  instrument?: string;
  /** Called when user changes the instrument */
  onInstrumentChange?: (id: string) => void;
  onMenuClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onClick?: () => void;
  onToggleSelection?: () => void; // Cmd/Ctrl+Click to toggle
  onRangeSelection?: () => void; // Shift+Click for range selection
  className?: string;
  state?: 'idle' | 'hover' | 'active';
  height?: 'default' | 'truncated' | 'collapsed';
  trackHeight?: number; // Actual pixel height for fine-grained responsive behavior
  tabIndex?: number;
  onFocusChange?: (hasFocus: boolean) => void;
  onNavigateVertical?: (direction: 'up' | 'down', shiftKey?: boolean) => void;
  onTabOut?: () => void;
  /** Callback when Shift+Tab is pressed to return focus to the track container */
  onShiftTabOut?: () => void;
  /** Whether the track container (in the canvas) currently has keyboard focus */
  containerFocused?: boolean;
  // Meter props (for mono tracks, use meterLevel; for stereo, use meterLevelLeft/meterLevelRight)
  meterLevel?: number; // 0-100 - current meter level (mono)
  meterLevelLeft?: number; // 0-100 - left channel meter level (stereo)
  meterLevelRight?: number; // 0-100 - right channel meter level (stereo)
  meterClipped?: boolean; // Whether meter is clipping (mono)
  meterClippedLeft?: boolean; // Whether left channel is clipping (stereo)
  meterClippedRight?: boolean; // Whether right channel is clipping (stereo)
  meterStyle?: 'default' | 'rms'; // Meter display style
  meterRecentPeak?: number; // 0-100 - recent peak level (mono)
  meterRecentPeakLeft?: number; // 0-100 - left channel recent peak (stereo)
  meterRecentPeakRight?: number; // 0-100 - right channel recent peak (stereo)
  meterMaxPeak?: number; // 0-100 - max peak level (mono)
  meterMaxPeakLeft?: number; // 0-100 - left channel max peak (stereo)
  meterMaxPeakRight?: number; // 0-100 - right channel max peak (stereo)
}

export const TrackControlPanel: React.FC<TrackControlPanelProps> = ({
  trackName,
  trackType = 'mono',
  volume = 75,
  pan = 0,
  isMuted = false,
  isSolo = false,
  isFocused = false,
  isMenuOpen = false,
  onVolumeChange,
  onPanChange,
  onMuteToggle,
  onSoloToggle,
  onEffectsClick,
  onAddLabelClick,
  instruments,
  instrument,
  onInstrumentChange,
  onMenuClick,
  onClick,
  onToggleSelection,
  onRangeSelection,
  className = '',
  state = 'idle',
  height = 'default',
  trackHeight,
  tabIndex,
  onFocusChange,
  onNavigateVertical,
  onTabOut,
  onShiftTabOut,
  containerFocused = false,
  meterLevel = 0,
  meterLevelLeft,
  meterLevelRight,
  meterClipped = false,
  meterClippedLeft,
  meterClippedRight,
  meterStyle = 'default',
  meterRecentPeak,
  meterRecentPeakLeft,
  meterRecentPeakRight,
  meterMaxPeak,
  meterMaxPeakLeft,
  meterMaxPeakRight,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const focusFromMouseRef = React.useRef(false);

  // Calculate volume slider position
  const volumePercent = volume;

  const actualState = state !== 'idle' ? state : (isHovered ? 'hover' : 'idle');

  // Determine track icon based on type
  const getTrackIcon = () => {
    switch (trackType) {
      case 'label':
        return 'label';
      case 'midi':
        return 'midi';
      case 'stereo':
        return 'microphone';
      case 'mono':
      default:
        return 'microphone';
    }
  };

  const isLabelTrack = trackType === 'label';
  const isMidiTrack = trackType === 'midi';

  // Determine if Effect button should be visible based on actual pixel height (>= 102px)
  // Audio tracks: show when height >= 102px
  // Label tracks: show when height >= 76px
  const showEffectButton = isLabelTrack
    ? (trackHeight ? trackHeight >= 76 : height === 'default')
    : (trackHeight ? trackHeight >= 102 : height === 'default');

  // For label tracks < 76px, show small add button in header instead
  const showLabelHeaderButton = isLabelTrack && trackHeight && trackHeight < 76;

  const handleFocus = (e: React.FocusEvent) => {
    // Focus entered somewhere within the panel (could be panel itself or a child)
    onFocusChange?.(true);
  };

  const handleBlur = (e: React.FocusEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const panelElement = e.currentTarget;

    // Only notify blur if focus is moving completely outside the panel
    if (!relatedTarget || !panelElement.contains(relatedTarget)) {
      onFocusChange?.(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const panelElement = e.currentTarget as HTMLElement;
    const currentElement = document.activeElement;
    const isPanelFocused = currentElement === panelElement;

    // Handle Enter key for track selection when panel is focused
    if (e.key === 'Enter' && isPanelFocused) {
      e.preventDefault();
      if (e.shiftKey && !e.metaKey && !e.ctrlKey) {
        // Shift+Enter: range-select from anchor to this track
        onRangeSelection?.();
      } else if (e.metaKey || e.ctrlKey) {
        // Cmd/Ctrl+Enter: toggle track in/out of multi-selection
        onToggleSelection?.();
      } else {
        // Plain Enter: exclusively select this track
        onClick?.();
      }
      return;
    }

    // Handle Shift+F10 or ContextMenu key to open track menu
    if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
      e.preventDefault();
      e.stopPropagation();
      // Trigger menu click with a synthetic event
      if (onMenuClick) {
        const syntheticEvent = {
          currentTarget: panelElement.querySelector('[aria-label="Track menu"]') || panelElement,
          preventDefault: () => {},
          stopPropagation: () => {},
        } as unknown as React.MouseEvent<HTMLButtonElement>;
        onMenuClick(syntheticEvent);
      }
      return;
    }

    // Handle Escape key to return focus to panel itself
    if (e.key === 'Escape' && !isPanelFocused) {
      e.preventDefault();
      panelElement.focus();
      return;
    }

    // If a child has invisible focus (mouse click), Tab reveals the outline
    if (e.key === 'Tab' && !isPanelFocused && focusFromMouseRef.current) {
      e.preventDefault();
      focusFromMouseRef.current = false;
      // Re-focus to reset focus origin — triggers :focus-visible
      const el = currentElement as HTMLElement;
      el.blur();
      el.focus();
      return;
    }

    // Handle Tab or Shift+Tab from the panel itself — go to track container
    if (e.key === 'Tab' && isPanelFocused) {
      e.preventDefault();
      onShiftTabOut?.();
      return;
    }

    // Handle Tab key from a child — navigate out to clips
    if (e.key === 'Tab' && !e.shiftKey && !isPanelFocused) {
      e.preventDefault();
      onTabOut?.();
      return;
    }

    // Handle Shift+Tab to return focus to the track container
    if (e.key === 'Tab' && e.shiftKey && !isPanelFocused) {
      e.preventDefault();
      onShiftTabOut?.();
      return;
    }

    // Arrow keys on the panel itself or on a child with invisible focus — navigate between tracks
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && (isPanelFocused || focusFromMouseRef.current)) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        onNavigateVertical?.(e.key === 'ArrowUp' ? 'up' : 'down', e.shiftKey);
      }
      // ArrowLeft/Right with invisible focus: do nothing (don't cycle children)
      return;
    }

    // Only handle arrow keys for navigation
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') {
      return;
    }

    // Handle arrow keys for internal navigation (all four directions)
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      return;
    }

    // Find all focusable elements within the panel
    const focusableElements = panelElement.querySelectorAll(
      'button, input, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length === 0) return;

    const currentIndex = Array.from(focusableElements).indexOf(currentElement as HTMLElement);
    const isForward = e.key === 'ArrowRight' || e.key === 'ArrowDown';

    // If the panel itself is focused (currentIndex === -1)
    if (currentIndex === -1) {
      e.preventDefault();
      if (isForward) {
        // Go to first element
        (focusableElements[0] as HTMLElement).focus();
      } else {
        // Go to last element (cycle backwards)
        (focusableElements[focusableElements.length - 1] as HTMLElement).focus();
      }
      return;
    }

    e.preventDefault();

    if (isForward) {
      // Move to next element, wrap to first
      const nextIndex = (currentIndex + 1) % focusableElements.length;
      (focusableElements[nextIndex] as HTMLElement).focus();
    } else {
      // Move to previous element, wrap to last
      const nextIndex = (currentIndex - 1 + focusableElements.length) % focusableElements.length;
      (focusableElements[nextIndex] as HTMLElement).focus();
    }
  };

  const { theme } = useTheme();

  const style = {
    '--tcp-bg-idle': theme.background.trackHeader.idle,
    '--tcp-bg-hover': theme.background.trackHeader.hover,
    '--tcp-bg-active': theme.background.trackHeader.selected,
    '--tcp-text-primary': theme.foreground.text.primary,
    '--tcp-icon-default': theme.foreground.icon.primary,
    '--tcp-focus-color': theme.border.focus,
  } as React.CSSProperties;

  const handleClick = (e: React.MouseEvent) => {
    // Shift+Click: Range selection (select all tracks between last selected and clicked)
    if (e.shiftKey && !e.metaKey && !e.ctrlKey) {
      onRangeSelection?.();
      return;
    }
    // Cmd/Ctrl+Click: Toggle individual track in/out of selection
    if (e.metaKey || e.ctrlKey) {
      onToggleSelection?.();
      return;
    }
    // Regular click: Select only this track
    onClick?.();
  };

  return (
    <div
      className={`track-control-panel track-control-panel--${actualState} track-control-panel--${height} ${isFocused ? 'track-control-panel--focused' : ''} ${containerFocused ? 'track-control-panel--container-focused' : ''} ${isLabelTrack ? 'track-control-panel--label' : ''} ${className}`}
      onMouseDown={() => { focusFromMouseRef.current = true; }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
      tabIndex={tabIndex}
      role={tabIndex !== undefined ? "group" : undefined}
      aria-label={tabIndex !== undefined ? `${trackName} track controls` : undefined}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      style={style}
    >
      <div className="track-control-panel__main">
        {/* Header */}
        <div className="track-control-panel__header">
          <div className="track-control-panel__track-name">
            <button className="track-control-panel__icon-button" aria-label="Track icon" tabIndex={-1}>
              <Icon name={getTrackIcon()} size={16} className="track-control-panel__icon" />
            </button>
            <span className="track-control-panel__track-name-text">{trackName}</span>
          </div>

          <div className="track-control-panel__header-right">
            {/* Small add label button for label tracks < 76px */}
            {showLabelHeaderButton && (
              <ToggleButton
                active={false}
                onClick={onAddLabelClick}
                ariaLabel="Add label"
                tabIndex={-1}
              >
                <Icon name="plus" size={16} />
              </ToggleButton>
            )}

            {/* Mute and Solo buttons in header for audio tracks <= 70px */}
            {!isLabelTrack && trackHeight && trackHeight <= 70 && (
              <div className="track-control-panel__button-group">
                <ToggleButton
                  active={isMuted}
                  onClick={onMuteToggle}
                  ariaLabel="Mute"
                  tabIndex={-1}
                  size={20}
                >
                  M
                </ToggleButton>
                <ToggleButton
                  active={isSolo}
                  onClick={onSoloToggle}
                  ariaLabel="Solo"
                  tabIndex={-1}
                  size={20}
                >
                  S
                </ToggleButton>
              </div>
            )}

            <GhostButton
              onClick={onMenuClick}
              active={isMenuOpen}
              ariaLabel="Track menu"
              tabIndex={-1}
            />
          </div>
        </div>

        {/* Controls Row - Hidden for label tracks and when audio track height <= 70px */}
        {!isLabelTrack && (!trackHeight || trackHeight > 70) && (
          <div className="track-control-panel__controls-row">
            {/* Pan Knob */}
            <PanKnob
              value={pan}
              onChange={onPanChange}
              tabIndex={-1}
            />

            {/* Volume Slider */}
            <Slider
              value={volume}
              onChange={onVolumeChange}
              ariaLabel="Volume"
              tabIndex={-1}
            />

            {/* Mute and Solo Buttons */}
            <div className="track-control-panel__button-group">
              <ToggleButton
                active={isMuted}
                onClick={onMuteToggle}
                ariaLabel="Mute"
                tabIndex={-1}
                size={20}
              >
                M
              </ToggleButton>
              <ToggleButton
                active={isSolo}
                onClick={onSoloToggle}
                ariaLabel="Solo"
                tabIndex={-1}
                size={20}
              >
                S
              </ToggleButton>
            </div>
          </div>
        )}

        {/* Bottom row: Effects button + instrument dropdown (MIDI tracks) */}
        {/* Audio tracks: show Effect button when height >= 102px */}
        {/* Label tracks: show Add label button when height >= 76px */}
        {showEffectButton && (() => {
          const showInstrument = isMidiTrack && instruments && instruments.length > 0;
          return showInstrument ? (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <Button
                variant="secondary"
                size="small"
                onClick={onEffectsClick}
                showIcon={false}
                tabIndex={-1}
              >
                Effects
              </Button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Dropdown
                  options={instruments!.map(i => ({ label: i.label, value: i.id }))}
                  value={instrument ?? instruments![0].id}
                  onChange={(val) => onInstrumentChange?.(val)}
                  width="100%"
                  tabIndex={-1}
                />
              </div>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="small"
              onClick={isLabelTrack ? onAddLabelClick : onEffectsClick}
              showIcon={false}
              tabIndex={-1}
            >
              {isLabelTrack ? 'Add label' : 'Effects'}
            </Button>
          );
        })()}
      </div>

      {/* Volume Meter - Always visible (empty for label tracks to maintain alignment) */}
      <div className="track-control-panel__meter">
        {!isLabelTrack && (
          trackType === 'stereo' ? (
            <>
              {/* Left channel meter */}
              <TrackMeter
                variant="stereo"
                volume={meterLevelLeft ?? 0}
                clipped={meterClippedLeft ?? false}
                meterStyle={meterStyle}
                recentPeak={meterRecentPeakLeft}
                maxPeak={meterMaxPeakLeft}
              />
              {/* Right channel meter */}
              <TrackMeter
                variant="stereo"
                volume={meterLevelRight ?? 0}
                clipped={meterClippedRight ?? false}
                meterStyle={meterStyle}
                recentPeak={meterRecentPeakRight}
                maxPeak={meterMaxPeakRight}
              />
            </>
          ) : (
            /* Mono meter */
            <TrackMeter
              variant="mono"
              volume={meterLevel}
              clipped={meterClipped}
              meterStyle={meterStyle}
              recentPeak={meterRecentPeak}
              maxPeak={meterMaxPeak}
            />
          )
        )}
      </div>
    </div>
  );
};

export default TrackControlPanel;
