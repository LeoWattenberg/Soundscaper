import React, { useRef, useEffect } from 'react';
import { useTheme } from '../ThemeProvider/ThemeProvider';
import { TOTAL_PITCHES, BLACK_KEY_CLASSES } from './constants';
import type { NoteGridCanvasProps } from './types';

export const NoteGridCanvas: React.FC<NoteGridCanvasProps> = ({
  width,
  height,
  scrollX,
  scrollY,
  noteHeight,
  pixelsPerSecond,
  bpm,
  beatsPerMeasure,
  snap,
  timeBasis,
  clipStart,
  clipDuration,
  allClipBounds,
  hoveredKeyPitch,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();
  const pr = theme.audio.pianoRoll;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Draw lane backgrounds (semitone rows)
    const topPitch = TOTAL_PITCHES - 1 - Math.floor(scrollY / noteHeight);
    const bottomPitch = Math.max(0, TOTAL_PITCHES - 1 - Math.ceil((scrollY + height) / noteHeight) - 1);

    for (let pitch = topPitch; pitch >= bottomPitch; pitch--) {
      const y = (TOTAL_PITCHES - 1 - pitch) * noteHeight - scrollY;
      const isBlack = BLACK_KEY_CLASSES.includes(pitch % 12);
      ctx.fillStyle = isBlack ? pr.laneBlack : pr.laneWhite;
      ctx.fillRect(0, y, width, noteHeight);

      // Lane separator
      ctx.strokeStyle = pr.gridSubdivision;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + noteHeight);
      ctx.lineTo(width, y + noteHeight);
      ctx.stroke();

      // Octave lines (at C notes) get a stronger line
      if (pitch % 12 === 0) {
        ctx.strokeStyle = pr.gridBeat;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + noteHeight);
        ctx.lineTo(width, y + noteHeight);
        ctx.stroke();
      }
    }

    // Hovered lane highlight
    if (hoveredKeyPitch != null && hoveredKeyPitch >= bottomPitch && hoveredKeyPitch <= topPitch) {
      const hy = (TOTAL_PITCHES - 1 - hoveredKeyPitch) * noteHeight - scrollY;
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(0, hy, width, noteHeight);
    }

    // Draw grid lines (vertical)
    const beatDuration = 60 / bpm;
    const measureDuration = beatDuration * beatsPerMeasure;
    const fullSubDivisions = snap.subdivision * (snap.triplet ? 1.5 : 1);

    // Reduce visible subdivisions when zoomed out so lines don't crowd
    const MIN_GRID_PX = 12; // Minimum pixels between grid lines
    let subDivisions = fullSubDivisions;
    while (subDivisions > 1 && (beatDuration / subDivisions) * pixelsPerSecond < MIN_GRID_PX) {
      subDivisions = Math.floor(subDivisions / 2) || 1;
    }
    const gridStep = beatDuration / subDivisions;

    const startTime = scrollX / pixelsPerSecond;
    const endTime = (scrollX + width) / pixelsPerSecond;

    const firstGrid = Math.floor(startTime / gridStep) * gridStep;
    for (let t = firstGrid; t <= endTime; t += gridStep) {
      const x = t * pixelsPerSecond - scrollX;
      if (x < 0) continue;

      const beat = t / beatDuration;
      const beatRound = Math.round(beat * 1000) / 1000;
      const isWholeBeat = Math.abs(beatRound - Math.round(beatRound)) < 0.001;

      if (isWholeBeat) {
        const wholeBeat = Math.round(beatRound);
        if (wholeBeat % beatsPerMeasure === 0) {
          // Measure line
          ctx.strokeStyle = pr.gridMeasure;
          ctx.lineWidth = 1;
        } else {
          // Beat line
          ctx.strokeStyle = pr.gridBeat;
          ctx.lineWidth = 1;
        }
      } else {
        // Subdivision line
        ctx.strokeStyle = pr.gridSubdivision;
        ctx.lineWidth = 1;
      }

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Draw clip bounds (dimmed regions outside, boundary lines at edges)
    if (clipStart !== undefined && clipDuration !== undefined) {
      const clipStartX = clipStart * pixelsPerSecond - scrollX;
      const clipEndX = (clipStart + clipDuration) * pixelsPerSecond - scrollX;

      // Dim region left of clip
      if (clipStartX > 0) {
        ctx.fillStyle = pr.clipRegionOutside;
        ctx.fillRect(0, 0, clipStartX, height);
      }

      // Dim region right of clip
      if (clipEndX < width) {
        ctx.fillStyle = pr.clipRegionOutside;
        ctx.fillRect(clipEndX, 0, width - clipEndX, height);
      }

      // Boundary lines
      ctx.strokeStyle = pr.clipBoundary;
      ctx.lineWidth = 1;

      if (clipStartX >= 0 && clipStartX <= width) {
        ctx.beginPath();
        ctx.moveTo(clipStartX, 0);
        ctx.lineTo(clipStartX, height);
        ctx.stroke();
      }

      if (clipEndX >= 0 && clipEndX <= width) {
        ctx.beginPath();
        ctx.moveTo(clipEndX, 0);
        ctx.lineTo(clipEndX, height);
        ctx.stroke();
      }
    }

    // Draw ghost clip regions (lighter interior, boundary lines)
    if (allClipBounds && allClipBounds.length > 0) {
      for (const bounds of allClipBounds) {
        const startX = bounds.start * pixelsPerSecond - scrollX;
        const endX = (bounds.start + bounds.duration) * pixelsPerSecond - scrollX;

        // Lighten the ghost clip interior to distinguish it from the dimmed outside region
        const left = Math.max(0, startX);
        const right = Math.min(width, endX);
        if (right > left) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
          ctx.fillRect(left, 0, right - left, height);
        }

        // Boundary lines — use a dashed style to differentiate from active clip
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);

        if (startX >= 0 && startX <= width) {
          ctx.beginPath();
          ctx.moveTo(startX, 0);
          ctx.lineTo(startX, height);
          ctx.stroke();
        }
        if (endX >= 0 && endX <= width) {
          ctx.beginPath();
          ctx.moveTo(endX, 0);
          ctx.lineTo(endX, height);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }
  }, [width, height, scrollX, scrollY, noteHeight, pixelsPerSecond, bpm, beatsPerMeasure, snap, timeBasis, pr, clipStart, clipDuration, allClipBounds, hoveredKeyPitch]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width,
        height,
        pointerEvents: 'none',
      }}
    />
  );
};
