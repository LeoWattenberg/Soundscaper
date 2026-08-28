/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectFeatureCapabilityProfile,
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import {
	FRAMESCAPER_RETIME_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile-retime.ts';

const CANDIDATE_AVAILABLE = new Set([
	'videoAdjustmentLayers',
	'videoFreeze',
	'videoGenerators',
	'videoMasksMattes',
	'videoStills',
	'videoTransitionDissolve',
	'videoTransitions',
]);

/** professionalMedia test/qualification profile; the shipped retime profile remains unchanged. */
export const FRAMESCAPER_PROFESSIONAL_MEDIA_PROJECT_FEATURE_CAPABILITY_PROFILE =
	createEditorProjectFeatureCapabilityProfile({
		owner: 'framescaper',
		registrations: editorProjectFeatureCapabilityProfileDefinition(
			FRAMESCAPER_RETIME_PROJECT_FEATURE_CAPABILITY_PROFILE,
		).registrations.map((registration) => Object.freeze({
			...registration,
			available: CANDIDATE_AVAILABLE.has(registration.key)
				? true
				: registration.available,
		})),
	});
