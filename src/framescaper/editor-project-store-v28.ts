/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	createFramescaperCandidateProjectStore,
	framescaperCandidateProjectStoreAuthority,
	type FramescaperCandidateProjectStoreOptions,
} from './editor-project-candidate-store.ts';
import { FramescaperProjectRepositoryV28 } from './editor-project-repository-v28.ts';
import { assertFramescaperProjectV28Profile } from './editor-project-runtime-profile-v28.ts';
import { FRAMESCAPER_V28_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v28.ts';

const DEFINITION = Object.freeze({
	generation: 'V28',
	token: Object.freeze({}),
	profile: null as unknown,
	authenticate: assertFramescaperProjectV28Profile,
	storageProfile: FRAMESCAPER_V28_PROJECT_STORAGE_PROFILE,
	repository: (profile: unknown, delegate: ConstructorParameters<typeof FramescaperProjectRepositoryV28>[1]) => (
		new FramescaperProjectRepositoryV28(profile, delegate)
	),
});

export function createFramescaperProjectStoreV28(
	profile: unknown,
	options: FramescaperCandidateProjectStoreOptions | unknown = {},
): AudioEditorProjectStore {
	assertFramescaperProjectV28Profile(profile);
	return createFramescaperCandidateProjectStore({ ...DEFINITION, profile }, options);
}

export function framescaperProjectStoreAuthorityV28(profile: unknown, store: unknown) {
	assertFramescaperProjectV28Profile(profile);
	return framescaperCandidateProjectStoreAuthority({ ...DEFINITION, profile }, store);
}
