/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	createFramescaperCandidateProjectStore,
	framescaperCandidateProjectStoreAuthority,
	type FramescaperCandidateProjectStoreOptions,
} from './editor-project-candidate-store.ts';
import { FramescaperProjectRepositoryV27 } from './editor-project-repository-v27.ts';
import { assertFramescaperProjectV27Profile } from './editor-project-runtime-profile-v27.ts';
import { FRAMESCAPER_V27_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v27.ts';

const DEFINITION = Object.freeze({
	generation: 'V27',
	token: Object.freeze({}),
	profile: null as unknown,
	authenticate: assertFramescaperProjectV27Profile,
	storageProfile: FRAMESCAPER_V27_PROJECT_STORAGE_PROFILE,
	repository: (profile: unknown, delegate: ConstructorParameters<typeof FramescaperProjectRepositoryV27>[1]) => (
		new FramescaperProjectRepositoryV27(profile, delegate)
	),
});

export function createFramescaperProjectStoreV27(
	profile: unknown,
	options: FramescaperCandidateProjectStoreOptions | unknown = {},
): AudioEditorProjectStore {
	assertFramescaperProjectV27Profile(profile);
	return createFramescaperCandidateProjectStore({ ...DEFINITION, profile }, options);
}

export function framescaperProjectStoreAuthorityV27(profile: unknown, store: unknown) {
	assertFramescaperProjectV27Profile(profile);
	return framescaperCandidateProjectStoreAuthority({ ...DEFINITION, profile }, store);
}
