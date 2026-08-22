/* SPDX-License-Identifier: AGPL-3.0-only */

import { cloneFramescaperProjectV22, type FramescaperProjectV22 } from './editor-project-v22.ts';
import { assertFramescaperProjectV22CandidateProfile } from './editor-project-runtime-profile-v22.ts';

export const FRAMESCAPER_V22_COMPATIBILITY_CONTRACT = Object.freeze({
	projectSchemaVersion: 22,
	desktopLibrarySchemaVersion: 13,
	desktopDatabaseUserVersion: 15,
	desktopLibraryScope: Object.freeze(['kw.media', 'scape-project-library', 'v13']),
	clipboardSchemaVersion: 7,
	renderPlanVersion: 9,
	activation: 'dormant-candidate' as const,
});

/** Detached V13 desktop transport; generation identity remains handshake-owned. */
export function framescaperDesktopProjectTransportV22(profile: unknown) {
	assertFramescaperProjectV22CandidateProfile(profile);
	return Object.freeze({
		contract: FRAMESCAPER_V22_COMPATIBILITY_CONTRACT,
		encode(project: unknown): FramescaperProjectV22 {
			return cloneFramescaperProjectV22(profile, project);
		},
		decode(project: unknown): FramescaperProjectV22 {
			return cloneFramescaperProjectV22(profile, project);
		},
	});
}
