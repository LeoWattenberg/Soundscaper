/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { FRAMESCAPER_V27_PROJECT_FEATURE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-v27.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE_PREREQUISITE } from './editor-project-runtime-profile-v27-prerequisite.ts';

/** Authenticated selected V27 browser and desktop generation. */
export const FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE = createEditorProjectRuntimeProfile({
	prerequisite: FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
	capabilityProfile: FRAMESCAPER_V27_PROJECT_FEATURE_CAPABILITY_PROFILE,
});

export function assertFramescaperProjectV27Profile(
	profile: unknown,
): asserts profile is typeof FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE {
	if (profile !== FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The authenticated selected Framescaper V27 runtime profile is required.');
	}
}
