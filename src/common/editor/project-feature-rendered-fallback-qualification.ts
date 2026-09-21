/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from './project-feature-capabilities.ts';

export type ProjectFeatureRenderedFallbackQualificationPolicy =
	| 'audio-playback'
	| 'audio-export'
	| 'audio-ui'
	| 'video-playback'
	| 'video-export'
	| 'video-ui';

export interface ProjectFeatureRenderedFallbackQualification {
	readonly role: unknown;
	readonly featureId: unknown;
	readonly availability: unknown;
	readonly declaredDisposition: unknown;
	readonly effectiveDisposition: unknown;
}

const AUDIO_POLICIES: ReadonlySet<ProjectFeatureRenderedFallbackQualificationPolicy> = new Set([
	'audio-playback', 'audio-export', 'audio-ui',
]);
const VIDEO_POLICIES: ReadonlySet<ProjectFeatureRenderedFallbackQualificationPolicy> = new Set([
	'video-playback', 'video-export', 'video-ui',
]);

/** Apply the closed role, availability, and feature policy for a rendered fallback consumer. */
export function isProjectFeatureRenderedFallbackQualified(
	qualification: ProjectFeatureRenderedFallbackQualification,
	policy: ProjectFeatureRenderedFallbackQualificationPolicy,
): boolean {
	if (qualification.declaredDisposition !== 'rendered-fallback'
		|| qualification.effectiveDisposition !== 'rendered-fallback') return false;
	const wholeProjectAvailability = qualification.availability === 'unavailable'
		|| qualification.availability === 'unknown';
	switch (qualification.role) {
		case 'project-audio-mix-v1':
			return AUDIO_POLICIES.has(policy) && wholeProjectAvailability;
		case 'audio-track-render-v1':
			return AUDIO_POLICIES.has(policy)
				&& qualification.availability === 'unavailable'
				&& (qualification.featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioEffects
					|| (policy !== 'audio-export'
						&& qualification.featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze));
		case 'project-video-render-v1':
			return VIDEO_POLICIES.has(policy) && wholeProjectAvailability;
		case 'video-clip-render-v1':
			return VIDEO_POLICIES.has(policy)
				&& qualification.availability === 'unavailable'
				&& qualification.featureId === PROJECT_FEATURE_CAPABILITY_IDS.videoEffects;
		default:
			return false;
	}
}
