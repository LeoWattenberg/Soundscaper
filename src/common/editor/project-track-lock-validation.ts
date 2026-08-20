/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ProjectTrackLock extends Readonly<Record<string, unknown>> {
	readonly locked: boolean;
}

export interface ProjectTrackLockDocument extends Readonly<Record<string, unknown>> {
	readonly tracks: readonly ProjectTrackLock[];
}

/** Validate the editorial lock carried by every track in the current document. */
export function validateProjectTrackLocks(
	project: unknown,
): asserts project is ProjectTrackLockDocument {
	const candidate = dataRecord(project, 'project');
	const tracks = dataArray(candidate, 'tracks', 'project');
	for (const [index, value] of tracks.entries()) {
		const name = `project.tracks[${String(index)}]`;
		const track = dataRecord(value, name);
		const descriptor = Object.getOwnPropertyDescriptor(track, 'locked');
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.locked must be an own enumerable data property.`);
		}
		if (typeof descriptor.value !== 'boolean') {
			throw new TypeError(`${name}.locked must be boolean.`);
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
