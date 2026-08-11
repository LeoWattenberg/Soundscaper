import { useEffect, useRef, useState } from 'react';
import { TimeSelection, SpectralSelection } from '@audacity-ui/core';
import { useTheme } from '../ThemeProvider';
import { CLIP_CONTENT_OFFSET } from '../constants';
import './TimelineRuler.css';

export interface TimelineRulerProps {
  /**
   * Zoom level in pixels per second
   */
  pixelsPerSecond: number;
  /**
   * Horizontal scroll offset in pixels
   */
  scrollX?: number;
  /**
   * Total duration of the timeline in seconds
   */
  totalDuration: number;
  /**
   * Width of the ruler in pixels.
   *
   * **Legacy / scroll-extent only.** Passing the full project width here
   * still works, but for any project width above ~16,000px on HiDPI
   * displays the canvas hits browser size limits and renders blurry.
   *
   * Prefer `viewportWidth` (just the visible portion) — the ruler will
   * redraw on scroll via `scrollX` without losing resolution.
   *
   * When `viewportWidth` is set, this prop is unused for sizing.
   */
  width: number;
  /**
   * Visible viewport width in CSS pixels. When set, the canvas backing
   * store is sized to this value (always sharp, never hits the canvas
   * size cap). Drawing uses `scrollX` to determine which time range is
   * currently visible.
   *
   * This is the recommended way to render long timelines on HiDPI
   * displays. The consumer is responsible for positioning the ruler
   * outside the horizontally-scrolling region (e.g., sticky/fixed) so
   * it stays in view as the tracks below scroll.
   */
  viewportWidth?: number;
  /**
   * Height of the ruler in pixels
   */
  height?: number;
  /**
   * Time selection to display in bottom half
   */
  timeSelection?: TimeSelection | null;
  /**
   * Spectral selection to display as grey highlight (for partial-height marquee)
   */
  spectralSelection?: SpectralSelection | null;
  /**
   * Background color
   */
  backgroundColor?: string;
  /**
   * Text color for time labels
   */
  textColor?: string;
  /**
   * Line color for divider line
   */
  lineColor?: string;
  /**
   * Color for tick marks
   */
  tickColor?: string;
  /**
   * Color for time selection overlay in ruler
   */
  selectionColor?: string;
  /**
   * Color for spectral selection highlight in ruler
   */
  spectralHighlightColor?: string;
  /**
   * Current cursor/playback position in seconds
   */
  cursorPosition?: number;
  /**
   * Time format to display
   */
  timeFormat?: 'minutes-seconds' | 'beats-measures';
  /**
   * Beats per minute (for beats-measures format)
   */
  bpm?: number;
  /**
   * Time signature numerator (beats per measure)
   */
  beatsPerMeasure?: number;
  /**
   * Whether loop region is enabled
   */
  loopRegionEnabled?: boolean;
  /**
   * Loop region start time in seconds
   */
  loopRegionStart?: number | null;
  /**
   * Loop region end time in seconds
   */
  loopRegionEnd?: number | null;
  /**
   * Callback when loop region changes (drag or resize)
   */
  onLoopRegionChange?: (start: number, end: number) => void;
  /**
   * Callback when loop region interaction starts/stops
   */
  onLoopRegionInteracting?: (isInteracting: boolean) => void;
  /**
   * Callback when loop region is clicked (to toggle enabled state)
   */
  onLoopRegionEnabledToggle?: () => void;
  /**
   * Callback when loop region hover state changes
   */
  onLoopRegionHoverChange?: (isHovering: boolean) => void;
}

const DEFAULT_HEIGHT = 40;

