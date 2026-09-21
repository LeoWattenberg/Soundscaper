/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared immutable packaging for every Framescaper playback profile. */

import type {
	PlaybackProjectProjection,
	VideoRenderedFallbackDeliveryProjection,
} from '../common/editor/controller/source/playback-project-service.ts';
import { composeProjectFeaturePlaybackProjection } from
	'../common/editor/project-feature-playback-projection.ts';
import type { ProjectFeatureRequirementsReport } from
	'../common/editor/project-feature-requirement-types.ts';

const EMPTY_SOURCE_IDS = Object.freeze([]) as readonly string[];

export function framescaperFeaturePlaybackProjection<Project extends object>(
	project: Project,
	featureRequirementsReport: ProjectFeatureRequirementsReport | null,
): PlaybackProjectProjection<Project> {
	const features = composeProjectFeaturePlaybackProjection(project, featureRequirementsReport);
	return Object.freeze({
		project: features.project,
		featureRequirementsReport,
		audioEffectPlaybackBypass: features.audioEffectPlaybackBypass,
		audioRenderedFallback: features.audioRenderedFallback,
		videoEffectPlaybackBypass: features.videoEffectPlaybackBypass,
		videoRenderedFallback: features.videoRenderedFallback,
		requiredAudioSourceIds: Object.freeze(
			features.audioRenderedFallback ? [features.audioRenderedFallback.sourceId] : [],
		),
		requiredVideoSourceIds: Object.freeze(
			features.videoRenderedFallback ? [features.videoRenderedFallback.sourceId] : [],
		),
	});
}

export function framescaperPlaybackDeliveryProjection<Project extends object>(
	projection: PlaybackProjectProjection<Project>,
): VideoRenderedFallbackDeliveryProjection<Project> {
	return Object.freeze({
		project: projection.project,
		featureRequirementsReport: projection.featureRequirementsReport,
		audioRenderedFallback: projection.audioRenderedFallback,
		videoRenderedFallback: projection.videoRenderedFallback,
		requiredAudioSourceIds: projection.requiredAudioSourceIds,
		requiredVideoSourceIds: projection.requiredVideoSourceIds,
	});
}

export function opaqueFramescaperPlaybackProjection<Project extends object>(
	project: Project,
): PlaybackProjectProjection<Project> {
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
