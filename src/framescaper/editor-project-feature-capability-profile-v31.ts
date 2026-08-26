/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectFeatureCapabilityProfile,
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../common/editor/project-feature-capabilities.ts';
import {
	FRAMESCAPER_V30_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile-v30.ts';

/** F31 retains V30 timeline images and admits assistance assets and annotations. */
const inherited = editorProjectFeatureCapabilityProfileDefinition(
	FRAMESCAPER_V30_PROJECT_FEATURE_CAPABILITY_PROFILE,
).registrations;

export const FRAMESCAPER_V31_PROJECT_FEATURE_CAPABILITY_PROFILE = createEditorProjectFeatureCapabilityProfile({
	owner: 'framescaper',
	registrations: [
		...inherited.map((registration) => ({ ...registration })),
		...inherited.some(({ key }) => key === 'assistanceAssets') ? [] : [{
			key: 'assistanceAssets',
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.assistanceAssets,
			available: true,
		}],
	].map((registration) => ({
		...registration,
		available: registration.key === 'assistanceAssets' || registration.key === 'timelineAnnotations'
			? true
			: registration.available,
	})).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
});
