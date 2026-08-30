/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	PlaybackProjectProjection,
	PlaybackProjectService,
} from '../common/editor/controller/playback-project-service.ts';
import { projectFeatureAudioEffectPlaybackBypass } from '../common/editor/project-feature-audio-effect-bypass.ts';
import { projectFeatureAudioRenderedFallbackPlayback } from '../common/editor/project-feature-audio-rendered-fallback.ts';
import { projectFeatureVideoEffectPlaybackBypass } from '../common/editor/project-feature-video-effect-bypass.ts';
import { projectFeatureVideoRenderedFallbackPlayback } from '../common/editor/project-feature-video-rendered-fallback.ts';
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

const EMPTY = Object.freeze([]) as readonly string[];

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
		if (!hasFramescaperProjectIdentity(project)) return opaque(project);
		validateFramescaperProjectNativeMedia(profile, project);
		const foundation = framescaperProjectFinishingFoundationShapeNativeMedia(
			project as unknown as FramescaperProjectNativeMedia);
		return inheritFramescaperPlaybackAdmission(
			projection(project, compatibility.evaluate(project)),
			finishing.projectForActivationAdmission!(foundation),
		);
	}

	function projectForPlayback<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (!hasFramescaperProjectIdentity(project)) return opaque(project);
		validateFramescaperProjectNativeMedia(profile, project);
		const runtime = framescaperProjectForRuntimeConsumersNativeMedia(profile, project) as unknown as Project;
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
	ReturnType<typeof createFramescaperProjectFeatureCompatibilityServiceNativeMedia>['evaluate']
>;

function projection<Project extends object>(
	project: Project,
	report: CompatibilityReport,
): PlaybackProjectProjection<Project> {
	const renderedAudio = projectFeatureAudioRenderedFallbackPlayback(project, report);
	const renderedVideo = projectFeatureVideoRenderedFallbackPlayback(renderedAudio.project, report);
	const bypassedAudio = projectFeatureAudioEffectPlaybackBypass(renderedVideo.project, report);
	const bypassedVideo = projectFeatureVideoEffectPlaybackBypass(bypassedAudio.project, report);
	return Object.freeze({
		project: bypassedVideo.project as Project,
		featureRequirementsReport: report,
		audioEffectPlaybackBypass: bypassedAudio.metadata,
		audioRenderedFallback: renderedAudio.metadata,
		videoEffectPlaybackBypass: bypassedVideo.metadata,
		videoRenderedFallback: renderedVideo.metadata,
		requiredAudioSourceIds: Object.freeze(renderedAudio.metadata ? [renderedAudio.metadata.sourceId] : []),
		requiredVideoSourceIds: Object.freeze(renderedVideo.metadata ? [renderedVideo.metadata.sourceId] : []),
	});
}

function opaque<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
	return Object.freeze({
		project, featureRequirementsReport: null,
		audioEffectPlaybackBypass: null, audioRenderedFallback: null,
		videoEffectPlaybackBypass: null, videoRenderedFallback: null,
		requiredAudioSourceIds: EMPTY, requiredVideoSourceIds: EMPTY,
	});
}
