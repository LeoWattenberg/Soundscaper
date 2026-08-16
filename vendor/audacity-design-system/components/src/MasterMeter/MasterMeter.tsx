import React from 'react';
import { useTheme } from '../ThemeProvider';
import '../assets/fonts/musescore-icon.css';
import './MasterMeter.css';

export interface MasterMeterProps {
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
  /**
   * Initial meter width in pixels. The component owns the live width state
   * (resize is built in), so this only seeds the initial value. Default 360.
   */
  defaultWidth?: number;
  /** Minimum meter width during resize. Default 160. */
  minWidth?: number;
  /**
   * Disable the resize grip + behavior entirely. Useful when the meter sits
   * in a layout that already controls its width externally.
   */
  resizable?: boolean;
  /**
   * Override the default drag handler. When provided the component will
   * forward the mousedown event instead of running its built-in drag loop —
   * the caller is then responsible for the full lifecycle.
   */
  onResizeMouseDown?: (event: React.MouseEvent) => void;
  /** Additional CSS class */
  className?: string;
}

/** dB tick tiers, sparse → dense. The widest tier that fits without
 *  crowding gets rendered; the 6-label tier matches Figma at default width. */
const DB_TICKS_TIERS: readonly (readonly number[])[] = [
  [-60, -30, 0],
  [-60, -48, -36, -24, -12, 0],
  [-60, -54, -48, -42, -36, -30, -24, -18, -12, -6, 0],
];
/** Minimum scale width (px) per tier index — keep labels from butting up. */
const DB_TICKS_MIN_WIDTHS = [0, 220, 440];
const DB_MIN = -60;
const DB_MAX = 0;

/** Convert a dB value to a percentage position (0–100) */
function dbToPercent(db: number): number {
  const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));
  return ((clamped - DB_MIN) / (DB_MAX - DB_MIN)) * 100;
}

/** Convert a linear volume (0–1) to dB for thumb position */
function volumeToDb(volume: number): number {
  if (volume <= 0) return DB_MIN;
  return Math.max(DB_MIN, 20 * Math.log10(volume));
}

/** Convert dB to linear volume (0–1) */
function dbToVolume(db: number): number {
  if (db <= DB_MIN) return 0;
  return Math.pow(10, db / 20);
}

