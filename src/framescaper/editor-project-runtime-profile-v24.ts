/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { FRAMESCAPER_V24_PROJECT_CANDIDATE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-v24.ts';
import { FRAMESCAPER_V24_PROJECT_RUNTIME_PROFILE_PREREQUISITE } from './editor-project-runtime-profile-v24-prerequisite.ts';

/** Authenticated qualification authority; no product route imports this candidate. */
export const FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE = createEditorProjectRuntimeProfile({
	prerequisite: FRAMESCAPER_V24_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
	capabilityProfile: FRAMESCAPER_V24_PROJECT_CANDIDATE_CAPABILITY_PROFILE,
});

export function assertFramescaperProjectV24CandidateProfile(
	profile: unknown,
): asserts profile is typeof FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE {
	if (profile !== FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE) {
		throw new TypeError('The authenticated dormant Framescaper V24 candidate profile is required.');
	}
}
