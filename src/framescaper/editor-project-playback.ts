/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	PlaybackProjectProjection,
	PlaybackProjectService,
} from '../common/editor/controller/source/playback-project-service.ts';
import { FRAMESCAPER_PROJECT_SCHEMA_FAMILY, classifyProjectSchemaIdentity } from
	'../common/editor/project-schema-identity.ts';
import {
	brandRuntimeProjectProjection,
	isRuntimeProjectProjection,
	type RuntimeClipProject,
} from '../common/editor/runtime-clip-projection.ts';
import {
	inheritTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from
	'../common/editor/track-folder-media-runtime.ts';
import type { VideoTimingMediaStore } from '../common/editor/video-timing-storage.ts';
import { createFramescaperPlaybackProjectServiceAssistance } from './editor-project-playback-assistance.ts';
import {
	framescaperPlaybackDeliveryProjection,
	opaqueFramescaperPlaybackProjection,
} from './editor-project-playback-projection.ts';
import { assertFramescaperProjectRuntimeProfile } from './editor-project-runtime-profile.ts';

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
		if (!isCurrent(project)) return opaqueFramescaperPlaybackProjection(project);
		return baselineProjection(selected.projectForActivationAdmission!(
			project,
		)) as PlaybackProjectProjection<Project>;
	}

	function projectForPlayback<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (!isCurrent(project)) return opaqueFramescaperPlaybackProjection(project);
		const projection = baselineProjection(selected.projectForPlayback(
			project,
		));
		const mediaProject = projectTrackFolderMediaStateV12(projection.project);
		return Object.freeze({
			...projection,
			project: preserveRuntimeProjectionBrand(projection.project, mediaProject),
		});
	}

	function projectForDelivery<Project extends object>(project: Project) {
		const result = projectForPlayback(project);
		return framescaperPlaybackDeliveryProjection(result);
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

function baselineProjection<Project extends object>(
	projection: PlaybackProjectProjection<Project>,
): PlaybackProjectProjection<Project> {
	const source = projection.project;
	const project = inheritTrackFolderMediaStateProjectionV12(source, Object.freeze({
		...source,
		schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
		schemaVersion: 1,
	}));
	return Object.freeze({
		...projection,
		project: preserveRuntimeProjectionBrand(source, project),
	});
}

function preserveRuntimeProjectionBrand<Project extends object>(source: Project, project: Project): Project {
	return isRuntimeProjectProjection(source)
		? brandRuntimeProjectProjection(project as Project & RuntimeClipProject)
		: project;
}
