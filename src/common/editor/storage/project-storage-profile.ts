/* SPDX-License-Identifier: AGPL-3.0-only */

export interface EditorProjectStorageProfileNames {
	readonly databaseName: string;
	readonly opfsDirectoryName: string;
	readonly opfsWorkerName: string;
	readonly projectLockPrefix: string;
}

declare const editorProjectStorageProfileIdentity: unique symbol;

export type EditorProjectStorageProfile = Readonly<{
	readonly [editorProjectStorageProfileIdentity]: true;
}>;

const NAME_FIELDS = [
	'databaseName',
	'opfsDirectoryName',
	'opfsWorkerName',
	'projectLockPrefix',
] as const;
const STORAGE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u;
const PROJECT_LOCK_PREFIX = /^[a-z0-9](?:[a-z0-9-]{0,125}[a-z0-9])?:$/u;
const PROFILE_NAMES = new WeakMap<
	EditorProjectStorageProfile,
	Readonly<EditorProjectStorageProfileNames>
>();

export function createEditorProjectStorageProfile(
	names: unknown,
): EditorProjectStorageProfile {
	const snapshot = snapshotProfileNames(names);
	const profile = Object.freeze(Object.create(null)) as EditorProjectStorageProfile;
	PROFILE_NAMES.set(profile, snapshot);
	return profile;
}

export function editorProjectStorageProfileNames(
	profile: unknown,
): Readonly<EditorProjectStorageProfileNames> {
	const names = PROFILE_NAMES.get(profile as EditorProjectStorageProfile);
	if (!names) throw new TypeError('An authentic editor project storage profile is required.');
	return names;
}

function snapshotProfileNames(value: unknown): Readonly<EditorProjectStorageProfileNames> {
	if (value === null || typeof value !== 'object') {
		throw new TypeError('Editor project storage profile names must be a plain record.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Editor project storage profile names must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== NAME_FIELDS.length || keys.some(
		(key) => typeof key !== 'string' || !NAME_FIELDS.includes(key as (typeof NAME_FIELDS)[number]),
	)) {
		throw new TypeError('Editor project storage profile names have missing or unsupported fields.');
	}
	const snapshot = Object.create(null) as Record<(typeof NAME_FIELDS)[number], unknown>;
	for (const field of NAME_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Editor project storage profile ${field} must be an own enumerable data property, not an accessor.`);
		}
		snapshot[field] = descriptor.value;
	}
	return Object.freeze({
		databaseName: storageName(snapshot.databaseName, 'databaseName'),
		opfsDirectoryName: storageName(snapshot.opfsDirectoryName, 'opfsDirectoryName'),
		opfsWorkerName: storageName(snapshot.opfsWorkerName, 'opfsWorkerName'),
		projectLockPrefix: projectLockPrefix(snapshot.projectLockPrefix),
	});
}

function storageName(value: unknown, field: string): string {
	if (typeof value !== 'string' || !STORAGE_NAME.test(value)) {
		throw new TypeError(`Editor project storage profile ${field} is invalid.`);
	}
	return value;
}

function projectLockPrefix(value: unknown): string {
	if (typeof value !== 'string' || !PROJECT_LOCK_PREFIX.test(value)) {
		throw new TypeError('Editor project storage profile projectLockPrefix is invalid.');
	}
	return value;
}
