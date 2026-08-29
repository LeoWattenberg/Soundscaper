/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../common/editor/code-unit-order.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../common/editor/project-feature-capabilities.ts';
import {
	createEditorProjectFeatureCapabilityProfile,
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_FEATURE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-native-media.ts';

/** timelineImage retains every selected nativeMedia capability and adds authenticated timeline images. */
export const FRAMESCAPER_TIMELINE_IMAGE_PROJECT_FEATURE_CAPABILITY_PROFILE =
	createEditorProjectFeatureCapabilityProfile({
		owner: 'framescaper',
		registrations: [
			...editorProjectFeatureCapabilityProfileDefinition(
				FRAMESCAPER_NATIVE_MEDIA_PROJECT_FEATURE_CAPABILITY_PROFILE,
			).registrations,
			{
				key: 'timelineImages',
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.timelineImages,
				available: true,
			},
		].sort((left, right) => compareCodeUnits(left.key, right.key)),
	});
