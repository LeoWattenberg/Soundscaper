/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { editorProjectRuntimeProfileDefinition } from '../common/editor/project-runtime-profile.ts';
import {
	editorProjectRuntimeProfilePrerequisiteDefinition,
} from '../common/editor/project-runtime-profile-prerequisite.ts';
import type { EditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';
import {
	assertEditorProjectStoreProfile,
} from '../common/editor/storage/project-store-profile-binding.ts';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import {
	AudioEditorProjectStore,
	createProjectStore,
} from '../common/editor/storage.js';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';

const AUTHORITY_FIELDS = ['projectStorageProfile', 'databaseName', 'store'] as const;

export interface FramescaperProjectStoreV18Options extends AudioEditorProjectStoreOptions {
	readonly store?: AudioEditorProjectStore;
}

/** Construct or authenticate the isolated store after exact runtime admission. */
export function createFramescaperProjectStoreV18(
	profile: EditorProjectRuntimeProfile | unknown,
	options: FramescaperProjectStoreV18Options | unknown = {},
): AudioEditorProjectStore {
	assertFramescaperProjectV18Profile(profile);
	const storageProfile = storageProfileFor(profile);
	const authority = snapshotAuthorities(options);
	if (authority.projectStorageProfile.present
		&& authority.projectStorageProfile.value !== storageProfile) {
		throw new TypeError('The exact Framescaper V18 project storage profile is required.');
	}
	if (authority.databaseName.present) {
		throw new TypeError('databaseName cannot be combined with the Framescaper V18 storage profile.');
	}
	if (authority.store.present) {
		assertEditorProjectStoreProfile(authority.store.value, storageProfile);
		return authority.store.value as AudioEditorProjectStore;
	}
	return createProjectStore({
		...(options as AudioEditorProjectStoreOptions),
		projectStorageProfile: storageProfile,
	});
}

function storageProfileFor(profile: EditorProjectRuntimeProfile): EditorProjectStorageProfile {
	const runtime = editorProjectRuntimeProfileDefinition(profile);
	return editorProjectRuntimeProfilePrerequisiteDefinition(
		runtime.prerequisite,
	).storageProfile;
}

interface AuthorityValue {
	readonly present: boolean;
	readonly value: unknown;
}

function snapshotAuthorities(
	value: unknown,
): Readonly<Record<(typeof AUTHORITY_FIELDS)[number], AuthorityValue>> {
	const candidate = value !== null && (typeof value === 'object' || typeof value === 'function')
		? value
		: {};
	const output = Object.create(null) as Record<(typeof AUTHORITY_FIELDS)[number], AuthorityValue>;
	for (const field of AUTHORITY_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, field);
		if (descriptor && !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${field} must be an own data property.`);
		}
		output[field] = Object.freeze({
			present: descriptor !== undefined,
			value: descriptor?.value,
		});
	}
	return Object.freeze(output);
}
