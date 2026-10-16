/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	createFramescaperProjectStoreFoundation,
	framescaperProjectStoreFoundationAuthority,
	type FramescaperProjectStoreFoundationAuthority,
	type FramescaperProjectStoreFoundationOptions,
} from './editor-project-store-foundation.ts';
import { applyFramescaperProjectCommand } from './editor-project-commands.ts';
import { FramescaperProjectRepository } from './editor-project-repository.ts';
import { FramescaperScapeImageProjectPublication } from './editor-scape-image-project-publication.ts';
import type { FramescaperProjectStoreFoundationDefinition } from './editor-project-store-foundation.ts';
import { assertFramescaperProjectRuntimeProfile } from './editor-project-runtime-profile.ts';
import { FRAMESCAPER_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile.ts';
import { cloneFramescaperProject } from './editor-project.ts';
import { FramescaperTimelineImageHdrPublisherCurrentV1 } from './editor-timeline-image-hdr-publication-current-v1.ts';
import {
	FramescaperTimelineImagePublisherTimelineImage,
	type FramescaperTimelineImageProjectCodecTimelineImage,
	type FramescaperTimelineImagePublicationStoreTimelineImage,
} from './editor-timeline-image-publication-timeline-image.ts';

const DEFINITION = Object.freeze({
	generation: 'baseline',
	token: Object.freeze({}),
	profile: null as unknown,
	authenticate: assertFramescaperProjectRuntimeProfile,
	storageProfile: FRAMESCAPER_PROJECT_STORAGE_PROFILE,
	repository: (profile: unknown, delegate: ConstructorParameters<typeof FramescaperProjectRepository>[1],
		authority: Parameters<FramescaperProjectStoreFoundationDefinition['repository']>[2]) => (
		new FramescaperProjectRepository(profile, delegate, new FramescaperScapeImageProjectPublication({
			port: authority.port, media: authority.repositories.media, retention: authority.repositories.retention,
		}))
	),
});

const IMAGE_PROJECT_CODEC: FramescaperTimelineImageProjectCodecTimelineImage = Object.freeze({
	authenticate: assertFramescaperProjectRuntimeProfile,
	clone: (profile: unknown, project: unknown) => cloneFramescaperProject(profile, project) as never,
	apply: (profile: unknown, project: unknown, command: unknown, options: Readonly<{
		readonly now?: Date | string;
	}>) => applyFramescaperProjectCommand(profile, project, command, options) as never,
});

export interface FramescaperProjectStoreAuthority extends FramescaperProjectStoreFoundationAuthority {
	readonly timelineImages: FramescaperTimelineImagePublisherTimelineImage;
	readonly hdrImages: FramescaperTimelineImageHdrPublisherCurrentV1;
}

const AUTHORITIES = new WeakMap<AudioEditorProjectStore, FramescaperProjectStoreAuthority>();

export function createFramescaperProjectStore(
	profile: unknown,
	options: FramescaperProjectStoreFoundationOptions | unknown = {},
): AudioEditorProjectStore {
	assertFramescaperProjectRuntimeProfile(profile);
	return createFramescaperProjectStoreFoundation({ ...DEFINITION, profile }, options);
}

export function framescaperProjectStoreAuthority(profile: unknown, store: unknown) {
	assertFramescaperProjectRuntimeProfile(profile);
	const base = framescaperProjectStoreFoundationAuthority({ ...DEFINITION, profile }, store);
	const exactStore = store as AudioEditorProjectStore;
	const existing = AUTHORITIES.get(exactStore);
	if (existing) return existing;
	const authority = Object.freeze({
		...base,
		hdrImages: new FramescaperTimelineImageHdrPublisherCurrentV1(profile, { port: base.port, store: exactStore }),
		timelineImages: new FramescaperTimelineImagePublisherTimelineImage(profile, {
			port: base.port,
			store: exactStore as unknown as FramescaperTimelineImagePublicationStoreTimelineImage,
			projectCodec: IMAGE_PROJECT_CODEC,
		}),
	});
	AUTHORITIES.set(exactStore, authority);
	return authority;
}
