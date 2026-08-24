/* SPDX-License-Identifier: AGPL-3.0-only */

import { cloneFramescaperProjectV28, type FramescaperProjectV28 } from './editor-project-v28.ts';
import { assertFramescaperProjectV28Profile } from './editor-project-runtime-profile-v28.ts';

export const FRAMESCAPER_V28_COMPATIBILITY_CONTRACT = Object.freeze({
	projectSchemaVersion: 28,
	desktopLibrarySchemaVersion: 19,
	desktopDatabaseUserVersion: 21,
	desktopLibraryScope: Object.freeze(['kw.media', 'scape-project-library', 'v19']),
	clipboardSchemaVersion: 12,
	renderPlanVersion: 14,
	activation: 'selected' as const,
});

export function framescaperDesktopProjectTransportV28(profile: unknown) {
	assertFramescaperProjectV28Profile(profile);
	return Object.freeze({
		contract: FRAMESCAPER_V28_COMPATIBILITY_CONTRACT,
		encode(project: unknown): FramescaperProjectV28 { return cloneFramescaperProjectV28(profile, project); },
		decode(project: unknown): FramescaperProjectV28 { return cloneFramescaperProjectV28(profile, project); },
	});
}
