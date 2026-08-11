import React from 'react';
import { dbToYNonLinear } from '../utils/envelope';
import type { EnvelopePointData } from '../utils/envelope';
import './EnvelopeOverlay.css';

export interface EnvelopeOverlayProps {
  /** Envelope points */
  points: EnvelopePointData[];
  /** Clip duration in seconds */
  duration: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Y offset for split view mode */
  yOffset?: number;
  /** Line color */
  lineColor?: string;
  /** Point outer color */
  pointColor?: string;
  /** Point center color */
  pointCenterColor?: string;
  /** Indices of hidden points (during drag) */
  hiddenPointIndices?: number[];
  /** Indices of hovered points (can be multiple during segment drag) */
  hoveredPointIndices?: number[];
  /** Cursor position on envelope (for cursor follower dot) */
  cursorPosition?: { time: number; db: number } | null;
  /** Point sizes */
  pointSizes?: {
    outerRadius: number;
    innerRadius: number;
    outerRadiusHover: number;
    innerRadiusHover: number;
    lineWidth?: number;
    dualRingHover?: {
      innerRingOuter: number;
      innerRingInner: number;
      innerRingColor: string;
      outerRingOuter: number;
      outerRingInner: number;
      outerRingColor: string;
    };
    solidCircle?: {
      fillColor: string;
      strokeColor: string;
      strokeColorHover?: string;
      strokeWidth: number;
      strokeWidthHover?: number;
      outerStrokeColor?: string;
      outerStrokeWidth?: number;
      radius: number;
      radiusHover: number;
      cursorFollowerRadius?: number;
      useDualRingCursorFollower?: boolean;
      breakLineAtCursor?: boolean;
      whiteCenterOnHover?: {
        innerRadius: number;
        outerRadius: number;
        blackRadius: number;
      };
    };
    hoverRingColor?: string;
    hoverRingStrokeColor?: string;
    showWhiteOutlineOnHover?: boolean;
    showBlackOutlineOnHover?: boolean;
    showBlackCenterOnHover?: boolean;
    showGreenCenterFillOnHover?: number;
    /** Draw line as dual stroke: black outline + white overlay */
    dualStrokeLine?: boolean;
    whiteCenterOnHover?: {
      innerRadius: number;
      outerRadius: number;
      blackRadius: number;
    };
    whiteCenter?: {
      innerRadius: number;
      outerRadius: number;
      blackRadius: number;
    };
  };
}

/**
 * EnvelopeOverlay - SVG-based envelope rendering
 *
 * Renders the envelope curve and control points as SVG for crisp,
 * resolution-independent rendering at all zoom levels.
 */
