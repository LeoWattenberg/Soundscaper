import React, { ReactElement, cloneElement, useState } from 'react';
import { SidePanel } from '../SidePanel';
import { ResizablePanel } from '../ResizablePanel';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { ContextMenu } from '../ContextMenu';
import { ContextMenuItem } from '../ContextMenuItem';
import { AddTrackFlyout, TrackType } from '../AddTrackFlyout';
import type { TrackControlPanelProps } from '../TrackControlPanel';
import { useTabOrder } from '../hooks/useTabOrder';
import { useTheme } from '../ThemeProvider';
import './TrackControlSidePanel.css';

export interface TrackControlSidePanelProps {
  /**
   * TrackControlPanel components
   */
  children: ReactElement<TrackControlPanelProps> | ReactElement<TrackControlPanelProps>[];

  /**
   * Whether the panel is resizable
   */
  resizable?: boolean;

  /**
   * Minimum width when resizing (px)
   */
  minWidth?: number;

  /**
   * Maximum width when resizing (px)
   */
  maxWidth?: number;

  /**
   * Track heights in pixels - should match timeline track heights
   */
  trackHeights?: number[];

  /**
   * Index of the focused track (shows focus border)
   */
  focusedTrackIndex?: number | null;

  /**
   * Called when panel is resized
   */
  onResize?: (width: number) => void;

  /**
   * Called when a track is resized
   */
  onTrackResize?: (trackIndex: number, height: number) => void;

  /**
   * Called when "Add new" button is clicked (deprecated - use onAddTrackType)
   */
  onAddTrack?: () => void;

  /**
   * Called when a track type is selected from the flyout
   */
  onAddTrackType?: (type: TrackType) => void;

  /**
   * Whether to show the MIDI option in the add track flyout
   */
  showMidiOption?: boolean;

  /**
   * Called when a track should be deleted
   */
  onDeleteTrack?: (trackIndex: number) => void;

  /**
   * Called when a track should be duplicated
   */
  onDuplicateTrack?: (trackIndex: number) => void;

  /**
   * Called when a track should move up
   */
  onMoveTrackUp?: (trackIndex: number) => void;

  /**
   * Called when a track should move down
   */
  onMoveTrackDown?: (trackIndex: number) => void;

  /**
   * Called when track view mode changes
   */
  onTrackViewChange?: (trackIndex: number, viewMode: 'waveform' | 'spectrogram' | 'split') => void;

  /**
   * Called when track colour changes
   */
  onTrackColorChange?: (trackIndex: number, color: 'cyan' | 'blue' | 'violet' | 'magenta' | 'red' | 'orange' | 'yellow' | 'green' | 'teal') => void;

  /**
   * Track view modes for each track
   */
  trackViewModes?: Array<'waveform' | 'spectrogram' | 'split' | undefined>;

  /**
   * Current colour for each track (from first clip)
   */
  trackColors?: Array<string | undefined>;

  /**
   * Additional CSS class
   */
  className?: string;

  /**
   * Ref for the scrollable track list container
   */
  scrollRef?: React.RefObject<HTMLDivElement>;

  /**
   * Called when the track list is scrolled
   */
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;

  /**
   * Buffer space below the last track (px)
   * @default 0
   */
  bufferSpace?: number;

  /**
   * Called when "Spectrogram settings" is clicked in the track menu
   */
  onSpectrogramSettings?: (trackIndex: number) => void;
}

