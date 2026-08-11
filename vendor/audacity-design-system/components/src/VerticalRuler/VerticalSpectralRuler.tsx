import React from 'react';
import { useTheme } from '../ThemeProvider';
import './VerticalRuler.css';

export interface VerticalSpectralRulerProps {
  /**
   * Height of the ruler in pixels
   */
  height: number;
  /**
   * Minimum frequency in Hz
   * @default 20
   */
  minFreq?: number;
  /**
   * Maximum frequency in Hz
   * @default 20000
   */
  maxFreq?: number;
  /**
   * Position of tick marks and labels
   * @default 'right'
   */
  position?: 'left' | 'right';
  /**
   * Width of the ruler in pixels
   * @default 48
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
 * Convert frequency to mel scale
 * Using the formula: mel = 2595 * log10(1 + f/700)
 */
function freqToMel(freq: number): number {
  return 2595 * Math.log10(1 + freq / 700);
}

/**
 * Convert mel scale back to frequency
 */
function melToFreq(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

/**
 * Format frequency for display
 */
function formatFreq(freq: number): string {
  if (freq >= 1000) {
    const kHz = freq / 1000;
    // Remove trailing zeros and decimal point if whole number
    return kHz % 1 === 0 ? `${kHz}k` : `${kHz.toFixed(1)}k`;
  }
  return freq.toString();
}

/**
 * Define uniform frequency tiers with "nice" round numbers
 * Each tier has major (labeled) and minor (unlabeled) frequencies
 */
const FREQUENCY_TIERS = {
  // Tier 1: Most detailed with minor ticks
  tier1: {
    major: [20, 50, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000],
    minor: [31.5, 40, 63, 80, 150, 180, 225, 280, 350, 450, 560, 710, 900, 1120, 1400, 1800, 2240, 2800, 3550, 4500, 5600, 7100, 9000, 11200, 14000, 17000, 18000, 19000] // Fill in gaps
  },
  // Tier 2: High detail with minor ticks
  tier2: {
    major: [20, 50, 100, 200, 315, 500, 800, 1000, 1600, 2500, 4000, 6300, 10000, 16000, 20000],
    minor: [31.5, 63, 125, 160, 250, 400, 630, 1250, 2000, 3150, 5000, 8000, 12500, 14000, 17000, 18000, 19000] // Fill in between majors
  },
  // Tier 3: Medium detail with minor ticks
  tier3: {
    major: [20, 100, 200, 500, 1000, 2000, 4000, 8000, 16000, 20000],
    minor: [50, 150, 315, 630, 800, 1250, 1600, 2500, 3150, 5000, 6300, 10000, 12500, 14000, 17000, 18000] // More minors
  },
  // Tier 4: Low detail with minor ticks
  tier4: {
    major: [20, 100, 500, 1000, 2000, 4000, 8000, 12500, 16000, 20000],
    minor: [50, 200, 315, 630, 800, 1250, 1600, 2500, 3150, 5000, 6300, 10000, 14000, 17000, 18000] // More minors
  },
  // Tier 5: Minimal detail with minor ticks
  tier5: {
    major: [20, 100, 500, 1000, 2000, 4000, 8000, 16000, 20000],
    minor: [50, 200, 315, 630, 800, 1250, 1600, 2500, 3150, 5000, 6300, 10000, 12500, 14000, 17000, 18000] // More minors
  },
  // Tier 6: Very minimal with minors
  tier6: {
    major: [20, 100, 1000, 4000, 8000, 16000, 20000],
    minor: [50, 200, 315, 500, 800, 1600, 2000, 2500, 3150, 5000, 6300, 10000, 12500, 14000, 17000, 18000] // More minors
  },
  // Tier 7: Absolute minimum (for very small track heights like 44px)
  tier7: {
    major: [20, 1000, 4000, 10000, 20000],
    minor: [50, 100, 200, 500, 800, 2000, 3000, 5000, 6000, 8000, 12000, 16000] // Essential reference points as minors
  },
  // Tier 8: Ultra-minimal (for very small heights < 40px) - single center tick only, no labels
  tier8: {
    major: [], // No labeled ticks
    minor: [1000] // Just a single center tick, unlabeled
  },
};

/**
 * VerticalSpectralRuler component for displaying frequency scale with mel spacing
 *
 * Displays a vertical ruler with frequency labels positioned using mel scale
 * for perceptually uniform spacing, but with uniform "nice" frequency values.
 */
export const VerticalSpectralRuler: React.FC<VerticalSpectralRulerProps> = ({
  height,
  minFreq = 20,
  maxFreq = 20000,
  position = 'right',
  width = 48,
  className = '',
  headerHeight,
}) => {
  const { theme } = useTheme();

  const MIN_LABEL_SPACING = 24; // pixels needed per label
  const MIN_TICK_SPACING = 6; // Minimum spacing for minor ticks

  // Convert min/max frequencies to mel scale
  const minMel = freqToMel(minFreq);
  const maxMel = freqToMel(maxFreq);
  const melRange = maxMel - minMel;

  // Helper function to check if a tier has sufficient spacing
  // We need to check the minimum mel-space distance, not average
  const checkTierSpacing = (majorFreqs: number[]): boolean => {
    if (majorFreqs.length < 2) return true;

    let minPixelSpacing = Infinity;
    for (let i = 0; i < majorFreqs.length - 1; i++) {
      const mel1 = freqToMel(majorFreqs[i]);
      const mel2 = freqToMel(majorFreqs[i + 1]);
      const melDiff = Math.abs(mel1 - mel2);
      const pixelSpacing = (melDiff / melRange) * height;
      minPixelSpacing = Math.min(minPixelSpacing, pixelSpacing);
    }
    return minPixelSpacing >= MIN_LABEL_SPACING;
  };

  // Choose appropriate tier based on actual mel-scale spacing
  let selectedTier: { major: number[], minor: number[] };

  if (height < 40) {
    // Ultra-minimal tier for very small heights
    selectedTier = FREQUENCY_TIERS.tier8;
  } else if (checkTierSpacing(FREQUENCY_TIERS.tier1.major)) {
    selectedTier = FREQUENCY_TIERS.tier1;
  } else if (checkTierSpacing(FREQUENCY_TIERS.tier2.major)) {
    selectedTier = FREQUENCY_TIERS.tier2;
  } else if (checkTierSpacing(FREQUENCY_TIERS.tier3.major)) {
    selectedTier = FREQUENCY_TIERS.tier3;
  } else if (checkTierSpacing(FREQUENCY_TIERS.tier4.major)) {
    selectedTier = FREQUENCY_TIERS.tier4;
  } else if (checkTierSpacing(FREQUENCY_TIERS.tier5.major)) {
    selectedTier = FREQUENCY_TIERS.tier5;
  } else if (checkTierSpacing(FREQUENCY_TIERS.tier6.major)) {
    selectedTier = FREQUENCY_TIERS.tier6;
  } else {
    selectedTier = FREQUENCY_TIERS.tier7;
  }

  // Filter frequencies to only those within our range
  const visibleMajorFreqs = selectedTier.major.filter(
    freq => freq >= minFreq && freq <= maxFreq
  );
  const visibleMinorFreqs = selectedTier.minor.filter(
    freq => freq >= minFreq && freq <= maxFreq
  );

  // Generate major ticks with mel-scale positioning and check for collisions
  const majorTicks = visibleMajorFreqs.map((freq, index) => {
    const mel = freqToMel(freq);
    const normalizedPosition = (maxMel - mel) / melRange;
    const y = normalizedPosition * height;

    return {
      y,
      freq,
      label: formatFreq(freq),
      shouldShow: true, // Will be set to false if it collides
    };
  });

  // Remove labels that would overlap (greedy algorithm, keeps first encountered)
  const LABEL_HEIGHT = 16; // Approximate label height in pixels
  for (let i = 0; i < majorTicks.length; i++) {
    if (!majorTicks[i].shouldShow) continue;

    for (let j = i + 1; j < majorTicks.length; j++) {
      if (!majorTicks[j].shouldShow) continue;

      const distance = Math.abs(majorTicks[i].y - majorTicks[j].y);
      if (distance < MIN_LABEL_SPACING) {
        majorTicks[j].shouldShow = false; // Hide the later label
      }
    }
  }

  // Combine major and minor frequencies into single tick array
  const allFrequencies = [
    ...visibleMajorFreqs.map(freq => ({ freq, isMajor: true })),
    ...visibleMinorFreqs.map(freq => ({ freq, isMajor: false })),
  ].sort((a, b) => b.freq - a.freq); // Sort descending (high to low)

  // Create lookup for which major labels should show
  const majorLabelsToShow = new Set(
    majorTicks.filter(t => t.shouldShow).map(t => t.freq)
  );

  // Generate ticks with mel-scale positioning
  const ticks = allFrequencies.map((item, index) => {
    const mel = freqToMel(item.freq);
    // Position from top (max frequency at top, min at bottom)
    const normalizedPosition = (maxMel - mel) / melRange;
    const y = normalizedPosition * height;

    const showLabel = item.isMajor && majorLabelsToShow.has(item.freq);

    return {
      y,
      freq: item.freq,
      isMajor: item.isMajor,
      label: showLabel ? formatFreq(item.freq) : '',
      showLabel,
    };
  });

  // Find first and last ticks that actually show labels
  const ticksWithLabels = ticks.filter(t => t.showLabel);
  const firstLabelFreq = ticksWithLabels.length > 0 ? ticksWithLabels[0].freq : null;
  const lastLabelFreq = ticksWithLabels.length > 0 ? ticksWithLabels[ticksWithLabels.length - 1].freq : null;

  // Add isFirst/isLast flags based on which ticks actually show labels
  const ticksWithFlags = ticks.map(tick => ({
    ...tick,
    isFirst: tick.freq === firstLabelFreq,
    isLast: tick.freq === lastLabelFreq,
  }));

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
        {ticksWithFlags.map((tick, index) => (
          <div
            key={index}
            className={`vertical-ruler__tick ${
              tick.isMajor ? 'vertical-ruler__tick--major' : 'vertical-ruler__tick--minor'
            } ${tick.isFirst ? 'vertical-ruler__tick--first' : ''} ${
              tick.isLast ? 'vertical-ruler__tick--last' : ''
            }`}
            style={{ top: `${tick.y}px` }}
          >
            {/* Tick mark */}
            <div className="vertical-ruler__tick-mark" />

            {/* Label (only for major ticks) */}
            {tick.showLabel && (
              <div className="vertical-ruler__label">
                {tick.label}
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

export default VerticalSpectralRuler;
