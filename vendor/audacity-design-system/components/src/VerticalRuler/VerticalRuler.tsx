import React from 'react';
import { useTheme } from '../ThemeProvider';
import './VerticalRuler.css';

export interface VerticalRulerProps {
  /**
   * Height of the ruler in pixels
   */
  height: number;
  /**
   * Minimum value on the scale
   * @default -1.0
   */
  min?: number;
  /**
   * Maximum value on the scale
   * @default 1.0
   */
  max?: number;
  /**
   * Number of major divisions (labeled ticks)
   * @default 5
   */
  majorDivisions?: number;
  /**
   * Number of minor divisions between each major division
   * @default 4
   */
  minorDivisions?: number;
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

/**
 * VerticalRuler component for displaying linear amplitude scale
 *
 * Displays a vertical ruler with major and minor tick marks and labels.
 * Used for showing amplitude values from -1.0 to 1.0 (or custom range).
 */
export const VerticalRuler: React.FC<VerticalRulerProps> = ({
  height,
  min = -1.0,
  max = 1.0,
  majorDivisions = 5,
  minorDivisions = 4,
  position = 'right',
  width = 32,
  className = '',
  headerHeight,
}) => {
  const { theme } = useTheme();

  // Calculate tick positions
  const range = max - min;
  const MIN_LABEL_SPACING = 24; // pixels needed per label (increased for better readability)

  // Check if we have enough space for different labeling tiers
  const MIN_TICK_SPACING = 6; // Minimum spacing for minor ticks
  const labelsFor01Increments = 21; // 0.1 increments
  const labelsFor05Increments = 5;  // 0.5 increments
  const labelsFor10Increments = 3;  // 1.0, 0.0, -1.0 only

  const spacingFor01 = height / (labelsFor01Increments - 1);
  const spacingFor05 = height / (labelsFor05Increments - 1);
  const spacingFor10 = height / (labelsFor10Increments - 1);

  // Check spacing for different minor tick densities
  const spacingWith4Minors01 = height / ((labelsFor01Increments - 1) * 2); // 0.05 increments (1 minor between 0.1)
  const spacingWith4Minors05 = height / ((labelsFor05Increments - 1) * 5); // 0.1 increments (4 minors between 0.5)
  const spacingWith1Minor05 = height / ((labelsFor05Increments - 1) * 2);  // 0.25 increments (1 minor between 0.5)
  const spacingWith1Minor10 = height / ((labelsFor10Increments - 1) * 2);  // 0.5 increments (1 minor between 1.0)

  const ticks: Array<{
    y: number;
    value: number;
    isMajor: boolean;
    isCenter: boolean;
    isFirst: boolean;
    isLast: boolean;
    showLabel: boolean;
  }> = [];

  if (spacingFor01 >= MIN_LABEL_SPACING && spacingWith4Minors01 >= MIN_TICK_SPACING) {
    // Tier 1: 0.1 labels + minor ticks (1.0, tick, 0.9, tick, 0.8...)
    const totalTicks = (labelsFor01Increments - 1) * 2 + 1; // 41 ticks
    for (let i = 0; i < totalTicks; i++) {
      const isMajor = i % 2 === 0;
      ticks.push({
        y: (i * height) / (totalTicks - 1),
        value: max - (i * range) / (totalTicks - 1),
        isMajor,
        isCenter: Math.abs(max - (i * range) / (totalTicks - 1)) < 0.01,
        isFirst: i === 0,
        isLast: i === totalTicks - 1,
        showLabel: isMajor,
      });
    }
  } else if (spacingFor01 >= MIN_LABEL_SPACING) {
    // Tier 2: 0.1 labels only, no minors (1.0, 0.9, 0.8...)
    for (let i = 0; i < labelsFor01Increments; i++) {
      ticks.push({
        y: (i * height) / (labelsFor01Increments - 1),
        value: max - (i * range) / (labelsFor01Increments - 1),
        isMajor: true,
        isCenter: Math.abs(max - (i * range) / (labelsFor01Increments - 1)) < 0.01,
        isFirst: i === 0,
        isLast: i === labelsFor01Increments - 1,
        showLabel: true,
      });
    }
  } else if (spacingFor05 >= MIN_LABEL_SPACING && spacingWith4Minors05 >= MIN_TICK_SPACING) {
    // Tier 3: 0.5 labels + 4 minors (1.0, tick, tick, tick, tick, 0.5...)
    const totalTicks = (labelsFor05Increments - 1) * 5 + 1; // 21 ticks
    for (let i = 0; i < totalTicks; i++) {
      const isMajor = i % 5 === 0;
      ticks.push({
        y: (i * height) / (totalTicks - 1),
        value: max - (i * range) / (totalTicks - 1),
        isMajor,
        isCenter: Math.abs(max - (i * range) / (totalTicks - 1)) < 0.01,
        isFirst: i === 0,
        isLast: i === totalTicks - 1,
        showLabel: isMajor,
      });
    }
  } else if (spacingFor05 >= MIN_LABEL_SPACING && spacingWith1Minor05 >= MIN_TICK_SPACING) {
    // Tier 4: 0.5 labels + 1 minor (1.0, tick, 0.5...)
    const totalTicks = (labelsFor05Increments - 1) * 2 + 1; // 9 ticks
    for (let i = 0; i < totalTicks; i++) {
      const isMajor = i % 2 === 0;
      ticks.push({
        y: (i * height) / (totalTicks - 1),
        value: max - (i * range) / (totalTicks - 1),
        isMajor,
        isCenter: Math.abs(max - (i * range) / (totalTicks - 1)) < 0.01,
        isFirst: i === 0,
        isLast: i === totalTicks - 1,
        showLabel: isMajor,
      });
    }
  } else if (spacingFor05 >= MIN_LABEL_SPACING) {
    // Tier 5: 0.5 labels only, no minors (1.0, 0.5, 0.0, -0.5, -1.0)
    for (let i = 0; i < labelsFor05Increments; i++) {
      ticks.push({
        y: (i * height) / (labelsFor05Increments - 1),
        value: max - (i * range) / (labelsFor05Increments - 1),
        isMajor: true,
        isCenter: Math.abs(max - (i * range) / (labelsFor05Increments - 1)) < 0.01,
        isFirst: i === 0,
        isLast: i === labelsFor05Increments - 1,
        showLabel: true,
      });
    }
  } else if (spacingFor10 >= MIN_LABEL_SPACING && spacingWith1Minor10 >= MIN_TICK_SPACING) {
    // Tier 6: 1.0, 0.0, -1.0 + 1 minor (1.0, tick, 0.0...)
    const totalTicks = (labelsFor10Increments - 1) * 2 + 1; // 5 ticks
    for (let i = 0; i < totalTicks; i++) {
      const isMajor = i % 2 === 0;
      ticks.push({
        y: (i * height) / (totalTicks - 1),
        value: max - (i * range) / (totalTicks - 1),
        isMajor,
        isCenter: Math.abs(max - (i * range) / (totalTicks - 1)) < 0.01,
        isFirst: i === 0,
        isLast: i === totalTicks - 1,
        showLabel: isMajor,
      });
    }
  } else if (height >= 40) {
    // Tier 7: 1.0, 0.0, -1.0 only, no minors (requires at least 40px for readable spacing)
    for (let i = 0; i < labelsFor10Increments; i++) {
      ticks.push({
        y: (i * height) / (labelsFor10Increments - 1),
        value: max - (i * range) / (labelsFor10Increments - 1),
        isMajor: true,
        isCenter: Math.abs(max - (i * range) / (labelsFor10Increments - 1)) < 0.01,
        isFirst: i === 0,
        isLast: i === labelsFor10Increments - 1,
        showLabel: true,
      });
    }
  } else {
    // Tier 8: Ultra-minimal for very small heights (< 40px) - center tick only, no labels
    ticks.push({
      y: height / 2,
      value: 0,
      isMajor: true,
      isCenter: true,
      isFirst: false,
      isLast: false,
      showLabel: false,
    });
  }

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
        {ticks.map((tick, index) => (
          <div
            key={index}
            className={`vertical-ruler__tick ${
              tick.isMajor ? 'vertical-ruler__tick--major' : 'vertical-ruler__tick--minor'
            } ${tick.isCenter ? 'vertical-ruler__tick--center' : ''} ${
              tick.isFirst ? 'vertical-ruler__tick--first' : ''
            } ${tick.isLast ? 'vertical-ruler__tick--last' : ''}`}
            style={{ top: `${tick.y}px` }}
          >
            {/* Horizontal grid line (only for center line at 0.0) */}
            {tick.isCenter && tick.isMajor && (
              <div className="vertical-ruler__grid-line" />
            )}

            {/* Tick mark */}
            <div className="vertical-ruler__tick-mark" />

            {/* Label (only for major ticks with showLabel=true) */}
            {tick.isMajor && tick.showLabel && (
              <div className="vertical-ruler__label">
                {tick.value.toFixed(1)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Optional header overlay */}
      {(headerHeight ?? 0) > 0 && (
        <div
          className="vertical-ruler__header"
          style={{ height: `${headerHeight}px` }}
        />
      )}
    </div>
  );
};

export default VerticalRuler;
