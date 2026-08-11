import React, { useRef, useEffect } from 'react';
import { useTheme } from '../ThemeProvider/ThemeProvider';
import { RULER_HEIGHT } from './constants';
import type { PianoRollRulerProps } from './types';

/**
 * Timeline ruler for the piano roll, styled to match the main TimelineRuler.
 * Always displays in beats-measures format with the same rendering approach:
 * top/bottom split, sub-pixel alignment, and matching fonts/colors.
 */
export const PianoRollRuler: React.FC<PianoRollRulerProps> = ({
  width,
  scrollX,
  pixelsPerSecond,
  bpm,
  beatsPerMeasure,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const height = RULER_HEIGHT;

    // DPR scaling (same approach as main TimelineRuler)
    const MAX_CANVAS_DIMENSION = 32000;
    const baseDpr = window.devicePixelRatio || 1;
    const dpr = Math.min(baseDpr, MAX_CANVAS_DIMENSION / width, MAX_CANVAS_DIMENSION / height);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Colors from theme (matching main TimelineRuler)
    const bgColor = theme.background.surface.elevated;
    const textColor = theme.foreground.text.primary;
    const lineColor = theme.border.onElevated;
    const tickColor = theme.audio.timeline.tickMajor;

    // Background
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    // Midpoint divider (matching main ruler's split design)
    const midHeight = Math.floor(height / 2);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midHeight + 0.5);
    ctx.lineTo(width, midHeight + 0.5);
    ctx.stroke();

    // Beat/measure calculations
    const secondsPerBeat = 60 / bpm;
    const secondsPerMeasure = secondsPerBeat * beatsPerMeasure;

    const startMeasure = Math.floor((scrollX / pixelsPerSecond) / secondsPerMeasure);
    const endMeasure = Math.ceil(((scrollX + width) / pixelsPerSecond) / secondsPerMeasure);

    // Hide beat ticks/labels when they're too close together
    const beatPixelSpacing = secondsPerBeat * pixelsPerSecond;
    const showBeats = beatPixelSpacing >= 32;

    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = textColor;
    ctx.lineWidth = 1;

    for (let measure = startMeasure; measure <= endMeasure; measure++) {
      for (let beat = 0; beat < beatsPerMeasure; beat++) {
        if (!showBeats && beat !== 0) continue;

        const timeInSeconds = measure * secondsPerMeasure + beat * secondsPerBeat;
        const x = timeInSeconds * pixelsPerSecond - scrollX;

        if (x < 0 || x > width) continue;

        const tickX = Math.floor(x) + 0.5;
        const isMeasureBoundary = beat === 0;

        if (isMeasureBoundary) {
          // Major tick — full height in both sections
          ctx.strokeStyle = lineColor;

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

          // Measure label
          ctx.fillStyle = textColor;
          const label = `${measure + 1}`;
          const textY = midHeight / 2 + 4;
          ctx.fillText(label, x + 4, textY);
        } else {
          // Minor tick — shorter, bottom section only
          ctx.strokeStyle = tickColor;
          const minorTickHeight = (height - midHeight) * 0.4;
          ctx.beginPath();
          ctx.moveTo(tickX, height - minorTickHeight);
          ctx.lineTo(tickX, height);
          ctx.stroke();

          // Beat label (e.g., "1.2", "1.3")
          ctx.fillStyle = tickColor;
          const label = `${measure + 1}.${beat + 1}`;
          const textY = midHeight / 2 + 4;
          ctx.fillText(label, x + 4, textY);
        }
      }
    }
  }, [width, scrollX, pixelsPerSecond, bpm, beatsPerMeasure, theme]);

  return (
    <canvas
      ref={canvasRef}
      className="timeline-ruler"
      style={{
        width,
        height: RULER_HEIGHT,
        flexShrink: 0,
        display: 'block',
        cursor: 'default',
        userSelect: 'none',
      }}
    />
  );
};
