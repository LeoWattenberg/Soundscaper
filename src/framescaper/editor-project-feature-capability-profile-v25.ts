/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectFeatureCapabilityProfile,
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import {
	FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile-v20.ts';

const CANDIDATE_AVAILABLE = new Set([
	'videoAdjustmentLayers',
	'videoFreeze',
	'videoGenerators',
	'videoMasksMattes',
	'videoStills',
	'videoTransitionDissolve',
	'videoTransitions',
]);

/** V25 test/qualification profile; the shipped V20 profile remains unchanged. */
export const FRAMESCAPER_V25_PROJECT_FEATURE_CAPABILITY_PROFILE =
	createEditorProjectFeatureCapabilityProfile({
		owner: 'framescaper',
		registrations: editorProjectFeatureCapabilityProfileDefinition(
			FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE,
		).registrations.map((registration) => Object.freeze({
			...registration,
			available: CANDIDATE_AVAILABLE.has(registration.key)
				? true
				: registration.available,
		})),
	});
