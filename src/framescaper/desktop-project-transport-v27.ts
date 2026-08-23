/* SPDX-License-Identifier: AGPL-3.0-only */

import { cloneFramescaperProjectV27, type FramescaperProjectV27 } from './editor-project-v27.ts';
import { assertFramescaperProjectV27Profile } from './editor-project-runtime-profile-v27.ts';

export const FRAMESCAPER_V27_COMPATIBILITY_CONTRACT = Object.freeze({
	projectSchemaVersion: 27,
	desktopLibrarySchemaVersion: 18,
	desktopDatabaseUserVersion: 20,
	desktopLibraryScope: Object.freeze(['kw.media', 'scape-project-library', 'v18']),
	clipboardSchemaVersion: 11,
	renderPlanVersion: 13,
	activation: 'selected' as const,
});

/** Detached selected-V18 transport; handshake identity remains main-process-owned. */
export function framescaperDesktopProjectTransportV27(profile: unknown) {
	assertFramescaperProjectV27Profile(profile);
	return Object.freeze({
		contract: FRAMESCAPER_V27_COMPATIBILITY_CONTRACT,
		encode(project: unknown): FramescaperProjectV27 {
			return cloneFramescaperProjectV27(profile, project);
		},
		decode(project: unknown): FramescaperProjectV27 {
			return cloneFramescaperProjectV27(profile, project);
		},
	});
}
