/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	PlaybackProjectProjection,
	PlaybackProjectService,
} from '../common/editor/controller/source/playback-project-service.ts';
import type { VideoTimingMediaStore } from '../common/editor/video-timing-storage.ts';
import {
	createFramescaperProjectFeatureCompatibilityServiceAssistance,
} from './editor-project-feature-requirements-assistance.ts';
import { createFramescaperPlaybackProjectServiceNativeMedia } from './editor-project-playback-native-media.ts';
import { inheritFramescaperPlaybackAdmission } from './editor-project-playback-admission.ts';
import { hasFramescaperProjectIdentity } from './editor-project-identity.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { assertFramescaperProjectAssistanceProfile } from './editor-domain-runtime-profile.ts';
import { framescaperProjectNativeMediaFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import { framescaperProjectForRuntimeConsumersAssistance } from './editor-project-assistance-runtime.ts';
import { validateFramescaperProjectAssistance } from './editor-project-assistance.ts';
import {
	framescaperFeaturePlaybackProjection,
	framescaperPlaybackDeliveryProjection,
	opaqueFramescaperPlaybackProjection,
} from './editor-project-playback-projection.ts';

export interface FramescaperPlaybackProjectServiceAssistanceOptions {
	readonly timingStore?: Pick<VideoTimingMediaStore, 'loadMediaAsset'>;
}

/** Prepared assistance playback delegates immutable nativeMedia timing semantics through an exact projection. */
export function createFramescaperPlaybackProjectServiceAssistance(
	profile: unknown,
	optionsValue: FramescaperPlaybackProjectServiceAssistanceOptions | unknown = {},
): PlaybackProjectService {
	assertFramescaperProjectAssistanceProfile(profile);
	const options = optionsValue as FramescaperPlaybackProjectServiceAssistanceOptions;
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceAssistance(profile);
	const nativeMedia = createFramescaperPlaybackProjectServiceNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
		options.timingStore ? { timingStore: options.timingStore } : {},
	);
	return Object.freeze({
		...(nativeMedia.prepareProjectForActivation ? { prepareProjectForActivation } : {}),
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
		validateFramescaperProjectAssistance(profile, project);
		await nativeMedia.prepareProjectForActivation?.(
			framescaperProjectNativeMediaFoundationShapeAssistance(project),
			prepareOptions,
		);
	}

	function projectForAdmission<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (!hasFramescaperProjectIdentity(project)) return opaqueFramescaperPlaybackProjection(project);
		validateFramescaperProjectAssistance(profile, project);
		const foundation = framescaperProjectNativeMediaFoundationShapeAssistance(project);
		return inheritFramescaperPlaybackAdmission(
			framescaperFeaturePlaybackProjection(project, compatibility.evaluate(project)),
			nativeMedia.projectForActivationAdmission!(foundation),
		);
	}

	function projectForPlayback<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (!hasFramescaperProjectIdentity(project)) return opaqueFramescaperPlaybackProjection(project);
		validateFramescaperProjectAssistance(profile, project);
		const runtime = framescaperProjectForRuntimeConsumersAssistance(profile, project) as unknown as Project;
		return framescaperFeaturePlaybackProjection(runtime, compatibility.evaluate(project));
	}

	function projectForDelivery<Project extends object>(project: Project) {
		const result = projectForPlayback(project);
		return framescaperPlaybackDeliveryProjection(result);
	}
}
