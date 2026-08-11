import React, { useState } from 'react';
import type { MidiNote } from '@audacity-ui/core';
import type { ClipColor } from '../types/clip';
import { ClipHeader } from '../ClipHeader/ClipHeader';
import { ClipBody, ClipBodyVariant, ClipBodyChannelMode } from '../ClipBody/ClipBody';
import type { SpectrogramScale } from '../ClipBody/ClipBody';
import { MidiClipBody } from '../MidiClipBody/MidiClipBody';
import type { EnvelopePointData } from '../utils/envelope';
import '../assets/fonts/musescore-icon.css';
import './Clip.css';

// ---- Handle icons ---------------------------------------------------------
// MusescoreIcon font glyphs. Codepoints come from design.

const TrimLeftIcon = () => (
  <span className="musescore-icon" aria-hidden="true">{'\uF4B1'}</span>
);

const TrimRightIcon = () => (
  <span className="musescore-icon" aria-hidden="true">{'\uF4B0'}</span>
);

const StretchIcon = () => (
  <span className="musescore-icon" aria-hidden="true">{'\uF475'}</span>
);

const EMPTY_NUMBER_ARRAY: number[] = [];

export type ClipState = 'default' | 'headerHover';

const MIN_CLIP_HEIGHT = 44; // Minimum height before header is hidden
const HEADER_HEIGHT = 20;

export interface ClipProps {
  /** Clip color from the 9-color palette */
  color?: ClipColor;
  /** Whether the clip is selected */
  selected?: boolean;
  /** Interaction state */
  state?: ClipState;
  /** Clip name to display in header */
  name?: string;
  /** Width in pixels */
  width?: number;
  /** Height in pixels */
  height?: number;
  /** Visualization type */
  variant?: ClipBodyVariant;
  /** Channel display mode */
  channelMode?: ClipBodyChannelMode;
  /** Waveform image URL (optional) */
  waveformSrc?: string;
  /** Waveform data array (normalized -1 to 1) - for mono */
  waveformData?: number[];
  /** RMS waveform data (normalized -1 to 1) - for mono */
  waveformDataRms?: number[];
  /** Left channel waveform data (for stereo) */
  waveformLeft?: number[];
  /** Right channel waveform data (for stereo) */
  waveformRight?: number[];
  /** Left channel RMS waveform data (for stereo) */
  waveformLeftRms?: number[];
  /** Right channel RMS waveform data (for stereo) */
  waveformRightRms?: number[];
  /** Split ratio for stereo channels (0-1, default 0.5 for 50/50) */
  channelSplitRatio?: number;
  /** Envelope points for automation curve */
  envelope?: EnvelopePointData[];
  /** Whether to show the envelope overlay */
  showEnvelope?: boolean;
  /** Clip duration in seconds (needed for envelope rendering) */
  clipDuration?: number;
  /** Trim start offset in seconds (for trimmed clips) */
  clipTrimStart?: number;
  /** Full duration of original audio before trimming */
  clipFullDuration?: number;
  /** Visual time-stretch factor (default 1). Forwarded to ClipBody so the
   *  waveform expands / compresses horizontally without changing trim. */
  clipStretchFactor?: number;
  /** Pixels per second (timeline zoom level) */
  pixelsPerSecond?: number;
  /** Points to hide during drag (eating behavior) */
  hiddenPointIndices?: number[];
  /** Indices of points being hovered (for hover visual feedback, can be multiple during segment drag) */
  hoveredPointIndices?: number[];
  /** Cursor position on envelope (for cursor follower dot) */
  cursorPosition?: { time: number; db: number } | null;
  /** Callback when clip header is clicked */
  onHeaderClick?: (shiftKey: boolean, metaKey: boolean) => void;
  /** Callback when clip menu button is clicked */
  onMenuClick?: (x: number, y: number) => void;
  /** Callback when dragging left or right edge to trim clip */
  onTrimEdge?: (params: { edge: 'left' | 'right'; clientX: number }) => void;
  /** Callback when dragging the time-stretch handle (the second handle that
   *  sits below the trim handle on either side of a selected clip). Wiring is
   *  optional — pass omit to render the handles but no-op the interaction. */
  onStretchEdge?: (params: { edge: 'left' | 'right'; clientX: number }) => void;
  /** Whether clip is within a time selection (for vibrant color rendering) */
  inTimeSelection?: boolean;
  /** Clip start time in seconds (for calculating time selection overlay position) */
  clipStartTime?: number;
  /** Time selection range (for calculating overlay position) */
  timeSelectionRange?: { startTime: number; endTime: number } | null;
  /** Envelope control point sizes (for MuseScore vs AU4 style) */
  envelopePointSizes?: {
    outerRadius: number;
    innerRadius: number;
    outerRadiusHover: number;
    innerRadiusHover: number;
    dualStrokeLine?: boolean;
    [key: string]: unknown;
  };
  /** Whether this clip is currently being recorded (shows menu, removes right border radius) */
  isRecording?: boolean;
  /** Frequency scale for spectrogram rendering */
  spectrogramScale?: SpectrogramScale;
  /** MIDI notes for midi variant */
  midiNotes?: MidiNote[];
  /** Force header hover state (e.g. when hovering the corresponding clip strip in piano roll) */
  forceHeaderHover?: boolean;
}

