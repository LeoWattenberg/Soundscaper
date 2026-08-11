import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTheme } from '../ThemeProvider/ThemeProvider';
import { PanelHeader } from '../PanelHeader';
import { PianoRollSidebar } from './PianoRollSidebar';
import { PianoKeyboard } from './PianoKeyboard';
import { PianoRollRuler } from './PianoRollRuler';
import { PianoRollClipStrip } from './PianoRollClipStrip';
import { NoteGrid } from './NoteGrid';
import {
  DEFAULT_PANEL_HEIGHT,
  MIN_PANEL_HEIGHT,
  DEFAULT_SCROLL_Y,
  NOTE_HEIGHT,
  PIANO_KEY_WIDTH,
  HEADER_HEIGHT,
  RULER_HEIGHT,
  CLIP_STRIP_HEIGHT,
} from './constants';
import type { PianoRollPanelProps } from './types';

export const PianoRollPanel: React.FC<PianoRollPanelProps> = ({
  clip,
  allClips,
  bpm,
  beatsPerMeasure,
  pixelsPerSecond,
  scrollX,
  snap,
  timeBasis,
  onSnapChange,
  onTimeBasisChange,
  onAddNote,
  onDeleteNotes,
  onUpdateNote,
  onMoveNotes,
  onResizeNote,
  onSelectNote,
  onSelectNotes,
  onDeselectAll,
  onPixelsPerSecondChange,
  onScrollXChange,
  onClose,
  onCreateClipWithNote,
  onResizeClip,
  onSelectClip,
  onMoveClip,
  hoveredClipId,
  onHoverClip,
  onKeyClick,
  onPlayNote,
  trackColor,
  playheadPosition,
  hideHeader = false,
  height: externalHeight,
  instruments,
  instrument,
  onInstrumentChange,
}) => {
  const { theme } = useTheme();
  const pr = theme.audio.pianoRoll;

  const [internalHeight, setInternalHeight] = useState(DEFAULT_PANEL_HEIGHT);
  const [scrollY, setScrollY] = useState(DEFAULT_SCROLL_Y);
  const [hoveredKeyPitch, setHoveredKeyPitch] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(800);

  // Computer keyboard piano — Ableton-style key mapping
  const [keyboardEnabled, setKeyboardEnabled] = useState(false);
  const [keyboardOctave, setKeyboardOctave] = useState(3);
  const [activeKeyboardPitch, setActiveKeyboardPitch] = useState<number | null>(null);
  const activeKeysRef = useRef(new Set<string>());

  // Lower row: A..K maps to C..C (one octave + 1). Upper row: Q..U extends higher.
  const KEY_TO_SEMITONE: Record<string, number> = {
    a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
    k: 12, o: 13, l: 14, p: 15,
  };

  const handlePanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!keyboardEnabled) return;

    // Octave shift: Z down, X up
    if (e.key === 'z' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      setKeyboardOctave(prev => Math.max(-1, prev - 1));
      return;
    }
    if (e.key === 'x' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      setKeyboardOctave(prev => Math.min(8, prev + 1));
      return;
    }

    const key = e.key.toLowerCase();
    if (activeKeysRef.current.has(key)) return; // Key repeat guard
    const semitone = KEY_TO_SEMITONE[key];
    if (semitone === undefined) return;

    e.preventDefault();
    activeKeysRef.current.add(key);
    // Octave offset: keyboardOctave maps to MIDI octave (C4 = MIDI 60, octave 4 → base 60)
    const pitch = Math.max(0, Math.min(127, (keyboardOctave + 1) * 12 + semitone));
    setActiveKeyboardPitch(pitch);
    onPlayNote?.(pitch);
  }, [keyboardEnabled, keyboardOctave, onPlayNote]);

  const handlePanelKeyUp = useCallback((e: React.KeyboardEvent) => {
    const key = e.key.toLowerCase();
    activeKeysRef.current.delete(key);
    // Clear highlight if no keys held
    if (activeKeysRef.current.size === 0) {
      setActiveKeyboardPitch(null);
    } else {
      // Show the most recently remaining held key
      const semitones = [...activeKeysRef.current]
        .map(k => KEY_TO_SEMITONE[k])
        .filter((s): s is number => s !== undefined);
      if (semitones.length > 0) {
        const lastSemitone = semitones[semitones.length - 1];
        setActiveKeyboardPitch(Math.max(0, Math.min(127, (keyboardOctave + 1) * 12 + lastSemitone)));
      }
    }
  }, [keyboardOctave]);

  // Use external height when provided, otherwise internal
  const panelHeight = externalHeight ?? internalHeight;
  const hasOwnHeader = !hideHeader;

  // Measure grid width: total width - sidebar - piano keyboard
  useEffect(() => {
    const container = mainContentRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setGridWidth(Math.max(0, entry.contentRect.width - PIANO_KEY_WIDTH));
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Top-edge resize handle (only when managing own header)
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const deltaY = e.clientY - resizeRef.current.startY;
      const newHeight = Math.max(MIN_PANEL_HEIGHT, resizeRef.current.startHeight - deltaY);
      setInternalHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeRef.current = { startY: e.clientY, startHeight: panelHeight };
  }, [panelHeight]);

  const contentHeight = hasOwnHeader ? panelHeight - HEADER_HEIGHT : panelHeight;
  const gridHeight = contentHeight - RULER_HEIGHT - (clip ? CLIP_STRIP_HEIGHT : 0);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={handlePanelKeyDown}
      onKeyUp={handlePanelKeyUp}
      onBlur={() => { activeKeysRef.current.clear(); setActiveKeyboardPitch(null); }}
      style={{
        height: panelHeight,
        background: pr.background,
        ...(hasOwnHeader ? { borderTop: `1px solid ${theme.border.onElevated}` } : {}),
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        position: 'relative',
        outline: 'none',
      }}
    >
      {/* Header (resize via top edge) — only when not managed externally */}
      {hasOwnHeader && (
        <PanelHeader
          tabs={[{ id: 'piano-roll', label: 'Piano roll' }]}
          activeTabId="piano-roll"
          onClose={onClose}
          onResizeStart={handleResizeStart}
        />
      )}

      {/* Main content: Sidebar | Keyboard + Ruler/Grid */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <PianoRollSidebar
          snap={snap}
          timeBasis={timeBasis}
          onSnapChange={onSnapChange}
          onTimeBasisChange={onTimeBasisChange}
          keyboardEnabled={keyboardEnabled}
          onKeyboardEnabledChange={setKeyboardEnabled}
          keyboardOctave={keyboardOctave}
          onKeyboardOctaveChange={setKeyboardOctave}
          instruments={instruments}
          instrument={instrument}
          onInstrumentChange={onInstrumentChange}
        />

        {/* Main content: Keyboard + (Ruler + Grid) */}
        <div
          ref={mainContentRef}
          style={{ display: 'flex', flex: 1, overflow: 'hidden' }}
        >
          {/* Piano keyboard (aligned: empty top for ruler, then keys) */}
          <PianoKeyboard
            scrollY={scrollY}
            noteHeight={NOTE_HEIGHT}
            height={contentHeight}
            highlightedPitch={activeKeyboardPitch}
            onKeyClick={onKeyClick}
            onHoverKey={setHoveredKeyPitch}
            clipStripVisible={!!clip}
          />

          {/* Ruler + Grid column */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', position: 'relative' }}>
            {/* Timeline ruler */}
            <PianoRollRuler
              width={gridWidth}
              scrollX={scrollX}
              pixelsPerSecond={pixelsPerSecond}
              bpm={bpm}
              beatsPerMeasure={beatsPerMeasure}
              snap={snap}
              timeBasis={timeBasis}
            />

            {/* Clip strip — visible only when a clip is selected */}
            {clip && (
              <PianoRollClipStrip
                clips={[clip]}
                activeClipId={clip.id}
                pixelsPerSecond={pixelsPerSecond}
                scrollX={scrollX}
                width={gridWidth}
                snap={snap}
                bpm={bpm}
                onResizeClip={onResizeClip ? (edge, newStart, newDuration, newTrimStart, clipId) => onResizeClip(edge, newStart, newDuration, newTrimStart, clipId) : undefined}
                onSelectClip={onSelectClip}
                onMoveClip={undefined}
                hoveredClipId={hoveredClipId}
                onHoverClip={onHoverClip}
                trackColor={trackColor}
              />
            )}

            {/* Note grid or empty state */}
            {clip ? (
              <>
                <NoteGrid
                  clip={clip}
                  allClips={allClips}
                  bpm={bpm}
                  beatsPerMeasure={beatsPerMeasure}
                  pixelsPerSecond={pixelsPerSecond}
                  scrollX={scrollX}
                  scrollY={scrollY}
                  noteHeight={NOTE_HEIGHT}
                  snap={snap}
                  timeBasis={timeBasis}
                  width={gridWidth}
                  height={gridHeight}
                  onAddNote={onAddNote}
                  onDeleteNotes={onDeleteNotes}
                  onUpdateNote={onUpdateNote}
                  onMoveNotes={onMoveNotes}
                  onResizeNote={onResizeNote}
                  onSelectNote={onSelectNote}
                  onSelectNotes={onSelectNotes}
                  onDeselectAll={onDeselectAll}
                  onScrollYChange={setScrollY}
                  onPixelsPerSecondChange={onPixelsPerSecondChange}
                  onScrollXChange={onScrollXChange}
                  onResizeClip={onResizeClip}
                  trackColor={trackColor}
                  onHoverClip={onHoverClip}
                  hoveredKeyPitch={hoveredKeyPitch ?? activeKeyboardPitch}
                  onPlayNote={onPlayNote}
                />

                {/* Playhead cursor */}
                {playheadPosition !== undefined && (() => {
                  const localPlayhead = playheadPosition - clip.start + (clip.trimStart ?? 0);
                  const playheadX = localPlayhead * pixelsPerSecond - scrollX;
                  return playheadX >= 0 && playheadX <= gridWidth ? (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: playheadX,
                        width: 1,
                        height: '100%',
                        background: '#ffffff',
                        boxShadow: '-1px 0 0 #000000, 1px 0 0 #000000',
                        pointerEvents: 'none',
                        zIndex: 20,
                      }}
                    />
                  ) : null;
                })()}
              </>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: theme.foreground.text.secondary,
                  fontFamily: 'Inter, system-ui, sans-serif',
                  fontSize: 13,
                  userSelect: 'none',
                }}
              >
                Select a MIDI clip to edit
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
