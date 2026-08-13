/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAudioClipV2,
	createAudioSourceV2,
	createAudioTrackV2,
	createLabelTrackV2,
	createLabelV2,
} from '../project-v2.js';
import {
	createAudioTrackV4,
	createLabelTrackV4,
	createMediaClipV4,
	createMediaSourceV4,
	createMediaTrackV4,
} from '../project-v4.js';
import {
	createMediaClipV5,
	createMediaSourceV5,
	createMediaTrackV5,
} from '../project-v5.js';
import { createStableId } from '../stable-id.js';
import { createVideoEffect } from '../video-effects.js';
import { createMediaClipV8 } from '../project-v8.ts';
import type { TimelineAnnotationV11 } from '../timeline-annotation.ts';
import type {
	AudioEditorCommand,
	AudioEditorCommandType,
	CommandObject,
	SequenceTimingCommandChanges,
	SignatureEventCommandChanges,
	SignatureEventCommandValue,
	TempoEventCommandChanges,
	TempoEventCommandValue,
	TempoMapMode,
	TimelineAnnotationConversionCoordinates,
	TrackFolderRemovalDisposition,
	TimelineAnnotationMoveDelta,
	TimelineAnnotationResizeCoordinate,
	TimelineAnnotationUpdateChanges,
} from './protocol.ts';
import { snapshotVideoKeyframesSetCommand } from './video-keyframes.ts';

type CommandFor<Type extends AudioEditorCommandType> = Extract<AudioEditorCommand, { readonly type: Type }>;

export interface CommandFactoryValue extends Record<string, unknown> {
	readonly schemaVersion?: number;
	readonly kind?: string;
	readonly type?: string;
	readonly laneGroupId?: unknown;
	readonly videoEffects?: readonly unknown[];
}

export interface VideoEffectFactoryOptions extends CommandFactoryValue {
	readonly id?: string;
	readonly enabled?: boolean;
	readonly params?: Readonly<Record<string, number>>;
	readonly index?: number;
}

export function createAddSourceCommand(options: CommandFactoryValue): CommandFor<'source/add'> {
	return { type: 'source/add', source: normalizeSourceValue(options) };
}

export function createAddTrackCommand(options: CommandFactoryValue = {}): CommandFor<'track/add'> {
	return { type: 'track/add', track: normalizeTrackValue(options) };
}

export function createAddClipCommand(trackId: string, options: CommandFactoryValue): CommandFor<'clip/add'> {
	return { type: 'clip/add', trackId, clip: normalizeClipValue(options) };
}

export function createReplaceClipSourceCommand(clipId: string, sourceId: string): CommandFor<'clip/replace-source'> {
	return {
		type: 'clip/replace-source',
		clipId: requireStableCommandId(clipId, 'clip'),
		sourceId: requireStableCommandId(sourceId, 'source'),
	};
}

export function createAddVideoEffectCommand(
	clipId: string,
	effectType: string,
	options: VideoEffectFactoryOptions = {},
): CommandFor<'video-effect/add'> {
	return {
		type: 'video-effect/add',
		clipId: requireStableCommandId(clipId, 'video clip'),
		effect: createVideoEffect(effectType, options) as CommandObject,
		...(options.index == null ? {} : { index: options.index }),
	};
}

export function createUpdateVideoEffectCommand(
	clipId: string,
	effectId: string,
	changes: CommandObject = {},
): CommandFor<'video-effect/update'> {
	return {
		type: 'video-effect/update',
		clipId: requireStableCommandId(clipId, 'video clip'),
		effectId: requireStableCommandId(effectId, 'video effect'),
		changes: { ...changes },
	};
}

export function createBypassVideoEffectCommand(
	clipId: string,
	effectId: string,
	bypassed = true,
): CommandFor<'video-effect/update'> {
	if (typeof bypassed !== 'boolean') throw new TypeError('Video effect bypass state must be boolean.');
	return createUpdateVideoEffectCommand(clipId, effectId, { enabled: !bypassed });
}

