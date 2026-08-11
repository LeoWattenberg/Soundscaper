/**
 * Pure rendering component for spectral selection marquee
 *
 * This component handles only the visual rendering of the selection.
 * All interaction logic is handled by parent components and hooks.
 *
 * IMPORTANT: Coordinate System
 * - Clips are positioned at `CLIP_CONTENT_OFFSET + clip.start * pixelsPerSecond`
 * - Mouse coordinates are relative to the canvas container (no leftPadding offset)
 * - Canvas clipping ensures the marquee never renders outside clip boundaries
 */

import React, { useRef, useEffect } from 'react';
import { CLIP_CONTENT_OFFSET } from '../constants';
import {
  getSelectionBounds,
  drawMarqueeBorder,
  drawBlackMarqueeBorder,
  drawCenterLine,
  drawCornerHandles,
  drawDarkenedOverlays,
  CoordinateConfig,
} from './utils';
import { SpectralSelection, Track } from './types';

export interface SpectralSelectionCanvasProps {
  /** The spectral selection to render */
  selection: SpectralSelection;
  /** Track data to find clip positions */
  tracks: Track[];
  /** Coordinate configuration */
  coordinateConfig: CoordinateConfig;
  /** Canvas dimensions */
  width: number;
  height: number;
  /** Whether mouse is hovering over center line */
  isHoveringCenterLine?: boolean;
  /** Whether the selection is being dragged */
  isDragging?: boolean;
  /** Whether we're actively creating a new selection (marquee in progress) */
  isCreating?: boolean;
}

/**
 * Pure rendering component for spectral selection
 */
