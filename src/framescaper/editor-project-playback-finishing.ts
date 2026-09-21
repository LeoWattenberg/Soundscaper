/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	PlaybackProjectProjection,
	PlaybackProjectService,
} from '../common/editor/controller/source/playback-project-service.ts';
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
import {
	framescaperFeaturePlaybackProjection,
	framescaperPlaybackDeliveryProjection,
	opaqueFramescaperPlaybackProjection,
} from './editor-project-playback-projection.ts';

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
		if (!hasFramescaperProjectIdentity(project)) return opaqueFramescaperPlaybackProjection(project);
		validateFramescaperProjectFinishing(profile, project);
		const foundation = framescaperProjectRetimeFoundationFinishing(
			profile, project as unknown as FramescaperProjectFinishing);
		return inheritFramescaperPlaybackAdmission(
			framescaperFeaturePlaybackProjection(project, compatibility.evaluate(project)),
			retime.projectForActivationAdmission!(foundation),
		);
	}

	function projectForPlayback<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (!hasFramescaperProjectIdentity(project)) return opaqueFramescaperPlaybackProjection(project);
		validateFramescaperProjectFinishing(profile, project);
		const runtime = framescaperProjectForRuntimeConsumersFinishing(profile, project) as unknown as Project;
		return framescaperFeaturePlaybackProjection(runtime, compatibility.evaluate(project));
	}

	function projectForDelivery<Project extends object>(project: Project) {
		const result = projectForPlayback(project);
		return framescaperPlaybackDeliveryProjection(result);
	}
}
