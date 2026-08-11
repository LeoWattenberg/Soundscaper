import React from 'react';
import { useTheme } from '../ThemeProvider';
import './VerticalRuler.css';

export interface DbRulerProps {
  /**
   * Height of the ruler in pixels
   */
  height: number;
  /**
   * dB scale mode
   * - 'logarithmic': dB maps linearly to pixels (equal dB = equal pixel distance),
   *    -60 dB at center, 0 dB at edges
   * - 'linear': amplitude maps linearly to pixels (dB labels on linear amp scale),
   *    −∞ at center, 0 dB at edges
   * @default 'logarithmic'
   */
  scale?: 'logarithmic' | 'linear';
  /**
   * Position of tick marks and labels
   * @default 'right'
   */
  position?: 'left' | 'right';
  /**
   * Width of the ruler in pixels
   * @default 32
   */
  width?: number;
  /**
   * Additional CSS class name
   */
  className?: string;
  /**
   * Optional header height (shown as semi-transparent overlay at top)
   */
  headerHeight?: number;
}

/** Practical minimum dB for display */
const MIN_DB = -60;

const MIN_LABEL_SPACING = 14;
const MIN_TICK_SPACING = 4;

/**
 * Logarithmic (dB): dB maps linearly to pixels.
 * Equal dB steps = equal pixel distances.
 * 0 dB at edge (y=0), -60 dB at center (y=halfHeight).
 */
function dbToYDbLinear(db: number, halfHeight: number): number {
  return (Math.abs(db) / Math.abs(MIN_DB)) * halfHeight;
}

/**
 * Linear (dB): amplitude maps linearly to pixels.
 * dB labels placed at their corresponding amplitude positions.
 * 0 dB (amp=1) at edge, −∞ (amp=0) at center.
 */
function dbToYAmpLinear(db: number, halfHeight: number): number {
  if (db <= MIN_DB) return halfHeight;
  const amplitude = Math.pow(10, db / 20);
  return (1 - amplitude) * halfHeight;
}

function formatDb(db: number): string {
  if (db === 0) return '0';
  return `${db}`;
}

/**
 * DbRuler — symmetric waveform amplitude ruler in dB.
 *
 * Both modes display 0 dB at the top and bottom edges (full-scale ±1.0).
 * - Logarithmic: -60 dB at center, equal dB spacing
 * - Linear: −∞ at center, amplitude-proportional spacing
 */
