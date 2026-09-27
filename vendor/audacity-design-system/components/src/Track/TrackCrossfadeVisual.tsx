import React from 'react';
import './Track.css';

export type TrackCrossfadeKeyboardKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
  | 'PageUp' | 'PageDown' | 'Home' | 'End';

export interface TrackCrossfadeVisualProps {
  left: number;
  top: number;
  width: number;
  height: number;
  outgoingPath: string;
  incomingPath: string;
  intersectionPosition: number;
  intersectionGain: number;
  minimumPosition?: number;
  maximumPosition?: number;
  outgoingClipId: string;
  incomingClipId: string;
  outgoingSelected: boolean;
  incomingSelected: boolean;
  label: string;
  disabled?: boolean;
  onKeyboardAdjust?: (key: TrackCrossfadeKeyboardKey, fine: boolean) => void;
  onTabOut?: (backwards: boolean) => void;
}

const KEYBOARD_KEYS = new Set<TrackCrossfadeKeyboardKey>([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End',
]);

/** The design-system crossfade veil and curves, with gain geometry supplied by the host. */
export function TrackCrossfadeVisual({
  left,
  top,
  width,
  height,
  outgoingPath,
  incomingPath,
  intersectionPosition,
  intersectionGain,
  minimumPosition = 0.02,
  maximumPosition = 0.98,
  outgoingClipId,
  incomingClipId,
  outgoingSelected,
  incomingSelected,
  label,
  disabled = false,
  onKeyboardAdjust,
  onTabOut,
}: TrackCrossfadeVisualProps): React.ReactElement {
  // Keep tint and endpoint strokes inside the two clip outlines. A 2px
  // sample-level overlap still retains one painted pixel.
  const edgeInset = Math.max(0, Math.min(1, (width - 1) / 2));
  const regions = [
    { side: 'out', path: outgoingPath, selected: outgoingSelected },
    { side: 'in', path: incomingPath, selected: incomingSelected },
  ] as const;

  const handleLeft = Math.round(left + intersectionPosition * width - 8);
  const handleTop = Math.round(top + (1 - intersectionGain) * height - 8);

  return <>
    <div className="audacity-track-crossfade-visual" role="img"
      data-automatic-crossfade="true" aria-label={label} title={label}
      style={{ left: left + edgeInset, top, width: width - edgeInset * 2, height }}>
      {regions.map(({ side, selected }) => <div key={`veil-${side}`}
        className="audacity-track-crossfade-visual__veil" data-fade-overlay={side}
        data-fade-authored="false"
        style={{ background: selected ? 'rgba(255, 255, 255, 0.38)' : 'rgba(255, 255, 255, 0.2)' }} />)}
      {regions.map(({ side, path }) => <div key={`curve-${side}`}
        className="audacity-track-crossfade-visual__curve" data-fade-curve={side}>
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none"
          aria-hidden="true">
          <path d={path} fill="none" stroke="rgba(0, 0, 0, 0.55)" strokeWidth={1.5}
            vectorEffect="non-scaling-stroke" />
        </svg>
      </div>)}
    </div>
    <div className="audacity-track-crossfade-handle" role="slider"
      data-crossfade-handle={`${outgoingClipId}-${incomingClipId}`}
      data-outgoing-clip-id={outgoingClipId} data-incoming-clip-id={incomingClipId}
      data-crossfade-position={intersectionPosition} data-crossfade-gain={intersectionGain}
      data-crossfade-width={width} data-crossfade-height={height}
      aria-label={label} aria-valuemin={minimumPosition} aria-valuemax={maximumPosition}
      aria-valuenow={intersectionPosition}
      aria-valuetext={`${Math.round(intersectionPosition * 100)}%`}
      aria-orientation="horizontal" aria-disabled={disabled || undefined}
      tabIndex={disabled || !onKeyboardAdjust ? -1 : 0}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'Tab' && onTabOut) {
          event.preventDefault();
          event.stopPropagation();
          onTabOut(event.shiftKey);
          return;
        }
        if (event.altKey || event.ctrlKey || event.metaKey || !onKeyboardAdjust
          || !KEYBOARD_KEYS.has(event.key as TrackCrossfadeKeyboardKey)) return;
        event.preventDefault();
        event.stopPropagation();
        onKeyboardAdjust(event.key as TrackCrossfadeKeyboardKey, event.shiftKey);
      }}
      style={{ left: handleLeft, top: handleTop }}>
      <span className="audacity-track-crossfade-handle__dot" aria-hidden="true" />
    </div>
  </>;
}
