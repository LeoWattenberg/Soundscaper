import React from 'react';
import { useTheme } from '../ThemeProvider';
import { freqToY, getTicksForScale, type SpectrogramScale } from '../utils/spectrogramScales';
import './VerticalRuler.css';

export type { SpectrogramScale };

export interface FrequencyRulerProps {
  /**
   * Height of the ruler in pixels
   */
  height: number;
  /**
   * Minimum frequency in Hz
   * @default 10
   */
  minFreq?: number;
  /**
   * Maximum frequency in Hz
   * @default 22050 (Nyquist for 44.1kHz)
   */
  maxFreq?: number;
  /**
   * Frequency scale to display
   * @default 'mel'
   */
  scale?: SpectrogramScale;
  /**
   * Position of tick marks and labels
   * @default 'right'
   */
  position?: 'left' | 'right';
  /**
   * Width of the ruler in pixels
   * @default 80
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
 * FrequencyRuler — vertical ruler for spectrogram views.
 * Supports Linear, Logarithmic, Mel, Bark, ERB and Period scales.
 */
export const FrequencyRuler: React.FC<FrequencyRulerProps> = ({
  height,
  minFreq = 10,
  maxFreq = 22050,
  scale = 'mel',
  position = 'right',
  width = 80,
  className = '',
  headerHeight,
}) => {
  const { theme } = useTheme();

  const MIN_LABEL_SPACING = 14;

  // Build all ticks sorted top-to-bottom (ascending y)
  const scaleTicks = getTicksForScale(scale)
    .filter(t => t.value >= minFreq && t.value <= maxFreq);

  // Inject min/max as major ticks so the range endpoints always show
  const existingValues = new Set(scaleTicks.map(t => t.value));
  const formatHz = (hz: number) => hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}k` : String(hz);
  if (!existingValues.has(minFreq)) {
    scaleTicks.push({ value: minFreq, label: formatHz(minFreq), isMajor: true });
  }
  if (!existingValues.has(maxFreq)) {
    scaleTicks.push({ value: maxFreq, label: formatHz(maxFreq), isMajor: true });
  }

  const allTicks = scaleTicks
    .map(t => ({
      ...t,
      y: freqToY(t.value, minFreq, maxFreq, height, scale),
      showLabel: true,
    }))
    .sort((a, b) => a.y - b.y);

  // Greedy collision detection — majors take priority, then minors fill in
  // Pass 1: assign majors
  const placed: typeof allTicks = [];
  for (const tick of allTicks.filter(t => t.isMajor)) {
    const collides = placed.some(s => Math.abs(tick.y - s.y) < MIN_LABEL_SPACING);
    tick.showLabel = !collides;
    if (!collides) placed.push(tick);
  }
  // Pass 2: assign minors only where there's space (skip ticks with no label)
  for (const tick of allTicks.filter(t => !t.isMajor)) {
    if (!tick.label) { tick.showLabel = false; continue; }
    const collides = placed.some(s => Math.abs(tick.y - s.y) < MIN_LABEL_SPACING);
    tick.showLabel = !collides;
    if (!collides) placed.push(tick);
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

  // Find the last and first ticks that will show a label, for edge clamping
  const labelledTicks = allTicks.filter(t => t.showLabel);
  const firstLabelledY = labelledTicks.length > 0 ? labelledTicks[0].y : -1;
  const lastLabelledY  = labelledTicks.length > 0 ? labelledTicks[labelledTicks.length - 1].y : -1;

  return (
    <div
      className={`vertical-ruler vertical-ruler--${position} ${className}`}
      style={style}
    >
      <div className="vertical-ruler__ticks">
        {allTicks.map((tick) => (
          <div
            key={`${tick.value}-${tick.label}`}
            className={`vertical-ruler__tick ${
              tick.isMajor ? 'vertical-ruler__tick--major' : 'vertical-ruler__tick--minor'
            } ${tick.y === firstLabelledY ? 'vertical-ruler__tick--first' : ''
            } ${tick.y === lastLabelledY  ? 'vertical-ruler__tick--last'  : ''}`}
            style={{ top: `${tick.y}px` }}
          >
            <div className="vertical-ruler__tick-mark" />
            {tick.showLabel && (
              <div className="vertical-ruler__label">
                {tick.label}
              </div>
            )}
          </div>
        ))}
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

export default FrequencyRuler;
