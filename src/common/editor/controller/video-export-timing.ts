/* SPDX-License-Identifier: AGPL-3.0-only */

import { loadVideoTimingAsset } from '../video-timing-storage.ts';
import {
	acquireVideoTimingIndex,
	type VideoTimingIndexLease,
} from '../video-source-time.ts';

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
}

/** Acquire every verified timing index required by synchronous video planning. */
export async function acquireVideoExportTimingIndexes(
	projectValue: unknown,
	store: VideoExportTimingStore,
	dependencies: VideoExportTimingDependencies,
	options: VideoExportTimingOptions,
): Promise<VideoTimingIndexLease> {
	const sources = visibleTimedVideoSources(projectValue, dependencies);
	const indexes: Array<Readonly<{
		source: DataRecord;
		index: NonNullable<Awaited<ReturnType<typeof loadVideoTimingAsset>>['index']>;
	}>> = [];
	for (const source of sources) {
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
	}
	const leases: VideoTimingIndexLease[] = [];
	try {
		for (const { source, index } of indexes) {
			leases.push(acquireVideoTimingIndex(source, index));
		}
	} catch (error) {
		for (let index = leases.length - 1; index >= 0; index -= 1) leases[index]?.release();
		throw error;
	}
	let released = false;
	return Object.freeze({
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
}

function visibleTimedVideoSources(
	projectValue: unknown,
	dependencies: VideoExportTimingDependencies,
): readonly DataRecord[] {
	const project = record(projectValue, 'video export project');
	if (!Array.isArray(project.tracks)) throw new TypeError('The video export project requires tracks.');
	const sources: DataRecord[] = [];
	const seen = new Set<string>();
	for (const trackValue of project.tracks) {
		const track = record(trackValue, 'video export track');
		if (track.type !== 'video' || track.hidden === true || !Array.isArray(track.clipIds)) continue;
		for (const clipId of track.clipIds) {
			if (typeof clipId !== 'string' || !clipId) continue;
			const clipValue = dependencies.findClip(projectValue, clipId);
			if (!clipValue || typeof clipValue !== 'object') continue;
			const clip = record(clipValue, 'video export clip');
			if (clip.kind !== 'video' || typeof clip.sourceId !== 'string') continue;
			const sourceValue = dependencies.findSource(projectValue, clip.sourceId);
			if (!sourceValue || typeof sourceValue !== 'object') continue;
			const source = record(sourceValue, 'video export source');
			if (source.kind !== 'video') continue;
			if (source.timingAsset == null) {
				if (recordMode(source.timingDecision) === 'exact') {
					throw new Error('An exact-timing video source is missing its timing asset.');
				}
				continue;
			}
			const key = `${String(source.id)}:${String(source.contentSha256)}`;
			if (seen.has(key)) continue;
			seen.add(key);
			sources.push(source);
		}
	}
	return Object.freeze(sources);
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
