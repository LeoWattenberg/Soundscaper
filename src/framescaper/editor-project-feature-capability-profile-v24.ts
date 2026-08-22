/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectFeatureCapabilityProfile,
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import { FRAMESCAPER_V22_PROJECT_CANDIDATE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-v22.ts';

const CANDIDATE_FEATURES = new Set([
	'videoStills', 'videoGenerators', 'videoAdjustmentLayers', 'videoMasksMattes', 'videoFreeze',
]);

/** Qualification-only V24 capabilities. Shipped product availability remains false. */
export const FRAMESCAPER_V24_PROJECT_CANDIDATE_CAPABILITY_PROFILE =
	createEditorProjectFeatureCapabilityProfile({
		owner: 'framescaper',
		registrations: editorProjectFeatureCapabilityProfileDefinition(
			FRAMESCAPER_V22_PROJECT_CANDIDATE_CAPABILITY_PROFILE,
		).registrations.map((registration) => ({
			...registration,
			available: registration.available || CANDIDATE_FEATURES.has(registration.key),
		})),
	});
