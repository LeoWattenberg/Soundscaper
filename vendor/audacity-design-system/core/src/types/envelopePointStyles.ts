/**
 * Envelope point style profiles
 * Different visual styles for envelope control points
 */

export interface EnvelopePointStyle {
  /** Profile name */
  name: string;
  /** Point outer radius in normal state (px) */
  outerRadius: number;
  /** Point inner radius in normal state (px) */
  innerRadius: number;
  /** Point outer radius in hover state (px) */
  outerRadiusHover: number;
  /** Point inner radius in hover state (px) */
  innerRadiusHover: number;
  /** Automation line thickness (px) */
  lineWidth: number;
  /** Dual ring configuration for hover state */
  dualRingHover?: {
    /** Inner ring (white): outer radius */
    innerRingOuter: number;
    /** Inner ring (white): inner radius */
    innerRingInner: number;
    /** Inner ring color */
    innerRingColor: string;
    /** Outer ring (black): outer radius */
    outerRingOuter: number;
    /** Outer ring (black): inner radius */
    outerRingInner: number;
    /** Outer ring color */
    outerRingColor: string;
  };
  /** Custom ring color on hover (hex color, e.g. '#ffffff' for white) */
  hoverRingColor?: string;
  /** Ring stroke color on hover (hex color, e.g. '#000000' for black) */
  hoverRingStrokeColor?: string;
  /** Show white outline on hover */
  showWhiteOutlineOnHover?: boolean;
  /** Show black outline on hover (outside white outline if both present) */
  showBlackOutlineOnHover?: boolean;
  /** Show black center dot on hover */
  showBlackCenterOnHover?: boolean;
  /** Show green center fill on hover (radius in px) */
  showGreenCenterFillOnHover?: number;
  /** White/black center configuration on hover */
  whiteCenterOnHover?: {
    /** Inner white circle radius */
    innerRadius: number;
    /** Outer white circle radius */
    outerRadius: number;
    /** Black circle radius (between white and green) */
    blackRadius: number;
  };
  /** White/black center configuration (always visible, not just on hover) */
  whiteCenter?: {
    /** Inner white circle radius */
    innerRadius: number;
    /** Outer white circle radius */
    outerRadius: number;
    /** Black circle radius (between white and green) */
    blackRadius: number;
  };
  /** Override the automation line color (overrides theme value) */
  lineColor?: string;
  /** Draw the automation line as dual stroke: black outline + white overlay */
  dualStrokeLine?: boolean;
  /** Solid circle configuration (no donut hole) */
  solidCircle?: {
    /** Fill color for the solid circle */
    fillColor: string;
    /** Stroke color for the outline */
    strokeColor: string;
    /** Stroke color on hover (optional, overrides strokeColor) */
    strokeColorHover?: string;
    /** Stroke width in pixels */
    strokeWidth: number;
    /** Stroke width on hover (optional, overrides strokeWidth) */
    strokeWidthHover?: number;
    /** Outer stroke color (optional, rendered outside the main stroke) */
    outerStrokeColor?: string;
    /** Outer stroke width in pixels (optional) */
    outerStrokeWidth?: number;
    /** Radius for normal state */
    radius: number;
    /** Radius for hover state */
    radiusHover: number;
    /** Cursor follower radius (optional, defaults to 3) */
    cursorFollowerRadius?: number;
    /** Use dual-ring cursor follower (white inner + black outer, no fill) */
    useDualRingCursorFollower?: boolean;
    /** Break the envelope line at cursor follower position */
    breakLineAtCursor?: boolean;
    /** White center configuration on hover */
    whiteCenterOnHover?: {
      /** Inner white circle radius */
      innerRadius: number;
      /** Outer white circle radius */
      outerRadius: number;
      /** Black circle radius (between white and green) */
      blackRadius: number;
    };
  };
}

export const ENVELOPE_POINT_STYLES: Record<string, EnvelopePointStyle> = {
  solidGreenSimple: {
    name: 'Solid Green Simple',
    outerRadius: 5,
    innerRadius: 0,
    outerRadiusHover: 6,
    innerRadiusHover: 0,
    lineWidth: 2,
    solidCircle: {
      fillColor: '#b8ff00',
      strokeColor: '#b8ff00',
      strokeWidth: 0,
      radius: 4.5,       // 9px diameter idle
      radiusHover: 5.5,  // 11px diameter hover
      cursorFollowerRadius: 3.5,
      useDualRingCursorFollower: false,
      breakLineAtCursor: false,
      whiteCenterOnHover: {
        innerRadius: 0,   // White center is solid, 3px diameter
        outerRadius: 1.5, // White fills to 3px diameter
        blackRadius: 3.5, // Black fills to 7px diameter; white sits on top
      },
    },
  },
};

export type EnvelopePointStyleKey = keyof typeof ENVELOPE_POINT_STYLES;
