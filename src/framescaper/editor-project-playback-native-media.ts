/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	PlaybackProjectProjection,
	PlaybackProjectService,
} from '../common/editor/controller/source/playback-project-service.ts';
import type { VideoTimingMediaStore } from '../common/editor/video-timing-storage.ts';
import { createFramescaperProjectFeatureCompatibilityServiceNativeMedia } from './editor-project-feature-requirements-native-media.ts';
import { createFramescaperPlaybackProjectServiceFinishing } from './editor-project-playback-finishing.ts';
import { inheritFramescaperPlaybackAdmission } from './editor-project-playback-admission.ts';
import { hasFramescaperProjectIdentity } from './editor-project-identity.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { framescaperProjectForRuntimeConsumersNativeMedia } from './editor-project-native-media-runtime.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import { assertFramescaperProjectNativeMediaProfile } from './editor-domain-runtime-profile.ts';
import { type FramescaperProjectNativeMedia, validateFramescaperProjectNativeMedia } from './editor-project-native-media.ts';
import {
	framescaperFeaturePlaybackProjection,
	framescaperPlaybackDeliveryProjection,
	opaqueFramescaperPlaybackProjection,
} from './editor-project-playback-projection.ts';

export interface FramescaperPlaybackProjectServiceNativeMediaOptions {
	readonly timingStore?: Pick<VideoTimingMediaStore, 'loadMediaAsset'>;
}

/** Selected nativeMedia playback keeps finishing timing semantics and admits native state explicitly. */
export function createFramescaperPlaybackProjectServiceNativeMedia(
	profile: unknown,
	optionsValue: FramescaperPlaybackProjectServiceNativeMediaOptions | unknown = {},
): PlaybackProjectService {
	assertFramescaperProjectNativeMediaProfile(profile);
	const options = optionsValue as FramescaperPlaybackProjectServiceNativeMediaOptions;
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceNativeMedia(profile);
	const finishing = createFramescaperPlaybackProjectServiceFinishing(
		FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		options.timingStore ? { timingStore: options.timingStore } : {},
	);
	return Object.freeze({
		...(finishing.prepareProjectForActivation ? { prepareProjectForActivation } : {}),
		projectForActivationAdmission: projectForAdmission,
		projectForPlayback,
		projectForAudioRenderedFallbackDelivery: projectForDelivery,
		projectForVideoRenderedFallbackDelivery: projectForDelivery,
	});

	async function prepareProjectForActivation<Project extends object>(
		project: Project,
		prepareOptions: Readonly<{ readonly signal?: AbortSignal }> = {},
	): Promise<void> {
		if (!hasFramescaperProjectIdentity(project)) return;
		validateFramescaperProjectNativeMedia(profile, project);
		await finishing.prepareProjectForActivation?.(
			framescaperProjectFinishingFoundationShapeNativeMedia(project as unknown as FramescaperProjectNativeMedia),
			prepareOptions,
		);
	}

	function projectForAdmission<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (!hasFramescaperProjectIdentity(project)) return opaqueFramescaperPlaybackProjection(project);
		validateFramescaperProjectNativeMedia(profile, project);
		const foundation = framescaperProjectFinishingFoundationShapeNativeMedia(
			project as unknown as FramescaperProjectNativeMedia);
		return inheritFramescaperPlaybackAdmission(
			framescaperFeaturePlaybackProjection(project, compatibility.evaluate(project)),
			finishing.projectForActivationAdmission!(foundation),
		);
	}

	function projectForPlayback<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (!hasFramescaperProjectIdentity(project)) return opaqueFramescaperPlaybackProjection(project);
		validateFramescaperProjectNativeMedia(profile, project);
		const runtime = framescaperProjectForRuntimeConsumersNativeMedia(profile, project) as unknown as Project;
		return framescaperFeaturePlaybackProjection(runtime, compatibility.evaluate(project));
	}

	function projectForDelivery<Project extends object>(project: Project) {
		const result = projectForPlayback(project);
		return framescaperPlaybackDeliveryProjection(result);
	}
}
