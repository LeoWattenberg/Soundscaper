/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { FRAMESCAPER_V32_PROJECT_FEATURE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-v32.ts';
import { FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE_PREREQUISITE } from './editor-project-runtime-profile-v32-prerequisite.ts';

export const FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE = createEditorProjectRuntimeProfile({
	prerequisite: FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
	capabilityProfile: FRAMESCAPER_V32_PROJECT_FEATURE_CAPABILITY_PROFILE,
});

export function assertFramescaperProjectV32Profile(
	profile: unknown,
): asserts profile is typeof FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE {
	if (profile !== FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The authenticated selected Framescaper V32 runtime profile is required.');
	}
}
