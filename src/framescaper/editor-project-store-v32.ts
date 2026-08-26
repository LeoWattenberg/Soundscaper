/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	createFramescaperCandidateProjectStore,
	framescaperCandidateProjectStoreAuthority,
	type FramescaperCandidateProjectStoreAuthority,
	type FramescaperCandidateProjectStoreOptions,
} from './editor-project-candidate-store.ts';
import { FramescaperProjectRepositoryV32 } from './editor-project-repository-v32.ts';
import { assertFramescaperProjectV32Profile } from './editor-project-runtime-profile-v32.ts';
import { FRAMESCAPER_V32_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v32.ts';
import {
	FramescaperTimelineImagePublisherV32,
	type FramescaperTimelineImagePublicationStoreV32,
} from './editor-timeline-image-publication-v32.ts';

const TOKEN = Object.freeze({});
const DEFINITION = Object.freeze({
	generation: 'V32',
	token: TOKEN,
	profile: null as unknown,
	authenticate: assertFramescaperProjectV32Profile,
	storageProfile: FRAMESCAPER_V32_PROJECT_STORAGE_PROFILE,
	repository: (profile: unknown, delegate: ConstructorParameters<typeof FramescaperProjectRepositoryV32>[1]) => (
		new FramescaperProjectRepositoryV32(profile, delegate)
	),
});

export interface FramescaperProjectStoreAuthorityV32 extends FramescaperCandidateProjectStoreAuthority {
	readonly timelineImages: FramescaperTimelineImagePublisherV32;
}

const AUTHORITIES = new WeakMap<AudioEditorProjectStore, FramescaperProjectStoreAuthorityV32>();

export function createFramescaperProjectStoreV32(
	profile: unknown,
	options: FramescaperCandidateProjectStoreOptions | unknown = {},
): AudioEditorProjectStore {
	assertFramescaperProjectV32Profile(profile);
	return createFramescaperCandidateProjectStore({ ...DEFINITION, profile }, options);
}

/** Internal authority includes the only body-plus-project image publication seam. */
export function framescaperProjectStoreAuthorityV32(
	profile: unknown,
	store: unknown,
): Readonly<FramescaperProjectStoreAuthorityV32> {
	assertFramescaperProjectV32Profile(profile);
	const base = framescaperCandidateProjectStoreAuthority({ ...DEFINITION, profile }, store);
	const exactStore = store as AudioEditorProjectStore;
	const existing = AUTHORITIES.get(exactStore);
	if (existing) return existing;
	const authority = Object.freeze({
		...base,
		timelineImages: new FramescaperTimelineImagePublisherV32(profile, {
			port: base.port,
			store: exactStore as unknown as FramescaperTimelineImagePublicationStoreV32,
		}),
	});
	AUTHORITIES.set(exactStore, authority);
	return authority;
}
