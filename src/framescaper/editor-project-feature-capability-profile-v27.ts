/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectFeatureCapabilityProfile,
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../common/editor/project-feature-capabilities.ts';
import { FRAMESCAPER_V24_PROJECT_CANDIDATE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-v24.ts';

export const FRAMESCAPER_V27_FEATURE_IDS = Object.freeze({
	videoCaptions: PROJECT_FEATURE_CAPABILITY_IDS.videoCaptions,
	videoColorManagement: PROJECT_FEATURE_CAPABILITY_IDS.videoColorManagement,
	videoDenoise: PROJECT_FEATURE_CAPABILITY_IDS.videoDenoise,
	videoGrading: PROJECT_FEATURE_CAPABILITY_IDS.videoGrading,
	videoMotionTracking: PROJECT_FEATURE_CAPABILITY_IDS.videoMotionTracking,
	videoStabilization: PROJECT_FEATURE_CAPABILITY_IDS.videoStabilization,
});

const SELECTED_AVAILABLE = new Set([
	'audioAutomation', 'audioEffects', 'audioMixerGraph',
	'videoAdjustmentLayers', 'videoCaptions', 'videoColorManagement', 'videoDenoise',
	'videoFreeze', 'videoGenerators', 'videoGrading', 'videoMasksMattes',
	'videoMotionTracking', 'videoRetime', 'videoStabilization', 'videoStills',
	'videoTransitionDissolve', 'videoTransitions',
]);

const inherited = editorProjectFeatureCapabilityProfileDefinition(
	FRAMESCAPER_V24_PROJECT_CANDIDATE_CAPABILITY_PROFILE,
).registrations.map((registration) => ({
	...registration,
	available: registration.available || SELECTED_AVAILABLE.has(registration.key),
}));

/** Selected browser/web-core V27 capability truth. M5 native/OpenFX stays false. */
export const FRAMESCAPER_V27_PROJECT_FEATURE_CAPABILITY_PROFILE =
	createEditorProjectFeatureCapabilityProfile({
		owner: 'framescaper',
		registrations: [
			...inherited,
			...Object.entries(FRAMESCAPER_V27_FEATURE_IDS).map(([key, featureId]) => ({
				key, featureId, available: true,
			})),
		].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
	});