export const MasterMeter: React.FC<MasterMeterProps> = ({
  levelLeft = -60,
  levelRight = -60,
  clippedLeft = false,
  clippedRight = false,
  recentPeakLeft,
  recentPeakRight,
  volume = 1,
  onVolumeChange,
  defaultWidth = 360,
  minWidth = 160,
  resizable = true,
  onResizeMouseDown,
  className = '',
}) => {
  const { theme } = useTheme();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const trackRef = React.useRef<HTMLDivElement>(null);
  const thumbRef = React.useRef<HTMLDivElement>(null);
  const scaleRef = React.useRef<HTMLDivElement>(null);
  const draggingRef = React.useRef(false);
  const onVolumeChangeRef = React.useRef(onVolumeChange);
  onVolumeChangeRef.current = onVolumeChange;

  // The component owns its own width when resizable. Drag → grow into free
  // space within the nearest `.toolbar__content` (if any); window resize →
  // clamp back down if the container shrank.
  const [width, setWidth] = React.useState(defaultWidth);

  const handleResizeMouseDownInternal = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const root = rootRef.current;
    if (!root) return;
    const startX = e.clientX;
    const startWidth = root.getBoundingClientRect().width;
    const container = root.closest('.toolbar__content') as HTMLElement | null;
    const onMove = (ev: MouseEvent) => {
      const maxAvailable = container
        ? container.getBoundingClientRect().right - root.getBoundingClientRect().left
        : Infinity;
      const next = Math.max(
        minWidth,
        Math.min(maxAvailable, startWidth + (ev.clientX - startX)),
      );
      setWidth(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [minWidth]);

  // If the toolbar narrows past what fits, shrink the meter so it doesn't
  // get pushed onto a second row. We only clamp DOWN; growing back is left
  // to the user via the grip.
  React.useEffect(() => {
    if (!resizable) return;
    const root = rootRef.current;
    const container = root?.closest('.toolbar__content') as HTMLElement | null;
    if (!root || !container) return;
    const observer = new ResizeObserver(() => {
      const available = container.getBoundingClientRect().right - root.getBoundingClientRect().left;
      setWidth((current) => (current > available ? Math.max(minWidth, available) : current));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [resizable, minWidth]);

  const gripMouseDown = onResizeMouseDown ?? handleResizeMouseDownInternal;

  // Pick the densest tick tier that fits without crowding. The scale grows
  // with the meter, so wider meters unlock more labels.
  const [tierIndex, setTierIndex] = React.useState(1);
  React.useEffect(() => {
    const el = scaleRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      let next = 0;
      for (let i = DB_TICKS_MIN_WIDTHS.length - 1; i >= 0; i--) {
        if (width >= DB_TICKS_MIN_WIDTHS[i]) { next = i; break; }
      }
      setTierIndex(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const ticks = DB_TICKS_TIERS[tierIndex];

  const leftPercent = dbToPercent(levelLeft);
  const rightPercent = dbToPercent(levelRight);
  const thumbDb = volumeToDb(volume);
  const thumbPercent = dbToPercent(thumbDb);

  const peakLeftPercent = recentPeakLeft !== undefined ? dbToPercent(recentPeakLeft) : undefined;
  const peakRightPercent = recentPeakRight !== undefined ? dbToPercent(recentPeakRight) : undefined;

  const updateVolumeFromX = React.useCallback((clientX: number) => {
    if (!trackRef.current || !onVolumeChangeRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
    const db = DB_MIN + (percent / 100) * (DB_MAX - DB_MIN);
    onVolumeChangeRef.current(dbToVolume(db));
  }, []);

  React.useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = true;
      updateVolumeFromX(e.clientX);

      const handleMouseMove = (ev: MouseEvent) => {
        if (draggingRef.current) updateVolumeFromX(ev.clientX);
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
  }, [updateVolumeFromX]);

  const style = {
    '--mm-bg': theme.background.control.meter.background,
    '--mm-fill': theme.background.control.meter.fill,
    '--mm-peak': theme.background.control.meter.peak,
    '--mm-clip': theme.semantic.error.background,
    '--mm-text': theme.foreground.text.primary,
    '--mm-thumb-bg': theme.background.control.slider.handle.background,
    '--mm-thumb-border': theme.background.control.slider.handle.border,
    ...(resizable ? { width: `${width}px` } : null),
  } as React.CSSProperties;

  return (
    <div
      ref={rootRef}
      className={`master-meter ${className}`}
      style={style}
      role="group"
      aria-label="Master playback meter"
      tabIndex={0}
      onKeyDown={(e) => {
        // The toolbar's roving tab-index lands here on the component as a
        // unit. Enter / Space "grabs" the slider so arrow keys then adjust
        // volume; Escape on the slider returns focus here.
        if (e.key === 'Enter' || e.key === ' ') {
          if (document.activeElement === rootRef.current && thumbRef.current) {
            e.preventDefault();
            thumbRef.current.focus();
          }
        }
      }}
    >
      <div className="master-meter__main">
      {/* Meter bars + slider track */}
      <div className="master-meter__row">
        <div
          ref={trackRef}
          className="master-meter__track"
        >
          {/* Left channel meter */}
          <div className="master-meter__bar">
            <div
              className="master-meter__fill"
              style={{ width: `${leftPercent}%` }}
            />
            {peakLeftPercent !== undefined && peakLeftPercent > 0 && (
              <div
                className="master-meter__peak-line"
                style={{ left: `${peakLeftPercent}%` }}
              />
            )}
          </div>

          {/* Right channel meter */}
          <div className="master-meter__bar">
            <div
              className="master-meter__fill"
              style={{ width: `${rightPercent}%` }}
            />
            {peakRightPercent !== undefined && peakRightPercent > 0 && (
              <div
                className="master-meter__peak-line"
                style={{ left: `${peakRightPercent}%` }}
              />
            )}
          </div>

          {/* Volume thumb — only focusable programmatically (tabIndex -1)
              so it sits inside the outer role="group" wrapper without
              competing for tab order. Escape kicks focus back out. */}
          <div
            ref={thumbRef}
            className="master-meter__thumb"
            style={{ left: `${thumbPercent}%` }}
            role="slider"
            aria-label="Master volume"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(volume * 100)}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                rootRef.current?.focus();
                return;
              }
              if (!onVolumeChange) return;
              e.stopPropagation();
              const step = e.shiftKey ? 0.1 : 0.02;
              if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                e.preventDefault();
                onVolumeChange(Math.min(1, volume + step));
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                e.preventDefault();
                onVolumeChange(Math.max(0, volume - step));
              }
            }}
          />
        </div>

        {/* Clip indicators */}
        <div className="master-meter__clip-indicators">
          <div className={`master-meter__clip-dot ${clippedLeft ? 'master-meter__clip-dot--active' : ''}`} />
          <div className={`master-meter__clip-dot ${clippedRight ? 'master-meter__clip-dot--active' : ''}`} />
        </div>
      </div>

      {/* dB scale labels — flex `space-between` anchors the first label flush
          at the left edge and the last flush at the right, matching the bar
          coordinate system above. */}
      <div ref={scaleRef} className="master-meter__scale">
        {ticks.map((db) => (
          <span key={db} className="master-meter__tick-label">{db}</span>
        ))}
      </div>
      </div>

      {/* Resize grip — sibling of the meter+scale column so it can stay
          centered against the full control rather than stretching the row.
          Uses the built-in drag handler unless the consumer overrides it. */}
      {resizable && (
      <span
        className="master-meter__resize-grip musescore-icon"
        aria-hidden="true"
        role="presentation"
        onMouseDown={gripMouseDown}
      >
        {'\uF347'}
      </span>
      )}
    </div>
  );
};

export default MasterMeter;