export function createReorderVideoEffectCommand(
	clipId: string,
	effectId: string,
	toIndex: number,
): CommandFor<'video-effect/reorder'> {
	if (!Number.isSafeInteger(toIndex) || toIndex < 0) {
		throw new RangeError('Video effect destination must be a non-negative safe integer.');
	}
	return {
		type: 'video-effect/reorder',
		clipId: requireStableCommandId(clipId, 'video clip'),
		effectId: requireStableCommandId(effectId, 'video effect'),
		toIndex,
	};
}

export function createRemoveVideoEffectCommand(
	clipId: string,
	effectId: string,
): CommandFor<'video-effect/remove'> {
	return {
		type: 'video-effect/remove',
		clipId: requireStableCommandId(clipId, 'video clip'),
		effectId: requireStableCommandId(effectId, 'video effect'),
	};
}

export function createSetVideoKeyframesCommand(
	clipId: string,
	expectedKeyframes: unknown,
	keyframes: unknown,
): CommandFor<'video-keyframes/set'> {
	return snapshotVideoKeyframesSetCommand({
		type: 'video-keyframes/set',
		clipId: requireStableCommandId(clipId, 'video clip'),
		expectedKeyframes,
		keyframes,
	});
}

export function createAddLabelTrackCommand(options: CommandFactoryValue = {}): CommandFor<'track/add'> {
	return { type: 'track/add', track: createLabelTrackV2(options) as CommandObject };
}

export function createAddLabelCommand(
	trackId: string,
	options: CommandFactoryValue = {},
): CommandFor<'label/add'> {
	return { type: 'label/add', trackId, label: createLabelV2(options) as CommandObject };
}

export interface TrackFolderPlacementOptions {
	readonly parentFolderId?: string | null;
	readonly index?: number;
}

export function createAddTrackFolderCommand(
	sequenceId: string,
	options: CommandFactoryValue = {},
	placement: TrackFolderPlacementOptions = {},
): CommandFor<'track-folder/add'> {
	const { parentFolderId = null, index } = placement;
	return {
		type: 'track-folder/add',
		folder: {
			id: typeof options.id === 'string' && options.id ? options.id : createStableId('track-folder'),
			name: typeof options.name === 'string' && options.name.trim() ? options.name : 'Folder',
			...Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'id' && key !== 'name')),
		},
		sequenceId,
		parentFolderId,
		...(index === undefined ? {} : { index }),
	};
}

export function createUpdateTrackFolderCommand(
	folderId: string,
	changes: CommandObject,
): CommandFor<'track-folder/update'> {
	return { type: 'track-folder/update', folderId, changes };
}

export function createRemoveTrackFolderCommand(
	folderId: string,
	disposition: TrackFolderRemovalDisposition,
): CommandFor<'track-folder/remove'> {
	return { type: 'track-folder/remove', folderId, disposition };
}

export function createMoveTrackNodeCommand(
	sequenceId: string,
	nodeId: string,
	parentFolderId: string | null,
	index: number,
): CommandFor<'track-node/move'> {
	return { type: 'track-node/move', sequenceId, nodeId, parentFolderId, index };
}

export function createSetTempoMapModeCommand(mode: TempoMapMode): CommandFor<'tempo-map/mode-set'> {
	if (mode !== 'musical' && mode !== 'sampleLocked') throw new RangeError('tempoMap.mode is unsupported.');
	return { type: 'tempo-map/mode-set', mode };
}

export function createAddTempoEventCommand(event: TempoEventCommandValue): CommandFor<'tempo-event/add'> {
	requireStableCommandId(event?.id, 'tempo event');
	return { type: 'tempo-event/add', event: structuredClone(event) };
}

export function createUpdateTempoEventCommand(
	eventId: string,
	changes: TempoEventCommandChanges,
): CommandFor<'tempo-event/update'> {
	return {
		type: 'tempo-event/update',
		eventId: requireStableCommandId(eventId, 'tempo event'),
		changes: structuredClone(changes),
	};
}

export function createRemoveTempoEventCommand(eventId: string): CommandFor<'tempo-event/remove'> {
	return { type: 'tempo-event/remove', eventId: requireStableCommandId(eventId, 'tempo event') };
}

export function createAddSignatureEventCommand(
	event: SignatureEventCommandValue,
): CommandFor<'signature-event/add'> {
	requireStableCommandId(event?.id, 'signature event');
	return { type: 'signature-event/add', event: structuredClone(event) };
}

