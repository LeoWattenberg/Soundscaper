/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	createFramescaperCandidateProjectStore,
	framescaperCandidateProjectStoreAuthority,
	type FramescaperCandidateProjectStoreAuthority,
	type FramescaperCandidateProjectStoreOptions,
} from './editor-project-candidate-store.ts';
import { applyFramescaperProjectCommandV31 } from './editor-project-v31-commands.ts';
import { FramescaperProjectRepositoryV31 } from './editor-project-repository-v31.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import { FRAMESCAPER_V31_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v31.ts';
import { cloneFramescaperProjectV31 } from './editor-project-v31.ts';
import {
	FramescaperTimelineImagePublisherV30,
	type FramescaperTimelineImageProjectCodecV30,
	type FramescaperTimelineImagePublicationStoreV30,
} from './editor-timeline-image-publication-v30.ts';

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

const IMAGE_PROJECT_CODEC: FramescaperTimelineImageProjectCodecV30 = Object.freeze({
	authenticate: assertFramescaperProjectV31Profile,
	clone: (profile: unknown, project: unknown) => cloneFramescaperProjectV31(profile, project) as never,
	apply: (
		profile: unknown,
		project: unknown,
		command: unknown,
		options: Readonly<{ readonly now?: Date | string }>,
	) => (
		applyFramescaperProjectCommandV31(profile, project, command, options) as never
	),
});

export interface FramescaperProjectStoreAuthorityV31 extends FramescaperCandidateProjectStoreAuthority {
	readonly timelineImages: FramescaperTimelineImagePublisherV30;
}

const AUTHORITIES = new WeakMap<AudioEditorProjectStore, FramescaperProjectStoreAuthorityV31>();

export function createFramescaperProjectStoreV31(
	profile: unknown,
	options: FramescaperCandidateProjectStoreOptions | unknown = {},
): AudioEditorProjectStore {
	assertFramescaperProjectV31Profile(profile);
	return createFramescaperCandidateProjectStore({ ...DEFINITION, profile }, options);
}

export function framescaperProjectStoreAuthorityV31(profile: unknown, store: unknown) {
	assertFramescaperProjectV31Profile(profile);
	const base = framescaperCandidateProjectStoreAuthority({ ...DEFINITION, profile }, store);
	const exactStore = store as AudioEditorProjectStore;
	const existing = AUTHORITIES.get(exactStore);
	if (existing) return existing;
	const authority = Object.freeze({
		...base,
		timelineImages: new FramescaperTimelineImagePublisherV30(profile, {
			port: base.port,
			store: exactStore as unknown as FramescaperTimelineImagePublicationStoreV30,
			projectCodec: IMAGE_PROJECT_CODEC,
		}),
	});
	AUTHORITIES.set(exactStore, authority);
	return authority;
}
