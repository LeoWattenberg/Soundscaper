import React, { useDeferredValue, useEffect, useRef } from 'react';
import type { ClipColor } from '../types/clip';
import type { TimeSelection } from '@audacity-ui/core';
import { renderMonoSpectrogram, renderStereoSpectrogram, type SpectrogramScale } from '../utils/spectrogram';
import { getScaleMinFreq } from '../utils/spectrogramScales';
import { getEnvelopeGainAtTime, type EnvelopePointData } from '../utils/envelope';
import { computeWaveformGeometry, makeSelectionColorFns } from './waveformGeometry';

import { EnvelopeOverlay } from '../EnvelopeOverlay/EnvelopeOverlay';
import { useTheme } from '../ThemeProvider';
import './ClipBody.css';

const EMPTY_NUMBER_ARRAY: number[] = [];
const EMPTY_ENVELOPE_ARRAY: EnvelopePointData[] = [];

/**
 * Draws a waveform or RMS channel onto a canvas context.
 * Consolidates the shared pixel-loop logic used across all rendering modes.
 */
function drawChannel(
  ctx: CanvasRenderingContext2D,
  data: number[],
  canvasWidth: number,
  trimStartSample: number,
  samplesPerPixel: number,
  centerY: number,
  maxAmplitude: number,
  clipTrimStart: number,
  pixelsPerSecond: number,
  envelope: EnvelopePointData[] | undefined,
  clipDuration: number,
  isRms: boolean,
  getColor?: (px: number) => string,
) {
  for (let px = 0; px < canvasWidth; px++) {
    const sampleStart = trimStartSample + Math.floor(px * samplesPerPixel);
    const sampleEnd = trimStartSample + Math.floor((px + 1) * samplesPerPixel);

    let min = data[sampleStart] || 0;
    let max = data[sampleStart] || 0;
    for (let i = sampleStart; i < sampleEnd && i < data.length; i++) {
      const sample = data[i];
      min = Math.min(min, sample);
      max = Math.max(max, sample);
    }

    const pixelTime = clipTrimStart + (px / pixelsPerSecond);
    const envelopeGain = envelope ? getEnvelopeGainAtTime(pixelTime, envelope, clipDuration) : 1.0;
    min *= envelopeGain;
    max *= envelopeGain;

    if (getColor) {
      ctx.fillStyle = getColor(px);
    }

    const y1 = centerY - max * maxAmplitude;
    const y2 = isRms ? centerY + max * maxAmplitude : centerY - min * maxAmplitude;
    ctx.fillRect(px, y1, 1, Math.max(1, y2 - y1));
  }
}

export type { SpectrogramScale };

export type ClipBodyVariant = 'waveform' | 'spectrogram' | 'midi';
export type ClipBodyChannelMode = 'mono' | 'stereo' | 'split-mono' | 'split-stereo';

// Stereo divider line color - fetched from CSS variables at runtime

