/* SPDX-License-Identifier: GPL-3.0-only
 * Selective port from audacity-design-system 20ce5547. Split for module ownership. */
import type { ReactNode } from 'react';
import type { FadeShape } from '../utils/clipCrossfades';
export interface ClipPropertiesClip {
  id: number | string;
  name: string;
  /** The colour's id in `colors` (undefined = the track's) */
  color?: string;
  /** The track's own colour (a palette id), for the strip when the
   *  clip wears it */
  trackColor?: string;
  trackName: string;
  /** The track's id in `tracks` — the Track field moves the clip (2026-10-06) */
  trackId?: string;
  /** Seconds, in project time */
  start: number;
  duration: number;
  /** Where in the source the clip begins (seconds of source) */
  trimStart: number;
  /** The whole source's length (seconds of source) */
  fullDuration: number;
  /** 1 = as recorded; the visible length is source × this */
  stretchFactor: number;
  /** Authored scalar speed, when independent from the strip's resolved geometry. */
  speedPercent?: number;
  /** Pitch shift in semitones (0 = none) */
  pitchSemitones: number;
  fadeIn: number;
  fadeOut: number;
  /** The fade shape's id in `fadeShapes`, or undefined for a shape that
   *  is none of them (dragged somewhere between) */
  fadeInShapeId?: string;
  fadeOutShapeId?: string;
  /** The fades' actual curves, for the live thumbnails (absent = the
   *  quick fade's default S-curve) */
  fadeInShape?: FadeShape;
  fadeOutShape?: FadeShape;
  /** Plays and draws backwards (2026-10-07) */
  reversed?: boolean;
  groupId?: string;
}

/** A field whose selected clips disagree */
export const MIXED = 'mixed' as const;
export type Mixed = typeof MIXED;

/** Several selected clips, merged: a field is its shared value, or MIXED */
export interface ClipPropertiesSelection {
  /** How many clips (≥ 2) */
  count: number;
  /** The distinct tracks they are on, in track order */
  trackNames: string[];
  /** The one track they share, or MIXED */
  trackId?: string | Mixed;
  /** The earliest start and the latest end, seconds of project time */
  start: number;
  end: number;
  color?: string | Mixed;
  stretchFactor: number | Mixed;
  speedPercent?: number | Mixed;
  pitchSemitones: number | Mixed;
  fadeIn: number | Mixed;
  fadeOut: number | Mixed;
  fadeInShapeId?: string | Mixed;
  fadeOutShapeId?: string | Mixed;
  reversed?: boolean | Mixed;
}

export interface ClipPropertiesOption {
  id: string;
  label: string;
}

/** A fade shape preset: its id and label, and the curve to draw for it */
export interface ClipPropertiesShapeOption extends ClipPropertiesOption {
  shape: FadeShape;
}

export interface ClipPropertiesPanelProps {
  labels?: Readonly<Record<string, string>>;
  /** Host controls retain native color and exact time formats in the same fields. */
  colorControl?: ReactNode;
  pitchControl?: ReactNode;
  timingFields?: Partial<Record<'start' | 'length' | 'end' | 'trim-start' | 'trim-end' | 'fade-in' | 'fade-out', ReactNode>>;
  onOpenSource?: () => void;
  /** The clip shown, or null for the empty state */
  clip: ClipPropertiesClip | null;
  /** Several selected clips: takes the place of `clip` when set */
  selection?: ClipPropertiesSelection | null;
  /** The colours a clip can wear */
  colors: ReadonlyArray<ClipPropertiesOption>;
  /** The tracks a clip can be moved to (none = no Track field) */
  tracks?: ReadonlyArray<ClipPropertiesOption>;
  /** Move the clip (or every selected clip) to this track, start held */
  onTrackChange?: (trackId: string) => void;
  /** The fade shape presets, with their curves */
  fadeShapes: ReadonlyArray<ClipPropertiesShapeOption>;
  onRename?: (name: string) => void;
  onColorChange?: (colorId: string) => void;
  /** New start, seconds of project time (the host clamps) */
  onStartChange?: (seconds: number) => void;
  /** New visible length, seconds (the host clamps to the source) */
  onDurationChange?: (seconds: number) => void;
  /** Trim the LEFT edge: how much of the source to hide at the head,
   *  seconds of source; the clip's content stays where it is (user
   *  request 2026-10-06 — until then only the right edge trimmed here) */
  onTrimStartChange?: (seconds: number) => void;
  /** Trim the RIGHT edge: how much of the source to hide at the tail,
   *  seconds of source */
  onTrimEndChange?: (seconds: number) => void;
  onFadeChange?: (side: 'in' | 'out', seconds: number) => void;
  onFadeShapeChange?: (side: 'in' | 'out', shapeId: string) => void;
  /** New pitch shift, semitones */
  onPitchChange?: (semitones: number) => void;
  /** New speed, percent (100 = as recorded) */
  onSpeedChange?: (percent: number) => void;
  /** Reverse on or off (every selected clip's, in the selection state) */
  onReverseChange?: (reversed: boolean) => void;
  /** Pitch back to 0 and speed back to 100 — the section's Reset */
  onResetPitchSpeed?: () => void;
  /** Native hosts can include stored values hidden by linked pitch presentation. */
  resetPitchSpeedDisabled?: boolean;
  /** The export block's formats; none = no Export section */
  exportFormats?: ReadonlyArray<ClipPropertiesOption>;
  /** The export block's sample rates, Hz (ids are the numbers) */
  exportSampleRates?: ReadonlyArray<ClipPropertiesOption>;
  /** Export the clip (or every selected clip) with the chosen settings */
  onExport?: (settings: ClipPropertiesExportSettings) => void;
  /** An export is under way — the button waits */
  exporting?: boolean;
  /** Where the panel sits in the app's reading order (docked left =
   *  before the tracks, right or bottom = after) */
  placement?: 'start' | 'end';
  /** `stack` (a side dock: one column of groups) or `columns` (the
   *  bottom drawer: wide and short, the groups side by side in three
   *  columns — user decision 2026-10-02) */
  layout?: 'stack' | 'columns';
}

/** What the Export block asks for */
export interface ClipPropertiesExportSettings {
  /** The format's id in `exportFormats` */
  format: string;
  /** Hz */
  sampleRate: number;
}

/** How long the pointer rests on a control before its tooltip shows */
export const TOOLTIP_DELAY_MS = 350;

/** Pitch limits, semitones: two octaves either way */
export const PITCH_LIMIT_SEMITONES = 24;
