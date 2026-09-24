import React from 'react';
import './Track.css';

export interface TrackFadeHandleProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  edge: 'in' | 'out';
  /** Fade boundary in pixels from the rendered clip's left edge. */
  boundaryX: number;
  /** Boundary of the other fade, in the same coordinate space. */
  oppositeBoundaryX: number;
  clipWidth: number;
}

function preferredLeft(edge: 'in' | 'out', inBoundaryX: number, outBoundaryX: number, clipWidth: number): number {
  const mirrored = edge === 'out';
  const boundaryX = edge === 'in' ? inBoundaryX : outBoundaryX;
  const handlesRetreat = outBoundaryX - inBoundaryX < 40;
  const inward = edge === 'in' ? !handlesRetreat : handlesRetreat;

  // The glyph's visible square is asymmetric inside its 16px SVG box.
  const squareLeft = mirrored ? 0.5 : 6.5;
  const squareRight = mirrored ? 9.5 : 15.5;
  const raw = inward
    ? boundaryX + 2 - squareLeft
    : boundaryX - 2 - squareRight;
  return Math.max(0, Math.min(Math.floor(clipWidth - 16), Math.round(raw)));
}

function handleLeft(edge: 'in' | 'out', boundaryX: number, oppositeBoundaryX: number, clipWidth: number): number {
  const inBoundaryX = edge === 'in' ? boundaryX : oppositeBoundaryX;
  const outBoundaryX = edge === 'out' ? boundaryX : oppositeBoundaryX;
  const inLeft = preferredLeft('in', inBoundaryX, outBoundaryX, clipWidth);
  const outLeft = preferredLeft('out', inBoundaryX, outBoundaryX, clipWidth);
  if (Math.abs(inLeft - outLeft) >= 16) return edge === 'in' ? inLeft : outLeft;

  // Coincident or crossed boundaries can make the two upstream targets
  // overlap, especially after edge clamping. Move the pair as one so
  // each remains a full 16px target with a 2px gap inside the clip.
  const firstLeft = Math.max(0, Math.min(
    Math.floor(clipWidth - 34), Math.round((inLeft + outLeft) / 2 - 9),
  ));
  const inFirst = inLeft <= outLeft;
  return edge === 'in'
    ? firstLeft + (inFirst ? 0 : 18)
    : firstLeft + (inFirst ? 18 : 0);
}

/** The design-system quick-fade grip, with its drag lifecycle owned by the editor. */
export function TrackFadeHandle({
  edge,
  boundaryX,
  oppositeBoundaryX,
  clipWidth,
  className,
  style,
  ...buttonProps
}: TrackFadeHandleProps): React.ReactElement | null {
  // The two grips need room to remain legible and independently grabbable.
  if (clipWidth < 64) return null;

  const mirrored = edge === 'out';
  const left = handleLeft(edge, boundaryX, oppositeBoundaryX, clipWidth);

  return <button {...buttonProps} type="button" role="slider" data-fade-handle={edge}
    className={className ? `audacity-track-fade-handle ${className}` : 'audacity-track-fade-handle'}
    style={{ ...style, left }}>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true" style={mirrored ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M15.5 6.5V15.5H6.5V6.5H15.5Z" fill="#FFFFFF" stroke="#14151A" />
      <path d="M16 6.5C12.8421 6.5 6.5 12.8421 6.5 16V6.5H16Z"
        fill="#9295A6" fillOpacity="0.75" stroke="#14151A" />
    </svg>
  </button>;
}
