/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	brandRuntimeProjectProjection,
	isRuntimeProjectProjection,
	resolveRuntimeProjectProjection,
	type RuntimeClipProject,
} from './runtime-clip-projection.ts';
import {
	inheritTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from './track-folder-media-runtime.ts';

export interface VideoKeyframeExportInventoryRequest {
	readonly project: Readonly<Record<string, unknown>>;
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface VideoKeyframeExportInventory {
	readonly activeClipIds: readonly string[];
	readonly activeSourceIds: readonly string[];
	readonly project: Readonly<{
		readonly clips: readonly Readonly<Record<string, unknown>>[];
		readonly sources: readonly Readonly<Record<string, unknown>>[];
	}>;
}

interface IndexedProject {
	readonly clips: readonly Readonly<Record<string, unknown>>[];
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly clipById: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
	readonly sourceById: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
}

interface ActiveSelection {
	readonly clipIds: readonly string[];
	readonly sourceIds: readonly string[];
}

const MAXIMUM_SOURCE_COUNT = 4_096;
const MAXIMUM_CLIP_COUNT = 100_000;
const MAXIMUM_TRACK_COUNT = 16_384;

/** Resolve and detach the exact active video graph required by one export range. */
export function createVideoKeyframeExportInventory(
	requestValue: VideoKeyframeExportInventoryRequest,
): VideoKeyframeExportInventory {
	const request = closedRecord(
		requestValue,
		'video keyframe export inventory request',
		['project', 'startFrame', 'endFrame'],
	);
	const project = record(data(request, 'project', 'video keyframe export inventory request'), 'video keyframe export project');
	const startFrame = nonNegativeSafeInteger(
		data(request, 'startFrame', 'video keyframe export inventory request'),
		'startFrame',
	);
	const endFrame = nonNegativeSafeInteger(
		data(request, 'endFrame', 'video keyframe export inventory request'),
		'endFrame',
	);
	if (endFrame <= startFrame) throw new RangeError('Video keyframe export inventory range must be positive.');
	const runtimeProject = exportRuntimeProject(project);
	const indexed = indexProject(runtimeProject);
	const active = selectActiveMedia(indexed, startFrame, endFrame);
	if (active.clipIds.length < 1) throw new RangeError('Video keyframe export range has no visible video clip.');
	const clips = active.clipIds.map((clipId) => requiredValue(
		indexed.clipById,
		clipId,
		`Video keyframe export lost active runtime clip ${clipId}.`,
	));
	const sources = active.sourceIds.map((sourceId) => requiredValue(
		indexed.sourceById,
		sourceId,
		`Video keyframe export lost active source ${sourceId}.`,
	));
	const capturedClips = freezeRecords(clips, 'video keyframe export active clips');
	const capturedSources = freezeRecords(sources, 'video keyframe export active sources');
	return Object.freeze({
		activeClipIds: Object.freeze(capturedClips.map((clip) => String(clip.id))),
		activeSourceIds: Object.freeze(capturedSources.map((source) => String(source.id))),
		project: Object.freeze({ clips: capturedClips, sources: capturedSources }),
	});
}

function exportRuntimeProject(
	project: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	const runtimeInput = isRuntimeProjectProjection(project);
	const mediaProject = projectTrackFolderMediaStateV12(project);
	if (runtimeInput) {
		return mediaProject === project
			? project
			: brandRuntimeProjectProjection(mediaProject as RuntimeClipProject);
	}
	const runtimeProject = resolveRuntimeProjectProjection(mediaProject as RuntimeClipProject);
	return inheritTrackFolderMediaStateProjectionV12(mediaProject, runtimeProject);
}

function indexProject(project: Readonly<Record<string, unknown>>): IndexedProject {
	const clips = records(
		data(project, 'clips', 'video keyframe export runtime project'),
		'video keyframe export runtime project.clips',
		MAXIMUM_CLIP_COUNT,
	);
	const sources = records(
		data(project, 'sources', 'video keyframe export runtime project'),
		'video keyframe export runtime project.sources',
		MAXIMUM_SOURCE_COUNT,
	);
	const tracks = records(
		data(project, 'tracks', 'video keyframe export runtime project'),
		'video keyframe export runtime project.tracks',
		MAXIMUM_TRACK_COUNT,
	);
	return Object.freeze({
		clips,
		sources,
		tracks,
		clipById: uniqueById(clips, 'runtime clip'),
		sourceById: uniqueById(sources, 'source'),
	});
}

function selectActiveMedia(
	project: IndexedProject,
	startFrame: number,
	endFrame: number,
): ActiveSelection {
	const activeClipIds: string[] = [];
	const activeSourceIds: string[] = [];
	const activeSources = new Set<string>();
	const linked = new Map<string, string>();
	const trackIds = new Set<string>();
	for (const [trackIndex, track] of project.tracks.entries()) {
		const name = `video keyframe export track ${String(trackIndex)}`;
		const trackId = id(data(track, 'id', name), 'track.id');
		if (trackIds.has(trackId)) throw new RangeError(`Duplicate track ID ${trackId}.`);
		trackIds.add(trackId);
		if (data(track, 'type', name) !== 'video') continue;
		const hidden = optionalData(track, 'hidden', false, name);
		if (typeof hidden !== 'boolean') throw new TypeError(`Video track ${trackId}.hidden must be boolean.`);
		const local = new Set<string>();
		for (const clipIdValue of denseArray(
			data(track, 'clipIds', name),
			`${name}.clipIds`,
			MAXIMUM_CLIP_COUNT,
		)) {
			const clipId = id(clipIdValue, 'video track clip ID');
			if (local.has(clipId)) throw new RangeError(`Video track ${trackId} has duplicate clip link ${clipId}.`);
			local.add(clipId);
			const priorTrackId = linked.get(clipId);
			if (priorTrackId !== undefined) {
				throw new RangeError(`Video clip ${clipId} is linked by more than one video track (${priorTrackId}, ${trackId}).`);
			}
			linked.set(clipId, trackId);
			const clip = project.clipById.get(clipId);
			if (!clip) throw new ReferenceError(`Video track ${trackId} references missing clip ${clipId}.`);
			if (data(clip, 'kind', `video keyframe export clip ${clipId}`) !== 'video') {
				throw new TypeError(`Video track ${trackId} contains non-video clip ${clipId}.`);
			}
			const sourceId = bindVideoSource(project.sourceById, clip, clipId);
			const clipStart = nonNegativeSafeInteger(
				data(clip, 'timelineStartFrame', `video keyframe export clip ${clipId}`),
				`video clip ${clipId}.timelineStartFrame`,
			);
			const duration = positiveSafeInteger(
				data(clip, 'durationFrames', `video keyframe export clip ${clipId}`),
				`video clip ${clipId}.durationFrames`,
			);
			const clipEnd = safeAdd(clipStart, duration, `video clip ${clipId} end`);
			if (hidden !== true && clipEnd > startFrame && clipStart < endFrame) {
				activeClipIds.push(clipId);
				if (!activeSources.has(sourceId)) {
					activeSources.add(sourceId);
					activeSourceIds.push(sourceId);
				}
			}
		}
	}
	return Object.freeze({
		clipIds: Object.freeze(activeClipIds),
		sourceIds: Object.freeze(activeSourceIds),
	});
}

function bindVideoSource(
	sourceById: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
	clip: Readonly<Record<string, unknown>>,
	clipId: string,
): string {
	const sourceId = id(data(clip, 'sourceId', `video keyframe export clip ${clipId}`), 'clip.sourceId');
	const source = sourceById.get(sourceId);
	if (!source) throw new ReferenceError(`Video clip ${clipId} references missing source ${sourceId}.`);
	if (data(source, 'kind', `video keyframe export source ${sourceId}`) !== 'video') {
		throw new TypeError(`Video clip ${clipId} references non-video source ${sourceId}.`);
	}
	return sourceId;
}

function requiredValue<Value>(values: ReadonlyMap<string, Value>, key: string, message: string): Value {
	const value = values.get(key);
	if (value === undefined) throw new ReferenceError(message);
	return value;
}

function uniqueById(
	values: readonly Readonly<Record<string, unknown>>[],
	name: string,
): ReadonlyMap<string, Readonly<Record<string, unknown>>> {
	const result = new Map<string, Readonly<Record<string, unknown>>>();
	for (const [index, value] of values.entries()) {
		const valueId = id(data(value, 'id', `${name} ${String(index)}`), `${name}.id`);
		if (result.has(valueId)) throw new RangeError(`Duplicate ${name} ID ${valueId}.`);
		result.set(valueId, value);
	}
	return result;
}

function freezeRecords(
	values: readonly Readonly<Record<string, unknown>>[],
	name: string,
): readonly Readonly<Record<string, unknown>>[] {
	let snapshot: unknown;
	try {
		snapshot = structuredClone(values);
	} catch (cause) {
		throw new TypeError(`${name} must contain structured-clone data.`, { cause });
	}
	return deepFreeze(snapshot) as readonly Readonly<Record<string, unknown>>[];
}

function deepFreeze<Value>(value: Value): Value {
	if (!value || typeof value !== 'object') return value;
	const stack: object[] = [value];
	const seen = new WeakSet<object>();
	const order: object[] = [];
	while (stack.length > 0) {
		const current = stack.pop()!;
		if (seen.has(current)) continue;
		seen.add(current);
		order.push(current);
		for (const key of Reflect.ownKeys(current)) {
			const nested = Object.getOwnPropertyDescriptor(current, key)?.value;
			if (nested && typeof nested === 'object') stack.push(nested as object);
		}
	}
	for (let index = order.length - 1; index >= 0; index -= 1) Object.freeze(order[index]);
	return value;
}

function records(value: unknown, name: string, maximum: number): readonly Readonly<Record<string, unknown>>[] {
	return denseArray(value, name, maximum).map((entry, index) => record(entry, `${name}[${String(index)}]`));
}

function denseArray(value: unknown, name: string, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
		throw new RangeError(`${name} must be a bounded ordinary array.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must be dense own data.`);
		}
		result.push(descriptor.value);
	}
	if (Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError(`${name} cannot contain named fields.`);
	return Object.freeze(result);
}

function closedRecord(value: unknown, name: string, fields: readonly string[]): Readonly<Record<string, unknown>> {
	const result = record(value, name);
	const allowed = new Set(fields);
	for (const key of Reflect.ownKeys(result)) {
		if (typeof key !== 'string' || !allowed.has(key)) throw new TypeError(`${name} has an unsupported field.`);
		data(result, key, name);
	}
	if (Reflect.ownKeys(result).length !== fields.length || fields.some((field) => !Object.hasOwn(result, field))) {
		throw new TypeError(`${name} requires exactly ${fields.join(', ')}.`);
	}
	return result;
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a plain record.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	return value as Readonly<Record<string, unknown>>;
}

function data(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function optionalData(value: object, key: string, fallback: unknown, name: string): unknown {
	return Object.hasOwn(value, key) ? data(value, key, name) : fallback;
}

function id(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError(`${name} must be a bounded non-empty string.`);
	}
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	const result = nonNegativeSafeInteger(value, name);
	if (result === 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer domain.`);
	return result;
}