export interface ClipBodyProps {
  /** Clip color from the 9-color palette */
  color?: ClipColor;
  /** Whether the clip is selected */
  selected?: boolean;
  /** Visualization type */
  variant?: ClipBodyVariant;
  /** Channel display mode */
  channelMode?: ClipBodyChannelMode;
  /** Width in pixels */
  width?: number;
  /** Height in pixels */
  height?: number;
  /** Waveform image URL (for static display) */
  waveformSrc?: string;
  /** Waveform data array (normalized -1 to 1) - for mono */
  waveformData?: number[];
  /** RMS waveform data (normalized -1 to 1) - for mono */
  waveformDataRms?: number[];
  /** Left channel waveform data (for stereo) */
  waveformLeft?: number[];
  /** Right channel waveform data (for stereo) */
  waveformRight?: number[];
  /** Left channel RMS waveform data (for stereo) */
  waveformLeftRms?: number[];
  /** Right channel RMS waveform data (for stereo) */
  waveformRightRms?: number[];
  /** Envelope points for automation curve */
  envelope?: EnvelopePointData[];
  /** Whether to show the envelope overlay */
  showEnvelope?: boolean;
  /** Split ratio for stereo channels (0-1, default 0.5 for 50/50) */
  channelSplitRatio?: number;
  /** Time selection range (for marquee selection overlay) */
  timeSelection?: TimeSelection | null;
  /** Clip start time in seconds (needed for time selection positioning) */
  clipStartTime?: number;
  /** Clip duration in seconds (needed for time selection and envelope positioning) */
  clipDuration?: number;
  /** Trim start offset in seconds (for rendering only visible portion of waveform) */
  clipTrimStart?: number;
  /** Full duration of original audio before trimming (for waveform sample rate detection) */
  clipFullDuration?: number;
  /** Pixels per second (timeline zoom level) - for maintaining constant waveform scale */
  pixelsPerSecond?: number;
  /** Visual time-stretch factor (default 1). Values > 1 stretch the waveform
   *  horizontally (each second of source audio occupies more pixels); values
   *  < 1 compress it. Independent of trim — the same audio range plays, just
   *  drawn over a different pixel span. */
  clipStretchFactor?: number;
  /** Time selection overlay color (default: 'rgba(255, 255, 255, 0.3)') */
  timeSelectionColor?: string;
  /** Points to hide during drag (eating behavior) */
  hiddenPointIndices?: number[];
  /** Indices of points being hovered (for hover visual feedback, can be multiple during segment drag) */
  hoveredPointIndices?: number[];
  /** Cursor position on envelope (for cursor follower dot) */
  cursorPosition?: { time: number; db: number } | null;
  /** Whether clip is within a time selection (for vibrant color rendering) */
  inTimeSelection?: boolean;
  /** Time selection range (for calculating overlay position) */
  timeSelectionRange?: { startTime: number; endTime: number } | null;
  /** Envelope control point sizes (for MuseScore vs AU4 style) */
  envelopePointSizes?: {
    outerRadius: number;
    innerRadius: number;
    outerRadiusHover: number;
    innerRadiusHover: number;
    dualStrokeLine?: boolean;
    [key: string]: unknown;
  };
  /** Spectrogram frequency scale
   * @default 'mel'
   */
  spectrogramScale?: SpectrogramScale;
}

/**
 * ClipBody - The body/content area of an audio clip
 *
 * Supports multiple visualization modes:
 * - Waveform (mono/stereo/split)
 * - Spectrogram (mono/stereo)
 * - Envelope overlay for automation
 */
