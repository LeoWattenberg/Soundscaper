/* SPDX-License-Identifier: AGPL-3.0-only */

import { cloneFramescaperProjectV26, type FramescaperProjectV26 } from './editor-project-v26.ts';
import { assertFramescaperProjectV26CandidateProfile } from './editor-project-runtime-profile-v26.ts';

export const FRAMESCAPER_V26_COMPATIBILITY_CONTRACT = Object.freeze({
	projectSchemaVersion: 26,
	desktopLibrarySchemaVersion: 16,
	desktopDatabaseUserVersion: 18,
	desktopLibraryScope: Object.freeze(['kw.media', 'scape-project-library', 'v16']),
	clipboardSchemaVersion: 10,
	renderPlanVersion: 12,
	activation: 'dormant-candidate' as const,
});

/** Detached V16 transport. Generation identity remains inside its authenticated handshake. */
export function framescaperDesktopProjectTransportV26(profile: unknown) {
	assertFramescaperProjectV26CandidateProfile(profile);
	return Object.freeze({
		contract: FRAMESCAPER_V26_COMPATIBILITY_CONTRACT,
		encode(project: unknown): FramescaperProjectV26 {
			return cloneFramescaperProjectV26(profile, project);
		},
		decode(project: unknown): FramescaperProjectV26 {
			return cloneFramescaperProjectV26(profile, project);
		},
	});
}
