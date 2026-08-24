/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectFeatureCapabilityProfile,
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import { FRAMESCAPER_V27_PROJECT_FEATURE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-v27.ts';

/**
 * V28 keeps every selected V27 capability and adds exact OFX custody.
 *
 * The document runtime owns OFX state and authoring independently of execution
 * availability. The isolated host remains default-off and must separately
 * establish exact policy, payload, consent, and runtime authority.
 */
export const FRAMESCAPER_V28_PROJECT_FEATURE_CAPABILITY_PROFILE =
	createEditorProjectFeatureCapabilityProfile({
		owner: 'framescaper',
		registrations: editorProjectFeatureCapabilityProfileDefinition(
			FRAMESCAPER_V27_PROJECT_FEATURE_CAPABILITY_PROFILE,
		).registrations.map((registration) => Object.freeze({
			...registration,
			available: registration.key === 'ofxEffects' ? true : registration.available,
		})),
	});