const ClipBodyComponent: React.FC<ClipBodyProps> = ({
  color = 'blue',
  selected = false,
  variant = 'waveform',
  channelMode = 'mono',
  width,
  height = 84,
  waveformSrc,
  waveformData,
  waveformDataRms,
  waveformLeft,
  waveformRight,
  waveformLeftRms,
  waveformRightRms,
  envelope,
  showEnvelope = false,
  channelSplitRatio = 0.5,
  timeSelection = null,
  clipStartTime = 0,
  clipDuration = 1.0,
  clipTrimStart = 0,
  clipFullDuration,
  pixelsPerSecond = 100,
  clipStretchFactor = 1,
  timeSelectionColor = 'rgba(255, 255, 255, 0.3)',
  hiddenPointIndices = EMPTY_NUMBER_ARRAY,
  hoveredPointIndices = EMPTY_NUMBER_ARRAY,
  cursorPosition = null,
  inTimeSelection = false,
  timeSelectionRange = null,
  envelopePointSizes,
  spectrogramScale = 'mel',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();
  // Defer the height used by the (expensive) canvas redraw so it can
  // lag behind during a track-height drag. CSS inline styles below use
  // the live `height` so the canvas element visibly fills its parent
  // even while the pixel buffer is still at the previous height (the
  // browser stretches the existing pixels). When the drag pauses or
  // settles, React commits the deferred height and the canvas redraws
  // at the correct resolution.
  const drawHeight = useDeferredValue(height);

  // Draw waveform or spectrogram on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Check if we have any waveform data
    const isStereo = waveformLeft && waveformRight;
    const hasMono = waveformData && waveformData.length > 0;
    if (!isStereo && !hasMono) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Get computed styles once at the top for reuse throughout rendering
    const computedStyle = getComputedStyle(canvas);

    const canvasWidth = width || canvas.offsetWidth;
    const canvasHeight = drawHeight;

    // Set canvas pixel-buffer dimensions for high DPI displays. CSS
    // sizing is handled via inline style in the JSX below so the canvas
    // element visibly fills the parent live; we only touch the pixel
    // buffer here (which clears + redraws and is the expensive bit).
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Render time selection background overlay FIRST (vibrant background colors - drawn underneath waveform)
    if (inTimeSelection && timeSelectionRange) {
      const clipEndTime = clipStartTime + clipDuration;
      const overlapStart = Math.max(clipStartTime, timeSelectionRange.startTime);
      const overlapEnd = Math.min(clipEndTime, timeSelectionRange.endTime);

      if (overlapStart < overlapEnd) {
        // Calculate selection bounds in pixels
        const selStartX = (overlapStart - clipStartTime) * pixelsPerSecond;
        const selWidth = (overlapEnd - overlapStart) * pixelsPerSecond;

        // Draw background overlay ONLY for the overlapped portion
        // Get color from CSS variables (read from theme tokens)
        const timeSelectionColor = computedStyle.getPropertyValue(`--clip-${color}-time-selection-body`).trim();

        ctx.fillStyle = timeSelectionColor;
        ctx.fillRect(selStartX, 0, selWidth, canvasHeight);
      }
    }

    // Render based on channel mode and variant
    if (channelMode === 'split-mono' || channelMode === 'split-stereo') {
      // Split view: spectrogram on top, waveform on bottom (ratio controlled by channelSplitRatio)
      const topHeight = canvasHeight * channelSplitRatio;
      const bottomHeight = canvasHeight * (1 - channelSplitRatio);
      const splitY = topHeight;

      // Top section: spectrogram
      const spectrogramBg = computedStyle.getPropertyValue('--spectrogram-background').trim();
      ctx.fillStyle = spectrogramBg;
      ctx.fillRect(0, 0, canvasWidth, topHeight);

      // Clip spectrogram rendering to top section only (prevents pixel blocks from extending below split line)
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, canvasWidth, topHeight);
      ctx.clip();

      if (channelMode === 'split-stereo' && isStereo) {
        // Stereo split: L and R spectrograms in top section
        const quarterHeight = topHeight / 2;

        // PERFORMANCE: Use reduced settings for real-time interaction
        const spectrogramOptions = {
          frequencyBands: 16,
          fftWindowSize: 64,
          intensityMultiplier: 1.5,
          pixelSkip: 4,
          scale: spectrogramScale,
          minFreq: getScaleMinFreq(spectrogramScale),
        };

        // Render L channel spectrogram (top quarter)
        renderMonoSpectrogram(ctx, waveformLeft, 0, 0, canvasWidth, quarterHeight, spectrogramOptions);

        // Separator between L and R spectral (using color-specific divider)
        const dividerColor = computedStyle.getPropertyValue(`--clip-${color}-divider`).trim();
        ctx.strokeStyle = dividerColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, quarterHeight);
        ctx.lineTo(canvasWidth, quarterHeight);
        ctx.stroke();

        // Render R channel spectrogram (second quarter)
        renderMonoSpectrogram(ctx, waveformRight, 0, quarterHeight, canvasWidth, quarterHeight, spectrogramOptions);
      } else if (hasMono) {
        // Mono split: single spectrogram in top section
        renderMonoSpectrogram(ctx, waveformData!, 0, 0, canvasWidth, topHeight, {
          frequencyBands: 16,
          fftWindowSize: 64,
          intensityMultiplier: 1.5,
          pixelSkip: 4,
          scale: spectrogramScale,
          minFreq: getScaleMinFreq(spectrogramScale),
        });
      }

      ctx.restore(); // Remove clipping region

      // Separator line between spectrogram and waveform
      const separatorColor = computedStyle.getPropertyValue('--split-separator').trim();
      ctx.strokeStyle = separatorColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, splitY);
      ctx.lineTo(canvasWidth, splitY);
      ctx.stroke();

      // Bottom half: waveform
      // Get waveform colors from CSS variables (theme tokens)
      const defaultWaveformColor = computedStyle.getPropertyValue(`--clip-${color}-waveform`).trim();
      // Always use default waveform color - selection only affects body background
      const waveformColor = defaultWaveformColor;
      ctx.fillStyle = waveformColor;
      ctx.strokeStyle = waveformColor;
      ctx.lineWidth = 1;

      if (channelMode === 'split-stereo' && isStereo) {
        // Stereo: L and R waveforms in bottom section
        const stereoHeight = bottomHeight / 2;
        const lChannelY = splitY + stereoHeight / 2;
        const rChannelY = splitY + stereoHeight + stereoHeight / 2;
        const maxAmplitude = (stereoHeight / 2) * 0.9;

        // Draw L channel waveform
        const { samplesPerPixel: samplesPerPixelL, trimStartSample } = computeWaveformGeometry({
          dataLength: waveformLeft.length,
          clipFullDuration,
          clipTrimStart,
          clipDuration,
          pixelsPerSecond,
          clipStretchFactor,
        });

        const splitEnvelope = showEnvelope ? envelope : undefined;
        drawChannel(ctx, waveformLeft, canvasWidth, trimStartSample, samplesPerPixelL, lChannelY, maxAmplitude, clipTrimStart, pixelsPerSecond, splitEnvelope, clipDuration, false);

        // Draw L channel RMS (if RMS data provided)
        if (waveformLeftRms && waveformLeftRms.length > 0) {
          const defaultRmsColor = computedStyle.getPropertyValue(`--clip-${color}-waveform-rms`).trim();
          ctx.fillStyle = defaultRmsColor;
          drawChannel(ctx, waveformLeftRms, canvasWidth, trimStartSample, samplesPerPixelL, lChannelY, maxAmplitude, clipTrimStart, pixelsPerSecond, envelope, clipDuration, true);
        }

        // Separator between L and R waveforms (using color-specific divider)
        const dividerColor2 = computedStyle.getPropertyValue(`--clip-${color}-divider`).trim();
        ctx.strokeStyle = dividerColor2;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, splitY + stereoHeight);
        ctx.lineTo(canvasWidth, splitY + stereoHeight);
        ctx.stroke();

        // Draw R channel waveform
        ctx.fillStyle = waveformColor;
        drawChannel(ctx, waveformRight, canvasWidth, trimStartSample, samplesPerPixelL, rChannelY, maxAmplitude, clipTrimStart, pixelsPerSecond, splitEnvelope, clipDuration, false);

        // Draw R channel RMS (if RMS data provided)
        if (waveformRightRms && waveformRightRms.length > 0) {
          const defaultRmsColor = computedStyle.getPropertyValue(`--clip-${color}-waveform-rms`).trim();
          ctx.fillStyle = defaultRmsColor;
          drawChannel(ctx, waveformRightRms, canvasWidth, trimStartSample, samplesPerPixelL, rChannelY, maxAmplitude, clipTrimStart, pixelsPerSecond, envelope, clipDuration, true);
        }
      } else if (hasMono) {
        // Mono: single waveform centered in bottom section
        const waveformCenterY = splitY + bottomHeight / 2;
        const maxAmplitude = (bottomHeight / 2) * 0.9;

        const { samplesPerPixel, trimStartSample } = computeWaveformGeometry({
          dataLength: waveformData!.length,
          clipFullDuration,
          clipTrimStart,
          clipDuration,
          pixelsPerSecond,
          clipStretchFactor,
        });

        const splitEnvelopeMono = showEnvelope ? envelope : undefined;
        drawChannel(ctx, waveformData!, canvasWidth, trimStartSample, samplesPerPixel, waveformCenterY, maxAmplitude, clipTrimStart, pixelsPerSecond, splitEnvelopeMono, clipDuration, false);

        // Draw mono RMS (if RMS data provided)
        if (waveformDataRms && waveformDataRms.length > 0) {
          const defaultRmsColor = computedStyle.getPropertyValue(`--clip-${color}-waveform-rms`).trim();
          ctx.fillStyle = defaultRmsColor;
          drawChannel(ctx, waveformDataRms, canvasWidth, trimStartSample, samplesPerPixel, waveformCenterY, maxAmplitude, clipTrimStart, pixelsPerSecond, envelope, clipDuration, true);
        }
      }
    } else if (variant === 'spectrogram') {
      // Pure spectrogram rendering (no split view)
      const spectrogramOptions = {
        frequencyBands: 32, // Lower resolution for snappier performance
        fftWindowSize: 256, // Smaller FFT for faster computation
        intensityMultiplier: 1.5,
        pixelSkip: 4, // Render every 4th pixel for better performance
        scale: spectrogramScale,
        minFreq: getScaleMinFreq(spectrogramScale),
      };

      if (isStereo) {
        renderStereoSpectrogram(
          ctx,
          waveformLeft,
          waveformRight,
          0,
          0,
          canvasWidth,
          canvasHeight,
          channelSplitRatio,
          spectrogramOptions
        );

        // Draw channel divider line using color-specific divider
        const lChannelHeight = canvasHeight * channelSplitRatio;
        const dividerColor3 = computedStyle.getPropertyValue(`--clip-${color}-divider`).trim();
        ctx.strokeStyle = dividerColor3;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, lChannelHeight);
        ctx.lineTo(canvasWidth, lChannelHeight);
        ctx.stroke();
      } else if (hasMono) {
        renderMonoSpectrogram(
          ctx,
          waveformData!,
          0,
          0,
          canvasWidth,
          canvasHeight,
          spectrogramOptions
        );
      }
    } else {
      // Pure waveform rendering (no split view)
      ctx.lineWidth = 1;

      if (isStereo) {
      // Stereo: L channel on top, R channel on bottom
      const lChannelHeight = canvasHeight * channelSplitRatio;
      const rChannelHeight = canvasHeight * (1 - channelSplitRatio);
      const lChannelCenterY = lChannelHeight / 2;
      const rChannelCenterY = lChannelHeight + rChannelHeight / 2;
      const lMaxAmplitude = lChannelHeight / 2 - 2;
      const rMaxAmplitude = rChannelHeight / 2 - 2;

      const { samplesPerPixel, trimStartSample } = computeWaveformGeometry({
        dataLength: waveformLeft.length,
        clipFullDuration,
        clipTrimStart,
        clipDuration,
        pixelsPerSecond,
        clipStretchFactor,
      });

      const { getWaveColor, getRmsColor } = makeSelectionColorFns({
        computedStyle,
        colorPrefix: color,
        inTimeSelection,
        timeSelectionRange,
        clipStartTime,
        clipDuration,
        pixelsPerSecond,
      });

      // Draw L channel
      drawChannel(ctx, waveformLeft, canvasWidth, trimStartSample, samplesPerPixel, lChannelCenterY, lMaxAmplitude, clipTrimStart, pixelsPerSecond, envelope, clipDuration, false, getWaveColor);

      // Draw L channel RMS (if RMS data provided)
      if (waveformLeftRms && waveformLeftRms.length > 0) {
        drawChannel(ctx, waveformLeftRms, canvasWidth, trimStartSample, samplesPerPixel, lChannelCenterY, lMaxAmplitude, clipTrimStart, pixelsPerSecond, envelope, clipDuration, true, getRmsColor);
      }

      // Draw channel divider line using color-specific divider
      const dividerColor4 = computedStyle.getPropertyValue(`--clip-${color}-divider`).trim();
      ctx.strokeStyle = dividerColor4;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, lChannelHeight);
      ctx.lineTo(canvasWidth, lChannelHeight);
      ctx.stroke();

      // Draw R channel
      drawChannel(ctx, waveformRight, canvasWidth, trimStartSample, samplesPerPixel, rChannelCenterY, rMaxAmplitude, clipTrimStart, pixelsPerSecond, envelope, clipDuration, false, getWaveColor);

      // Draw R channel RMS (if RMS data provided)
      if (waveformRightRms && waveformRightRms.length > 0) {
        drawChannel(ctx, waveformRightRms, canvasWidth, trimStartSample, samplesPerPixel, rChannelCenterY, rMaxAmplitude, clipTrimStart, pixelsPerSecond, envelope, clipDuration, true, getRmsColor);
      }
    } else if (hasMono) {
      // Mono: single waveform centered
      const centerY = canvasHeight / 2;
      const maxAmplitude = canvasHeight / 2 - 2;

      const { samplesPerPixel, trimStartSample } = computeWaveformGeometry({
        dataLength: waveformData!.length,
        clipFullDuration,
        clipTrimStart,
        clipDuration,
        pixelsPerSecond,
        clipStretchFactor,
      });

      const { getWaveColor, getRmsColor } = makeSelectionColorFns({
        computedStyle,
        colorPrefix: color,
        inTimeSelection,
        timeSelectionRange,
        clipStartTime,
        clipDuration,
        pixelsPerSecond,
      });

      drawChannel(ctx, waveformData!, canvasWidth, trimStartSample, samplesPerPixel, centerY, maxAmplitude, clipTrimStart, pixelsPerSecond, envelope, clipDuration, false, getWaveColor);

      // Draw RMS waveform on top (if RMS data provided)
      if (waveformDataRms && waveformDataRms.length > 0) {
        drawChannel(ctx, waveformDataRms, canvasWidth, trimStartSample, samplesPerPixel, centerY, maxAmplitude, clipTrimStart, pixelsPerSecond, envelope, clipDuration, true, getRmsColor);
      }
      }
    }

    // Envelope rendering moved to SVG overlay (see return JSX below)
  }, [waveformData, waveformLeft, waveformRight, width, drawHeight, variant, channelSplitRatio, color, envelope, showEnvelope, channelMode, clipDuration, clipTrimStart, clipFullDuration, pixelsPerSecond, inTimeSelection, timeSelectionRange, clipStartTime, theme, spectrogramScale]);

  const className = [
    'clip-body',
    `clip-body--${color}`,
    `clip-body--${variant}`,
    `clip-body--${channelMode}`,
    selected && 'clip-body--selected',
    showEnvelope && envelope && 'clip-body--has-envelope',
    inTimeSelection && 'clip-body--time-selected',
  ]
    .filter(Boolean)
    .join(' ');

  const style: React.CSSProperties = {
    height: `${height}px`,
    ...(width && { width: `${width}px` }),
  };

  // Calculate envelope Y offset and height for split view
  const envelopeYOffset = (channelMode === 'split-mono' || channelMode === 'split-stereo')
    ? height * channelSplitRatio
    : 0;
  const envelopeHeight = (channelMode === 'split-mono' || channelMode === 'split-stereo')
    ? height * (1 - channelSplitRatio)
    : height;

  return (
    <div
      className={className}
      style={style}
      data-color={color}
      data-variant={variant}
      data-channel-mode={channelMode}
      data-selected={selected}
    >
      {/* Canvas-based rendering (waveform or spectrogram).
          CSS width/height come from props (live) so the canvas always
          fills its parent. The pixel buffer (canvas.width/height attrs)
          is sized in the useEffect against a deferred height, so the
          expensive redraw can lag behind a fast resize drag without
          blocking the cursor. The browser scales the existing pixels
          to the live CSS size — small visual stretch during the drag,
          crisp redraw when the value commits. */}
      {(waveformData || (waveformLeft && waveformRight)) && (
        <canvas
          ref={canvasRef}
          className="clip-body__waveform"
          style={{
            display: 'block',
            background: 'transparent',
            width: width ? `${width}px` : undefined,
            height: `${height}px`,
          }}
        />
      )}

      {/* Image-based waveform/spectrogram display */}
      {!waveformData && !waveformLeft && !waveformRight && waveformSrc && (
        <img
          src={waveformSrc}
          alt=""
          className="clip-body__waveform"
        />
      )}

      {/* SVG-based envelope overlay */}
      {showEnvelope && (
        <EnvelopeOverlay
          points={envelope ?? EMPTY_ENVELOPE_ARRAY}
          duration={clipDuration}
          width={width || 0}
          height={envelopeHeight}
          yOffset={envelopeYOffset}
          lineColor={(envelopePointSizes as any)?.lineColor ?? theme.audio.envelope.line} // justified: envelopePointSizes prop type doesn't declare lineColor — pending components sweep
          pointColor={theme.audio.envelope.point}
          pointCenterColor={theme.audio.envelope.pointCenter}
          hiddenPointIndices={hiddenPointIndices}
          hoveredPointIndices={hoveredPointIndices}
          cursorPosition={cursorPosition}
          pointSizes={envelopePointSizes}
        />
      )}
    </div>
  );
};

// Memoize ClipBody to prevent expensive spectrogram re-renders during mouse interactions
export const ClipBody = React.memo(ClipBodyComponent);

export default ClipBody;