/**
 * Clip - A visual representation of an audio clip
 *
 * This component displays a simplified clip with header and body areas,
 * using the Audacity 9-color clip palette. Composed of ClipHeader and ClipBody.
 *
 * When height ≤ 44px, enters "truncated" mode where header is hidden until hover.
 */
const ClipComponent: React.FC<ClipProps> = ({
  color = 'blue',
  selected = false,
  state = 'default',
  name = 'Clip',
  width = 224,
  height = 104,
  variant = 'waveform',
  channelMode = 'mono',
  waveformSrc,
  waveformData,
  waveformDataRms,
  waveformLeft,
  waveformRight,
  waveformLeftRms,
  waveformRightRms,
  channelSplitRatio = 0.5,
  envelope,
  showEnvelope = false,
  clipDuration,
  clipTrimStart = 0,
  clipFullDuration,
  clipStretchFactor = 1,
  pixelsPerSecond = 100,
  hiddenPointIndices = EMPTY_NUMBER_ARRAY,
  hoveredPointIndices = EMPTY_NUMBER_ARRAY,
  cursorPosition = null,
  onHeaderClick,
  onMenuClick,
  onTrimEdge,
  onStretchEdge,
  inTimeSelection = false,
  clipStartTime = 0,
  timeSelectionRange = null,
  envelopePointSizes,
  isRecording = false,
  spectrogramScale,
  midiNotes,
  forceHeaderHover = false,
}) => {
  const [isHovering, setIsHovering] = useState(false);
  const [isHeaderHovering, setIsHeaderHovering] = useState(false);
  const [trimEdge, setTrimEdge] = useState<'left' | 'right' | null>(null);
  const [stretchEdge, setStretchEdge] = useState<'left' | 'right' | null>(null);

  const isTruncated = height <= MIN_CLIP_HEIGHT;
  const showHeader = !isTruncated || isHovering;

  const className = [
    'clip-display',
    selected && 'clip-display--selected',
    isTruncated && 'clip-display--truncated',
    isTruncated && isHovering && 'clip-display--truncated-hover',
    isRecording && 'clip-display--recording',
  ]
    .filter(Boolean)
    .join(' ');

  // In truncated mode, body always takes full height
  // Header overlays on top when visible
  const bodyHeight = isTruncated ? height : height - HEADER_HEIGHT;

  // Trim handle width
  const TRIM_HANDLE_WIDTH = 6;

  // Handle trim edge mouse down
  const handleTrimMouseDown = (edge: 'left' | 'right') => (e: React.MouseEvent) => {
    if (onTrimEdge) {
      e.stopPropagation();
      setTrimEdge(edge);
    }
  };

  // Handle mouse move for trim cursor
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!onTrimEdge || trimEdge) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;

    // Check if near left or right edge
    if (x < TRIM_HANDLE_WIDTH) {
      (e.currentTarget as HTMLElement).style.cursor = 'ew-resize';
    } else if (x > width - TRIM_HANDLE_WIDTH) {
      (e.currentTarget as HTMLElement).style.cursor = 'ew-resize';
    } else {
      (e.currentTarget as HTMLElement).style.cursor = '';
    }
  };

  // Handle global mouse move and up for trim
  React.useEffect(() => {
    if (!trimEdge) return;

    const handleMouseMoveGlobal = (e: MouseEvent) => {
      onTrimEdge?.({ edge: trimEdge, clientX: e.clientX });
    };

    const handleMouseUp = () => {
      setTrimEdge(null);
    };

    document.addEventListener('mousemove', handleMouseMoveGlobal);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMoveGlobal);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [trimEdge, onTrimEdge]);

  // Visible handles (rendered when `selected`). Mouse-down on a handle starts
  // a drag — the same pattern as the invisible edge trim above. Stretch is
  // wired symmetrically; if `onStretchEdge` is absent the handles still
  // render but produce no edit, so the layout can be reviewed visually
  // before the audio side is hooked up.
  const handleVisibleTrimMouseDown = (edge: 'left' | 'right') => (e: React.MouseEvent) => {
    if (!onTrimEdge) return;
    e.stopPropagation();
    setTrimEdge(edge);
  };
  const handleStretchMouseDown = (edge: 'left' | 'right') => (e: React.MouseEvent) => {
    e.stopPropagation();
    setStretchEdge(edge);
  };

  React.useEffect(() => {
    if (!stretchEdge) return;

    const onMove = (e: MouseEvent) => {
      onStretchEdge?.({ edge: stretchEdge, clientX: e.clientX });
    };
    const onUp = () => setStretchEdge(null);

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [stretchEdge, onStretchEdge]);

  return (
    <div
      className={className}
      style={{ width: `${width}px`, height: `${height}px`, position: 'relative' }}
      data-color={color}
      data-state={state}
      data-selected={selected}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onMouseMove={handleMouseMove}
    >
      <div className="clip-display__inner">
      {showHeader && (
        <div
          style={isTruncated ? { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 } : undefined}
          onMouseEnter={() => setIsHeaderHovering(true)}
          onMouseLeave={() => setIsHeaderHovering(false)}
        >
          <ClipHeader
            color={color}
            selected={selected}
            inTimeSelection={inTimeSelection}
            state={isHeaderHovering || forceHeaderHover ? 'hover' : 'default'}
            name={name}
            width={width}
            showMenu={!isRecording}
            showStretch={clipStretchFactor !== 1}
            // The audio plays inversely proportional to the visible width —
            // 2× wider clip = 50% speed, half-width = 200% speed.
            stretchPercent={100 / clipStretchFactor}
            clipStartTime={clipStartTime}
            clipDuration={clipDuration}
            timeSelectionRange={timeSelectionRange}
            pixelsPerSecond={pixelsPerSecond}
            onClick={(e) => {
              e.stopPropagation();
              onHeaderClick?.(e.shiftKey, e.metaKey || e.ctrlKey);
            }}
            onMenuClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              onMenuClick?.(rect.right, rect.bottom);
            }}
          />
        </div>
      )}
      {variant === 'midi' && midiNotes ? (
        <MidiClipBody
          notes={midiNotes}
          clipDuration={clipDuration || 1}
          trimStart={clipTrimStart}
          width={width}
          height={bodyHeight}
          color={color}
          selected={selected}
          inTimeSelection={inTimeSelection}
          clipStartTime={clipStartTime}
          timeSelectionRange={timeSelectionRange}
          pixelsPerSecond={pixelsPerSecond}
        />
      ) : (
        <ClipBody
          color={color}
          selected={selected}
          variant={variant === 'midi' ? 'waveform' : variant}
          channelMode={channelMode}
          width={width}
          height={bodyHeight}
          waveformSrc={waveformSrc}
          waveformData={waveformData}
          waveformDataRms={waveformDataRms}
          waveformLeft={waveformLeft}
          waveformRight={waveformRight}
          waveformLeftRms={waveformLeftRms}
          waveformRightRms={waveformRightRms}
          channelSplitRatio={channelSplitRatio}
          envelope={envelope}
          showEnvelope={showEnvelope}
          clipDuration={clipDuration}
          clipTrimStart={clipTrimStart}
          clipFullDuration={clipFullDuration}
          clipStretchFactor={clipStretchFactor}
          pixelsPerSecond={pixelsPerSecond}
          hiddenPointIndices={hiddenPointIndices}
          hoveredPointIndices={hoveredPointIndices}
          cursorPosition={cursorPosition}
          inTimeSelection={inTimeSelection}
          clipStartTime={clipStartTime}
          timeSelectionRange={timeSelectionRange}
          envelopePointSizes={envelopePointSizes}
          spectrogramScale={spectrogramScale}
        />
      )}

      </div>

      {/* Icon-button handles that sit just outside the clip's left/right
          edges when the clip is selected. Vertically anchored below the
          clip header — trim on top, stretch below. Each button shows its
          own inline-SVG glyph (brackets for trim, clock for stretch) and
          uses one of the PNG cursors from src/assets/cursors/ on hover so
          the cursor previews the action.
          Trim buttons render only when onTrimEdge is wired (matches the
          original contract); stretch buttons always render but no-op if
          onStretchEdge is absent. */}
      {selected && (
        <>
          {onTrimEdge && (
            <button
              type="button"
              className="clip-display__handle clip-display__handle--trim-left"
              aria-label="Trim left edge"
              onMouseDown={handleVisibleTrimMouseDown('left')}
            >
              <TrimLeftIcon />
            </button>
          )}
          {onTrimEdge && (
            <button
              type="button"
              className="clip-display__handle clip-display__handle--trim-right"
              aria-label="Trim right edge"
              onMouseDown={handleVisibleTrimMouseDown('right')}
            >
              <TrimRightIcon />
            </button>
          )}
          <button
            type="button"
            className="clip-display__handle clip-display__handle--stretch-left"
            aria-label="Stretch left edge"
            onMouseDown={handleStretchMouseDown('left')}
          >
            <StretchIcon />
          </button>
          <button
            type="button"
            className="clip-display__handle clip-display__handle--stretch-right"
            aria-label="Stretch right edge"
            onMouseDown={handleStretchMouseDown('right')}
          >
            <StretchIcon />
          </button>
        </>
      )}
    </div>
  );
};

export const Clip = React.memo(ClipComponent);

export default Clip;
