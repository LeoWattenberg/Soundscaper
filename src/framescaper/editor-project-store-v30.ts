/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	createFramescaperCandidateProjectStore,
	framescaperCandidateProjectStoreAuthority,
	type FramescaperCandidateProjectStoreAuthority,
	type FramescaperCandidateProjectStoreOptions,
} from './editor-project-candidate-store.ts';
import { FramescaperProjectRepositoryV30 } from './editor-project-repository-v30.ts';
import { assertFramescaperProjectV30Profile } from './editor-project-runtime-profile-v30.ts';
import { FRAMESCAPER_V30_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v30.ts';
import {
	FramescaperTimelineImagePublisherV30,
	type FramescaperTimelineImagePublicationStoreV30,
} from './editor-timeline-image-publication-v30.ts';

const TOKEN = Object.freeze({});
const DEFINITION = Object.freeze({
	generation: 'V30',
	token: TOKEN,
	profile: null as unknown,
	authenticate: assertFramescaperProjectV30Profile,
	storageProfile: FRAMESCAPER_V30_PROJECT_STORAGE_PROFILE,
	repository: (profile: unknown, delegate: ConstructorParameters<typeof FramescaperProjectRepositoryV30>[1]) => (
		new FramescaperProjectRepositoryV30(profile, delegate)
	),
});

export interface FramescaperProjectStoreAuthorityV30 extends FramescaperCandidateProjectStoreAuthority {
	readonly timelineImages: FramescaperTimelineImagePublisherV30;
}

const AUTHORITIES = new WeakMap<AudioEditorProjectStore, FramescaperProjectStoreAuthorityV30>();

export function createFramescaperProjectStoreV30(
	profile: unknown,
	options: FramescaperCandidateProjectStoreOptions | unknown = {},
): AudioEditorProjectStore {
	assertFramescaperProjectV30Profile(profile);
	return createFramescaperCandidateProjectStore({ ...DEFINITION, profile }, options);
}

/** Internal authority includes the only body-plus-project image publication seam. */
export function framescaperProjectStoreAuthorityV30(
	profile: unknown,
	store: unknown,
): Readonly<FramescaperProjectStoreAuthorityV30> {
	assertFramescaperProjectV30Profile(profile);
	const base = framescaperCandidateProjectStoreAuthority({ ...DEFINITION, profile }, store);
	const exactStore = store as AudioEditorProjectStore;
	const existing = AUTHORITIES.get(exactStore);
	if (existing) return existing;
	const authority = Object.freeze({
		...base,
		timelineImages: new FramescaperTimelineImagePublisherV30(profile, {
			port: base.port,
			store: exactStore as unknown as FramescaperTimelineImagePublicationStoreV30,
		}),
	});
	AUTHORITIES.set(exactStore, authority);
	return authority;
}
