/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import {
	cloneFramescaperProjectV31,
	type FramescaperProjectV31,
} from './editor-project-v31.ts';

export const FRAMESCAPER_V31_COMPATIBILITY_CONTRACT = Object.freeze({
	projectSchemaVersion: 31,
	desktopLibrarySchemaVersion: 20,
	desktopDatabaseUserVersion: 22,
	desktopLibraryScope: Object.freeze(['kw.media', 'scape-project-library', 'v20']),
	clipboardSchemaVersion: 12,
	renderPlanVersion: 14,
	activation: 'prepared' as const,
});

export function framescaperDesktopProjectTransportV31(profile: unknown) {
	assertFramescaperProjectV31Profile(profile);
	return Object.freeze({
		contract: FRAMESCAPER_V31_COMPATIBILITY_CONTRACT,
		encode(project: unknown): FramescaperProjectV31 {
			return cloneFramescaperProjectV31(profile, project);
		},
		decode(project: unknown): FramescaperProjectV31 {
			return cloneFramescaperProjectV31(profile, project);
		},
	});
}
