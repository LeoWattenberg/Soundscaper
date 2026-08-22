/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	createFramescaperCandidateProjectStore,
	framescaperCandidateProjectStoreAuthority,
	type FramescaperCandidateProjectStoreOptions,
} from './editor-project-candidate-store.ts';
import { FramescaperProjectRepositoryV24 } from './editor-project-repository-v24.ts';
import {
	FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
	assertFramescaperProjectV24CandidateProfile,
} from './editor-project-runtime-profile-v24.ts';
import { FRAMESCAPER_V24_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v24.ts';

const DEFINITION = Object.freeze({
	generation: 'V24', token: Object.freeze({}), profile: FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
	authenticate: assertFramescaperProjectV24CandidateProfile,
	storageProfile: FRAMESCAPER_V24_PROJECT_STORAGE_PROFILE,
	repository: (profile: unknown, delegate: ConstructorParameters<typeof FramescaperProjectRepositoryV24>[1]) => (
		new FramescaperProjectRepositoryV24(profile, delegate)
	),
});

export function createFramescaperProjectStoreV24(
	profile: unknown,
	options: FramescaperCandidateProjectStoreOptions | unknown = {},
): AudioEditorProjectStore {
	assertFramescaperProjectV24CandidateProfile(profile);
	return createFramescaperCandidateProjectStore(DEFINITION, options);
}

export function framescaperProjectStoreAuthorityV24(profile: unknown, store: unknown) {
	assertFramescaperProjectV24CandidateProfile(profile);
	return framescaperCandidateProjectStoreAuthority(DEFINITION, store);
}
