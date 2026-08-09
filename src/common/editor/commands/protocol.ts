/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	TimelineAnnotationColor,
	TimelineAnnotationV11,
} from '../timeline-annotation.ts';
import type { Rational } from '../timeline-time.ts';

/**
 * Authoritative command discriminants. Adding a command starts here, then the
 * payload map and exactly one domain registry must be updated.
 */
export const AUDIO_EDITOR_COMMAND_TYPES = [
	'batch',
	'project/rename',
	'selection/set',
	'loop/set',
	'snap/set',
	'tempo/set',
	'tempo-map/mode-set',
	'tempo-event/add',
	'tempo-event/update',
	'tempo-event/remove',
	'signature-event/add',
	'signature-event/update',
	'signature-event/remove',
	'timeline-annotation/add',
	'timeline-annotation/update-many',
	'timeline-annotation/move-many',
	'timeline-annotation/resize',
	'timeline-annotation/convert',
	'timeline-annotation/remove-many',
	'timeline-annotation/batch-set',
	'time-display/set',
	'metadata/update',
	'source/add',
	'source/remove',
	'source/update',
	'project-bin/add',
	'project-bin/move-from-timeline',
	'project-bin/place',
	'project-bin/update',
	'project-bin/remove',
	'project-bin/remove-from-project',
	'project-bin/replace-media',
	'track/add',
	'track/remove',
	'track/update',
	'track/reorder',
	'label/add',
	'label/update',
	'label/remove',
	'master/update',
	'mixer/bus-add',
	'mixer/bus-update',
	'mixer/bus-remove',
	'mixer/route-update',
	'clip/add',
	'clip/remove',
	'clip/remove-many',
	'clip/update',
	'clip/replace-source',
	'clip/render-replace-many',
	'clip/move',
	'clip/transform-many',
	'clip/overwrite',
	'clip/trim',
	'clip/split',
	'clip/link-av',
	'clip/unlink-av',
	'clip/group',
	'clip/ungroup',
	'clip/join',
	'range/lift-delete',
	'range/ripple-delete',
	'range/per-clip-ripple-delete',
	'range/keep',
	'range/replace',
	'clipboard/paste',
	'punch/replace',
	'effect/add',
	'effect/update',
	'effect/remove',
	'effect/reorder',
	'video-effect/add',
	'video-effect/update',
	'video-effect/remove',
	'video-effect/reorder',
] as const;

export type AudioEditorCommandType = typeof AUDIO_EDITOR_COMMAND_TYPES[number];
export type CommandObject = Readonly<Record<string, unknown>>;
export type StableIdMap = Readonly<Record<string, string>>;
export type StableIdListMap = Readonly<Record<string, readonly string[]>>;
export type MixerBusType = 'group' | 'send';
export type ClipRippleMode = 'none' | 'clip' | 'track';
export type ClipboardPasteMode = 'reject' | 'overlap' | 'insert-track' | 'insert-all';
export type TempoMapMode = 'musical' | 'sampleLocked';

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
	readonly clips: readonly CommandObject[];
}

