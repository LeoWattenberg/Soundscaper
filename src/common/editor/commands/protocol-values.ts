/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The value shapes commands carry.
 *
 * These are the structured arguments a command payload is built out of — a
 * rational rate, a tempo event, a clipboard, an annotation range — as opposed
 * to the payloads themselves, which say which command takes which of them.
 * They live apart from the protocol so that adding a command means editing one
 * list and one payload entry, not scrolling past every shape any command has
 * ever needed.
 *
 * `protocol.ts` re-exports all of this, so nothing needs to import from here
 * directly and no existing import had to move.
 */

import type { TimelineAnnotationColor } from '../timeline-annotation.ts';
import type { Rational } from '../timeline-time.ts';
import type { CommandObject, StableIdListMap, StableIdMap } from './protocol.ts';

/** Absolute sequence-frame authority carried beside resolved command aliases. */
export interface CanonicalVideoPlacementCommandValue {
	readonly sequenceStartFrame: number;
	readonly sequenceFrameCount: number;
}

export interface ExactRationalCommandValue {
	readonly num: number;
	readonly den: number;
}

export interface TempoEventCommandValue {
	readonly id: string;
	readonly bpm: ExactRationalCommandValue;
	readonly beat?: ExactRationalCommandValue;
	readonly samplePosition?: number;
}

export interface TempoEventCommandChanges {
	readonly bpm?: ExactRationalCommandValue;
	readonly beat?: ExactRationalCommandValue;
	readonly samplePosition?: number;
}

export interface SignatureEventCommandValue {
	readonly id: string;
	readonly bar: number;
	readonly numerator: number;
	readonly denominator: number;
}

export type SignatureEventCommandChanges = Readonly<Partial<Omit<SignatureEventCommandValue, 'id'>>>;

export interface SequenceTimecodeCommandValue {
	readonly negative: boolean;
	readonly hours: number;
	readonly minutes: number;
	readonly seconds: number;
	readonly frames: number;
}

export interface SequenceTimingCommandChanges {
	readonly name?: string;
	readonly rate?: ExactRationalCommandValue;
	readonly dropFrame?: boolean;
	readonly startTimecode?: SequenceTimecodeCommandValue;
}

export interface TimelineAnnotationUpdateChanges {
	readonly name?: string;
	readonly color?: TimelineAnnotationColor;
}

export interface TimelineAnnotationMoveDelta {
	readonly sampleFrames: number;
	readonly beats: Rational;
}

export type TimelineAnnotationResizeCoordinate =
	| Readonly<{ anchor: 'sample'; frame: number }>
	| Readonly<{ anchor: 'musical'; beat: Rational }>;

export type TimelineAnnotationConversionCoordinates =
	| Readonly<{ kind: 'marker'; anchor: 'sample'; positionFrame: number }>
	| Readonly<{ kind: 'marker'; anchor: 'musical'; positionBeat: Rational }>
	| Readonly<{ kind: 'region'; anchor: 'sample'; startFrame: number; endFrame: number }>
	| Readonly<{ kind: 'region'; anchor: 'musical'; startBeat: Rational; endBeat: Rational }>;

export interface AudioEditorClipboardTrack {
	readonly sourceTrackId: string;
	readonly sourceTrackName: string;
	readonly sourceTrackType?: 'audio' | 'video';
	readonly sourceLaneGroupId?: string | null;
	readonly sourceSequenceId?: string;
	readonly clips: readonly CommandObject[];
}

export interface AudioEditorClipboardAnnotationCommon {
	readonly key: string;
	readonly sourceSequenceId: string;
	readonly name: string;
	readonly color: TimelineAnnotationColor;
	readonly batchId: string | null;
	readonly opaqueExtensions: CommandObject;
}

export type AudioEditorClipboardAnnotation =
	| Readonly<AudioEditorClipboardAnnotationCommon & {
		readonly kind: 'marker';
		readonly anchor: 'sample';
		readonly positionOffsetFrame: number;
	}>
	| Readonly<AudioEditorClipboardAnnotationCommon & {
		readonly kind: 'marker';
		readonly anchor: 'musical';
		readonly positionOffsetBeat: ExactRationalCommandValue;
	}>
	| Readonly<AudioEditorClipboardAnnotationCommon & {
		readonly kind: 'region';
		readonly anchor: 'sample';
		readonly startOffsetFrame: number;
		readonly endOffsetFrame: number;
	}>
	| Readonly<AudioEditorClipboardAnnotationCommon & {
		readonly kind: 'region';
		readonly anchor: 'musical';
		readonly startOffsetBeat: ExactRationalCommandValue;
		readonly endOffsetBeat: ExactRationalCommandValue;
	}>;

export interface AudioEditorClipboard {
	readonly schemaVersion: 1 | 2 | 3 | 4 | 5 | 6;
	readonly sampleRate: number;
	readonly durationFrames: number;
	readonly tracks: readonly AudioEditorClipboardTrack[];
	readonly annotations?: readonly AudioEditorClipboardAnnotation[];
	readonly takeGroups?: readonly CommandObject[];
}

export interface CommandRangePayload {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds?: readonly string[];
	readonly clipIds?: readonly string[];
	readonly splitClipIds?: StableIdMap;
	readonly splitAvLinkIds?: StableIdMap;
	readonly videoEffectIds?: StableIdListMap;
}

export interface TimelineAnnotationRippleOperation {
	readonly sequenceId: string;
	readonly sampleRange: Readonly<{
		readonly startFrame: number;
		readonly endFrame: number;
	}>;
	readonly musicalRange: Readonly<{
		readonly startBeat: Rational;
		readonly endBeat: Rational;
	}>;
}

export interface ThreePointEditPlacement {
	readonly trackId: string;
	readonly clipId: string;
	readonly sourceId: string;
	readonly kind: 'audio' | 'video';
	/** In the source's own domain: video frames for video, samples for audio. */
	readonly sourceIn: number;
	readonly sourceCount?: number;
	readonly title?: string;
}

export interface ThreePointEditCommandPayload {
	readonly startFrame: number;
	readonly endFrame: number;
	/** Every lane the operation touches, which for an insert is the whole sequence. */
	readonly trackIds: readonly string[];
	readonly placements: readonly ThreePointEditPlacement[];
	readonly avLinkId?: string;
	readonly splitClipIds?: StableIdMap;
	readonly splitAvLinkIds?: StableIdMap;
	readonly videoEffectIds?: StableIdListMap;
}

export interface CommandRippleRangePayload extends CommandRangePayload {
	readonly annotationRippleOperations?: readonly TimelineAnnotationRippleOperation[];
}

export type EffectRackTarget =
	| { readonly scope: 'master'; readonly trackId?: never; readonly busId?: never }
	| { readonly scope: 'track'; readonly trackId: string; readonly busId?: never }
	| { readonly scope: 'group' | 'send'; readonly busId?: string; readonly trackId?: string };
