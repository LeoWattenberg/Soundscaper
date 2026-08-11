import React, { useState, useCallback } from 'react';
import { useTheme } from '../ThemeProvider/ThemeProvider';
import './NoteRect.css';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const EDGE_THRESHOLD = 4; // px from left/right edge to trigger resize cursor

/** Convert MIDI pitch number to note name, e.g. 60 → "C4" */
function pitchToName(pitch: number): string {
  const noteClass = pitch % 12;
  const octave = Math.floor(pitch / 12) - 1;
  return `${NOTE_NAMES[noteClass]}${octave}`;
}

export type NoteEdge = 'left' | 'right' | 'body';

export interface NoteRectNote {
  id: number;
  pitch: number;
  velocity: number;
  selected?: boolean;
}

export interface NoteRectProps {
  /**
   * The MIDI note data
   */
  note: NoteRectNote;
  /**
   * Horizontal position in pixels (already computed from time)
   */
  x: number;
  /**
   * Vertical position in pixels (already computed from pitch)
   */
  y: number;
  /**
   * Width in pixels (already computed from duration)
   */
  width: number;
  /**
   * Height in pixels (one semitone lane)
   */
  height: number;
  /**
   * Whether the note is currently selected
   */
  isSelected: boolean;
  /**
   * Mouse down handler — receives the note and which edge was clicked
   */
  onMouseDown: (e: React.MouseEvent, note: NoteRectNote, edge: NoteEdge) => void;
  /**
   * Whether this is a ghost note (non-interactive, low opacity)
   */
  ghost?: boolean;
  /**
   * Track color name (e.g. 'blue', 'violet') — uses corresponding clip color from theme
   */
  trackColor?: string;
  /**
   * Additional CSS class names
   */
  className?: string;
}

export const NoteRect: React.FC<NoteRectProps> = ({
  note,
  x,
  y,
  width,
  height,
  isSelected,
  onMouseDown,
  ghost = false,
  trackColor,
  className = '',
}) => {
  const { theme } = useTheme();
  const pr = theme.audio.pianoRoll;
  const [hoverEdge, setHoverEdge] = useState<NoteEdge>('body');

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    if (localX <= EDGE_THRESHOLD) {
      setHoverEdge('left');
    } else if (localX >= rect.width - EDGE_THRESHOLD) {
      setHoverEdge('right');
    } else {
      setHoverEdge('body');
    }
  }, []);

  const cursor = hoverEdge === 'body' ? 'pointer' : 'ew-resize';

  // Velocity-based opacity: vel 0 → 0.5, vel 127 → 1.0
  const opacity = 0.5 + (note.velocity / 127) * 0.5;

  const showLabel = width > 30;
  const noteName = pitchToName(note.pitch);

  // Use track color from clip theme when available, otherwise fall back to piano roll theme
  const clipColors = trackColor ? (theme.audio.clip as Record<string, any>)[trackColor] : null;
  const noteFill = clipColors?.header ?? pr.noteFill;
  const noteFillSelected = clipColors?.headerSelected ?? pr.noteFillSelected;
  const noteBorder = clipColors?.waveform ?? pr.noteBorder;

  // Lighten the fill for hover state
  const hoverFill = isSelected ? noteFillSelected : noteFill;

  const style = {
    '--note-fill': noteFill,
    '--note-fill-hover': hoverFill,
    '--note-fill-selected': noteFillSelected,
    '--note-border': noteBorder,
    '--note-border-selected': pr.noteBorderSelected,
    left: x,
    top: y + 1,
    width: Math.max(width, 4),
    height: height - 2,
    cursor: ghost ? 'default' : cursor,
    opacity: ghost ? 0.35 : opacity,
    pointerEvents: ghost ? 'none' as const : undefined,
  } as React.CSSProperties;

  return (
    <div
      data-note-id={note.id}
      className={`note-rect ${isSelected ? 'note-rect--selected' : ''} ${className}`}
      style={style}
      onMouseMove={handleMouseMove}
      onMouseDown={(e) => {
        e.stopPropagation();
        onMouseDown(e, note, hoverEdge);
      }}
    >
      {showLabel && (
        <span className="note-rect__label">
          {noteName}
        </span>
      )}
    </div>
  );
};

export default NoteRect;
