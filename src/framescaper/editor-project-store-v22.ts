/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	createFramescaperCandidateProjectStore,
	framescaperCandidateProjectStoreAuthority,
	type FramescaperCandidateProjectStoreOptions,
} from './editor-project-candidate-store.ts';
import { FramescaperProjectRepositoryV22 } from './editor-project-repository-v22.ts';
import {
	FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE,
	assertFramescaperProjectV22CandidateProfile,
} from './editor-project-runtime-profile-v22.ts';
import { FRAMESCAPER_V22_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v22.ts';

const DEFINITION = Object.freeze({
	generation: 'V22', token: Object.freeze({}), profile: FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE,
	authenticate: assertFramescaperProjectV22CandidateProfile,
	storageProfile: FRAMESCAPER_V22_PROJECT_STORAGE_PROFILE,
	repository: (profile: unknown, delegate: ConstructorParameters<typeof FramescaperProjectRepositoryV22>[1]) => (
		new FramescaperProjectRepositoryV22(profile, delegate)
	),
});

export function createFramescaperProjectStoreV22(
	profile: unknown,
	options: FramescaperCandidateProjectStoreOptions | unknown = {},
): AudioEditorProjectStore {
	assertFramescaperProjectV22CandidateProfile(profile);
	return createFramescaperCandidateProjectStore(DEFINITION, options);
}

export function framescaperProjectStoreAuthorityV22(profile: unknown, store: unknown) {
	assertFramescaperProjectV22CandidateProfile(profile);
	return framescaperCandidateProjectStoreAuthority(DEFINITION, store);
}