export function createUpdateSignatureEventCommand(
	eventId: string,
	changes: SignatureEventCommandChanges,
): CommandFor<'signature-event/update'> {
	return {
		type: 'signature-event/update',
		eventId: requireStableCommandId(eventId, 'signature event'),
		changes: structuredClone(changes),
	};
}

export function createRemoveSignatureEventCommand(eventId: string): CommandFor<'signature-event/remove'> {
	return { type: 'signature-event/remove', eventId: requireStableCommandId(eventId, 'signature event') };
}

export function createUpdateSequenceTimingCommand(
	sequenceId: string,
	changes: SequenceTimingCommandChanges,
): CommandFor<'sequence/update'> {
	return {
		type: 'sequence/update',
		sequenceId: requireStableCommandId(sequenceId, 'sequence'),
		changes: structuredClone(changes),
	};
}

export function createAddTimelineAnnotationCommand(
	annotation: TimelineAnnotationV11,
): CommandFor<'timeline-annotation/add'> {
	if (!annotation || typeof annotation !== 'object' || Array.isArray(annotation)) {
		throw new TypeError('Timeline annotation must be an object.');
	}
	requireCanonicalCommandId(annotation.id, 'timeline annotation');
	return {
		type: 'timeline-annotation/add',
		annotation: cloneJsonSafeCommandValue(annotation, 'Timeline annotation'),
	};
}

export function createUpdateTimelineAnnotationsCommand(
	annotationIds: readonly string[],
	changes: TimelineAnnotationUpdateChanges,
): CommandFor<'timeline-annotation/update-many'> {
	return {
		type: 'timeline-annotation/update-many',
		annotationIds: requireTimelineAnnotationIds(annotationIds),
		changes: cloneJsonSafeCommandValue(changes, 'Timeline annotation changes'),
	};
}

export function createMoveTimelineAnnotationsCommand(
	annotationIds: readonly string[],
	delta: TimelineAnnotationMoveDelta,
): CommandFor<'timeline-annotation/move-many'> {
	return {
		type: 'timeline-annotation/move-many',
		annotationIds: requireTimelineAnnotationIds(annotationIds),
		delta: cloneJsonSafeCommandValue(delta, 'Timeline annotation move delta'),
	};
}

export function createResizeTimelineAnnotationCommand(
	annotationId: string,
	edge: 'start' | 'end',
	coordinate: TimelineAnnotationResizeCoordinate,
): CommandFor<'timeline-annotation/resize'> {
	if (edge !== 'start' && edge !== 'end') throw new RangeError('Timeline annotation edge must be start or end.');
	return {
		type: 'timeline-annotation/resize',
		annotationId: requireCanonicalCommandId(annotationId, 'timeline annotation'),
		edge,
		coordinate: cloneJsonSafeCommandValue(coordinate, 'Timeline annotation resize coordinate'),
	};
}

export function createConvertTimelineAnnotationCommand(
	annotationId: string,
	coordinates: TimelineAnnotationConversionCoordinates,
): CommandFor<'timeline-annotation/convert'> {
	return {
		type: 'timeline-annotation/convert',
		annotationId: requireCanonicalCommandId(annotationId, 'timeline annotation'),
		coordinates: cloneJsonSafeCommandValue(coordinates, 'Timeline annotation conversion coordinates'),
	};
}

export function createRemoveTimelineAnnotationsCommand(
	annotationIds: readonly string[],
): CommandFor<'timeline-annotation/remove-many'> {
	return {
		type: 'timeline-annotation/remove-many',
		annotationIds: requireTimelineAnnotationIds(annotationIds),
	};
}

export function createBatchSetTimelineAnnotationsCommand(
	annotationIds: readonly string[],
	batchId: string | null,
): CommandFor<'timeline-annotation/batch-set'> {
	return {
		type: 'timeline-annotation/batch-set',
		annotationIds: requireTimelineAnnotationIds(annotationIds),
		batchId: batchId === null ? null : requireCanonicalCommandId(batchId, 'timeline annotation batch'),
	};
}

