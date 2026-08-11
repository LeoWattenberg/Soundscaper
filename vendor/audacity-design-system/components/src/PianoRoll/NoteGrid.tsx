import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useTheme } from '../ThemeProvider/ThemeProvider';
import { NoteGridCanvas } from './NoteGridCanvas';
import { NoteRect } from '../NoteRect/NoteRect';
import type { NoteEdge } from '../NoteRect/NoteRect';
import { TOTAL_PITCHES, NOTE_MOVE_THRESHOLD, DEFAULT_VELOCITY, MIN_PPS, MAX_PPS, CLIP_BOUNDARY_THRESHOLD } from './constants';
import type { NoteGridProps } from './types';
import type { MidiNote, MidiClip } from '@audacity-ui/core';

interface DragState {
  type: 'move' | 'resize-left' | 'resize-right';
  noteId: number;
  startX: number;
  startY: number;
  hasMoved: boolean;
  /** Initial positions of all selected notes (for multi-note drag) */
  initials: Array<{ id: number; pitch: number; startTime: number; duration: number }>;
}

interface ClipBoundaryDragState {
  edge: 'left' | 'right';
  clipId: number;
  startMouseX: number;
  initialStart: number;
  initialTrimStart: number;
  initialDuration: number;
}

interface BoxSelectionState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  additive: boolean;
}

/** A note with its clip context for rendering and interaction */
interface NoteWithContext {
  note: MidiNote;
  clipId: number;
  /** In global mode, notes render offset by their clip's start time */
  globalTimeOffset: number;
}