export function SpectralSelectionCanvas({
  selection,
  tracks,
  coordinateConfig,
  width,
  height,
  isHoveringCenterLine = false,
  isDragging = false,
  isCreating = false,
}: SpectralSelectionCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // HiDPI: size backing store to device pixels, keep CSS box at logical pixels,
    // then scale the drawing context so the rest of this effect can draw in logical px.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    const { trackIndex, clipId, startTime, endTime, minFrequency, maxFrequency } = selection;

    // Get track
    if (trackIndex >= tracks.length) return;
    const track = tracks[trackIndex];

    // If clipId is specified, find that specific clip
    // Otherwise, render across all clips in the time range
    const clip = clipId !== undefined ? track.clips.find(c => c.id === clipId) : null;

    // Calculate track Y position
    let trackY = coordinateConfig.initialGap;
    for (let i = 0; i < trackIndex; i++) {
      trackY += coordinateConfig.trackHeights[i] + coordinateConfig.trackGap;
    }

    const trackHeight = coordinateConfig.trackHeights[trackIndex];

    // Find all clips that overlap with the selection time range
    const overlappingClips = track.clips.filter(c => {
      const clipEnd = c.start + c.duration;
      return clipEnd > startTime && c.start < endTime;
    });

    // If no clips overlap, don't render anything
    if (overlappingClips.length === 0) return;

    // Calculate selection boundaries in pixels based on time range
    const selectionStartX = CLIP_CONTENT_OFFSET + startTime * coordinateConfig.pixelsPerSecond;
    const selectionEndX = CLIP_CONTENT_OFFSET + endTime * coordinateConfig.pixelsPerSecond;
    const clipBodyY = trackY + coordinateConfig.clipHeaderHeight;
    const clipBodyHeight = trackHeight - coordinateConfig.clipHeaderHeight;

    // For split view, spectral selection is only in top half
    const isSplitView = (track as any).viewMode === 'split';
    const isSpectrogramMode = (track as any).viewMode === 'spectrogram';
    // Determine stereo from the first clip in the track (or the specific clip if specified)
    const firstClip = clip || track.clips[0];
    const isStereo = firstClip && (firstClip as any).waveformLeft && (firstClip as any).waveformRight;
    const channelSplitRatio = (track as any).channelSplitRatio ?? 0.5;

    const spectralAreaHeight = isSplitView ? clipBodyHeight / 2 : clipBodyHeight;

    // Check if selection spans full frequency range for time-selection-style overlay
    // For mono: full range is 0-1
    // For stereo spectrogram or split view: also consider full L channel (0.5-1) or full R channel (0-0.5)
    const isFullHeight = (minFrequency === 0 && maxFrequency === 1) ||
                         ((isSpectrogramMode || isSplitView) && isStereo && minFrequency === 0.5 && maxFrequency === 1.0) ||
                         ((isSpectrogramMode || isSplitView) && isStereo && minFrequency === 0.0 && maxFrequency === 0.5);

    // For stereo tracks in spectrogram or split view, render on both L and R channels
    if ((isSpectrogramMode || isSplitView) && isStereo) {
      // Stereo: L channel on top, R channel on bottom
      // Use channelSplitRatio to determine channel heights
      // In split view: spectral area is top half, then split by ratio
      // In spectrogram mode: full clip body split by ratio
      const baseHeight = isSplitView ? spectralAreaHeight : clipBodyHeight;
      const lChannelHeight = baseHeight * channelSplitRatio;
      const rChannelHeight = baseHeight * (1 - channelSplitRatio);

      // Determine which channel the selection is in
      // For border/handles: only show on the channel where selection started
      const isInLChannel = minFrequency >= 0.5;
      const isInRChannel = maxFrequency <= 0.5;

      // Only draw marquee UI (border, center line, handles) on the origin channel
      // If originChannel is not set, fall back to center-based logic for backward compatibility
      const shouldDrawUIOnL = selection.originChannel === 'L' ||
                              (!selection.originChannel && (minFrequency + maxFrequency) / 2 >= 0.5);
      const shouldDrawUIOnR = selection.originChannel === 'R' ||
                              (!selection.originChannel && (minFrequency + maxFrequency) / 2 < 0.5);

      // Render on L channel (top half)
      // L channel displays frequencies 0.5-1.0, remapped to 0-1
      // Mirror selections across channels in both spectrogram and split view
      let lMinFreq: number, lMaxFreq: number;
      if (isInLChannel) {
        // Selection is in L channel - remap 0.5-1.0 to 0-1
        lMinFreq = Math.max(0, Math.min(1, (minFrequency - 0.5) * 2));
        lMaxFreq = Math.max(0, Math.min(1, (maxFrequency - 0.5) * 2));
      } else {
        // Selection is in R channel - mirror it to L channel (remap 0-0.5 to 0-1)
        lMinFreq = Math.max(0, Math.min(1, minFrequency * 2));
        lMaxFreq = Math.max(0, Math.min(1, maxFrequency * 2));
      }

      const boundsL = getSelectionBounds(
        startTime,
        endTime,
        lMinFreq,
        lMaxFreq,
        trackIndex,
        coordinateConfig,
        'L'
      );

      // Draw full-height overlay BEFORE clipping (so it covers the header too)
      if (isFullHeight) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen'; // Use same blend mode as time selection
        ctx.fillStyle = 'rgba(112, 181, 255, 0.6)'; // Increased opacity to match time selection brightness
        ctx.fillRect(boundsL.leftX, trackY, boundsL.width, trackHeight);
        ctx.restore();
      }

      ctx.save();
      ctx.beginPath();
      // Clip to only the overlapping clips (not the gaps between clips)
      overlappingClips.forEach(c => {
        const clipStartX = CLIP_CONTENT_OFFSET + c.start * coordinateConfig.pixelsPerSecond;
        const clipEndX = clipStartX + c.duration * coordinateConfig.pixelsPerSecond;
        // Intersect clip boundaries with selection boundaries
        const left = Math.max(selectionStartX, clipStartX);
        const right = Math.min(selectionEndX, clipEndX);
        if (right > left) {
          ctx.rect(left, clipBodyY, right - left, lChannelHeight - 0.5);
        }
      });
      ctx.clip();

      drawDarkenedOverlays(
        ctx,
        boundsL,
        minFrequency,
        maxFrequency,
        trackY,
        trackHeight,
        coordinateConfig.clipHeaderHeight
      );

      // Always show white/black border, corner handles, and center line on both channels
      drawMarqueeBorder(ctx, boundsL);
      drawCornerHandles(ctx, boundsL);
      const shouldHighlightL = isHoveringCenterLine;
      drawCenterLine(ctx, boundsL, shouldHighlightL);

      ctx.restore();

      // Render on R channel (below L channel in spectral area)
      // R channel displays frequencies 0-0.5, remapped to 0-1
      // Mirror selections across channels in both spectrogram and split view
      let rMinFreq: number, rMaxFreq: number;
      if (isInRChannel) {
        // Selection is in R channel - remap 0-0.5 to 0-1
        rMinFreq = Math.max(0, Math.min(1, minFrequency * 2));
        rMaxFreq = Math.max(0, Math.min(1, maxFrequency * 2));
      } else {
        // Selection is in L channel - mirror it to R channel (remap 0.5-1.0 to 0-1)
        rMinFreq = Math.max(0, Math.min(1, (minFrequency - 0.5) * 2));
        rMaxFreq = Math.max(0, Math.min(1, (maxFrequency - 0.5) * 2));
      }

      const boundsR = getSelectionBounds(
        startTime,
        endTime,
        rMinFreq,
        rMaxFreq,
        trackIndex,
        coordinateConfig,
        'R'
      );

      ctx.save();
      ctx.beginPath();
      // Clip R channel to only the overlapping clips
      const rChannelTop = clipBodyY + lChannelHeight + 0.5;
      const rChannelClipHeight = isSplitView ? rChannelHeight - 0.5 : rChannelHeight;
      overlappingClips.forEach(c => {
        const clipStartX = CLIP_CONTENT_OFFSET + c.start * coordinateConfig.pixelsPerSecond;
        const clipEndX = clipStartX + c.duration * coordinateConfig.pixelsPerSecond;
        const left = Math.max(selectionStartX, clipStartX);
        const right = Math.min(selectionEndX, clipEndX);
        if (right > left) {
          ctx.rect(left, rChannelTop, right - left, rChannelClipHeight);
        }
      });
      ctx.clip();

      drawDarkenedOverlays(
        ctx,
        boundsR,
        minFrequency,
        maxFrequency,
        trackY,
        trackHeight,
        coordinateConfig.clipHeaderHeight
      );

      // Always show white/black border, corner handles, and center line on both channels
      drawMarqueeBorder(ctx, boundsR);
      drawCornerHandles(ctx, boundsR);
      drawCenterLine(ctx, boundsR, isHoveringCenterLine);

      ctx.restore();
    } else {
      // Mono or split view: single selection
      const bounds = getSelectionBounds(
        startTime,
        endTime,
        minFrequency,
        maxFrequency,
        trackIndex,
        coordinateConfig
      );

      // Draw full-height overlay BEFORE clipping (so it covers the header too)
      if (isFullHeight) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen'; // Use same blend mode as time selection
        ctx.fillStyle = 'rgba(112, 181, 255, 0.6)'; // Increased opacity to match time selection brightness
        ctx.fillRect(bounds.leftX, trackY, bounds.width, trackHeight);
        ctx.restore();
      }

      ctx.save();
      ctx.beginPath();
      // Clip to only the overlapping clips (not the gaps between clips)
      overlappingClips.forEach(c => {
        const clipStartX = CLIP_CONTENT_OFFSET + c.start * coordinateConfig.pixelsPerSecond;
        const clipEndX = clipStartX + c.duration * coordinateConfig.pixelsPerSecond;
        const left = Math.max(selectionStartX, clipStartX);
        const right = Math.min(selectionEndX, clipEndX);
        if (right > left) {
          ctx.rect(left, clipBodyY, right - left, spectralAreaHeight - 0.5);
        }
      });
      ctx.clip();

      drawDarkenedOverlays(
        ctx,
        bounds,
        minFrequency,
        maxFrequency,
        trackY,
        trackHeight,
        coordinateConfig.clipHeaderHeight
      );

      drawMarqueeBorder(ctx, bounds);
      // Only highlight center line when hovering OR when being dragged (not during creation or resize)
      drawCenterLine(ctx, bounds, isHoveringCenterLine);
      drawCornerHandles(ctx, bounds);

      ctx.restore();
    }
  }, [selection, tracks, coordinateConfig, isHoveringCenterLine, isDragging, isCreating]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
