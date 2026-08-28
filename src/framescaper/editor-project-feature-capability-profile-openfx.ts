/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectFeatureCapabilityProfile,
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import {
	FRAMESCAPER_PROFESSIONAL_MEDIA_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile-professional-media.ts';

/** Qualification-only openFx capabilities. Shipped retime remains known/unavailable. */
export const FRAMESCAPER_OPENFX_PROJECT_CANDIDATE_CAPABILITY_PROFILE =
	createEditorProjectFeatureCapabilityProfile({
		owner: 'framescaper',
		registrations: editorProjectFeatureCapabilityProfileDefinition(
			FRAMESCAPER_PROFESSIONAL_MEDIA_PROJECT_FEATURE_CAPABILITY_PROFILE,
		).registrations.map((registration) => ({
			...registration,
			available: registration.key === 'ofxEffects' ? true : registration.available,
		})),
	});
