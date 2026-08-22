/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { FRAMESCAPER_V22_PROJECT_CANDIDATE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-v22.ts';
import { FRAMESCAPER_V22_PROJECT_RUNTIME_PROFILE_PREREQUISITE } from './editor-project-runtime-profile-v22-prerequisite.ts';

/** Authenticated qualification authority; no product route imports this candidate. */
export const FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE = createEditorProjectRuntimeProfile({
	prerequisite: FRAMESCAPER_V22_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
	capabilityProfile: FRAMESCAPER_V22_PROJECT_CANDIDATE_CAPABILITY_PROFILE,
});

export function assertFramescaperProjectV22CandidateProfile(
	profile: unknown,
): asserts profile is typeof FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE {
	if (profile !== FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE) {
		throw new TypeError('The authenticated dormant Framescaper V22 candidate profile is required.');
	}
}
