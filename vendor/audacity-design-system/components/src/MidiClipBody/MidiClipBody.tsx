import React from 'react';
import type { MidiNote } from '@audacity-ui/core';
import type { ClipColor } from '../types/clip';

export interface MidiClipBodyProps {
  notes: MidiNote[];
  clipDuration: number;
  trimStart?: number;
  width: number;
  height: number;
  color?: ClipColor;
  selected?: boolean;
  inTimeSelection?: boolean;
  clipStartTime?: number;
  timeSelectionRange?: { startTime: number; endTime: number } | null;
  pixelsPerSecond?: number;
}

/**
 * MidiClipBody - Compact note-preview renderer for MIDI clips on the timeline.
 * Renders small rectangles for each note, auto-calculating pitch range.
 */
const MidiClipBodyComponent: React.FC<MidiClipBodyProps> = ({
  notes,
  clipDuration,
  trimStart = 0,
  width,
  height,
  color = 'blue',
  selected = false,
  inTimeSelection = false,
  clipStartTime = 0,
  timeSelectionRange = null,
  pixelsPerSecond = 100,
}) => {

  // Calculate time selection overlay geometry
  let selectionOverlay: { left: number; width: number } | null = null;
  if (inTimeSelection && timeSelectionRange) {
    const clipEndTime = clipStartTime + clipDuration;
    const overlapStart = Math.max(clipStartTime, timeSelectionRange.startTime);
    const overlapEnd = Math.min(clipEndTime, timeSelectionRange.endTime);
    if (overlapStart < overlapEnd) {
      selectionOverlay = {
        left: (overlapStart - clipStartTime) * pixelsPerSecond,
        width: (overlapEnd - overlapStart) * pixelsPerSecond,
      };
    }
  }

  if (notes.length === 0) {
    return (
      <div
        className={`clip-body clip-body--${color}`}
        data-color={color}
        data-selected={selected}
        style={{ width: `${width}px`, height: `${height}px`, position: 'relative' }}
      >
        {selectionOverlay && (
          <div
            style={{
              position: 'absolute',
              left: `${selectionOverlay.left}px`,
              top: 0,
              width: `${selectionOverlay.width}px`,
              height: '100%',
              backgroundColor: `var(--clip-${color}-time-selection-body, rgba(255,255,255,0.15))`,
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
    );
  }

  // Calculate pitch range with 2-semitone padding
  let minPitch = 127;
  let maxPitch = 0;
  for (const note of notes) {
    if (note.pitch < minPitch) minPitch = note.pitch;
    if (note.pitch > maxPitch) maxPitch = note.pitch;
  }
  minPitch = Math.max(0, minPitch - 2);
  maxPitch = Math.min(127, maxPitch + 2);
  const pitchRange = Math.max(maxPitch - minPitch, 1);

  return (
    <div
      className={`clip-body clip-body--${color}`}
      data-color={color}
      data-selected={selected}
      style={{ width: `${width}px`, height: `${height}px`, position: 'relative', overflow: 'hidden' }}
    >
      {selectionOverlay && (
        <div
          style={{
            position: 'absolute',
            left: `${selectionOverlay.left}px`,
            top: 0,
            width: `${selectionOverlay.width}px`,
            height: '100%',
            backgroundColor: `var(--clip-${color}-time-selection-body, rgba(255,255,255,0.15))`,
            pointerEvents: 'none',
          }}
        />
      )}
      {notes.map((note) => {
        const x = ((note.startTime - trimStart) / clipDuration) * width;
        const noteWidth = Math.max(1, (note.duration / clipDuration) * width);
        // Higher pitch = higher on screen (lower y value)
        const y = ((maxPitch - note.pitch) / pitchRange) * (height - 2);
        const noteHeight = Math.max(1, height / pitchRange - 1);

        return (
          <div
            key={note.id}
            style={{
              position: 'absolute',
              left: `${x}px`,
              top: `${y}px`,
              width: `${noteWidth}px`,
              height: `${noteHeight}px`,
              backgroundColor: `var(--clip-${color}-waveform, rgba(255,255,255,0.6))`,
              borderRadius: '1px',
              opacity: 0.5 + (note.velocity / 127) * 0.5,
            }}
          />
        );
      })}
    </div>
  );
};

export const MidiClipBody = React.memo(MidiClipBodyComponent);
export default MidiClipBody;
