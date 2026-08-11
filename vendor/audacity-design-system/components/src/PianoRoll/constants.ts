/** Width of the piano keyboard sidebar in pixels */
export const PIANO_KEY_WIDTH = 104;

/** Height of each semitone lane in pixels */
export const NOTE_HEIGHT = 16;

/** Total MIDI pitches (0-127) */
export const TOTAL_PITCHES = 128;

/** Total height of all pitch lanes */
export const TOTAL_GRID_HEIGHT = NOTE_HEIGHT * TOTAL_PITCHES;

/** Distance from note edge that triggers resize cursor */
export const NOTE_EDGE_THRESHOLD = 4;

/** Pixel threshold to distinguish click from drag */
export const NOTE_MOVE_THRESHOLD = 3;

/** Default panel height */
export const DEFAULT_PANEL_HEIGHT = 320;

/** Minimum panel height */
export const MIN_PANEL_HEIGHT = 100;

/** Default velocity for newly created notes */
export const DEFAULT_VELOCITY = 100;

/** Default scroll Y centered roughly on middle C (pitch 60) */
export const DEFAULT_SCROLL_Y = (TOTAL_PITCHES - 60 - 10) * NOTE_HEIGHT;

/** Black key pitch classes (within an octave) */
export const BLACK_KEY_CLASSES = [1, 3, 6, 8, 10];

/** Note names for labeling */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Width of the sidebar panel */
export const SIDEBAR_WIDTH = 176;

/** Height of the header bar */
export const HEADER_HEIGHT = 32;

/** Height of the timeline ruler above the grid */
export const RULER_HEIGHT = 32;

/** Width of the vertical scrollbar */
export const SCROLLBAR_WIDTH = 16;

/** Minimum pixels per second for piano roll zoom */
export const MIN_PPS = 20;

/** Maximum pixels per second for piano roll zoom */
export const MAX_PPS = 2000;

/** Distance from clip boundary line for hit detection/cursor change */
export const CLIP_BOUNDARY_THRESHOLD = 6;

/** Height of the clip strip between ruler and grid */
export const CLIP_STRIP_HEIGHT = 20;
