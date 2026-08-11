import React from 'react';
import { useTheme } from '../ThemeProvider';
import { ToolButton } from '../ToolButton';
import './MasterMeterVertical.css';

export interface MasterMeterVerticalProps {
  /** Current left channel level in dB (-60 to 0) */
  levelLeft?: number;
  /** Current right channel level in dB (-60 to 0) */
  levelRight?: number;
  /** Whether the left channel is clipping */
  clippedLeft?: boolean;
  /** Whether the right channel is clipping */
  clippedRight?: boolean;
  /** Recent peak level left in dB */
  recentPeakLeft?: number;
  /** Recent peak level right in dB */
  recentPeakRight?: number;
  /** Master volume (0 to 1, where 1 = 0dB) */
  volume?: number;
  /** Callback when volume slider changes */
  onVolumeChange?: (volume: number) => void;
  /** Callback when the volume settings button is clicked */
  onSettingsClick?: () => void;
  /** Additional CSS class */
  className?: string;
}

/** Major numeric tick values, top → bottom. */
const DB_LABELS = [0, -6, -12, -18, -24, -30, -36, -42, -48, -54, -60];
const DB_MIN = -60;
const DB_MAX = 0;
/** Two unlabelled minor ticks between each pair of numeric ticks. */
const MINOR_TICKS_BETWEEN = 2;

/** Returns vertical position 0–100 from the TOP for a given dB value
 *  (0 dB → 0%, −60 dB → 100%). */
function dbToYPercent(db: number): number {
  const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));
  return ((DB_MAX - clamped) / (DB_MAX - DB_MIN)) * 100;
}

/** Returns the bar fill HEIGHT as a percent (0 dB → 100%, −60 dB → 0%). */
function dbToFillPercent(db: number): number {
  const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));
  return ((clamped - DB_MIN) / (DB_MAX - DB_MIN)) * 100;
}

function volumeToDb(volume: number): number {
  if (volume <= 0) return DB_MIN;
  return Math.max(DB_MIN, 20 * Math.log10(volume));
}

function dbToVolume(db: number): number {
  if (db <= DB_MIN) return 0;
  return Math.pow(10, db / 20);
}

export const MasterMeterVertical: React.FC<MasterMeterVerticalProps> = ({
  levelLeft = -60,
  levelRight = -60,
  clippedLeft = false,
  clippedRight = false,
  recentPeakLeft,
  recentPeakRight,
  volume = 1,
  onVolumeChange,
  onSettingsClick,
  className = '',
}) => {
  const { theme } = useTheme();
  const trackRef = React.useRef<HTMLDivElement>(null);
  const draggingRef = React.useRef(false);
  const onVolumeChangeRef = React.useRef(onVolumeChange);
  onVolumeChangeRef.current = onVolumeChange;

  const leftFill = dbToFillPercent(levelLeft);
  const rightFill = dbToFillPercent(levelRight);
  const thumbY = dbToYPercent(volumeToDb(volume));
  const peakLeftY = recentPeakLeft !== undefined ? dbToYPercent(recentPeakLeft) : undefined;
  const peakRightY = recentPeakRight !== undefined ? dbToYPercent(recentPeakRight) : undefined;

  const updateVolumeFromY = React.useCallback((clientY: number) => {
    if (!trackRef.current || !onVolumeChangeRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const yFromTop = clientY - rect.top;
    const percentFromTop = Math.max(0, Math.min(100, (yFromTop / rect.height) * 100));
    // Top of track = 0 dB, bottom = DB_MIN.
    const db = DB_MAX - (percentFromTop / 100) * (DB_MAX - DB_MIN);
    onVolumeChangeRef.current(dbToVolume(db));
  }, []);

  React.useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = true;
      updateVolumeFromY(e.clientY);

      const handleMouseMove = (ev: MouseEvent) => {
        if (draggingRef.current) updateVolumeFromY(ev.clientY);
      };
      const handleMouseUp = () => {
        draggingRef.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };

    track.addEventListener('mousedown', handleMouseDown);
    return () => track.removeEventListener('mousedown', handleMouseDown);
  }, [updateVolumeFromY]);

  const style = {
    '--mmv-surface': theme.background.toolbar,
    '--mmv-border': theme.border.divider,
    '--mmv-bar-bg': theme.background.control.meter.background,
    '--mmv-bar-fill': theme.background.control.meter.fill,
    '--mmv-bar-peak': theme.background.control.meter.peak,
    '--mmv-clip': theme.semantic.error.background,
    '--mmv-text': theme.foreground.text.primary,
    '--mmv-thumb-bg': theme.background.control.slider.handle.background,
    '--mmv-thumb-border': theme.background.control.slider.handle.border,
  } as React.CSSProperties;

  return (
    <div className={`master-meter-vertical ${className}`} style={style}>
      <ToolButton
        icon="volume"
        ariaLabel="Playback volume settings"
        onClick={onSettingsClick}
      />

      <div className="master-meter-vertical__meter-row">
        <div ref={trackRef} className="master-meter-vertical__bars" role="slider"
             aria-label="Master volume"
             aria-valuemin={0}
             aria-valuemax={100}
             aria-valuenow={Math.round(volume * 100)}
             aria-orientation="vertical"
             tabIndex={0}
             onKeyDown={(e) => {
               if (!onVolumeChange) return;
               e.stopPropagation();
               const step = e.shiftKey ? 0.1 : 0.02;
               if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                 e.preventDefault();
                 onVolumeChange(Math.min(1, volume + step));
               } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                 e.preventDefault();
                 onVolumeChange(Math.max(0, volume - step));
               }
             }}
        >
          <div className="master-meter-vertical__bar">
            <div
              className="master-meter-vertical__bar-fill"
              style={{ height: `${leftFill}%` }}
            />
            {peakLeftY !== undefined && peakLeftY < 100 && (
              <div
                className="master-meter-vertical__peak-line"
                style={{ top: `${peakLeftY}%` }}
              />
            )}
            {clippedLeft && <div className="master-meter-vertical__clip-cap" />}
          </div>
          <div className="master-meter-vertical__bar">
            <div
              className="master-meter-vertical__bar-fill"
              style={{ height: `${rightFill}%` }}
            />
            {peakRightY !== undefined && peakRightY < 100 && (
              <div
                className="master-meter-vertical__peak-line"
                style={{ top: `${peakRightY}%` }}
              />
            )}
            {clippedRight && <div className="master-meter-vertical__clip-cap" />}
          </div>

          {/* Volume knob — anchored by its vertical center, positioned by dB. */}
          <div
            className="master-meter-vertical__thumb"
            style={{ top: `${thumbY}%` }}
          />
        </div>

        <div className="master-meter-vertical__scale" aria-hidden="true">
          {DB_LABELS.map((db, idx) => (
            <React.Fragment key={db}>
              <span className="master-meter-vertical__label">{db}</span>
              {idx < DB_LABELS.length - 1 && (
                <>
                  {Array.from({ length: MINOR_TICKS_BETWEEN }).map((_, t) => (
                    <span key={t} className="master-meter-vertical__tick" />
                  ))}
                </>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MasterMeterVertical;
