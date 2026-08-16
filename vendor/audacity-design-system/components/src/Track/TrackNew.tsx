import React from 'react';
import type { MidiNote } from '@audacity-ui/core';
import { Clip } from '../Clip/Clip';
import type { SpectrogramScale } from '../ClipBody/ClipBody';
import { EnvelopeInteractionLayer } from '../EnvelopeInteractionLayer/EnvelopeInteractionLayer';
import { generateSpeechWaveform } from '../utils/waveform';
import { CLIP_CONTENT_OFFSET } from '../constants';
import { useContainerTabGroup } from '../hooks/useContainerTabGroup';
import { useAccessibilityProfile } from '../contexts/AccessibilityProfileContext';
import { getInputMode } from '../utils/inputMode';
import { scrollIntoViewIfNeeded } from '../utils/scrollIntoViewIfNeeded';
import { useTheme } from '../ThemeProvider/ThemeProvider';
import { formatTimeForA11y } from '../utils/announce';
import './Track.css';

const EMPTY_NUMBER_ARRAY: number[] = [];

export interface TrackClip {
  id: string | number;
  name: string;
  start: number;
  duration: number;
  selected?: boolean;
  waveform?: number[];
  waveformRms?: number[];
  waveformLeft?: number[];
  waveformRight?: number[];
  waveformLeftRms?: number[];
  waveformRightRms?: number[];
  envelopePoints?: Array<{ time: number; db: number }>;
  midiNotes?: MidiNote[];
}

export interface TrackProps {
  /**
   * Array of clips to display on this track
   */
  clips: TrackClip[];

  /**
   * Height of the track in pixels
   * @default 114
   */
  height?: number;

  /**
   * Track index (0-based, determines color scheme)
   * - 0 = Blue
   * - 1 = Violet
   * - 2 = Magenta
   * - Cycles through colors for higher indices
   */
  trackIndex: number;

  /**
   * Whether to show spectrogram view
   * @default false
   */
  spectrogramMode?: boolean;

  /**
   * Whether to show split view (spectrogram + waveform)
   * @default false
   */
  splitView?: boolean;

  /**
   * Whether envelope mode is active
   * @default false
   */
  envelopeMode?: boolean;

  /**
   * Whether the track is selected
   */
  isSelected?: boolean;

  /**
   * Whether the track has focus
   */
  isFocused?: boolean;

  /**
   * Whether the track is muted
   */
  isMuted?: boolean;

  /**
   * Whether this is a label track (hides clip header recess)
   * @default false
   */
  isLabelTrack?: boolean;

  /**
   * Whether this is a MIDI track (shows compact note preview instead of waveform)
   * @default false
   */
  isMidiTrack?: boolean;

  /**
   * Pixels per second (zoom level)
   * @default 100
   */
  pixelsPerSecond?: number;

  /**
   * Width of the track in pixels
   */
  width: number;

  /**
   * Background color for track
   * @default 'rgba(255,255,255,0.05)'
   */
  backgroundColor?: string;

  /**
   * Callback when a clip is clicked
   */
  onClipClick?: (clipId: string | number, shiftKey?: boolean, metaKey?: boolean) => void;
  /** Callback when the user commits a clip rename inline. */
  onClipRename?: (clipId: string | number, newName: string) => void;

  /**
   * Callback when track background is clicked
   */
  onTrackClick?: (event: React.MouseEvent) => void;

  /**
   * Callback when envelope points change
   */
  onEnvelopePointsChange?: (clipId: string | number, points: Array<{ time: number; db: number }>) => void;

  /**
   * Callback when a clip header is clicked
   */
  onClipHeaderClick?: (clipId: string | number, clipStartTime: number) => void;

  /**
   * Callback when a clip menu button is clicked
   */
  onClipMenuClick?: (clipId: string | number, x: number, y: number, openedViaKeyboard?: boolean) => void;

  /**
   * Callback when a clip edge is being trimmed
   */
  onClipTrimEdge?: (clipId: string | number, edge: 'left' | 'right', clientX: number) => void;
  /** Visual time-stretch handles. Mirrors onClipTrimEdge — Canvas hooks this
   *  up to a stretch handler that updates duration + stretchFactor. */
  onClipStretchEdge?: (clipId: string | number, edge: 'left' | 'right', clientX: number) => void;

  /**
   * Tab index for keyboard navigation
   */
  tabIndex?: number;

  /**
   * Callback when keyboard focus changes
   */
  onFocusChange?: (hasFocus: boolean) => void;

  /**
   * Callback when a clip should be moved (Cmd+Arrow keys)
   */
  onClipMove?: (clipId: string | number, deltaSeconds: number) => void;

  /**
   * Callback when a clip should be trimmed (Shift+Arrow keys)
   */
  onClipTrim?: (clipId: string | number, edge: 'left' | 'right', deltaSeconds: number) => void;

  /**
   * Callback when a clip should be time-stretched via the keyboard
   * (Alt+ArrowLeft / Alt+ArrowRight). Positive `deltaSeconds` extends the
   * right edge to the right, negative shortens it. Mirrors `onClipTrim`'s
   * shape so wiring in Canvas can be parallel.
   */
  onClipStretch?: (clipId: string | number, edge: 'left' | 'right', deltaSeconds: number) => void;

  /**
   * Callback when a clip should be moved to a different track (Cmd+Arrow Up/Down)
   */
  onClipMoveToTrack?: (clipId: string | number, direction: 1 | -1) => void;

  /**
   * Callback when navigating vertically between tracks (Arrow Up/Down without modifiers)
   */
  onClipNavigateVertical?: (clipId: string | number, direction: 1 | -1) => void;

  /**
   * Time selection range (for rendering vibrant clip colors within selection)
   */
  timeSelection?: { startTime: number; endTime: number; tracks?: number[]; renderOnCanvas?: boolean } | null;

  /**
   * Whether time selection is currently being dragged
   */
  isTimeSelectionDragging?: boolean;

  /**
   * Clip style preference ('classic' or 'colourful')
   */
  clipStyle?: 'classic' | 'colourful';

  /**
   * Explicit track color — overrides the default trackIndex-based color cycle.
   * Assigned at track creation time so color persists across reorder.
   */
  color?: string;

  /**
   * ID of the clip currently being recorded (to show recording state)
   */
  recordingClipId?: string | number | null;

