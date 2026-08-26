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
	createFramescaperProjectFeatureCompatibilityServiceV32,
} from './editor-project-feature-requirements-v32.ts';
import { createFramescaperOpaqueCustodyConsumerProjectV32 } from './editor-project-opaque-custody-v32.ts';
import { createFramescaperPlaybackProjectServiceV28 } from './editor-project-playback-v28.ts';
import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { assertFramescaperProjectV32Profile } from './editor-project-runtime-profile-v32.ts';
import { framescaperProjectV28FoundationShapeV32 } from './editor-project-v32-foundation.ts';
import { framescaperProjectForRuntimeConsumersV32 } from './editor-project-v32-runtime.ts';
import {
	FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION,
	validateFramescaperProjectV32,
	type FramescaperProjectV32,
} from './editor-project-v32.ts';

const EMPTY = Object.freeze([]) as readonly string[];

export interface FramescaperPlaybackProjectServiceV32Options {
	readonly timingStore?: Pick<VideoTimingMediaStore, 'loadMediaAsset'>;
}

/** V32 retains V28 playback behavior while exposing image clips to the selected image provider. */
export function createFramescaperPlaybackProjectServiceV32(
	profile: unknown,
	optionsValue: FramescaperPlaybackProjectServiceV32Options | unknown = {},
): PlaybackProjectService {
	assertFramescaperProjectV32Profile(profile);
	const options = optionsValue as FramescaperPlaybackProjectServiceV32Options;
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV32(profile);
	const v28 = createFramescaperPlaybackProjectServiceV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		options.timingStore ? { timingStore: options.timingStore } : {},
	);
	return Object.freeze({
		...(v28.prepareProjectForActivation ? { prepareProjectForActivation } : {}),
		projectForActivationAdmission: projectForAdmission,
		projectForPlayback,
		projectForAudioRenderedFallbackDelivery: projectForDelivery,
		projectForVideoRenderedFallbackDelivery: projectForDelivery,
	});

	async function prepareProjectForActivation<Project extends object>(
		project: Project,
		prepareOptions: Readonly<{ readonly signal?: AbortSignal }> = {},
	): Promise<void> {
		if (readFramescaperProjectSchemaVersion(project) !== FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION) return;
		validateFramescaperProjectV32(profile, project);
		await v28.prepareProjectForActivation?.(
			framescaperProjectV28FoundationShapeV32(project as unknown as FramescaperProjectV32),
			prepareOptions,
		);
	}

	function projectForAdmission<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (readFramescaperProjectSchemaVersion(project) !== FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION) {
			return opaque(project);
		}
		validateFramescaperProjectV32(profile, project);
		return projection(project, compatibility.evaluate(project));
	}

	function projectForPlayback<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (readFramescaperProjectSchemaVersion(project) !== FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION) {
			return opaque(project);
		}
		validateFramescaperProjectV32(profile, project);
		const runtime = framescaperProjectForRuntimeConsumersV32(profile, project) as unknown as Project;
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
	ReturnType<typeof createFramescaperProjectFeatureCompatibilityServiceV32>['evaluate']
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
	const shell = createFramescaperOpaqueCustodyConsumerProjectV32(project);
	return Object.freeze({
		project: shell as unknown as Project,
		featureRequirementsReport: null,
		audioEffectPlaybackBypass: null,
		audioRenderedFallback: null,
		videoEffectPlaybackBypass: null,
		videoRenderedFallback: null,
		requiredAudioSourceIds: EMPTY,
		requiredVideoSourceIds: EMPTY,
	});
}
