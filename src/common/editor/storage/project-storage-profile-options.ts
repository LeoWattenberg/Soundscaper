/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectStorageProfileNames,
	type EditorProjectStorageProfile,
	type EditorProjectStorageProfileNames,
} from './project-storage-profile.ts';

export interface EditorProjectStorageProfileOption {
	readonly profile: EditorProjectStorageProfile | undefined;
	readonly names: Readonly<EditorProjectStorageProfileNames> | null;
}

/** Resolve an optional opaque profile before project-store construction has side effects. */
export function editorProjectStorageProfileFromOptions(
	options: unknown,
): Readonly<EditorProjectStorageProfileOption> {
	if (options === null || (typeof options !== 'object' && typeof options !== 'function')) {
		return { profile: undefined, names: null };
	}
	const descriptor = Object.getOwnPropertyDescriptor(options, 'projectStorageProfile');
	if (!descriptor) return { profile: undefined, names: null };
	if (!Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('projectStorageProfile must be an own data property.');
	}
	const profile = descriptor.value as EditorProjectStorageProfile | undefined;
	if (profile === undefined) return { profile, names: null };
	const names = editorProjectStorageProfileNames(profile);
	if (Object.hasOwn(options, 'databaseName')) {
		throw new TypeError('databaseName cannot be combined with a project storage profile.');
	}
	return { profile, names };
}
