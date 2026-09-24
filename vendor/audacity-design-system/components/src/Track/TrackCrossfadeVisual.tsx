import React from 'react';
import './Track.css';

export interface TrackCrossfadeVisualProps {
  left: number;
  top: number;
  width: number;
  height: number;
  outgoingPath: string;
  incomingPath: string;
  outgoingSelected: boolean;
  incomingSelected: boolean;
  label: string;
}

/** The design-system crossfade veil and curves, with gain geometry supplied by the host. */
export function TrackCrossfadeVisual({
  left,
  top,
  width,
  height,
  outgoingPath,
  incomingPath,
  outgoingSelected,
  incomingSelected,
  label,
}: TrackCrossfadeVisualProps): React.ReactElement {
  // Keep tint and endpoint strokes inside the two clip outlines. A 2px
  // sample-level overlap still retains one painted pixel.
  const edgeInset = Math.max(0, Math.min(1, (width - 1) / 2));
  const regions = [
    { side: 'out', path: outgoingPath, selected: outgoingSelected },
    { side: 'in', path: incomingPath, selected: incomingSelected },
  ] as const;

  return <div className="audacity-track-crossfade-visual" role="img"
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
  </div>;
}
