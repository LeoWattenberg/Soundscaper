/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { FRAMESCAPER_V28_PROJECT_FEATURE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE_PREREQUISITE } from './editor-project-runtime-profile-v28-prerequisite.ts';

export const FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE = createEditorProjectRuntimeProfile({
	prerequisite: FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
	capabilityProfile: FRAMESCAPER_V28_PROJECT_FEATURE_CAPABILITY_PROFILE,
});

export function assertFramescaperProjectV28Profile(
	profile: unknown,
): asserts profile is typeof FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE {
	if (profile !== FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The authenticated selected Framescaper V28 runtime profile is required.');
	}
}