export const TrackControlSidePanel: React.FC<TrackControlSidePanelProps> = ({
  children,
  resizable = false,
  minWidth = 280,
  maxWidth = 280,
  trackHeights = [],
  focusedTrackIndex = null,
  onResize,
  onTrackResize,
  onAddTrack,
  onAddTrackType,
  showMidiOption = false,
  onDeleteTrack,
  onDuplicateTrack,
  onMoveTrackUp,
  onMoveTrackDown,
  onTrackViewChange,
  onTrackColorChange,
  onSpectrogramSettings,
  trackViewModes = [],
  trackColors = [],
  className = '',
  scrollRef,
  onScroll,
  bufferSpace = 0,
}) => {
  const { theme } = useTheme();
  const childArray = React.Children.toArray(children) as ReactElement<TrackControlPanelProps>[];
  const [menuState, setMenuState] = useState<{ isOpen: boolean; trackIndex: number; x: number; y: number }>({
    isOpen: false,
    trackIndex: -1,
    x: 0,
    y: 0,
  });
  const [addTrackFlyoutOpen, setAddTrackFlyoutOpen] = useState(false);
  const [addTrackFlyoutPosition, setAddTrackFlyoutPosition] = useState({ x: 0, y: 0 });
  const [addTrackFlyoutAutoFocus, setAddTrackFlyoutAutoFocus] = useState(false);
  const addButtonRef = React.useRef<HTMLDivElement>(null);
  const addButtonElementRef = React.useRef<HTMLButtonElement>(null);

  const addButtonTabIndex = useTabOrder('add-track');

  const style = {
    '--tcsp-bg': theme.background.trackHeader.parent,
    '--tcsp-header-bg': theme.background.trackHeader.parent,
    '--tcsp-title-color': theme.foreground.text.primary,
    '--tcsp-list-bg': theme.background.trackHeader.parent,
    '--tcsp-border': theme.border.onSurface,
    '--tcsp-focus-outline': theme.border.focus,
  } as React.CSSProperties;

  const handleMenuClick = (trackIndex: number, event?: React.MouseEvent) => {
    // If event is provided, use the button's position
    if (event) {
      const button = event.currentTarget as HTMLElement;
      const rect = button.getBoundingClientRect();
      setMenuState({
        isOpen: true,
        trackIndex,
        x: rect.left, // Align to left of button
        y: rect.bottom + 1, // 1px below the button
      });
    } else {
      // Fallback: Get the track control panel element to position menu
      const trackElement = document.querySelector(`.track-control-side-panel__track:nth-child(${trackIndex + 1})`);
      if (trackElement) {
        const rect = trackElement.getBoundingClientRect();
        setMenuState({
          isOpen: true,
          trackIndex,
          x: rect.right + 4,
          y: rect.top + 40,
        });
      }
    }
  };

  const handleMenuClose = () => {
    setMenuState({ isOpen: false, trackIndex: -1, x: 0, y: 0 });
  };

  return (
    <SidePanel
      position="left"
      width={280}
      resizable={resizable}
      minWidth={minWidth}
      maxWidth={maxWidth}
      onResize={onResize}
      className={`track-control-side-panel ${className}`}
      style={style}
    >
      {/* Header */}
      <div className="track-control-side-panel__header">
        <h2 className="track-control-side-panel__title">Tracks</h2>
        <div ref={addButtonRef}>
          <Button
            ref={addButtonElementRef}
            variant="secondary"
            size="default"
            onClick={(e) => {
              // If using new onAddTrackType callback, show flyout
              if (onAddTrackType && addButtonRef.current) {
                const rect = addButtonRef.current.getBoundingClientRect();
                setAddTrackFlyoutPosition({
                  x: rect.left + rect.width / 2 - 96, // Center the flyout (192px / 2 = 96)
                  y: rect.bottom + 8, // 8px gap below button
                });

                // Check if this was triggered by keyboard (Enter/Space)
                // React synthetic events don't expose nativeEvent.detail, so we check if it's a MouseEvent
                const isKeyboard = e && (e as any).nativeEvent && (e as any).nativeEvent.detail === 0;
                setAddTrackFlyoutAutoFocus(isKeyboard);
                setAddTrackFlyoutOpen(!addTrackFlyoutOpen);
              } else if (onAddTrack) {
                // Fallback to old callback for backward compatibility
                onAddTrack();
              }
            }}
            showIcon={true}
            icon={<Icon name="plus" size={16} />}
            tabIndex={addButtonTabIndex}
          >
            Add new
          </Button>
        </div>
      </div>

      {/* Track list */}
      <div
        className="track-control-side-panel__list"
        ref={scrollRef}
        onScroll={onScroll}
        style={{ paddingBottom: `${bufferSpace}px` }}
        tabIndex={-1}
      >
        {childArray.map((child, index) => {
          const height = trackHeights[index] || 114; // Default to 114px
          // Use child's isFocused prop if provided, otherwise calculate from focusedTrackIndex
          const isFocused = child.props.isFocused !== undefined
            ? child.props.isFocused
            : focusedTrackIndex === index;
          const isContainerFocused = (child.props as any).containerFocused || false;
          return (
            <ResizablePanel
              key={child.key || index}
              initialHeight={height}
              minHeight={44}
              className={`track-control-side-panel__track ${isFocused ? 'track-control-side-panel__track--focused' : ''}`}
              style={undefined}
              isFirstPanel={index === 0}
              onHeightChange={(newHeight) => onTrackResize?.(index, newHeight)}
            >
              {cloneElement(child, {
                ...child.props,
                // Only override isFocused if not already provided by parent
                ...(child.props.isFocused === undefined && { isFocused }),
                isMenuOpen: menuState.isOpen && menuState.trackIndex === index,
                onMenuClick: (event: React.MouseEvent<HTMLButtonElement>) => handleMenuClick(index, event),
                trackHeight: height,
              })}
            </ResizablePanel>
          );
        })}
      </div>

      {/* Context Menu */}
      <ContextMenu
        isOpen={menuState.isOpen}
        x={menuState.x}
        y={menuState.y}
        onClose={handleMenuClose}
      >
        <ContextMenuItem
          label="Delete"
          onClick={() => {
            onDeleteTrack?.(menuState.trackIndex);
            handleMenuClose();
          }}
        />
        <ContextMenuItem
          label="Duplicate"
          onClick={() => {
            onDuplicateTrack?.(menuState.trackIndex);
            handleMenuClose();
          }}
        />
        <ContextMenuItem
          label="Move track up"
          onClick={() => {
            onMoveTrackUp?.(menuState.trackIndex);
            handleMenuClose();
          }}
          disabled={menuState.trackIndex === 0}
        />
        <ContextMenuItem
          label="Move track down"
          onClick={() => {
            onMoveTrackDown?.(menuState.trackIndex);
            handleMenuClose();
          }}
          disabled={menuState.trackIndex === childArray.length - 1}
        />
        {/* Track view menu - hidden for label tracks */}
        {(() => {
          const trackChild = childArray[menuState.trackIndex];
          const isLabelTrack = trackChild?.props?.trackType === 'label';
          const isMidiTrack = trackChild?.props?.trackType === 'midi';

          if (isLabelTrack || isMidiTrack) return null;

          return (
            <>
              <div className="context-menu-separator" />
              {/* Track color submenu */}
              <ContextMenuItem label="Track color" onClose={handleMenuClose}>
                {(['cyan', 'blue', 'violet', 'magenta', 'red', 'orange', 'yellow', 'green', 'teal'] as const).map((color) => {
                  const isActive = trackColors[menuState.trackIndex] === color;
                  return (
                    <ContextMenuItem
                      key={color}
                      label={color.charAt(0).toUpperCase() + color.slice(1)}
                      icon={
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            display: 'inline-block',
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            backgroundColor: `var(--clip-${color}-body)`,
                            border: '1px solid rgba(0,0,0,0.2)',
                            flexShrink: 0,
                          }} />
                          {isActive && <span style={{ fontSize: 12 }}>✓</span>}
                        </span>
                      }
                      onClick={() => { onTrackColorChange?.(menuState.trackIndex, color); handleMenuClose(); }}
                      onClose={handleMenuClose}
                    />
                  );
                })}
              </ContextMenuItem>
              <ContextMenuItem
                label="Track view"
                hasSubmenu={true}
                onClose={handleMenuClose}
              >
                <ContextMenuItem
                  label="Waveform"
                  icon={trackViewModes[menuState.trackIndex] === 'waveform' || trackViewModes[menuState.trackIndex] === undefined ? <span style={{ fontSize: '14px' }}>✓</span> : undefined}
                  onClick={() => {
                    onTrackViewChange?.(menuState.trackIndex, 'waveform');
                  }}
                />
                <ContextMenuItem
                  label="Spectrogram"
                  icon={trackViewModes[menuState.trackIndex] === 'spectrogram' ? <span style={{ fontSize: '14px' }}>✓</span> : undefined}
                  onClick={() => {
                    onTrackViewChange?.(menuState.trackIndex, 'spectrogram');
                  }}
                />
                <ContextMenuItem
                  label="Split view"
                  icon={trackViewModes[menuState.trackIndex] === 'split' ? <span style={{ fontSize: '14px' }}>✓</span> : undefined}
                  onClick={() => {
                    onTrackViewChange?.(menuState.trackIndex, 'split');
                  }}
                />
                {onSpectrogramSettings && (
                  <>
                    <div className="context-menu-separator" />
                    <ContextMenuItem
                      label="Spectrogram settings..."
                      onClick={() => {
                        onSpectrogramSettings(menuState.trackIndex);
                        handleMenuClose();
                      }}
                      onClose={handleMenuClose}
                    />
                  </>
                )}
              </ContextMenuItem>
            </>
          );
        })()}
      </ContextMenu>

      {/* Add Track Flyout */}
      <AddTrackFlyout
        isOpen={addTrackFlyoutOpen}
        x={addTrackFlyoutPosition.x}
        y={addTrackFlyoutPosition.y}
        showMidiOption={showMidiOption}
        autoFocus={addTrackFlyoutAutoFocus}
        triggerRef={addButtonElementRef}
        onSelectTrackType={(type: TrackType) => {
          onAddTrackType?.(type);
          // Don't close flyout - let user click outside or press Escape
        }}
        onClose={() => setAddTrackFlyoutOpen(false)}
      />
    </SidePanel>
  );
};

export default TrackControlSidePanel;
