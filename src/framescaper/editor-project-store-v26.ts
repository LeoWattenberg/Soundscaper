/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	createFramescaperCandidateProjectStore,
	framescaperCandidateProjectStoreAuthority,
	type FramescaperCandidateProjectStoreOptions,
} from './editor-project-candidate-store.ts';
import { FramescaperProjectRepositoryV26 } from './editor-project-repository-v26.ts';
import {
	FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE,
	assertFramescaperProjectV26CandidateProfile,
} from './editor-project-runtime-profile-v26.ts';
import { FRAMESCAPER_V26_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v26.ts';

const DEFINITION = Object.freeze({
	generation: 'V26', token: Object.freeze({}), profile: FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE,
	authenticate: assertFramescaperProjectV26CandidateProfile,
	storageProfile: FRAMESCAPER_V26_PROJECT_STORAGE_PROFILE,
	repository: (profile: unknown, delegate: ConstructorParameters<typeof FramescaperProjectRepositoryV26>[1]) => (
		new FramescaperProjectRepositoryV26(profile, delegate)
	),
});

export function createFramescaperProjectStoreV26(
	profile: unknown,
	options: FramescaperCandidateProjectStoreOptions | unknown = {},
): AudioEditorProjectStore {
	assertFramescaperProjectV26CandidateProfile(profile);
	return createFramescaperCandidateProjectStore(DEFINITION, options);
}

export function framescaperProjectStoreAuthorityV26(profile: unknown, store: unknown) {
	assertFramescaperProjectV26CandidateProfile(profile);
	return framescaperCandidateProjectStoreAuthority(DEFINITION, store);
}
