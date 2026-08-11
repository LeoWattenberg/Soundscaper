import React from 'react';
import type { MidiNote } from '@audacity-ui/core';
import { Clip } from '../Clip/Clip';
import type { SpectrogramScale } from '../ClipBody/ClipBody';
import { EnvelopeInteractionLayer } from '../EnvelopeInteractionLayer/EnvelopeInteractionLayer';
import { generateSpeechWaveform } from '../utils/waveform';
import { CLIP_CONTENT_OFFSET } from '../constants';
import { useContainerTabGroup } from '../hooks/useContainerTabGroup';
import { scrollIntoViewIfNeeded } from '../utils/scrollIntoViewIfNeeded';
import { useTheme } from '../ThemeProvider/ThemeProvider';
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
  timeSelection?: { startTime: number; endTime: number } | null;

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
   * Callback when ArrowUp/Down is pressed while the track container itself is focused.
   * Direction: 1 = down, -1 = up.
   */
  onTrackNavigateVertical?: (direction: 1 | -1, shiftKey?: boolean) => void;

  /**
   * Callback when Cmd+ArrowUp/Down is pressed on the track container to reorder the track.
   * Direction: 1 = move down, -1 = move up.
   */
  onTrackReorder?: (direction: 1 | -1) => void;

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
}) => {
  const { theme } = useTheme();
  const trackColor = color && clipStyle !== 'classic' ? color as typeof TRACK_COLORS[number] : getTrackColor(trackIndex, clipStyle);
  const [clipHiddenPoints, setClipHiddenPoints] = React.useState<Map<string | number, number[]>>(new Map());
  const [clipHoveredPoints, setClipHoveredPoints] = React.useState<Map<string | number, number[]>>(new Map());
  const [clipCursorPositions, setClipCursorPositions] = React.useState<Map<string | number, { time: number; db: number } | null>>(new Map());
  const [hasKeyboardFocus, setHasKeyboardFocus] = React.useState(false);
  const [isContainerFocused, setIsContainerFocused] = React.useState(false);
  const [isDraggingDivider, setIsDraggingDivider] = React.useState(false);
  const [dividerHover, setDividerHover] = React.useState(false);
  const trackRef = React.useRef<HTMLDivElement>(null);
  const focusFromMouseRef = React.useRef(false);
  const trackClickXRef = React.useRef<number | null>(null);
  const clipFocusFromMouseRef = React.useRef(false);
  const mouseDownPosRef = React.useRef<{ x: number; y: number } | null>(null);

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
      const trimStart = (clip as any).trimStart || 0;
      const fullDuration = (clip as any).fullDuration || (trimStart + clip.duration);

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

      const clipSelected = (clip as any).selected || false;
      const isClipHovered = hoveredClipId != null && clip.id === hoveredClipId;
      const isDragging = draggingClipIds?.has(clip.id as number) ?? false;

      return (
        <div
          key={clip.id}
          data-clip-id={clip.id}
          data-track-index={trackIndex}
          data-first-clip={isFirstClip}
          style={{
            position: 'absolute',
            left: `${clipX}px`,
            top: 0,
            zIndex: isDragging ? 10 : 2, // Dragged clips float above all others; above clip header recess (z-index: 1) otherwise
            opacity: isDragging ? 0.5 : undefined,
          }}
          tabIndex={isFirstClip && tabIndex !== undefined ? tabIndex : -1}
          role="button"
          aria-label={`${clip.name} clip`}
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
            // Handle clicks on the clip body — header clicks are handled by ClipHeader's onClick
            // which calls e.stopPropagation(), so this only fires for body clicks.
            // Skip clip selection if the user dragged (e.g. time selection).
            const downPos = mouseDownPosRef.current;
            mouseDownPosRef.current = null;
            if (downPos) {
              const dx = e.clientX - downPos.x;
              const dy = e.clientY - downPos.y;
              if (dx * dx + dy * dy > 9) return; // >3px = drag, not click
            }
            // Body clicks place the cursor (handled by time selection system),
            // not select the clip. Only Shift/Cmd body clicks trigger clip selection.
            if (e.shiftKey || e.metaKey || e.ctrlKey) {
              e.stopPropagation();
              onClipClick?.(clip.id, e.shiftKey, e.metaKey || e.ctrlKey);
            }
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

            // Escape: move focus back to the track container
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              trackRef.current?.focus();
              return;
            }

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

            // Move clip horizontally with Cmd+Arrow Left/Right
            if ((e.metaKey || e.ctrlKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey) {
              e.preventDefault();
              const moveAmount = 0.1; // Move by 0.1 seconds
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

            // Expand clip with Shift+Arrow keys (trim with Cmd+Shift+Arrow).
            // Skip when Alt is held — that combo belongs to the stretch
            // branch above so trim doesn't double-fire.
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

            // Shift+Tab: go to panel controls
            if (e.key === 'Tab' && e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              onEnterPanel?.();
              return;
            }

            // Tab from last clip: navigate to ruler (or next track)
            if (e.key === 'Tab' && !e.shiftKey && onTabFromLastClip && clipIndex === sortedClips.length - 1) {
              e.preventDefault();
              e.stopPropagation();
              onTabFromLastClip();
              return;
            }

            // Shift+Arrow Up/Down on a clip: no-op for now, prevent browser default
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.shiftKey && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              return;
            }

            // Navigate vertically between tracks with arrow up/down (without Cmd or Shift)
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
              e.preventDefault();
              e.stopPropagation(); // Prevent global useKeyboardShortcuts from also handling this
              const direction = e.key === 'ArrowDown' ? 1 : -1;
              onClipNavigateVertical?.(clip.id, direction);
              return;
            }

            // ArrowLeft/Right without modifiers: handled by useContainerTabGroup on the track container
          }}
        >
          <Clip
            color={clipStyle === 'classic' ? 'classic' : ((clip as any).color || trackColor)}
            name={clip.name}
            width={clipWidth}
            height={height}
            selected={clipSelected}
            inTimeSelection={timeSelection && isSelected && (timeSelection as any).renderOnCanvas !== false ? (
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
            clipTrimStart={(clip as any).trimStart || 0}
            clipFullDuration={(clip as any).fullDuration}
            clipStretchFactor={(clip as any).stretchFactor ?? 1}
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

    // Notify if the container itself (not a child) received focus via keyboard.
    // Mouse clicks give invisible DOM focus — don't show the red bars.
    const containerHasFocus = e.target === trackRef.current && !focusFromMouseRef.current;
    focusFromMouseRef.current = false;
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

    // Selected tracks: #647F8F when dragging, #627788 when finalized
    // Unselected tracks: #313846
    // Use rgba so grid lines remain visible through the selection
    const overlayColor = isSelected
      ? (isTimeSelectionDragging ? 'rgba(100, 127, 143, 0.55)' : 'rgba(98, 119, 136, 0.55)')
      : 'rgba(49, 56, 70, 0.55)';

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
            if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
              // Cmd+Arrow: reorder track
              e.preventDefault();
              e.stopPropagation();
              onTrackReorder?.(e.key === 'ArrowDown' ? 1 : -1);
            } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.metaKey && !e.ctrlKey) {
              // Plain or Shift+Arrow: navigate between tracks
              e.preventDefault();
              e.stopPropagation();
              onTrackNavigateVertical?.(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
            } else if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              if (!isContainerFocused && trackClickXRef.current !== null) {
                // Invisible focus from mouse click — Tab to nearest clip
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
                  (clipElements[nearestIdx] as HTMLElement).focus();
                }
              } else {
                // Visible keyboard focus — Tab enters panel controls
                onEnterPanel?.();
              }
            } else if (e.key === 'Tab' && e.shiftKey) {
              // Shift+Tab: go to previous track's clips or panel
              e.preventDefault();
              e.stopPropagation();
              onShiftTabOut?.();
            }
            return; // Don't run clip navigation when container itself is focused
          }
          // Delegate to clip navigation hook for child elements
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
