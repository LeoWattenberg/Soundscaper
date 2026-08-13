/* SPDX-License-Identifier: AGPL-3.0-only */

import { digestMediaContent } from '../storage/media-content-digest.ts';
import {
	isRuntimeProjectProjection,
	resolveRuntimeProjectProjection,
} from '../runtime-clip-projection.ts';
import {
	inheritTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from '../track-folder-media-runtime.ts';
import {
	resolveVideoSourceDisplaySize,
	resolveVideoSourcePresentation,
} from '../video-source-presentation.ts';
import {
	boundVideoSourceTimingViewInfo,
	type BoundVideoSourceTimingView,
} from '../video-source-timing-view.ts';
import type {
	VideoKeyframeOfflineHtmlVideoSourceAsset,
} from './video-keyframe-offline-html-video-source-resolver.ts';

export interface VideoKeyframeOfflineVideoSourceInputSnapshot {
	readonly sourceId: string;
	readonly blob: Blob;
}

export interface VideoKeyframeOfflineVideoSourcePlan {
	readonly project: Readonly<Record<string, unknown>>;
	authenticate(
		sources: readonly VideoKeyframeOfflineVideoSourceInputSnapshot[],
		presentationForEntry: VideoKeyframeOfflineHtmlVideoSourceAsset['presentationForEntry'],
		options: Readonly<{ signal: AbortSignal; assertCurrent: () => void }>,
	): Promise<readonly VideoKeyframeOfflineHtmlVideoSourceAsset[]>;
}

interface CanonicalVideoSource {
	readonly sourceId: string;
	readonly contentSha256: string;
	readonly clipIds: readonly string[];
	readonly decodedWidth: number;
	readonly decodedHeight: number;
	readonly displayWidth: number;
	readonly displayHeight: number;
}

const MAXIMUM_SOURCE_COUNT = 4_096;
const MAXIMUM_CLIP_COUNT = 100_000;
const SHA256 = /^[a-f0-9]{64}$/u;

/** Retain only visible clips intersecting the requested timeline range and their exact sources. */
export function planVideoKeyframeOfflineVideoSources(requestValue: Readonly<{
	readonly project: Readonly<Record<string, unknown>>;
	readonly timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>;
	readonly startFrame?: number;
	readonly endFrame?: number;
}>): VideoKeyframeOfflineVideoSourcePlan {
	const project = captureVisibleExportProject(requestValue);
	const canonical = captureCanonicalSources(project, requestValue.timingBySourceId);
	return Object.freeze({
		project,
		async authenticate(
			sources: readonly VideoKeyframeOfflineVideoSourceInputSnapshot[],
			presentationForEntry: VideoKeyframeOfflineHtmlVideoSourceAsset['presentationForEntry'],
			options: Readonly<{ signal: AbortSignal; assertCurrent: () => void }>,
		) {
			if (sources.length !== canonical.size) {
				throw new RangeError('Offline video export requires exactly one Blob for every visible video source.');
			}
			const assets: VideoKeyframeOfflineHtmlVideoSourceAsset[] = [];
			for (const input of sources) {
				assertReady(options);
				const expected = canonical.get(input.sourceId);
				if (!expected) throw new ReferenceError(`Offline video source ${input.sourceId} is not visible and canonical.`);
				const digest = await digestMediaContent(input.blob, { signal: options.signal });
				assertReady(options);
				if (digest !== expected.contentSha256) {
					throw new Error(`Offline video source ${input.sourceId} Blob digest does not match its project identity.`);
				}
				assets.push(Object.freeze({
					sourceId: expected.sourceId,
					identity: digest,
					blob: input.blob,
					clipIds: expected.clipIds,
					decodedWidth: expected.decodedWidth,
					decodedHeight: expected.decodedHeight,
					displayWidth: expected.displayWidth,
					displayHeight: expected.displayHeight,
					presentationForEntry,
				}));
			}
			return Object.freeze(assets);
		},
	});
}

function captureVisibleExportProject(request: Readonly<{
	readonly project: Readonly<Record<string, unknown>>;
	readonly startFrame?: number;
	readonly endFrame?: number;
}>): Readonly<Record<string, unknown>> {
	const mediaProject = projectTrackFolderMediaStateV12(request.project);
	const runtime = isRuntimeProjectProjection(mediaProject)
		? mediaProject
		: inheritTrackFolderMediaStateProjectionV12(
			mediaProject,
			resolveRuntimeProjectProjection(mediaProject),
		);
	const runtimeRecord = record(runtime, 'offline video export runtime project');
	const runtimeClips = denseArray(
		data(runtimeRecord, 'clips', 'offline video export runtime project'),
		'offline video export runtime project.clips',
		MAXIMUM_CLIP_COUNT,
	);
	const clipById = new Map<string, Readonly<Record<string, unknown>>>();
	for (const [index, clipValue] of runtimeClips.entries()) {
		const clip = record(clipValue, `offline video export runtime clip ${String(index)}`);
		const clipId = boundedId(data(clip, 'id', `offline video export runtime clip ${String(index)}`), 'clip.id');
		if (clipById.has(clipId)) throw new RangeError(`Duplicate runtime clip ID ${clipId}.`);
		clipById.set(clipId, clip);
	}
	const startFrame = request.startFrame ?? 0;
	const endFrame = request.endFrame ?? Number.MAX_SAFE_INTEGER;
	const activeClipIds = new Set<string>();
	for (const [index, trackValue] of denseArray(
		data(runtimeRecord, 'tracks', 'offline video export runtime project'),
		'offline video export runtime project.tracks',
		MAXIMUM_CLIP_COUNT,
	).entries()) {
		const track = record(trackValue, `offline video export track ${String(index)}`);
		if (data(track, 'type', `offline video export track ${String(index)}`) !== 'video'
			|| optionalData(track, 'hidden', false, `offline video export track ${String(index)}`) === true) continue;
		for (const clipIdValue of denseArray(
			data(track, 'clipIds', `offline video export track ${String(index)}`),
			`offline video export track ${String(index)}.clipIds`,
			MAXIMUM_CLIP_COUNT,
		)) {
			const clipId = boundedId(clipIdValue, 'video track clip ID');
			const clip = clipById.get(clipId);
			if (!clip) throw new ReferenceError(`Video track references missing clip ${clipId}.`);
			if (data(clip, 'kind', `offline video export clip ${clipId}`) !== 'video') {
				throw new TypeError(`Video track contains non-video clip ${clipId}.`);
			}
			const clipStart = nonNegativeSafeInteger(
				data(clip, 'timelineStartFrame', `offline video export clip ${clipId}`),
				`video clip ${clipId}.timelineStartFrame`,
			);
			const duration = positiveSafeInteger(
				data(clip, 'durationFrames', `offline video export clip ${clipId}`),
				`video clip ${clipId}.durationFrames`,
			);
			const clipEnd = safeAdd(clipStart, duration, `video clip ${clipId} end`);
			if (clipEnd > startFrame && clipStart < endFrame) activeClipIds.add(clipId);
		}
	}
	if (activeClipIds.size < 1) throw new RangeError('Offline video export range has no visible video clip.');
	const canonicalClips = denseArray(
		data(request.project, 'clips', 'offline video export project'),
		'offline video export project.clips',
		MAXIMUM_CLIP_COUNT,
	).filter((value) => activeClipIds.has(boundedId(
		data(record(value, 'offline video export canonical clip'), 'id', 'offline video export canonical clip'),
		'clip.id',
	)));
	if (canonicalClips.length !== activeClipIds.size) {
		throw new ReferenceError('Offline video export could not bind every visible runtime clip canonically.');
	}
	const activeSourceIds = new Set(canonicalClips.map((value) => boundedId(
		data(record(value, 'offline video export canonical clip'), 'sourceId', 'offline video export canonical clip'),
		'clip.sourceId',
	)));
	const canonicalSources = denseArray(
		data(request.project, 'sources', 'offline video export project'),
		'offline video export project.sources',
		MAXIMUM_SOURCE_COUNT,
	).filter((value) => activeSourceIds.has(boundedId(
		data(record(value, 'offline video export canonical source'), 'id', 'offline video export canonical source'),
		'source.id',
	)));
	if (canonicalSources.length !== activeSourceIds.size) {
		throw new ReferenceError('Offline video export could not bind every visible clip source canonically.');
	}
	return Object.freeze({
		sources: Object.freeze(canonicalSources),
		clips: Object.freeze(canonicalClips),
	});
}

function captureCanonicalSources(
	project: Readonly<Record<string, unknown>>,
	timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>,
): ReadonlyMap<string, CanonicalVideoSource> {
	const sources = denseArray(data(project, 'sources', 'offline video export project'), 'project.sources', MAXIMUM_SOURCE_COUNT);
	const clips = denseArray(data(project, 'clips', 'offline video export project'), 'project.clips', MAXIMUM_CLIP_COUNT);
	const clipIds = new Map<string, string[]>();
	for (const [index, value] of clips.entries()) {
		const clip = record(value, `offline video export clip ${String(index)}`);
		if (data(clip, 'kind', `offline video export clip ${String(index)}`) !== 'video') continue;
		const clipId = boundedId(data(clip, 'id', `offline video export clip ${String(index)}`), 'clip.id');
		const sourceId = boundedId(data(clip, 'sourceId', `offline video export clip ${clipId}`), 'clip.sourceId');
		const ids = clipIds.get(sourceId) ?? [];
		if (ids.includes(clipId)) throw new RangeError(`Duplicate video clip ID ${clipId}.`);
		ids.push(clipId);
		clipIds.set(sourceId, ids);
	}
	const result = new Map<string, CanonicalVideoSource>();
	for (const [index, value] of sources.entries()) {
		const source = record(value, `offline video export source ${String(index)}`);
		if (data(source, 'kind', `offline video export source ${String(index)}`) !== 'video') continue;
		const sourceId = boundedId(data(source, 'id', `offline video export source ${String(index)}`), 'source.id');
		if (result.has(sourceId)) throw new RangeError(`Duplicate video source ID ${sourceId}.`);
		const ids = clipIds.get(sourceId);
		if (!ids || ids.length < 1) continue;
		const identity = data(source, 'contentSha256', `offline video export source ${sourceId}`);
		if (typeof identity !== 'string' || !SHA256.test(identity)) {
			throw new TypeError(`Offline video source ${sourceId} requires a lowercase SHA-256 digest.`);
		}
		const timing = timingBySourceId.get(sourceId);
		const timingInfo = boundVideoSourceTimingViewInfo(timing);
		if (timingInfo.sourceId !== sourceId) throw new Error(`Offline video source ${sourceId} timing is mismatched.`);
		const persistedWidth = dimension(data(source, 'width', `offline video export source ${sourceId}`), 'source.width');
		const persistedHeight = dimension(data(source, 'height', `offline video export source ${sourceId}`), 'source.height');
		const presentation = resolveVideoSourcePresentation(source);
		const display = resolveVideoSourceDisplaySize(source);
		if (!display) throw new RangeError(`Offline video source ${sourceId} has no display geometry.`);
		result.set(sourceId, Object.freeze({
			sourceId,
			contentSha256: identity,
			clipIds: Object.freeze([...ids]),
			decodedWidth: dimension(presentation?.decodedWidth ?? persistedWidth, 'source decoded width'),
			decodedHeight: dimension(presentation?.decodedHeight ?? persistedHeight, 'source decoded height'),
			displayWidth: dimension(display.width, 'source display width'),
			displayHeight: dimension(display.height, 'source display height'),
		}));
	}
	return result;
}

function assertReady(options: Readonly<{ signal: AbortSignal; assertCurrent: () => void }>): void {
	if (options.signal.aborted) throw options.signal.reason ?? new DOMException('Offline video export was cancelled.', 'AbortError');
	options.assertCurrent();
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a plain record.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	return value as Readonly<Record<string, unknown>>;
}

function data(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name}.${key} must be an own data property.`);
	return descriptor.value;
}

function optionalData(value: object, key: string, fallback: unknown, name: string): unknown {
	return Object.hasOwn(value, key) ? data(value, key, name) : fallback;
}

function denseArray(value: unknown, name: string, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
		throw new RangeError(`${name} must be a bounded ordinary array.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name} must be dense own data.`);
		result.push(descriptor.value);
	}
	if (Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError(`${name} cannot contain named fields.`);
	return Object.freeze(result);
}

function boundedId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) throw new TypeError(`${name} must be a bounded ID.`);
	return value;
}

function dimension(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be positive.`);
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
