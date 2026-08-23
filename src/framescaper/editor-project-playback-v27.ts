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
import {
	createFramescaperProjectFeatureCompatibilityServiceV27,
} from './editor-project-feature-requirements-v27.ts';
import { createFramescaperPlaybackProjectServiceV20 } from './editor-project-playback-v20.ts';
import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import {
	framescaperProjectForRuntimeConsumersV27,
	framescaperProjectV20FoundationV27,
} from './editor-project-v27-runtime.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v20.ts';
import { assertFramescaperProjectV27Profile } from './editor-project-runtime-profile-v27.ts';
import { createFramescaperOpaqueCustodyConsumerProjectV27 } from './editor-project-opaque-custody-v27.ts';
import { type FramescaperProjectV27, validateFramescaperProjectV27 } from './editor-project-v27.ts';

const EMPTY = Object.freeze([]) as readonly string[];

export interface FramescaperPlaybackProjectServiceV27Options {
	readonly timingStore?: Pick<VideoTimingMediaStore, 'loadMediaAsset'>;
}

/** Selected V27 playback retains exact V20 timing and overlays V24/V27 visual state. */
export function createFramescaperPlaybackProjectServiceV27(
	profile: unknown,
	optionsValue: FramescaperPlaybackProjectServiceV27Options | unknown = {},
): PlaybackProjectService {
	assertFramescaperProjectV27Profile(profile);
	const options = optionsValue as FramescaperPlaybackProjectServiceV27Options;
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV27(profile);
	const v20 = createFramescaperPlaybackProjectServiceV20(
		FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
		options.timingStore ? { timingStore: options.timingStore } : {},
	);
	return Object.freeze({
		...(v20.prepareProjectForActivation ? { prepareProjectForActivation } : {}),
		projectForActivationAdmission: projectForAdmission,
		projectForPlayback,
		projectForAudioRenderedFallbackDelivery: projectForDelivery,
		projectForVideoRenderedFallbackDelivery: projectForDelivery,
	});

	async function prepareProjectForActivation<Project extends object>(
		project: Project,
		prepareOptions: Readonly<{ readonly signal?: AbortSignal }> = {},
	): Promise<void> {
		if (readFramescaperProjectSchemaVersion(project) !== 27) return;
		validateFramescaperProjectV27(profile, project);
		await v20.prepareProjectForActivation?.(
			framescaperProjectV20FoundationV27(profile, project as unknown as FramescaperProjectV27),
			prepareOptions,
		);
	}

	function projectForAdmission<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (readFramescaperProjectSchemaVersion(project) !== 27) return opaque(project);
		validateFramescaperProjectV27(profile, project);
		return projection(project, compatibility.evaluate(project));
	}

	function projectForPlayback<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (readFramescaperProjectSchemaVersion(project) !== 27) return opaque(project);
		validateFramescaperProjectV27(profile, project);
		const runtime = framescaperProjectForRuntimeConsumersV27(profile, project) as unknown as Project;
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
	ReturnType<typeof createFramescaperProjectFeatureCompatibilityServiceV27>['evaluate']
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
	const playbackShell = createFramescaperOpaqueCustodyConsumerProjectV27(project);
	return Object.freeze({
		project: playbackShell as unknown as Project, featureRequirementsReport: null,
		audioEffectPlaybackBypass: null, audioRenderedFallback: null,
		videoEffectPlaybackBypass: null, videoRenderedFallback: null,
		requiredAudioSourceIds: EMPTY, requiredVideoSourceIds: EMPTY,
	});
}