export function TimelineRuler({
  pixelsPerSecond,
  scrollX = 0,
  totalDuration,
  width,
  viewportWidth,
  height = DEFAULT_HEIGHT,
  timeSelection = null,
  spectralSelection = null,
  backgroundColor,
  textColor,
  lineColor,
  tickColor,
  selectionColor,
  spectralHighlightColor,
  cursorPosition,
  timeFormat = 'minutes-seconds',
  bpm = 120,
  beatsPerMeasure = 4,
  loopRegionEnabled = false,
  loopRegionStart = null,
  loopRegionEnd = null,
  onLoopRegionChange,
  onLoopRegionInteracting,
  onLoopRegionEnabledToggle,
  onLoopRegionHoverChange,
}: TimelineRulerProps) {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragStateRef = useRef<{ type: 'move' | 'resize-start' | 'resize-end'; startX: number; initialStart: number; initialEnd: number } | null>(null);
  const clickStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const hasMovedRef = useRef(false); // Track if mouse actually moved during drag
  const [cursor, setCursor] = useState('default');

  // Use theme tokens as defaults if not provided
  const bgColor = backgroundColor ?? theme.background.panel.timeline;
  const txtColor = textColor ?? theme.foreground.text.primary;
  const lnColor = lineColor ?? theme.border.onElevated;
  const tckColor = tickColor ?? theme.audio.timeline.tickMajor;
  const selColor = selectionColor ?? 'rgba(255, 255, 255, 0.5)';
  const specColor = spectralHighlightColor ?? 'rgba(130, 131, 135, 0.3)';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Resolve canvas size: prefer viewport sizing when provided.
    // Drawing already works in viewport coordinates (offset by scrollX), so
    // a viewport-sized canvas stays sharp regardless of project length.
    const renderWidth = viewportWidth ?? width;

    // Cap DPR so the backing store never exceeds browser canvas limits.
    // With viewportWidth this cap effectively never engages (viewport is
    // typically < 4000px). With a project-sized `width`, the cap may drop
    // DPR below the device's native value — that's the blurry path.
    const MAX_CANVAS_DIMENSION = 32000;
    const baseDpr = window.devicePixelRatio || 1;
    const maxDprForWidth = MAX_CANVAS_DIMENSION / renderWidth;
    const maxDprForHeight = MAX_CANVAS_DIMENSION / height;
    const dpr = Math.max(1, Math.min(baseDpr, maxDprForWidth, maxDprForHeight));

    canvas.width = renderWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${renderWidth}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, renderWidth, height);

    // Draw background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, renderWidth, height);

    // Draw time selection in bottom half (if present)
    const midHeight = Math.floor(height / 2);
    if (timeSelection) {
      const startX = CLIP_CONTENT_OFFSET + timeSelection.startTime * pixelsPerSecond - scrollX;
      const endX = CLIP_CONTENT_OFFSET + timeSelection.endTime * pixelsPerSecond - scrollX;

      ctx.fillStyle = selColor;
      ctx.fillRect(startX, midHeight, endX - startX, height - midHeight);

      // Borders removed for cleaner look with blend mode
    }

    // Draw spectral selection as grey highlight in bottom half (for partial-height marquee)
    if (spectralSelection && !timeSelection) {
      const startX = CLIP_CONTENT_OFFSET + spectralSelection.startTime * pixelsPerSecond - scrollX;
      const endX = CLIP_CONTENT_OFFSET + spectralSelection.endTime * pixelsPerSecond - scrollX;

      ctx.fillStyle = specColor;
      ctx.fillRect(startX, midHeight, endX - startX, height - midHeight);
    }

    // Draw loop region in top half (if defined, with active/inactive colors based on loopRegionEnabled)
    if (loopRegionStart !== null && loopRegionEnd !== null) {
      const startX = CLIP_CONTENT_OFFSET + loopRegionStart * pixelsPerSecond - scrollX;
      const endX = CLIP_CONTENT_OFFSET + loopRegionEnd * pixelsPerSecond - scrollX;

      // Draw filled rectangle with theme color (active or inactive)
      ctx.fillStyle = loopRegionEnabled
        ? theme.audio.timeline.loopRegionFill
        : theme.audio.timeline.loopRegionFillInactive;
      ctx.fillRect(startX, 0, endX - startX, midHeight);

      // Draw border with theme color (active or inactive)
      ctx.strokeStyle = loopRegionEnabled
        ? theme.audio.timeline.loopRegionBorder
        : theme.audio.timeline.loopRegionBorderInactive;
      ctx.lineWidth = 2;
      ctx.strokeRect(startX, 0, endX - startX, midHeight);
    }

    // Draw horizontal divider line at middle (skip the CLIP_CONTENT_OFFSET area)
    ctx.strokeStyle = lnColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CLIP_CONTENT_OFFSET, midHeight + 0.5); // Start after the left padding box
    ctx.lineTo(renderWidth, midHeight + 0.5);
    ctx.stroke();

    // Draw time markers
    drawTimeMarkers(
      ctx,
      pixelsPerSecond,
      scrollX,
      totalDuration,
      renderWidth,
      height,
      txtColor,
      lnColor,
      tckColor,
      timeFormat,
      bpm,
      beatsPerMeasure
    );

    // Draw cursor position line (using text color)
    if (cursorPosition !== undefined && cursorPosition >= 0) {
      const cursorX = CLIP_CONTENT_OFFSET + cursorPosition * pixelsPerSecond - scrollX;

      // Only draw if cursor is visible in viewport
      if (cursorX >= CLIP_CONTENT_OFFSET && cursorX <= renderWidth) {
        ctx.strokeStyle = txtColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.floor(cursorX) + 0.5, 0);
        ctx.lineTo(Math.floor(cursorX) + 0.5, height);
        ctx.stroke();
      }
    }
  }, [pixelsPerSecond, scrollX, totalDuration, width, viewportWidth, height, timeSelection, spectralSelection, bgColor, txtColor, lnColor, tckColor, selColor, specColor, cursorPosition, timeFormat, bpm, beatsPerMeasure, loopRegionEnabled, loopRegionStart, loopRegionEnd]);

  // Mouse event handlers for loop region interaction
  const EDGE_THRESHOLD = 5; // pixels from edge for resize cursor

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (loopRegionStart === null || loopRegionEnd === null) {
      setCursor('default');
      onLoopRegionHoverChange?.(false);
      return;
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const midHeight = height / 2;
    const mouseY = e.clientY - rect.top;

    // Only interact if mouse is in top half (where loop region is)
    if (mouseY > midHeight) {
      setCursor('default');
      onLoopRegionHoverChange?.(false);
      return;
    }

    const startX = CLIP_CONTENT_OFFSET + loopRegionStart * pixelsPerSecond - scrollX;
    const endX = CLIP_CONTENT_OFFSET + loopRegionEnd * pixelsPerSecond - scrollX;

    // If dragging, document-level handler takes care of it
    if (dragStateRef.current) return;

    // Set cursor based on mouse position
    const nearStart = Math.abs(mouseX - startX) < EDGE_THRESHOLD;
    const nearEnd = Math.abs(mouseX - endX) < EDGE_THRESHOLD;
    const insideRegion = mouseX >= startX && mouseX <= endX;

    // Update hover state
    onLoopRegionHoverChange?.(insideRegion);

    // Show resize/grab cursors if onLoopRegionChange is provided (both enabled and disabled states)
    if (onLoopRegionChange) {
      if (nearStart || nearEnd) {
        setCursor('ew-resize');
      } else if (insideRegion) {
        setCursor('grab');
      } else {
        setCursor('default');
      }
    } else if (insideRegion) {
      // Loop region exists but no change handler - show pointer to indicate clickable
      setCursor('pointer');
    } else {
      setCursor('default');
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (loopRegionStart === null || loopRegionEnd === null) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const midHeight = height / 2;
    const mouseY = e.clientY - rect.top;

    // Only interact if mouse is in top half
    if (mouseY > midHeight) return;

    const startX = CLIP_CONTENT_OFFSET + loopRegionStart * pixelsPerSecond - scrollX;
    const endX = CLIP_CONTENT_OFFSET + loopRegionEnd * pixelsPerSecond - scrollX;

    const nearStart = Math.abs(mouseX - startX) < EDGE_THRESHOLD;
    const nearEnd = Math.abs(mouseX - endX) < EDGE_THRESHOLD;
    const insideRegion = mouseX >= startX && mouseX <= endX;

    // Track click start for detecting click vs drag
    clickStartRef.current = { x: mouseX, y: mouseY, time: Date.now() };
    hasMovedRef.current = false; // Reset movement flag

    // Allow dragging if onLoopRegionChange is provided (works for both enabled and disabled states)
    if (onLoopRegionChange) {
      if (nearStart) {
        dragStateRef.current = { type: 'resize-start', startX: mouseX, initialStart: loopRegionStart, initialEnd: loopRegionEnd };
        setCursor('ew-resize');
        onLoopRegionInteracting?.(true);
      } else if (nearEnd) {
        dragStateRef.current = { type: 'resize-end', startX: mouseX, initialStart: loopRegionStart, initialEnd: loopRegionEnd };
        setCursor('ew-resize');
        onLoopRegionInteracting?.(true);
      } else if (insideRegion) {
        dragStateRef.current = { type: 'move', startX: mouseX, initialStart: loopRegionStart, initialEnd: loopRegionEnd };
        setCursor('grabbing');
        onLoopRegionInteracting?.(true);
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const hadDragState = dragStateRef.current !== null;

    if (dragStateRef.current) {
      if (dragStateRef.current.type === 'move') {
        setCursor('grab');
      }
      dragStateRef.current = null;
      onLoopRegionInteracting?.(false);
    }

    // Detect click (vs drag) - check if we didn't actually move, even if drag state was set
    if (clickStartRef.current && !hasMovedRef.current && loopRegionStart !== null && loopRegionEnd !== null) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const midHeight = height / 2;

      // Check if click stayed within loop region and top half
      if (mouseY <= midHeight) {
        const startX = CLIP_CONTENT_OFFSET + loopRegionStart * pixelsPerSecond - scrollX;
        const endX = CLIP_CONTENT_OFFSET + loopRegionEnd * pixelsPerSecond - scrollX;
        const insideRegion = mouseX >= startX && mouseX <= endX;

        // Check if mouse didn't move much (< 3px)
        const dx = Math.abs(mouseX - clickStartRef.current.x);
        const dy = Math.abs(mouseY - clickStartRef.current.y);
        const wasClick = dx < 3 && dy < 3;

        if (insideRegion && wasClick && onLoopRegionEnabledToggle) {
          onLoopRegionEnabledToggle();
        }
      }
    }

    clickStartRef.current = null;
    hasMovedRef.current = false;
  };

  const handleMouseLeave = () => {
    // Don't cancel drag on mouse leave - only clear cursor and hover state
    if (!dragStateRef.current) {
      setCursor('default');
      onLoopRegionHoverChange?.(false);
    }
  };

  // Add document-level mouse event listeners for continuous dragging
  useEffect(() => {
    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!dragStateRef.current || !onLoopRegionChange || !canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const deltaX = mouseX - dragStateRef.current.startX;
      const deltaTime = deltaX / pixelsPerSecond;

      // Mark that we've moved (for click detection)
      if (Math.abs(deltaX) > 3) {
        hasMovedRef.current = true;
      }

      if (dragStateRef.current.type === 'move') {
        // Maintain region width and prevent going below 0
        const regionWidth = dragStateRef.current.initialEnd - dragStateRef.current.initialStart;
        let newStart = dragStateRef.current.initialStart + deltaTime;
        let newEnd = dragStateRef.current.initialEnd + deltaTime;

        // If start would go negative, constrain both start and end
        if (newStart < 0) {
          newStart = 0;
          newEnd = regionWidth;
        }

        onLoopRegionChange(newStart, newEnd);
      } else if (dragStateRef.current.type === 'resize-start') {
        const newStart = Math.max(0, dragStateRef.current.initialStart + deltaTime);
        if (newStart > dragStateRef.current.initialEnd) {
          onLoopRegionChange(dragStateRef.current.initialEnd, newStart);
        } else {
          onLoopRegionChange(newStart, dragStateRef.current.initialEnd);
        }
      } else if (dragStateRef.current.type === 'resize-end') {
        const newEnd = dragStateRef.current.initialEnd + deltaTime;
        if (newEnd < dragStateRef.current.initialStart) {
          onLoopRegionChange(newEnd, dragStateRef.current.initialStart);
        } else {
          onLoopRegionChange(dragStateRef.current.initialStart, newEnd);
        }
      }
    };

    const handleDocumentMouseUp = () => {
      if (dragStateRef.current) {
        onLoopRegionInteracting?.(false);
        dragStateRef.current = null;
        setCursor('default');
      }
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [pixelsPerSecond, onLoopRegionChange, onLoopRegionInteracting]);

  return (
    <canvas
      ref={canvasRef}
      className="timeline-ruler"
      style={{
        width: `${viewportWidth ?? width}px`,
        height: `${height}px`,
        display: 'block',
        cursor,
      }}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    />
  );
}

function drawTimeMarkers(
  ctx: CanvasRenderingContext2D,
  pixelsPerSecond: number,
  scrollX: number,
  totalDuration: number,
  width: number,
  height: number,
  textColor: string,
  topTickColor: string,
  bottomTickColor: string,
  timeFormat: 'minutes-seconds' | 'beats-measures',
  bpm: number,
  beatsPerMeasure: number
) {
  if (timeFormat === 'beats-measures') {
    drawBeatsAndMeasures(ctx, pixelsPerSecond, scrollX, totalDuration, width, height, textColor, topTickColor, bottomTickColor, bpm, beatsPerMeasure);
  } else {
    drawMinutesAndSeconds(ctx, pixelsPerSecond, scrollX, totalDuration, width, height, textColor, topTickColor, bottomTickColor);
  }
}

function drawMinutesAndSeconds(
  ctx: CanvasRenderingContext2D,
  pixelsPerSecond: number,
  scrollX: number,
  totalDuration: number,
  width: number,
  height: number,
  textColor: string,
  topTickColor: string,
  bottomTickColor: string
) {
  const midHeight = height / 2;

  // Determine major interval based on zoom level
  let majorInterval = 1; // seconds
  if (pixelsPerSecond < 20) {
    majorInterval = 10;
  } else if (pixelsPerSecond < 50) {
    majorInterval = 5;
  } else if (pixelsPerSecond < 100) {
    majorInterval = 2;
  } else if (pixelsPerSecond < 200) {
    majorInterval = 1;
  } else {
    majorInterval = 0.5;
  }

  // Minor interval is 1/5 of major interval
  const minorInterval = majorInterval / 5;

  const startTime = Math.floor(scrollX / pixelsPerSecond / minorInterval) * minorInterval;
  const endTime = Math.ceil((scrollX + width) / pixelsPerSecond / minorInterval) * minorInterval;

  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = textColor;
  ctx.lineWidth = 1;

  // Draw bottom section ticks (both major and minor)
  for (let time = startTime; time <= endTime; time += minorInterval) {
    // Avoid floating point precision issues
    const roundedTime = Math.round(time / minorInterval) * minorInterval;
    const x = CLIP_CONTENT_OFFSET + roundedTime * pixelsPerSecond - scrollX;

    if (x < CLIP_CONTENT_OFFSET || x > width) continue;

    // Check if this is a major tick
    const isMajor = Math.abs(roundedTime % majorInterval) < 0.001;
    const tickX = Math.floor(x) + 0.5; // Offset by 0.5 for crisp 1px line

    if (isMajor) {
      // Major tick - full height in bottom section, same color as top
      ctx.strokeStyle = topTickColor;
      ctx.beginPath();
      ctx.moveTo(tickX, midHeight);
      ctx.lineTo(tickX, height);
      ctx.stroke();
    } else {
      // Minor tick - shorter, in bottom section only
      ctx.strokeStyle = bottomTickColor;
      const minorTickHeight = (height - midHeight) * 0.4; // 40% of bottom section height
      ctx.beginPath();
      ctx.moveTo(tickX, height - minorTickHeight);
      ctx.lineTo(tickX, height);
      ctx.stroke();
    }
  }

  // Draw top section ticks (only for major intervals)
  ctx.strokeStyle = topTickColor;
  for (let time = startTime; time <= endTime; time += majorInterval) {
    // Round to avoid floating point precision issues (same as bottom ticks)
    const roundedTime = Math.round(time / majorInterval) * majorInterval;
    const x = CLIP_CONTENT_OFFSET + roundedTime * pixelsPerSecond - scrollX;

    if (x < CLIP_CONTENT_OFFSET || x > width) continue;

    const tickX = Math.floor(x) + 0.5; // Offset by 0.5 for crisp 1px line

    // Draw tick in top section - full height from top to midline
    ctx.beginPath();
    ctx.moveTo(tickX, 0);
    ctx.lineTo(tickX, midHeight);
    ctx.stroke();
  }

  // Draw time labels for major ticks only
  for (let time = startTime; time <= endTime; time += majorInterval) {
    // Round to avoid floating point precision issues (same as ticks)
    const roundedTime = Math.round(time / majorInterval) * majorInterval;
    const x = CLIP_CONTENT_OFFSET + roundedTime * pixelsPerSecond - scrollX;

    if (x < CLIP_CONTENT_OFFSET || x > width) continue;

    const label = formatTime(roundedTime);
    // Position label in top section, left-aligned to tick mark
    const textY = midHeight / 2 + 4; // Center in top half
    ctx.fillText(label, x + 4, textY); // 4px offset from tick for spacing
  }
}

function drawBeatsAndMeasures(
  ctx: CanvasRenderingContext2D,
  pixelsPerSecond: number,
  scrollX: number,
  totalDuration: number,
  width: number,
  height: number,
  textColor: string,
  topTickColor: string,
  bottomTickColor: string,
  bpm: number,
  beatsPerMeasure: number
) {
  const midHeight = height / 2;

  // Calculate seconds per beat and seconds per measure
  const secondsPerBeat = 60 / bpm;
  const secondsPerMeasure = secondsPerBeat * beatsPerMeasure;

  // Determine finest subdivision to show based on zoom level
  // Each subdivision level doubles: beat, eighth, sixteenth, thirty-second
  const pixelsPerBeat = secondsPerBeat * pixelsPerSecond;
  let subdivisionsPerBeat = 1;
  if (pixelsPerBeat >= 160) subdivisionsPerBeat = 8;      // 32nd notes
  else if (pixelsPerBeat >= 80) subdivisionsPerBeat = 4;   // 16th notes
  else if (pixelsPerBeat >= 40) subdivisionsPerBeat = 2;   // 8th notes

  const secondsPerSubdivision = secondsPerBeat / subdivisionsPerBeat;
  const totalSubdivisionsPerMeasure = beatsPerMeasure * subdivisionsPerBeat;

  // Show beat ticks when there's enough room (≥8px per beat)
  // Show beat labels only when there's plenty of room (≥60px per beat)
  const showBeatTicks = pixelsPerBeat >= 8;
  const showBeatLabels = pixelsPerBeat >= 60;

  // When zoomed out, skip measure labels to avoid crowding
  // Find the smallest power-of-2-friendly interval where labels are ≥60px apart
  const pixelsPerMeasure = secondsPerMeasure * pixelsPerSecond;
  let measureLabelInterval = 1;
  for (const interval of [1, 2, 4, 8, 16, 32, 64, 128, 256]) {
    if (pixelsPerMeasure * interval >= 60) {
      measureLabelInterval = interval;
      break;
    }
  }

  // Also find interval for minor measure ticks (shown between labeled measures)
  // Hide them when they'd be less than ~6px apart
  const showMinorMeasureTicks = pixelsPerMeasure >= 6;

  // Calculate visible range
  const startMeasure = Math.floor((scrollX / pixelsPerSecond) / secondsPerMeasure);
  const endMeasure = Math.ceil(((scrollX + width) / pixelsPerSecond) / secondsPerMeasure);

  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = textColor;
  ctx.lineWidth = 1;

  const bottomHalf = height - midHeight;

  for (let measure = startMeasure; measure <= endMeasure; measure++) {
    // When very zoomed out, only process labeled measures
    const isLabeledMeasure = measure % measureLabelInterval === 0;
    if (!showMinorMeasureTicks && !isLabeledMeasure) continue;

    for (let sub = 0; sub < totalSubdivisionsPerMeasure; sub++) {
      const beatIndex = Math.floor(sub / subdivisionsPerBeat);
      const subWithinBeat = sub % subdivisionsPerBeat;

      // Skip beats and subdivisions if beat ticks aren't shown
      if (!showBeatTicks && sub !== 0) continue;

      const timeInSeconds = measure * secondsPerMeasure + sub * secondsPerSubdivision;
      const x = CLIP_CONTENT_OFFSET + timeInSeconds * pixelsPerSecond - scrollX;

      if (x < CLIP_CONTENT_OFFSET || x > width) continue;

      const tickX = Math.floor(x) + 0.5;
      const isMeasureBoundary = sub === 0;
      const isBeatBoundary = subWithinBeat === 0;

      if (isMeasureBoundary) {
        const isLabeledMeasure = measure % measureLabelInterval === 0;

        if (isLabeledMeasure) {
          // Major tick (labeled measure) - full height in both sections
          ctx.strokeStyle = topTickColor;

          // Top section
          ctx.beginPath();
          ctx.moveTo(tickX, 0);
          ctx.lineTo(tickX, midHeight);
          ctx.stroke();

          // Bottom section
          ctx.beginPath();
          ctx.moveTo(tickX, midHeight);
          ctx.lineTo(tickX, height);
          ctx.stroke();

          // Draw measure label
          ctx.fillStyle = textColor;
          const measureLabel = `${measure + 1}`;
          const textY = midHeight / 2 + 4;
          ctx.fillText(measureLabel, x + 4, textY);
        } else {
          // Minor measure tick - shorter, bottom section only
          ctx.strokeStyle = bottomTickColor;
          const tickHeight = bottomHalf * 0.4;
          ctx.beginPath();
          ctx.moveTo(tickX, height - tickHeight);
          ctx.lineTo(tickX, height);
          ctx.stroke();
        }
      } else if (isBeatBoundary) {
        // Beat tick - small, in bottom section
        ctx.strokeStyle = bottomTickColor;
        const tickHeight = bottomHalf * 0.25;
        ctx.beginPath();
        ctx.moveTo(tickX, height - tickHeight);
        ctx.lineTo(tickX, height);
        ctx.stroke();

        // Beat label (e.g., "1.2", "1.3") — only when zoomed in enough
        if (!showBeatLabels) continue;
        ctx.fillStyle = bottomTickColor;
        const beatLabel = `${measure + 1}.${beatIndex + 1}`;
        const textY = midHeight / 2 + 4;
        ctx.fillText(beatLabel, x + 4, textY);
      } else {
        // Subdivision tick - short, in bottom section only
        ctx.strokeStyle = bottomTickColor;
        const tickHeight = bottomHalf * 0.25;
        ctx.beginPath();
        ctx.moveTo(tickX, height - tickHeight);
        ctx.lineTo(tickX, height);
        ctx.stroke();
      }
    }
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  // Always format as m:ss
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
