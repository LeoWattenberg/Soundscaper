/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectRuntimeProfile,
	type EditorProjectRuntimeProfile,
} from '../common/editor/project-runtime-profile.ts';
import {
	FRAMESCAPER_V26_PROJECT_CANDIDATE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile-v26.ts';
import {
	FRAMESCAPER_V26_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
} from './editor-project-runtime-profile-v26-prerequisite.ts';

export const FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE = createEditorProjectRuntimeProfile({
	prerequisite: FRAMESCAPER_V26_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
	capabilityProfile: FRAMESCAPER_V26_PROJECT_CANDIDATE_CAPABILITY_PROFILE,
});

export const FRAMESCAPER_V26_CANDIDATE_CONTRACT = Object.freeze({
	status: 'dormant-candidate' as const,
	projectSchemaVersion: 26 as const,
	desktopLibrarySchemaVersion: 16 as const,
	desktopDatabaseUserVersion: 18 as const,
	desktopLibraryScope: Object.freeze(['kw.media', 'scape-project-library', 'v16'] as const),
	clipboardVersion: 10 as const,
	renderPlanVersion: 12 as const,
});

export function assertFramescaperProjectV26CandidateProfile(
	profile: unknown,
): asserts profile is EditorProjectRuntimeProfile {
	if (profile !== FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE) {
		throw new TypeError('The authenticated dormant Framescaper V26 candidate profile is required.');
	}
}