export interface AudioEditorClipboard {
	readonly schemaVersion: 1 | 2;
	readonly sampleRate: number;
	readonly durationFrames: number;
	readonly tracks: readonly AudioEditorClipboardTrack[];
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

export type EffectRackTarget =
	| { readonly scope: 'master'; readonly trackId?: never; readonly busId?: never }
	| { readonly scope: 'track'; readonly trackId: string; readonly busId?: never }
	| { readonly scope: 'group' | 'send'; readonly busId?: string; readonly trackId?: string };

type NonBatchAudioEditorCommandPayloads = {
	readonly 'project/rename': { readonly title: string };
	readonly 'selection/set': {
		readonly startFrame: number;
		readonly endFrame: number;
		readonly trackIds?: readonly string[];
		readonly clipIds?: readonly string[];
		readonly annotationIds?: readonly string[];
		readonly frequencyRange?: Readonly<{
			minimumFrequency: number;
			maximumFrequency: number;
		}> | null;
	};
	readonly 'loop/set': { readonly enabled: boolean; readonly startFrame?: number; readonly endFrame?: number };
	readonly 'snap/set': { readonly settings: CommandObject };
	readonly 'tempo/set': { readonly bpm?: number; readonly numerator?: number; readonly denominator?: number };
	readonly 'tempo-map/mode-set': { readonly mode: TempoMapMode };
	readonly 'tempo-event/add': { readonly event: TempoEventCommandValue };
	readonly 'tempo-event/update': { readonly eventId: string; readonly changes: TempoEventCommandChanges };
	readonly 'tempo-event/remove': { readonly eventId: string };
	readonly 'signature-event/add': { readonly event: SignatureEventCommandValue };
	readonly 'signature-event/update': { readonly eventId: string; readonly changes: SignatureEventCommandChanges };
	readonly 'signature-event/remove': { readonly eventId: string };
	readonly 'timeline-annotation/add': { readonly annotation: TimelineAnnotationV11 };
	readonly 'timeline-annotation/update-many': {
		readonly annotationIds: readonly string[];
		readonly changes: TimelineAnnotationUpdateChanges;
	};
	readonly 'timeline-annotation/move-many': {
		readonly annotationIds: readonly string[];
		readonly delta: TimelineAnnotationMoveDelta;
	};
	readonly 'timeline-annotation/resize': {
		readonly annotationId: string;
		readonly edge: 'start' | 'end';
		readonly coordinate: TimelineAnnotationResizeCoordinate;
	};
	readonly 'timeline-annotation/convert': {
		readonly annotationId: string;
		readonly coordinates: TimelineAnnotationConversionCoordinates;
	};
	readonly 'timeline-annotation/remove-many': { readonly annotationIds: readonly string[] };
	readonly 'timeline-annotation/batch-set': {
		readonly annotationIds: readonly string[];
		readonly batchId: string | null;
	};
	readonly 'time-display/set': { readonly format: string };
	readonly 'metadata/update': { readonly changes: CommandObject };
	readonly 'source/add': { readonly source: CommandObject };
	readonly 'source/remove': { readonly sourceId: string };
	readonly 'source/update': { readonly sourceId: string; readonly changes: CommandObject };
	readonly 'project-bin/add': { readonly clip: CommandObject };
	readonly 'project-bin/move-from-timeline': { readonly clipIds: readonly string[] };
	readonly 'project-bin/place': {
		readonly binClipId: string;
		readonly timelineStartFrame: number;
		readonly trackId?: string;
		readonly clipId?: string;
		readonly placements?: readonly CommandObject[];
		readonly avLinkId?: string;
	};
	readonly 'project-bin/update': { readonly clipId: string; readonly changes: CommandObject };
	readonly 'project-bin/remove': { readonly clipId: string };
	readonly 'project-bin/remove-from-project': { readonly clipId: string };
	readonly 'project-bin/replace-media': {
		readonly clipId: string;
		readonly replacements: readonly Readonly<{ oldSourceId: string; newSourceId: string }>[];
		readonly templates?: readonly CommandObject[];
		readonly shortfallMode: 'keep-spacing' | 'contract-gaps';
	};
	readonly 'track/add': { readonly track: CommandObject; readonly index?: number };
	readonly 'track/remove': { readonly trackId: string };
	readonly 'track/update': { readonly trackId: string; readonly changes: CommandObject };
	readonly 'track/reorder': { readonly trackId: string; readonly index: number };
	readonly 'label/add': { readonly trackId: string; readonly label: CommandObject };
	readonly 'label/update': { readonly trackId: string; readonly labelId: string; readonly changes: CommandObject };
	readonly 'label/remove': { readonly trackId: string; readonly labelId: string };
	readonly 'master/update': { readonly changes: CommandObject };
	readonly 'mixer/bus-add': { readonly busType: MixerBusType; readonly bus: CommandObject };
	readonly 'mixer/bus-update': { readonly busType: MixerBusType; readonly busId: string; readonly changes: CommandObject };
	readonly 'mixer/bus-remove': { readonly busType: MixerBusType; readonly busId: string };
	readonly 'mixer/route-update': { readonly trackId: string; readonly changes: CommandObject };
	readonly 'clip/add': { readonly trackId: string; readonly clip: CommandObject };
	readonly 'clip/remove': { readonly clipId: string };
	readonly 'clip/remove-many': { readonly clipIds: readonly string[]; readonly rippleMode?: ClipRippleMode };
	readonly 'clip/update': { readonly clipId: string; readonly changes: CommandObject };
	readonly 'clip/replace-source': { readonly clipId: string; readonly sourceId: string };
	readonly 'clip/render-replace-many': {
		readonly entries: readonly Readonly<{ clipId: string; source: CommandObject }>[];
	};
	readonly 'clip/move': { readonly clipId: string; readonly trackId?: string; readonly timelineStartFrame: number };
	readonly 'clip/transform-many': {
		readonly transforms: readonly Readonly<{ clipId: string; trackId?: string; changes: CommandObject }>[];
		readonly overwrite?: boolean;
		readonly splitClipIds?: StableIdListMap;
		readonly splitAvLinkIds?: StableIdListMap;
		readonly videoEffectIds?: StableIdListMap;
	};
	readonly 'clip/overwrite': {
		readonly clipId: string;
		readonly trackId?: string;
		readonly changes?: CommandObject;
		readonly splitClipIds?: StableIdMap;
		readonly videoEffectIds?: StableIdListMap;
	};
	readonly 'clip/trim': {
		readonly clipId: string;
		readonly timelineStartFrame?: number;
		readonly sourceStartFrame?: number;
		readonly sourceDurationFrames?: number;
		readonly durationFrames?: number;
		readonly trimStartFrames?: number;
		readonly trimEndFrames?: number;
		readonly fadeInFrames?: number;
		readonly fadeOutFrames?: number;
	};
	readonly 'clip/split': {
		readonly clipId: string;
		readonly atFrame: number;
		readonly rightClipId: string;
		readonly linkedRightClipId?: string;
		readonly rightAvLinkId?: string;
		readonly rightVideoEffectIds?: readonly string[];
		readonly linkedRightVideoEffectIds?: readonly string[];
	};
	readonly 'clip/link-av': { readonly videoClipId: string; readonly audioClipId: string; readonly avLinkId: string };
	readonly 'clip/unlink-av': { readonly clipId: string };
	readonly 'clip/group': { readonly clipIds: readonly string[]; readonly groupId: string };
	readonly 'clip/ungroup': { readonly clipIds: readonly string[] };
	readonly 'clip/join': { readonly clipIds: readonly string[] };
	readonly 'range/lift-delete': CommandRangePayload;
	readonly 'range/ripple-delete': CommandRangePayload;
	readonly 'range/per-clip-ripple-delete': CommandRangePayload;
	readonly 'range/keep': CommandRangePayload;
	readonly 'range/replace': CommandRangePayload & {
		readonly trackId: string;
		readonly source: CommandObject;
		readonly clipId: string;
	};
	readonly 'clipboard/paste': {
		readonly clipboard: AudioEditorClipboard;
		readonly atFrame: number;
		readonly mode?: ClipboardPasteMode;
		readonly trackMap?: Readonly<Record<string, string>>;
		readonly clipIds?: StableIdMap;
		readonly groupIds?: StableIdMap;
		readonly avLinkIds?: StableIdMap;
		readonly collisionClipIds?: readonly string[];
		readonly collisionTrackIds?: readonly string[];
		readonly splitClipIds?: StableIdMap;
		readonly splitAvLinkIds?: StableIdMap;
		readonly videoEffectIds?: Readonly<Record<string, readonly string[]>>;
	};
	readonly 'punch/replace': CommandRangePayload & {
		readonly trackId: string;
		readonly sourceId: string;
		readonly sourceStartFrame?: number;
		readonly sourceDurationFrames?: number;
		readonly clipId: string;
	};
	readonly 'effect/add': EffectRackTarget & {
		readonly effect?: CommandObject;
		readonly effectType?: string;
		readonly index?: number;
	};
	readonly 'effect/update': EffectRackTarget & { readonly effectId: string; readonly changes: CommandObject };
	readonly 'effect/remove': EffectRackTarget & { readonly effectId: string };
	readonly 'effect/reorder': EffectRackTarget & { readonly effectId: string; readonly toIndex: number };
	readonly 'video-effect/add': {
		readonly clipId: string;
		readonly effect?: CommandObject;
		readonly effectType?: string;
		readonly index?: number;
	};
	readonly 'video-effect/update': { readonly clipId: string; readonly effectId: string; readonly changes: CommandObject };
	readonly 'video-effect/remove': { readonly clipId: string; readonly effectId: string };
	readonly 'video-effect/reorder': { readonly clipId: string; readonly effectId: string; readonly toIndex: number };
};

export interface BatchAudioEditorCommand {
	readonly type: 'batch';
	readonly commands: readonly AudioEditorCommand[];
}

type NonBatchAudioEditorCommandType = Exclude<AudioEditorCommandType, 'batch'>;

type NonBatchAudioEditorCommand = {
	readonly [Type in NonBatchAudioEditorCommandType]: Readonly<
		{ readonly type: Type } & NonBatchAudioEditorCommandPayloads[Type]
	>;
}[NonBatchAudioEditorCommandType];

export type AudioEditorCommand = BatchAudioEditorCommand | NonBatchAudioEditorCommand;

/** Payload lookup for protocol-aware tooling that already has a discriminant. */
export type AudioEditorCommandPayloads = NonBatchAudioEditorCommandPayloads & {
	readonly batch: Readonly<Omit<BatchAudioEditorCommand, 'type'>>;
};

type ProtocolIsExhaustive = [
	Exclude<AudioEditorCommandType, keyof AudioEditorCommandPayloads>,
	Exclude<keyof AudioEditorCommandPayloads, AudioEditorCommandType>,
] extends [never, never] ? true : never;

/** Fails type-checking when the discriminant list and payload map diverge. */
export const AUDIO_EDITOR_COMMAND_PROTOCOL_EXHAUSTIVE: ProtocolIsExhaustive = true;

export type EditorCommandProject = object;
export type EditorCommandHandler<Type extends AudioEditorCommandType = AudioEditorCommandType> = (
	project: EditorCommandProject,
	command: Extract<AudioEditorCommand, { readonly type: Type }>,
) => void;

export type EditorCommandHandlerRegistry = {
	readonly [Type in AudioEditorCommandType]: EditorCommandHandler<Type>;
};

const commandTypeSet: ReadonlySet<string> = new Set(AUDIO_EDITOR_COMMAND_TYPES);

export function isAudioEditorCommandType(value: unknown): value is AudioEditorCommandType {
	return typeof value === 'string' && commandTypeSet.has(value);
}
