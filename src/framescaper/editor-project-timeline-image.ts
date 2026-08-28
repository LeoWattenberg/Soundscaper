/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	createFramescaperProjectNativeMedia,
	type FramescaperProjectNativeMedia,
	type FramescaperProjectNativeMediaOptions,
} from './editor-project-native-media.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsTimelineImage,
} from './editor-project-feature-requirements-timeline-image.ts';
import { assertFramescaperProjectTimelineImageProfile } from './editor-domain-runtime-profile.ts';
import {
	FRAMESCAPER_PROJECT_TIMELINE_IMAGE_SCHEMA_VERSION,
	validateFramescaperProjectTimelineImage,
	type FramescaperProjectTimelineImage,
} from './editor-project-timeline-image-validation.ts';

export {
	FRAMESCAPER_PROJECT_TIMELINE_IMAGE_SCHEMA_VERSION,
	validateFramescaperProjectTimelineImage,
	type FramescaperProjectTimelineImage,
} from './editor-project-timeline-image-validation.ts';

export type FramescaperProjectTimelineImageOptions = FramescaperProjectNativeMediaOptions;

export function createFramescaperProjectTimelineImage(
	profile: unknown,
	options: FramescaperProjectTimelineImageOptions = {},
): FramescaperProjectTimelineImage {
	assertFramescaperProjectTimelineImageProfile(profile);
	const foundation = createFramescaperProjectNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
		options,
	);
	return upgradeNativeMedia(profile, foundation);
}

export function cloneFramescaperProjectTimelineImage(profile: unknown, project: unknown): FramescaperProjectTimelineImage {
	assertFramescaperProjectTimelineImageProfile(profile);
	validateFramescaperProjectTimelineImage(profile, project);
	const clone = structuredClone(project) as FramescaperProjectTimelineImage;
	validateFramescaperProjectTimelineImage(profile, clone);
	return clone;
}

function upgradeNativeMedia(profile: unknown, foundation: FramescaperProjectNativeMedia): FramescaperProjectTimelineImage {
	const project = structuredClone(foundation) as unknown as Record<string, unknown>;
	project.schemaVersion = FRAMESCAPER_PROJECT_TIMELINE_IMAGE_SCHEMA_VERSION;
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsTimelineImage(profile, project);
	validateFramescaperProjectTimelineImage(profile, project);
	return project as unknown as FramescaperProjectTimelineImage;
}
