/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	PlaybackProjectProjection,
	PlaybackProjectService,
} from '../common/editor/controller/source/playback-project-service.ts';
import { composeProjectFeaturePlaybackProjection } from '../common/editor/project-feature-playback-projection.ts';
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

const EMPTY = Object.freeze([]) as readonly string[];

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
		if (!hasFramescaperProjectIdentity(project)) return opaque(project);
		validateFramescaperProjectAssistance(profile, project);
		const foundation = framescaperProjectNativeMediaFoundationShapeAssistance(project);
		return inheritFramescaperPlaybackAdmission(
			projection(project, compatibility.evaluate(project)),
			nativeMedia.projectForActivationAdmission!(foundation),
		);
	}

	function projectForPlayback<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (!hasFramescaperProjectIdentity(project)) return opaque(project);
		validateFramescaperProjectAssistance(profile, project);
		const runtime = framescaperProjectForRuntimeConsumersAssistance(profile, project) as unknown as Project;
		return projection(runtime, compatibility.evaluate(project));
	}

	function projectForDelivery<Project extends object>(project: Project) {
		const result = projectForPlayback(project);
		return Object.freeze({
			project: result.project,
			featureRequirementsReport: result.featureRequirementsReport,
			audioRenderedFallback: result.audioRenderedFallback,
			videoRenderedFallback: result.videoRenderedFallback,
			requiredAudioSourceIds: result.requiredAudioSourceIds,
			requiredVideoSourceIds: result.requiredVideoSourceIds,
		});
	}
}

type CompatibilityReport = ReturnType<
	ReturnType<typeof createFramescaperProjectFeatureCompatibilityServiceAssistance>['evaluate']
>;

function projection<Project extends object>(
	project: Project,
	report: CompatibilityReport,
): PlaybackProjectProjection<Project> {
	const features = composeProjectFeaturePlaybackProjection(project, report);
	return Object.freeze({
		project: features.project as Project,
		featureRequirementsReport: report,
		audioEffectPlaybackBypass: features.audioEffectPlaybackBypass,
		audioRenderedFallback: features.audioRenderedFallback,
		videoEffectPlaybackBypass: features.videoEffectPlaybackBypass,
		videoRenderedFallback: features.videoRenderedFallback,
		requiredAudioSourceIds: Object.freeze(features.audioRenderedFallback
			? [features.audioRenderedFallback.sourceId] : []),
		requiredVideoSourceIds: Object.freeze(features.videoRenderedFallback
			? [features.videoRenderedFallback.sourceId] : []),
	});
}

function opaque<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
	return Object.freeze({
		project,
		featureRequirementsReport: null,
		audioEffectPlaybackBypass: null,
		audioRenderedFallback: null,
		videoEffectPlaybackBypass: null,
		videoRenderedFallback: null,
		requiredAudioSourceIds: EMPTY,
		requiredVideoSourceIds: EMPTY,
	});
}
