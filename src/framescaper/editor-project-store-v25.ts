/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	createFramescaperCandidateProjectStore,
	framescaperCandidateProjectStoreAuthority,
	type FramescaperCandidateProjectStoreOptions,
} from './editor-project-candidate-store.ts';
import { FramescaperProjectRepositoryV25 } from './editor-project-repository-v25.ts';
import {
	FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE,
	assertFramescaperProjectV25CandidateProfile,
} from './editor-project-runtime-profile-v25.ts';
import { FRAMESCAPER_V25_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v25.ts';

const DEFINITION = Object.freeze({
	generation: 'V25', token: Object.freeze({}), profile: FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE,
	authenticate: assertFramescaperProjectV25CandidateProfile,
	storageProfile: FRAMESCAPER_V25_PROJECT_STORAGE_PROFILE,
	repository: (profile: unknown, delegate: ConstructorParameters<typeof FramescaperProjectRepositoryV25>[1]) => (
		new FramescaperProjectRepositoryV25(profile, delegate)
	),
});

export function createFramescaperProjectStoreV25(
	profile: unknown,
	options: FramescaperCandidateProjectStoreOptions | unknown = {},
): AudioEditorProjectStore {
	assertFramescaperProjectV25CandidateProfile(profile);
	return createFramescaperCandidateProjectStore(DEFINITION, options);
}

export function framescaperProjectStoreAuthorityV25(profile: unknown, store: unknown) {
	assertFramescaperProjectV25CandidateProfile(profile);
	return framescaperCandidateProjectStoreAuthority(DEFINITION, store);
}