export const NoteGrid: React.FC<NoteGridProps> = ({
  clip,
  allClips,
  bpm,
  beatsPerMeasure,
  pixelsPerSecond,
  scrollX,
  scrollY,
  noteHeight,
  snap,
  timeBasis,
  width,
  height,
  onAddNote,
  onDeleteNotes,
  onUpdateNote,
  onMoveNotes,
  onResizeNote,
  onSelectNote,
  onSelectNotes,
  onDeselectAll,
  onScrollYChange,
  onPixelsPerSecondChange,
  onScrollXChange,
  onResizeClip,
  trackColor,
  onHoverClip,
  hoveredKeyPitch,
  onPlayNote,
}) => {
  const { theme } = useTheme();
  const dragRef = useRef<DragState | null>(null);
  const clipBoundaryDragRef = useRef<ClipBoundaryDragState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [gridCursor, setGridCursor] = useState<string>('crosshair');
  const boxSelectionRef = useRef<BoxSelectionState | null>(null);
  const lastResizedDurationRef = useRef<number | null>(null);
  const [boxSelectionRect, setBoxSelectionRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [previewNote, setPreviewNote] = useState<{ pitch: number; startTime: number; duration: number } | null>(null);
  const previewNoteRef = useRef(previewNote);
  previewNoteRef.current = previewNote;
  const [ghostNote, setGhostNote] = useState<{ pitch: number; startTime: number; duration: number } | null>(null);
  const isDraggingRef = useRef(false);
  const [dragPitch, setDragPitch] = useState<number | null>(null);
  const lastPlayedPitchRef = useRef<number | null>(null);

  // Effective highlighted pitch: keyboard hover > preview note > ghost note > drag
  const effectiveHoveredPitch = hoveredKeyPitch ?? previewNote?.pitch ?? ghostNote?.pitch ?? dragPitch ?? null;

  // Global mode (no clip selected): show all clips' notes at global positions
  // Local mode (clip selected): show only the active clip's notes at local positions
  const isGlobalMode = !clip;
  const visibleClips = clip ? [clip] : (allClips ?? []);

  // Build unified note list from all visible clips
  const allNotes: NoteWithContext[] = useMemo(() => {
    return visibleClips.flatMap(c =>
      c.notes.map(n => ({ note: n, clipId: c.id, globalTimeOffset: isGlobalMode ? c.start : 0 }))
    );
  }, [visibleClips, isGlobalMode]);

  // In global mode, show all clip boundaries
  const ghostClipBounds: Array<{ start: number; duration: number }> = isGlobalMode
    ? (allClips ?? []).map(c => ({ start: c.start, duration: c.duration }))
    : [];

  // Snap helper
  const snapTime = useCallback((t: number): number => {
    const beatDuration = 60 / bpm;
    const subDivisions = snap.subdivision * (snap.triplet ? 1.5 : 1);
    const gridStep = beatDuration / subDivisions;
    return Math.round(t / gridStep) * gridStep;
  }, [bpm, snap]);

  // Convert pixel X to global time
  const xToTime = useCallback((px: number): number => {
    return (px + scrollX) / pixelsPerSecond;
  }, [scrollX, pixelsPerSecond]);

  // Convert pixel Y to pitch
  const yToPitch = useCallback((py: number): number => {
    return TOTAL_PITCHES - 1 - Math.floor((py + scrollY) / noteHeight);
  }, [scrollY, noteHeight]);

  // Detect if a pixel X is near the active clip's boundary edge (local time: trimStart to trimStart + duration)
  const getClipBoundaryEdge = useCallback((localX: number): { edge: 'left' | 'right'; clip: MidiClip } | null => {
    if (!clip) return null;
    for (const c of [clip]) {
      const trimStart = c.trimStart ?? 0;
      const clipStartX = trimStart * pixelsPerSecond - scrollX;
      const clipEndX = (trimStart + c.duration) * pixelsPerSecond - scrollX;
      if (Math.abs(localX - clipStartX) <= CLIP_BOUNDARY_THRESHOLD) return { edge: 'left', clip: c };
      if (Math.abs(localX - clipEndX) <= CLIP_BOUNDARY_THRESHOLD) return { edge: 'right', clip: c };
    }
    return null;
  }, [visibleClips, pixelsPerSecond, scrollX]);

  // Update cursor on mouse move over grid and show ghost note
  const handleGridMouseMove = useCallback((e: React.MouseEvent) => {
    // Don't override cursor during active drags
    if (dragRef.current || clipBoundaryDragRef.current || boxSelectionRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const edge = getClipBoundaryEdge(localX);
    setGridCursor(edge ? 'ew-resize' : 'crosshair');

    // Detect which clip the cursor is over (for cross-component hover highlight)
    if (onHoverClip && isGlobalMode) {
      const cursorTime = xToTime(localX);
      const hovered = visibleClips.find(c => cursorTime >= c.start && cursorTime <= c.start + c.duration);
      onHoverClip(hovered ? hovered.id : null);
    }

    // Hide ghost note when hovering over an existing note
    const target = e.target as HTMLElement;
    const isOverNote = target.closest('[data-note-id]') !== null;

    // Show ghost note preview when not dragging, not near clip boundary, and not over a note
    if (!isDraggingRef.current && !edge && !isOverNote) {
      const pitch = yToPitch(localY);
      if (pitch >= 0 && pitch <= 127) {
        const snappedTime = snapTime(xToTime(localX));
        const beatDuration = 60 / bpm;
        const duration = lastResizedDurationRef.current ?? beatDuration / snap.subdivision;
        setGhostNote({ pitch, startTime: Math.max(0, snappedTime), duration });
      } else {
        setGhostNote(null);
      }
    } else if (isOverNote) {
      setGhostNote(null);
    }
  }, [getClipBoundaryEdge, yToPitch, snapTime, xToTime, bpm, snap, onHoverClip, isGlobalMode, visibleClips]);

  // Clear ghost and hover when mouse leaves the grid
  const handleMouseLeave = useCallback(() => {
    setGhostNote(null);
    onHoverClip?.(null);
  }, [onHoverClip]);

  // Handle click on empty grid — add note, start box selection, or start clip boundary drag
  const handleBackgroundMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    setGhostNote(null);

    const rect = e.currentTarget.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    // Check clip boundary drag first
    if (onResizeClip) {
      const boundaryHit = getClipBoundaryEdge(localX);
      if (boundaryHit) {
        e.preventDefault();
        clipBoundaryDragRef.current = {
          edge: boundaryHit.edge,
          clipId: boundaryHit.clip.id,
          startMouseX: e.clientX,
          initialStart: boundaryHit.clip.start,
          initialTrimStart: boundaryHit.clip.trimStart ?? 0,
          initialDuration: boundaryHit.clip.duration,
        };
        setGridCursor('ew-resize');

        const handleBoundaryMove = (me: MouseEvent) => {
          const drag = clipBoundaryDragRef.current;
          if (!drag) return;

          const dx = me.clientX - drag.startMouseX;
          const deltaTime = dx / pixelsPerSecond;
          const minDuration = (60 / bpm) / 4; // minimum 1/4 beat

          if (drag.edge === 'left') {
            // Left edge drag adjusts trimStart — like trimming audio
            const newTrimStart = snapTime(drag.initialTrimStart + deltaTime);
            const clampedTrimStart = Math.max(0, newTrimStart);
            const trimDelta = clampedTrimStart - drag.initialTrimStart;
            const newDuration = drag.initialDuration - trimDelta;
            const newStart = drag.initialStart + trimDelta;
            if (newDuration >= minDuration) {
              onResizeClip('left', newStart, newDuration, clampedTrimStart, drag.clipId);
            }
          } else {
            // Right edge drag adjusts duration only — trimStart unchanged
            const newEnd = snapTime(drag.initialTrimStart + drag.initialDuration + deltaTime);
            const newDuration = newEnd - drag.initialTrimStart;
            if (newDuration >= minDuration) {
              onResizeClip('right', drag.initialStart, newDuration, drag.initialTrimStart, drag.clipId);
            }
          }
        };

        const handleBoundaryUp = () => {
          clipBoundaryDragRef.current = null;
          isDraggingRef.current = false;
          setGridCursor('crosshair');
          document.removeEventListener('mousemove', handleBoundaryMove);
          document.removeEventListener('mouseup', handleBoundaryUp);
        };

        document.addEventListener('mousemove', handleBoundaryMove);
        document.addEventListener('mouseup', handleBoundaryUp);
        return;
      }
    }

    // Cmd/Ctrl + click on empty area = start box selection
    if (e.metaKey || e.ctrlKey) {
      const additive = e.shiftKey;
      boxSelectionRef.current = {
        startX: localX,
        startY: localY,
        currentX: localX,
        currentY: localY,
        additive,
      };
      if (!additive) {
        onDeselectAll();
      }
      setGridCursor('crosshair');

      const handleBoxMove = (me: MouseEvent) => {
        const box = boxSelectionRef.current;
        if (!box) return;
        const r = containerRef.current?.getBoundingClientRect();
        if (!r) return;
        box.currentX = me.clientX - r.left;
        box.currentY = me.clientY - r.top;
        const x = Math.min(box.startX, box.currentX);
        const y = Math.min(box.startY, box.currentY);
        const w = Math.abs(box.currentX - box.startX);
        const h = Math.abs(box.currentY - box.startY);
        setBoxSelectionRect({ x, y, width: w, height: h });
      };

      const handleBoxUp = () => {
        isDraggingRef.current = false;
        const box = boxSelectionRef.current;
        if (box) {
          // AABB intersection: find notes within the box
          const boxLeft = Math.min(box.startX, box.currentX);
          const boxRight = Math.max(box.startX, box.currentX);
          const boxTop = Math.min(box.startY, box.currentY);
          const boxBottom = Math.max(box.startY, box.currentY);

          const matchedIds: number[] = [];
          for (const { note, globalTimeOffset } of allNotes) {
            const nx = (note.startTime + globalTimeOffset) * pixelsPerSecond - scrollX;
            const ny = (TOTAL_PITCHES - 1 - note.pitch) * noteHeight - scrollY;
            const nw = note.duration * pixelsPerSecond;
            const nh = noteHeight;

            // AABB overlap test
            if (nx + nw > boxLeft && nx < boxRight && ny + nh > boxTop && ny < boxBottom) {
              matchedIds.push(note.id);
            }
          }

          if (matchedIds.length > 0) {
            onSelectNotes(matchedIds, box.additive);
          }
        }
        boxSelectionRef.current = null;
        setBoxSelectionRect(null);
        document.removeEventListener('mousemove', handleBoxMove);
        document.removeEventListener('mouseup', handleBoxUp);
      };

      document.addEventListener('mousemove', handleBoxMove);
      document.addEventListener('mouseup', handleBoxUp);
      return;
    }

    // Plain click on empty area = preview note on mousedown, commit on mouseup
    const globalTime = snapTime(xToTime(localX));
    const pitch = yToPitch(localY);
    if (pitch < 0 || pitch > 127) return;

    onDeselectAll();

    const beatDuration = 60 / bpm;
    const duration = lastResizedDurationRef.current ?? beatDuration / snap.subdivision;

    setPreviewNote({ pitch, startTime: Math.max(0, globalTime), duration });
    onPlayNote?.(pitch);
    lastPlayedPitchRef.current = pitch;

    const handlePreviewMove = (me: MouseEvent) => {
      const r = containerRef.current?.getBoundingClientRect();
      if (!r) return;
      const newPitch = Math.max(0, Math.min(127, yToPitch(me.clientY - r.top)));
      const newTime = Math.max(0, snapTime(xToTime(me.clientX - r.left)));
      if (newPitch !== lastPlayedPitchRef.current) {
        onPlayNote?.(newPitch);
        lastPlayedPitchRef.current = newPitch;
      }
      setPreviewNote(prev => prev ? { ...prev, pitch: newPitch, startTime: newTime } : null);
    };

    const handlePreviewUp = () => {
      isDraggingRef.current = false;
      lastPlayedPitchRef.current = null;
      const current = previewNoteRef.current;
      if (current) {
        const newNote: MidiNote = {
          id: Date.now(),
          pitch: current.pitch,
          startTime: current.startTime,
          duration: current.duration,
          velocity: DEFAULT_VELOCITY,
        };
        onAddNote(newNote);
      }
      setPreviewNote(null);
      document.removeEventListener('mousemove', handlePreviewMove);
      document.removeEventListener('mouseup', handlePreviewUp);
    };

    document.addEventListener('mousemove', handlePreviewMove);
    document.addEventListener('mouseup', handlePreviewUp);
  }, [snapTime, xToTime, yToPitch, bpm, snap, onAddNote, onDeselectAll, allNotes, pixelsPerSecond, scrollX, scrollY, noteHeight, onSelectNotes, visibleClips, onResizeClip, getClipBoundaryEdge, onPlayNote]);

  // Handle note mouse down (drag or resize)
  const handleNoteMouseDown = useCallback((e: React.MouseEvent, note: { id: number; pitch: number; velocity: number; selected?: boolean }, edge: NoteEdge) => {
    e.preventDefault();
    e.stopPropagation();

    const isAdditive = e.metaKey || e.ctrlKey;

    // Find the full note data across all clips
    const fullNote = allNotes.find(nc => nc.note.id === note.id)?.note;

    if (edge === 'body') {
      // Select the note
      if (!note.selected) {
        onSelectNote(note.id, isAdditive);
      }

      // Build initial positions for drag. If clicking an unselected note without
      // modifier, only drag that note (the select call above deselects others, but
      // the state update hasn't flushed yet so allNotes still shows stale selection).
      const willBeMulti = note.selected || isAdditive;
      const selectedNotes = willBeMulti
        ? allNotes.filter(nc => nc.note.selected || nc.note.id === note.id)
        : allNotes.filter(nc => nc.note.id === note.id);
      const initials = selectedNotes.map(nc => ({
        id: nc.note.id,
        pitch: nc.note.pitch,
        startTime: nc.note.startTime,
        duration: nc.note.duration,
      }));

      dragRef.current = {
        type: 'move',
        noteId: note.id,
        startX: e.clientX,
        startY: e.clientY,
        hasMoved: false,
        initials,
      };
      setGridCursor('grabbing');
      onPlayNote?.(note.pitch);
      lastPlayedPitchRef.current = note.pitch;
    } else {
      // Resize — include all selected notes so they resize together
      onSelectNote(note.id, isAdditive);
      if (!fullNote) return;
      const willResizeMulti = note.selected || isAdditive;
      const selectedNotes = willResizeMulti
        ? allNotes.filter(nc => nc.note.selected || nc.note.id === note.id)
        : allNotes.filter(nc => nc.note.id === note.id);
      dragRef.current = {
        type: edge === 'left' ? 'resize-left' : 'resize-right',
        noteId: note.id,
        startX: e.clientX,
        startY: e.clientY,
        hasMoved: false,
        initials: selectedNotes.map(nc => ({
          id: nc.note.id,
          pitch: nc.note.pitch,
          startTime: nc.note.startTime,
          duration: nc.note.duration,
        })),
      };
      setGridCursor('ew-resize');
    }

    let lastResizeDuration: number | null = null;

    const handleMouseMove = (me: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const dx = me.clientX - drag.startX;
      const dy = me.clientY - drag.startY;

      if (!drag.hasMoved && Math.abs(dx) < NOTE_MOVE_THRESHOLD && Math.abs(dy) < NOTE_MOVE_THRESHOLD) {
        return;
      }
      drag.hasMoved = true;

      if (drag.type === 'move') {
        const deltaTime = dx / pixelsPerSecond;
        const deltaPitch = -Math.round(dy / noteHeight);

        // Apply snapped delta to all selected notes
        const anchor = drag.initials.find(i => i.id === drag.noteId)!;
        const snappedNewTime = snapTime(anchor.startTime + deltaTime);
        const snappedDeltaTime = snappedNewTime - anchor.startTime;

        const anchorNewPitch = Math.max(0, Math.min(127, anchor.pitch + deltaPitch));
        if (anchorNewPitch !== lastPlayedPitchRef.current) {
          onPlayNote?.(anchorNewPitch);
          lastPlayedPitchRef.current = anchorNewPitch;
        }
        setDragPitch(anchorNewPitch);

        for (const init of drag.initials) {
          const newTime = Math.max(0, init.startTime + snappedDeltaTime);
          const newPitch = Math.max(0, Math.min(127, init.pitch + deltaPitch));
          onUpdateNote(init.id, { startTime: newTime, pitch: newPitch });
        }
      } else if (drag.type === 'resize-right') {
        const deltaTime = dx / pixelsPerSecond;
        const minDuration = (60 / bpm) / 32; // 1/32 note
        // Compute snapped duration from the anchor note, apply same delta to all
        const anchor = drag.initials.find(i => i.id === drag.noteId)!;
        const anchorNewDuration = snapTime(Math.max(minDuration, anchor.duration + deltaTime));
        const durationDelta = anchorNewDuration - anchor.duration;
        for (const init of drag.initials) {
          const newDur = Math.max(minDuration, init.duration + durationDelta);
          onResizeNote(init.id, newDur);
        }
        lastResizeDuration = anchorNewDuration;
      } else if (drag.type === 'resize-left') {
        const deltaTime = dx / pixelsPerSecond;
        const minDuration = (60 / bpm) / 32;
        // Compute snapped start delta from the anchor note, apply same shift to all
        const anchor = drag.initials.find(i => i.id === drag.noteId)!;
        const snappedStart = snapTime(anchor.startTime + deltaTime);
        const clampedStart = Math.max(0, snappedStart);
        const startDelta = clampedStart - anchor.startTime;
        const anchorEndTime = anchor.startTime + anchor.duration;
        if (anchorEndTime - clampedStart >= minDuration) {
          for (const init of drag.initials) {
            const newStart = Math.max(0, init.startTime + startDelta);
            const endTime = init.startTime + init.duration;
            const newDur = endTime - newStart;
            if (newDur >= minDuration) {
              onUpdateNote(init.id, { startTime: newStart, duration: newDur });
            }
          }
          lastResizeDuration = anchorEndTime - clampedStart;
        }
      }
    };

    const handleMouseUp = () => {
      const drag = dragRef.current;
      if (drag && !drag.hasMoved) {
        // It was a click, not a drag
        if (drag.type === 'move') {
          onSelectNote(note.id, isAdditive);
        }
      }
      if (drag?.hasMoved && lastResizeDuration !== null) {
        lastResizedDurationRef.current = lastResizeDuration;
      }
      dragRef.current = null;
      setDragPitch(null);
      lastPlayedPitchRef.current = null;
      setGridCursor('crosshair');
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [allNotes, pixelsPerSecond, noteHeight, snapTime, bpm, onSelectNote, onUpdateNote, onResizeNote]);

  // Handle keyboard events
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.stopPropagation();
      const selectedIds = allNotes.filter(nc => nc.note.selected).map(nc => nc.note.id);
      if (selectedIds.length > 0) {
        onDeleteNotes(selectedIds);
      }
    } else if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      // Select all notes
      const unselectedIds = allNotes.filter(nc => !nc.note.selected).map(nc => nc.note.id);
      if (unselectedIds.length > 0) {
        onSelectNotes(unselectedIds, true);
      }
    }
  }, [allNotes, onDeleteNotes, onSelectNotes]);

  // Refs for values used in the wheel handler — avoids re-attaching the listener on every scroll frame
  const scrollXRef = useRef(scrollX);
  const scrollYRef = useRef(scrollY);
  const ppsRef = useRef(pixelsPerSecond);
  const noteHeightRef = useRef(noteHeight);
  const heightRef = useRef(height);
  scrollXRef.current = scrollX;
  scrollYRef.current = scrollY;
  ppsRef.current = pixelsPerSecond;
  noteHeightRef.current = noteHeight;
  heightRef.current = height;

  const onScrollYChangeRef = useRef(onScrollYChange);
  const onPpsChangeRef = useRef(onPixelsPerSecondChange);
  const onScrollXChangeRef = useRef(onScrollXChange);
  onScrollYChangeRef.current = onScrollYChange;
  onPpsChangeRef.current = onPixelsPerSecondChange;
  onScrollXChangeRef.current = onScrollXChange;

  const widthRef = useRef(width);
  widthRef.current = width;

  // Native wheel handler — React 19 onWheel is passive, so we need a native listener
  // to call preventDefault and support Cmd+scroll zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      if (e.metaKey || e.ctrlKey) {
        // Cmd/Ctrl + scroll = horizontal zoom toward cursor
        if (!onPpsChangeRef.current || !onScrollXChangeRef.current) return;
        const rect = el.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const timeAtCursor = (cursorX + scrollXRef.current) / ppsRef.current;

        const zoomDelta = e.deltaY || e.deltaX;
        const zoomFactor = zoomDelta > 0 ? 0.9 : 1.1;
        const newPps = Math.max(MIN_PPS, Math.min(MAX_PPS, ppsRef.current * zoomFactor));
        const newScrollX = Math.max(0, timeAtCursor * newPps - cursorX);

        onPpsChangeRef.current(newPps);
        onScrollXChangeRef.current(newScrollX);
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // Shift + scroll or horizontal trackpad swipe = horizontal pan
        if (!onScrollXChangeRef.current) return;
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const newScrollX = Math.max(0, scrollXRef.current + delta);
        onScrollXChangeRef.current(newScrollX);
      } else {
        // Plain scroll = vertical pan
        const totalHeight = TOTAL_PITCHES * noteHeightRef.current;
        const maxScrollY = Math.max(0, totalHeight - heightRef.current);
        const newScrollY = Math.max(0, Math.min(maxScrollY, scrollYRef.current + e.deltaY));
        onScrollYChangeRef.current(newScrollY);
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width,
        height,
        overflow: 'hidden',
        outline: 'none',
        cursor: gridCursor,
      }}
      tabIndex={0}
      onMouseDown={handleBackgroundMouseDown}
      onMouseMove={handleGridMouseMove}
      onMouseLeave={handleMouseLeave}
      onKeyDown={handleKeyDown}
    >
      <NoteGridCanvas
        width={width}
        height={height}
        scrollX={scrollX}
        scrollY={scrollY}
        noteHeight={noteHeight}
        pixelsPerSecond={pixelsPerSecond}
        bpm={bpm}
        beatsPerMeasure={beatsPerMeasure}
        snap={snap}
        timeBasis={timeBasis}
        clipStart={clip != null ? (clip.trimStart ?? 0) : undefined}
        clipDuration={clip?.duration}
        allClipBounds={ghostClipBounds}
        hoveredKeyPitch={effectiveHoveredPitch}
      />

      {/* All note rects from all clips — fully interactive */}
      {allNotes.map(({ note, globalTimeOffset }) => {
        const x = (note.startTime + globalTimeOffset) * pixelsPerSecond - scrollX;
        const y = (TOTAL_PITCHES - 1 - note.pitch) * noteHeight - scrollY;
        const w = note.duration * pixelsPerSecond;

        // Cull offscreen notes
        if (x + w < 0 || x > width || y + noteHeight < 0 || y > height) return null;

        return (
          <NoteRect
            key={note.id}
            note={note}
            x={x}
            y={y}
            width={w}
            height={noteHeight}
            isSelected={note.selected ?? false}
            onMouseDown={handleNoteMouseDown}
            trackColor={trackColor}
          />
        );
      })}

      {/* Ghost note (hover preview before click) */}
      {ghostNote && !previewNote && (() => {
        const gx = ghostNote.startTime * pixelsPerSecond - scrollX;
        const gy = (TOTAL_PITCHES - 1 - ghostNote.pitch) * noteHeight - scrollY;
        const gw = ghostNote.duration * pixelsPerSecond;
        return (
          <NoteRect
            note={{ id: -2, pitch: ghostNote.pitch, velocity: DEFAULT_VELOCITY }}
            x={gx}
            y={gy}
            width={gw}
            height={noteHeight}
            isSelected={false}
            onMouseDown={() => {}}
            trackColor={trackColor}
            ghost
          />
        );
      })()}

      {/* Preview note (pending placement) */}
      {previewNote && (() => {
        const px = previewNote.startTime * pixelsPerSecond - scrollX;
        const py = (TOTAL_PITCHES - 1 - previewNote.pitch) * noteHeight - scrollY;
        const pw = previewNote.duration * pixelsPerSecond;
        return (
          <div style={{ position: 'absolute', left: px, top: py, width: pw, height: noteHeight, opacity: 0.7, pointerEvents: 'none' }}>
            <NoteRect
              note={{ id: -1, pitch: previewNote.pitch, velocity: DEFAULT_VELOCITY }}
              x={0}
              y={0}
              width={pw}
              height={noteHeight}
              isSelected={false}
              onMouseDown={() => {}}
              trackColor={trackColor}
            />
          </div>
        );
      })()}

      {/* Box selection overlay */}
      {boxSelectionRect && (
        <div
          style={{
            position: 'absolute',
            left: boxSelectionRect.x,
            top: boxSelectionRect.y,
            width: boxSelectionRect.width,
            height: boxSelectionRect.height,
            background: 'rgba(100, 150, 255, 0.2)',
            border: '1px solid rgba(100, 150, 255, 0.6)',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        />
      )}
    </div>
  );
};
