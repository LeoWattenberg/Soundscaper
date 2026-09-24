import React from 'react';
import './Track.css';

export interface TrackFadeShapeHandleProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  edge: 'in' | 'out';
  /** Position of the 16px hit target inside the host's positioned clip overlay. */
  left: number;
  top: number | string;
}

/** The upstream midpoint fade-shape dot; the host owns drag and keyboard behavior. */
export function TrackFadeShapeHandle({
  edge,
  left,
  top,
  className,
  style,
  ...buttonProps
}: TrackFadeShapeHandleProps): React.ReactElement {
  return <button {...buttonProps} type="button" role="slider" data-fade-shape-handle={edge}
    className={className ? `audacity-track-fade-shape-handle ${className}` : 'audacity-track-fade-shape-handle'}
    style={{ ...style, left, top }}>
    <span className="audacity-track-fade-shape-handle__dot" aria-hidden="true" />
  </button>;
}
