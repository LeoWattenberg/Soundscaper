import React, { useCallback, useEffect, useRef } from 'react';
import { useTheme } from '../ThemeProvider/ThemeProvider';
import { CLIP_STRIP_HEIGHT } from './constants';
import type { MidiClip, SnapGrid } from '@audacity-ui/core';

export interface PianoRollClipStripProps {
  clips: MidiClip[];
  activeClipId?: number;
  pixelsPerSecond: number;
  scrollX: number;
  width: number;
  snap: SnapGrid;
  bpm: number;
  onResizeClip?: (edge: 'left' | 'right', newStart: number, newDuration: number, newTrimStart: number, clipId: number) => void;
  onSelectClip?: (clipId: number) => void;
  /** Called when a clip is dragged to a new position in global mode */
  onMoveClip?: (clipId: number, newStart: number) => void;
  /** ID of the clip being hovered (for cross-component highlight) */
  hoveredClipId?: number | null;
  /** Called when mouse enters/leaves a clip bar */
  onHoverClip?: (clipId: number | null) => void;
  trackColor?: string;
}

const EDGE_WIDTH = 6;

export const PianoRollClipStrip: React.FC<PianoRollClipStripProps> = ({
  clips,
  activeClipId,
  pixelsPerSecond,
  scrollX,
  width,
  snap,
  bpm,
  onResizeClip,
  onSelectClip,
  onMoveClip,
  hoveredClipId,
  onHoverClip,
  trackColor,
}) => {
  const { theme } = useTheme();
  const pr = theme.audio.pianoRoll;
  const clipColors = trackColor ? (theme.audio.clip as Record<string, any>)[trackColor] : null;
  const dragRef = useRef<{
    clipId: number;
    edge: 'left' | 'right';
    initialStart: number;
    initialTrimStart: number;
    initialDuration: number;
    startMouseX: number;
  } | null>(null);

  const snapTime = useCallback((t: number): number => {
    const beatDuration = 60 / bpm;
    const subDivisions = snap.subdivision * (snap.triplet ? 1.5 : 1);
    const gridStep = beatDuration / subDivisions;
    return Math.round(t / gridStep) * gridStep;
  }, [bpm, snap]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaX = e.clientX - drag.startMouseX;
      const deltaTime = deltaX / pixelsPerSecond;

      if (drag.edge === 'left') {
        // Left edge adjusts trimStart (like trimming audio)
        const newTrimStart = snapTime(drag.initialTrimStart + deltaTime);
        const clampedTrimStart = Math.max(0, newTrimStart);
        const trimDelta = clampedTrimStart - drag.initialTrimStart;
        const newDuration = drag.initialDuration - trimDelta;
        const newStart = drag.initialStart + trimDelta;
        if (newDuration > 0) {
          onResizeClip?.('left', newStart, newDuration, clampedTrimStart, drag.clipId);
        }
      } else {
        const newEnd = snapTime(drag.initialTrimStart + drag.initialDuration + deltaTime);
        const newDuration = newEnd - drag.initialTrimStart;
        if (newDuration > 0) {
          onResizeClip?.('right', drag.initialStart, newDuration, drag.initialTrimStart, drag.clipId);
        }
      }
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      document.body.style.cursor = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [pixelsPerSecond, snapTime, onResizeClip]);

  const handleEdgeMouseDown = useCallback((
    e: React.MouseEvent,
    clipId: number,
    edge: 'left' | 'right',
    clipStart: number,
    clipTrimStart: number,
    clipDuration: number,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = {
      clipId,
      edge,
      initialStart: clipStart,
      initialTrimStart: clipTrimStart,
      initialDuration: clipDuration,
      startMouseX: e.clientX,
    };
    document.body.style.cursor = 'ew-resize';
  }, []);

  const handleClipMouseDown = useCallback((e: React.MouseEvent, clip: MidiClip) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    let hasMoved = false;

    const handleMove = (me: MouseEvent) => {
      const dx = Math.abs(me.clientX - startX);
      if (!hasMoved && dx < 3) return;
      hasMoved = true;
      if (onMoveClip) {
        const deltaTime = (me.clientX - startX) / pixelsPerSecond;
        const newStart = snapTime(Math.max(0, clip.start + deltaTime));
        onMoveClip(clip.id, newStart);
      }
    };

    const handleUp = () => {
      if (!hasMoved) {
        onSelectClip?.(clip.id);
      }
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [onSelectClip, onMoveClip, pixelsPerSecond, snapTime]);

  return (
    <div
      style={{
        position: 'relative',
        height: CLIP_STRIP_HEIGHT,
        flexShrink: 0,
        background: `linear-gradient(${pr.background}, rgba(255,255,255,0.04) 0%, ${pr.background})`,
        borderBottom: `1px solid ${pr.gridSubdivision}`,
        overflow: 'hidden',
      }}
    >
      {clips.map((clip) => {
        // Global mode (no active clip): position at clip.start
        // Local mode (active clip): position at trimStart
        const isGlobalMode = activeClipId === undefined || activeClipId === null;
        const xTime = isGlobalMode ? clip.start : (clip.trimStart ?? 0);
        const x = xTime * pixelsPerSecond - scrollX;
        const w = clip.duration * pixelsPerSecond;

        // Skip if entirely out of view
        if (x + w < 0 || x > width) return null;

        const isActive = clip.id === activeClipId;
        const isHovered = clip.id === hoveredClipId;
        const baseColor = clipColors?.header ?? pr.noteFill;

        return (
          <div
            key={clip.id}
            style={{
              position: 'absolute',
              left: x,
              top: 2,
              width: w,
              height: CLIP_STRIP_HEIGHT - 4,
              background: baseColor,
              opacity: isActive || isHovered ? 1 : 0.4,
              borderRadius: 2,
              cursor: 'pointer',
              pointerEvents: undefined,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              display: 'flex',
              alignItems: 'center',
              outline: isHovered && !isActive ? `1px solid ${baseColor}` : undefined,
              outlineOffset: 1,
            }}
            onMouseDown={(e) => handleClipMouseDown(e, clip)}
            onMouseEnter={() => onHoverClip?.(clip.id)}
            onMouseLeave={() => onHoverClip?.(null)}
          >
            {/* Clip name */}
            <span
              style={{
                fontSize: 11,
                fontFamily: 'Inter, sans-serif',
                color: '#fff',
                paddingLeft: 4,
                pointerEvents: 'none',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                lineHeight: 1,
              }}
            >
              {clip.name}
            </span>

            {/* Left edge handle */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: EDGE_WIDTH,
                height: '100%',
                cursor: 'ew-resize',
              }}
              onMouseDown={(e) => handleEdgeMouseDown(e, clip.id, 'left', clip.start, clip.trimStart ?? 0, clip.duration)}
            />

            {/* Right edge handle */}
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: 0,
                width: EDGE_WIDTH,
                height: '100%',
                cursor: 'ew-resize',
              }}
              onMouseDown={(e) => handleEdgeMouseDown(e, clip.id, 'right', clip.start, clip.trimStart ?? 0, clip.duration)}
            />
          </div>
        );
      })}
    </div>
  );
};