export const EnvelopeOverlay: React.FC<EnvelopeOverlayProps> = ({
  points,
  duration,
  width,
  height,
  yOffset = 0,
  lineColor = '#ffffff',
  pointColor = '#ffffff',
  pointCenterColor = '#000000',
  hiddenPointIndices = [],
  hoveredPointIndices = [],
  cursorPosition = null,
  pointSizes = {
    outerRadius: 5,    // 10px diameter (AU4 style)
    innerRadius: 3,    // Creates 2px visual stroke/ring
    outerRadiusHover: 6,
    innerRadiusHover: 4,
  },
}) => {
  // Filter out hidden points
  const visiblePoints = points.filter((_, index) => !hiddenPointIndices.includes(index));

  // Calculate 0dB Y position
  const zeroDB_Y = dbToYNonLinear(0, 0, height);

  // Helper function to calculate point on circle edge
  const getCircleEdgePoint = (centerX: number, centerY: number, targetX: number, targetY: number, radius: number) => {
    const dx = targetX - centerX;
    const dy = targetY - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance === 0) return { x: centerX, y: centerY };

    // Calculate point on circle edge in direction of target
    const ratio = radius / distance;
    return {
      x: centerX + dx * ratio,
      y: centerY + dy * ratio,
    };
  };

  // Generate SVG path for envelope line
  const generatePath = (): string => {
    if (visiblePoints.length === 0) {
      // No points - draw horizontal line at 0dB
      return `M 0,${zeroDB_Y} L ${width},${zeroDB_Y}`;
    }

    const pathSegments: string[] = [];
    // Use the correct radius based on rendering mode
    const radius = pointSizes.solidCircle
      ? (pointSizes.solidCircle.radius + pointSizes.solidCircle.strokeWidth + (pointSizes.solidCircle.outerStrokeWidth || 0))
      : pointSizes.outerRadius;

    // First segment: from start to first point (stop at circle edge)
    const firstY = dbToYNonLinear(visiblePoints[0].db, 0, height);
    const firstX = (visiblePoints[0].time / duration) * width;
    const firstEdge = getCircleEdgePoint(firstX, firstY, 0, firstY, radius);
    pathSegments.push(`M 0,${firstY}`);
    pathSegments.push(`L ${firstEdge.x},${firstEdge.y}`);

    // Segments between points (skip the circle interiors)
    for (let i = 0; i < visiblePoints.length - 1; i++) {
      const x1 = (visiblePoints[i].time / duration) * width;
      const y1 = dbToYNonLinear(visiblePoints[i].db, 0, height);
      const x2 = (visiblePoints[i + 1].time / duration) * width;
      const y2 = dbToYNonLinear(visiblePoints[i + 1].db, 0, height);

      // Start from edge of first circle pointing towards second
      const startEdge = getCircleEdgePoint(x1, y1, x2, y2, radius);
      // End at edge of second circle pointing from first
      const endEdge = getCircleEdgePoint(x2, y2, x1, y1, radius);

      pathSegments.push(`M ${startEdge.x},${startEdge.y}`);
      pathSegments.push(`L ${endEdge.x},${endEdge.y}`);
    }

    // Last segment: from last point to end (start at circle edge)
    const lastPoint = visiblePoints[visiblePoints.length - 1];
    // Use a small epsilon for floating point comparison
    if (lastPoint.time < duration - 0.001) {
      const lastX = (lastPoint.time / duration) * width;
      const lastY = dbToYNonLinear(lastPoint.db, 0, height);
      const lastEdge = getCircleEdgePoint(lastX, lastY, width, lastY, radius);
      pathSegments.push(`M ${lastEdge.x},${lastEdge.y}`);
      pathSegments.push(`L ${width},${lastY}`);
    }

    return pathSegments.join(' ');
  };

  // Check if we have only boundary points (don't render control points)
  const hasBoundaryPoints = visiblePoints.length === 2 &&
                            visiblePoints[0].time === 0 &&
                            Math.abs(visiblePoints[1].time - duration) < 0.001;

  const showControlPoints = visiblePoints.length > 0 && !hasBoundaryPoints;

  return (
    <svg
      className="envelope-overlay"
      style={{
        position: 'absolute',
        top: yOffset,
        left: 0,
        width,
        height,
        pointerEvents: 'none',
        zIndex: 2, // Above canvas (z-index: 2) but below interaction layer (z-index: 3)
      }}
    >
      <defs>
        {/* Glow filter for control points */}
        <filter id="glow-filter" x="-200%" y="-200%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="glow-filter-hover" x="-200%" y="-200%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Mask for breaking line at cursor position */}
      {pointSizes.solidCircle?.breakLineAtCursor && cursorPosition && hoveredPointIndices.length === 0 && !hasBoundaryPoints && (
        <defs>
          <mask id="line-break-mask">
            {/* Start with everything visible (white) */}
            <rect x="0" y="0" width={width} height={height} fill="white" />
            {/* Hide where the rings are: outer radius 6, inner radius 4 (transparent center < 4) */}
            <circle
              cx={(cursorPosition.time / duration) * width}
              cy={dbToYNonLinear(cursorPosition.db, 0, height)}
              r={pointSizes.solidCircle.cursorFollowerRadius ?? 3}
              fill="black"
            />
            {/* Show center area where there's no ring (radius < 4, but account for 2px line) */}
            <circle
              cx={(cursorPosition.time / duration) * width}
              cy={dbToYNonLinear(cursorPosition.db, 0, height)}
              r={(pointSizes.solidCircle.cursorFollowerRadius ?? 3) - 2.5}
              fill="white"
            />
          </mask>
        </defs>
      )}

      {/* Envelope line */}
      {pointSizes.dualStrokeLine ? (
        <>
          {/* Black shadow stroke (3px) */}
          <path
            d={generatePath()}
            stroke="#000000"
            strokeWidth={3}
            strokeLinecap="butt"
            strokeLinejoin="miter"
            fill="none"
          />
          {/* White overlay stroke (1px) */}
          <path
            d={generatePath()}
            stroke="#ffffff"
            strokeWidth={1}
            strokeLinecap="butt"
            strokeLinejoin="miter"
            fill="none"
          />
        </>
      ) : (
        <path
          d={generatePath()}
          stroke={lineColor}
          strokeWidth={pointSizes.lineWidth ?? 2}
          strokeLinecap="butt"
          mask={pointSizes.solidCircle?.breakLineAtCursor && cursorPosition && hoveredPointIndices.length === 0 && !hasBoundaryPoints ? 'url(#line-break-mask)' : undefined}
          strokeLinejoin="miter"
          fill="none"
        />
      )}

      {/* Control points */}
      {showControlPoints && visiblePoints.map((point, index) => {
        const px = (point.time / duration) * width;
        const py = dbToYNonLinear(point.db, 0, height);
        const isHovered = hoveredPointIndices.includes(index);
        // Use hover sizes if hovered, otherwise normal sizes
        const outerRadius = isHovered ? pointSizes.outerRadiusHover : pointSizes.outerRadius;
        const innerRadius = isHovered ? pointSizes.innerRadiusHover : pointSizes.innerRadius;
        const maskId = `point-mask-${index}`;
        const ringThickness = 1;

        return (
          <g key={index} className={`envelope-point ${isHovered ? 'envelope-point--hovered' : ''}`}>
            {pointSizes.solidCircle ? (
              <>
                {/* Solid circle mode */}
                {/* Outer white stroke (rendered first, underneath) */}
                {pointSizes.solidCircle.outerStrokeColor && pointSizes.solidCircle.outerStrokeWidth && (
                  <circle
                    cx={px}
                    cy={py}
                    r={isHovered ? pointSizes.solidCircle.radiusHover : pointSizes.solidCircle.radius}
                    fill="none"
                    stroke={pointSizes.solidCircle.outerStrokeColor}
                    strokeWidth={(pointSizes.solidCircle.strokeWidth || 0) + (pointSizes.solidCircle.outerStrokeWidth * 2)}
                  />
                )}
                {/* Main circle with fill and stroke */}
                <circle
                  cx={px}
                  cy={py}
                  r={isHovered ? pointSizes.solidCircle.radiusHover : pointSizes.solidCircle.radius}
                  fill={pointSizes.solidCircle.fillColor}
                  stroke={isHovered && pointSizes.solidCircle.strokeColorHover ? pointSizes.solidCircle.strokeColorHover : pointSizes.solidCircle.strokeColor}
                  strokeWidth={isHovered && pointSizes.solidCircle.strokeWidthHover !== undefined ? pointSizes.solidCircle.strokeWidthHover : pointSizes.solidCircle.strokeWidth}
                />
                {/* White center configuration on hover (optional) */}
                {isHovered && pointSizes.solidCircle.whiteCenterOnHover && (
                  <>
                    {/* Black circle (sits between white ring and green circle) */}
                    <circle
                      cx={px}
                      cy={py}
                      r={pointSizes.solidCircle.whiteCenterOnHover.blackRadius}
                      fill="#000000"
                    />
                    {/* White donut ring (4px outer, 2px inner) */}
                    <circle
                      cx={px}
                      cy={py}
                      r={pointSizes.solidCircle.whiteCenterOnHover.outerRadius}
                      fill="#ffffff"
                    />
                    <circle
                      cx={px}
                      cy={py}
                      r={pointSizes.solidCircle.whiteCenterOnHover.innerRadius}
                      fill="#000000"
                    />
                  </>
                )}
              </>
            ) : pointCenterColor === 'transparent' ? (
              <>
                {(isHovered && (pointSizes.dualRingHover || pointSizes.showWhiteOutlineOnHover || pointSizes.showBlackOutlineOnHover || pointSizes.showBlackCenterOnHover || pointSizes.showGreenCenterFillOnHover || pointSizes.whiteCenterOnHover)) || pointSizes.whiteCenter ? (
                  <>
                    {/* Hovered with special effects */}
                    {pointSizes.dualRingHover ? (
                      <>
                        {/* Dual ring mode: white inner ring + black outer ring */}
                        <defs>
                          <mask id={`${maskId}-outer`}>
                            <circle cx={px} cy={py} r={pointSizes.dualRingHover.outerRingOuter} fill="white" />
                            <circle cx={px} cy={py} r={pointSizes.dualRingHover.outerRingInner} fill="black" />
                          </mask>
                          <mask id={`${maskId}-inner`}>
                            <circle cx={px} cy={py} r={pointSizes.dualRingHover.innerRingOuter} fill="white" />
                            <circle cx={px} cy={py} r={pointSizes.dualRingHover.innerRingInner} fill="black" />
                          </mask>
                        </defs>
                        {/* Black outer ring */}
                        <circle
                          cx={px}
                          cy={py}
                          r={pointSizes.dualRingHover.outerRingOuter}
                          fill={pointSizes.dualRingHover.outerRingColor}
                          mask={`url(#${maskId}-outer)`}
                        />
                        {/* White inner ring */}
                        <circle
                          cx={px}
                          cy={py}
                          r={pointSizes.dualRingHover.innerRingOuter}
                          fill={pointSizes.dualRingHover.innerRingColor}
                          mask={`url(#${maskId}-inner)`}
                        />
                      </>
                    ) : (
                      <>
                        {/* Single ring mode */}
                        <defs>
                          <mask id={maskId}>
                            <circle cx={px} cy={py} r={outerRadius} fill="white" />
                            <circle cx={px} cy={py} r={(pointSizes.whiteCenterOnHover || pointSizes.whiteCenter) ? (pointSizes.whiteCenterOnHover || pointSizes.whiteCenter)!.blackRadius : innerRadius} fill="black" />
                          </mask>
                        </defs>
                        <circle
                          cx={px}
                          cy={py}
                          r={outerRadius}
                          fill={pointColor}
                          mask={`url(#${maskId})`}
                        />
                        {/* White/black rings inside green (if configured) */}
                        {(pointSizes.whiteCenterOnHover || pointSizes.whiteCenter) && (
                          <>
                            <defs>
                              <mask id={`${maskId}-black`}>
                                <circle cx={px} cy={py} r={(pointSizes.whiteCenterOnHover || pointSizes.whiteCenter)!.blackRadius} fill="white" />
                                <circle cx={px} cy={py} r={(pointSizes.whiteCenterOnHover || pointSizes.whiteCenter)!.outerRadius} fill="black" />
                              </mask>
                              <mask id={`${maskId}-white`}>
                                <circle cx={px} cy={py} r={(pointSizes.whiteCenterOnHover || pointSizes.whiteCenter)!.outerRadius} fill="white" />
                                <circle cx={px} cy={py} r={(pointSizes.whiteCenterOnHover || pointSizes.whiteCenter)!.innerRadius} fill="black" />
                              </mask>
                            </defs>
                            {/* Black ring */}
                            <circle
                              cx={px}
                              cy={py}
                              r={(pointSizes.whiteCenterOnHover || pointSizes.whiteCenter)!.blackRadius}
                              fill="#000000"
                              mask={`url(#${maskId}-black)`}
                            />
                            {/* White ring */}
                            <circle
                              cx={px}
                              cy={py}
                              r={(pointSizes.whiteCenterOnHover || pointSizes.whiteCenter)!.outerRadius}
                              fill="#ffffff"
                              mask={`url(#${maskId}-white)`}
                            />
                          </>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {/* Normal: thin green ring with transparent center */}
                    <defs>
                      <mask id={maskId}>
                        <circle cx={px} cy={py} r={outerRadius} fill="white" />
                        <circle cx={px} cy={py} r={innerRadius} fill="black" />
                      </mask>
                    </defs>
                    <circle
                      cx={px}
                      cy={py}
                      r={outerRadius}
                      fill={pointColor}
                      mask={`url(#${maskId})`}
                    />
                  </>
                )}
              </>
            ) : (
              <>
                {/* Outer circle */}
                <circle
                  cx={px}
                  cy={py}
                  r={outerRadius}
                  fill={pointColor}
                />
                {/* Inner circle */}
                <circle
                  cx={px}
                  cy={py}
                  r={innerRadius}
                  fill={pointCenterColor}
                />
              </>
            )}
          </g>
        );
      })}

      {/* Cursor follower dot (hidden when hovering over a point) */}
      {cursorPosition && hoveredPointIndices.length === 0 && (
        <>
          {pointSizes.solidCircle?.useDualRingCursorFollower ? (
            <>
              {/* Dual-ring cursor follower (white inner + black outer, no fill) */}
              <defs>
                <mask id="cursor-follower-outer-mask">
                  <circle
                    cx={(cursorPosition.time / duration) * width}
                    cy={dbToYNonLinear(cursorPosition.db, 0, height)}
                    r={pointSizes.solidCircle.cursorFollowerRadius ?? 3}
                    fill="white"
                  />
                  <circle
                    cx={(cursorPosition.time / duration) * width}
                    cy={dbToYNonLinear(cursorPosition.db, 0, height)}
                    r={(pointSizes.solidCircle.cursorFollowerRadius ?? 3) - 1}
                    fill="black"
                  />
                </mask>
                <mask id="cursor-follower-inner-mask">
                  <circle
                    cx={(cursorPosition.time / duration) * width}
                    cy={dbToYNonLinear(cursorPosition.db, 0, height)}
                    r={(pointSizes.solidCircle.cursorFollowerRadius ?? 3) - 1}
                    fill="white"
                  />
                  <circle
                    cx={(cursorPosition.time / duration) * width}
                    cy={dbToYNonLinear(cursorPosition.db, 0, height)}
                    r={(pointSizes.solidCircle.cursorFollowerRadius ?? 3) - 2}
                    fill="black"
                  />
                </mask>
              </defs>
              {/* White outer ring */}
              <circle
                cx={(cursorPosition.time / duration) * width}
                cy={dbToYNonLinear(cursorPosition.db, 0, height)}
                r={pointSizes.solidCircle.cursorFollowerRadius ?? 3}
                fill="#ffffff"
                mask="url(#cursor-follower-outer-mask)"
                className="cursor-follower"
              />
              {/* Black inner ring */}
              <circle
                cx={(cursorPosition.time / duration) * width}
                cy={dbToYNonLinear(cursorPosition.db, 0, height)}
                r={(pointSizes.solidCircle.cursorFollowerRadius ?? 3) - 1}
                fill="#000000"
                mask="url(#cursor-follower-inner-mask)"
                className="cursor-follower"
              />
            </>
          ) : pointSizes.solidCircle ? (
            <circle
              cx={(cursorPosition.time / duration) * width}
              cy={dbToYNonLinear(cursorPosition.db, 0, height)}
              r={pointSizes.solidCircle.cursorFollowerRadius ?? 3}
              fill={pointSizes.solidCircle.fillColor}
              stroke={pointSizes.solidCircle.strokeColor}
              strokeWidth={pointSizes.solidCircle.strokeWidth}
              className="cursor-follower"
            />
          ) : (
            <circle
              cx={(cursorPosition.time / duration) * width}
              cy={dbToYNonLinear(cursorPosition.db, 0, height)}
              r={3}
              fill={pointColor}
              className="cursor-follower"
            />
          )}
        </>
      )}
    </svg>
  );
};
