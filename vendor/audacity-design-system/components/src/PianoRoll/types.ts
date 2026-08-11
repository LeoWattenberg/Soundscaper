import type { MidiNote, MidiClip, SnapGrid } from '@audacity-ui/core';

export type TimeBasis = 'beats' | 'seconds';

export interface PianoRollPanelProps {
  clip?: MidiClip | null;
  allClips?: MidiClip[];
  bpm: number;
  beatsPerMeasure: number;
  pixelsPerSecond: number;
  scrollX: number;
  snap: SnapGrid;
  timeBasis: TimeBasis;
  onSnapChange: (snap: SnapGrid) => void;
  onTimeBasisChange: (basis: TimeBasis) => void;
  onAddNote: (note: MidiNote) => void;
  onDeleteNotes: (noteIds: number[]) => void;
  onUpdateNote: (noteId: number, updates: Partial<MidiNote>) => void;
  onMoveNotes: (noteIds: number[], deltaPitch: number, deltaTime: number) => void;
  onResizeNote: (noteId: number, newDuration: number) => void;
  onSelectNote: (noteId: number, additive?: boolean) => void;
  onSelectNotes: (noteIds: number[], additive?: boolean) => void;
  onDeselectAll: () => void;
  onPixelsPerSecondChange?: (pps: number) => void;
  onScrollXChange?: (scrollX: number) => void;
  onClose?: () => void;
  /** Called when user clicks to add a note but no clip exists yet. Should create a clip and add the note. */
  onCreateClipWithNote?: (note: MidiNote, measureDuration: number) => void;
  /** Called when user drags a clip boundary edge to resize the clip */
  onResizeClip?: (edge: 'left' | 'right', newStart: number, newDuration: number, newTrimStart: number, clipId?: number) => void;
  /** Called when user clicks a clip bar in the clip strip to select it */
  onSelectClip?: (clipId: number) => void;
  /** Called when user drags a clip in the clip strip to move it */
  onMoveClip?: (clipId: number, newStart: number) => void;
  /** ID of the clip being hovered (for cross-component highlight) */
  hoveredClipId?: number | null;
  /** Called when mouse enters/leaves a clip in the clip strip */
  onHoverClip?: (clipId: number | null) => void;
  /** Track color name (e.g. 'blue', 'violet') — notes and clip strip use this color */
  trackColor?: string;
  /** Called when a piano key is clicked */
  onKeyClick?: (pitch: number) => void;
  /** Called to audibly preview a pitch (e.g. when placing or dragging a note) */
  onPlayNote?: (pitch: number) => void;
  /** Playhead position in seconds (global time) */
  playheadPosition?: number;
  /** Hide the built-in PanelHeader (when managed externally, e.g. in a tabbed drawer) */
  hideHeader?: boolean;
  /** External height override — when provided, internal resize is disabled */
  height?: number;
  /** Available MIDI instruments for the dropdown */
  instruments?: Array<{ id: string; label: string }>;
  /** Currently selected instrument id */
  instrument?: string;
  /** Called when user changes the instrument */
  onInstrumentChange?: (id: string) => void;
}

export interface PianoRollSidebarProps {
  snap: SnapGrid;
  timeBasis: TimeBasis;
  onSnapChange: (snap: SnapGrid) => void;
  onTimeBasisChange: (basis: TimeBasis) => void;
  /** Current computer keyboard octave (e.g. 3 = C3–C4) */
  keyboardOctave?: number;
  /** Called when user changes the keyboard octave via UI */
  onKeyboardOctaveChange?: (octave: number) => void;
  /** Whether computer keyboard input is enabled */
  keyboardEnabled?: boolean;
  /** Called when user toggles computer keyboard input */
  onKeyboardEnabledChange?: (enabled: boolean) => void;
  /** Available MIDI instruments for the dropdown */
  instruments?: Array<{ id: string; label: string }>;
  /** Currently selected instrument id */
  instrument?: string;
  /** Called when user changes the instrument */
  onInstrumentChange?: (id: string) => void;
}

export interface PianoKeyboardProps {
  scrollY: number;
  noteHeight: number;
  height: number;
  highlightedPitch?: number | null;
  onKeyClick?: (pitch: number) => void;
  /** Called when mouse enters/leaves a key */
  onHoverKey?: (pitch: number | null) => void;
  /** Whether the clip strip is visible (affects top spacer height) */
  clipStripVisible?: boolean;
}

export interface PianoRollRulerProps {
  width: number;
  scrollX: number;
  pixelsPerSecond: number;
  bpm: number;
  beatsPerMeasure: number;
  snap: SnapGrid;
  timeBasis: TimeBasis;
}

export interface NoteGridProps {
  clip?: MidiClip | null;
  allClips?: MidiClip[];
  bpm: number;
  beatsPerMeasure: number;
  pixelsPerSecond: number;
  scrollX: number;
  scrollY: number;
  noteHeight: number;
  snap: SnapGrid;
  timeBasis: TimeBasis;
  width: number;
  height: number;
  onAddNote: (note: MidiNote) => void;
  onDeleteNotes: (noteIds: number[]) => void;
  onUpdateNote: (noteId: number, updates: Partial<MidiNote>) => void;
  onMoveNotes: (noteIds: number[], deltaPitch: number, deltaTime: number) => void;
  onResizeNote: (noteId: number, newDuration: number) => void;
  onSelectNote: (noteId: number, additive?: boolean) => void;
  onSelectNotes: (noteIds: number[], additive?: boolean) => void;
  onDeselectAll: () => void;
  onScrollYChange: (scrollY: number) => void;
  onPixelsPerSecondChange?: (pps: number) => void;
  onScrollXChange?: (scrollX: number) => void;
  /** Called when user drags a clip boundary edge to resize the clip */
  onResizeClip?: (edge: 'left' | 'right', newStart: number, newDuration: number, newTrimStart: number, clipId?: number) => void;
  /** Track color name (e.g. 'blue', 'violet') — notes use this color */
  trackColor?: string;
  /** Called when mouse enters/leaves a clip region in the grid */
  onHoverClip?: (clipId: number | null) => void;
  /** Pitch currently hovered on the piano keyboard (for lane highlight) */
  hoveredKeyPitch?: number | null;
  /** Called to audibly preview a pitch (e.g. when placing or dragging a note) */
  onPlayNote?: (pitch: number) => void;
}

export interface NoteGridCanvasProps {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  noteHeight: number;
  pixelsPerSecond: number;
  bpm: number;
  beatsPerMeasure: number;
  snap: SnapGrid;
  timeBasis: TimeBasis;
  /** Start time (seconds) of the MIDI clip — undefined means no clip */
  clipStart?: number;
  /** Duration (seconds) of the MIDI clip — undefined means no clip */
  clipDuration?: number;
  /** Bounds of ghost (non-active) clips for rendering boundary lines */
  allClipBounds?: Array<{ start: number; duration: number }>;
  /** Pitch currently hovered on the piano keyboard (for lane highlight) */
  hoveredKeyPitch?: number | null;
}