  /**
   * Envelope control point sizes (for MuseScore vs AU4 style)
   */
  envelopePointSizes?: {
    outerRadius: number;
    innerRadius: number;
    outerRadiusHover: number;
    innerRadiusHover: number;
    dualStrokeLine?: boolean;
    [key: string]: unknown;
  };

  /**
   * Split view ratio (0-1, where 0.5 is center)
   * Controls the position of the divider between spectrogram (top) and waveform (bottom)
   * @default 0.5
   */
  channelSplitRatio?: number;

  /**
   * Callback when split view ratio changes (user drags divider)
   */
  onChannelSplitRatioChange?: (ratio: number) => void;

  /**
   * Frequency scale for spectrogram rendering
   * @default 'mel'
   */
  spectrogramScale?: SpectrogramScale;

  /**
   * Tab index for the track container div (the .track element)
   * When set, the container becomes a tab stop before the panel and clips.
   */
  trackTabIndex?: number;

  /**
   * Human-readable name of the track, surfaced to screen readers when
   * the track container itself receives focus. Without it VoiceOver
   * falls back to reading every child clip's label, which is noisy.
   */
  trackName?: string;

  /**
   * Callback when ArrowUp/Down is pressed while the track container itself is focused.
   * Direction: 1 = down, -1 = up.
   */
  /** Vertical arrow nav between tracks.
   *  - direction: -1 (up) or 1 (down)
   *  - shiftKey: extend the range selection
   *  - decouple: hold Cmd/Ctrl — focus moves but selection is left
   *    alone (peek) in follows-focus mode. */
  onTrackNavigateVertical?: (direction: 1 | -1, shiftKey?: boolean, decouple?: boolean) => void;

  /**
   * Callback when Cmd+ArrowUp/Down is pressed on the track container to reorder the track.
   * Direction: 1 = move down, -1 = move up. The `wasContainerFocused`
   * flag tells the host whether the .track div was in the keyboard
   * (black/white) focus mode at the time of the reorder — the host
   * uses it to decide whether to carry that mode over to the new
   * track position.
   */
  onTrackReorder?: (direction: 1 | -1, wasContainerFocused: boolean) => void;

  /**
   * Callback when the track container itself gains or loses keyboard focus.
   * Fires true only when the .track div itself is focused, not child clips.
   */
  onContainerFocusChange?: (hasFocus: boolean) => void;

  /**
   * Callback when Tab is pressed on the track container to enter the panel controls.
   */
  onEnterPanel?: () => void;

  /**
   * Callback when Shift+Tab is pressed on the track container to go to the previous track.
   */
  onShiftTabOut?: () => void;

  /**
   * Callback when Enter is pressed on the track container itself.
   */
  onContainerEnter?: (modifiers: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => void;

  /**
   * Callback when Tab is pressed on the last clip.
   * Used to navigate to the ruler (or next track) when the ruler is in a separate DOM tree.
   */
  onTabFromLastClip?: () => void;

  /**
   * ID of the clip currently being hovered (for cross-component highlight, e.g. piano roll ↔ canvas)
   */
  hoveredClipId?: number | null;

  /**
   * Called when mouse enters/leaves a clip
   */
  onHoverClip?: (clipId: number | null) => void;

  /**
   * Set of clip ids currently being dragged. Drawn at reduced opacity and elevated z-index.
   */
  draggingClipIds?: ReadonlySet<number>;
  /**
   * Set of clip ids that should render on top of siblings without
   * the mouse-drag ghost opacity. Used by keyboard clip nudges
   * (Cmd+Arrow) so the moving clip sits solidly over anything it
   * passes over during the hold, then settles once Cmd is released.
   */
  raisedClipIds?: ReadonlySet<number>;

}

// Map track index to color
const TRACK_COLORS = ['blue', 'violet', 'magenta', 'teal', 'cyan', 'green', 'orange', 'red', 'yellow'] as const;
function getTrackColor(trackIndex: number, clipStyle: 'classic' | 'colourful' = 'colourful') {
  if (clipStyle === 'classic') {
    return 'classic' as const;
  }
  return TRACK_COLORS[trackIndex % TRACK_COLORS.length];
}

/**
 * Track component - renders a single audio track with clips using Clip components
 */
const TrackNewComponent: React.FC<TrackProps> = ({
  clips,
  height = 114,
  trackIndex,
  spectrogramMode = false,
  splitView = false,
  envelopeMode = false,
  isSelected = false,
  isFocused = false,
  isMuted = false,
  isLabelTrack = false,
  isMidiTrack = false,
  pixelsPerSecond = 100,
  width,
  backgroundColor = 'rgba(255,255,255,0.05)',
  onClipClick,
  onClipRename,
  onTrackClick,
  onEnvelopePointsChange,
  onClipHeaderClick,
  onClipMenuClick,
  onClipTrimEdge,
  onClipStretchEdge,
  tabIndex,
  onFocusChange,
  onClipMove,
  onClipTrim,
  onClipStretch,
  onClipMoveToTrack,
  onClipNavigateVertical,
  timeSelection,
  isTimeSelectionDragging = false,
  clipStyle = 'colourful',
  color,
  recordingClipId = null,
  envelopePointSizes,
  channelSplitRatio = 0.5,
  onChannelSplitRatioChange,
  spectrogramScale,
  trackTabIndex,
  trackName,
  onTrackNavigateVertical,
  onTrackReorder,
  onContainerFocusChange,
  onEnterPanel,
  onShiftTabOut,
  onContainerEnter,
  onTabFromLastClip,
  hoveredClipId,
  onHoverClip,
  draggingClipIds,
  raisedClipIds,
}) => {
  const { theme } = useTheme();
  const trackColor = color && clipStyle !== 'classic' ? color as typeof TRACK_COLORS[number] : getTrackColor(trackIndex, clipStyle);
  // Scope for the time-selection band. When the selection carries its
  // own tracks list (populated by the creating gesture), highlight
  // only those rows — independent of the broader track selection.
  // Falls back to the legacy isSelected-driven look for scopeless
  // selections.
  const inTimeSelectionScope = timeSelection?.tracks
    ? timeSelection.tracks.includes(trackIndex)
    : isSelected;
  const [clipHiddenPoints, setClipHiddenPoints] = React.useState<Map<string | number, number[]>>(new Map());
  const [clipHoveredPoints, setClipHoveredPoints] = React.useState<Map<string | number, number[]>>(new Map());
  const [clipCursorPositions, setClipCursorPositions] = React.useState<Map<string | number, { time: number; db: number } | null>>(new Map());
  const [hasKeyboardFocus, setHasKeyboardFocus] = React.useState(false);
  const [isContainerFocused, setIsContainerFocused] = React.useState(false);
  const [isDraggingDivider, setIsDraggingDivider] = React.useState(false);
  const [dividerHover, setDividerHover] = React.useState(false);
  // Which clip (if any) should render the source-boundary shake bar,
  // and on which edge. Each trigger increments `token` so the shake
  // element remounts even when the same edge is retriggered before
  // the animation completes.
  const [shakeState, setShakeState] = React.useState<{ clipId: string | number; edge: 'left' | 'right'; token: number } | null>(null);
  const shakeTimeoutRef = React.useRef<number | null>(null);
  const trackRef = React.useRef<HTMLDivElement>(null);
  const focusFromMouseRef = React.useRef(false);
  const trackClickXRef = React.useRef<number | null>(null);
  const clipFocusFromMouseRef = React.useRef(false);
  const mouseDownPosRef = React.useRef<{ x: number; y: number } | null>(null);

  // Flat-navigation mode opts every clip into the Tab order so a
  // screen-reader or sequential keyboard user can reach each one,
  // rather than roving with arrow keys from a single Tab stop.
  const { activeProfile } = useAccessibilityProfile();
  const isFlatNavigation = activeProfile.config.tabNavigation === 'sequential';

  // Container-level roving tabindex for clip navigation (ArrowLeft/Right)
  const { onKeyDown: clipNavKeyDown, onBlur: clipNavBlur, onClickCapture: clipNavClickCapture, initTabIndices: initClipTabIndices } = useContainerTabGroup({
    containerRef: trackRef,
    groupId: `track-${trackIndex}-clips`,
    selector: '[role="button"]',
    startTabIndex: tabIndex,
  });

  // Re-init clip tab indices when clips change
  React.useEffect(() => {
    initClipTabIndices();
  }, [clips, initClipTabIndices]);

  // Handle divider drag
  React.useEffect(() => {
    if (!isDraggingDivider || !onChannelSplitRatioChange) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!trackRef.current) return;

      const rect = trackRef.current.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;

      // Calculate ratio within clip body (excluding 20px header)
      const CLIP_HEADER_HEIGHT = 20;
      const clipBodyHeight = height - CLIP_HEADER_HEIGHT;
      const yInBody = mouseY - CLIP_HEADER_HEIGHT;

      // Calculate min/max ratio based on 16px minimum height for each section
      const MIN_SECTION_HEIGHT = 16;
      const minRatio = MIN_SECTION_HEIGHT / clipBodyHeight;
      const maxRatio = 1 - (MIN_SECTION_HEIGHT / clipBodyHeight);

      // Constrain ratio to ensure both sections are at least 16px
      const newRatio = Math.max(minRatio, Math.min(maxRatio, yInBody / clipBodyHeight));

      onChannelSplitRatioChange(newRatio);
    };

    const handleMouseUp = () => {
      setIsDraggingDivider(false);
      document.body.style.cursor = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingDivider, onChannelSplitRatioChange, height]);

