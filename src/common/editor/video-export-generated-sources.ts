/* SPDX-License-Identifier: AGPL-3.0-only */
import type { VideoKeyframeOfflineSourceResolver } from './video-keyframe-offline-rgba-source.ts';

/** Injected product authority; these capabilities never enter persisted project intent. */
export interface VideoExportGeneratedSources {
	readonly sourceIds: readonly string[];
	readonly resolveSource: VideoKeyframeOfflineSourceResolver;
}
export function snapshotVideoExportGeneratedSources(value: unknown): VideoExportGeneratedSources | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).length !== 2
		|| !Object.hasOwn(value, 'sourceIds') || !Object.hasOwn(value, 'resolveSource')) throw new TypeError('Generated video sources require a closed capability record.');
	const ids = data(value, 'sourceIds'); const resolveSource = data(value, 'resolveSource');
	if (typeof resolveSource !== 'function' || !Array.isArray(ids) || Object.getPrototypeOf(ids) !== Array.prototype
		|| ids.length > 4096 || Reflect.ownKeys(ids).length !== ids.length + 1) throw new TypeError('Generated video sources require bounded data IDs and a resolver.');
	const sourceIds: string[] = [];
	for (let index = 0; index < ids.length; index++) {
		const id = data(ids, String(index));
		if (typeof id !== 'string' || id.length < 1 || id.length > 256) throw new TypeError('Generated video source ID is invalid.');
		if (sourceIds.includes(id)) throw new RangeError('Duplicate generated video source ID.');
		sourceIds.push(id);
	}
	return Object.freeze({ sourceIds: Object.freeze(sourceIds), resolveSource: resolveSource as VideoKeyframeOfflineSourceResolver });
}
function data(value: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Generated video capabilities require own enumerable data properties.');
	return descriptor.value;
}
