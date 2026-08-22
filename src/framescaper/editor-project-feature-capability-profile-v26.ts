/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectFeatureCapabilityProfile,
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import {
	FRAMESCAPER_V25_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile-v25.ts';

/** Qualification-only V26 capabilities. Shipped V20 remains known/unavailable. */
export const FRAMESCAPER_V26_PROJECT_CANDIDATE_CAPABILITY_PROFILE =
	createEditorProjectFeatureCapabilityProfile({
		owner: 'framescaper',
		registrations: editorProjectFeatureCapabilityProfileDefinition(
			FRAMESCAPER_V25_PROJECT_FEATURE_CAPABILITY_PROFILE,
		).registrations.map((registration) => ({
			...registration,
			available: registration.key === 'ofxEffects' ? true : registration.available,
		})),
	});
