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
import { createFramescaperProjectFeatureCompatibilityServiceV28 } from './editor-project-feature-requirements-v28.ts';
import { createFramescaperOpaqueCustodyConsumerProjectV28 } from './editor-project-opaque-custody-v28.ts';
import { createFramescaperPlaybackProjectServiceV27 } from './editor-project-playback-v27.ts';
import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v27.ts';
import { framescaperProjectForRuntimeConsumersV28 } from './editor-project-v28-runtime.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import { assertFramescaperProjectV28Profile } from './editor-project-runtime-profile-v28.ts';
import { type FramescaperProjectV28, validateFramescaperProjectV28 } from './editor-project-v28.ts';

const EMPTY = Object.freeze([]) as readonly string[];

export interface FramescaperPlaybackProjectServiceV28Options {
	readonly timingStore?: Pick<VideoTimingMediaStore, 'loadMediaAsset'>;
}

/** Selected V28 playback keeps V27 timing semantics and admits native state explicitly. */
export function createFramescaperPlaybackProjectServiceV28(
	profile: unknown,
	optionsValue: FramescaperPlaybackProjectServiceV28Options | unknown = {},
): PlaybackProjectService {
	assertFramescaperProjectV28Profile(profile);
	const options = optionsValue as FramescaperPlaybackProjectServiceV28Options;
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV28(profile);
	const v27 = createFramescaperPlaybackProjectServiceV27(
		FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
		options.timingStore ? { timingStore: options.timingStore } : {},
	);
	return Object.freeze({
		...(v27.prepareProjectForActivation ? { prepareProjectForActivation } : {}),
		projectForActivationAdmission: projectForAdmission,
		projectForPlayback,
		projectForAudioRenderedFallbackDelivery: projectForDelivery,
		projectForVideoRenderedFallbackDelivery: projectForDelivery,
	});

	async function prepareProjectForActivation<Project extends object>(
		project: Project,
		prepareOptions: Readonly<{ readonly signal?: AbortSignal }> = {},
	): Promise<void> {
		if (readFramescaperProjectSchemaVersion(project) !== 28) return;
		validateFramescaperProjectV28(profile, project);
		await v27.prepareProjectForActivation?.(
			framescaperProjectV27FoundationShapeV28(project as unknown as FramescaperProjectV28),
			prepareOptions,
		);
	}

	function projectForAdmission<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (readFramescaperProjectSchemaVersion(project) !== 28) return opaque(project);
		validateFramescaperProjectV28(profile, project);
		return projection(project, compatibility.evaluate(project));
	}

	function projectForPlayback<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (readFramescaperProjectSchemaVersion(project) !== 28) return opaque(project);
		validateFramescaperProjectV28(profile, project);
		const runtime = framescaperProjectForRuntimeConsumersV28(profile, project) as unknown as Project;
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
	ReturnType<typeof createFramescaperProjectFeatureCompatibilityServiceV28>['evaluate']
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
	const playbackShell = createFramescaperOpaqueCustodyConsumerProjectV28(project);
	return Object.freeze({
		project: playbackShell as unknown as Project, featureRequirementsReport: null,
		audioEffectPlaybackBypass: null, audioRenderedFallback: null,
		videoEffectPlaybackBypass: null, videoRenderedFallback: null,
		requiredAudioSourceIds: EMPTY, requiredVideoSourceIds: EMPTY,
	});
}
