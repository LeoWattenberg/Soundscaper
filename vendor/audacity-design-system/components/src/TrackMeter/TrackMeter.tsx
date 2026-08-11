import React from 'react';
import { useTheme } from '../ThemeProvider';
import './TrackMeter.css';

export interface TrackMeterProps {
  /**
   * Current volume level (0-100)
   * @default 0
   */
  volume?: number;

  /**
   * Whether the meter is clipping
   * @default false
   */
  clipped?: boolean;

  /**
   * Meter style mode
   * @default 'default'
   */
  meterStyle?: 'default' | 'rms';

  /**
   * Recent peak level (0-100) - shown as a thin line
   */
  recentPeak?: number;

  /**
   * Max peak level (0-100) - shown as a thin black line
   */
  maxPeak?: number;

  /**
   * Meter width variant
   * @default 'mono' - 8px wide for mono tracks, 7px for stereo
   */
  variant?: 'mono' | 'stereo';

  /**
   * Additional CSS class
   */
  className?: string;
}

export const TrackMeter: React.FC<TrackMeterProps> = ({
  volume = 0,
  clipped = false,
  meterStyle = 'default',
  recentPeak,
  maxPeak,
  variant = 'mono',
  className = '',
}) => {
  const { theme } = useTheme();

  // Convert volume percentage to position from top (inverted - higher volume = lower position)
  const volumePercent = Math.max(0, Math.min(100, volume));
  const volumePosition = 100 - volumePercent; // 0% volume = 100% from top, 100% volume = 0% from top

  // Calculate RMS overlay (shown only in RMS mode)
  // RMS overlay shows as a lighter region from top to approximately 75% of the volume fill
  const rmsPosition = meterStyle === 'rms' ? volumePosition + (volumePercent * 0.25) : 100;

  const style = {
    '--tm-bg-meter': theme.background.control.meter.background,
    '--tm-fill-volume': theme.background.control.meter.fill,
    '--tm-fill-peak': theme.background.control.meter.peak,
    '--tm-fill-clipping': theme.semantic.error.background,
    '--tm-fill-rms': theme.background.control.meter.rms,
    '--tm-stroke-peak': theme.foreground.text.primary,
    '--tm-volume-position': `${volumePosition}%`,
    '--tm-rms-position': `${rmsPosition}%`,
  } as React.CSSProperties;

  return (
    <div className={`track-meter track-meter--${variant} ${className}`} style={style}>
      <div className="track-meter__bar">
        {/* Clipping region - top 6px */}
        <div className={`track-meter__clipping ${clipped ? 'track-meter__clipping--active' : ''}`} />

        {/* Main region - background from 8px down */}
        <div className="track-meter__main" />

        {/* Volume fill - always rendered, fills from bottom up based on volume level */}
        <div className={`track-meter__volume ${clipped ? 'track-meter__volume--clipping' : ''}`}>
          {/* RMS overlay - lighter region in RMS mode */}
          {meterStyle === 'rms' && volumePercent > 0 && (
            <div className="track-meter__rms" />
          )}
        </div>

        {/* Recent peak indicator - thin horizontal line */}
        {recentPeak !== undefined && recentPeak > 0 && (
          <div
            className="track-meter__recent-peak"
            style={{ top: `${100 - recentPeak}%` }}
          />
        )}

        {/* Max peak indicator - thin black horizontal line */}
        {maxPeak !== undefined && maxPeak > 0 && (
          <div
            className="track-meter__max-peak"
            style={{ top: `${100 - maxPeak}%` }}
          />
        )}
      </div>
    </div>
  );
};

export default TrackMeter;
