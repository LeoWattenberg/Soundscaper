/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectRuntimeProfile,
	editorProjectRuntimeProfileDefinition,
	type EditorProjectRuntimeProfile,
} from '../common/editor/project-runtime-profile.ts';
import {
	FRAMESCAPER_V25_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile-v25.ts';
import {
	FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
} from './editor-project-runtime-profile-v25-prerequisite.ts';

export const FRAMESCAPER_PROJECT_V25_CLIPBOARD_VERSION = 9 as const;
export const FRAMESCAPER_PROJECT_V25_RENDER_PLAN_VERSION = 11 as const;

/** Software-complete candidate identity; no product route imports this token. */
export const FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE = createEditorProjectRuntimeProfile({
	prerequisite: FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
	capabilityProfile: FRAMESCAPER_V25_PROJECT_FEATURE_CAPABILITY_PROFILE,
});

export interface FramescaperProjectV25CandidateContract {
	readonly status: 'dormant-candidate';
	readonly projectSchemaVersion: 25;
	readonly desktopLibrarySchemaVersion: 15;
	readonly desktopDatabaseUserVersion: 17;
	readonly desktopLibraryScopeVersion: 'v15';
	readonly clipboardVersion: 9;
	readonly renderPlanVersion: 11;
}

export const FRAMESCAPER_V25_CANDIDATE_CONTRACT: FramescaperProjectV25CandidateContract =
	Object.freeze({
		status: 'dormant-candidate',
		projectSchemaVersion: 25,
		desktopLibrarySchemaVersion: 15,
		desktopDatabaseUserVersion: 17,
		desktopLibraryScopeVersion: 'v15',
		clipboardVersion: FRAMESCAPER_PROJECT_V25_CLIPBOARD_VERSION,
		renderPlanVersion: FRAMESCAPER_PROJECT_V25_RENDER_PLAN_VERSION,
	});

export function assertFramescaperProjectV25CandidateProfile(
	profile: unknown,
): asserts profile is EditorProjectRuntimeProfile {
	if (profile !== FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The authenticated dormant Framescaper V25 candidate profile is required.');
	}
	editorProjectRuntimeProfileDefinition(profile);
}
