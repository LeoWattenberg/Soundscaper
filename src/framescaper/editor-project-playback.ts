/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	PlaybackProjectProjection,
	PlaybackProjectService,
} from '../common/editor/controller/playback-project-service.ts';
import { FRAMESCAPER_PROJECT_SCHEMA_FAMILY, classifyProjectSchemaIdentity } from
	'../common/editor/project-schema-identity.ts';
import { projectTrackFolderMediaStateV12 } from
	'../common/editor/track-folder-media-runtime.ts';
import type { VideoTimingMediaStore } from '../common/editor/video-timing-storage.ts';
import { createFramescaperPlaybackProjectServiceAssistance } from './editor-project-playback-assistance.ts';
import { assertFramescaperProjectRuntimeProfile } from './editor-project-runtime-profile.ts';

const EMPTY = Object.freeze([]) as readonly string[];

export interface FramescaperPlaybackProjectServiceOptions {
	readonly timingStore?: Pick<VideoTimingMediaStore, 'loadMediaAsset'>;
}

/** Framescaper v1 playback facade over the selected exact-timing engine. */
export function createFramescaperPlaybackProjectService(
	profile: unknown,
	optionsValue: FramescaperPlaybackProjectServiceOptions | unknown = {},
): PlaybackProjectService {
	assertFramescaperProjectRuntimeProfile(profile);
	const options = optionsValue as FramescaperPlaybackProjectServiceOptions;
	const selected = createFramescaperPlaybackProjectServiceAssistance(
		profile,
		options.timingStore ? { timingStore: options.timingStore } : {},
	);
	return Object.freeze({
		...(selected.prepareProjectForActivation ? { prepareProjectForActivation } : {}),
		projectForActivationAdmission: projectForAdmission,
		projectForPlayback,
		projectForAudioRenderedFallbackDelivery: projectForDelivery,
		projectForVideoRenderedFallbackDelivery: projectForDelivery,
	});

	async function prepareProjectForActivation<Project extends object>(
		project: Project,
		prepareOptions: Readonly<{ readonly signal?: AbortSignal }> = {},
	): Promise<void> {
		if (!isCurrent(project)) return;
		await selected.prepareProjectForActivation?.(
			project,
			prepareOptions,
		);
	}

	function projectForAdmission<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (!isCurrent(project)) return opaque(project);
		return baselineProjection(selected.projectForActivationAdmission!(
			project,
		)) as PlaybackProjectProjection<Project>;
	}

	function projectForPlayback<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (!isCurrent(project)) return opaque(project);
		const projection = baselineProjection(selected.projectForPlayback(
			project,
		)) as PlaybackProjectProjection<Project>;
		return Object.freeze({
			...projection,
			project: projectTrackFolderMediaStateV12(projection.project),
		});
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

function isCurrent(project: unknown): boolean {
	try {
		return classifyProjectSchemaIdentity(
			project,
			FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
		).disposition === 'current';
	} catch {
		return false;
	}
}

function baselineProjection(
	projection: PlaybackProjectProjection<object>,
): PlaybackProjectProjection<object> {
	const project = structuredClone(projection.project) as Record<string, unknown>;
	project.schemaFamily = FRAMESCAPER_PROJECT_SCHEMA_FAMILY;
	project.schemaVersion = 1;
	return Object.freeze({ ...projection, project: Object.freeze(project) });
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
