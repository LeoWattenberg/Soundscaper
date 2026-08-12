/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectStorageProfileNames,
	type EditorProjectStorageProfileNames,
} from './project-storage-profile.ts';

/** Resolve an optional opaque profile before project-store construction has side effects. */
export function editorProjectStorageProfileNamesFromOptions(
	options: unknown,
): Readonly<EditorProjectStorageProfileNames> | null {
	if (options === null || (typeof options !== 'object' && typeof options !== 'function')) return null;
	const descriptor = Object.getOwnPropertyDescriptor(options, 'projectStorageProfile');
	if (!descriptor) return null;
	if (!Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('projectStorageProfile must be an own data property.');
	}
	const profile = descriptor.value;
	if (profile === undefined) return null;
	const names = editorProjectStorageProfileNames(profile);
	if (Object.hasOwn(options, 'databaseName')) {
		throw new TypeError('databaseName cannot be combined with a project storage profile.');
	}
	return names;
}
