/* SPDX-License-Identifier: AGPL-3.0-only */

import { cloneFramescaperProjectV24, type FramescaperProjectV24 } from './editor-project-v24.ts';
import { assertFramescaperProjectV24CandidateProfile } from './editor-project-runtime-profile-v24.ts';

export const FRAMESCAPER_V24_COMPATIBILITY_CONTRACT = Object.freeze({
	projectSchemaVersion: 24,
	desktopLibrarySchemaVersion: 14,
	desktopDatabaseUserVersion: 16,
	desktopLibraryScope: Object.freeze(['kw.media', 'scape-project-library', 'v14']),
	clipboardSchemaVersion: 8,
	renderPlanVersion: 10,
	activation: 'dormant-candidate' as const,
});

/** Detached V14 desktop transport; generation identity remains handshake-owned. */
export function framescaperDesktopProjectTransportV24(profile: unknown) {
	assertFramescaperProjectV24CandidateProfile(profile);
	return Object.freeze({
		contract: FRAMESCAPER_V24_COMPATIBILITY_CONTRACT,
		encode(project: unknown): FramescaperProjectV24 {
			return cloneFramescaperProjectV24(profile, project);
		},
		decode(project: unknown): FramescaperProjectV24 {
			return cloneFramescaperProjectV24(profile, project);
		},
	});
}
