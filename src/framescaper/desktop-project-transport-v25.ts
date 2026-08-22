/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertFramescaperProjectV25CandidateProfile } from './editor-project-runtime-profile-v25.ts';
import { cloneFramescaperProjectV25, type FramescaperProjectV25 } from './editor-project-v25.ts';

export const FRAMESCAPER_V25_COMPATIBILITY_CONTRACT = Object.freeze({
	projectSchemaVersion: 25,
	desktopLibrarySchemaVersion: 15,
	desktopDatabaseUserVersion: 17,
	desktopLibraryScope: Object.freeze(['kw.media', 'scape-project-library', 'v15']),
	clipboardSchemaVersion: 9,
	renderPlanVersion: 11,
	activation: 'dormant-candidate' as const,
});

/** Detached V15 transport. Generation identity remains handshake-owned. */
export function framescaperDesktopProjectTransportV25(profile: unknown) {
	assertFramescaperProjectV25CandidateProfile(profile);
	return Object.freeze({
		contract: FRAMESCAPER_V25_COMPATIBILITY_CONTRACT,
		encode(project: unknown): FramescaperProjectV25 {
			return cloneFramescaperProjectV25(profile, project);
		},
		decode(project: unknown): FramescaperProjectV25 {
			return cloneFramescaperProjectV25(profile, project);
		},
	});
}
