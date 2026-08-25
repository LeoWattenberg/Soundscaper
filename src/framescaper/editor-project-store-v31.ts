/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	createFramescaperCandidateProjectStore,
	framescaperCandidateProjectStoreAuthority,
	type FramescaperCandidateProjectStoreOptions,
} from './editor-project-candidate-store.ts';
import { FramescaperProjectRepositoryV31 } from './editor-project-repository-v31.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import { FRAMESCAPER_V31_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v31.ts';

const DEFINITION = Object.freeze({
	generation: 'F31',
	token: Object.freeze({}),
	profile: null as unknown,
	authenticate: assertFramescaperProjectV31Profile,
	storageProfile: FRAMESCAPER_V31_PROJECT_STORAGE_PROFILE,
	repository: (profile: unknown, delegate: ConstructorParameters<typeof FramescaperProjectRepositoryV31>[1]) => (
		new FramescaperProjectRepositoryV31(profile, delegate)
	),
});

export function createFramescaperProjectStoreV31(
	profile: unknown,
	options: FramescaperCandidateProjectStoreOptions | unknown = {},
): AudioEditorProjectStore {
	assertFramescaperProjectV31Profile(profile);
	return createFramescaperCandidateProjectStore({ ...DEFINITION, profile }, options);
}

export function framescaperProjectStoreAuthorityV31(profile: unknown, store: unknown) {
	assertFramescaperProjectV31Profile(profile);
	return framescaperCandidateProjectStoreAuthority({ ...DEFINITION, profile }, store);
}
