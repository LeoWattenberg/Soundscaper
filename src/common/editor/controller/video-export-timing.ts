/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVisibleVideoTrackPredicate } from '../video-timeline.js';

import { loadVideoTimingAsset } from '../video-timing-storage.ts';
import { projectTrackFolderMediaStateV12 } from '../track-folder-media-runtime.ts';
import {
	acquireVideoTimingIndex,
	type VideoTimingIndexLease,
} from '../video-source-time.ts';
import {
	bindVideoSourceTimingView,
	type BoundVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../video-source-timing-view.ts';
import type { VideoTimingAssetReference } from '../video-timing-asset.ts';
import { createVideoExportTimingMap } from '../video-export-timing-map.ts';

type DataRecord = Readonly<Record<string, unknown>>;
type ProjectLookup = (project: unknown, id: string) => unknown;

interface VideoExportTimingStore {
	loadMediaAsset(
		storageKey: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): PromiseLike<Blob | null>;
}

interface VideoExportTimingDependencies {
	readonly findClip: ProjectLookup;
	readonly findSource: ProjectLookup;
}

interface VideoExportTimingOptions {
	readonly signal?: AbortSignal;
	readonly assertCurrent: () => void;
	readonly requiredSourceIds?: readonly string[];
}

export interface VideoExportTimingIndexLease extends VideoTimingIndexLease {
	readonly timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>;
}

/** Acquire every verified timing index required by synchronous video planning. */
export async function acquireVideoExportTimingIndexes(
	projectValue: unknown,
	store: VideoExportTimingStore,
	dependencies: VideoExportTimingDependencies,
	options: VideoExportTimingOptions,
): Promise<VideoExportTimingIndexLease> {
	const requiredSourceIds = normalizeRequiredSourceIds(options.requiredSourceIds);
	const sources = selectVisibleVideoSources(projectValue, dependencies, requiredSourceIds);
	const indexes: Array<Readonly<{
		source: DataRecord;
		index: NonNullable<Awaited<ReturnType<typeof loadVideoTimingAsset>>['index']>;
	}>> = [];
	const timingViews = new Map<string, VideoSourceTimingView>();
	for (const source of sources) {
		const sourceId = stringId(source.id, 'video export source.id');
		const mode = recordMode(source.timingDecision);
		if (mode === 'conform-cfr-at-ingest') {
			timingViews.set(sourceId, Object.freeze({
				kind: 'cfr',
				rate: rationalRate(record(source.timingDecision, `video source ${sourceId}.timingDecision`).rate, `video source ${sourceId}.timingDecision.rate`),
				frameCount: positiveSafeInteger(source.sourceFrameCount, `video source ${sourceId}.sourceFrameCount`),
			}));
			continue;
		}
		if (mode !== undefined && mode !== 'exact') {
			throw new RangeError(`Video source ${sourceId} has an unsupported timing decision.`);
		}
		if (source.timingAsset == null) {
			if (mode === 'exact') throw new Error('An exact-timing video source is missing its timing asset.');
			if (requiredSourceIds !== null) {
				throw new Error(`Video source ${sourceId} has no persisted timing decision.`);
			}
			continue;
		}
		assertTimingLoadCurrent(options);
		const loaded = await loadVideoTimingAsset(store, source.timingAsset, {
			signal: options.signal,
			sourceSha256: stringValue(source.contentSha256),
		});
		assertTimingLoadCurrent(options);
		if (loaded.status !== 'available' || !loaded.index) {
			throw new Error(`The video timing asset is ${loaded.status}.`);
		}
		indexes.push(Object.freeze({ source, index: loaded.index }));
		if (mode === 'exact') {
			timingViews.set(sourceId, Object.freeze({
				kind: 'vfr',
				reference: source.timingAsset as Readonly<VideoTimingAssetReference>,
				index: loaded.index,
			}));
		}
	}
	const leases: VideoTimingIndexLease[] = [];
	try {
		for (const { source, index } of indexes) {
			leases.push(acquireVideoTimingIndex(source, index));
		}
		const boundEntries: Array<readonly [string, BoundVideoSourceTimingView]> = [];
		for (const source of sources) {
			const sourceId = stringId(source.id, 'video export source.id');
			if (!timingViews.has(sourceId)) continue;
			assertTimingLoadCurrent(options);
			boundEntries.push(Object.freeze([
				sourceId,
				bindVideoSourceTimingView(timingViews, source),
			]));
		}
		const timingBySourceId = createVideoExportTimingMap(boundEntries);
		let released = false;
		return Object.freeze({
			timingBySourceId,
			release(): boolean {
				if (released) return false;
				released = true;
				let restored = false;
				for (let index = leases.length - 1; index >= 0; index -= 1) {
					restored = leases[index]!.release() || restored;
				}
				return restored;
			},
		});
	} catch (error) {
		for (let index = leases.length - 1; index >= 0; index -= 1) leases[index]?.release();
		throw error;
	}
}

function selectVisibleVideoSources(
	projectValue: unknown,
	dependencies: VideoExportTimingDependencies,
	requiredSourceIds: readonly string[] | null,
): readonly DataRecord[] {
	const project = projectTrackFolderMediaStateV12(record(projectValue, 'video export project'));
	if (!Array.isArray(project.tracks)) throw new TypeError('The video export project requires tracks.');
	const sources: DataRecord[] = [];
	const seen = new Set<string>();
	const visibleVideoTrack = createVisibleVideoTrackPredicate(project.tracks);
	for (const trackValue of project.tracks) {
		const track = record(trackValue, 'video export track');
		if (!visibleVideoTrack(track) || !Array.isArray(track.clipIds)) continue;
		for (const clipId of track.clipIds) {
			if (typeof clipId !== 'string' || !clipId) continue;
			const clipValue = dependencies.findClip(project, clipId);
			if (!clipValue || typeof clipValue !== 'object') continue;
			const clip = record(clipValue, 'video export clip');
			if (clip.kind !== 'video' || typeof clip.sourceId !== 'string') continue;
			const sourceValue = dependencies.findSource(project, clip.sourceId);
			if (!sourceValue || typeof sourceValue !== 'object') continue;
			const source = snapshotTimingSource(record(sourceValue, 'video export source'));
			if (source.kind !== 'video') continue;
			const key = stringId(source.id, 'video export source.id');
			if (seen.has(key)) continue;
			seen.add(key);
			sources.push(source);
		}
	}
	if (requiredSourceIds === null) return Object.freeze(sources);
	const byId = new Map(sources.map((source) => [String(source.id), source]));
	return Object.freeze(requiredSourceIds.map((sourceId) => {
		const source = byId.get(sourceId);
		if (!source) throw new ReferenceError(`Required video source ${sourceId} is not an active visible source.`);
		return source;
	}));
}

function normalizeRequiredSourceIds(value: readonly string[] | undefined): readonly string[] | null {
	if (value === undefined) return null;
	if (!Array.isArray(value) || value.length > 4_096) {
		throw new RangeError('requiredSourceIds must be a bounded array.');
	}
	const result: string[] = [];
	const seen = new Set<string>();
	for (const [index, sourceIdValue] of value.entries()) {
		const sourceId = stringId(sourceIdValue, `requiredSourceIds[${String(index)}]`);
		if (seen.has(sourceId)) throw new RangeError(`Duplicate required video source ID ${sourceId}.`);
		seen.add(sourceId);
		result.push(sourceId);
	}
	return Object.freeze(result);
}

function snapshotTimingSource(source: DataRecord): DataRecord {
	const snapshot: Record<string, unknown> = {
		id: source.id,
		kind: source.kind,
		contentSha256: source.contentSha256,
	};
	for (const field of ['frameRate', 'sourceFrameCount', 'timingAsset', 'timingDecision'] as const) {
		if (Object.hasOwn(source, field)) snapshot[field] = structuredClone(source[field]);
	}
	return deepFreeze(snapshot);
}

function assertTimingLoadCurrent(options: VideoExportTimingOptions): void {
	if (options.signal?.aborted) {
		if (options.signal.reason !== undefined) throw options.signal.reason;
		throw new DOMException('Video timing acquisition was cancelled.', 'AbortError');
	}
	options.assertCurrent();
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function recordMode(value: unknown): unknown {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as DataRecord).mode
		: undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function stringId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError(`${name} must be a bounded non-empty string.`);
	}
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return value;
}

function rationalRate(value: unknown, name: string): Readonly<{ num: number; den: number }> {
	const rate = record(value, name);
	const num = positiveSafeInteger(rate.num, `${name}.num`);
	const den = positiveSafeInteger(rate.den, `${name}.den`);
	return Object.freeze({ num, den });
}

function deepFreeze<Value>(value: Value): Value {
	if (!value || typeof value !== 'object') return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.isFrozen(value) ? value : Object.freeze(value);
}
