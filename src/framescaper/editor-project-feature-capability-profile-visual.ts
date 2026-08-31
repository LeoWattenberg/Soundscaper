/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectFeatureCapabilityProfile,
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import { FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-transitions.ts';

const CANDIDATE_FEATURES = new Set([
	'videoStills', 'videoGenerators', 'videoAdjustmentLayers', 'videoMasksMattes', 'videoFreeze',
]);

/** Test-only visual capabilities. Shipped product availability remains false. */
export const FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_CAPABILITY_PROFILE =
	createEditorProjectFeatureCapabilityProfile({
		owner: 'framescaper',
		registrations: editorProjectFeatureCapabilityProfileDefinition(
			FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_CAPABILITY_PROFILE,
		).registrations.map((registration) => ({
			...registration,
			available: registration.available || CANDIDATE_FEATURES.has(registration.key),
		})),
	});
