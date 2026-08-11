/**
 * @audacity-ui/core - Core types for Audacity Design System
 */

export interface EnvelopePoint {
  time: number;
  db: number;
}

export interface DeletedRegion {
  startTime: number; // Relative to clip start (after trimStart)
  duration: number;   // Duration of the deleted region
}

export interface Clip {
  id: number;
  name: string;
  startTime: number;
  duration: number;
  waveform: number[];
  envelopePoints: EnvelopePoint[];
  selected?: boolean;
  deletedRegions?: DeletedRegion[]; // Sorted, non-overlapping deleted regions
}

export interface Track {
  id: number;
  name: string;
  clips: Clip[];
  height?: number; // Custom height for track (optional, defaults to TRACK_HEIGHT)
  channelSplitRatio?: number; // For stereo tracks: ratio of top channel height (0-1, default 0.5)
}

export interface DragState {
  clip: Clip;
  trackIndex: number;
  offsetX: number;
  initialX: number;
  initialTrackIndex: number;
}

export interface EnvelopeDragState {
  clip: Clip;
  pointIndex: number;
  trackIndex: number;
  clipX: number;
  clipWidth: number;
  clipY: number;
  clipHeight: number;
  startX: number;
  startY: number;
  deletedPoints: EnvelopePoint[];
  originalTime: number;
  isNewPoint?: boolean; // Track if this point was just created
  hiddenPointIndices: number[]; // Indices of points hidden because dragged point passed them
}

export interface TimeSelection {
  startTime: number;
  endTime: number;
}

export interface Label {
  id: string;
  trackIndex: number;
  text: string;
  startTime: number;
  endTime: number;
  lowFrequency?: number; // Optional - for spectral labels
  highFrequency?: number; // Optional - for spectral labels
  selected?: boolean;
}

export interface SpectralSelection {
  startTime: number;
  endTime: number;
  minFrequency: number;
  maxFrequency: number;
  trackIndex: number;
  clipId?: number | string; // Optional - if undefined, selection can span multiple clips on the track
  originChannel?: 'L' | 'R' | 'mono'; // Which channel the selection was started in
}

export interface TimeSelectionDragState {
  startX: number;
  currentX: number;
  startTrackIndex: number;
}

/**
 * Configuration for time selection behavior
 */
export interface TimeSelectionConfig {
  /** Pixels per second - zoom level */
  pixelsPerSecond: number;
  /** Left padding before timeline starts (in pixels) */
  leftPadding: number;
  /** Array of tracks with height information */
  tracks: Track[];
  /** Default track height when not specified */
  defaultTrackHeight: number;
  /** Gap between tracks (in pixels) */
  trackGap: number;
  /** Initial gap above first track (in pixels) */
  initialGap: number;
}

export interface TrackResizeDragState {
  trackIndex: number; // Index of track being resized
  startY: number; // Initial Y position
  startHeight: number; // Initial height of the track
}

export interface StereoChannelResizeDragState {
  trackIndex: number; // Index of stereo track being resized
  clipId: number; // ID of the clip being resized
  startY: number; // Initial Y position when drag started
  startSplitRatio: number; // Initial channel split ratio
  clipY: number; // Y position of the clip top
  clipHeight: number; // Total height of the clip
}

export interface EnvelopeSegmentDragState {
  clip: Clip;
  segmentStartIndex: number; // Index of the point at the start of the segment
  segmentEndIndex: number; // Index of the point at the end of the segment
  trackIndex: number;
  clipX: number;
  clipWidth: number;
  clipY: number;
  clipHeight: number;
  startY: number; // Initial Y position of mouse
  startDb1: number; // Initial dB of first point
  startDb2: number; // Initial dB of second point
}

/**
 * Theme colors for clip rendering
 */
export interface ClipTheme {
  // Clip colors
  clipBackground: string;
  clipBorder: string;
  clipHeaderBackground: string;
  clipHeaderText: string;

  // Waveform colors
  waveformColor: string;

  // Envelope colors
  envelopeLineColor: string;
  envelopeLineColorHover: string;
  envelopePointColor: string;
  envelopePointColorHover: string;
  envelopeFillColor: string;

  // Selection/overlay colors
  timeSelectionOverlay: string;
  automationOverlayActive: string;
  automationOverlayIdle: string;

  // Segment hover
  segmentHoverColor: string;
  segmentHoverOverlay: string;
}

/**
 * MIDI Types
 */
export interface MidiNote {
  id: number;
  pitch: number; // 0-127 MIDI pitch
  startTime: number; // in seconds
  duration: number; // in seconds
  velocity: number; // 0-127
  selected?: boolean;
}

export interface MidiClip {
  id: number;
  name: string;
  start: number; // in seconds — global position of visible left edge
  duration: number; // in seconds — visible duration
  trimStart: number; // offset into local time where visible window begins
  notes: MidiNote[];
  selected?: boolean;
  color?: string;
}

export interface SnapGrid {
  subdivision: 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128;
  triplet?: boolean;
}

// Re-export envelope point styles
export * from './envelopePointStyles';