export const DbRuler: React.FC<DbRulerProps> = ({
  height,
  scale = 'logarithmic',
  position = 'right',
  width = 32,
  className = '',
  headerHeight,
}) => {
  const { theme } = useTheme();
  const halfHeight = height / 2;
  const isLogarithmic = scale === 'logarithmic';
  const dbToY = isLogarithmic ? dbToYDbLinear : dbToYAmpLinear;

  // Label candidates in priority tiers — nice round values placed first
  const LABEL_TIERS: number[][] = [
    [0, MIN_DB],                                     // endpoints
    [MIN_DB / 2],                                    // midpoint (-30)
    [-12, -24, -36, -48],                            // every 12 dB
    [-6, -18, -42, -54],                             // every 6 dB
    [-3, -9, -15, -21, -27, -33, -39, -45, -51, -57], // every 3 dB
  ];

  // All 1-dB values for tick marks
  const allDbValues: number[] = [];
  for (let db = 0; db >= MIN_DB; db--) allDbValues.push(db);

  type HalfTick = { db: number; y: number; label: string; showLabel: boolean; showTick: boolean };

  const maxY = isLogarithmic ? halfHeight : halfHeight - 8;
  const halfCandidateMap = new Map<number, HalfTick>();

  // Create entries for all 1-dB values (for tick marks)
  for (const db of allDbValues) {
    const y = dbToY(db, halfHeight);
    if (y <= maxY) {
      halfCandidateMap.set(db, { db, y, label: formatDb(db), showLabel: false, showTick: true });
    }
  }

  // Place labels by priority tier — collision detection against already-placed labels
  const labelPlacedYs: number[] = [];
  for (const tier of LABEL_TIERS) {
    for (const db of tier) {
      const tick = halfCandidateMap.get(db);
      if (!tick) continue;
      const collides = labelPlacedYs.some(py => Math.abs(tick.y - py) < MIN_LABEL_SPACING);
      if (!collides) {
        tick.showLabel = true;
        labelPlacedYs.push(tick.y);
      }
    }
  }

  // Fill remaining 1-dB labels where space permits (lowest priority)
  for (const db of allDbValues) {
    const tick = halfCandidateMap.get(db);
    if (!tick || tick.showLabel) continue;
    const collides = labelPlacedYs.some(py => Math.abs(tick.y - py) < MIN_LABEL_SPACING);
    if (!collides) {
      tick.showLabel = true;
      labelPlacedYs.push(tick.y);
    }
  }

  // Tick-mark collision detection (suppress marks that are too dense)
  const halfCandidates = Array.from(halfCandidateMap.values()).sort((a, b) => a.y - b.y);
  const tickPlacedYs: number[] = [];
  for (const tick of halfCandidates) {
    const collides = tickPlacedYs.some(py => Math.abs(tick.y - py) < MIN_TICK_SPACING);
    if (collides) {
      tick.showTick = false;
      tick.showLabel = false;
    } else {
      tickPlacedYs.push(tick.y);
    }
  }

  // Build full tick list: top half + center + bottom half (mirrored)
  type TickData = {
    key: string;
    y: number;
    label: string;
    showLabel: boolean;
    isMajor: boolean;
    secondaryLabel: boolean;
    isCenter: boolean;
  };

  const allTicks: TickData[] = [];
  const visibleHalf = halfCandidates.filter(t => t.showTick);

  if (isLogarithmic) {
    // Logarithmic: -60 dB is the center value — it's the last candidate
    for (const t of visibleHalf) {
      const atCenter = Math.abs(t.y - halfHeight) < 0.5;
      allTicks.push({
        key: `top-${t.db}`,
        y: t.y,
        label: t.label,
        showLabel: t.showLabel,
        isMajor: t.showLabel, // major tick mark where labels are
        secondaryLabel: !atCenter, // secondary text style except center
        isCenter: atCenter,
      });
    }

    // Bottom half (mirror, excluding center to avoid duplicate)
    for (let i = visibleHalf.length - 1; i >= 0; i--) {
      const t = visibleHalf[i];
      const atCenter = Math.abs(t.y - halfHeight) < 0.5;
      if (atCenter) continue;
      allTicks.push({
        key: `bottom-${t.db}`,
        y: height - t.y,
        label: t.label,
        showLabel: t.showLabel,
        isMajor: t.showLabel,
        secondaryLabel: true,
        isCenter: false,
      });
    }
  } else {
    // Linear: −∞ at center
    for (const t of visibleHalf) {
      allTicks.push({
        key: `top-${t.db}`,
        y: t.y,
        label: t.label,
        showLabel: t.showLabel,
        isMajor: t.showLabel, // major tick mark where labels are
        secondaryLabel: true, // secondary text style for all dB labels
        isCenter: false,
      });
    }

    // −∞ at center
    allTicks.push({
      key: 'center',
      y: halfHeight,
      label: '-\u221E',
      showLabel: true,
      isMajor: true,
      secondaryLabel: false,
      isCenter: true,
    });

    // Bottom half (mirror)
    for (let i = visibleHalf.length - 1; i >= 0; i--) {
      const t = visibleHalf[i];
      allTicks.push({
        key: `bottom-${t.db}`,
        y: height - t.y,
        label: t.label,
        showLabel: t.showLabel,
        isMajor: t.showLabel,
        secondaryLabel: true,
        isCenter: false,
      });
    }
  }

  // Find first/last labelled for edge clamping
  const labelledTicks = allTicks.filter(t => t.showLabel);
  const firstLabelledY = labelledTicks.length > 0 ? labelledTicks[0].y : -1;
  const lastLabelledY = labelledTicks.length > 0 ? labelledTicks[labelledTicks.length - 1].y : -1;

  // Center Y for grid line (−60 dB or midpoint for −∞)
  const centerY = halfHeight;

  const style = {
    '--ruler-width': `${width}px`,
    '--ruler-height': `${height}px`,
    '--ruler-tick-primary': theme.stroke.ruler.primary,
    '--ruler-tick-secondary': theme.stroke.ruler.secondary,
    '--ruler-text-primary': theme.foreground.text.contrastPrimary,
    '--ruler-text-secondary': theme.foreground.text.contrastSecondary,
    '--ruler-grid-measure': theme.stroke.grid.measure,
    '--ruler-bg': theme.background.panel.ruler,
  } as React.CSSProperties;

  return (
    <div
      className={`vertical-ruler vertical-ruler--${position} ${className}`}
      style={style}
    >
      <div className="vertical-ruler__ticks">
        {/* Center grid line */}
        <div
          className="vertical-ruler__tick vertical-ruler__tick--major vertical-ruler__tick--center"
          style={{ top: `${centerY}px` }}
        >
          <div className="vertical-ruler__grid-line" />
        </div>

        {allTicks.map((tick) => {
          const isFirst = tick.showLabel && tick.y === firstLabelledY;
          const isLast = tick.showLabel && tick.y === lastLabelledY;

          return (
            <div
              key={tick.key}
              className={`vertical-ruler__tick ${
                tick.isMajor ? 'vertical-ruler__tick--major' : 'vertical-ruler__tick--minor'
              } ${tick.secondaryLabel ? 'vertical-ruler__tick--secondary-label' : ''
              } ${tick.isCenter ? 'vertical-ruler__tick--center' : ''
              } ${isFirst ? 'vertical-ruler__tick--first' : ''
              } ${isLast ? 'vertical-ruler__tick--last' : ''}`}
              style={{ top: `${tick.y}px` }}
            >
              <div className="vertical-ruler__tick-mark" />
              {tick.showLabel && (
                <div className="vertical-ruler__label">
                  {tick.label}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(headerHeight ?? 0) > 0 && (
        <div
          className="vertical-ruler__header"
          style={{ height: `${headerHeight}px` }}
        />
      )}
    </div>
  );
};

export default DbRuler;
