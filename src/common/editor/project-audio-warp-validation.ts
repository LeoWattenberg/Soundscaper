/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAudioWarpMapForClip } from './audio-warp-clip-authority.ts';

/** Current native warp state must be consumable by the exact audio runtime. */
export function validateProjectAudioWarpRuntimeAuthority(project: unknown): void {
	const candidate = dataRecord(project, 'project');
	const runtimeProject = candidate as unknown as Parameters<typeof normalizeAudioWarpMapForClip>[0];
	validateClipCollection(
		dataArray(candidate, 'clips', 'project'),
		'project.clips',
		'native',
		runtimeProject,
	);
	const projectBin = dataRecord(dataValue(candidate, 'projectBin', 'project'), 'project.projectBin');
	validateClipCollection(
		dataArray(projectBin, 'clips', 'project.projectBin'),
		'project.projectBin.clips',
		'insertable',
		runtimeProject,
	);
}

function validateClipCollection(
	clips: readonly unknown[],
	name: string,
	authority: 'native' | 'insertable',
	runtimeProject: Parameters<typeof normalizeAudioWarpMapForClip>[0],
): void {
	for (const [index, value] of clips.entries()) {
		const clip = dataRecord(value, `${name}[${String(index)}]`);
		if (clip.kind !== 'audio' || clip.warpMap == null) continue;
		try {
			normalizeAudioWarpMapForClip(
				runtimeProject,
				clip as unknown as Parameters<typeof normalizeAudioWarpMapForClip>[1],
				clip.warpMap,
			);
		} catch (error) {
			throw new RangeError(
				`${name}[${String(index)}].warpMap is not valid ${authority} runtime authority.`,
				{ cause: error },
			);
		}
	}
}

function dataArray(
	value: Record<string, unknown>,
	key: string,
	name: string,
): readonly unknown[] {
	const candidate = dataValue(value, key, name);
	if (!Array.isArray(candidate)) throw new TypeError(`${name}.${key} must be an array.`);
	return candidate;
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function dataValue(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}
