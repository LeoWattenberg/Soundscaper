/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	PlaybackProjectProjection,
	PlaybackProjectService,
} from '../common/editor/controller/playback-project-service.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	createFramescaperProjectFeatureCompatibilityServiceV18,
} from './editor-project-feature-requirements-v18.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	framescaperProjectForPlaybackFoundationV18,
} from './editor-project-v18-runtime.ts';
import {
	readFramescaperProjectSchemaVersion,
	type FramescaperProjectV18,
} from './editor-project-v18.ts';

const EMPTY_SOURCE_IDS = Object.freeze([]) as readonly string[];

/**
 * Compose playback for the selected V18 domain without registering schema 18
 * in the shared V17 runtime. Proxy attachments stay canonical preservation
 * state: the engine receives only the original source identities.
 */
export function createFramescaperPlaybackProjectServiceV18(
	profile: EditorProjectRuntimeProfile | unknown,
): PlaybackProjectService {
	assertFramescaperProjectV18Profile(profile);
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV18(profile);
	return Object.freeze({
		projectForPlayback,
		projectForAudioRenderedFallbackDelivery: projectForDelivery,
		projectForVideoRenderedFallbackDelivery: projectForDelivery,
	});

	function projectForPlayback<Project extends object>(
		project: Project,
	): PlaybackProjectProjection<Project> {
		if (readFramescaperProjectSchemaVersion(project) !== 18) return opaqueProjection(project);
		const canonical = project as unknown as FramescaperProjectV18;
		const runtimeProject = framescaperProjectForPlaybackFoundationV18(profile, canonical);
		return Object.freeze({
			project: runtimeProject as unknown as Project,
			featureRequirementsReport: compatibility.evaluate(canonical),
			audioEffectPlaybackBypass: null,
			audioRenderedFallback: null,
			videoEffectPlaybackBypass: null,
			videoRenderedFallback: null,
			requiredAudioSourceIds: EMPTY_SOURCE_IDS,
			requiredVideoSourceIds: EMPTY_SOURCE_IDS,
		});
	}

	function projectForDelivery<Project extends object>(project: Project) {
		const projection = projectForPlayback(project);
		return Object.freeze({
			project: projection.project,
			featureRequirementsReport: projection.featureRequirementsReport,
			audioRenderedFallback: null,
			videoRenderedFallback: null,
			requiredAudioSourceIds: EMPTY_SOURCE_IDS,
			requiredVideoSourceIds: EMPTY_SOURCE_IDS,
		});
	}
}

function opaqueProjection<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
	return Object.freeze({
		project,
		featureRequirementsReport: null,
		audioEffectPlaybackBypass: null,
		audioRenderedFallback: null,
		videoEffectPlaybackBypass: null,
		videoRenderedFallback: null,
		requiredAudioSourceIds: EMPTY_SOURCE_IDS,
		requiredVideoSourceIds: EMPTY_SOURCE_IDS,
	});
}