function normalizeSourceValue(value: CommandFactoryValue): CommandObject {
	if (value.sampleFrameCount != null || value.timingDecision != null) return structuredClone(value) as CommandObject;
	if ((value.schemaVersion ?? 0) >= 5) return createMediaSourceV5(value) as CommandObject;
	return value.kind ? createMediaSourceV4(value) as CommandObject : createAudioSourceV2(value) as CommandObject;
}

function normalizeTrackValue(value: CommandFactoryValue): CommandObject {
	if ((value.schemaVersion ?? 0) >= 10) return structuredClone(value) as CommandObject;
	if ((value.schemaVersion ?? 0) >= 5) return createMediaTrackV5(value) as CommandObject;
	if (value.type === 'video') return createMediaTrackV4(value) as CommandObject;
	if ((value.schemaVersion ?? 0) >= 4 && value.type === 'label') return createLabelTrackV4(value) as CommandObject;
	if (value.type === 'label') return createLabelTrackV2(value) as CommandObject;
	if ((value.schemaVersion ?? 0) >= 4 || value.laneGroupId) return createAudioTrackV4(value) as CommandObject;
	return createAudioTrackV2(value) as CommandObject;
}

function normalizeClipValue(value: CommandFactoryValue): CommandObject {
	if (value.anchor != null || value.sequenceStartFrame != null) return structuredClone(value) as CommandObject;
	if ((value.schemaVersion ?? 0) >= 8) return createMediaClipV8(value) as CommandObject;
	if (Array.isArray(value.videoEffects) || (value.schemaVersion ?? 0) >= 5) {
		return createMediaClipV5(value) as CommandObject;
	}
	return value.kind ? createMediaClipV4(value) as CommandObject : createAudioClipV2(value) as CommandObject;
}

function requireStableCommandId(value: string, name: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} ID must be a non-empty string.`);
	return value;
}

function requireTimelineAnnotationIds(value: readonly string[]): readonly string[] {
	if (!Array.isArray(value) || !value.length) {
		throw new TypeError('Timeline annotation IDs must be a non-empty array.');
	}
	const ids = value.map((id) => requireCanonicalCommandId(id, 'timeline annotation'));
	if (new Set(ids).size !== ids.length) throw new RangeError('Timeline annotation IDs cannot contain duplicates.');
	return ids;
}

function requireCanonicalCommandId(value: string, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()) {
		throw new TypeError(`${name} ID must be a canonical non-empty string.`);
	}
	return value;
}

function cloneJsonSafeCommandValue<Value>(value: Value, name: string): Value {
	assertJsonSafeCommandValue(value, name, new Set<object>());
	const serialized = JSON.stringify(value);
	if (serialized === undefined) throw new TypeError(`${name} must be JSON-safe.`);
	return JSON.parse(serialized) as Value;
}

function assertJsonSafeCommandValue(value: unknown, name: string, ancestors: Set<object>): void {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
	if (typeof value === 'number') {
		if (!Number.isFinite(value) || Object.is(value, -0)) {
			throw new TypeError(`${name} must contain only exact finite JSON numbers.`);
		}
		return;
	}
	if (typeof value !== 'object') throw new TypeError(`${name} must be JSON-safe.`);
	if (ancestors.has(value)) throw new TypeError(`${name} cannot contain a cyclic value.`);
	ancestors.add(value);
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) {
			if (!Object.hasOwn(value, index)) throw new TypeError(`${name} cannot contain a sparse array.`);
			assertJsonSafeCommandValue(value[index], `${name}[${String(index)}]`, ancestors);
		}
		for (const key of Reflect.ownKeys(value)) {
			if (key === 'length') continue;
			if (typeof key !== 'string') throw new TypeError(`${name} cannot contain symbol fields.`);
			const index = Number(key);
			if (!Number.isSafeInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
				throw new TypeError(`${name} contains a non-JSON array field: ${key}.`);
			}
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError(`${name}[${key}] must be an own enumerable data property.`);
			}
		}
		ancestors.delete(value);
		return;
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must contain only plain JSON objects.`);
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError(`${name} cannot contain symbol fields.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
		assertJsonSafeCommandValue(descriptor.value, `${name}.${key}`, ancestors);
	}
	ancestors.delete(value);
}
