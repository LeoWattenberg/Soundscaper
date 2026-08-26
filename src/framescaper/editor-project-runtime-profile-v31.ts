/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	FRAMESCAPER_V31_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile-v31.ts';
import {
	FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
} from './editor-project-runtime-profile-v31-prerequisite.ts';

export const FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE = createEditorProjectRuntimeProfile({
	prerequisite: FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
	capabilityProfile: FRAMESCAPER_V31_PROJECT_FEATURE_CAPABILITY_PROFILE,
});

export function assertFramescaperProjectV31Profile(
	profile: unknown,
): asserts profile is typeof FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE {
	if (profile !== FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The authenticated prepared Framescaper F31 runtime profile is required.');
	}
}
