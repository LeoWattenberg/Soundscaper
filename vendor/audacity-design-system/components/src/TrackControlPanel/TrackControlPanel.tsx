import React, { useState } from 'react';
import { useTheme } from '../ThemeProvider';
import { useAccessibilityProfile } from '../contexts/AccessibilityProfileContext';
import { Button } from '../Button';
import { GhostButton } from '../GhostButton';
import { Icon, type IconName } from '../Icon';
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
  /** Called when the user clicks the M button. Receives the mouse
   *  event so the host can distinguish plain click (toggle this
   *  track) from cmd/ctrl+click (exclusive mute — set this track,
   *  clear all others). */
  onMuteToggle?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Called when the user clicks the S button. Receives the mouse
   *  event so the host can distinguish plain click (toggle this
   *  track's solo) from cmd/ctrl+click (exclusive solo — set this
   *  track, clear all others). */
  onSoloToggle?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onEffectsClick?: () => void;
  onAddLabelClick?: () => void;
  /** Called when the user commits a new track name. Enter / F2 /
   * double-click on the name text starts the inline edit; Enter
   * commits, Escape cancels. */
  onRename?: (newName: string) => void;
  /** Available MIDI instruments (shown for MIDI tracks) */
  instruments?: Array<{ id: string; label: string }>;
  /** Currently selected instrument id */
  instrument?: string;
  /** Called when user changes the instrument */
  onInstrumentChange?: (id: string) => void;
  /** Explicit user-picked icon that overrides the trackType default.
   *  When omitted, the icon is derived from `trackType`. */
  icon?: IconName;
  /** Called with the user's new pick when they choose an icon from
   *  the header icon-button flyout. When omitted, the icon button
   *  stays inert (no flyout is offered). */
  onIconChange?: (icon: IconName) => void;
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
  /** Cmd/Ctrl+ArrowUp/Down on the focused header — reorders this
   *  track's row in the track list rather than moving focus. Wired
   *  by the host (EditorLayout) to dispatch MOVE_TRACK. */
  onReorderVertical?: (direction: 'up' | 'down') => void;
  /** Fires on drag-and-drop of the header. `clientY` is the pointer
   *  Y at drop; the host uses that to locate the target row and
   *  dispatch MOVE_TRACK. Only fires when the drag crosses the
   *  threshold — plain clicks stay clicks. */
  onDragReorderDrop?: (clientY: number) => void;
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
  onRename,
  instruments,
  instrument,
  onInstrumentChange,
  icon,
  onIconChange,
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
  onReorderVertical,
  onDragReorderDrop,
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

  // Flat-navigation mode: every control inside the panel gets its
  // own Tab stop and the panel-internal arrow nav + Pan/Volume slot
  // model are disabled, so a sequential keyboard user can reach
  // each interactive element directly.
  const { activeProfile } = useAccessibilityProfile();
  const isFlatNavigation = activeProfile.config.tabNavigation === 'sequential';
  const childTabIndex = isFlatNavigation ? 0 : -1;

  // Inline rename. Enter / F2 / double-click on the name text drops
  // an input in its place; Enter or blur commits, Escape cancels.
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(trackName);
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const nameSpanRef = React.useRef<HTMLSpanElement>(null);
  // Set true when commit/cancel finishes, watched by an effect that
  // focuses the freshly-remounted name span. We can't focus the
  // pre-edit span DOM node directly — switching out of rename mode
  // unmounts that node, so React mounts a new one with a new ref,
  // and we have to wait for the post-render commit to focus it.
  const focusReturnRef = React.useRef(false);

  React.useEffect(() => {
    if (isRenaming) {
      // Focus + select on the next paint so React mounts the input
      // before the focus call.
      const t = window.setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(t);
    }
    if (focusReturnRef.current) {
      focusReturnRef.current = false;
      nameSpanRef.current?.focus();
    }
  }, [isRenaming]);

  React.useEffect(() => {
    if (!isRenaming) setRenameDraft(trackName);
  }, [trackName, isRenaming]);

  const startRename = () => {
    if (!onRename) return;
    setRenameDraft(trackName);
    setIsRenaming(true);
  };

  const commitRename = () => {
    const next = renameDraft.trim();
    if (next && next !== trackName) onRename?.(next);
    focusReturnRef.current = true;
    setIsRenaming(false);
  };

  // Drag-to-reorder gesture on the panel header. Cleanly excludes
  // interactive controls (knobs, sliders, buttons, inputs) so the
  // user can still adjust them without triggering a drag. On drop,
  // fires `onDragReorderDrop(clientY)` — the host resolves that Y
  // to a track index and dispatches MOVE_TRACK.
  const DRAG_REORDER_THRESHOLD = 6;
  const dragReorderStartRef = React.useRef<{ y: number; active: boolean } | null>(null);
  const justDragReorderedRef = React.useRef(false);
  const [isDragReordering, setIsDragReordering] = React.useState(false);

  const isInteractiveTarget = (el: EventTarget | null): boolean => {
    if (!(el instanceof HTMLElement)) return false;
    return !!el.closest(
      'button, input, select, textarea, [role="slider"], [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]',
    );
  };

  const handleDragReorderMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (!onDragReorderDrop) return;
    if (isInteractiveTarget(e.target)) return;
    dragReorderStartRef.current = { y: e.clientY, active: false };
  };

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const start = dragReorderStartRef.current;
      if (!start) return;
      if (!start.active && Math.abs(e.clientY - start.y) > DRAG_REORDER_THRESHOLD) {
        start.active = true;
        setIsDragReordering(true);
      }
    };
    const onUp = (e: MouseEvent) => {
      const start = dragReorderStartRef.current;
      dragReorderStartRef.current = null;
      if (!start) return;
      if (start.active) {
        setIsDragReordering(false);
        justDragReorderedRef.current = true;
        setTimeout(() => { justDragReorderedRef.current = false; }, 0);
        onDragReorderDrop?.(e.clientY);
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [onDragReorderDrop]);

  const cancelRename = () => {
    setRenameDraft(trackName);
    focusReturnRef.current = true;
    setIsRenaming(false);
  };

  // Calculate volume slider position
  const volumePercent = volume;

  const actualState = state !== 'idle' ? state : (isHovered ? 'hover' : 'idle');

  // Determine track icon: explicit user pick wins, otherwise fall
  // back to the trackType default.
  const getTrackIcon = (): IconName => {
    if (icon) return icon;
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

  // Icon picker flyout state. Anchored to the icon button and dismissed
  // on outside-click / Escape / selection. Curated to a small set of
  // sensible track-role icons rather than the full Icon library so
  // the grid stays scan-able.
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const iconButtonRef = React.useRef<HTMLButtonElement>(null);
  const iconPickerRef = React.useRef<HTMLDivElement>(null);
  const ICON_CHOICES: IconName[] = [
    'microphone',
    'keyboard',
    'midi',
    'label',
    'metronome',
    'mixer',
    'waveform',
    'spectrogram',
    'automation',
    'volume',
    'plug',
    'cog',
  ];
  const ICON_PICKER_COLS = 4;
  // Cursor within the flyout grid — separate from the current
  // committed icon so the user can hover-preview with arrow keys
  // without dispatching an onIconChange until they hit Enter / Space.
  const [iconPickerCursor, setIconPickerCursor] = useState(0);
  const iconPickerItemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  // When the flyout opens, seed the cursor to the currently-active
  // icon (or 0 when there is no match) and move DOM focus onto it
  // so arrow keys work from the first tick.
  React.useEffect(() => {
    if (!iconPickerOpen) return;
    const currentIdx = ICON_CHOICES.findIndex((c) => c === getTrackIcon());
    const startIdx = currentIdx >= 0 ? currentIdx : 0;
    setIconPickerCursor(startIdx);
    // Focus is asynchronous relative to setState — schedule after the
    // paint so the ref has actually been populated for the new item.
    requestAnimationFrame(() => {
      iconPickerItemRefs.current[startIdx]?.focus();
    });
    // Intentionally only re-run when the flyout toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iconPickerOpen]);

  React.useEffect(() => {
    if (!iconPickerOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        iconPickerRef.current?.contains(target)
        || iconButtonRef.current?.contains(target)
      ) return;
      setIconPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIconPickerOpen(false);
        iconButtonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [iconPickerOpen]);

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

    // Slot-based focus model: Pan and Volume are wrapped in focusable
    // "slot" containers. Arrow nav lands on the slot (so the focus ring
    // wraps the whole control); Enter pushes DOM focus into the inner
    // knob/slider, and the inner control handles arrows directly.
    // Escape returns focus to the slot. Disabled in flat-nav mode,
    // where every control is a Tab stop and the inner knob/slider is
    // reached directly without going through the slot.
    if (!isFlatNavigation) {
      const isOnSlot = (currentElement as HTMLElement | null)?.hasAttribute('data-tcp-slot') ?? false;
      const slotAncestor = (currentElement as HTMLElement | null)?.closest('[data-tcp-slot]') as HTMLElement | null;
      const isInsideSlot = slotAncestor !== null && !isOnSlot;

      if (isOnSlot && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const inner = (currentElement as HTMLElement).querySelector('button, input') as HTMLElement | null;
        inner?.focus();
        return;
      }

      if (isInsideSlot) {
        // Inside a control, let arrow keys flow to the control itself.
        // Escape pops focus back out to the slot. Enter does the same
        // — once the user is happy with the value they've dialed in,
        // a confirm gesture should return them to the slot so the
        // panel's arrow nav is usable again. Tab still leaves.
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          slotAncestor?.focus();
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          // Don't navigate siblings; the control's own keydown handles it.
          return;
        }
        // Fall through for Tab / Shift+Tab so user can exit.
      }
    }

    // Handle Enter key for track selection when panel is focused
    if (e.key === 'Enter' && isPanelFocused) {
      e.preventDefault();
      if (e.shiftKey && !e.metaKey && !e.ctrlKey) {
        // Shift+Enter: range-select from anchor to this track
        onRangeSelection?.();
      } else if (e.metaKey || e.ctrlKey) {
        // Cmd/Ctrl+Enter: toggle track in/out of multi-selection
        onToggleSelection?.();
      } else if (state === 'active') {
        // Plain Enter on an already-selected track: deselect it.
        // The panel's state prop is driven from selectedTrackIndices
        // so 'active' === "this track is currently selected".
        // Route through onToggleSelection because that's the only
        // callback that removes a track from selection without
        // touching the rest.
        onToggleSelection?.();
      } else {
        // Plain Enter on an unselected track: exclusively select.
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

    // Tab from the panel itself:
    //   • Shift+Tab → step out to the track container (existing
    //     behaviour, driven by onShiftTabOut).
    //   • Tab → step INTO the panel, landing on the icon button
    //     first (the track-icon flyout trigger). From there the
    //     browser walks the rest of the header controls naturally.
    // Skipped in flat-nav mode: every child has its own Tab stop
    // and we let the browser walk through them.
    if (!isFlatNavigation && e.key === 'Tab' && isPanelFocused) {
      if (e.shiftKey) {
        e.preventDefault();
        onShiftTabOut?.();
        return;
      }
      // Forward Tab: focus the icon button so the user lands on the
      // track-icon flyout trigger as the first internal stop.
      if (iconButtonRef.current) {
        e.preventDefault();
        // Clear the mouse-focus flag before landing on the icon,
        // otherwise the next Tab hits the "reveal outline" branch
        // above (which blurs + re-focuses to trigger :focus-visible)
        // and swallows the navigation — forcing the user to press
        // Tab a second time to actually move past the icon.
        focusFromMouseRef.current = false;
        iconButtonRef.current.focus();
        return;
      }
    }

    // Handle Tab key from a child — navigate out to clips. In flat-nav
    // mode, Tab is the navigation primitive between every focusable
    // control, so the panel must NOT intercept it here; otherwise the
    // browser never reaches the rest of the controls in the header.
    if (!isFlatNavigation && e.key === 'Tab' && !e.shiftKey && !isPanelFocused) {
      e.preventDefault();
      onTabOut?.();
      return;
    }

    // Handle Shift+Tab to return focus to the track container
    if (!isFlatNavigation && e.key === 'Tab' && e.shiftKey && !isPanelFocused) {
      e.preventDefault();
      onShiftTabOut?.();
      return;
    }

    // Arrow keys on the panel itself or on a child with invisible focus — navigate between tracks
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && (isPanelFocused || focusFromMouseRef.current)) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        // Cmd/Ctrl+Arrow reorders THIS track's row instead of just
        // moving focus. Matches the canvas track container's
        // reorder shortcut so the gesture is available from either
        // side of the app.
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && onReorderVertical) {
          e.stopPropagation();
          onReorderVertical(e.key === 'ArrowUp' ? 'up' : 'down');
          return;
        }
        onNavigateVertical?.(e.key === 'ArrowUp' ? 'up' : 'down', e.shiftKey);
      }
      // ArrowLeft/Right with invisible focus: do nothing (don't cycle children)
      return;
    }

    // Only handle arrow keys for navigation
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') {
      return;
    }

    // Flat-nav mode: Tab is the navigation primitive, so don't steal
    // arrow keys for sibling navigation — the focused control gets to
    // handle them (e.g. Knob's value adjustment).
    if (isFlatNavigation) {
      return;
    }

    // Handle arrow keys for internal navigation (all four directions)
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      return;
    }

    // Find all focusable navigation targets within the panel. Slots
    // (Pan / Volume wrappers) are first-class targets; ordinary
    // buttons/inputs are too — but only when NOT inside a slot, since
    // those inner controls are reached via Enter on the slot.
    const allCandidates = panelElement.querySelectorAll(
      '[data-tcp-slot], button, input, .track-control-panel__track-name-text, [tabindex]:not([tabindex="-1"])'
    );
    const focusableElements = Array.from(allCandidates).filter((el) => {
      if (el.hasAttribute('data-tcp-slot')) return true;
      return el.closest('[data-tcp-slot]') === null;
    });

    if (focusableElements.length === 0) return;

    const currentIndex = focusableElements.indexOf(currentElement as HTMLElement);
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
    // A drag-reorder that just committed synthesises a click on the
    // panel — suppress it so the header isn't also treated as a
    // "select this track" click.
    if (justDragReorderedRef.current) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    // Shift+Click: Range selection (select all tracks between last selected and clicked)
    if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      onRangeSelection?.();
      return;
    }
    // Cmd/Ctrl+Click: Toggle individual track in/out of selection
    // (non-contiguous multi-select). Side panel only — the canvas
    // background reserves Cmd for grab-to-pan.
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
      onMouseDown={(e) => {
        focusFromMouseRef.current = true;
        handleDragReorderMouseDown(e);
      }}
      style={
        isDragReordering
          ? { ...style, opacity: 0.7, cursor: 'grabbing' }
          : style
      }
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
      tabIndex={tabIndex}
      role={tabIndex !== undefined ? "group" : undefined}
      aria-label={tabIndex !== undefined ? `${trackName} track controls` : undefined}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <div className="track-control-panel__main">
        {/* Header */}
        <div className="track-control-panel__header">
          <div className="track-control-panel__track-name">
            <span style={{ position: 'relative' }}>
            <button
              ref={iconButtonRef}
              className="track-control-panel__icon-button"
              aria-label={onIconChange ? `Change ${trackName} icon` : `${trackName} track type`}
              aria-haspopup={onIconChange ? 'menu' : undefined}
              aria-expanded={onIconChange ? iconPickerOpen : undefined}
              tabIndex={childTabIndex}
              onClick={(e) => {
                if (!onIconChange) return;
                e.stopPropagation();
                setIconPickerOpen((v) => !v);
              }}
            >
              <Icon name={getTrackIcon()} size={16} className="track-control-panel__icon" />
            </button>
            {onIconChange && iconPickerOpen && (
              <div
                ref={iconPickerRef}
                role="menu"
                aria-label="Choose track icon"
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 4,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 28px)',
                  gap: 4,
                  padding: 8,
                  background: theme.background.surface.elevated,
                  border: `1px solid ${theme.border.default}`,
                  borderRadius: 6,
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                  zIndex: 500,
                }}
              >
                {ICON_CHOICES.map((choice, idx) => {
                  const active = getTrackIcon() === choice;
                  const focused = iconPickerCursor === idx;
                  const moveCursor = (nextIdx: number) => {
                    const clamped = Math.max(0, Math.min(ICON_CHOICES.length - 1, nextIdx));
                    setIconPickerCursor(clamped);
                    iconPickerItemRefs.current[clamped]?.focus();
                  };
                  return (
                    <button
                      key={choice}
                      ref={(el) => { iconPickerItemRefs.current[idx] = el; }}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      aria-label={choice}
                      // Roving tabindex: only the cursor row is in the
                      // tab sequence so Shift+Tab out of the flyout
                      // lands back on the trigger cleanly.
                      tabIndex={focused ? 0 : -1}
                      onClick={(e) => {
                        e.stopPropagation();
                        onIconChange(choice);
                        setIconPickerOpen(false);
                        iconButtonRef.current?.focus();
                      }}
                      onKeyDown={(e) => {
                        // Grid navigation. Left/Right wrap within the
                        // list; Up/Down clamp so pressing Down on the
                        // last row stays put rather than jumping to
                        // the first row of a different column.
                        if (e.key === 'ArrowRight') {
                          e.preventDefault();
                          e.stopPropagation();
                          const next = idx + 1 >= ICON_CHOICES.length ? 0 : idx + 1;
                          moveCursor(next);
                          return;
                        }
                        if (e.key === 'ArrowLeft') {
                          e.preventDefault();
                          e.stopPropagation();
                          const next = idx - 1 < 0 ? ICON_CHOICES.length - 1 : idx - 1;
                          moveCursor(next);
                          return;
                        }
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          e.stopPropagation();
                          moveCursor(idx + ICON_PICKER_COLS);
                          return;
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          e.stopPropagation();
                          moveCursor(idx - ICON_PICKER_COLS);
                          return;
                        }
                        if (e.key === 'Home') {
                          e.preventDefault();
                          e.stopPropagation();
                          moveCursor(0);
                          return;
                        }
                        if (e.key === 'End') {
                          e.preventDefault();
                          e.stopPropagation();
                          moveCursor(ICON_CHOICES.length - 1);
                          return;
                        }
                        // Enter / Space activation is handled by
                        // native button semantics — the click handler
                        // above commits the pick.
                      }}
                      style={{
                        width: 28,
                        height: 28,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: active ? theme.background.surface.hover : 'transparent',
                        border: active
                          ? `1px solid ${theme.border.focus}`
                          : `1px solid transparent`,
                        borderRadius: 4,
                        color: theme.foreground.text.primary,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      <Icon name={choice} size={16} />
                    </button>
                  );
                })}
              </div>
            )}
            </span>
            {isRenaming ? (
              <input
                ref={renameInputRef}
                className="track-control-panel__track-name-input"
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
                aria-label="Track name"
              />
            ) : (
              <span
                ref={nameSpanRef}
                className="track-control-panel__track-name-text"
                tabIndex={childTabIndex}
                role="button"
                aria-label={`Rename track: ${trackName}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'F2') {
                    e.preventDefault();
                    e.stopPropagation();
                    startRename();
                  }
                }}
                onDoubleClick={() => startRename()}
              >
                {trackName}
              </span>
            )}
          </div>

          <div className="track-control-panel__header-right">
            {/* Small add label button for label tracks < 76px */}
            {showLabelHeaderButton && (
              <ToggleButton
                active={false}
                onClick={onAddLabelClick}
                ariaLabel="Add label"
                tabIndex={childTabIndex}
              >
                <Icon name="plus" size={16} />
              </ToggleButton>
            )}

            {/* Mute and Solo buttons in header for audio tracks <= 70px */}
            {!isLabelTrack && trackHeight && trackHeight <= 70 && (
              <div
                className="track-control-panel__button-group"
                onClick={(e) => e.stopPropagation()}
              >
                <ToggleButton
                  active={isMuted}
                  onClick={onMuteToggle}
                  ariaLabel="Mute"
                  tabIndex={childTabIndex}
                  size={20}
                >
                  M
                </ToggleButton>
                <ToggleButton
                  active={isSolo}
                  onClick={onSoloToggle}
                  ariaLabel="Solo"
                  tabIndex={childTabIndex}
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
              tabIndex={childTabIndex}
            />
          </div>
        </div>

        {/* Controls Row - Hidden for label tracks and when audio track height <= 70px */}
        {!isLabelTrack && (!trackHeight || trackHeight > 70) && (
          <div className="track-control-panel__controls-row">
            {/* Pan Knob — wrapped in a focusable slot so the outline
                sits around the whole control; Enter on the slot
                pushes focus into the knob itself. */}
            <div
              className="track-control-panel__slot track-control-panel__slot--pan"
              data-tcp-slot="pan"
              tabIndex={-1}
              role="group"
              aria-label="Pan"
            >
              <PanKnob
                value={pan}
                onChange={onPanChange}
                tabIndex={childTabIndex}
              />
            </div>

            {/* Volume Slider — slot wrapper gives the slider a
                container-level focus ring. */}
            <div
              className="track-control-panel__slot track-control-panel__slot--volume"
              data-tcp-slot="volume"
              tabIndex={-1}
              role="group"
              aria-label="Volume"
            >
              <Slider
                value={volume}
                onChange={onVolumeChange}
                ariaLabel="Volume"
                tabIndex={childTabIndex}
              />
            </div>

            {/* Mute and Solo Buttons */}
            <div
              className="track-control-panel__button-group"
              onClick={(e) => e.stopPropagation()}
            >
              <ToggleButton
                active={isMuted}
                onClick={onMuteToggle}
                ariaLabel="Mute"
                tabIndex={childTabIndex}
                size={20}
              >
                M
              </ToggleButton>
              <ToggleButton
                active={isSolo}
                onClick={onSoloToggle}
                ariaLabel="Solo"
                tabIndex={childTabIndex}
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
                tabIndex={childTabIndex}
              >
                Effects
              </Button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Dropdown
                  options={instruments!.map(i => ({ label: i.label, value: i.id }))}
                  value={instrument ?? instruments![0].id}
                  onChange={(val) => onInstrumentChange?.(val)}
                  width="100%"
                  tabIndex={childTabIndex}
                />
              </div>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="small"
              onClick={isLabelTrack ? onAddLabelClick : onEffectsClick}
              showIcon={false}
              tabIndex={childTabIndex}
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
