/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectStorageProfileNames,
	type EditorProjectStorageProfile,
} from './project-storage-profile.ts';
import {
	editorProjectStorageProfileFromOptions,
} from './project-storage-profile-options.ts';

export type EditorProjectStoreIdentity = object;

const PROJECT_STORE_PROFILES = new WeakMap<object, EditorProjectStorageProfile | undefined>();

/** Resolve an optional profile and bind it before the caller touches any store option. */
export function bindEditorProjectStoreProfileFromOptions<Store extends EditorProjectStoreIdentity>(
	store: Store,
	options: unknown,
): ReturnType<typeof editorProjectStorageProfileFromOptions> {
	const resolved = editorProjectStorageProfileFromOptions(options);
	bindEditorProjectStoreProfile(store, resolved.profile);
	return resolved;
}

/** Register a store identity before its repositories or backends are constructed. */
export function bindEditorProjectStoreProfile<Store extends EditorProjectStoreIdentity>(
	store: Store,
	profile: EditorProjectStorageProfile | undefined,
): Store {
	if (profile !== undefined) editorProjectStorageProfileNames(profile);
	if (PROJECT_STORE_PROFILES.has(store)) {
		if (PROJECT_STORE_PROFILES.get(store) !== profile) {
			throw new TypeError('An editor project store profile cannot be rebound.');
		}
		return store;
	}
	PROJECT_STORE_PROFILES.set(store, profile);
	return store;
}

/** Read only a binding installed by the generic store constructor. */
export function editorProjectStoreProfile(
	store: unknown,
): EditorProjectStorageProfile | undefined {
	if (!PROJECT_STORE_PROFILES.has(store as object)) {
		throw new TypeError('An authentic editor project store is required.');
	}
	return PROJECT_STORE_PROFILES.get(store as object);
}

/** Require exact opaque profile identity without inspecting the candidate store. */
export function assertEditorProjectStoreProfile(
	store: unknown,
	profile: EditorProjectStorageProfile,
): void {
	editorProjectStorageProfileNames(profile);
	if (!PROJECT_STORE_PROFILES.has(store as object)) {
		throw new TypeError('An authentic editor project store is required.');
	}
	if (PROJECT_STORE_PROFILES.get(store as object) !== profile) {
		throw new TypeError('The exact bound editor project storage profile is required.');
	}
}
