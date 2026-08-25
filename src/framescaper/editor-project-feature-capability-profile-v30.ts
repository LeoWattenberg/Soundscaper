/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../common/editor/project-feature-capabilities.ts';
import {
	createEditorProjectFeatureCapabilityProfile,
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import { FRAMESCAPER_V28_PROJECT_FEATURE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-v28.ts';

/** V30 retains every selected V28 capability and adds authenticated timeline images. */
export const FRAMESCAPER_V30_PROJECT_FEATURE_CAPABILITY_PROFILE =
	createEditorProjectFeatureCapabilityProfile({
		owner: 'framescaper',
		registrations: [
			...editorProjectFeatureCapabilityProfileDefinition(
				FRAMESCAPER_V28_PROJECT_FEATURE_CAPABILITY_PROFILE,
			).registrations,
			{
				key: 'timelineImages',
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.timelineImages,
				available: true,
			},
		].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
	});
