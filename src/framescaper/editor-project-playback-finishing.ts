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
	createFramescaperProjectFeatureCompatibilityServiceFinishing,
} from './editor-project-feature-requirements-finishing.ts';
import { createFramescaperPlaybackProjectServiceRetime } from './editor-project-playback-retime.ts';
import { inheritFramescaperPlaybackAdmission } from './editor-project-playback-admission.ts';
import { hasFramescaperProjectIdentity } from './editor-project-identity.ts';
import {
	framescaperProjectForRuntimeConsumersFinishing,
	framescaperProjectRetimeFoundationFinishing,
} from './editor-project-finishing-runtime.ts';
import { FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { assertFramescaperProjectFinishingProfile } from './editor-domain-runtime-profile.ts';
import { type FramescaperProjectFinishing, validateFramescaperProjectFinishing } from './editor-project-finishing.ts';

const EMPTY = Object.freeze([]) as readonly string[];

export interface FramescaperPlaybackProjectServiceFinishingOptions {
	readonly timingStore?: Pick<VideoTimingMediaStore, 'loadMediaAsset'>;
}

/** Selected finishing playback retains exact retime timing and overlays visual/finishing visual state. */
export function createFramescaperPlaybackProjectServiceFinishing(
	profile: unknown,
	optionsValue: FramescaperPlaybackProjectServiceFinishingOptions | unknown = {},
): PlaybackProjectService {
	assertFramescaperProjectFinishingProfile(profile);
	const options = optionsValue as FramescaperPlaybackProjectServiceFinishingOptions;
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceFinishing(profile);
	const retime = createFramescaperPlaybackProjectServiceRetime(
		FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE,
		options.timingStore ? { timingStore: options.timingStore } : {},
	);
	return Object.freeze({
		...(retime.prepareProjectForActivation ? { prepareProjectForActivation } : {}),
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
		validateFramescaperProjectFinishing(profile, project);
		await retime.prepareProjectForActivation?.(
			framescaperProjectRetimeFoundationFinishing(profile, project as unknown as FramescaperProjectFinishing),
			prepareOptions,
		);
	}

	function projectForAdmission<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (!hasFramescaperProjectIdentity(project)) return opaque(project);
		validateFramescaperProjectFinishing(profile, project);
		const foundation = framescaperProjectRetimeFoundationFinishing(
			profile, project as unknown as FramescaperProjectFinishing);
		return inheritFramescaperPlaybackAdmission(
			projection(project, compatibility.evaluate(project)),
			retime.projectForActivationAdmission!(foundation),
		);
	}

	function projectForPlayback<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (!hasFramescaperProjectIdentity(project)) return opaque(project);
		validateFramescaperProjectFinishing(profile, project);
		const runtime = framescaperProjectForRuntimeConsumersFinishing(profile, project) as unknown as Project;
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
	ReturnType<typeof createFramescaperProjectFeatureCompatibilityServiceFinishing>['evaluate']
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
