/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectFeatureCapabilityProfile,
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import {
	SOUNDSCAPER_V29_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile-v29.ts';

/** V30 keeps V29's authority and admits authenticated assistance-asset custody. */
export const SOUNDSCAPER_V30_PROJECT_FEATURE_CAPABILITY_PROFILE =
	createEditorProjectFeatureCapabilityProfile({
		owner: 'soundscaper',
		registrations: editorProjectFeatureCapabilityProfileDefinition(
			SOUNDSCAPER_V29_PROJECT_FEATURE_CAPABILITY_PROFILE,
		).registrations.map((registration) => Object.freeze({
			...registration,
			available: registration.key === 'assistanceAssets'
				? true
				: registration.available,
		})),
	});