  // Use theme tokens (semi-transparent so grid lines show through)
  const getTrackBackgroundColor = () => isSelected ? theme.background.canvas.track.selected : theme.background.canvas.track.idle;

  // Sort clips by start time so tab order follows timeline position
  const sortedClips = React.useMemo(
    () => [...clips].sort((a, b) => a.start - b.start),
    [clips],
  );

  // Calculate clip dimensions and positions
  const renderClips = () => {
    return sortedClips.map((clip, clipIndex) => {
      const clipX = CLIP_CONTENT_OFFSET + clip.start * pixelsPerSecond;
      const clipWidth = clip.duration * pixelsPerSecond;
      const isFirstClip = clipIndex === 0;

      // Generate waveform if not provided
      // IMPORTANT: For trimmed clips, calculate full duration from trimStart + duration
      let waveformData = clip.waveform;
      let waveformLeft = clip.waveformLeft;
      let waveformRight = clip.waveformRight;

      const isStereo = Boolean(clip.waveformLeft || clip.waveformRight);

      // Use stored fullDuration if available (set by split cut), otherwise calculate it
      const trimStart = (clip as any).trimStart || 0; // justified: trimStart not on Clip type — pending components sweep
      const fullDuration = (clip as any).fullDuration || (trimStart + clip.duration); // justified: fullDuration not on Clip type — pending components sweep

      if (!waveformData && !isStereo) {
        // Generate mono waveform using FULL duration
        waveformData = generateSpeechWaveform(fullDuration, 1800);
      }

      if (isStereo && (!waveformLeft || !waveformRight)) {
        // Generate stereo waveforms using FULL duration
        waveformLeft = generateSpeechWaveform(fullDuration, 1800);
        waveformRight = generateSpeechWaveform(fullDuration, 1800);
      }

      // Determine variant and channel mode
      let variant: 'waveform' | 'spectrogram' | 'midi' = 'waveform';
      let channelMode: 'mono' | 'stereo' | 'split-mono' | 'split-stereo' = 'mono';

      if (isMidiTrack && clip.midiNotes) {
        variant = 'midi';
      } else if (splitView) {
        channelMode = isStereo ? 'split-stereo' : 'split-mono';
        variant = 'spectrogram';
      } else if (spectrogramMode) {
        channelMode = isStereo ? 'stereo' : 'mono';
        variant = 'spectrogram';
      } else {
        channelMode = isStereo ? 'stereo' : 'mono';
        variant = 'waveform';
      }

      const clipSelected = (clip as any).selected || false; // justified: selected not on Clip type — pending components sweep
      const isClipHovered = hoveredClipId != null && clip.id === hoveredClipId;
      const isDragging = draggingClipIds?.has(clip.id as number) ?? false;
      const isRaised = raisedClipIds?.has(clip.id as number) ?? false;

      return (
        <div
          key={clip.id}
          data-clip-id={clip.id}
          data-track-index={trackIndex}
          data-first-clip={isFirstClip}
          style={{
            position: 'absolute',
            // Round to integer pixels so the wrapper's accessibility
            // rect (which macOS VoiceOver uses to draw the focus frame)
            // doesn't drift sub-pixel against the painted clip — the
            // browser paints at pixel boundaries and AX uses the layout
            // rect, and any sub-pixel mismatch showed up as a focus
            // ring offset from the visible clip.
            left: `${Math.round(clipX)}px`,
            top: 0,
            // Explicit width/height so the focusable wrapper's bounding
            // box matches the visible Clip child. Without these the
            // wrapper can collapse and VoiceOver draws the frame around
            // a near-zero rect.
            width: `${Math.round(clipWidth)}px`,
            height: `${height}px`,
            // Dragged and Cmd+Arrow-raised clips float above siblings
            // (mouse drag also dims to a 50% ghost; keyboard raise
            // stays solid so the moving clip reads as "still there").
            zIndex: isDragging || isRaised ? 10 : 2,
            opacity: isDragging ? 0.5 : undefined,
          }}
          tabIndex={isFlatNavigation ? 0 : (isFirstClip && tabIndex !== undefined ? tabIndex : -1)}
          role="button"
          aria-label={`${clip.name} clip, starts at ${formatTimeForA11y(clip.start)}, ${formatTimeForA11y(clip.duration)} long`}
          onMouseEnter={() => onHoverClip?.(clip.id as number)}
          onMouseLeave={() => onHoverClip?.(null)}
          onMouseDown={(e) => {
            // Clip receives DOM focus naturally via its tabIndex.
            // Mark as mouse-focused so CSS suppresses the outline (data-focus-mouse attr).
            // Do NOT stopPropagation — Canvas.tsx needs mouseDown to bubble for clip dragging.
            clipFocusFromMouseRef.current = true;
            mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
            (e.currentTarget as HTMLElement).setAttribute('data-focus-mouse', '');
          }}
          onClick={(e) => {
            // The clip body is a pass-through for time-selection / pan
            // gestures — modifier-clicks intentionally do not register
            // as clip selection here. Header clicks (handled by
            // ClipHeader's onClick, which stops propagation) are the
            // only path to plain / shift+range / cmd+toggle selection.
            // We still consume mouseDownPosRef so a body drag doesn't
            // leave stale state for the next click.
            mouseDownPosRef.current = null;
            void e;
          }}
          onFocus={(e) => {
            if (clipFocusFromMouseRef.current) {
              // Mouse-driven focus: don't scroll, keep data-focus-mouse attr for CSS
              clipFocusFromMouseRef.current = false;
              return;
            }
            // Keyboard-driven focus: clear mouse attr so outline shows, and scroll into view
            (e.currentTarget as HTMLElement).removeAttribute('data-focus-mouse');
            scrollIntoViewIfNeeded(e.currentTarget as HTMLElement);
          }}
          onKeyDown={(e) => {
            // If focus is invisible (mouse click), first Tab/Shift+Tab reveals the outline
            if (e.key === 'Tab' && (e.currentTarget as HTMLElement).hasAttribute('data-focus-mouse')) {
              e.preventDefault();
              (e.currentTarget as HTMLElement).removeAttribute('data-focus-mouse');
              return;
            }

            // Escape on a clip is handled by the global keyboard
            // shortcut (useKeyboardShortcuts) so the priority chain —
            // split mode > clear selections > unwind focus — works
            // consistently from any focused element. The first Esc
            // clears the clip / time selection; the next moves focus
            // up to the track container; another blurs.
            // (Previously this branch shortcut-focused the track
            // container and stopped propagation, which silently ate
            // the selection-clearing step.)

            // Delete key: let it bubble to App.tsx handler, but DON'T stop propagation
            // The App.tsx handler will read data-clip-id and data-track-index from this element
            if (e.key === 'Delete' || e.key === 'Backspace') {
              // Don't preventDefault or stopPropagation - let it reach App.tsx
              return;
            }

            // Handle selection with Enter key
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              // Pass actual modifier keys to support different selection modes:
              // - Plain Enter: toggle selection (deselect if single clip selected)
              // - Shift+Enter: range selection
              // - Cmd/Ctrl+Enter: toggle in/out of multi-selection
              onClipClick?.(clip.id, e.shiftKey, e.metaKey || e.ctrlKey);
              return;
            }

            // Open context menu with Shift+F10 or ContextMenu key (standard keyboard shortcuts)
            if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
              e.preventDefault();
              e.stopPropagation();
              // Calculate position of clip header for menu placement
              const clipElement = e.currentTarget as HTMLElement;
              const rect = clipElement.getBoundingClientRect();
              // Open menu at top-right corner of clip (where menu button is)
              onClipMenuClick?.(clip.id, rect.right - 20, rect.top + 10, true);
              return;
            }

            // Move clip horizontally with Cmd+Arrow Left/Right.
            // Alt acts as the speed modifier — same convention as the
            // playhead nudge: plain = 0.1s, Alt = 1s.
            if ((e.metaKey || e.ctrlKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey) {
              e.preventDefault();
              const moveAmount = e.altKey ? 1.0 : 0.1;
              const delta = e.key === 'ArrowRight' ? moveAmount : -moveAmount;
              onClipMove?.(clip.id, delta);
              return;
            }

            // Move clip to different track with Cmd+Arrow Up/Down
            if ((e.metaKey || e.ctrlKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey) {
              e.preventDefault();
              const direction = e.key === 'ArrowDown' ? 1 : -1;
              onClipMoveToTrack?.(clip.id, direction);
              return;
            }

            // Time-stretch with Alt layered onto the trim shortcuts. Alt is
            // the "stretch instead of trim" modifier; otherwise the combo
            // matches the trim shortcuts exactly so direction semantics are
            // identical:
            //   Alt+Shift+ArrowLeft        → left edge moves left   (lengthen)
            //   Alt+Shift+ArrowRight       → right edge moves right (lengthen)
            //   Cmd+Alt+Shift+ArrowLeft    → right edge moves left  (shorten)
            //   Cmd+Alt+Shift+ArrowRight   → left edge moves right  (shorten)
            // Sign convention matches onClipTrim: positive delta shrinks,
            // negative delta grows.
            if (e.altKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
              e.preventDefault();
              const stretchAmount = 0.1;
              const isCompressing = e.metaKey || e.ctrlKey;
              const edge = isCompressing
                ? (e.key === 'ArrowLeft' ? 'right' : 'left')
                : (e.key === 'ArrowLeft' ? 'left' : 'right');
              const delta = isCompressing ? stretchAmount : -stretchAmount;
              onClipStretch?.(clip.id, edge, delta);
              return;
            }

            // LOCAL DEVIATION (see ../../../README.md): 0.10.1 moved clip-edge
            // trimming from Shift+Arrow onto the bracket keys below. The
            // application routes the Shift+Arrow chords through its own
            // frame-canonical trim path and documents them as the clip-focus
            // trim shortcut, so they are kept here alongside the new brackets
            // rather than replaced by them.
            if (e.shiftKey && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
              e.preventDefault();
              const trimAmount = 0.1; // Trim by 0.1 seconds
              const isTrimming = e.metaKey || e.ctrlKey;
              // For expand (Shift only): ArrowLeft → left, ArrowRight → right
              // For trim (Cmd+Shift): ArrowLeft → right, ArrowRight → left
              const edge = isTrimming
                ? (e.key === 'ArrowLeft' ? 'right' : 'left')
                : (e.key === 'ArrowLeft' ? 'left' : 'right');
              const delta = isTrimming ? trimAmount : -trimAmount; // Negative delta = expand
              onClipTrim?.(clip.id, edge, delta);
              return;
            }

            // Clip-edge editor on the bracket keys. Shift picks the
            // edge; the specific bracket picks the direction:
            //   [        → RIGHT edge moves LEFT   (contract)
            //   ]        → RIGHT edge moves RIGHT  (extend)
            //   Shift+[  → LEFT edge moves LEFT    (extend)
            //   Shift+]  → LEFT edge moves RIGHT   (contract)
            // Sign convention matches onClipTrim: positive delta
            // shrinks, negative delta grows.
            //
            // Match against e.code, e.key, AND e.keyCode so keyboard
            // layout quirks don't stop the shortcut from firing.
            const isBracketLeft = e.code === 'BracketLeft'
              || e.key === '[' || e.key === '{'
              || (e as any).keyCode === 219; // justified: keyCode deprecated but needed for cross-layout compat — pending components sweep
            const isBracketRight = e.code === 'BracketRight'
              || e.key === ']' || e.key === '}'
              || (e as any).keyCode === 221; // justified: keyCode deprecated but needed for cross-layout compat — pending components sweep
            if ((isBracketLeft || isBracketRight) && !e.altKey) {
              e.preventDefault();
              e.stopPropagation();
              const editAmount = 0.1;
              // Shift → LEFT edge, plain → RIGHT edge.
              const edge: 'left' | 'right' = e.shiftKey ? 'left' : 'right';
              // On the RIGHT edge: [ contracts (shrink), ] extends.
              // On the LEFT  edge: [ extends,  ] contracts.
              const isExtending = edge === 'right' ? isBracketRight : isBracketLeft;
              const delta = isExtending ? -editAmount : editAmount;

              // Cmd/Ctrl modifier switches trim → stretch. Same edge
              // and direction convention, so muscle memory carries
              // between the two operations:
              //   Cmd+[         → RIGHT edge stretch-in (compress)
              //   Cmd+]         → RIGHT edge stretch-out
              //   Cmd+Shift+[   → LEFT  edge stretch-out
              //   Cmd+Shift+]   → LEFT  edge stretch-in (compress)
              if (e.metaKey || e.ctrlKey) {
                onClipStretch?.(clip.id, edge, delta);
                return;
              }

              // Boundary check: if the user is trying to EXTEND (not
              // shrink) and there's no more source audio to reveal
              // on that side, don't dispatch the trim — fire the
              // shake animation so the shortcut isn't silent.
              // Mirrors the "cap the delta to available" logic in
              // Canvas.onClipTrim: `available` is measured in canvas
              // seconds, matching how the delta is applied.
              const BOUNDARY_EPS = 0.0005;
              const stretch = (clip as any).stretchFactor ?? 1; // justified: stretchFactor not on Clip type — pending components sweep
              const trimStart = (clip as any).trimStart ?? 0; // justified: trimStart not on Clip type — pending components sweep
              const fullDuration = (clip as any).fullDuration // justified: fullDuration not on Clip type — pending components sweep
                ?? (trimStart + clip.duration / stretch);
              const availableLeft = trimStart * stretch;
              const availableRight = (fullDuration - trimStart) * stretch - clip.duration;
              const blocked = isExtending && (
                (edge === 'left' && availableLeft <= BOUNDARY_EPS)
                || (edge === 'right' && availableRight <= BOUNDARY_EPS)
              );

              if (blocked) {
                // Bump the shake state so React remounts the shake
                // element (each token change → fresh DOM node → fresh
                // animation). Clear after the animation completes.
                setShakeState((prev) => ({
                  clipId: clip.id,
                  edge,
                  token: (prev?.token ?? 0) + 1,
                }));
                if (shakeTimeoutRef.current !== null) {
                  window.clearTimeout(shakeTimeoutRef.current);
                }
                shakeTimeoutRef.current = window.setTimeout(() => {
                  setShakeState(null);
                  shakeTimeoutRef.current = null;
                }, 180);
              }

              // Fire onClipTrim regardless of the blocked-shake state
              // so Canvas can select the focused clip. Canvas has its
              // own boundary check and will skip the actual TRIM_CLIP
              // dispatch when there's nothing to reveal.
              onClipTrim?.(clip.id, edge, delta);
              return;
            }

            // Tab / Shift+Tab: track-scoped clip navigation.
            //   Track flow (both directions):
            //     [track header] ↔ clip 1 ↔ clip 2 ↔ … ↔ clip N ↔ [next track header]
            //   • Shift+Tab on the FIRST clip → THIS track's header
            //   • Tab on the LAST clip       → NEXT track's header
            //   • Elsewhere → step to the neighbouring clip in DOM order
            //   Arrow keys stay reserved for matrix nav (playhead +
            //   track focus).
            if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
              const currentEl = e.currentTarget as HTMLElement;
              const isFirstOnTrack = clipIndex === 0;
              const isLastOnTrack = clipIndex === sortedClips.length - 1;

              if (e.shiftKey && isFirstOnTrack) {
                e.preventDefault();
                e.stopPropagation();
                onEnterPanel?.();
                return;
              }

              if (!e.shiftKey && isLastOnTrack && onTabFromLastClip) {
                e.preventDefault();
                e.stopPropagation();
                onTabFromLastClip();
                return;
              }

              const allClips = Array.from(
                document.querySelectorAll<HTMLElement>('[data-clip-id]'),
              );
              const currentIdx = allClips.indexOf(currentEl);
              if (currentIdx !== -1) {
                const targetIdx = e.shiftKey ? currentIdx - 1 : currentIdx + 1;
                const target = allClips[targetIdx];
                if (target) {
                  e.preventDefault();
                  e.stopPropagation();
                  // preventScroll: the browser's default focus-scroll is
                  // instant and races the smooth scroll our onFocus
                  // handler queues via scrollIntoViewIfNeeded — worse,
                  // it lands the clip in view so the "already visible"
                  // check short-circuits and no smooth scroll happens at
                  // all. Skipping the default lets our smooth pan run.
                  target.focus({ preventScroll: true });
                  return;
                }
                // No more clips in this direction — let the browser
                // move focus to the next tabbable element (ruler,
                // side panel button, etc.).
              }
              return;
            }

            // Shift+Arrow Up/Down on a clip: no-op for now, prevent browser default
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.shiftKey && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              return;
            }

            // Plain Arrow Up/Down on a focused clip: move TRACK focus
            // to the row above / below. The clip loses focus, the
            // track row gains it — matches the "arrows always move
            // around the matrix plane" model.
            //
            // Pressing an arrow is itself keyboard navigation, so we
            // clear the mouse-focus attribute before dispatching (any
            // subsequent redraw shows the visible focus ring on the
            // destination track).
            if (
              (e.key === 'ArrowDown' || e.key === 'ArrowUp')
              && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey
            ) {
              e.preventDefault();
              e.stopPropagation();
              (e.currentTarget as HTMLElement).removeAttribute('data-focus-mouse');
              const direction = e.key === 'ArrowDown' ? 1 : -1;
              onTrackNavigateVertical?.(direction, false, false);
              return;
            }

            // Plain Arrow Left/Right: fall through to the global
            // playhead-nudge handler (matrix X-axis nav).
          }}
        >
          <Clip
            shakeEdge={shakeState?.clipId === clip.id ? shakeState.edge : null}
            shakeToken={shakeState?.clipId === clip.id ? shakeState.token : 0}
            // LOCAL DEVIATION (see ../../../README.md): upstream renders every
            // clip in its track's colour, because its own sandbox lets
            // `clip.color` drift out of sync with the destination track. The
            // application resolves clip colour before it gets here — an
            // explicit per-clip override, or the track colour when the clip
            // follows it — so taking `clip.color` cannot drift and is the only
            // way its "Clip color" command has any visible effect.
            color={clipStyle === 'classic' ? 'classic' : ((clip as any).color || trackColor)}
            name={clip.name}
            width={clipWidth}
            height={height}
            selected={clipSelected}
            inTimeSelection={timeSelection && inTimeSelectionScope && timeSelection.renderOnCanvas !== false ? (
              clip.start < timeSelection.endTime && (clip.start + clip.duration) > timeSelection.startTime
            ) : false}
            clipStartTime={clip.start}
            timeSelectionRange={timeSelection}
            variant={variant}
            channelMode={channelMode}
            waveformData={waveformData}
            waveformDataRms={clip.waveformRms}
            waveformLeft={waveformLeft}
            waveformRight={waveformRight}
            waveformLeftRms={clip.waveformLeftRms}
            waveformRightRms={clip.waveformRightRms}
            channelSplitRatio={channelSplitRatio}
            envelope={clip.envelopePoints}
            showEnvelope={envelopeMode}
            clipDuration={clip.duration}
            clipTrimStart={(clip as any).trimStart || 0} // justified: trimStart not on Clip type — pending components sweep
            clipFullDuration={(clip as any).fullDuration} // justified: fullDuration not on Clip type — pending components sweep
            clipStretchFactor={(clip as any).stretchFactor ?? 1} // justified: stretchFactor not on Clip type — pending components sweep
            pixelsPerSecond={pixelsPerSecond}
            hiddenPointIndices={clipHiddenPoints.get(clip.id) ?? EMPTY_NUMBER_ARRAY}
            hoveredPointIndices={clipHoveredPoints.get(clip.id) ?? EMPTY_NUMBER_ARRAY}
            cursorPosition={clipCursorPositions.get(clip.id) ?? null}
            envelopePointSizes={envelopePointSizes}
            spectrogramScale={spectrogramScale}
            isRecording={recordingClipId === clip.id}
            midiNotes={clip.midiNotes}
            forceHeaderHover={isClipHovered}
            onHeaderClick={(shiftKey, metaKey) => onClipClick?.(clip.id, shiftKey, metaKey)}
            onRename={onClipRename ? (newName) => onClipRename(clip.id, newName) : undefined}
            onMenuClick={(x, y) => onClipMenuClick?.(clip.id, x, y)}
            onTrimEdge={
              onClipTrimEdge
                ? ({ edge, clientX }) => onClipTrimEdge(clip.id, edge, clientX)
                : undefined
            }
            onStretchEdge={
              onClipStretchEdge
                ? ({ edge, clientX }) => onClipStretchEdge(clip.id, edge, clientX)
                : undefined
            }
          />
        </div>
      );
    });
  };

  // Render envelope interaction layers for all clips at track level
  const renderEnvelopeInteractionLayers = () => {
    if (!envelopeMode || !onEnvelopePointsChange) return null;

    const CLIP_HEADER_HEIGHT = 20;

    return clips.map((clip) => {
      const clipX = CLIP_CONTENT_OFFSET + clip.start * pixelsPerSecond;
      const clipWidth = clip.duration * pixelsPerSecond;

      return (
        <EnvelopeInteractionLayer
          key={`envelope-${clip.id}`}
          envelopePoints={clip.envelopePoints || []}
          onEnvelopePointsChange={(newPoints) => onEnvelopePointsChange(clip.id, newPoints)}
          onHiddenPointsChange={(hiddenIndices) => {
            setClipHiddenPoints((prev) => {
              const next = new Map(prev);
              if (hiddenIndices.length > 0) {
                next.set(clip.id, hiddenIndices);
              } else {
                next.delete(clip.id);
              }
              return next;
            });
          }}
          onHoveredPointsChange={(hoveredIndices) => {
            setClipHoveredPoints((prev) => {
              const next = new Map(prev);
              if (hoveredIndices.length > 0) {
                next.set(clip.id, hoveredIndices);
              } else {
                next.delete(clip.id);
              }
              return next;
            });
          }}
          onCursorPositionChange={(position) => {
            setClipCursorPositions((prev) => {
              const next = new Map(prev);
              if (position) {
                next.set(clip.id, position);
              } else {
                next.delete(clip.id);
              }
              return next;
            });
          }}
          enabled={envelopeMode}
          width={clipWidth}
          height={height - CLIP_HEADER_HEIGHT}
          duration={clip.duration}
          x={clipX}
          y={CLIP_HEADER_HEIGHT}
        />
      );
    });
  };

  // Handle focus entering the track
  const handleTrackFocus = (e: React.FocusEvent) => {
    // Focus entered somewhere within the track (could be a clip or label)
    setHasKeyboardFocus(true);
    onFocusChange?.(true);

    // Container-focused (black/white bars) only when DOM focus is on
    // the container itself AND the user is in keyboard-input mode.
    // Mouse mode keeps the blue outline regardless of how the focus
    // event was triggered (click, arrow nav from a mouse-focused
    // track, programmatic focus). Arrow nav inherits the prior mode
    // so a Tab → next track → Up/Down → another track keeps the
    // black/white bars throughout.
    const fromMouse = focusFromMouseRef.current;
    focusFromMouseRef.current = false;
    const node = trackRef.current;
    // `data-focus-from-nav` is stamped by the arrow-nav path (Canvas
    // sets it right before .focus() lands on the target track). It
    // signals "the user is arrow-walking, not Tab-walking, so paint
    // the blue arrow-focus outline instead of the container-focused
    // black/white bars". We consume the attribute here so any later
    // Tab-driven focus into the same track re-picks the Tab style.
    const fromArrowNav = !!(node && node.hasAttribute('data-focus-from-nav'));
    if (fromArrowNav) {
      node.removeAttribute('data-focus-from-nav');
    }

    // In flat-nav mode the track wrapper is its own Tab stop and the
    // user can land on a track that's below the viewport. The .track
    // spans the full canvas width, so we can't use scrollIntoViewIfNeeded
    // (its inline: 'center' would yank the horizontal scroll). Instead,
    // scroll vertically only — when the track sits outside a comfortable
    // band, animate the scroll so the track top lands at TOP_OFFSET from
    // the viewport top.
    if (isFlatNavigation && !fromMouse && e.target === trackRef.current && node) {
      const scrollEl = node.closest('.canvas-scroll-container') as HTMLElement | null;
      if (scrollEl) {
        const trackRect = node.getBoundingClientRect();
        const containerRect = scrollEl.getBoundingClientRect();
        // Where the focused track's top should sit relative to the
        // viewport when we scroll. Enough breathing room above to show
        // the track's surrounding context (the previous track / timeline
        // ruler) while still keeping the focused track high enough that
        // most of the canvas below is visible.
        const TOP_OFFSET = 80;
        const BOTTOM_PAD = 24;
        const topOffset = trackRect.top - containerRect.top;
        const bottomOffset = trackRect.bottom - containerRect.bottom;
        const isAboveBand = topOffset < TOP_OFFSET;
        const isBelowBand = bottomOffset > -BOTTOM_PAD;
        if (isAboveBand || isBelowBand) {
          const nextScrollTop = scrollEl.scrollTop + topOffset - TOP_OFFSET;
          scrollEl.scrollTo({ top: Math.max(0, nextScrollTop), behavior: 'smooth' });
        }
      }
    }

    // Blue arrow-nav outline overrides the black/white container
    // outline: arrow keys walking off a focused clip onto a new
    // track shouldn't flip that track's style into Tab-nav mode.
    const containerHasFocus =
      e.target === trackRef.current
      && !fromMouse
      && !fromArrowNav
      && getInputMode() === 'keyboard';
    setIsContainerFocused(containerHasFocus);
    onContainerFocusChange?.(containerHasFocus);
  };

  // Handle focus leaving the track — tabIndex reset delegated to useContainerTabGroup
  const handleTrackBlur = (e: React.FocusEvent) => {
    // Let the hook handle tabIndex reset
    clipNavBlur(e);

    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const trackElement = e.currentTarget;

    // Only notify blur if focus is moving completely outside the track
    if (!relatedTarget || !trackElement.contains(relatedTarget)) {
      setHasKeyboardFocus(false);
      setIsContainerFocused(false);
      onFocusChange?.(false);
      // Don't clear container focus if moving to another track container (e.g. during reorder)
      const movingToTrackContainer = relatedTarget?.classList.contains('track');
      if (!movingToTrackContainer) {
        onContainerFocusChange?.(false);
      }
    } else {
      // Focus moved to a child — container no longer directly focused
      if (e.target === trackRef.current) {
        setIsContainerFocused(false);
        onContainerFocusChange?.(false);
      }
    }
  };

  const className = `track-wrapper ${isFocused ? 'track-wrapper--focused' : ''}`;

  // Render time selection overlay (only for the selected time range on track background)
  const renderTimeSelectionOverlay = () => {
    if (!timeSelection) return null;

    const startX = CLIP_CONTENT_OFFSET + timeSelection.startTime * pixelsPerSecond;
    const endX = CLIP_CONTENT_OFFSET + timeSelection.endTime * pixelsPerSecond;
    const selectionWidth = endX - startX;

    let overlayColor: string;
    if (inTimeSelectionScope) {
      overlayColor = isTimeSelectionDragging
        ? 'rgba(100, 127, 143, 0.55)'
        : 'rgba(98, 119, 136, 0.55)';
    } else {
      overlayColor = 'rgba(49, 56, 70, 0.55)';
    }

    return (
      <div
        style={{
          position: 'absolute',
          left: `${startX}px`,
          top: 0,
          width: `${selectionWidth}px`,
          height: `${height}px`,
          backgroundColor: overlayColor,
          pointerEvents: 'none',
          zIndex: 0, // Behind clips (clips have higher z-index)
        }}
      />
    );
  };

  return (
    <div className={`${className}${isContainerFocused ? ' track-wrapper--container-focused' : ''}`} data-track-index={trackIndex}>
      <div
        ref={trackRef}
        className={`track ${isSelected ? 'track--selected' : ''} ${isMuted ? 'track--muted' : ''}`}
        style={{
          position: 'relative',
          width: `${width}px`,
          height: `${height}px`,
          backgroundColor: getTrackBackgroundColor(),
          opacity: isMuted ? 0.5 : 1,
        }}
        tabIndex={trackTabIndex ?? -1}
        role="group"
        aria-label={`${trackName ?? `Track ${trackIndex + 1}`}, ${isLabelTrack ? 'label track' : isMidiTrack ? 'MIDI track' : 'audio track'}`}
        onMouseDown={(e) => {
          // Let the browser focus the .track div so Tab continues from here.
          // The ref tells handleTrackFocus to suppress the red container outline.
          focusFromMouseRef.current = true;
          trackClickXRef.current = e.clientX;
        }}
        onClickCapture={clipNavClickCapture}
        onClick={(e) => {
          // Don't focus the .track DOM element on click — that shows the red
          // container outline.  onTrackClick sets focusedTrackIndex which gives
          // the blue track-wrapper outline instead.
          onTrackClick?.(e);
        }}
        onKeyDown={(e: React.KeyboardEvent) => {
          // If the track container itself is focused (not a child clip), handle navigation
          if (e.currentTarget === document.activeElement) {
            if (e.key === 'Enter') {
              // Enter on track container: select track and deselect clips
              e.preventDefault();
              e.stopPropagation();
              onContainerEnter?.({ metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey });
              return;
            }
            if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
              // Cmd/Ctrl+Arrow: reorder track up / down. Pass the
              // current container-focused state along so the parent
              // only carries that indicator over to the new position
              // when it was actually set (which only happens after a
              // Tab-driven keyboard focus, not after a mouse click).
              e.preventDefault();
              e.stopPropagation();
              onTrackReorder?.(e.key === 'ArrowDown' ? 1 : -1, isContainerFocused);
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              // Plain / Shift+Arrow: navigate between tracks.
              //   Plain → follows-focus moves selection with focus
              //   Shift → extend range
              // (Peek mode via Alt is gone — Alt is now reserved for
              // clip-land navigation, not a focus-decouple modifier.)
              e.preventDefault();
              e.stopPropagation();
              onTrackNavigateVertical?.(
                e.key === 'ArrowDown' ? 1 : -1,
                e.shiftKey,
                false,
              );
            } else if (!isFlatNavigation && e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              // Empty track (no clips): treat Tab as if we're already
              // past the last clip — hand off to onTabFromLastClip so
              // focus jumps to the ruler / next track instead of
              // getting parked in this track's panel with no way to
              // reach the panel controls that would normally come
              // after (the flow assumes clips exist between them).
              if (sortedClips.length === 0 && onTabFromLastClip) {
                onTabFromLastClip();
                return;
              }
              if (!isContainerFocused && trackClickXRef.current !== null) {
                // Invisible focus from mouse click — Tab to nearest
                // clip on the track. When the track has no clips,
                // fall through to the keyboard branch so the user
                // still moves somewhere instead of getting a silent
                // no-op.
                const clipElements = trackRef.current?.querySelectorAll('[data-clip-id]');
                if (clipElements && clipElements.length > 0) {
                  const clickX = trackClickXRef.current;
                  let nearestDist = Infinity;
                  let nearestIdx = 0;
                  clipElements.forEach((el, i) => {
                    const rect = el.getBoundingClientRect();
                    const clipCenter = rect.left + rect.width / 2;
                    const dist = Math.abs(clickX - clipCenter);
                    if (dist < nearestDist) {
                      nearestDist = dist;
                      nearestIdx = i;
                    }
                  });
                  trackClickXRef.current = null;
                  // preventScroll — same rationale as the clip-to-clip
                  // Tab handler above; let scrollIntoViewIfNeeded run
                  // the smooth pan without the browser stealing it.
                  (clipElements[nearestIdx] as HTMLElement).focus({ preventScroll: true });
                } else {
                  // No clips → promote to keyboard-focus on the track
                  // itself so the user can see the focus state, then
                  // let the next Tab walk into the panel.
                  trackClickXRef.current = null;
                  const node = trackRef.current;
                  if (node) {
                    node.setAttribute('data-focus-from-nav', '1');
                    node.blur();
                    node.focus();
                  }
                }
              } else {
                // Visible keyboard focus — Tab enters panel controls
                onEnterPanel?.();
              }
            } else if (!isFlatNavigation && e.key === 'Tab' && e.shiftKey) {
              // Shift+Tab: go to previous track's clips or panel
              e.preventDefault();
              e.stopPropagation();
              onShiftTabOut?.();
            }
            return; // Don't run clip navigation when container itself is focused
          }
          // Suppress arrow-key clip-to-clip navigation when the focused
          // clip was focused via mouse. Only relevant for Home / End
          // (which useContainerTabGroup still owns); arrow keys are
          // reserved for matrix nav (playhead + track focus) and
          // don't reach clipNavKeyDown here.
          const activeEl = document.activeElement as HTMLElement | null;
          if (activeEl?.hasAttribute('data-focus-mouse')) return;

          // Plain / modified arrows are all reserved for matrix
          // navigation now — clip-to-clip stepping lives on Tab /
          // Shift+Tab, handled in the clip's own onKeyDown. Do NOT
          // delegate arrow keys to clipNavKeyDown.
          if (
            e.key === 'ArrowLeft' || e.key === 'ArrowRight'
            || e.key === 'ArrowUp' || e.key === 'ArrowDown'
          ) {
            return;
          }
          // Home / End still delegate for clip-list bookends.
          clipNavKeyDown(e);
        }}
        onFocus={handleTrackFocus}
        onBlur={handleTrackBlur}
      >
        {renderTimeSelectionOverlay()}

        {/* Clip header recess - 20px darkened area at top of track (hidden for label tracks and when track is too small) */}
        {/* Rendered after time selection overlay but before clips so clips render on top */}
        {!isLabelTrack && !isMidiTrack && height > 44 && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '20px',
              backgroundColor: 'rgba(0, 0, 0, 0.15)',
              pointerEvents: 'none',
              zIndex: 1, // Above time selection overlay (z-index: 0), below clips (z-index: 2)
            }}
          />
        )}

        {renderClips()}
        {renderEnvelopeInteractionLayers()}

        {/* Split view divider - draggable horizontal line */}
        {splitView && onChannelSplitRatioChange && (
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDraggingDivider(true);
              document.body.style.cursor = 'ns-resize';
            }}
            onMouseEnter={() => setDividerHover(true)}
            onMouseLeave={() => setDividerHover(false)}
            style={{
              position: 'absolute',
              top: `${20 + (height - 20) * channelSplitRatio}px`,
              left: 0,
              width: '100%',
              height: dividerHover || isDraggingDivider ? '3px' : '1px',
              backgroundColor: dividerHover || isDraggingDivider ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)',
              cursor: 'ns-resize',
              zIndex: 10,
              transform: dividerHover || isDraggingDivider ? 'translateY(-1px)' : 'none',
              transition: isDraggingDivider ? 'none' : 'all 0.1s ease',
            }}
          />
        )}
      </div>
    </div>
  );
};

export const TrackNew = React.memo(TrackNewComponent);

export default TrackNew;
