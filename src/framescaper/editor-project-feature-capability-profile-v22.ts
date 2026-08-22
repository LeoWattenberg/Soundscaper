/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectFeatureCapabilityProfile,
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import { FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-v20.ts';

const CANDIDATE_FEATURES = new Set(['videoTransitions', 'videoTransitionDissolve']);

/** Qualification-only capabilities. The selected product profile remains unchanged. */
export const FRAMESCAPER_V22_PROJECT_CANDIDATE_CAPABILITY_PROFILE =
	createEditorProjectFeatureCapabilityProfile({
		owner: 'framescaper',
		registrations: editorProjectFeatureCapabilityProfileDefinition(
			FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE,
		).registrations.map((registration) => ({
			...registration,
			available: registration.available || CANDIDATE_FEATURES.has(registration.key),
		})),
	});
